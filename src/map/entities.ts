import type { AreaGeometry, Geometry, GeoFeatureCollection, Position } from "./loadWorldData";
import { splitAtAntimeridian } from "./render";
import alpha3ToNumeric from "./data/iso-alpha3-to-numeric.json";

// Reverse of the alpha3->numeric table above, derived rather than vendored
// separately -- avoids two copies of the same 249-entry mapping ever
// drifting out of sync. Used to abbreviate small countries' labels down to
// their ISO alpha-3 code (see buildLabelEntities) instead of vendoring a
// second lookup file just for this.
const numericToAlpha3: Record<string, string> = Object.fromEntries(
  Object.entries(alpha3ToNumeric as Record<string, string>).map(([alpha3, numeric]) => [numeric, alpha3]),
);

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export type EntityType = "country" | "state" | "label";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  // For a state/city, the id of its containing entity (e.g. a state's
  // country). For a label, the id of the entity it displays text for
  // instead -- same field, since both are "what this entity is attached
  // to", but not a containment relationship in the label case. Unset for
  // top-level entities like countries, and for entities whose parent
  // couldn't be resolved -- see buildStateEntities.
  parentId?: string;
  geometry: Geometry;
  boundingBox: BoundingBox;
  // Free-form, per-entity extras (matches architecture.md's Entity shape).
  // Currently just `area`, used by label entities for collision-priority
  // ranking -- see computeArea/buildLabelEntities.
  metadata?: { area?: number };
}

// Natural Earth's admin-1 states/provinces data links to its parent country
// via `adm0_a3` (ISO 3166-1 alpha-3, e.g. "ARG"), but world-atlas's country
// features are keyed by ISO 3166-1 *numeric* id (e.g. "032"). This table
// (vendored from the standard ISO 3166-1 country list) bridges the two.
export interface StateGeoFeature {
  type: "Feature";
  id?: string;
  properties: { name?: string; adm0_a3?: string; admin?: string };
  geometry: AreaGeometry;
}

export interface StateGeoFeatureCollection {
  type: "FeatureCollection";
  features: StateGeoFeature[];
}

// Naive min/max over raw coordinates. Countries that cross the antimeridian
// (Russia, Fiji) will get a wrong, globe-spanning box here (minLon=-180,
// maxLon=180) for the same reason raw rendering did before the
// antimeridian split fix in MapCanvas.tsx -- deferred until Phase 5 (Smart
// Camera) actually consumes bounding boxes for framing.
export function computeBoundingBox(geometry: Geometry): BoundingBox {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return { minLon: lon, maxLon: lon, minLat: lat, maxLat: lat };
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  return { minLon, minLat, maxLon, maxLat };
}

// Shoelace formula over each ring, in raw lon/lat degrees -- not a true
// physical area (a degree of longitude covers less real distance near the
// poles, and antimeridian-crossing entities like Russia/Fiji get an
// inflated value for the same reason their boundingBox is already
// known-wrong -- see computeBoundingBox above). That's fine here: this only
// needs to coarsely rank "bigger on the map" ahead of "smaller" for label
// collision priority (see buildLabelEntities), not be physically accurate.
// An inflated Russia/Fiji area doesn't produce a wrong practical outcome --
// Russia should win label collisions regardless of the exact number, and
// Fiji has few close neighbors to collide with.
//
// Antarctica is a sharper case of the same issue: its polar closure edge
// (see splitAtAntimeridian's comment in render.ts) produces a spurious,
// oversized "hole" ring under raw shoelace, large enough to overwhelm the
// real exterior area and go net negative -- measured -3876 against Russia's
// +1700. A negative value would actively break priority ranking (Antarctica
// sorting as *less* important than a tiny island), not just be imprecise,
// so the final result is clamped to a magnitude rather than left signed.
export function computeArea(geometry: AreaGeometry): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let area = 0;

  for (const rings of polygons) {
    rings.forEach((ring, ringIndex) => {
      let ringArea = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        ringArea += x1 * y2 - x2 * y1;
      }
      ringArea = Math.abs(ringArea) / 2;
      // Ring 0 is the exterior boundary; subsequent rings are holes to
      // subtract -- same convention render.ts's fillGeometry already uses.
      area += ringIndex === 0 ? ringArea : -ringArea;
    });
  }

  return Math.abs(area);
}

// Area-weighted polygon centroid, in raw lon/lat degrees -- same "not
// physically accurate near the poles, good enough for coarse ranking/
// placement, not precision GIS" caveat as computeArea, and the same
// ring-index-based exterior/hole convention (ring 0 adds, subsequent rings
// subtract).
//
// Unlike computeArea, this needs antimeridian-safe pieces, not just the raw
// ring: an unsplit ring spanning the dateline would pull the centroid
// toward the middle of that spurious span (potentially into the ocean on
// the wrong side of the world), defeating the entire point of computing a
// real center instead of a bounding-box one. Reuses render.ts's
// splitAtAntimeridian, the same fix already applied to actual rendering.
//
// Still not a perfect "point guaranteed inside the shape" -- like any
// geometric centroid, it can land outside the polygon for unusually
// concave/crescent shapes. That's the accepted gap versus a true
// "pole of inaccessibility" (visual center) algorithm, which finds a point
// guaranteed inside any shape but needs real iterative computation --
// deferred as a further-polish step if centroids ever visibly land wrong.
export function computeCentroid(geometry: AreaGeometry): [number, number] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  // Pieces split at the antimeridian can land on *opposite* numeric sides
  // of it (e.g. a piece centered at +179 and another at -179.9, actually
  // only ~1 degree apart on the globe). Naively averaging their raw
  // longitudes pulls the result toward 0 -- the "short way" through the
  // date line numerically, not the real short way through the date line
  // geographically. For a country with one dominant landmass (Russia's
  // Siberia, the US's CONUS) that distortion is a small pull the dominant
  // piece's weight swamps; for a country with no dominant piece scattered
  // evenly across the date line (Fiji's ~20 comparably-sized islands) it
  // becomes the dominant effect and produces a badly wrong result --
  // measured Fiji landing at 165 degrees E, nowhere near any of its actual
  // islands (all 174.6 to -178.7). Fix: normalize every piece's longitude
  // relative to the first piece seen, shifting by +-360 as needed to keep
  // all pieces within 180 degrees of each other before combining, then
  // wrap the final result back into [-180, 180].
  let referenceLon: number | null = null;

  for (const rings of polygons) {
    rings.forEach((ring, ringIndex) => {
      for (const piece of splitAtAntimeridian(ring)) {
        let signedArea2 = 0;
        let sumCx = 0;
        let sumCy = 0;

        for (let i = 0; i < piece.length; i++) {
          const [x1, y1] = piece[i];
          const [x2, y2] = piece[(i + 1) % piece.length];
          const cross = x1 * y2 - x2 * y1;
          signedArea2 += cross;
          sumCx += (x1 + x2) * cross;
          sumCy += (y1 + y2) * cross;
        }

        // Degenerate piece (collinear points, effectively a line) -- no
        // area to weight by, skip rather than divide by zero.
        if (signedArea2 === 0) continue;

        let pieceCx = sumCx / (3 * signedArea2);
        const pieceCy = sumCy / (3 * signedArea2);

        if (referenceLon === null) {
          referenceLon = pieceCx;
        } else if (pieceCx - referenceLon > 180) {
          pieceCx -= 360;
        } else if (pieceCx - referenceLon < -180) {
          pieceCx += 360;
        }

        // Dividing by the *signed* area above already gives the correct
        // centroid regardless of winding direction, but combining pieces
        // needs a consistent exterior/hole sign, which winding alone can't
        // be trusted for (same reasoning as computeArea) -- so the
        // combination weight uses the ring-index convention instead.
        const weight = ringIndex === 0 ? Math.abs(signedArea2) : -Math.abs(signedArea2);

        weightedX += weight * pieceCx;
        weightedY += weight * pieceCy;
        totalWeight += weight;
      }
    });
  }

  if (totalWeight === 0) {
    // Degenerate geometry (every ring/piece collapsed to a line) -- bbox
    // center is a safe fallback, not a silent NaN.
    const bbox = computeBoundingBox(geometry);
    return [(bbox.minLon + bbox.maxLon) / 2, (bbox.minLat + bbox.maxLat) / 2];
  }

  let lon = weightedX / totalWeight;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;

  return [lon, weightedY / totalWeight];
}

// Even-odd ray-casting against a single ring piece, in raw lon/lat degrees
// (lon acts as x, lat as y -- same convention as computeArea/computeCentroid
// above). Standard point-in-polygon algorithm, no antimeridian handling of
// its own -- callers are expected to already have split the ring via
// splitAtAntimeridian, same as fillGeometry/computeArea/computeCentroid.
function rayCast(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Point-in-polygon test in raw lon/lat degrees. Reuses splitAtAntimeridian
// per ring (same antimeridian-safety approach computeCentroid already uses)
// and the same ring-index exterior(0)/hole(>0) convention fillGeometry/
// computeArea use: a point counts as inside a polygon if it falls inside any
// exterior piece and not inside any hole piece.
export function pointInPolygon(lon: number, lat: number, geometry: AreaGeometry): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const rings of polygons) {
    let insideExterior = false;
    let insideHole = false;

    rings.forEach((ring, ringIndex) => {
      for (const piece of splitAtAntimeridian(ring)) {
        if (rayCast(lon, lat, piece)) {
          if (ringIndex === 0) insideExterior = true;
          else insideHole = true;
        }
      }
    });

    if (insideExterior && !insideHole) return true;
  }

  return false;
}

// Linear scan with a cheap boundingBox prefilter before the exact (and more
// expensive) pointInPolygon test -- fine even over ~4600 states since the
// prefilter is just four number comparisons per entity. Inherits
// computeBoundingBox's known antimeridian gap for Russia/Fiji (their box
// spans nearly the whole globe) -- harmless here, since a too-wide box only
// ever fails to *reject* early; it never produces a wrong hit, it just falls
// through to the (still-correct) exact test for those two countries.
export function findEntityAt(entities: Entity[], lon: number, lat: number): Entity | undefined {
  return entities.find((entity) => {
    const { minLon, minLat, maxLon, maxLat } = entity.boundingBox;
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return false;
    return pointInPolygon(lon, lat, entity.geometry as AreaGeometry);
  });
}

export function buildCountryEntities(countries: GeoFeatureCollection): Entity[] {
  return countries.features.map((f) => ({
    id: f.id ?? f.properties.name ?? "",
    name: f.properties.name ?? "",
    type: "country",
    geometry: f.geometry,
    boundingBox: computeBoundingBox(f.geometry),
  }));
}

// A small number of Natural Earth's admin-1 features (~2% -- disputed
// territories like Kosovo/Western Sahara, and micro-states absent from
// world-atlas's 241-country set, e.g. Tuvalu) don't resolve to a parent
// country. Rather than silently dropping them, they're still built as
// entities with `parentId: undefined` and a console warning -- Phase 4
// selection can decide later whether an orphaned state is selectable on its
// own.
export function buildStateEntities(
  states: StateGeoFeatureCollection,
  countries: GeoFeatureCollection,
): Entity[] {
  const countryIds = new Set(countries.features.map((f) => f.id));
  const codeMap = alpha3ToNumeric as Record<string, string>;

  return states.features.map((f) => {
    const alpha3 = f.properties.adm0_a3;
    const numericId = alpha3 ? codeMap[alpha3] : undefined;
    const parentId = numericId && countryIds.has(numericId) ? numericId : undefined;

    if (!parentId) {
      console.warn(
        `buildStateEntities: no matching country for state "${f.properties.name}" ` +
          `(adm0_a3=${alpha3}, admin=${f.properties.admin})`,
      );
    }

    return {
      id: f.id ?? f.properties.name ?? "",
      name: f.properties.name ?? "",
      type: "state",
      parentId,
      geometry: f.geometry,
      boundingBox: computeBoundingBox(f.geometry),
    };
  });
}

// Below this raw-shoelace area, a country's label shows its ISO alpha-3
// code (e.g. "TTO") instead of its full name -- small nations packed close
// together (Caribbean, Balkans, Persian Gulf) are exactly where collision
// placement has the least room to work with, so shrinking the label itself
// helps more than picking better neighbors ever could. Picked by eyeballing
// real areas (El Salvador 1.7, Dominican Rep. 4.15, Cuba 9.5, Honduras 9.5),
// not derived from anything -- tune by feel like the zoom-threshold
// constants in MapCanvas.tsx, re-check visually if it's ever changed.
const ABBREVIATE_COUNTRY_BELOW_AREA = 5;

// States don't get this treatment (yet): Natural Earth's admin-1 data has
// no universal short-code equivalent to ISO alpha-3 for countries (US-style
// postal codes exist for some countries' states but not all), and the
// `postal`/`code_hasc` fields that existed in the raw data were stripped
// when states-10m.json was vendored. Revisit if state label clutter turns
// out to need it too.
function labelText(entity: Entity, area: number): string {
  if (entity.type === "country" && area < ABBREVIATE_COUNTRY_BELOW_AREA) {
    const alpha3 = numericToAlpha3[entity.id];
    if (alpha3) return alpha3;
  }
  return entity.name;
}

// Derives a label entity for each given entity, anchored at its centroid
// (see computeCentroid) with priority-ranking area attached (see
// computeArea) and, for small countries, an abbreviated display name (see
// labelText above). One generic function rather than separate country/
// state versions -- the logic is identical regardless of which entity type
// is being labeled, so callers just pass whichever entity array they want
// labels for (see MapCanvas.tsx).
export function buildLabelEntities(entities: Entity[]): Entity[] {
  return entities.map((entity) => {
    // Safe: buildLabelEntities is only ever called with country/state
    // entities (see MapCanvas.tsx), which always have AreaGeometry -- same
    // reasoning as the AreaGeometry casts in MapCanvas.tsx and render.ts.
    const areaGeometry = entity.geometry as AreaGeometry;
    const [lon, lat] = computeCentroid(areaGeometry);
    const geometry: Geometry = { type: "Point", coordinates: [lon, lat] };
    const area = computeArea(areaGeometry);

    return {
      id: `label-${entity.id}`,
      name: labelText(entity, area),
      type: "label",
      parentId: entity.id,
      geometry,
      boundingBox: computeBoundingBox(geometry),
      metadata: { area },
    };
  });
}
