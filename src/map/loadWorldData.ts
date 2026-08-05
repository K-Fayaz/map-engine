import { feature } from "topojson-client";
import land50mTopology from "world-atlas/land-50m.json";
import countries50mTopology from "world-atlas/countries-50m.json";
import land10mTopology from "world-atlas/land-10m.json";
import countries10mTopology from "world-atlas/countries-10m.json";
import indiaBoundary50m from "./data/india-boundary-50m.json";
import indiaBoundary10m from "./data/india-boundary-10m.json";

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

export interface PointGeometry {
  type: "Point";
  coordinates: Position;
}

// Polygon/MultiPolygon -- the only shapes render.ts's fillGeometry/
// strokeGeometry know how to draw. Kept as its own alias (rather than just
// inlining the union) so render.ts can stay typed to exactly what it
// supports, distinct from Entity's broader Geometry below.
export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

// Broader than AreaGeometry -- includes Point for label entities (see
// entities.ts's buildLabelEntities). Entity.geometry uses this since
// architecture.md's Entity shape is meant to hold any entity's geometry,
// not just area ones.
export type Geometry = AreaGeometry | PointGeometry;

export interface GeoFeature {
  type: "Feature";
  id?: string;
  properties: { name?: string };
  geometry: AreaGeometry;
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface WorldData {
  land: GeoFeatureCollection;
  countries: GeoFeatureCollection;
}

// world-atlas's own India polygon (ISO 3166-1 numeric id "356") follows the
// same line most non-Indian sources use, which excludes Aksai Chin and
// Pakistan-administered Kashmir -- both claimed by India and shown as part
// of it on maps published for/in India (a legal requirement under India's
// 2021 Geospatial Guidelines for domestically-distributed maps). Swapping in
// a boundary that includes the claimed territory, sourced from datameet/maps'
// india-composite dataset (CC-0, itself built from Survey-of-India-aligned
// sources plus US State Dept LSIB/Pakistan admin boundaries for the disputed
// areas), simplified with mapshaper to roughly match each resolution's
// existing India point count (~1500 at 50m, ~7700 at 10m) so it doesn't
// stand out in detail level from every other country at the same zoom.
// Deliberately only patches India's own feature -- Pakistan's and China's
// polygons are left as world-atlas ships them, so they still visually
// underlap in the disputed region; see MapCanvas.tsx for the render-order
// fix that makes India's version the one that wins visually.
export const INDIA_COUNTRY_ID = "356";

export function loadWorldData(resolution: Resolution = "50m"): WorldData {
  const landTopology = resolution === "10m" ? land10mTopology : land50mTopology;
  const countriesTopology = resolution === "10m" ? countries10mTopology : countries50mTopology;
  const indiaBoundary = (resolution === "10m" ? indiaBoundary10m : indiaBoundary50m) as AreaGeometry;

  const land = feature(
    landTopology,
    landTopology.objects.land,
  ) as GeoFeatureCollection;

  const countries = feature(
    countriesTopology,
    countriesTopology.objects.countries,
  ) as GeoFeatureCollection;

  const india = countries.features.find((f) => f.id === INDIA_COUNTRY_ID);
  if (india) {
    india.geometry = indiaBoundary;
  }

  return { land, countries };
}
