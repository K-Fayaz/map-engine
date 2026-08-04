import { feature } from "topojson-client";
import statesTopology from "./data/states-10m.json";
import type { StateGeoFeatureCollection } from "./entities";

// States/provinces only ship at one resolution (10m) -- see states-10m.json's
// provenance notes in entities.ts. There's no LOD swap need here the way
// countries have one: states only ever become visible at a zoom level where
// 10m country detail is already showing.
export function loadStatesData(): StateGeoFeatureCollection {
  return feature(
    statesTopology,
    statesTopology.objects.admin1,
  ) as StateGeoFeatureCollection;
}
