# Development Changelog

This file logs development history, decisions, and deferred work for future
context. Newest entries at the top.

---

## 2026-08-12 — Lakes (Phase 3 water bodies, stage 1 of 3)

### Summary
First stage of the remaining Phase 3 water-body work (lakes, rivers, seas
-- see `.development_logs/plan-water-bodies.md`; cities explicitly out of
scope, skipped per user request). Lakes were the smallest step: mechanically
identical to Phase 3a's state vendoring (polygon in, polygon out), reusing
every existing rendering/hit-test primitive with no new geometry type.

### Changes

**New vendored data (`src/map/data/lakes-10m.json`)**
- Natural Earth's `ne_10m_lakes`, filtered to `scalerank <= 6` (434 of the
  source's 1355 features) so minor ponds don't clutter the map, same
  complexity-budget reasoning as Phase 2's country-detail lesson.
  Simplified 8% via mapshaper (Smallwood Reservoir alone was ~24k points,
  ~23% of the filtered set's total), trimmed to `name` + `ne_id` (the
  latter kept only to serve as each feature's id -- lakes have no natural
  key the way countries/states do). Vendored as TopoJSON, matching
  `states-10m.json`'s convention rather than raw GeoJSON.

**`entities.ts`**
- `EntityType` gained `"lake"`. New `LakeGeoFeature`/`LakeGeoFeatureCollection`
  types and `buildLakeEntities()` -- same shape as `buildCountryEntities`,
  no parent linkage (a lake doesn't belong to a country the way a state
  does). Filters out one feature whose geometry comes back `null` from
  topojson-client -- mapshaper's simplify pass flagged a single
  self-intersection in the source data it couldn't repair, which collapses
  that lake's geometry entirely rather than leaving a degenerate-but-usable
  shape. 433 of 434 render. ~2% of lakes (102) have no `name` in the source
  data; kept anyway with the same `name: ""` fallback
  `buildCountryEntities`/`buildStateEntities` already use for a missing
  name, rather than dropping them.

**`loadLakesData.ts` (new)**
- Mirrors `loadStatesData.ts` -- single resolution, no LOD pair (no
  perf/detail reason for one, same as states).

**`MapCanvas.tsx`**
- New `lakesLayer`, added after `statesLayer` per architecture.md's layer
  order (Countries → States → ... → Lakes) -- a lake spanning a state or
  country border reads as one unbroken water shape on top, not interrupted
  by the border line underneath. Every lake container is added as a
  permanent child up front, no viewport culling or zoom-gated reveal: at
  434 entities this is comparable to the always-visible 241-country layer,
  not the ~4600-entity states layer that needed culling.
  `LAKE_COLOR = OCEAN_COLOR` (a lake is the same substance as the ocean, so
  it reads as water for free); `LAKE_BORDER_COLOR` a shade darker, same
  "subordinate color, not width" idea as `STATE_BORDER_COLOR` (pixelLine
  ignores width entirely).
- `hitTestScreenPoint` now checks lakes first, unconditionally, before
  falling through to the existing state/country candidate list -- lakes
  paint on top of both, so hit-test priority should match paint order, the
  same reasoning already applied to India's re-added-on-top container.
- `lakeEntities` folded into `interactionStore.setEntities(...)` and the
  highlight overlay's `allEntities` lookup -- search and click-to-select
  work identically to countries/states with no changes needed in
  `SearchBox.tsx` or `interactionStore.ts` (both already generic over any
  entity type).

### Decisions
- **No reveal zoom threshold for lakes** -- always visible, same tier as
  countries. States needed a threshold + viewport culling specifically
  because of their ~4600-entity count; lakes' post-filter count (434) never
  hits that problem, so adding threshold/culling machinery for it would
  have been unjustified complexity.
- **Hit-test priority follows paint order, not zoom-tier candidate lists**
  -- lakes are checked before whichever of states/countries is "active" for
  the current zoom, since they're always the topmost of the three visually.
- **Dropped, not warned-and-kept, for the one null-geometry lake** -- unlike
  `buildStateEntities`' unmatched-parent states (kept with a warning, since
  they still have valid geometry to render), there's no partial value in
  keeping an entity with no geometry at all; every downstream consumer
  (`computeBoundingBox`, rendering, hit-testing) would need a null-check
  instead of this one filter.

### Deferred / not yet implemented
- Rivers, seas (stages 2/3 of the water-bodies plan).
- Cities (explicitly skipped this pass, per user request).

---

## 2026-08-07 — Multi-select (ctrl/cmd+click)

### Summary
User-requested: selection was previously single-entity only (clicking a new
country/state replaced whatever was selected). Added file-manager-style
multi-select -- ctrl (Windows/Linux) or cmd (Mac) held while clicking adds/
removes an entity from the selection instead of replacing it, both on the
map canvas and in the search box's result list.

### Changes

**`interactionStore.ts`**
- `selectedEntityId: string | null` replaced with `selectedEntityIds:
  Set<string>`. `selectEntity` removed; replaced by `toggleEntity(id,
  additive)`: `additive: false` behaves like the old `selectEntity` (replace
  the whole selection with just `id`, or clear it for `id === null`);
  `additive: true` toggles `id` into/out of the existing set, leaving
  everything else selected alone. Added `isSelected(id)` as a convenience
  read.
- `toggleEntity(null, additive: true)` -- ctrl/cmd+clicking empty ocean/land
  -- is a deliberate no-op rather than clearing the selection, matching how
  a file manager's ctrl+click on empty space doesn't discard a
  multi-selection. Only a plain (non-additive) click on empty space clears
  everything.

**`MapCanvas.tsx`**
- `onPointerUp` reads `e.ctrlKey || e.metaKey` off the `PointerEvent` and
  passes it straight through as `toggleEntity`'s `additive` flag -- no new
  state, the browser already gives this for free on every pointer event.
- `drawHighlights()`'s selection branch now loops over every id in
  `selectedEntityIds`, accumulating each one's fill+stroke into the same
  persistent `selectionGraphic` -- same "many shapes, one Graphics object"
  approach `land` already uses, not one Graphics per selected entity. Hover
  suppression (skip drawing the hover outline if it matches a selection)
  changed from an `!==` check against a single id to `!selectedEntityIds.
  has(hoveredEntityId)`.

**`SearchBox.tsx`**
- The single "selected" panel became a list, one row per selected entity,
  each with its own `×` to deselect just that one (`toggleEntity(id,
  true)`), plus a "Clear all (N)" button once more than one is selected
  (`toggleEntity(null, false)`).
- Clicking a search result now also respects ctrl/cmd: plain click replaces
  the selection with just that result (and clears the query, as before);
  ctrl/cmd+click adds it to the existing selection and deliberately leaves
  the query/results open, so several results can be ctrl+clicked in a row
  without retyping the search each time.

### Decisions
- **Ctrl/cmd+click on empty space is a no-op, not a clear** -- confirmed
  with the user against the alternative (any click on empty space always
  clears). Matches the OS-level multi-select convention this feature is
  explicitly modeled on.
- **No shift-click range-select.** A set of countries/states has no natural
  ordering to range over the way a file list or spreadsheet does, so this
  was skipped rather than inventing an arbitrary one.
- **Hover stays single-entity.** Ctrl+hover isn't a meaningful concept the
  way ctrl+click is -- hover only ever reflects "what's under the cursor
  right now."
- **No new `clearAll` method** -- `toggleEntity(null, false)` already
  expresses "clear everything," reused for the search box's "Clear all"
  button rather than adding a second way to do the same thing.

### Deferred / not yet implemented
- In-app interactive verification of this feature was explicitly skipped
  for this pass (user request) -- `tsc --noEmit` is clean and a full sweep
  confirmed no leftover references to the removed `selectEntity`/
  `selectedEntityId` API anywhere in `src/`, but the actual click/ctrl-click
  behavior in a running browser has not been exercised. Worth an actual
  pointer-driven pass (plain click, ctrl+click add, ctrl+click remove,
  ctrl+click empty space, search-box ctrl+click, "Clear all") before relying
  on this in a demo.
- No visual distinction between "just hovered" and "one of several selected"
  beyond the existing hover/selection styling -- multiple selected entities
  all render with the same `SELECTION_COLOR`, there's no per-entity ordering
  or numbering shown anywhere (e.g. "1st selected", "2nd selected").

---

## 2026-08-05 — India boundary corrected to include Aksai Chin / PoK

### Summary
User-reported: `world-atlas`'s India polygon (the same one most non-Indian
basemaps ship) excludes Aksai Chin and Pakistan-administered Kashmir/
Gilgit-Baltistan from India's fill/border, drawing them as part of China's
and Pakistan's polygons instead. This is the internationally-common line,
but doesn't match India's official claimed boundary, which is a legal
requirement for maps distributed for/in India (2021 Geospatial Guidelines) —
and the product owner is shipping this for an Indian audience. Fixed by
patching India's country-level geometry only; explicitly not a "neutral
default," a deliberate one-sided choice for this product, made with the
tradeoff understood (see Decisions).

### Changes

**New vendored data (`src/map/data/`)**
- `india-boundary-50m.json` / `india-boundary-10m.json`: India's outline
  including Aksai Chin, Pakistan-occupied Kashmir, and the Shaksgam Valley.
  Sourced from `datameet/maps`' `Country/india-composite.geojson` (CC-0;
  built from Survey-of-India-aligned sources plus US State Dept LSIB and
  Pakistan admin boundaries specifically for the disputed pieces). Raw file
  is ~253k points across 80 polygons — simplified via `mapshaper` (3% for
  10m, 0.6% for 50m) to land close to `world-atlas`'s own existing India
  point counts at each resolution (~7700 / ~1500) so it doesn't stand out in
  detail level from every other country at the same zoom, same reasoning as
  the states-10m.json vendoring in Phase 3a.

**`loadWorldData.ts`**
- After building the `countries` FeatureCollection at each resolution, looks
  up India by its ISO numeric id (`"356"`) and replaces its `geometry` with
  the vendored corrected boundary. Only India's feature is touched —
  Pakistan's and China's polygons are left exactly as `world-atlas` ships
  them, so they still underlap India's claimed territory in the disputed
  region.

**`MapCanvas.tsx`**
- Since Pakistan's/China's polygons weren't clipped, India's fill/stroke
  needs to paint on top of theirs in the overlap to read correctly. India's
  `CountryContainer` is re-added to `countriesLayer` right after the initial
  build loop — Pixi's `addChild` moves an already-attached child to the end
  of its parent's children (top of paint order), so no polygon clipping was
  needed to make this look right.

**`entities.ts`**
- Natural Earth's admin-1 data has one Kashmir-region feature keyed by a
  non-standard pseudo-country code (`adm0_a3: "KAS"`, "Siachen Glacier") that
  isn't a real ISO 3166-1 alpha-3 code and therefore isn't in the vendored
  `iso-alpha3-to-numeric.json` — it was falling into `buildStateEntities`'s
  unmatched/orphan bucket (`parentId: undefined`). Added a small
  `NATURAL_EARTH_PSEUDO_CODES` map inside `entities.ts` joining `"KAS"` to
  India's numeric id, rather than polluting the ISO table (which stays a
  faithful copy of the real standard) with a code that isn't actually part
  of it.

### Decisions
- **Only India's polygon was patched, not Pakistan's/China's.** This
  encodes a specific, one-sided territorial position (India's official
  claim) rather than a neutral "disputed territory" convention — done
  deliberately, at the product owner's explicit request, for an Indian
  audience, not as a default anyone should assume is "correct" for other
  contexts. If this project is ever distributed outside that context,
  revisit whether that's still the right call.
- **Country-level fix only; state-level (`states-10m.json`) left as-is.**
  Jammu & Kashmir and Ladakh already resolved to India correctly before this
  fix (Natural Earth's admin-1 data already attributed them there). Aksai
  Chin and PoK have no corresponding Indian admin-1 (state) feature in the
  vendored data at all, so the state *border* layer still shows a gap in
  those areas even though the country fill/border now covers them — states
  render border-only with no fill (Phase 3a decision), so this reads as a
  minor missing-internal-lines gap, not a wrong-color gap. Not fixed here;
  would need sourcing/vendoring admin-1-equivalent boundaries for those
  areas specifically if it's ever visibly a problem.
- **Simplified to match existing point-count budget, not kept full-detail.**
  Consistent with Phase 2's country-complexity lesson (a handful of
  disproportionately detailed polygons cost real tessellation time) — no
  reason for India alone to be ~30x more detailed than every neighboring
  country at the same zoom.

### Deferred / not yet implemented
- No admin-1 (state-level) boundary data for Aksai Chin / PoK — state layer
  still shows a border gap there (see Decisions).
- This patch isn't wired into any "refresh vendored data" script — if
  `world-atlas` is ever upgraded, this substitution still applies at load
  time regardless (it patches the in-memory feature after loading, not the
  vendored `world-atlas` files themselves), so it should survive a
  `world-atlas` version bump without needing to be reapplied. Worth
  double-checking against a fresh `world-atlas` release if the country id
  scheme or feature shape ever changes upstream.

---

## 2026-08-05 — Zoom/drag sluggishness after state reveal (steady-state Pixi overhead)

### Summary
User-reported follow-up to the same-day LOD/hover fix above: zoom and drag
both felt slower specifically once zoom crosses `STATE_ZOOM_THRESHOLD` and
the ~4600 state borders become visible -- not a one-time stutter at the
threshold crossing, but a sustained sluggishness for as long as states stay
on screen. Confirmed first that states are *not* recomputed on every reveal
(built once at mount, `setVisibleAboveZoom` is just a boolean flip -- no
rebuild, no re-fetch), then reproduced and profiled the actual gesture via
chrome-devtools (synthetic wheel/pointer events + CPU-profile sample
decoding, same methodology as the earlier fix this same day). On the same
scripted repro (5 wheel ticks crossing the threshold, a 20-step drag, 4 more
wheel ticks): ticks exceeding 8ms dropped from 125/1216 (~10%, several
sustained 15-18ms) to 1/2046 (a tracing-tool startup artifact, not real
work); mean tick time roughly halved (2.46ms to 1.23ms).

### Diagnosis
Comparing ticker (`_tick`) frame durations immediately before vs. after the
threshold crossing in the same trace showed a real, sustained cost increase
(median 0.7ms before to a mix including many 15-18ms frames after), not a
single spike -- ruling out a rebuild-style bug like the earlier LOD fix.
Decoding the trace's CPU profile (`ProfileChunk`/`Profile` events,
reconstructed sample-by-sample since no built-in insight covers this) for
self-time after the reveal surfaced two distinct, unrelated costs, both
scaling with *how many display objects currently exist as visible children*
regardless of whether anything about them is changing:
1. `packAttributes` (Pixi's batch renderer packing vertex data into the
   shared buffer) as the single largest self-time consumer -- normal Pixi
   behavior, but multiplied by ~4600 additional always-visible `Graphics`
   children the moment `statesLayer` turns on.
2. `updateTransformAndChildren` (scene-graph transform walk) and, more
   surprisingly, `hitTestMoveRecursive` -- Pixi's *own* federated event
   system doing its own recursive hit-test walk of the whole scene graph on
   every pointermove. This app never uses Pixi's built-in interaction
   (Phase 4 deliberately built manual `pointInPolygon` hit-testing instead,
   specifically to avoid enabling per-object interactivity), but nothing
   had ever explicitly turned Pixi's own event system off, so it was still
   walking all ~4850 entities' worth of containers for no reason.
Confirmed via `node_modules/pixi.js`'s own `EventBoundary.mjs` source that
`eventMode = "none"` on the stage short-circuits `_interactivePrune` at the
root before it recurses into any children, rather than guessing from
behavior alone.

### Changes

**`MapCanvas.tsx` -- disable Pixi's unused built-in event system**
- `app.stage.eventMode = "none"`, set once after `app.canvas` is attached.
  Eliminates `hitTestMoveRecursive` entirely, unconditionally -- dead work
  regardless of object count, safe because all real interaction here has
  always been manual canvas listeners, never Pixi's own events.

**`MapCanvas.tsx` -- viewport-cull the states layer**
- States are no longer all permanently parented to `statesLayer` at mount.
  Building the ~4600 `CountryContainer`s still happens once (geometry is
  never recomputed), but each is now stored alongside a world-space bounding
  box (`stateRenderItems`, projected once from the entity's lon/lat
  `boundingBox` via `project()`) instead of being added as a child
  immediately.
- New `declutterStates()`, structurally the same idea as the existing
  `declutterLabels()` (which already solved this identical problem for
  labels, per the Phase 3b changelog entry): only `addChild`/`removeChild`
  states whose bounding box intersects `viewportWorldBounds`. No collision
  placement needed (borders don't need to avoid overlapping each other the
  way label boxes do) -- just membership. No-ops below
  `STATE_ZOOM_THRESHOLD` since `statesLayer` is invisible there anyway, so
  there's nothing to gain from computing membership no one will see.
- Wired into the same debounced trigger `declutterLabels` already uses
  (`scheduleLabelDeclutter`, fired off wheel/drag/resize) rather than adding
  a second near-identical timer -- both are fundamentally "the viewport
  changed, recompute what's attached" and need to agree on the same
  viewport/zoom snapshot.

### Decisions
- **Reused the label-culling pattern instead of inventing a new one** --
  `declutterLabels` already established "build once, attach only what
  survives viewport culling" as the fix for this exact class of problem
  (thousands of permanently-parented children costing real per-frame Pixi-
  internal time regardless of visibility). Applying the same shape of fix to
  states keeps the file's two "thousands of entities, one hidden until
  zoomed in" cases consistent with each other rather than solving the same
  problem two different ways.
- **`eventMode = "none"` fixed globally, not scoped to the states layer** --
  it's dead weight for the whole app regardless of which layer is visible,
  and safe unconditionally since no code anywhere relies on Pixi's own
  event/interaction system.
- **Bounding-box prefilter for culling reuses the same antimeridian
  looseness already accepted elsewhere** (`findEntityAt`'s prefilter,
  `computeBoundingBox`'s known Russia/Fiji gap) -- an overly wide box only
  ever fails to cull a state early, it never hides one that should be
  visible, so it's fine to reuse without a tighter (and more expensive)
  bound.
- **Hit-testing, selection, and the highlight overlay were deliberately left
  untouched** -- `hitTestScreenPoint`/`findEntityAt` operate on the full
  `stateEntities` array regardless of what's currently attached for
  rendering, and `drawHighlights` looks entities up the same way into its
  own persistent `hoverGraphic`/`selectionGraphic`, independent of
  `statesLayer`'s children. Culling only affects what's drawn, never what's
  selectable -- a state just off the edge of the viewport (e.g. selected via
  the search box) still highlights correctly even if its own border
  container happens to be detached at that moment.

### Deferred / not yet implemented
- Merging many states' borders into fewer batched `Graphics` objects (would
  cut `packAttributes` cost further for whatever's still on screen at once)
  -- not pursued since viewport culling alone already brought frame cost
  back down to baseline for the measured repro; revisit only if a
  pathological case (e.g. a viewport spanning many small, dense countries'
  worth of states at once) is later found to still be slow.

---

## 2026-08-05 — Zoom performance fix (hover overlay + LOD fill rebuild)

### Summary
User-reported stutter on zoom after Phase 4 landed. Reproduced via
chrome-devtools (`PerformanceObserver` long tasks + full trace capture with
CPU-profile call trees, same methodology as Phase 2), which surfaced two
separate causes rather than one: a real Phase 4 regression, plus a much
larger pre-existing Phase 2 cost that had never been profiled at this
granularity before. Fixed both. Net result on the same synthetic zoom-burst
benchmark (20 wheel ticks + cursor jitter, crossing both
`LOD_ZOOM_THRESHOLD` and `STATE_ZOOM_THRESHOLD`): worst single long task
677ms → ~300-390ms, total blocked time across the burst ~1228ms → ~700-800ms.
Not fully eliminated — see Known remaining cost below.

### Diagnosis
Long-task profiling (call-tree self-time restricted to the actual long-task
windows, not whole-trace aggregates, which mixes in irrelevant idle time)
showed:
1. **New, from Phase 4**: `drawHighlights()`'s hover path called
   `fillGeometry()` (real Pixi/earcut polygon tessellation, not a cheap
   redraw) on every distinct `hoveredEntityId` change, with no debounce.
   During a zoom gesture the entity under a fixed screen point changes as
   zoom changes, so this fired repeatedly, adding measurable extra blocked
   time on top of cause #2 (confirmed by A/B: wheel-only vs. wheel+cursor-
   jitter bursts against the pre-fix code — hover added ~250ms of total
   blocked time across the burst).
2. **Pre-existing, from Phase 2**: `applyFill()`'s LOD swap re-tessellates
   land + all ~241 countries' fill synchronously in one pass whenever zoom
   crosses `LOD_ZOOM_THRESHOLD`. Confirmed via a wheel-only repro (hover
   code never fires) showing the *same* magnitude of long tasks as the
   hover case, dominated by `isEarHashed`/`triangulateWithHoles`/
   `earcutLinked` (Pixi's earcut triangulation) and `projectPoints`. Phase
   2's changelog measured this at "47ms(50m)/115ms(10m)" -- but that was
   JS-only timing done *outside* the live scene; it never captured the real
   in-scene tessellation/GPU-upload cost, which is what's actually
   expensive (600ms+ in one shot).
   Per-country profiling (isolated, via dynamic `import()` of the
   dev-server-served modules -- same technique Phase 2 used) found country
   complexity at 10m is extremely skewed: Canada alone is ~68k points
   (12.5% of the ~545k total across all 255 countries); the top 15
   countries hold ~56% of all points. A naive fixed-count chunk risks
   randomly clustering several of these outliers into one frame.

### Changes

**`MapCanvas.tsx` -- hover highlight (fix for cause #1)**
- `drawHighlights()`'s hover branch now only calls `strokeGeometry()`
  (`pixelLine`, GPU-native, no tessellation) -- dropped the `fillGeometry()`
  tint call entirely for hover. Selection is unaffected (keeps both fill
  tint + stroke) since it only changes on click, not on every pointermove.
  `HOVER_FILL_ALPHA` constant removed (no longer used).

**`MapCanvas.tsx` -- chunked LOD fill rebuild (fix for cause #2)**
- `applyFill(nextResolution, chunked = false)` gained a second parameter.
  The two `scheduleLodCheck` call sites (actual LOD swaps during
  interaction) now pass `chunked: true`; the one-time mount call stays
  `chunked: false` (unchunked) so the very first paint still shows a
  complete map rather than one that visibly fills in over several frames.
- New `countPoints(geometry)` (coordinate count across all rings -- a cheap
  proxy for tessellation cost, no antimeridian-splitting or area math
  needed for this purpose) and `FILL_CHUNK_WEIGHT_BUDGET = 6000`. When
  chunked, countries are sorted heaviest-first by point count and packed
  into chunks by a point-count budget (not a fixed item count) -- processed
  across animation frames via `requestAnimationFrame`, guarded by a
  `fillRunToken` so a superseding `applyFill` call (rapid up/down zoom
  crossing the threshold more than once) invalidates any still-running
  chunk loop rather than letting two runs interleave their writes.
  Heaviest-first + budget-based packing (rather than fixed-count chunks)
  specifically to avoid randomly clustering multiple expensive outliers
  (Canada, Russia, USA, ...) into the same frame -- tried fixed-count
  chunking first (sizes 40 and 8), both measured *worse* or barely better
  than an unchunked baseline in spots, because whichever few heavy
  countries happened to land in the same chunk dominated that frame's cost
  regardless of how many *other* (cheap) countries were also in it.

### Decisions
- **Debounce/throttle was considered and rejected for the hover fix** --
  dropping the fill entirely is simpler and removes the tessellation cost
  at its source rather than just spacing it out; hover stays visually
  instant (stroke redraw is cheap) rather than trading responsiveness for
  reduced frequency.
- **Point count (not area or a fixed per-country cost model) as the LOD
  chunk-weight proxy** -- cheap to compute (no antimeridian handling
  needed, unlike `computeArea`/`computeCentroid`), and correlates well
  enough with the actual bottleneck (Pixi's earcut triangulation, whose
  cost scales with vertex count) to be useful for chunk sizing without
  needing a more expensive/precise cost model.
- **Initial mount fill stays unchunked** -- an incrementally-filling-in map
  on first load reads as broken/slow in a different, more visible way than
  a brief zoom stutter; the one-time mount cost was already accepted
  behavior before this fix and wasn't the reported problem.

### Known remaining cost
Chunking reduces but doesn't eliminate the LOD swap's cost. Two residual
sources measured even after fixing, both bounded by real per-item Pixi
tessellation cost rather than by chunk *composition*:
- A handful of single outliers (Canada, Russia, ...) are expensive enough
  alone that isolating them into their own frame still leaves that one
  frame costing ~300-400ms -- a hard floor for this approach, since no
  amount of chunking helps once an item's own cost exceeds a frame budget
  by itself.
- Some chunks of many small-but-numerous countries still show real GC
  pressure (temporary array allocation from `projectPoints`/
  `splitAtAntimeridian` inside `fillGeometry`), moderate but non-zero.

Not pursued further this pass -- would need a deeper architectural change
(pre-building both resolutions' fill `GraphicsContext`s once at mount and
swapping a reference instead of re-tessellating at LOD-swap time, trading
a larger one-time mount cost for zero runtime re-tessellation ever; or
simplifying/caching the specific heavy outliers' geometry) rather than
tuning this chunking scheme further.

---

## 2026-08-04 — Phase 4: Interaction (country + state; city deferred)

### Summary
Implemented roadmap Phase 4's interaction requirements for countries and
states: hover detection, click-to-select, a selection/hover highlight
overlay, and a name search box. City selection is explicitly deferred —
Phase 3c (city entities) was never built, so there's nothing to select yet;
the same infrastructure here will cover cities once that data exists.
Camera fly-to-selection is also explicitly out of scope (Phase 5). This is
greenfield work — no interaction code (`eventMode`, `hitArea`, click/hover
distinction, point-in-polygon, app-level UI state) existed anywhere in the
codebase before this.

### Changes

**Hit-testing (`entities.ts`, `render.ts`, `camera.ts`)**
- `entities.ts`: `pointInPolygon(lon, lat, geometry)` — even-odd ray-casting,
  reusing `splitAtAntimeridian` per ring (same approach `computeCentroid`
  already uses) and the same ring-index exterior(0)/hole(>0) convention as
  `fillGeometry`/`computeArea`. `findEntityAt(entities, lon, lat)` — linear
  scan with a `boundingBox` prefilter ahead of the exact test; inherits
  `computeBoundingBox`'s already-accepted antimeridian gap for Russia/Fiji
  (harmless here — an overly wide box only ever fails to reject early, it
  never produces a wrong hit).
- `render.ts`: `unproject(x, y)`, the exact inverse of `project`.
- `camera.ts`: `screenToWorld(camera, screenX, screenY, baseScaleX,
  baseScaleY)`, extracted from the formula already inlined four times inside
  `viewportWorldBounds` — needed here for a single arbitrary point (the
  cursor), not just the four viewport corners.
- Manual point-in-polygon was chosen over Pixi's Federated Events/`hitArea`
  system — consistent with the codebase's existing style (pure camera math,
  no Pixi-dependent logic outside `render.ts`/`MapCanvas.tsx`) and avoids
  enabling per-object interactivity across ~4850 `CountryContainer`
  instances.

**Selection/hover state (`interactionStore.ts`, new)**
- Minimal plain pub/sub store (no state-management library installed):
  `entities`, `selectedEntityId`, `hoveredEntityId`; `setEntities`,
  `selectEntity`, `hoverEntity`, `search`, `subscribe`. Exposed both as a
  plain singleton (for `MapCanvas.tsx`'s imperative Pixi code to read/write
  directly, without triggering React re-renders of the whole canvas effect)
  and via a `useInteractionStore()` hook (`useSyncExternalStore`) for React
  components. Callable from anywhere, not just pointer handlers — matches
  `architecture.md`'s "usable manually and through AI" principle, and sets
  up cleanly for Phase 5/6 to drive selection programmatically.

**MapCanvas.tsx wiring**
- `findById(id)` on the store's `entities`, `drawHighlights()`: clears and
  redraws two persistent Graphics (`hoverGraphic`, `selectionGraphic`, both
  children of a new `highlightLayer`, last in `worldContainer`'s z-order so
  the highlight shows above labels too) using `fillGeometry`'s new `alpha`
  param for a translucent tint plus `strokeGeometry` for a crisp
  zoom-invariant border. Hover is skipped when it matches the current
  selection, to avoid a redundant double-highlight of the same shape. Not
  run per-frame — only on `interactionStore.subscribe`, since
  selection/hover changes on discrete events, not continuously.
- Click vs. drag: `onPointerDown` now also resets a
  `movedPastClickThreshold` flag; `onPointerMove` sets it once cumulative
  movement exceeds `CLICK_MOVE_THRESHOLD_PX` (4px). `onPointerUp` only calls
  `interactionStore.selectEntity(...)` if that flag never tripped — clicking
  empty ocean/land clears the selection.
- Hover: a new `!dragging` branch in `onPointerMove` runs the same
  screenToWorld → unproject → findEntityAt pipeline and updates
  `interactionStore.hoverEntity(...)` plus the cursor (`"pointer"` over a
  hit, `"grab"` otherwise — drag still forces `"grabbing"`, unchanged).
- Both pointer paths hit-test against `stateEntities` once
  `current.zoom > STATE_ZOOM_THRESHOLD`, `borderEntities` otherwise — the
  same threshold `declutterLabels` already uses for "which layer is live."
- `unsubscribeInteraction` deliberately hoisted *outside* the `app.init()`
  `.then()` callback (unlike everything else in this effect): `interactionStore`
  is a persistent module-level singleton, not recreated per mount like `app`
  is, so a React.StrictMode double-invoke cleanup has to actually call it or
  it leaks one subscriber per discarded mount.

**Search UI (`SearchBox.tsx`, new; `App.tsx`)**
- Floating panel (`position: absolute`, top-left, plain inline styles — no
  CSS framework in this repo) reading `useInteractionStore()`. Case-
  insensitive substring match over `entity.name` (`interactionStore.search`,
  no prebuilt index — ~4850 entities is trivial to filter per keystroke),
  up to 10 results with a type badge; clicking a result selects it and
  clears the query. Shows the current selection with a "Clear" action.
- `App.tsx`: wraps `<MapCanvas />` and `<SearchBox />` in a `position:
  relative` container so the search panel can float over the canvas.

### Decisions
- **Manual point-in-polygon, not Pixi's `eventMode`/`hitArea`** — see
  Changes above. Consistent with the existing pure-camera-math style, and
  sidesteps per-object interactivity cost across thousands of entities.
- **Selection/hover state in a small custom store, not React `useState`
  inside `MapCanvas`** — needed by both the imperative Pixi code and
  React UI (search box), and settable programmatically per
  `architecture.md`'s "usable manually and through AI" principle. No
  state-management library was installed for this; the store here is
  intentionally minimal, not a general-purpose addition.
- **Highlight overlay redraws only on change, not per-frame** — selection/
  hover are discrete events, not continuous like camera easing; reusing
  `strokeGeometry`'s zoom-invariant `pixelLine` border means no per-tick
  width correction is needed either.
- **Selection persists across zoom/LOD/layer changes** — the highlight looks
  the selected entity up by id from the flat `entities` list regardless of
  which layer (`countriesLayer`/`statesLayer`) is currently "active" for new
  clicks, so zooming in/out after selecting something doesn't lose it.

### Deferred / not yet implemented
- City entities/selection — no data yet (Phase 3c was never built).
- Camera fly-to-selection / auto-framing (Phase 5).
- The pre-existing state-label decluttering overlap bug (Phase 3b, unrelated
  to this work).

---

## 2026-08-04 — Phase 3b: Country/State Labels (feature-flagged — known issue remaining)

### Summary
Implemented roadmap Phase 3's label requirement: text labels for countries
and states, revealed/swapped at the same `STATE_ZOOM_THRESHOLD` states
already use, decluttered so overlapping labels don't render simultaneously.
Landed the label-priority pieces (centroid anchoring, size-based
abbreviation, greedy collision placement) cleanly, but country-level and
state-level decluttering behave differently despite sharing the same code
path — state-layer labels still show real overlap in dense clusters. Shipped
behind a `VITE_SHOW_LABELS` env flag (default off) rather than blocking on
that fix. Six real bugs found and fixed along the way, each one only
surfacing once actually measured/inspected in chrome-devtools rather than
assumed correct from the implementation.

### Changes

**New label entity + text (`entities.ts`, `render.ts`)**
- `entities.ts`: `EntityType` gained `"label"`; `Entity` gained an optional
  `metadata?: { area?: number }` bag (matches `architecture.md`'s generic
  Entity shape, first real use of it). `computeArea` (shoelace formula, raw
  lon/lat degrees, ring-index exterior/hole convention) — used as a cheap
  size/importance proxy for both label collision priority and the
  abbreviation threshold below. `computeCentroid` — antimeridian-aware
  (reuses `render.ts`'s `splitAtAntimeridian`) area-weighted polygon
  centroid, replacing the earlier bounding-box-center anchor.
  `buildLabelEntities(entities)` derives one label per input entity;
  generic over country/state, not two separate functions.
- `render.ts`: `LabelText` (extends Pixi `BitmapText`, not `Text` — see bug
  #1), positioned once at its centroid and never repositioned (rides
  `worldContainer`'s transform via normal Pixi parent-child composition).
  `counterScaleLabelLayer` cancels the inherited zoom stretch so text stays
  a constant screen size (see bug #3 for why this must apply per-label, not
  per-layer). Shared `BitmapFont` installed lazily once, character set
  derived by scanning every actual label name in the vendored data (168
  chars, all romanized/Latin script — no CJK/Cyrillic needed for any
  country in this dataset).

**Label-priority ranking & abbreviation (`entities.ts`)**
- Countries below `ABBREVIATE_COUNTRY_BELOW_AREA` (picked by eyeballing
  real areas, tunable) show their ISO alpha-3 code (e.g. "TTO") instead of
  full name — shrinks the label itself in exactly the dense-cluster cases
  (Caribbean, Balkans, Persian Gulf) where collision placement has the
  least room to work with. `numericToAlpha3` derived at runtime from the
  existing `iso-alpha3-to-numeric.json` (inverted, not a second vendored
  file). States don't get this: Natural Earth's admin-1 data has no
  universal short-code equivalent to ISO alpha-3, and the `postal`/
  `code_hasc` fields that did exist were stripped when `states-10m.json`
  was vendored (Phase 3a).

**Viewport culling + collision placement (`camera.ts`, `labelLayout.ts` new)**
- `camera.ts`: `viewportWorldBounds` — the inverse of the transform
  `MapCanvas.tsx`'s ticker applies each frame, giving the world-space
  rectangle currently on screen. The one function in this file that needs
  `baseScaleX`/`baseScaleY` explicitly (everything else here deliberately
  stays in screen-content space where the per-axis stretch cancels out and
  never needs to appear).
- `labelLayout.ts` (new, pure, no Pixi/DOM): `placeLabelsWithoutOverlap` —
  greedy label placement (sort by importance descending, keep a candidate
  only if its screen-space box doesn't overlap a higher-priority box
  already kept). Same core algorithm Mapbox/Maplibre/Google Maps use for
  label decluttering. Unit-tested in isolation against hand-built
  overlapping/chained candidate sets before wiring into the app.

**MapCanvas.tsx wiring**
- `countryLabelsLayer` / `stateLabelsLayer`: label *objects* are all built
  upfront, but the layers themselves start empty — `declutterLabels()` is
  what actually attaches/detaches labels as real Pixi children, not just a
  `.visible` toggle (see bug #5). Visibility swap reuses the existing
  `STATE_ZOOM_THRESHOLD`/`setVisibleAboveZoom`/`setVisibleAtOrBelowZoom`
  pattern from Phase 3a's states layer.
- `declutterLabels()` debounced via `scheduleLabelDeclutter` (150ms),
  triggered from wheel *and* pointer-drag — unlike the LOD check, panning
  alone changes which labels are candidates, so it can't reuse
  `scheduleLodCheck`'s wheel-only trigger.
- `VITE_SHOW_LABELS` (`.env`, default `"false"`; override via gitignored
  `.env.local`): build-time flag skipping label construction entirely when
  off, not just hiding the result — added specifically because of the
  unresolved state-layer overlap issue below, so a fresh clone doesn't show
  it by default.

**Bugs found and fixed, in order**
1. **State label reveal cost ~1.87s of blocking work** (measured via
   chrome-devtools long-task capture on first zoom-in), vs ~660ms for the
   same gesture with labels absent. Root cause: Pixi's regular `Text`
   rasterizes each distinct string to its own canvas + GPU texture on
   first render — cheap for 241 always-visible country labels (~500ms at
   mount) but expensive the moment ~4600 hidden state labels are revealed
   at once. Fixed by switching to `BitmapText` with one shared,
   pre-generated glyph atlas (character set derived from the real data,
   not guessed) — reveal cost dropped back to the ~800ms baseline with no
   labels at all.
2. **`GL_INVALID_OPERATION: glDrawElements: Insufficient buffer size`**,
   surfaced by the `BitmapText` switch. Root cause: `React.StrictMode`'s
   dev-mode double-invoke (mount → cleanup → mount again) combined with
   Pixi's pooled batcher buffers — `app.destroy()` without
   `releaseGlobalResources: true` leaves the second `Application` instance
   with a stale, undersized buffer inherited from the first. Known Pixi
   issue (https://github.com/pixijs/pixijs/discussions/11678). Fixed by
   passing `releaseGlobalResources: true` at both destroy call sites.
3. **Labels rendered off-screen, silently.** The original design
   counter-scaled the shared label *layer* (a `Container`) to cancel zoom
   stretch. Wrong: a Container's `position` is transformed by its own
   `scale` before its parent's, so scaling the layer doesn't just shrink
   rendered text size — it also shrinks every child's *stored position*
   back toward the layer's local origin, collapsing all labels toward one
   point (measured: Gujarat's label computed at screen coordinates
   (-19260, -5465) against a 1920×1029 canvas). Fixed by counter-scaling
   each `LabelText` individually instead — a node's own scale only affects
   its own rendering size, not its own position.
4. **Cluttered, overlapping labels everywhere** (user-reported from a live
   screenshot, not caught by earlier automated checks). Root cause:
   `declutterLabels()` called Pixi's `getBounds()` immediately after
   `layer.addChild(label)`, in the same synchronous tick — Pixi's
   transform/bounds system updates lazily during its own render cycle, not
   synchronously on `addChild`, so `getBounds()` returned `(0,0,0,0)` for
   every candidate. Two zero-size boxes at the same origin never register
   as overlapping (`a.x < b.x + b.width` is `0 < 0` = false), so the
   greedy algorithm correctly concluded "nothing collides" and kept 240 of
   241 candidates — confirmed the *algorithm* itself was correct by
   feeding it the real (manually-measured) box data in isolation, where it
   correctly reduced 26 overlapping Caribbean candidates to 5. Fixed by
   computing each candidate's screen-space box manually (world position +
   camera state, the same trusted data `viewportWorldBounds` uses) instead
   of relying on `getBounds()`, using `label.width`/`label.height` (local
   quantities, correct immediately regardless of parent attachment) for
   size, with an explicit counter-scale applied before reading them (a
   label attached for the first time this cycle hasn't been corrected by
   the ticker's per-frame pass yet).
5. **Antimeridian-crossing centroid badly wrong for scattered-island
   countries.** Fiji's centroid computed at 165°E — nowhere near any of
   its actual islands (all 174.6°E to -178.7°). Root cause: pieces split at
   the antimeridian can land on opposite *numeric* sides of it (e.g. a
   piece centered at +179 and another at -179.9, actually only ~1° apart
   on the globe); naively averaging raw longitudes pulls the result toward
   0 — the "short way" through the date line numerically, not
   geographically. Countries with one dominant landmass (Russia's Siberia,
   the US's CONUS) barely show this distortion, since the dominant piece's
   weight swamps it; Fiji has ~20 comparably-sized islands scattered evenly
   across the date line with nothing to swamp it. Fixed by normalizing
   every piece's longitude relative to the first piece seen (±360° shift
   to keep all pieces within 180° of each other) before combining, then
   wrapping the final result back into [-180, 180].

Also restructured label layers to `addChild`/`removeChild` only whatever
survives culling + placement each cycle, rather than permanently parenting
all label objects and toggling `.visible` — motivated by a measured
several-hundred-ms one-time Pixi-internal cost tied to a large container's
child count. Later isolated testing (matching Phase 2's own two-stage
LOD/state methodology) showed that specific cost was actually a
continuous-burst testing artifact, not the child-count itself — but the
restructuring is kept regardless as reasonable practice, independent of
whether it was the fix for that particular measurement.

### Decisions
- **Centroid, not bounding-box center, for label anchors** — cheap
  (shoelace-based, similar math to `computeArea`), fixes the common cases
  (Chile, Norway, Vietnam) and the antimeridian cases (Russia, USA, Fiji)
  that bbox-center got badly wrong. Not a true "pole of inaccessibility"
  (guaranteed-inside-the-shape) algorithm — can still land outside the
  polygon for unusually concave/crescent shapes. Deferred as further
  polish if that's ever visibly a problem.
- **Abbreviation is size-based at build time, not adaptive.** Small
  countries always display their alpha-3 code; large ones always show the
  full name. Considered (and rejected for now) an adaptive "try full name,
  fall back to abbreviation on collision" design — better visual result,
  but requires teaching `placeLabelsWithoutOverlap` about multiple text
  variants per entity, real added complexity to the algorithm itself.
- **BitmapText over Text for all labels**, not just the ones under time
  pressure — one shared atlas, no per-string canvas rasterization. See bug
  #1.
- **Shipped behind `VITE_SHOW_LABELS=false` by default** rather than
  holding the whole feature back for the unresolved issue below — the
  underlying code (entities, rendering primitives, layout algorithm) is
  built and mostly verified; only state-layer decluttering specifically is
  known-broken.

### Known issue — not yet root-caused
State-layer labels (revealed past `STATE_ZOOM_THRESHOLD`) still show real,
measured overlap in dense clusters — 269 overlapping box pairs counted in
one Caribbean/Hispaniola view (e.g. Haiti/Dominican Republic provinces,
British Virgin Islands' individual islands). This is *after* bug #4's
`getBounds()` fix landed, and country-layer labels verified fully clean
(zero overlaps) using the identical `declutterLabels()` code path — so the
bug, whatever it is, is specific to the state layer's data or scale (many
more candidates, much smaller individual boxes, all full names with no
abbreviation) rather than the shared logic itself. Investigation was
mid-flight (had just pulled live candidate/kept-box data via a temporary
debug hook, not yet diagnosed) when this was paused to ship the env flag
instead. Pick back up by re-adding that inspection: dump
`stateLabelsLayer.children`'s actual boxes after a settled decluttering
pass in a dense region and check for genuine pairwise overlaps in the
*data* (not just visually) — that'll show whether it's still a stale-bounds
class of bug, a candidate-volume/threshold issue, or something else.

### Deferred / not yet implemented
- Fixing the state-layer overlap issue above.
- State label abbreviation (no universal short-code data source currently
  vendored — see Changes).
- Label collision against anything other than same-layer labels (e.g.
  avoiding country borders/fills, other future layers).
- Fade in/out transitions for labels appearing/disappearing — currently an
  instant pop.
- Cities, rivers, lakes (Phase 3c/3d, not started).

---

## 2026-08-04 — Phase 3a: States/Provinces

### Summary
Implemented the first slice of roadmap Phase 3 (geographic detail): state/
province boundaries, revealed above a new zoom threshold, following the
same per-entity-object pattern countries already established in Phase 1.
Required sourcing and vendoring an entirely new dataset (world-atlas has no
admin-1 data), plus a country↔state linkage step across two different ID
systems. Verified via chrome-devtools across multiple geometry edge cases
(India, Indonesia's archipelago, Russia's antimeridian-adjacent Far East)
and confirmed no measurable performance regression despite ~4600 new
entities — the "build everything upfront" pattern from Phase 1/2 held up
at this scale too.

### Changes

**Data sourcing (`src/map/data/`, new)**
- `states-10m.json`: Natural Earth's 1:10m admin-1 layer, sourced from the
  `nvkelso/natural-earth-vector` GeoJSON mirror (avoids a manual shapefile
  conversion step), simplified 10% via `mapshaper`, trimmed to just
  `name`/`adm0_a3`/`admin` properties (dropped ~90 unused columns the raw
  file carried). 4596 features, `id` set from Natural Earth's unique
  `adm1_code`.
- `iso-alpha3-to-numeric.json`: standard ISO 3166-1 country list (249
  entries), mapping alpha-3 codes (e.g. `"ARG"`) to zero-padded numeric
  codes matching `world-atlas`'s own country `id` format exactly (e.g.
  `"032"`) — bridges Natural Earth's `adm0_a3` (alpha-3) linkage field
  against `world-atlas`'s numeric-keyed countries.

**Entity model (`entities.ts`)**
- `EntityType` gained `"state"`; `Entity` gained optional `parentId`
  (containing entity — a state's country). `buildStateEntities(states,
  countries)` joins each state to its parent country via the ISO lookup
  table above; states that don't resolve (disputed territories like
  Kosovo/Western Sahara, micro-states absent from `world-atlas`'s
  241-country set) are still built as entities with `parentId: undefined`
  and a console warning, not silently dropped — Phase 4 selection can
  decide later whether an orphaned state is selectable on its own.
  Verified: 231/251 distinct country codes in the vendored data join
  cleanly, covering 4519/4596 (98.3%) of individual state features.

**Rendering (`render.ts`, `MapCanvas.tsx`)**
- `strokeGeometry` gained an optional `color` parameter (default unchanged)
  so state borders can render in a lighter, subordinate color to country
  borders — `pixelLine` (used for zoom-invariant border width) ignores
  `width` entirely, so color is the only stylable differentiator available.
  `CountryContainer` reused as-is for states, no rename — already generic
  over any `Entity`.
- `statesLayer`: built once at mount like `countriesLayer`, border-only (no
  fill — the country/land fill underneath already colors the area).
  `STATE_ZOOM_THRESHOLD = 6` (deeper than `LOD_ZOOM_THRESHOLD = 4`, since
  states are a finer detail level than 10m country fill).
  `setVisibleAboveZoom` toggles the whole layer each tick off the eased
  camera zoom — far simpler than the LOD swap's debounce, since states
  have only one resolution and toggling visibility needs no data rebuild.

### Decisions
- **States ship at a single resolution (10m) only** — no 50m/10m LOD pair
  like countries have. Natural Earth's 50m admin-1 layer only has data for
  4 countries (US, Canada, Brazil, Australia); everywhere else is blank at
  that scale. States only ever become visible at a zoom level where 10m
  country detail is already showing anyway.
- **Unmatched states (disputed territories, micro-states) are kept, not
  dropped**, with `parentId: undefined` and a warning — same
  don't-silently-drop philosophy as elsewhere in this codebase.
- **`CountryContainer` reused for states without renaming** — avoids
  renaming something that doesn't need it just because a second entity
  type uses it now.

### Deferred / not yet implemented
- State fill (no fill color differentiation from country fill yet — only
  borders).
- Cities, rivers, lakes (Phase 3c/3d).
- Labels for states/countries — landed next, see Phase 3b above.

---

## 2026-08-02 — Phase 2: Camera Navigation + LOD Data Swap

### Summary
Implemented roadmap Phase 2 (drag pan, wheel zoom, zoom limits, camera
bounds, smooth movement), plus a zoom-triggered LOD dataset swap (50m ↔
10m) folded into the same phase. Required a real architectural change
first (decoupling geometry from screen size), then three rounds of
debugging on top of it — a zoom-anchor math bug, a border-rendering
quality issue, and a performance regression — each one found by measuring
first rather than guessing, using chrome-devtools (dispatched synthetic
wheel events, `PerformanceObserver` long-task measurements, and
standalone timing of individual pipeline stages via dynamic import of the
dev-server-served modules).

### Changes

**Architecture: geometry decoupled from screen size**
- `src/map/render.ts`: added fixed `WORLD_WIDTH`/`WORLD_HEIGHT` (2000x1000)
  constants; `project`/`fillGeometry`/`strokeGeometry` no longer take
  live screen width/height. Geometry is now built once, not on every
  resize.
- `src/map/camera.ts` (new): pure camera math, no Pixi/DOM dependency —
  `Camera = { x, y, zoom }`, `clampCamera`, `zoomAt` (cursor-anchored zoom
  math), `lerpCamera` (per-frame easing). `MIN_ZOOM = 1`.
- `src/map/MapCanvas.tsx`: geometry now lives in a `worldContainer` built
  once; pan/zoom is a `Container`-level transform applied every frame by
  `app.ticker`, not a geometry rebuild. Base per-axis stretch
  (`baseScaleX`/`baseScaleY = screenSize / WORLD_SIZE`) makes the world
  exactly fill the screen at `zoom = 1`, matching the pre-Phase-2 visual
  exactly; a uniform `zoom` multiplier layers on top for actual zooming.
  (First attempt used an aspect-ratio-preserving "fit scale" instead of
  per-axis stretch — correct cartographically, but visibly shrank the map
  with letterboxing whenever the window wasn't exactly 2:1, since the
  letterbox color coincidentally matches the ocean fill. Reverted to
  per-axis stretch to match original behavior exactly.)

**Phase 2 input handling (`MapCanvas.tsx`)**
- Drag pan: `pointerdown`/`pointermove`/`pointerup` on `app.canvas`,
  direct 1:1 tracking (no momentum), `setPointerCapture` so a drag
  survives the cursor leaving the canvas.
- Wheel zoom: cursor-anchored via `zoomAt`, eased via `lerpCamera` in the
  ticker (only `target` is set directly; `current` chases it).
- Camera bounds: no wraparound panning (clamped to world edges);
  `zoom = 1` is both the floor and the point where panning becomes
  impossible (nothing to pan to when the world already fills the screen).
- Resize only recomputes bounds/base-stretch and re-clamps the camera —
  never rebuilds geometry.

**LOD swap (50m ↔ 10m)**
- `src/map/loadWorldData.ts`: `loadWorldData(resolution: "50m" | "10m")`,
  both resolutions statically imported (fine for a desktop app, no
  lazy-loading complexity needed).
- Threshold `zoom > 4` swaps to 10m; hysteresis (`< 4 * 0.85`) swaps back
  down, avoiding thrashing right at the boundary. Debounced 150ms off
  wheel events specifically (panning alone can't cross a zoom threshold).

**Bugs found and fixed, in order**
1. **Zoom jumps at high zoom.** `onWheel` anchored `zoomAt` against the
   *requested* zoom (`target.zoom * zoomFactor`), which regularly
   overshoots `MAX_ZOOM`, then clamped the zoom value afterward without
   recomputing position for the lower, actually-applied zoom — anchor
   position and applied zoom disagreed. Reproduced and measured the exact
   pixel error (~2990px) by replicating the `camera.ts` formulas directly
   in the browser console before fixing; fix was clamping the requested
   zoom *before* calling `zoomAt`, not after.
2. **Borders looked like thick blobs when zoomed into 10m data.** First
   attempted fix used Pixi's `pixelLine` stroke mode (GPU-native,
   zoom-invariant width) — this fixed the zoom-scaling problem but
   introduced a new one: `pixelLine` draws each segment as an independent
   line primitive with no corner joins, so 10m's ~5-6x higher point
   density (measured: Germany 561 vs 3010 points, Croatia 374 vs 2314)
   meant far more overlapping antialiased joints, reading as a visibly
   bolder line purely from density — confirmed 50m vs 10m looked
   inconsistent at the same zoom. Second attempt: dropped `pixelLine`,
   used a regular jointed stroke with `width` computed from the current
   zoom and rebuilt whenever zoom settled (same debounce as LOD). This
   fixed the visual issue but caused problem #3.
3. **Zooming lagged, then snapped ("lags and then zooms").** Measured with
   `PerformanceObserver`'s `longtask` entries during a simulated realistic
   zoom gesture (discrete wheel bursts with pauses): 12 long tasks, several
   440-560ms — because fix #2 made the debounced callback rebuild *all*
   ~180-250 countries' fill+stroke on every zoom-settle, not just actual
   LOD crossings. Isolated timing of just the JS portion (data
   load+convert+entity-build+draw-instructions, not added to the live
   scene) showed only 47ms (50m) / 115ms (10m) — meaning the bulk of the
   440-560ms was GPU-side (uploading new geometry / freeing old GPU
   resources for ~180+ Graphics objects), not JS.
   **Real fix (clean, not a patch):** borders don't need to depend on zoom
   or resolution at all. `CountryContainer` now holds persistent `fill`
   and `stroke` children built once at mount; `stroke` always uses stable
   50m-resolution geometry via `pixelLine` regardless of which resolution
   the `fill` is currently showing — one consistent (low) point density
   permanently fixes #2, and the border never needs rebuilding again for
   *either* zoom or LOD, permanently fixing the repeated-rebuild cause of
   #3. LOD swaps now only `.clear()` + redraw each country's `fill` (matched
   by `id` across resolutions) and `land`, and only when the resolution
   genuinely changes. Verified the fix the same way as the diagnosis: same
   long-task measurement went from 12 tasks (440-560ms) to 2 tasks
   (163ms, 327ms) — occurring once, at the actual LOD crossing, not once
   per debounce.

### Decisions
- **Country/land `Graphics` objects are effectively cached/reused across
  LOD swaps now** (persistent `CountryContainer`s, `.clear()` + redraw
  rather than destroy + recreate). This wasn't originally planned but
  falls out of the border-decoupling fix, and is a genuine win for Phase 4
  too: a future "selected country" reference now stays valid across LOD
  swaps instead of being invalidated every time one fires.
- **Borders are permanently sourced from 50m data**, even when 10m fill
  is showing. Accepted tradeoff: at extreme zoom, the border trace may not
  hug every fine coastline wiggle the 10m fill shows (e.g. very small
  islands/inlets). Not revisited — the performance and consistency wins
  outweigh this minor fidelity gap for V1.
- **No momentum/inertia drag, no wraparound panning** — confirmed earlier
  in scoping, unchanged.
- Several bugs here were found by *measuring* (browser console arithmetic
  replication, `PerformanceObserver`, isolated stage timing) rather than
  guessing from reading code — worth continuing to reach for chrome-devtools
  instrumentation first when a reported symptom isn't obviously explained
  by inspection alone.

### Deferred / not yet implemented
- Touch/trackpad gestures (pinch-zoom, multi-touch), keyboard navigation —
  not in roadmap Phase 2 scope.
- Any per-country interactivity (click/hover/select) — Phase 4, still not
  started; this phase only kept the ground it already had (persistent
  containers) more stable for that future work.
- Phase 3 geographic detail data (states, cities, rivers, lakes).

---

## 2026-08-02 — Phase 1: First World Map + Country Entity Separation

### Summary
Implemented roadmap Phase 1 (static world map render) end-to-end, debugged
three rendering bugs found along the way, then did a scoped architectural
pull-forward from Phase 4 to separate countries into individual objects.

### Changes

**Phase 1 — world map rendering**
- `src/map/loadWorldData.ts`: loads `world-atlas`'s 1:50m TopoJSON
  (`land-50m.json`, `countries-50m.json`), converts to GeoJSON via
  `topojson-client`'s `feature()`. Minimal local GeoJSON types defined here
  instead of installing `@types/geojson`.
- `src/map/topojson-client.d.ts`: ambient module declaration for
  `topojson-client` (no `@types` package exists for it).
- `src/map/MapCanvas.tsx`: PixiJS v8 renderer. Ocean = background color
  (not drawn as geometry). Land = single shared `Graphics` fill. Countries =
  filled + stroked on top. Equirectangular (Plate Carrée) projection, no
  d3-geo dependency.
- `src/App.tsx`, `src/App.css`, `index.html`: stripped Tauri/Vite/React
  boilerplate demo, made the app full-viewport, mounts `<MapCanvas />`.

**Bugs found and fixed (all in `MapCanvas.tsx`)**
1. Stray horizontal lines across the whole map (near Russia, near the
   equator through Fiji/Kiribati) — caused by rings whose points cross the
   antimeridian (+180°/-180°) without handling; naive projection drew a
   straight edge connecting the two far-apart x-coordinates.
2. First fix attempt (unwrap longitude by accumulating a ±360° offset +
   draw 3 world-width-shifted copies) fixed #1 but caused large
   incorrectly-filled bands — the same "unwrap" logic misfired on
   *synthetic* boundary-closing edges Natural Earth inserts (e.g.
   Antarctica's polar cap edge, Fiji's clip-closure edge), which are not
   real crossings and shouldn't be unwrapped.
3. Replaced the unwrap approach with `splitAtAntimeridian`: split a ring
   into separate pieces wherever a >180° jump occurs, close each piece on
   its own instead of bridging across. This introduced a smaller artifact:
   Russia's mainland polygon rendered a stray diagonal, because its
   array-start and array-end pieces both closed back to an arbitrary
   interior point (Sea of Japan area) rather than a map edge.
4. Fixed by recognizing GeoJSON rings are closed/cyclic: the array
   start/end boundary is artificial, not a real geographic break. Merge the
   first and last split pieces back together before filtering degenerate
   ones. Verified against real data (Russia, Fiji, Antarctica in both the
   `land` and `countries` datasets) with throwaway node scripts before
   committing to the fix — see conversation history for the diagnostic
   output if this logic needs revisiting.

**Country entity separation (scoped pull-forward from Phase 4)**
- `src/map/entities.ts` (new): `Entity` type matching `architecture.md`'s
  `{ id, name, type, geometry, boundingBox }` shape, `BoundingBox`,
  `computeBoundingBox` (naive min/max), `buildCountryEntities`.
- `src/map/MapCanvas.tsx`: countries are no longer drawn into one shared
  `Graphics`. Each country is now its own `CountryContainer` (a `Container`
  subclass holding its `Entity`), added to a `countriesLayer` `Container`.
  `land` stays a single shared `Graphics` (deliberately not split — see
  Decisions).

### Decisions
- **50m Natural Earth resolution** chosen over 110m (both bundled in
  `world-atlas`) for better coastline/island detail; upgrade to 10m
  possible later, same package.
- **Map Compiler step skipped for V1** — raw GeoJSON loaded directly into
  Pixi. Revisit if/when Phase 3 data volume makes this too slow.
- **Land is never split into separate objects.** It's not in
  `architecture.md`'s Entity list and isn't something a user ever selects/
  highlights in a video — landmass shapes don't map 1:1 to country borders
  anyway (Eurasia = many countries; some countries = many islands).
- **Countries are `Container`s, not bare `Graphics`** — leaves room for a
  `hitArea`, a label child, tint/highlight state without another refactor.
- **`boundingBox` computed now, naively.** Known wrong for antimeridian-
  crossing countries (Russia, Fiji) for the same reason #1 above happened.
  Deliberately deferred fixing this — revisit when Phase 5 (Smart Camera)
  actually consumes bounding boxes for camera framing.
- **Phase 3 data (states, cities, rivers, lakes) will follow the same
  per-entity-object pattern** established here, not the old single-blob
  pattern. Visibility rules already agreed for when that's built: oceans
  visible by default (already true, it's just the background); states,
  cities, rivers, lakes all hidden by default, shown via user toggle or
  zoom level.

### Deferred / not yet implemented
- No interactivity yet: `eventMode`, `hitArea`, pointer event listeners,
  hover highlight, selection state — all real Phase 4 work, not started.
  The country separation done now only makes that work possible later.
- Antimeridian-aware `boundingBox` computation (see Decisions).
- Camera system (Phase 2), Phase 3 geographic detail data, everything
  after.
