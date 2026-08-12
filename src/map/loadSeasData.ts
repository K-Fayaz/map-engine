import { feature } from "topojson-client";
import marineTopology from "./data/marine-10m.json";
import type { SeaGeoFeatureCollection } from "./entities";

// Seas ship at a single resolution, same reasoning as the other water-body
// loaders. Vendored from Natural Earth's ne_10m_geography_marine_polys, all
// 306 features kept (no scale-rank filter -- the dataset is already small,
// and there's no visible-fill clutter concern here since seas render as
// labels only, never as a filled layer -- see entities.ts's
// buildSeaEntities comment).
export function loadSeasData(): SeaGeoFeatureCollection {
  return feature(
    marineTopology,
    marineTopology.objects.marine,
  ) as SeaGeoFeatureCollection;
}
