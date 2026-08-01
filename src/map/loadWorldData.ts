import { feature } from "topojson-client";
import landTopology from "world-atlas/land-50m.json";
import countriesTopology from "world-atlas/countries-50m.json";

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

export function loadWorldData(): WorldData {
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
