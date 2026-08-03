import { feature } from "topojson-client";
import land50mTopology from "world-atlas/land-50m.json";
import countries50mTopology from "world-atlas/countries-50m.json";
import land10mTopology from "world-atlas/land-10m.json";
import countries10mTopology from "world-atlas/countries-10m.json";

// Both resolutions are bundled statically -- this is a desktop app, not a
// bandwidth-constrained web page, so there's no need for lazy-loading /
// code-splitting complexity here. See camera.ts / MapCanvas.tsx for the
// zoom-triggered LOD swap that picks between them.
export type Resolution = "50m" | "10m";

export type Position = [number, number];

export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Position[][][];
}

export type Geometry = PolygonGeometry | MultiPolygonGeometry;

export interface GeoFeature {
  type: "Feature";
  id?: string;
  properties: { name?: string };
  geometry: Geometry;
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface WorldData {
  land: GeoFeatureCollection;
  countries: GeoFeatureCollection;
}

export function loadWorldData(resolution: Resolution = "50m"): WorldData {
  const landTopology = resolution === "10m" ? land10mTopology : land50mTopology;
  const countriesTopology = resolution === "10m" ? countries10mTopology : countries50mTopology;

  const land = feature(
    landTopology,
    landTopology.objects.land,
  ) as GeoFeatureCollection;

  const countries = feature(
    countriesTopology,
    countriesTopology.objects.countries,
  ) as GeoFeatureCollection;

  return { land, countries };
}
