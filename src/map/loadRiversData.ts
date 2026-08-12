import { feature } from "topojson-client";
import riversTopology from "./data/rivers-10m.json";
import type { RiverGeoFeatureCollection } from "./entities";

// Rivers ship at a single resolution, same reasoning as loadStatesData.ts/
// loadLakesData.ts. Vendored from Natural Earth's
// ne_10m_rivers_lake_centerlines, filtered to scalerank <= 6 (490 of the
// source's 1455 features) to drop minor tributaries -- see entities.ts's
// RiverGeoFeature comment for the id-field/vendoring details.
export function loadRiversData(): RiverGeoFeatureCollection {
  return feature(
    riversTopology,
    riversTopology.objects.rivers,
  ) as RiverGeoFeatureCollection;
}
