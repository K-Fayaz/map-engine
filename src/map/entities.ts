import type { Geometry, GeoFeatureCollection } from "./loadWorldData";
import alpha3ToNumeric from "./data/iso-alpha3-to-numeric.json";

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export type EntityType = "country" | "state";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  // Id of the entity's containing entity (e.g. a state's country). Unset for
  // top-level entities like countries, and for entities whose parent
  // couldn't be resolved -- see buildStateEntities.
  parentId?: string;
  geometry: Geometry;
  boundingBox: BoundingBox;
}

// Natural Earth's admin-1 states/provinces data links to its parent country
// via `adm0_a3` (ISO 3166-1 alpha-3, e.g. "ARG"), but world-atlas's country
// features are keyed by ISO 3166-1 *numeric* id (e.g. "032"). This table
// (vendored from the standard ISO 3166-1 country list) bridges the two.
export interface StateGeoFeature {
  type: "Feature";
  id?: string;
  properties: { name?: string; adm0_a3?: string; admin?: string };
  geometry: Geometry;
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
