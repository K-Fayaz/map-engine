# Development Changelog

This file logs development history, decisions, and deferred work for future
context. Newest entries at the top.

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
