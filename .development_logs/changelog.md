# Development Changelog

This file logs development history, decisions, and deferred work for future
context. Newest entries at the top.

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
