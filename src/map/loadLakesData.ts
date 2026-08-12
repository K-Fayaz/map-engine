import { feature } from "topojson-client";
import lakesTopology from "./data/lakes-10m.json";
import type { LakeGeoFeatureCollection } from "./entities";

// Lakes ship at a single resolution, same reasoning as loadStatesData.ts --
// there's no LOD tier that would justify a 50m/10m pair the way countries
// have one. Vendored from Natural Earth's ne_10m_lakes, filtered to
// scalerank <= 6 (434 of the source's 1355 features) so the map isn't
// cluttered with minor ponds -- see entities.ts's LakeGeoFeature comment for
// the id-field/vendoring details.
export function loadLakesData(): LakeGeoFeatureCollection {
  return feature(
    lakesTopology,
    lakesTopology.objects.lakes,
  ) as LakeGeoFeatureCollection;
}
