import type { Geometry, GeoFeatureCollection } from "./loadWorldData";

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export type EntityType = "country";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  geometry: Geometry;
  boundingBox: BoundingBox;
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
