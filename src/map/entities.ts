import type { AreaGeometry, LineGeometry, Geometry, GeoFeatureCollection, Position } from "./loadWorldData";
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

export type EntityType = "country" | "state" | "label" | "lake" | "river" | "sea";

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
// (Russia, the USA via the Aleutians, Fiji) get a wrong, globe-spanning box
// here (minLon near -180, maxLon near 180) for the same reason raw
// rendering did before the antimeridian split fix in MapCanvas.tsx.
// Deliberately left this way, not fixed here -- this is what populates
// entity.boundingBox, which findEntityAt/findRiverAt (hit-test prefilters)
// and declutterStates (viewport-culling prefilter) also read, and at every
// one of those call sites an overly-*wide* box is explicitly documented as
// harmless (it only ever fails to reject/cull early, never produces a
// wrong result). A *tighter* box computed in a shifted coordinate space --
// which is what an antimeridian-correct fix needs, see
// computeFramingBounds below -- would actively misreject valid points on
// the "wrong" side of the shift if plugged into those same raw-lon
// prefilters. So the fix for camera framing lives in a separate function
// instead of changing this one's behavior.
export function computeBoundingBox(geometry: Geometry): BoundingBox {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return { minLon: lon, maxLon: lon, minLat: lat, maxLat: lat };
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  // LineString/MultiLineString (rivers) have no rings to speak of -- just
  // point sequences, one level shallower than a polygon's rings. Handled as
  // its own branch rather than folding into the polygon loop below, since
  // there's no ring-index exterior/hole distinction to reuse here.
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    for (const line of lines) {
      for (const [lon, lat] of line) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    return { minLon, minLat, maxLon, maxLat };
  }

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

// Antimeridian-aware bounding box for camera framing (Phase 6 pan/highlight
// fly-to) -- a separate function from computeBoundingBox above, not a
// replacement for it; see that function's comment for why its behavior is
// deliberately left as-is for hit-testing/culling. Point/LineString/
// MultiLineString geometry has no antimeridian ambiguity to correct here
// (rivers deliberately skip this too, see findRiverAt/pointNearLine), so
// those are delegated straight through unchanged.
//
// Detection: measure the entity's longitude span two ways -- as-is, and
// with every negative longitude shifted by +360 -- and check whether the
// shifted version is *tighter* (smaller max-min span). Countries that
// cross the antimeridian (Russia's Chukotka peninsula, the USA's western
// Aleutian islands, Fiji) have points clustered near both -180 and +180,
// which the shift re-expresses as one small contiguous span instead of a
// ~360deg one -- confirming a genuine crossing. For every entity that
// doesn't cross the seam, the shift either has no effect or produces a
// *larger* span, so this never misfires for ordinary countries that
// merely straddle 0 deg longitude (Algeria, Ghana, Spain, ...).
//
// Framing: an early version of this function returned the shifted-space
// box directly when a crossing was detected, but that's a bug, not a fix
// -- render.ts's project() is plain linear (lon -> x), with no
// wraparound, so a shifted value past 180 projects to a screen position
// nowhere near the entity (verified in-browser: "pan to USA" landed on
// Asia). There is no rectangular, non-wrapping camera viewport on this
// flat, non-repeating map that could frame territory on *both* sides of
// the seam in one shot anyway. So instead: once a crossing is confirmed,
// split points by raw sign (negative vs non-negative longitude) and keep
// only the side with the larger span -- the country's dominant landmass
// -- using its own plain, already-valid min/max. The minority sliver on
// the far side of the seam (Chukotka, the westernmost Aleutians) ends up
// just outside the frame, which reads as "panned to Russia/the USA"
// instead of "zoomed out to the whole world." Verified: USA's dominant
// (negative) side spans ~111deg (mainland+Alaska+Hawaii) vs. ~7deg for the
// stray Aleutian tip; Russia's dominant (positive) side spans ~160deg vs.
// ~10deg for Chukotka.
export function computeFramingBounds(geometry: Geometry): BoundingBox {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return computeBoundingBox(geometry);
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let minLonShifted = Infinity;
  let maxLonShifted = -Infinity;
  // Per-side (raw lon < 0 vs >= 0) tracking, only consulted if a crossing
  // is confirmed below.
  let negMinLon = Infinity, negMaxLon = -Infinity, negMinLat = Infinity, negMaxLat = -Infinity;
  let posMinLon = Infinity, posMaxLon = -Infinity, posMinLat = Infinity, posMaxLat = -Infinity;

  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        const shiftedLon = lon < 0 ? lon + 360 : lon;
        if (shiftedLon < minLonShifted) minLonShifted = shiftedLon;
        if (shiftedLon > maxLonShifted) maxLonShifted = shiftedLon;
        if (lon < 0) {
          if (lon < negMinLon) negMinLon = lon;
          if (lon > negMaxLon) negMaxLon = lon;
          if (lat < negMinLat) negMinLat = lat;
          if (lat > negMaxLat) negMaxLat = lat;
        } else {
          if (lon < posMinLon) posMinLon = lon;
          if (lon > posMaxLon) posMaxLon = lon;
          if (lat < posMinLat) posMinLat = lat;
          if (lat > posMaxLat) posMaxLat = lat;
        }
      }
    }
  }

  if (maxLonShifted - minLonShifted >= maxLon - minLon) {
    return { minLon, minLat, maxLon, maxLat };
  }

  if (negMaxLon - negMinLon >= posMaxLon - posMinLon) {
    return { minLon: negMinLon, minLat: negMinLat, maxLon: negMaxLon, maxLat: negMaxLat };
  }
  return { minLon: posMinLon, minLat: posMinLat, maxLon: posMaxLon, maxLat: posMaxLat };
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
// Natural Earth uses "KAS" as a non-standard pseudo-country code for its
// Kashmir/Siachen Glacier admin-1 feature -- not a real ISO 3166-1 alpha-3
// code, so it doesn't belong in the vendored iso-alpha3-to-numeric.json
// (that table stays a faithful copy of the real standard). Handled here
// instead, joining it to India to match the corrected country-level
// boundary in loadWorldData.ts (see that file's comment for the full
// rationale).
const NATURAL_EARTH_PSEUDO_CODES: Record<string, string> = { KAS: "356" };

export function buildStateEntities(
  states: StateGeoFeatureCollection,
  countries: GeoFeatureCollection,
): Entity[] {
  const countryIds = new Set(countries.features.map((f) => f.id));
  const codeMap = alpha3ToNumeric as Record<string, string>;

  return states.features.map((f) => {
    const alpha3 = f.properties.adm0_a3;
    const numericId = alpha3 ? (codeMap[alpha3] ?? NATURAL_EARTH_PSEUDO_CODES[alpha3]) : undefined;
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

// Natural Earth's ne_10m_lakes, unlike states, has no parent-linkage field
// to join against -- a lake doesn't belong to a country the way a state
// does, so there's no equivalent of buildStateEntities' alpha3->numeric
// bridge here. Trimmed to just `name` (+ `ne_id`, kept only so it can be
// used as each feature's stable unique id -- see below) when vendoring
// lakes-10m.json.
export interface LakeGeoFeature {
  type: "Feature";
  // Natural Earth's own globally-unique running id (`ne_id`), set as this
  // feature's topojson id at vendoring time. Countries/states use their own
  // id schemes (ISO numeric, adm1_code) instead -- lakes have no equivalent
  // natural key, so this is the only stable id available. Numeric, unlike
  // GeoFeature.id elsewhere in this codebase (which is always a string) --
  // buildLakeEntities converts it.
  id?: number;
  properties: { name?: string };
  // Nullable, unlike every other GeoFeature-shaped type in this codebase --
  // see buildLakeEntities' comment on the one vendored lake that actually
  // hits this.
  geometry: AreaGeometry | null;
}

export interface LakeGeoFeatureCollection {
  type: "FeatureCollection";
  features: LakeGeoFeature[];
}

// ~2% of lakes in the vendored data (102 of 434) have no `name` in Natural
// Earth's own data (and no `name_alt` fallback either) -- rather than
// dropping them (they're still real water bodies that should render), they
// get the same `name: ""` fallback buildCountryEntities/buildStateEntities
// already use for a missing name. An empty name just never matches a
// search query and shows a blank label if one were ever added -- not a
// crash, not a collision (id comes from `ne_id`, not `name`).
//
// One feature (of the 434) is dropped here, not just name-defaulted:
// mapshaper's simplify pass flagged a single self-intersection in the
// source data it couldn't repair (see the vendoring notes for
// lakes-10m.json), and topojson-client's feature() turns that lake's
// geometry into `null` rather than a usable (if degenerate) shape --
// nothing left to compute a bounding box for or render. Unlike the
// unmatched-parent states above, this genuinely has no geometry to keep,
// so filtering it out (rather than keeping a warning-logged entity with a
// missing geometry, which would just move the crash to every downstream
// consumer instead of preventing it) is the right call here.
export function buildLakeEntities(lakes: LakeGeoFeatureCollection): Entity[] {
  return lakes.features
    .filter((f): f is LakeGeoFeature & { geometry: AreaGeometry } => f.geometry != null)
    .map((f) => ({
      id: `lake-${f.id ?? ""}`,
      name: f.properties.name ?? "",
      type: "lake",
      geometry: f.geometry,
      boundingBox: computeBoundingBox(f.geometry),
    }));
}

// Natural Earth's ne_10m_rivers_lake_centerlines has no natural unique key
// at all (unlike lakes' ne_id) -- `river_id` here is a synthetic index
// assigned once at vendoring time (see rivers-10m.json's provenance notes),
// baked into the topojson as its id-field. Stable as long as the vendored
// file isn't regenerated with a different filter/order, same caveat as any
// other vendored snapshot in this codebase.
export interface RiverGeoFeature {
  type: "Feature";
  id?: number;
  properties: { name?: string };
  // Nullable for the same reason LakeGeoFeature's is -- see
  // buildRiverEntities' comment on the one vendored river that hits this.
  geometry: LineGeometry | null;
}

export interface RiverGeoFeatureCollection {
  type: "FeatureCollection";
  features: RiverGeoFeature[];
}

// Same shape as buildLakeEntities, and the same reasoning for both the
// `name: ""` fallback (11 of 490 rivers are unnamed in the source data) and
// filtering out features whose geometry comes back `null` from
// topojson-client -- mapshaper's simplify pass flagged 9 unrepairable
// self-intersections across the vendored set, one of which (the Loire, of
// all rivers) collapses entirely rather than leaving a degenerate-but-usable
// line. 489 of 490 render.
export function buildRiverEntities(rivers: RiverGeoFeatureCollection): Entity[] {
  return rivers.features
    .filter((f): f is RiverGeoFeature & { geometry: LineGeometry } => f.geometry != null)
    .map((f) => ({
      id: `river-${f.id ?? ""}`,
      name: f.properties.name ?? "",
      type: "river",
      geometry: f.geometry,
      boundingBox: computeBoundingBox(f.geometry),
    }));
}

// Squared distance from point (lon, lat) to the segment [a, b], all in raw
// lon/lat degrees -- same "not physically accurate near the poles, fine for
// a coarse hit-test tolerance" caveat the rest of this file's geometry math
// already carries. Squared (not sqrt'd) since pointNearLine only ever
// compares it against an already-squared tolerance -- one sqrt avoided per
// segment, over what can be a few thousand segments across all rivers per
// hit-test.
function squaredDistanceToSegment(
  lon: number,
  lat: number,
  a: Position,
  b: Position,
): number {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    // Degenerate segment (a === b) -- distance to the single point.
    return (lon - ax) ** 2 + (lat - ay) ** 2;
  }

  // Project (lon, lat) onto the infinite line through a/b, clamped to
  // [0, 1] so points beyond either endpoint measure to that endpoint
  // instead of the line's extension.
  let t = ((lon - ax) * dx + (lat - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const closestLon = ax + t * dx;
  const closestLat = ay + t * dy;
  return (lon - closestLon) ** 2 + (lat - closestLat) ** 2;
}

// Point-near-line test, the river equivalent of pointInPolygon -- a line has
// no interior, so "hit" means "within toleranceDegrees of any segment", not
// a ray-cast. No antimeridian splitting here (unlike pointInPolygon/
// fillGeometry/computeCentroid): a wrong distance across a dateline-crossing
// segment only risks a river hit-testing slightly wrong right at the
// antimeridian itself, not a wrong shape rendered or a wrong country
// selected -- much lower stakes than the polygon cases that motivated
// splitAtAntimeridian, so not worth the same complexity here.
export function pointNearLine(
  lon: number,
  lat: number,
  geometry: LineGeometry,
  toleranceDegrees: number,
): boolean {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const toleranceSquared = toleranceDegrees * toleranceDegrees;

  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      if (squaredDistanceToSegment(lon, lat, line[i], line[i + 1]) <= toleranceSquared) {
        return true;
      }
    }
  }
  return false;
}

// Linear scan with the same boundingBox prefilter idea as findEntityAt, but
// grown by `toleranceDegrees` on every side first -- a river whose segment
// geometry sits just outside its own tight bbox-by-toleranceDegrees would
// otherwise be rejected before pointNearLine ever gets a chance to measure
// the actual distance.
export function findRiverAt(
  rivers: Entity[],
  lon: number,
  lat: number,
  toleranceDegrees: number,
): Entity | undefined {
  return rivers.find((entity) => {
    const { minLon, minLat, maxLon, maxLat } = entity.boundingBox;
    if (
      lon < minLon - toleranceDegrees ||
      lon > maxLon + toleranceDegrees ||
      lat < minLat - toleranceDegrees ||
      lat > maxLat + toleranceDegrees
    ) {
      return false;
    }
    return pointNearLine(lon, lat, entity.geometry as LineGeometry, toleranceDegrees);
  });
}

// Natural Earth's ne_10m_geography_marine_polys has a `ne_id`, but unlike
// lakes' it isn't reliably unique -- two separate "Great Barrier Reef"
// polygons in the source data share one -- so `sea_id` here is a synthetic
// index, same approach as rivers' `river_id`, rather than trusting `ne_id`.
export interface SeaGeoFeature {
  type: "Feature";
  id?: number;
  properties: { name?: string; featurecla?: string };
  geometry: AreaGeometry;
}

export interface SeaGeoFeatureCollection {
  type: "FeatureCollection";
  features: SeaGeoFeature[];
}

// Same `name: ""` fallback precedent as lakes/rivers/countries/states for
// the 11 (of 306) unnamed marine features. Unlike lakes/rivers, no feature
// here collapsed to a null geometry during simplification (one
// unrepairable self-intersection was flagged, same as lakes/rivers, but it
// didn't happen to zero out this time) -- so there's no filter step, all
// 306 build.
//
// Deliberately has no visible fill/border layer in MapCanvas.tsx: marine
// regions overlap and nest (a bay inside a gulf inside a sea inside an
// ocean) in ways that don't render sensibly as a set of disjoint filled
// areas the way countries/lakes do. The geometry is kept anyway, purely so
// findEntityAt/drawHighlights can still resolve a click inside one and
// highlight it correctly -- see MapCanvas.tsx's seaEntities wiring.
export function buildSeaEntities(seas: SeaGeoFeatureCollection): Entity[] {
  return seas.features.map((f) => ({
    id: `sea-${f.id ?? ""}`,
    name: f.properties.name ?? "",
    type: "sea",
    geometry: f.geometry,
    boundingBox: computeBoundingBox(f.geometry),
  }));
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
    // Safe: buildLabelEntities is only ever called with country/state/sea
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
