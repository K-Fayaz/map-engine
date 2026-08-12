# Plan: Water Bodies (Lakes, Rivers, Seas) — Phase 3 remainder

Tracks the remaining Phase 3 (roadmap.md) water-body work: lakes, rivers,
seas. Cities (3c) are explicitly out of scope for this plan — skipped per
user request, tracked separately later.

Built in this order — lakes, then rivers, then seas — smallest/most
mechanical change first, each step reusing more of the existing
country/state pattern than the last, ending with the genuinely new pieces
(line geometry for rivers, label-only selectable regions for seas).

Update this file's checkboxes as work lands; add a changelog.md entry per
completed stage the same way Phase 3a/3b did.

---

## Stage 1 — Lakes ✅ done (2026-08-12)

Mechanically identical to Phase 3a's state vendoring — polygon in, polygon
out, no new geometry type or rendering code.

- [x] Source & vendor `ne_10m_lakes` (Natural Earth) → `src/map/data/lakes-10m.json`, trimmed to `name` (+ `ne_id`, used as id), simplified via mapshaper
- [x] Decide + apply a scale-rank/size cutoff so minor lakes don't clutter the map (scalerank <= 6 -- 434 of 1355 source features)
- [x] `entities.ts`: add `"lake"` to `EntityType`; `buildLakeEntities()`
- [x] `MapCanvas.tsx`: new `lakesLayer`, built once at mount, reusing existing `fillGeometry`/`strokeGeometry` with a water-tint fill color
- [x] Decide reveal zoom threshold — always-visible instead, no threshold (see Notes)
- [x] Wire into hit-testing (`findEntityAt`) and the search box so lakes are selectable/searchable like countries/states
- [x] Verify in-browser: pan/zoom near a few real lakes (Caspian Sea, Great Lakes, Lake Victoria), confirm fill/border/selection/search all work, no perf regression
- [x] Changelog entry

### Notes (decisions actually made)
- **No reveal threshold — lakes are always visible**, same tier as the 241
  always-visible countries, not the culled/threshold-gated states. At 434
  entities post-filter (comparable to countries' 241), there's no
  ~4600-entity perf problem to solve, so the states-style viewport-culling
  machinery wasn't needed.
- **Hit-test priority**: lakes are checked *before* country/state
  candidates in `hitTestScreenPoint`, regardless of zoom -- they paint on
  top (architecture.md's layer order has Lakes above States), so a click
  inside one should resolve to the lake, matching what's visually on top.
- **One lake dropped, not rendered**: mapshaper flagged one lake (of 434)
  with a self-intersection it couldn't repair during simplification;
  topojson-client turns that feature's geometry into `null` rather than a
  usable shape. `buildLakeEntities` filters it out rather than crashing --
  see its comment in entities.ts. 433 of 434 render.
- **102 unnamed lakes** (no `name` in the source data) kept anyway, same
  `name: ""` fallback precedent as `buildCountryEntities`/
  `buildStateEntities` for a missing name -- they still render, just never
  match a search query.
- Verified in-browser via chrome-devtools: search finds "Lake Victoria"
  (badged LAKE), click-to-select and the orange highlight overlay both work
  correctly, and zooming into the Canadian Shield (thousands of real small
  lakes) renders cleanly with no perf issues at max zoom.

## Stage 2 — Rivers ✅ done (2026-08-12)

New geometry type — everything upstream of rendering (Polygon/MultiPolygon
only) needs a line-geometry branch added alongside, not replacing, the
existing polygon path.

- [x] Source & vendor `ne_10m_rivers_lake_centerlines` → `src/map/data/rivers-10m.json`, trimmed to `name` (+ synthetic `river_id`), filtered to `scalerank <= 6` (490 of 1455), simplified via mapshaper
- [x] `loadWorldData.ts`: add `LineGeometry` (`LineString`/`MultiLineString`) to the `Geometry` union
- [x] `entities.ts`: add `"river"` to `EntityType`; `buildRiverEntities()`
- [x] `render.ts`: new `strokeLine()` — walks each line via `pixelLine` for zoom-invariant width, no fill (open path, not a closed ring)
- [x] `entities.ts`: new `pointNearLine(lon, lat, geometry, toleranceScreenPx)` hit-test (distance-to-segment, not ray-casting) — needs the current zoom/scale to convert a screen-pixel tolerance into world units
- [x] `MapCanvas.tsx`: new `riversLayer`; extend pointer-handler hit-test dispatch to also try rivers (after lakes, before falling through to state/country)
- [x] Decide reveal zoom threshold — always-visible, same call as lakes (see Notes)
- [x] Verify in-browser: Nile, Amazon, Ganges, Congo, Mississippi, Volga, Yangtze, Ganges all visible; direct canvas click and search-based selection both confirmed; click-tolerance feels right (missed clicks correctly fall through to the underlying state/country, not stuck or swallowed)
- [x] Changelog entry

### Notes (decisions actually made)
- **No natural unique key in the source data** (unlike lakes' `ne_id`) --
  `river_id` is a synthetic index assigned once at vendoring time, baked in
  as the topojson id-field. Stable only as a vendored snapshot -- would need
  reassigning if the file is ever regenerated with a different filter/order.
- **`computeBoundingBox` gained a LineString/MultiLineString branch** --
  point sequences one level shallower than a polygon's rings, handled as its
  own early-return rather than folding into the polygon loop.
- **`pointNearLine` skips `splitAtAntimeridian` deliberately** -- that
  helper's ring-closure logic (stitching the first/last split piece back
  together) assumes a closed ring, which doesn't hold for an open river
  path; no vendored river actually crosses the antimeridian, so this is a
  no-cost skip, not an accepted gap.
- **Hit-test tolerance is a constant screen-pixel radius (6px), converted to
  lon/lat degrees at hit-test time** using the current zoom/baseScale --
  needed since rivers have no interior, unlike every other selectable
  entity; a fixed-degree tolerance would make the click target balloon at
  low zoom and vanish at high zoom.
- **`drawHighlights` needed a real code change, not just new data** -- once
  rivers became selectable, the existing hover/selection overlay's
  `fillGeometry`/`strokeGeometry` calls (typed to `AreaGeometry`) would
  silently misrender a selected river (cast to `AreaGeometry` despite
  actually being `LineGeometry`). Added a `LineString`/`MultiLineString`
  branch that calls `strokeLine` instead, for both the selection and hover
  graphics.
- **Found and ruled out a false alarm**: a `GL_INVALID_OPERATION:
  Insufficient buffer size` WebGL warning appeared during verification.
  Isolated via `git stash` to the already-committed lakes-only baseline --
  it reproduces there too, with zero interaction, so it predates rivers
  entirely. Same family as the known React.StrictMode double-invoke Pixi
  bug already documented in the changelog (Phase 3b bug #2), just
  apparently triggered by a lower draw-call threshold than previously
  measured. Not fixed here -- out of scope for the rivers stage, flagged in
  the changelog as a pre-existing issue to revisit.

## Stage 3 — Seas

Labels-only by default (per earlier discussion — marine polygons overlap/
nest and aren't clean disjoint regions like countries), but geometry is
still kept for hit-testing + the existing selection highlight overlay, so a
click still resolves to the right sea/gulf/bay and highlights it using the
same `drawHighlights` machinery everything else already uses.

- [ ] Source & vendor `ne_10m_geography_marine_polys` → `src/map/data/marine-10m.json`, trimmed to `name`/`featurecla` (Sea/Gulf/Bay/Strait/Ocean)
- [ ] `entities.ts`: add `"sea"` to `EntityType`; `buildSeaEntities()` (geometry = marine polygon, same shape as `buildCountryEntities`)
- [ ] `entities.ts`/`labelLayout.ts`: feed sea entities into the existing `buildLabelEntities()` path so names render at their centroid like country/state labels
- [ ] `MapCanvas.tsx`: **no** default-visible fill/border layer for seas — polygon only participates in `findEntityAt` + `drawHighlights`'s hover/selection overlay (fill+stroke appears only when hovered/selected, never by default)
- [ ] Decide reveal zoom threshold for the labels (seas are large — likely visible earlier than lakes/rivers, closer to country-label thresholds)
- [ ] Wire into search box
- [ ] Verify in-browser: click inside the Arabian Sea / Bay of Bengal with no visible boundary shown, confirm it still selects+highlights correctly; confirm overlapping regions (e.g. a bay inside a sea) resolve to something sane on click
- [ ] Changelog entry

## Open decisions (resolve before/while building, not blocking the plan)

- Exact zoom thresholds for each layer's reveal — tune by feel like existing constants, no strong prior
- Whether rivers/lakes need a 50m/10m LOD pair or ship at a single resolution (states shipped single-resolution; countries need the pair) — likely single-resolution unless a specific perf/detail problem shows up
- Overlapping seas' click-resolution rule (topmost in paint order? smallest area wins, like a "most specific" heuristic?) — defer until Stage 3, see what the real data actually looks like
