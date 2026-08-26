# Development Changelog

This file logs development history, decisions, and deferred work for future
context. Newest entries at the top.

---

## 2026-08-26 — Bug fix: scene duration label overflow on resize

### Summary
User reported that dragging a scene block's resize handle in the Timeline
showed a duration label with a long run of decimals (e.g.
`2.9016601562499996s`), overflowing the block. Root cause: `onResizeMove`
(`Timeline.tsx`) derives duration directly from raw pixel delta ÷
`PIXELS_PER_SECOND`, an unrounded float, stored as-is by `resizeScene` and
rendered with no formatting.

### Changes
**`src/map/Timeline.tsx`**
- `onResizeMove` now rounds the computed duration to the nearest tenth of a
  second (`Math.round(rawDuration * 10) / 10`) before calling
  `resizeScene`, instead of passing the raw pixel-derived float through
  unrounded.

### Decisions
- **Rounded at the source (the resize handler), not just at display time.**
  Keeps `scene.duration` itself clean for anything else that reads it
  (export, timeline math), rather than papering over long floats with a
  `toFixed` only in the label.

---

## 2026-08-26 — Political-map coloring (external palette) + Australia/Caspian bugs it exposed

### Summary
User wanted the map's look changed from one flat land color (white) + a
plain teal ocean to a "political map" style -- each country its own color
-- but explicitly did not want colors hardcoded per-country, since more map
styles are planned later. Discussed the approach before writing anything:
a small external config file exporting a color palette, with each country
picking a color from it deterministically (hash of its own id) rather than
a hardcoded per-country lookup table or full adjacency-based graph-coloring
(the latter ruled out as disproportionate complexity for a cosmetic
feature -- confirmed with the user, who agreed hash-based collisions
between neighbors are an acceptable trade-off, same as the reference image
they were matching). Planned via `EnterPlanMode` before implementation.

Once shipped and the user confirmed it looked good, they spotted two
countries/water-bodies rendering plain white instead of a palette color --
Australia and the Caspian Sea -- and asked why. Investigated read-only
first (no code changes) rather than guessing: both turned out to be real,
pre-existing bugs in the underlying map data, invisible before this session
only because the old flat white land color was indistinguishable from
whatever was silently going wrong underneath.

**Australia**: confirmed directly against the vendored
`world-atlas/countries-50m.json` that Australia's mainland and a separate
tiny feature, "Ashmore and Cartier Is." (an external territory with no ISO
code of its own), both carry the same numeric id `"036"` -- the only
duplicate id in the whole dataset (checked exhaustively via a Node script).
The per-country fill-color lookup in `worldRenderer.ts` is keyed by this id
in a `Map`, so the duplicate collides and Australia's own container can end
up painted with the tiny island's geometry instead of its own -- while its
outline (drawn straight from its own entity, not through that lookup) still
renders correctly, producing exactly the observed symptom: a
correctly-shaped, empty white country.

**Caspian Sea**: a different, unrelated cause. It's classified as a "sea"
entity, which by design gets no fill layer at all (only used for
hit-testing/labels -- reasonable for open marine areas, per the code's own
existing comment). Verified with a throwaway script against the vendored
50m land silhouette data (point-in-polygon over a grid across the Caspian's
real bounding box) that this coarse base layer does NOT properly hole the
Caspian out at this resolution -- several points deep inside the Caspian's
real extent test as "land." With no sea fill and an imperfect hole, the
flawed land silhouette's own `LAND_COLOR` was showing through -- confirmed
by pixel-sampling a screenshot of the running app: the "white" patch was
exactly `#f5f5f2`, `LAND_COLOR` to the value, not a rendering fluke or an
optical illusion against the new palette.

A separate, related but *unresolved* question came up mid-session: the old
hover/selection highlight was a fixed translucent orange fill tuned against
a flat white base -- with country fills now varying, that fixed-hue
overlay reads inconsistently (barely visible against yellow/orange
countries, muddy against blue/purple/green ones). Three options were laid
out for the user (neutral white wash + colored stroke; outline-only, no
fill; keep colored fill but raise alpha) but the conversation moved to the
Australia/Caspian bug investigation before a decision was made -- still
open, see Deferred below.

### Changes

**New `src/map/mapColors.ts`**
- `landPalette: number[]` -- 8 pastel hex colors matching the reference
  image's tone.
- `oceanColor: number` -- moved out of `worldRenderer.ts`'s local constant,
  a light sky blue (`#aee2f2`) replacing the old flat teal.
- `colorForCountry(id: string): number` -- deterministic FNV-1a-style hash
  of the id, mod `landPalette.length`. Same country always gets the same
  color across renders/LOD swaps/exports; no adjacency computation.

**`src/map/worldRenderer.ts`**
- `setResolution`'s per-country fill call now uses
  `colorForCountry(c.entity.id)` instead of the old flat `LAND_COLOR`.
  `LAND_COLOR` itself stays, still used for the coarse base `land`
  silhouette layer underneath (a fallback, not meant to be visible once
  countries are colored in -- see the Caspian bug above for what happens
  when it *is* visible).
- `OCEAN_COLOR` now sourced from `mapColors.ts`'s `oceanColor` instead of a
  locally hardcoded literal; `LAKE_COLOR` (`= OCEAN_COLOR`) follows
  automatically.
- New: after building `seaEntities`, the Caspian Sea specifically is
  looked up by name and given the same lake-style fill+stroke
  (`LAKE_COLOR`/`LAKE_BORDER_COLOR`) as every real lake, added into the
  existing `lakesLayer` (so it paints above countries/states, same as
  other lakes, and a lake spanning into the middle of a country still
  reads as one unbroken water shape). Its entity/type stays "sea" for
  search and hit-testing -- only its paint changes, not its
  classification.

**`src/map/entities.ts`**
- New `ASHMORE_AND_CARTIER_ID` constant; `buildCountryEntities` now gives
  "Ashmore and Cartier Is." this synthetic id instead of letting it inherit
  Australia's real `"036"` -- same fix shape as the existing
  `NATURAL_EARTH_PSEUDO_CODES` workaround just above it for Kashmir's
  non-standard `"KAS"` code.

### Decisions
- **Hash-based per-country coloring, not graph-coloring.** Confirmed with
  the user before implementation (`AskUserQuestion`) -- adjacency-safe
  coloring would guarantee no two touching countries share a color, but
  needs real adjacency data/computation for a purely cosmetic feature;
  occasional same-color neighbors are an accepted trade-off, matching the
  reference image's own apparent behavior.
- **One external color config file for now, not a full theme-switcher
  system.** User explicitly scoped it down to this -- externalizing the
  values so nothing's hardcoded, without building a multi-theme
  registry/UI picker before there's a second real theme to switch to.
- **Caspian fixed by reusing the lakes visual treatment, not by giving
  "sea" entities a general fill.** Seas as a class are often large,
  irregular, antimeridian-spanning marine regions where a always-on fill
  risks looking wrong or costly elsewhere (the same reasoning already
  documented for why seas skip hover-stroking); the Caspian specifically is
  hydrologically a closed-basin lake, so treating it like one is correct,
  not just convenient.
- **Ashmore and Cartier Is. re-keyed with a synthetic id, not a generic
  duplicate-id-dedup mechanism.** Confirmed via an exhaustive check that
  it's the *only* duplicate id in the entire 50m country dataset -- a
  known one-off Natural Earth quirk, handled the same targeted way the
  codebase already handles Kashmir's pseudo-code, rather than adding
  general collision-handling logic for a problem that has exactly one
  instance.
- **Diagnosed both bugs via direct data inspection and pixel-sampling
  before writing any fix** -- a Node script confirmed the Australia/Ashmore
  id collision was the only duplicate in the dataset; a throwaway
  point-in-polygon script over the Caspian's real bounding box confirmed
  the land silhouette's imperfect hole; a screenshot pixel-sample confirmed
  the visible color was exactly `LAND_COLOR`. Not guessed from visual
  inspection alone.

### Deferred / not yet implemented
- **Hover/selection highlight color scheme.** The existing fixed
  translucent-orange fill (tuned for the old flat-white land color) reads
  inconsistently now that country fills vary. Three options discussed with
  the user (neutral white wash + colored stroke; outline-only; raise the
  existing fill's alpha) -- no decision made yet, still open.
- No general audit for other Natural Earth data quirks of either kind
  (other duplicate ids, other seas/lakes with a similar land-silhouette
  gap) -- only the two instances the user actually spotted were
  investigated and fixed.

---

## 2026-08-25 — Equirectangular to Web Mercator, and getting the default view right

### Summary
User asked to make the map's *scale* look more like Google Maps -- high-
latitude landmasses (Greenland, the Arctic islands, Antarctica) read as
tiny dots on the existing map compared to Google's view, even though the
user understood the map is squeezed into one fixed view rather than
pannable. Diagnosed together: the app's `project()` (`render.ts`) was
plain equirectangular (Plate Carrée) -- linear lon/lat -> x/y, so 1° of
longitude is the same pixel width at every latitude. Google Maps uses Web
Mercator, which stretches both axes increasingly toward the poles (the
same effect behind "Mercator makes Greenland look as big as Africa").
Switching projection was the actual fix; getting the *default view* right
around that switch took three more rounds after the projection itself
landed, each caught by the user actually running the app.

**Round 1 -- the projection swap itself.** `project()`/`unproject()`
rewritten to real spherical Web Mercator, with the standard ±85.0511°
latitude clip (Google/OSM/Mapbox's own convention -- true Mercator sends
the poles to infinity). `WORLD_HEIGHT` changed from `1000` (the old 2:1
ratio matching equirect's natural 360:180 range) to `2000`, square,
matching Mercator's own conformal base aspect -- confirmed via the
existing Vitest suite (`timelineResolver.test.ts`), which calls the real
`project()`/`focusOnBounds` to build its own expected values rather than
hardcoding numbers, so it kept passing unmodified as a live regression
check through every round below.

**Round 2 -- Antarctica ballooned the default view, first attempt failed.**
Once Mercator was in, Antarctica's real ~-63°..-85° span visually
dominated the whole default view (Mercator's scale grows as
~1/cos(latitude)). First attempt: a `focusOnBounds`-derived
`worldViewCamera` targeting a tighter ±75° default latitude band. Verified
directly in the running app that this had **zero effect** -- `WORLD_WIDTH
=== WORLD_HEIGHT` (required for undistorted Mercator) meant
`applyViewFit`'s contain-fit always pinned the width-fit zoom at exactly
`1` regardless of the latitude band chosen, since the bounds always kept
the full 360° of longitude; tightening latitude only ever increased the
*height*-fit zoom, which `focusOnBounds`'s `min()` never picks. No
latitude value could have fixed it -- confirmed by re-deriving the
`focusOnBounds` math, not just re-guessing a different number.

**Round 3 -- cover-fit, verified against real Google Maps.** Checked
Google's own actual behavior via chrome-devtools rather than assuming:
at Google's maximum zoom-out, the "Zoom out" button is already disabled
-- they never offer a view showing pole-to-pole at once; the map fills
the window's width completely and crops latitude, panning reveals the
rest. Reworked `applyViewFit` (`worldRenderer.ts`) from "contain"
(`Math.min`, pad the shorter axis with letterbox/pillarbox) to "cover"
(`Math.max`, crop the shorter axis, fill the canvas completely) -- the
same `background-size: cover` pattern every real map library uses for its
base layer. `viewW`/`viewH` become exactly the canvas size;
`letterboxX`/`letterboxY` become permanently `0` (verified both only ever
consumed as additive offsets in two places, both harmless no-ops at
zero). This also made Round 2's `worldViewCamera` machinery provably
pointless (re-derived: keeping full longitude width still pins the
width-fit zoom at exactly 1 either way) -- reverted back to a simple
shared `{x:0, y:0, zoom:MIN_ZOOM}` helper, still fixing the original
"four independently-duplicated literals" across `MapCanvas.tsx`/
`timelineResolver.ts`, just without the dead-end bounds projection.

**Round 4 -- cover-fit broke panning at the default zoom.** User caught
this immediately after Round 3 shipped: dragging did nothing at the
default view. Root cause: `camera.ts`'s `clampCamera` hard-locks `x`/`y`
to `(0,0)` whenever `zoom === MIN_ZOOM`, built on the old contain-fit
invariant "content exactly matches the screen at zoom 1" -- no longer true
under cover-fit, where content can legitimately exceed the viewport on
the cropped axis even at the zoom floor. Confirmed the fix target by
dragging real Google Maps at its own max zoom-out (synthetic pointerdown/
move/up events) -- it panned freely and revealed Antarctica, only
zooming out further was disabled. Fixed with a single internal formula
change in `clampCamera`: `contentBase = Math.max(screenWidth,
screenHeight)` (exact, not approximate -- re-derived from
`applyViewFit`'s own cover-fit math) instead of treating `screenWidth`/
`screenHeight` as the content size independently per axis. No signature
change, no call-site updates anywhere -- every caller already passed the
right viewport dimensions.

**Round 5 -- a second, unrelated Antarctica seam.** Once zoomed in close
enough to notice (only possible after panning worked again), a thin
diagonal line was visible cutting across Antarctica's coastline near
±180° longitude -- different from the earlier-fixed horizontal
polar-closure-ring line. First hypothesis (multiple back-and-forth
antimeridian crossings producing an orphaned middle piece in
`splitAtAntimeridian`) was disproven by running the real function against
the real vendored data (both `land`/`countries` datasets, both `50m`/
`10m`) via a throwaway script: Antarctica's ring crosses the antimeridian
exactly once everywhere, and the existing split+merge logic reconstructs
it correctly. The real cause: that single merged piece's own closing edge
*is* the true, correct coastline connection (Antarctica sweeps the pole,
touching the dateline once) -- but on a flat, non-wrapping projection, a
real ~0.4° connection projects to a chord spanning ~1998 of the map's
2000-unit width. Measured concretely via the same script: closing edge
runs `(179.622°,-84.268°)` (x≈1997.9) to `(-180°,-84.352°)` (x≈0).

New `closePolarWrap()` (`render.ts`) routes that closing edge along the
map's own bottom border instead -- out to the nearest edge, down to the
pole (`project()`'s own clamp naturally pulls this to the real render
boundary), across, then the existing auto-close finishes it -- instead of
a diagonal chord through the middle. Gated on "every point of this piece
sits past ±60° latitude" so Russia/Fiji/the USA's own (much smaller,
already-accepted) antimeridian imprecision is never touched. Deliberately
applied only inside `fillGeometry`/`strokeGeometry`, not folded into
`splitAtAntimeridian` itself, since that function is also used by
`entities.ts` for `computeArea`/point-in-polygon hit-testing, where the
extra boundary points would wrongly inflate Antarctica's computed area
and hit-test region. Verified with the same throwaway-script approach:
confirmed the ~1998-wide chord is gone (replaced by a bottom-border-
hugging edge sitting at `y = WORLD_HEIGHT` exactly), and confirmed
Russia/Fiji never trigger the new path at all.

**Final verification pass**, once the user confirmed the default view
looked right: checked every remaining item from an honest "what have I
NOT actually verified" list via chrome-devtools against the real running
app (not just reasoning) -- hit-testing (clicked Canada, highlighted
correctly), a scripted Pan-to-Japan flight (Van Wijk & Nuij tween landed
correctly), the 9:16 export ratio (fills edge-to-edge, no letterbox), and
the 10m LOD swap + state borders at high zoom (both render correctly).
No console errors through any of it.

### Changes

**`src/map/render.ts`**
- `WORLD_HEIGHT`: `1000` -> `2000`. New `MAX_MERCATOR_LAT = 85.0511287798`.
- `project()`/`unproject()`: linear equirect formulas replaced with real
  spherical Web Mercator (clamped latitude in, Gudermannian-based inverse
  out).
- New `worldViewCamera()` -- shared `{x:0, y:0, zoom:MIN_ZOOM}` helper
  (after the Round 2 `focusOnBounds`/`WORLD_VIEW_BOUNDS` attempt was
  reverted as pointless), replacing four independently-hardcoded literals
  across `MapCanvas.tsx`/`timelineResolver.ts`.
- New `closePolarWrap()`, applied inside `fillGeometry`/`strokeGeometry`
  only (not `splitAtAntimeridian` itself) -- routes a confirmed-polar
  piece's antimeridian closing edge along the map's bottom border instead
  of a direct diagonal chord.

**`src/map/worldRenderer.ts`**
- `applyViewFit`: contain-fit (`Math.min`, letterbox) -> cover-fit
  (`Math.max`, fills canvas exactly, crops instead of padding).

**`src/map/camera.ts`**
- `clampCamera`: `contentBase = Math.max(screenWidth, screenHeight)` used
  for both axes' content size, instead of `screenWidth`/`screenHeight`
  independently -- fixes panning being locked at `zoom === MIN_ZOOM` under
  cover-fit.

**`src/map/MapCanvas.tsx` / `src/map/timelineResolver.ts`**
- Four `{x:0, y:0, zoom:MIN_ZOOM...}` call sites (initial camera, "Pan to
  World", "Start from world view" glide-start, export/resolver fallback)
  switched to the shared `worldViewCamera()`.

### Decisions
- **Cover-fit, not contain-fit, for the world viewport** -- confirmed
  against real Google Maps behavior via devtools rather than assumed;
  matches every other web map library's convention for its base layer.
- **`closePolarWrap` lives in the rendering functions only, not
  `splitAtAntimeridian`** -- that function has other consumers
  (`entities.ts`'s area calc and hit-testing) that would be actively
  broken by the extra boundary points, even though the rendering fix is
  correct for the visual case.
- **Ordinary (non-polar) antimeridian crossings deliberately left
  untouched.** Russia/Fiji/the USA's own seam imprecision is real but
  small and already documented as an accepted trade-off (from an earlier
  session) -- the polar-specific fix here is gated (±60° latitude check)
  to never touch them.
- **Every round verified against the real running app or real Google
  Maps, not reasoned through in the abstract** -- Round 2's dead end was
  caught by direct inspection before it was presented as done; Round 4
  and Round 5's fixes were each confirmed against actual Google Maps
  devtools behavior first, then verified against the app's own real data
  via throwaway scripts, not just code review.

### Deferred / not yet implemented
- A real file export (actual Tauri shell) still hasn't been run this
  session -- same recurring sandbox limitation as every prior export/map
  entry. The export code path was confirmed identical to the live
  rendering path that was verified, but the actual sidecar/ffmpeg
  round-trip is untested here.

---

## 2026-08-25 — Bug fix: stray filled line below Antarctica

### Summary
User spotted a thin filled line running horizontally right below Antarctica
in the map and asked why -- investigated read-only first. Traced it to
`splitAtAntimeridian` (`src/map/render.ts`, added in an earlier session to
stop a handful of Natural Earth polygons -- Russia's Chukotka peninsula,
Fiji, Antarctica's own polar closure -- from rendering as a stray line
across the whole map when their ring data jumps from ~+180 to ~-180
longitude). Confirmed concretely by pulling Antarctica's actual ring data
out of `world-atlas/countries-50m.json`: one of its polygon elements has
*two* rings -- a real 2539-point coastline (lat -63 to -85) and a separate
257-point "ring" that isn't coastline at all, just a full sweep across every
longitude at a constant latitude of -89.999 (i.e. Natural Earth's own
technical closure sealing the polygon shut along the map's flat southern
edge). That degenerate ring was being drawn and filled like any other ring,
producing the visible sliver.

First fix attempt skipped the *entire* polygon element whenever its first
ring was this synthetic closure -- removed the line, but on reflection (and
before telling the user it was done) realized this also silently discarded
the real 2539-point coastline ring bundled into the same element, alongside
the bogus one. Corrected to filter out only the synthetic ring itself
before assigning fill/cut roles to whatever's left, so the real coastline
in that element still renders. Verified in-browser (chrome-devtools): the
line is gone at world view, and zooming into Antarctica directly shows a
properly jagged, detailed coastline with no artifact -- confirmed the
remaining "blockier than Google Maps" look at world-zoom is just this app's
existing zoom-based LOD system (coarser data at low zoom, same as every
other country), not a bug, by comparing the coarse world-view shape against
the same region zoomed in.

### Changes

**`src/map/render.ts`**
- New `isPolarClosureRing(ring)` + `POLE_LAT_EPSILON = 0.01` -- detects a
  ring whose every point sits within 0.01° of true polar latitude (±90°).
  Generic, not Antarctica-specific by name: confirmed no legitimate ring
  anywhere else in the vendored data (Fiji, Russia) comes anywhere close to
  that threshold, so it can't misfire on a real antimeridian crossing.
- `fillGeometry`: now filters a polygon's rings through
  `isPolarClosureRing` before running the existing ringIndex-based fill/cut
  logic (first remaining ring = fill, rest = cut/holes), instead of the
  original code's fixed assumption that ring index 0 is always the real
  exterior boundary. Skips the whole polygon element only if *every* ring
  turns out to be synthetic (nothing left to draw).
- `strokeGeometry`: same `isPolarClosureRing` skip per-ring, so the
  synthetic ring doesn't get an outline stroke either.

### Decisions
- **Filter the ring out before assigning fill/cut roles, not skip the whole
  polygon element.** The first, simpler fix (skip the whole element)
  actually worked to remove the line, but at the cost of losing real
  coastline detail that happened to be packaged in the same polygon element
  as the synthetic ring -- caught by reasoning through *why* the shape still
  looked cruder than expected after the first fix, not because it was
  visibly broken.
- **Detected generically by latitude, not by feature name/ID.** Keeps the
  fix correct for any other Natural Earth feature that might have the same
  polar-closure quirk, without hardcoding "Antarctica" anywhere.

### Deferred / not yet implemented
- World-view zoom still renders coastlines (Antarctica included) at a
  visibly coarser resolution than Google Maps' equivalent low-zoom tiles --
  confirmed this is the existing zoom-based LOD system working as designed
  (every country simplifies at low zoom, not just Antarctica), not a bug.
  Raising the base/world-view LOD resolution is a separate performance
  tradeoff, not pursued this pass.

---

## 2026-08-25 — Unified Play/scrub for scene + audio tracks

### Summary
Direct follow-on to the reference-audio entry below: once a story had both
scenes and an audio clip, previewing them together required clicking two
separate Play buttons (video Play/Pause, a standalone "▶ Audio" button) --
practically impossible to trigger at the same instant by hand. Discussed
the fix with the user before coding (`EnterPlanMode`): one shared Play
control and one shared scrub playhead spanning both tracks, like a normal
video editor, while respecting that scene/camera playback -- unlike
audio -- can't be scrubbed to an arbitrary mid-point (`jumpToScene` only
ever snaps to a scene's *start*; there's no mid-scene seek anywhere in the
live path). Landed on: scrubbing floors to the containing scene's start
(never skips ahead of the drop point), and if video/audio have different
total lengths each keeps playing independently until it individually
finishes -- confirmed explicitly with the user rather than assumed.

Iterated several more rounds after the initial merge shipped, each a
direct user report against the running app: the scrub line needed to
actually be draggable, not just click-to-seek; dragging turned out to
re-snap (and re-dispatch the scene + jump audio) on *every pointer move*,
which pinned the visible line at the current scene's start for as long as
the pointer stayed inside it instead of sliding -- fixed by separating
live visual tracking during a drag from the actual snap-and-commit, which
now only happens once, on release. Also fixed dragging selecting the
scene blocks' text underneath (`user-select: none`, plus a
`preventDefault()` belt-and-braces for the race where native selection
starts before the CSS applies), gave the toggle/Play/Export row a visual
pass (reordered, animated switch, icon-only buttons) per direct
before/after screenshots the user shared, and reshaped the playhead from
a plain line into a video-editor-style pin (flag head + thin shaft,
extended up to touch the ruler's timestamps) against a reference image.

### Changes

**`src/map/sceneStore.ts`**
- New `currentSceneStartedAt: number | null` -- wall-clock ms timestamp of
  the current scene's most recent dispatch, set in `playFrom` on every
  dispatch and cleared on `pause`/`jumpToScene`/end-of-playback. The one
  piece of state `currentSceneIndex` alone didn't carry: not just *which*
  scene is current, but how far into it playback actually is, which the
  shared playhead needs to draw a continuously moving line instead of one
  that only jumps at scene boundaries.

**`src/map/timelineLayout.ts`**
- New `cumulativeSceneStart(scenes, index)` and `sceneIndexAtTime(scenes,
  t)` pure helpers, shared by both the scrub-seek snapping logic and the
  live progress calculation -- `sceneIndexAtTime` floors to the scene
  containing `t`, matching the approved "never skip ahead of the drop
  point" rule.

**`src/map/Timeline.tsx`**
- Merged the video Play/Pause and the old standalone Audio button into one
  `togglePlayback` -- starts/pauses `sceneStore.play()`/`pause()` and the
  `<audio>` element together. Disabled only when there are neither scenes
  nor an audio clip (previously gated on scenes alone, which blocked
  audio-only preview before any scene existed).
- New `sharedPlayheadSeconds` state driven by a `requestAnimationFrame`
  loop (reading fresh `useSceneStore.getState()` each frame, not a stale
  closure) that follows scene-elapsed time while a scene is playing, hands
  off to `audio.currentTime` once scene playback stops but audio is still
  going, and otherwise holds still at wherever it was last scrubbed/jumped
  to -- exactly the "each keeps playing independently" behavior agreed on.
- New unified `seekToTime`/`seekToSceneIndex`: snaps to the containing
  scene's start via `jumpToScene`, then syncs `audio.currentTime` to that
  same instant. Wired to the waveform's click-to-seek and each scene
  block's click (both previously separate, unsynced seeks).
- New drag-to-scrub on the playhead itself (`startPlayheadDrag`/
  `onPlayheadDragMove`/`endPlayheadDrag`, pointer-capture based, same
  pattern the existing resize-handle drag already used). Deliberately
  does *not* call `seekToTime` on every move -- that would re-jump the
  scene/audio on every pixel and pin the line at the current scene's start
  the whole time the pointer is inside it. Instead the line follows the
  raw cursor position in real time during the drag, and the actual
  scene-jump + audio-sync snap happens once, on `pointerup`.
- Reordered the top row to toggle → Play/Pause → Export (previously
  Play → toggle → Export), all three (plus Export's progress/cancel/
  status) now sharing one `.timeline-controls-row` instead of three
  stacked rows.
- Play/Pause and Export are now icon-only (inline SVG: play triangle/pause
  bars, an arrow-into-tray export glyph) instead of text labels, each with
  `aria-label`/`title` since there's no visible text. "Start from world
  view" is now an animated switch (checkbox kept for semantics/keyboard,
  visually replaced by a sliding track+thumb) instead of a native
  checkbox.

**`src/map/AudioWaveform.tsx`**
- Dropped the component's own playhead-line drawing (`playheadFraction`
  prop and the line-drawing block) -- the shared line now renders once in
  `Timeline.tsx`, layered across both tracks, instead of a separate line
  per track.

**`src/map/Timeline.css`**
- `.timeline-tracks` wrapper (`position: relative`) as the positioning
  context for the new `.timeline-shared-playhead`, which extends 24px
  above its own box (matching `TimelineRuler.css`'s ruler height) so the
  pin reaches the timestamp labels rather than stopping at the track's
  edge.
- Playhead redesigned as a small amber (`#e8a33d`) flag-shaped pin
  (rectangle + downward triangle point) atop a thin shaft, replacing the
  original plain off-white line, against a reference screenshot the user
  shared.
- `user-select: none` moved up to `.timeline-scroll-area` (covers the
  ruler too, a sibling `.timeline-tracks` alone didn't reach) so dragging
  the playhead no longer selects scene-block text or ruler timestamps
  underneath it.
- New `.timeline-controls-row`/`.timeline-icon-btn`/`.timeline-toggle-*`
  rules for the reordered row, icon buttons, and animated switch; removed
  the now-unused `.timeline-playback-toggle`/`.timeline-export-btn` text-
  button rules they replaced.

### Decisions
- **Floor-to-scene-start scrubbing, not nearest-boundary.** Confirmed
  explicitly with the user (`AskUserQuestion`) rather than assumed --
  dragging into the middle of a scene should never jump *past* the drop
  point.
- **Video and audio each keep playing independently past the other's
  end**, not cut off at the shorter one -- also confirmed explicitly.
  Verified in-browser (synthetic 12s audio clip injected directly into
  `audioStore` via a dev-console dynamic import, since the file picker
  itself needs the real Tauri shell -- same sandbox limitation as prior
  sessions): the shared line tracked scene-elapsed time smoothly for the
  first 7s of a 3s+4s story, then handed off to `audio.currentTime`
  seamlessly through to 12s with no discontinuity.
- **Drag updates the visual position live but only commits (scene jump +
  audio sync) on release**, not on every `pointermove` -- the first
  attempt re-snapped on every move, which visibly failed to slide (the
  reported bug this fixes); separating "where the line is drawn" from
  "when the actual seek happens" was the fix, not a snapping-algorithm
  change.
- **Icon-only Play/Export via inline SVG, no icon library** -- consistent
  with the rest of the codebase's "no new dependency for something a
  ~10-line inline implementation covers" pattern (same reasoning as the
  Web Audio API waveform decode in the entry below).

### Deferred / not yet implemented
- Real end-to-end verification with an actual picked audio file (not the
  synthetic in-console injection used here) -- deferred to the user's own
  machine, same recurring sandbox limitation (no real Tauri launch here)
  as every export/audio entry below.

---

## 2026-08-24 — Reference audio track in Timeline (+ two timeline layout bugs)

### Summary
User asked whether audio in the timeline would help; discussed it and landed
somewhere more useful than "mux music into the export" -- a single
reference audio clip (voiceover/music) loaded into the Timeline as a
**visual + audible reference** for timing scene durations against, since
there was previously no way to see or hear where a beat/line falls while
authoring. Scoped down across a few rounds with the user: one clip only (no
multi-clip/SFX tracks -- explicitly future work), no live-playback sync
(Play/preview stays exactly as it is today; the clip's own play/pause/seek
is independent -- `sceneStore.ts`'s `playFrom` has no shared clock to hook
one into, and building one was ruled out of scope), waveform decoded
client-side via the Web Audio API (no new charting dependency), and --
after first scoping export-muxing as optional -- folded into this same pass
once discussed, since ffmpeg already supports a second input almost for
free. Planned via `EnterPlanMode` before implementation, as usual for
work this size.

### Changes

**New Tauri capability -- reading a local file's bytes**
- Added `tauri-plugin-fs` (`Cargo.toml`, registered in `lib.rs`,
  `"fs:default"` in `capabilities/default.json`, `@tauri-apps/plugin-fs` in
  `package.json`) -- the app's first filesystem-read capability. ffmpeg
  itself never touches these bytes; it opens the picked file directly by
  path, the same way `output_path` already worked -- bytes in JS are only
  needed for the `<audio>` preview element and the waveform decode.
  Dialog-picked paths get automatic fs-read scope from Tauri v2's
  dialog+fs integration, so no static filesystem scope was needed.

**New `src/map/audioStore.ts`**
- Picks one file via `@tauri-apps/plugin-dialog`'s `open()` (the first
  `open()` call in the codebase -- only `save()` existed before, for
  export's output path), reads it via `readFile()`, decodes it with
  `AudioContext.decodeAudioData()` for duration, downsamples the channel
  data into a fixed 800-peak array (same "fixed target count, not one
  sample per pixel" idea `timelineLayout.ts`'s `pickTickInterval` already
  uses for ruler ticks), and builds an object URL for playback. Its own
  store, mirroring `exportStore.ts`'s separation rationale -- a distinct,
  self-contained async load/decode concern, not scene data.

**New `src/map/AudioWaveform.tsx`**
- Small canvas component: draws the peaks array as bars plus a playhead
  line, redrawing on peaks/playhead change.

**`Timeline.tsx` / `Timeline.css`**
- New audio-track row: add/remove the clip, click-to-seek anywhere on the
  waveform bar, playhead driven by the `<audio>` element's `timeupdate` --
  entirely independent of Play/live camera playback.

**Export muxing**
- `exportStore.ts`/`exportPipeline.ts`: the clip's file path is snapshotted
  at Export-click time (same one-time-snapshot pattern already used for
  `showStateBorders`/`entities`/`profile`) and threaded through as
  `ExportSettings.audioPath`.
- `export.rs`: `start_export` gains an optional `audio_path`; when present,
  adds it as ffmpeg input 1 with explicit `-map 0:v:0 -map 1:a:0 -c:a aac
  -b:a 192k`; when absent, the command is byte-for-byte what it was before.
  Deliberately no `-shortest` -- per the user's explicit call, a shorter
  clip just plays out and the video continues silently after (ffmpeg's own
  default behavior, no flag needed); a longer clip is left unhandled for
  this pass.

**Two follow-up UI fixes, requested after first landing**
- Moved the audio play/pause toggle out of the waveform row -- removing
  the filename text and inline circular play button that were pushing the
  waveform bar visually out of alignment with the ruler/scene track above
  it -- into the Export row instead, reusing `.timeline-export-btn`'s exact
  class so it sits inline at the same size right after Export, not the
  accidental full-width bar it first rendered as (a flex-column stretch
  default it hadn't been opted out of).
- Two layout bugs surfaced once the timeline had enough scenes to actually
  scroll:
  1. **Scene blocks compressing instead of the track scrolling.**
     `.timeline-block` had no `flex-shrink: 0`, so once total scene
     duration exceeded the panel's own width, every block got
     proportionally squeezed below its real `duration * PIXELS_PER_SECOND`
     width instead of the track legitimately overflowing (which
     `.editor-timeline`'s existing `overflow: auto` was already there
     for). Root cause: `.timeline-track`/`.timeline-audio-row` are flex
     items of `.timeline-panel` (a column flex container), whose default
     cross-axis stretch pinned their own width to the panel's visible
     width. Fixed with `align-self: flex-start` on both rows plus
     `flex-shrink: 0` on `.timeline-block`.
  2. **Controls scrolling away with the timeline.** Once the timeline did
     scroll horizontally, the whole panel -- Play/Export/Audio buttons
     included -- scrolled together with the ruler/track, since they were
     all one horizontally-overflowing flex row. Fixed by wrapping the
     ruler + track + audio row in a new `.timeline-scroll-area` div with
     its own `overflow-x: auto`, so the controls above stay fixed in view
     during a horizontal scroll.

### Decisions
- **One audio track, reference-only, no live-playback sync** -- explicit
  user scoping across a few rounds of discussion; multi-clip/SFX tracks
  and camera-sync playback both deferred, not rejected.
- **Web Audio API decode over a waveform library** -- no new dependency,
  the browser API already covers exactly what's needed.
- **Export muxing folded into this same pass, not deferred** -- once
  discussed, ffmpeg already supporting a second input made it a small
  addition rather than a separate effort.
- **No `-shortest` ffmpeg flag** -- matches the user's explicit call:
  audio shorter than the video just plays out (ffmpeg's own default,
  nothing to build); audio longer than the video is intentionally left
  unhandled this pass.

### Deferred / not yet implemented
- Multiple/positionable audio clips, SFX/other tracks.
- Live-playback (Play button) audio sync with scripted camera pans --
  would need a shared clock the playback engine doesn't have today.
- Audio-longer-than-video export behavior -- left as ffmpeg's unmodified
  default, not specially handled.
- Real end-to-end verification (pick a file, hear it play/seek, run an
  export with audio attached, `ffprobe` the result) deferred to the user's
  own machine -- same sandbox limitation as prior export work.

---

## 2026-08-24 — Bug fix: exported frames mis-centered in non-16:9 aspect ratios

### Summary
User noticed, once exporting real 9:16 videos, that the zoomed/highlighted
entity consistently rendered near the bottom of the frame (Chile:
bottom-right) instead of centered -- reproduced across four separate
examples (Australia, Singapore, Venezuela, Chile). Investigated read-only
first, no code changes, before touching anything, per the user's own
request.

Root cause found in `exportPipeline.ts`'s `renderFrame`: it called
`resolveAt(..., width, height, ...)` with the raw export canvas
dimensions, not `scene.viewW`/`scene.viewH` (the letterboxed,
contain-fitted world frame that `focusOnBounds`/`clampCamera`/`tweenCamera`
are meant to operate in) -- exactly what `MapCanvas.tsx`'s live
`onFocusRequest` already does correctly. `scene.applyCamera()` then
separately added `letterboxX`/`letterboxY` on top, double-counting the
offset. Worked through the algebra and confirmed the error comes out to
exactly `+letterboxY`: harmless at 1920x1080 (~60px, easy to never notice)
but ~690px -- about a third of the frame -- at 1080x1920. A pre-existing
bug from the original export work, only made visible once 9:16 export
existed.

Separately investigated, but left unfixed per the user's explicit call
("rare case"): Chile's and Australia's country polygons in the underlying
dataset include far-flung external territories (Easter Island for Chile,
~109°W; Macquarie Island for Australia, ~55°S) -- confirmed by computing
their actual bounding boxes directly from the topojson data via a Node
script. That drags `computeFramingBounds`'s center out toward those
islands, pushing the mainland toward the frame's edge even with perfectly
correct centering math. A different root cause (bad framing input, not a
math bug) -- left as a cosmetic edge case affecting only countries with
such territories baked into the same polygon.

### Changes

**`src/map/exportPipeline.ts`**
- `renderFrame` now passes `scene.viewW`/`scene.viewH` into `resolveAt`
  instead of the raw canvas `width`/`height`.

### Decisions
- **Diagnosed via direct measurement before touching code** -- browser
  pixel inspection, reading Pixi's own `ResizePlugin` source, and a Node
  script computing real country bounding boxes from the topojson data --
  after an earlier hypothesis (a camera-clamp mismatch) didn't hold up
  under scrutiny.
- **Left the outlier-territory bounding-box issue unfixed**, confirmed
  explicitly with the user as a rare/cosmetic case rather than assumed.

### Deferred / not yet implemented
- Country framing bounds pulled off-center by included external
  territories (Chile/Australia, and presumably others with similar
  overseas territories baked into the same polygon) -- would need
  excluding known outliers or a mainland-only bounding box; not pursued.

---

## 2026-08-23 — Export aspect ratio picker (9:16/16:9) + live canvas now reshapes to match

### Summary
User-requested, building on the export feature above: a way to choose the
export's aspect ratio, defaulting to 9:16 (YouTube Shorts) rather than the
export always being fixed at 1920x1080 landscape. Planned with the user
before coding (design discussion, then a plan-mode writeup) around a
reference UI screenshot -- a segmented ratio toggle followed by a small
output summary readout. Scope was narrowed with the user across a few
rounds: just two ratios for this pass (9:16 default, 16:9), the picker sits
persistently above the existing "Show state borders on zoom" checkbox in
the Instruction Builder (not a popover on the Export button), and the
summary shows only ratio + resolution (no duration/quality -- confirmed
those were just illustrative in the reference image).

Initial research (before writing any code) confirmed the camera/rendering
math (`focusOnBounds`, `tweenCamera`, `applyViewFit`) was already fully
aspect-ratio-agnostic -- every function takes `screenWidth`/`screenHeight`
as plain params and does per-axis min-fit -- so wiring the chosen ratio
through to the export renderer needed no changes there, only replacing two
hardcoded constants in `exportStore.ts`.

After that piece shipped and was verified working (picker renders, toggles,
summary updates, `tsc` clean), the user pointed out the actual goal: **the
live map preview itself should reshape to the chosen ratio**, not just
silently change what a future Export click would produce. Confirmed with
the user this meant literally resizing the on-screen canvas area (a tall
centered strip for 9:16, letterboxed on both sides) rather than an overlay
crop-guide drawn on top of the unchanged full-bleed canvas.

Building that exposed a real, previously-latent bug: `MapCanvas.tsx` passes
`resizeTo: container` to Pixi's `Application.init`, and the in-code comment
above it claimed this "auto-observes container's size (ResizeObserver under
the hood)" -- read Pixi's own `ResizePlugin` source to check, since the new
ratio-driven resize wasn't taking effect, and that assumption turned out to
be wrong: `resizeTo` only re-measures on the **browser window's** `"resize"`
event, with no observer on the container element itself. It had worked
correctly for every resize case so far (window resize, resize-reclamp) only
because every prior resize source *was* a window resize -- this is the
first case where the container's size changes for a purely-layout reason
(React re-rendering it to a new size) with the window itself untouched, and
that gap had simply never been exercised before.

Verified in-browser via chrome-devtools automation (the real Tauri app
still can't launch in this sandbox -- see the entry above): confirmed via
`getBoundingClientRect()`/canvas-attribute inspection that the ratio-picker
change alone left the outer `<div>` resizing correctly while the actual
`<canvas>` pixel buffer stayed stale, isolating the bug to Pixi's resize
detection specifically rather than the new layout/store code; after the
fix, screenshotted both ratios and confirmed the canvas genuinely reshapes
(tall centered strip for 9:16, wide strip for 16:9), content re-fits with
no stretching, and toggling back and forth repeatedly stays clean with no
new console errors beyond the pre-existing documented ones (state-entity
warnings, the WebGL buffer-size warning from the entry two above).

### Changes

**`src/map/exportStore.ts`**
- Removed hardcoded `EXPORT_WIDTH = 1920`/`EXPORT_HEIGHT = 1080`. Added
  `ExportRatio = "9:16" | "16:9"`, an `ExportProfile` shape, and an exported
  `EXPORT_PROFILES` map (`"9:16"` -> 1080x1920, `"16:9"` -> 1920x1080) so
  the UI can iterate/look up without a second hardcoded literal anywhere.
- New `selectedProfile: ExportRatio` (default `"9:16"`) +
  `setSelectedProfile` on the store -- passive shared state between the
  picker (`InstructionBuilder.tsx`) and the click site (`startExport`,
  called from `Timeline.tsx`), the same category `showStateBorders` already
  occupies in `interactionStore`, chosen specifically so `startExport`'s
  signature stays unchanged and `Timeline.tsx` needs zero changes.
- `startExport` now reads `EXPORT_PROFILES[get().selectedProfile]` once,
  alongside the existing `showStateBorders`/`entities` snapshot, and passes
  its `width`/`height` into the `runExport` settings object instead of the
  removed constants. `EXPORT_FPS` untouched -- orthogonal to dimensions.

**`src/map/InstructionBuilder.tsx` / `.css`**
- New "Export Aspect Ratio" block, first child of `.zone`, above the
  state-borders checkbox: a two-button segmented toggle (one per
  `EXPORT_PROFILES` entry) plus a summary line (`"9:16 · 1080x1920"`). New
  `.ib-ratio-*` CSS classes follow the file's existing dark palette/naming
  convention, reusing the `#5b8def` accent already used for
  `.timeline-block-active` for the selected segment.

**`src/map/MapStage.tsx` (new)**
- Wraps `MapCanvas` and contain-fits its container to the selected export
  profile's ratio within whatever space is actually available, using the
  same `min(scaleX, scaleY)` approach `worldRenderer.ts`'s `applyViewFit`
  already uses internally -- not CSS `aspect-ratio` alone, since a pure-CSS
  contain-fit-within-an-unknown-box (portrait ratio in a landscape area or
  vice versa, either axis potentially the limiting one) has no clean
  solution without JS measurement (verified/reasoned through explicitly
  before writing this, see Decisions). Measures its wrapper via
  `ResizeObserver` + an initial `getBoundingClientRect()` (avoids a 0x0
  flash before the observer's first callback), recomputing on every
  `selectedProfile` change since the store subscription re-renders it.

**`src/App.tsx` / `App.css`**
- `.editor-map` now renders `<MapStage />` instead of `<MapCanvas />`
  directly, gains a `background: #181a1f` (matches the other panels' bg)
  so the letterboxed area around a non-full-bleed canvas isn't a white
  flash. New `.map-stage-wrapper` (flex-centers the ratio-constrained box)
  and `.map-stage` (the sized box itself) rules.

**`src/map/MapCanvas.tsx`**
- New `ResizeObserver` on `container` (the div Pixi's `resizeTo` already
  targets), calling `app.resize()` on every observed size change --
  `AbstractRenderer.resize()` (confirmed by reading Pixi's own source)
  still emits the same `"resize"` event the existing `onResize` handler
  already listens for, so this required no changes to that handler, the
  camera-reclamp logic, or the label-declutter scheduling it triggers.
  Disconnected in the effect's existing cleanup, alongside the other
  subscriptions.

### Decisions
- **Resize the live canvas itself, not an overlay crop guide.** Confirmed
  explicitly with the user (two concrete options put forward) rather than
  assumed -- "what you see while authoring is what gets exported" was the
  actual goal behind asking for a ratio picker at all, not just changing
  an otherwise-invisible export setting.
- **`selectedProfile` lives in `exportStore`, not local component state or
  `interactionStore`.** Reasoned via the same test the codebase already
  applies to `showStateBorders`: does anything *imperative* (per-frame,
  outside React) need to read it? No -- only `startExport`, at click-time.
  But unlike `duration`/`zoomPercent`/other purely-local Instruction
  Builder fields, it also needs to reach `MapStage.tsx`, a sibling
  component -- ruling out plain local `useState`. `exportStore` was the
  correct existing shared substrate for exactly that shape of state,
  without introducing prop drilling or a new store.
- **JS-measured contain-fit (`ResizeObserver` + `min(scaleX,scaleY)`), not
  CSS `aspect-ratio`.** Worked through the CSS-only approaches concretely
  before writing code and rejected them: `aspect-ratio` only resolves an
  *auto* dimension from a fixed one, so within a flex/grid cell of unknown,
  possibly-either-axis-limiting size (portrait content in a landscape cell
  or vice versa), there's no combination of `width`/`height`/`max-width`/
  `max-height` that contains correctly on both axes without JS measurement
  -- `object-fit` doesn't apply either, since it only affects *replaced*
  content's internal scaling, not the sizing of the box itself, and the
  box here isn't a replaced element regardless. Reused the exact same
  `min(scaleX, scaleY)` formula `worldRenderer.ts` already uses for the
  analogous "fit ratio-constrained content into an available box" problem,
  rather than inventing a second approach for the same shape of problem.
- **Fixed Pixi's resize-detection gap at the source (`MapCanvas.tsx`'s own
  `ResizeObserver`), not by working around it in `MapStage.tsx`.** Once
  Pixi's `resizeTo` was confirmed (by reading its actual source, not
  re-trusting the existing comment) to only listen for window resizes, the
  alternative considered was having `MapStage.tsx` imperatively poke
  `MapCanvas` somehow after a resize -- rejected as a leaky, one-off
  workaround for what is really a general gap in `MapCanvas.tsx`'s own
  resize handling that would bite the *next* thing to resize the container
  for a non-window reason too, not just this feature.

### Deferred / not yet implemented
- Only 9:16 and 16:9 -- the reference screenshot showed a fuller set
  (Auto, 3:4, 1:1, 4:3, 21:9); explicitly descoped to two for this pass,
  same segmented-toggle/`EXPORT_PROFILES` shape extends cleanly if more are
  added later.
- Resolution is fixed per ratio (1080x1920 / 1920x1080), not independently
  user-selectable -- explicitly descoped, per the user's own read of their
  reference screenshot ("the quality and time in seconds was just to
  explain how UI should be").
- Real end-to-end export-and-play verification at each ratio (an actual
  exported file, `ffprobe`'d and played back) not yet done this session --
  same sandbox limitation as the export feature above (no real Tauri
  launch here). The picker/live-preview UI was verified thoroughly; the
  actual export codepath for a non-default ratio was reasoned through
  (fully generic width/height plumbing, confirmed unchanged) but not run
  end-to-end against the real ffmpeg sidecar.

---

## 2026-08-23 — Deterministic video export (Phases A-D) + two color bugs fixed

### Summary
User-requested: a real video export feature, built against a design doc
(`.development_logs/export.md`) that specified the goal (export must render
every frame deterministically from the scene/timeline data, completely
independent of live canvas playback -- no `requestAnimationFrame`, no
wall-clock dependence, no dropped/frozen frames regardless of machine speed)
but stopped mid-sentence right after introducing a `resolveAt(t)` signature,
with everything past that (real semantics, offscreen rendering, frame
extraction, encoding, UI) undesigned. Planned in four phases with the user
before writing any code, then implemented and verified phase by phase,
checking in after each one rather than building the whole thing blind.

Two rounds of read-only investigation up front confirmed the groundwork:
`camera.ts`'s `tweenCamera`/`focusOnBounds` were already pure and seekable
(explicit `progress: 0..1`, no DOM/wall-clock dependency) -- directly
reusable. Live playback itself was not seekable (`sceneStore.playFrom` uses
real `setTimeout`s; `MapCanvas.tsx`'s ticker computes tween progress from
`performance.now()`) -- a new resolution layer was needed. `MapCanvas.tsx`
was one ~900-line closure conflating Pixi lifecycle, scene-graph
construction, and camera application -- needed splitting so export could
reuse the same rendering logic as live instead of a diverging copy.

**Decisions locked in with the user before implementation**: ffmpeg bundled
as a Tauri sidecar (not required pre-installed); frames streamed as raw RGBA
to a persistent ffmpeg process's stdin (no intermediate PNG sequence); no
audio in scope; output fixed at 1920x1080 @ 30fps, H.264/MP4.

### Changes

**Phase A -- `resolveAt(t)` (new `src/map/timelineResolver.ts`)**
- Pure function: given `Scene[]` + an explicit timestamp `t`, returns the
  camera + highlighted entity at that instant. Precomputes each scene's
  start/end camera in one O(scenes) pass (a `"pan"` scene resolves via
  `focusOnBounds`; a scene with no camera action -- Hold, or a bare
  `clearHighlight` -- inherits the previous scene's resting camera, for
  free, matching Hold's documented semantics), then for any `t` locates the
  containing scene and calls the existing `tweenCamera` unmodified. Reuses
  `focusOnBounds`/`tweenCamera`/`computeFramingBounds` directly rather than
  going through `interactionStore`/`actionRegistry`'s event-based
  fire-and-forget handlers, which are shaped for live incremental dispatch,
  not "give me the value at time t."
- Added Vitest (no test runner existed before this) + jsdom (needed since
  `render.ts` pulls in `pixi.js`, which touches `navigator` at import time).
  16 unit tests: pans, highlights, holds, `cameraStart` both modes, zoom%,
  antimeridian framing, out-of-range/boundary `t`.
- Verified against live playback: a temporary debug hook in `MapCanvas.tsx`
  (added, used, fully removed -- confirmed zero diff after) compared
  `resolveAt`'s output against the actual on-screen camera during a real
  "Pan to France, 20s, start from world view" playback. Matched bit-for-bit
  on one sample; a second sample differed by ~1e-5 relative, traced to the
  debug hook itself taking a second, slightly later `performance.now()`
  reading than the live tween already used -- not a resolver defect.

**Phase B0 -- extracted shared rendering (new `src/map/worldRenderer.ts`)**
- `buildWorldScene()` now owns all layer construction (land, countries,
  states, rivers, lakes, labels, highlight overlay), `drawHighlights`,
  `applyCamera`, and the LOD fill logic (`setResolution`, formerly
  `applyFill`) -- extracted out of `MapCanvas.tsx`'s closure. Deliberately
  has zero dependency on `interactionStore` -- `drawHighlights`/`applyCamera`
  take explicit params instead of reading global state, so both live
  playback and export call the identical rendering code, not two diverging
  copies.
- `MapCanvas.tsx` re-wired to consume `worldScene.*` -- pointer handling,
  LOD debounce scheduling, label/state declutter, `scriptedPan`/ticker all
  stay there unchanged in behavior, now reading/writing through the
  returned `WorldScene` object.
- Verified via a full manual regression pass on the live map (chrome-devtools
  automation): wheel-zoom + LOD swap, hover, click-select highlighting, the
  state-borders toggle, Play (scripted pan+highlight), jump-to-scene/
  edit-in-place -- all identical to pre-refactor behavior. No new console
  errors, only the same pre-existing warnings already documented above.

**Phase B -- offscreen rendering spike**
- Confirmed (via a throwaway, since-deleted spike module) that a Pixi
  `Application` initialized against a `<canvas>` never attached to the DOM
  renders correctly. Found and fixed one real gap in the plan along the
  way: `renderer.extract.pixels(app.stage)` extracts the target's full
  bounding box, not the viewport -- for the whole unbounded world container
  this returned a ~14709x7324 buffer instead of the intended 1920x1080.
  Fixed by passing an explicit `frame: new Rectangle(0, 0, width, height)`.
- Rendered a real frame (Pan+Highlight to Japan, offscreen, 10m resolution)
  and visually confirmed it, then cross-checked framing/orientation against
  live playback of the same country.

**Phase C -- ffmpeg sidecar + streaming frame loop**
- Added `tauri-plugin-shell` (Rust + `@tauri-apps/plugin-shell`). Bundled
  the system's ffmpeg binary as the sidecar for local dev/testing
  (`src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu`, gitignored) -- a
  real, working binary for this machine, but explicitly **not** yet a
  portable static binary for distribution to other users' machines; that
  packaging work is still open.
- New `src-tauri/src/export.rs`: `start_export` spawns the sidecar via
  `ShellExt::sidecar` with piped stdin; `write_frame` (sync command, so
  Tauri runs it off the async runtime thread -- a slow write naturally
  backpressures without stalling anything else) writes to the child's
  stdin; `finish_export` (async) drops the child (closing stdin -> EOF ->
  ffmpeg finalizes and exits on its own, never killed) and awaits its
  `Terminated` event; `cancel_export` kills the process and removes the
  partial output file. No new capability entries needed -- the frontend
  never calls the shell plugin directly, only Rust does internally.
- New `src/map/exportPipeline.ts`: `runExportLoop` (pure orchestration --
  frame timing, cancellation, progress, UI-yielding, fully unit tested with
  fakes, zero Pixi/Tauri involved) wired to `runExport` (real offscreen
  Pixi rendering via `buildWorldScene` + real `invoke` calls). 6 unit tests
  covering frame ordering, cancellation, no-overlap sequencing, UI-yield
  calls.
- Verified the encoding mechanics directly against the real sidecar binary
  (bypassing the GUI, which wouldn't launch in this dev sandbox -- see
  Decisions): streamed 30 synthetic RGBA frames (a moving bar, so
  frame order/positioning is verifiable) through the exact ffmpeg args
  `export.rs` uses, produced a valid H.264 MP4 (`ffprobe`-confirmed
  codec/resolution/fps/duration), extracted a middle frame and confirmed
  content + RGBA byte-order were correct.

**Phase D -- UI wiring**
- New `src/map/exportStore.ts` (zustand, mirrors `sceneStore`'s existing
  separation from `interactionStore`): `status`/`currentFrame`/
  `totalFrames`/`errorMessage`; `startExport` opens a native "Save As"
  dialog (added `tauri-plugin-dialog`, Rust + JS, `dialog:default`
  capability) rather than a fixed path, captures `showStateBorders`/
  `entities` as one-time snapshots from `interactionStore` (not a live
  subscription -- export must depend only on the story definition, not on
  anything still changeable on screen), then drives `exportPipeline.ts`.
- Export button + "Frame N / total" progress + Cancel added to
  `Timeline.tsx`/`Timeline.css`, matching the existing Play/Pause toggle's
  exact convention (direct store-bound `<button>`, disabled when
  `scenes.length === 0` or already exporting).
- Verified live in the browser dev environment (real Tauri app wouldn't
  launch here, see Decisions): confirmed by grep that export code never
  imports/calls `sceneStore`; built a scene, clicked Export -- `save()`
  correctly threw (no `__TAURI_INTERNALS__` outside the real webview), the
  error was caught and surfaced in the UI rather than an unhandled
  rejection (found and fixed a real gap where `save()` was originally
  outside the try/catch -- would have been a genuine production bug, not
  just an artifact of this test environment), the app didn't crash, the
  live canvas didn't move, and Play still worked immediately after.

**Post-Phase-D bug fixes, found once the user ran the real app**

- **`write_frame` IPC signature mismatch.** First real-app run failed
  immediately: `invalid args 'bytes' for command 'write_frame': ... the IPC
  call used a bytes payload`. `exportPipeline.ts` passes the frame's
  `Uint8Array` directly as `invoke`'s whole `args` (Tauri's fast raw-binary
  IPC path, not JSON-encoded), but `write_frame` had declared a named
  `bytes: Vec<u8>` parameter, which only ever binds against a JSON object
  key -- a raw body has none. Fixed by taking `tauri::ipc::Request<'_>`
  instead and reading `request.body()`'s `InvokeBody::Raw` variant. No JS
  change needed.
- **Ocean rendered solid black in the export.** `extract.pixels(app.stage)`
  renders the target into a *fresh, separately-cleared* render texture --
  it does not reuse the Application's configured `backgroundColor`, which
  only ever applies when rendering straight to the screen (which live
  playback always does, and export, until now, never did). The ocean has
  no actual `Graphics` shape covering it -- it's only ever visible via the
  renderer's clear color -- so it extracted as transparent black, and
  dropping alpha for the video encode turned that into solid black. Land/
  borders/highlight extracted correctly since those are real drawn shapes.
  Fixed by passing `clearColor: OCEAN_COLOR` to the `extract.pixels` call
  in `exportPipeline.ts`. Verified visually via the real code path (not a
  mock) before telling the user it was fixed.
- **Exported color didn't match the live app (teal looked shifted/washed
  out) even after the black-ocean fix.** Root-caused via a controlled
  round-trip test (encode a known RGB color through the real sidecar
  binary, decode it back, compare) rather than guessing: the export
  resolution is HD (1920x1080), and the ffmpeg command tagged no color
  matrix at all. Untagged HD video leaves players to guess which RGB<->YUV
  matrix was used -- most players (VLC included) guess BT.709 for anything
  HD-sized, but ffmpeg's default conversion during the pixel-format change
  actually used BT.601 coefficients. That mismatch is what shifted the
  color in VLC despite the frames being correct going in -- it happened to
  round-trip fine through ffmpeg's *own* decoder (self-consistent default
  on both ends), which is why it wasn't caught until the user actually
  played the file in VLC. Confirmed with a second round-trip test that
  tagging alone, without also forcing the real conversion matrix, made it
  *worse* (mislabels data that wasn't actually converted that way) --
  both have to agree. Fixed in `export.rs` by adding `-vf
  scale=out_color_matrix=bt709` (forces the actual RGB->YUV conversion)
  plus `-colorspace bt709 -color_primaries bt709 -color_trc bt709`
  (signals it correctly so a compliant player decodes with the matching
  matrix instead of guessing). Verified via `ffprobe` that the output file
  now carries the correct embedded VUI tags
  (`color_space=bt709`/`color_primaries=bt709`/`color_transfer=bt709`).

### Decisions
- **Two small, independent consumers of `Scene[]` data (`resolveAt` +
  `actionRegistry`), not one shared dispatcher.** `actionRegistry.ts`'s
  contract is fire-and-forget by design (its own header comment says so)
  and entangled with `interactionStore`'s pub/sub -- bending it to also
  support "compute a value at time t, no side effects" risked destabilizing
  live playback for the sake of export. Matches the design doc's own
  framing of Live Player and Export Engine as two consumers of one source
  of truth.
- **`worldRenderer.ts`'s extraction was scoped as its own reviewable step
  (Phase B0), not folded silently into export work** -- it's the one piece
  of this session that touched already-shipped, working rendering code, so
  it got its own full manual regression pass before anything export-specific
  was built on top of it.
- **Offscreen rendering always builds at the highest-detail (10m)
  resolution, unchunked, once.** Live's chunked LOD swap exists purely to
  keep an interactive rAF loop responsive; that doesn't apply to a
  non-interactive, deterministic export.
- **Raw RGBA streamed to ffmpeg's stdin, not a PNG sequence to disk** --
  locked in with the user during planning, before Phase C started. No
  per-frame disk I/O, no temp-file cleanup, natural backpressure via a
  blocking stdin write.
- **`showStateBorders`/`entities` captured once at Export-click time, not
  read live during the run.** `showStateBorders` isn't part of Scene data,
  so "whatever it was when Export was clicked" is the only sensible source
  -- reading it live would make output depend on something still changeable
  on screen mid-export.
- **Real end-to-end verification (actual file, actual playback) deferred
  to the user's own machine, not faked or skipped silently.** This
  sandbox's Tauri app fails at OS load time with a `libpthread`/glibc
  symbol error from a snap-vs-system conflict in its WebKitGTK stack --
  unrelated to any code in this session (no linking/rpath was touched) and
  present before this work started. No `xdotool`/`scrot` either, so even a
  successful launch couldn't have been driven/screenshotted here. Every
  phase was instead verified as deeply as this environment allowed (unit
  tests, direct ffmpeg-binary tests, browser-based Pixi/rendering checks,
  live-playback cross-checks) and the gap was flagged explicitly rather
  than glossed over -- which is exactly what surfaced both color bugs above
  the moment the user tried the real app.

### Deferred / not yet implemented
- **A real, portable, statically-linked ffmpeg sidecar for distribution.**
  The bundled binary is currently a copy of this dev machine's system
  ffmpeg -- works here, not something that should ship to end users.
  Per-platform static builds are real, separate packaging work.
- **Output resolution/FPS are fixed** (1920x1080 @ 30fps), not yet
  user-configurable.
- **Vertical/other aspect ratios, audio, codec/quality options** -- none
  in scope for this pass; audio in particular has no data model anywhere
  in the app yet.

---

## 2026-08-19 — Bug fix: stale highlight carried over into a fresh replay

### Summary
User-reported and reproduced: a story ending with a Highlight action (e.g.
Pakistan/Pan 2s -> Punjab/Highlight 2.5s), played through to completion,
then played again from the start -- Punjab stayed visibly highlighted all
through the *second* run's Pakistan/Pan scene, even though that scene has
no highlight action at all. Same root category as the camera-determinism
bugs fixed earlier this session, for a different piece of state: a fresh
Play's first dispatch was already made deterministic for *camera*
(`cameraStart`/`isFirstDispatch` in `sceneStore.ts`), but nothing
equivalent existed for *highlight* (`interactionStore.selectedEntityIds`)
-- it just carried over from whatever was true before (a previous full
playback, or an unrelated manual pick), unless the new run's own scenes
happened to touch it first.

Discussed cleanly rather than patched ad hoc: user's instinct was "convert
scenes to JSON so replay only reflects the JSON" -- pointed out the Scene
list already *is* that plain data, and playback already dispatches purely
from it; the actual gap was that nothing resets the *live* state a scene
can express back to a baseline before interpreting it from scene 0.
Considered forcing highlight's reset into the exact same `CameraStart`
mechanism camera uses, and rejected it: camera's determinism is about how
its own *next in-scene dispatch* begins (scene 0 might not even have a
camera action), which is a fundamentally different shape of problem than
"unconditionally clear a flag that outlives one scene" -- forcing them into
one mechanism would have meant teleporting the camera to a fixed spot
before scene 0's own pan runs, fighting with `cameraStart: "instant"`'s
"snap directly to scene 1, no visible motion first" behavior. Built a
second, narrower mechanism instead, scoped specifically to
unconditional-reset semantics.

Verified in-browser: rebuilt the exact reported story, played it to
completion (Punjab highlighted, as expected), then played again and
screenshotted the very first frame of the new run -- Pakistan's Pan scene
active, camera correctly panning, **no stale Punjab highlight** this time.

### Changes

**`actionRegistry.ts`**
- New `ResetHandler = () => void`, `registerReset(handler)`,
  `resetToBaseline()` -- a second, independent registry alongside the
  existing action registry, deliberately not reusing `CameraStart`/
  `registerAction` (see Decisions). `resetToBaseline()` runs every
  registered handler unconditionally.
- New `registerReset(() => interactionStore.toggleEntity(null, false))`,
  placed next to the existing `clearHighlight` action registration --
  same underlying call, registered separately since a reset must fire
  regardless of whether scene 0 happens to be a `clearHighlight` itself.

**`sceneStore.ts`**
- `play()` now calls `resetToBaseline()` once, only when `isFreshStart` is
  true (before `set({isPlaying: true})`/`playFrom`) -- never on
  resume-from-pause, where whatever's currently shown should keep
  showing, not reset.

### Decisions
- **Two separate reset mechanisms, not one forced into symmetry.**
  `CameraStart` (existing) governs *how a specific in-scene camera dispatch
  begins* -- coupled to whether scene 0 even has a camera action.
  `registerReset` (new) governs *unconditional* resets of state that can
  outlive a single scene -- correct to run regardless of what scene 0
  contains. Tried to unify them under one abstraction first and rejected
  it once the camera case was worked through concretely: an unconditional
  camera reset would visibly teleport the camera to a fixed spot *before*
  scene 0's own pan (if any) gets to run, which is wrong for the
  `"instant"` (snap-directly-to-scene-1) mode specifically. Honest
  asymmetry, not forced uniformity.
- **A registry, not a hardcoded call in `sceneStore.play()`.** Consistent
  with `docs/phase_6_arch.md`'s "new action type = new registration, not
  new dispatcher logic": a future action type with similar
  outlives-a-single-scene state (unclear what yet, but the shape exists
  now) registers its own reset the same way `clearHighlight`'s did, rather
  than `sceneStore.ts` needing to know about every such state by name.
- **Rejected "recompute full state by replaying the JSON from scratch."**
  The user's own framing, considered and set aside as solving a bigger
  problem than the one at hand -- that's effectively the seek/scrub
  machinery already deferred for 6.3.2/6.3.3 (needing a seek-vs-glide
  dispatch mode and a per-scene resting-camera sequence), not what's
  needed for "reset once at a genuine fresh start."

### Deferred / not yet implemented
- `jumpToScene` (clicking a block to preview/edit) does not run
  `resetToBaseline()` -- clicking a Pan-only scene while something else is
  highlighted still leaves that highlight showing. Not addressed this
  pass -- the reported bug was specifically about Play's fresh start, and
  jump-to-preview arguably has different, not-yet-decided semantics
  (preview *this scene's own effect* vs. preview *the fully-reset state at
  this point*) worth a separate discussion if it comes up.

---

## 2026-08-19 — New "Hold" animation: rest the camera at the previous scene's end

### Summary
User-requested new animation option: "Hold" -- rests the camera (and
whatever's currently highlighted) exactly where the *previous* scene left
it, for a chosen duration, with no camera movement of its own. Only makes
sense with at least one scene already in the timeline (nothing to "rest
after" otherwise), so the Instruction Builder disables the option until
one exists. Since it targets neither an entity nor a camera framing,
both the Entity and Zoom (%) fields are disabled outright while it's
selected -- confirmed with the user that Zoom (%) should be disabled
alongside Entity, for the same reason (it only ever scales a camera pan's
framing, and Hold has no camera action at all).

Notably needed **zero changes** to `actionRegistry.ts`/`sceneStore.ts` --
a nice validation of `docs/phase_6_arch.md`'s "adding a new animation type
should mean adding a mapping, not touching the dispatcher" goal: an empty
Scene (`camera: undefined`, `actions: []`) already dispatches as a no-op
through the existing generic mechanism, and `playFrom`'s hold-timer
already waits out a Scene's `duration` regardless of what happened during
it -- "Hold" only needed a new `buildScene`/`sceneAnimationValue` mapping
and Instruction Builder UI gating, nothing in the playback engine itself.

Verified in-browser: with the timeline empty, "Hold" is disabled in the
dropdown (confirmed via the actual DOM `<option disabled>` state, not just
visually); after adding a "Pan to World" scene, "Hold" becomes selectable;
selecting it disables both Entity ("Not applicable for Hold" placeholder)
and Zoom (%); added a 5s Hold scene, which correctly displays entity "—",
no zoom% (just "5s", not "5s · 100%"), on its Timeline block.

### Changes

**`scenes.ts`**
- `AnimationValue` gains `"hold"`; `ANIMATION_OPTIONS` gains `{value:
  "hold", label: "Hold"}`.
- `animationRequiresEntity`: now `animation !== "pan" && animation !==
  "hold"` (both are entity-less, for different reasons -- pan defaults to
  the world, hold doesn't touch the camera at all).
- `buildScene`: new early-return branch for `"hold"` -- `{id, duration,
  actions: []}`, no `camera`, no `targetEntityId`. Deliberately the
  simplest possible Scene shape, not a special "no-op" action type
  registered anywhere -- the dispatcher already no-ops on an empty
  scene.
- `sceneAnimationValue`: new first check, `!scene.camera &&
  scene.actions.length === 0` -> `"hold"` -- this exact shape is now
  reserved for Hold (previously unreachable/defensive-only via
  `buildScene`, so no other Scene could have produced it).
- `describeAnimation`: dropped its old `"—"` fallback for empty scenes --
  that shape now always means `"hold"`, which resolves to a real label via
  `sceneAnimationValue` instead.

**`InstructionBuilder.tsx`**
- Animation dropdown's "Hold" `<option>` gets `disabled={scenes.length ===
  0}`.
- New `isHold` flag; Entity's input (and its selected-entity display) and
  the Zoom (%) input are both disabled while `isHold`, with the Entity
  field's placeholder swapped to "Not applicable for Hold". Existing
  `selectedEntity`/`zoomPercent` state isn't forcibly cleared when
  switching to Hold -- harmless either way, since `buildScene("hold", ...)`
  ignores both regardless of what's in them.

**`Timeline.tsx`**
- `nameForScene` (previously keyed only on `targetEntityId`, defaulting to
  "World" when absent) now takes the whole `Scene` and checks
  `sceneAnimationValue(scene) === "hold"` first, returning `"—"` --
  otherwise a Hold block would misleadingly show "World" (same
  `targetEntityId === undefined` shape a world pan has).
  `sceneAnimationValue`/`sceneZoomPercent` for a Hold entity are otherwise
  driven by this reverse-mapping, not a stored flag.
- The duration/zoom line now omits the `· {zoomPercent}%` suffix for Hold
  scenes (`sceneAnimationValue(scene) !== "hold"` gates it) -- showing a
  meaningless "100%" for a scene with no camera action would be confusing
  as noise, not a stray leftover.

### Decisions
- **Empty Scene, not a registered no-op action type.** Discussed
  implicitly by how naturally it fell out of the existing architecture:
  `dispatchScene`'s `if (scene.camera) ...` / `for (const action of
  scene.actions)` already handle "nothing to do" for free. Adding a
  `registerAction("hold", () => {})` entry was considered and rejected as
  unnecessary indirection -- there's no camera/action *intent* to express,
  so there's nothing for a handler to do that an absent camera/empty
  actions array doesn't already achieve.
- **Zoom (%) disabled alongside Entity, confirmed explicitly with the
  user** rather than assumed -- same reasoning as Entity (meaningless
  without a camera action), but flagged as a real question since the user
  had only mentioned Entity by name.
- **Gated at the form (dropdown), not in the data model.** `AnimationValue`
  itself doesn't know "hold requires scenes.length > 0" -- that's a
  UI-level authoring constraint (checked in `InstructionBuilder.tsx`
  against `sceneStore`'s live `scenes`), not something `animationRequiresEntity`
  or `buildScene` encode, since a Hold Scene itself is perfectly
  well-formed data regardless of its position in an array.

### Deferred / not yet implemented
- The edge case flagged during design discussion: deleting every scene
  before a Hold (once reorder/delete-aware reindexing exists) could leave
  it sitting at index 0 with nothing to rest from, silently reintroducing
  camera non-determinism for that one case. Explicitly deferred by the
  user ("we will see that edge case later") -- not fixed now, no reorder
  feature exists yet to even trigger it today.

---

## 2026-08-19 — Investigated: WebGL "Insufficient buffer size" console warning

### Summary
Noticed while checking console output after the Van Wijk & Nuij tween
verification above: `GL_INVALID_OPERATION: glDrawElements: Insufficient
buffer size`, firing exactly 256 times then self-silenced by Chrome
("too many errors, no more errors will be reported"). Investigated whether
this was caused by today's `MAX_ZOOM` raise (16 -> 2000) or the camera
tween rewrite, since both are new, zoom-heavy changes from this session.

Isolated via three separate reloads with a clean console each time:
(1) 400 synthetic wheel-zoom events dispatched directly on the canvas
(pure manual `lerpCamera` interactive zoom, no `tweenCamera`/scripted pans
involved at all) reproduced the identical warning; (2) ~9 wheel events
(zoom ~50, well below both the old and new `MAX_ZOOM`) reproduced it too;
(3) **zero interaction at all** -- just page load plus a wait -- reproduced
the identical 256-times warning on its own. Conclusion: this is a
pre-existing, load-time issue, completely unrelated to zoom level,
`MAX_ZOOM`'s value, or today's tween work. It was almost certainly already
happening before this session (at the old `MAX_ZOOM = 16`) and simply
hadn't been noticed since nobody had checked devtools console closely.

### Decisions
- **Not fixed this session -- deferred, not blocking.** No visual defect
  was ever observed alongside it (every screenshot across all of today's
  verification, at every zoom level tested, rendered correctly), and it's
  independent of everything changed today, so it doesn't gate any of this
  session's work. Root cause not fully identified -- working theory
  (not confirmed) is something in the initial ~4600 state-border polygons'
  first WebGL batch flush on load, given it fires unconditionally at
  startup regardless of any subsequent interaction.

### Deferred / not yet implemented
- Root-causing and fixing the WebGL buffer-size warning itself, if a
  clean console becomes a priority -- likely needs profiling Pixi's batch
  renderer during the initial states-layer construction, not a zoom/camera
  investigation (that avenue is now ruled out).

---

## 2026-08-19 — Camera tween rewritten on Van Wijk & Nuij's flight curve

### Summary
Third and (for this bug family) final iteration on `tweenCamera` this
session. User reported the world-view -> Singapore scripted pan visibly
"zoomed into Africa first" before angling east to Singapore -- confirmed
by reproducing the user's exact requested story (World view toggle on,
Highlight Singapore 2s -> Pan India 3s -> Highlight Gujarat 2s) and,
separately, a stretched-out 30s single-scene version of the same hop to
get past this environment's tool-round-trip-latency-vs-scene-duration gap
(documented earlier this session) and actually capture the mid-flight
frames. Root cause: the previous fix (world-space center interpolated
linearly, zoom interpolated geometrically, both driven off the same raw
progress value) had *no coordination* between "how far across the map
we've traveled" and "how zoomed in we are" -- zoom grew large well before
position had traveled far along its straight-line path (which happens to
cross Africa en route from world-center to Singapore), producing a
tightly-zoomed frame centered over the wrong continent for a real chunk of
the animation.

Explicitly framed by the user as foundational, engine-level code ("this is
the foundation to everything we build in the future") -- discussed two
fix directions before writing code: an ad-hoc "delay the zoom-in" schedule
tweak (rejected -- no principled way to adapt to how far apart two scenes
actually are; a fixed delay tuned for one long hop would misbehave on a
short one) versus Van Wijk & Nuij's closed-form pan+zoom flight curve (the
same algorithm behind Mapbox GL JS's `flyTo` and `d3.interpolateZoom`) --
chosen for being derived from the actual distance/zoom-difference between
endpoints rather than tuned by eye, so it's correct across the whole range
of hops the engine will ever be asked to fly, not just the one case
tested.

Verified in-browser after implementing: replayed the 30s Singapore hop --
world view -> a moderate, still-mostly-zoomed-out view already correctly
centered over Southeast Asia (not Africa) -> zooms in tight, lands cleanly
highlighted on Singapore. No detour through the wrong continent.

### Changes

**`camera.ts`**
- New `vanWijkNuij(ux0, uy0, w0, ux1, uy1, w1, t)` -- the algorithm itself
  ("Smooth and Efficient Zooming and Panning," IEEE InfoVis 2003), pure
  math, no new dependency. Treats each endpoint as a world-space center
  point plus a "view width" `w` (~ 1/zoom -- `screenWidth / (baseScaleX *
  zoom)`, same units as the center point so the distance/width terms are
  dimensionally consistent) and returns the combined position+width at
  `t`. `RHO = Math.SQRT2` is the one shared shape constant (how
  aggressively any flight flares out), not tuned per scene. A `d2 <
  EPSILON2` branch (endpoints share the same center) falls back to a plain
  exponential width interpolation, since the general formula divides by
  pan distance and would blow up for a zero/near-zero one.
- New `cameraCenterAndWidth(camera, ...)` -- a Camera's world-space center
  point and `w`, the inverse of the `x = center*scale*zoom` relation
  `focusOnBounds` already uses to go the other way; extracted since
  `tweenCamera` now needs it for both `from` and `to`.
- `tweenCamera` rewritten to compute both endpoints via
  `cameraCenterAndWidth`, run them through `vanWijkNuij` at the (still
  cubic-eased, per the existing "smooth start/stop" pacing) `t`, then
  convert the resulting center+width back into `{x, y, zoom}` -- same
  final conversion shape as the previous iteration, just fed by the new
  arc instead of independent linear-center/geometric-zoom interpolation.
  Signature (`screenWidth, screenHeight, baseScaleX, baseScaleY` alongside
  `from`/`to`/`progress`) is unchanged from the prior fix, so
  `MapCanvas.tsx`'s call site needed no changes this time.

### Decisions
- **Van Wijk & Nuij over a tuned delay/threshold heuristic.** The
  deciding factor was reliability across *unknown future scenes*, not just
  the one reported case: a hand-tuned "wait until X% progress before
  zooming" schedule has no way to adapt to actual distance between two
  points -- correct-looking for a world-spanning hop could easily look
  wrong (unnecessary wobble) for a short one like India -> Gujarat, and
  every future feature built on this camera engine would inherit whatever
  constant got picked. The closed-form algorithm instead derives its
  behavior from the real distance and zoom difference each time, so it's
  correct by construction for both short and long hops without per-case
  tuning -- the right bar for code explicitly called out as this
  engine's foundation.
- **No new dependency.** `vanWijkNuij`/`cameraCenterAndWidth` are a
  self-contained ~50-line port of the well-documented public algorithm
  (the same one `d3.interpolateZoom` implements), not a library import --
  consistent with how the rest of `camera.ts` is written (pure functions,
  zero dependencies beyond the `Camera` type itself).
- **Verified against the user's literal reported scenario before
  generalizing.** Rebuilt the exact story (Singapore/India/Gujarat, exact
  durations) to confirm the scenes themselves were unaffected, then used
  a stretched-duration version of the *same* hop to actually capture
  frames past this environment's round-trip-latency limitation --
  reasoned explicitly that duration doesn't change the tween's shape in
  progress-space, only how much wall-clock time it's stretched across, so
  the longer capture is valid evidence for the short one too.

### Deferred / not yet implemented
- None identified for this bug -- watched the full flight frame-by-frame
  post-fix and confirmed it stays coherent throughout (recognizable,
  correct-region geography at every sampled frame, clean landing).

---

## 2026-08-19 — Bug fix: scripted zoom-in briefly showed blank ocean mid-flight

### Summary
Regression from the log-space zoom-tween fix directly above, found and
reproduced via chrome-devtools in-browser (not just inspection): a
world-view -> Singapore scripted pan (Highlight, 20s, "Start from world
view" on) correctly started at the full world view, but then got visibly
stuck for most of the scene showing solid, featureless ocean zoomed in
tight on nothing recognizable, before snapping onto Singapore correctly
only in the last moment. Root cause: `tweenCamera`'s `zoom` had just been
switched to geometric interpolation, but `x`/`y` were left interpolating
linearly, unchanged. `x`/`y` and `zoom` aren't independent -- `x`/`y` are
only meaningful *for a given zoom* (they're what keeps a specific world
point centered at that zoom, per `focusOnBounds`'s own derivation) -- so
once `zoom` moved geometrically while `x`/`y` stayed linear, the two curves
diverged mid-flight: at some progress, `zoom` had already grown large while
`x`/`y` were still only partway through their straight-line journey,
landing the camera zoomed in tight on whatever arbitrary world coordinate
that mismatched pair produced -- open ocean, not Singapore. Only at
progress 1 do both curves land back on the correct, consistent endpoint,
which is why it "snapped" correctly only at the very end.

Reproduction was not immediate -- an early attempt (edit-in-place clicks
between duration changes) accidentally triggered `jumpToScene` dispatches
that muddied the camera's prior position, making the first repro attempt
ambiguous. Redone cleanly on a fresh reload (toggle on, pick Highlight +
Singapore via the search/pick flow only, Add to Timeline once, Play once,
20s duration to survive tool round-trip latency) before trusting the
diagnosis.

### Changes

**`camera.ts`**
- `tweenCamera` signature widened: now also takes `screenWidth`,
  `screenHeight`, `baseScaleX`, `baseScaleY` (every other function in this
  file besides `viewportWorldBounds` previously needed only `Camera`
  values -- this one now needs to cross into world-space too, same
  reasoning `viewportWorldBounds`'s own comment already gives for why it's
  the exception).
- Interpolation reworked: instead of lerping `x`/`y` and `zoom`
  independently, it now (a) computes each endpoint's world-space center
  point (`(screenWidth/2 - camera.x) / (baseScaleX*camera.zoom)`, the
  inverse of the relation `focusOnBounds` already uses to go the other
  way), (b) interpolates that center point linearly and `zoom`
  geometrically (unchanged from the prior fix), then (c) *re-derives*
  `x`/`y` from the interpolated center + the interpolated zoom, at every
  frame -- not just the two endpoints. Keeps position and zoom
  mathematically consistent throughout the whole tween, not only at
  progress 0 and 1.

**`MapCanvas.tsx`**
- The one call site (`applyCameraTransform`'s `scriptedPan` branch) updated
  to pass `viewW, viewH, baseScaleX, baseScaleY` through -- all four were
  already in scope in that closure for other reasons.

### Decisions
- **Interpolate the world-space center + zoom, not raw x/y + zoom.** The
  minimal-looking alternative (revert zoom to linear, undoing the "long
  journey" fix) was rejected -- it would resurrect the earlier reported
  problem. Deriving x/y from an interpolated center point is the same
  center-and-zoom decomposition `focusOnBounds` already uses to *compute*
  a camera in the first place, just re-run every animation frame instead
  of only once per endpoint -- consistent with the rest of this file's
  approach, not a new pattern.
- **Verified via a clean re-repro, not trusted from the first (contaminated)
  attempt.** The first in-browser attempt mixed in edit-in-place clicks
  that (correctly, per 6.3.1's design) also trigger `jumpToScene`, which
  dispatches its own scripted glide -- muddying which dispatch actually
  produced the observed frame. Reloaded and repeated the repro touching
  only Add-to-Timeline + Play before concluding the diagnosis was right.

### Deferred / not yet implemented
- None identified -- the full world-view-to-Singapore flight was watched
  frame-by-frame after the fix and confirmed coherent throughout (crosses
  recognizable geography, lands correctly, no blank-ocean jump).

---

## 2026-08-19 — Bug fix: scripted zoom-in felt like a "long journey" (linear vs. geometric zoom tween)

### Summary
Follow-up to the `MAX_ZOOM` fix above. User reported the world-view-to-
Singapore scripted pan still felt like a long, stuck journey even at a
short duration. Diagnosed rather than just re-tuning numbers: the user's
first instinct was to raise `MIN_ZOOM` (the world-view floor, currently 1),
but that would redefine what "world view" means everywhere in the app
(world-pan branch, the startFromWorldView toggle) -- rejected as the wrong
fix. Actual cause was `camera.ts`'s `tweenCamera` interpolating `zoom`
*linearly* between endpoints. Zoom is a multiplicative quantity, not a
linear one -- 1->2 is a full perceptual doubling, 500->575 is barely
perceptible -- so a linear lerp from zoom 1 to zoom ~575 (Singapore, post
the MAX_ZOOM fix above) rushes through the dramatic early doublings almost
instantly, then spends most of the scene's duration crawling through huge
raw-zoom numbers that barely look different from each other. That's the
"long journey" feeling, independent of `MIN_ZOOM`/`MAX_ZOOM`'s actual
values or the scene's authored duration.

### Changes

**`camera.ts`**
- `tweenCamera`'s `zoom` interpolation changed from linear
  (`from.zoom + (to.zoom - from.zoom) * t`) to geometric/log-space
  (`from.zoom * (to.zoom / from.zoom) ** t`) -- `x`/`y` stay linear
  (screen-space position genuinely is linear, unaffected by this). Keeps
  the *perceived* zoom rate constant across the whole scripted glide
  regardless of how large the gap between start and end zoom is. The
  existing ease-in-out cubic `t` curve is unchanged, still applied on top.
  Fixes this for every scripted pan automatically (any scene, any zoom
  range), not just the Singapore case that surfaced it.

### Decisions
- **Fixed the interpolation, not `MIN_ZOOM`.** Explicitly rejected raising
  `MIN_ZOOM` per the discussion above -- it's the definition of "world
  view" app-wide (see the startFromWorldView toggle and world-pan branch
  added earlier this session), not a tunable "how far the journey feels"
  knob. The reported symptom was a tween-shape problem, not a range
  problem.

### Deferred / not yet implemented
- Not yet independently verified in-browser this session -- user is
  testing directly.

---

## 2026-08-19 — Bug fix: MAX_ZOOM (16) far too low to frame small countries

### Summary
Found while the user was verifying the zoom % feature above in-browser: a
scene panning to Singapore at 300% looked identical to 100%, no visible
zoom-in at all. Root cause was one level deeper than the new feature --
`MAX_ZOOM = 16` (`MapCanvas.tsx`), the shared ceiling for every zoom path
(manual wheel/drag, resize-reclamp, both scene pan branches), was already
far too low for a small country's plain 100% auto-fit, so 300% clamped to
the exact same value as 100% and looked unchanged. Verified the actual
number, not just asserted it: this file's own `WORLD_WIDTH = 2000`
world-units per 360deg (`render.ts`) means Singapore's ~0.5deg span is only
~2.8 world-units wide -- `focusOnBounds`'s own fit formula wants zoom ~575
to fill 80% of a ~1600px viewport with that, nowhere close to 16. Not a bug
in this session's zoomPercent/toggle work -- that code was applying its
multiplier correctly, just against a ceiling that made the multiplier
irrelevant for anything smaller than a mid-sized country.

### Changes

**`MapCanvas.tsx`**
- `MAX_ZOOM` raised from `16` to `2000` -- covers entities meaningfully
  smaller than Singapore too, per the calculation above. Single constant,
  shared by every existing consumer (wheel-zoom, drag-clamp, resize-
  reclamp, `focusOnBounds` for both entity and world pans) -- no other code
  compares against the literal value 16, confirmed by checking every call
  site before changing it, so this is a pure ceiling raise, not a behavior
  branch that needed updating elsewhere.

### Decisions
- **One shared ceiling, not a separate cap for manual vs. scripted zoom.**
  Raising `MAX_ZOOM` also lets manual wheel-zoom go that far in by hand,
  not just scripted scenes -- flagged to the user as a deliberate side
  effect (not hidden) rather than splitting into two constants, since
  letting someone manually inspect a tiny country just as closely as a
  scripted scene can seems like the more consistent behavior, not a
  regression.

### Deferred / not yet implemented
- User is verifying this in-browser directly -- not yet independently
  confirmed via screenshot/automation in this session.

---

## 2026-08-19 — Per-scene zoom % control

### Summary
User-requested: zoom was previously 100% automatic -- `camera.ts`'s
`focusOnBounds` always computed whatever zoom tightly fits an entity's
bounding box (padding 0.8), clamped to `[MIN_ZOOM, MAX_ZOOM]`, with no user
input at all. Added a per-scene "Zoom (%)" field in the Instruction Builder.
Design discussion resolved three questions before coding: what the
percentage means (a *tightness multiplier* on top of the existing auto-fit,
not an absolute zoom -- 100% = unchanged default, 150% = 1.5x tighter, 50%
= zoomed out, still scaled relative to whatever entity is framed, not a
fixed camera zoom value); whether it should also apply to a world pan
(yes, uniformly, no special-casing -- MIN_ZOOM is world pan's equivalent
"baseline" the same way auto-fit-zoom is an entity pan's); and whether it
shows on the Timeline block (yes, next to duration).

### Changes

**`scenes.ts`**
- `buildScene` gains a 4th param `zoomPercent: number = 100`, stored in the
  scene's `camera.params.zoomPercent` (only meaningful alongside `"pan"`,
  same as `targetEntityId`).
- New `sceneZoomPercent(scene)` -- reverse-mapping reader (falls back to
  100 for scenes with no camera/pan), same pattern `sceneAnimationValue`
  already uses. Powers both the Timeline block label and 6.3's edit-in-place
  form repopulation.

**`camera.ts`**
- `focusOnBounds` gains a `zoomMultiplier = 1` param, applied to the fitted
  zoom before the existing `[MIN_ZOOM, maxZoom]` clamp:
  `zoom = clamp(fitZoom * zoomMultiplier, MIN_ZOOM, maxZoom)`. Still
  entity-relative -- the same multiplier frames a small island and a large
  country each correctly, just scaled from that entity's own auto-fit.

**`interactionStore.ts`**
- `requestFocus`/`FocusListener` refactored from three stacked positional
  params to a single `FocusOptions` object
  (`{durationSeconds?, fromWorldView?, zoomPercent?}`) -- done now rather
  than stacking a 4th positional param, since only two call sites existed
  (`InstructionBuilder.tsx`, `actionRegistry.ts`'s `pan` handler), making
  the refactor low-risk.

**`actionRegistry.ts`**
- `pan` handler reads `params.zoomPercent`, forwards it through
  `requestFocus`'s new options object in both its `"instant"` and scripted-
  glide branches.

**`MapCanvas.tsx`**
- `onFocusRequest`'s callback destructures `{durationSeconds, fromWorldView,
  zoomPercent}` from the options object; computes `zoomMultiplier =
  (zoomPercent ?? 100) / 100` once and applies it to *both* branches --
  entity pans pass it into `focusOnBounds`; world pans (`id === null`) apply
  it directly to `MIN_ZOOM` before `clampCamera`, so world-pan zoom is
  usable too (>100% zooms in from the globe's center; <=100% is a no-op
  since `MIN_ZOOM` is already the hard floor -- an existing, correct
  constraint, not a new gap this introduces).

**`InstructionBuilder.tsx`**
- New "Zoom (%)" number input (default 100, min 10, step 10) next to
  Duration -- included in `buildScene`, fed into the live-preview
  `pickEntity`'s `requestFocus` call (so picking an entity previews at the
  chosen zoom, not always the plain auto-fit), and re-synced from
  `sceneZoomPercent` in the same `editingSceneId`-keyed effect that already
  repopulates animation/duration for 6.3's edit-in-place flow.

**`Timeline.tsx`**
- Block label now reads `"{duration}s · {zoomPercent}%"` instead of just
  duration.

### Decisions
- **Tightness multiplier relative to auto-fit, not an absolute zoom.**
  Explicitly chosen over "0-100% maps to MIN_ZOOM-MAX_ZOOM directly" --
  an absolute mapping would ignore entity size entirely (the same
  percentage could crop a large country or leave a tiny island minuscule),
  whereas a multiplier on the existing auto-fit stays meaningful regardless
  of what's being framed.
- **Applies uniformly to world pans too, no special-casing.** Matches how
  "pan" already unifies entity-pan and world-pan into one action instead of
  two branches with divergent behavior. The floor-at-MIN_ZOOM asymmetry
  (can zoom in past world view, can't zoom out past it) is inherent to what
  "world view" already means, not a new wrinkle.
- **`requestFocus` switched to an options object now, not a 4th positional
  param.** Judgment call flagged to the user during planning -- with only
  two call sites, low risk to refactor now rather than let positional args
  keep stacking.

### Deferred / not yet implemented
- Not yet verified in-browser -- `tsc --noEmit` clean, correct by
  inspection, actual manual verification (zoom in/out at various
  percentages, both entity and world pans) still pending.

---

## 2026-08-19 — Manual toggle: show/hide state borders on zoom

### Summary
New Instruction Builder control, user-requested: state (sub-country) border
visibility was purely automatic before this (zoom above
`STATE_ZOOM_THRESHOLD` = shown, at/below = hidden -- `MapCanvas.tsx`'s
`applyCameraTransform`, recomputed every frame, no manual override existed).
Added a checkbox that ANDs with that existing zoom check, so it never
changes default behavior unless a user turns it off. Two scope questions
resolved with the user before coding: state *labels* don't need separate
handling since `VITE_SHOW_LABELS=false` in `.env` already means no label
sprites are built at all today, regardless of this toggle; and turning
borders off should also disable clicking/hovering states, not just hide
them visually (confirmed explicitly -- these were previously independent
code paths, `hitTestScreenPoint` has its own separate zoom check that
doesn't read `.visible`).

### Changes

**`interactionStore.ts`**
- New `showStateBorders: boolean` (default `true`, so nothing changes until
  a user opts out) added to the regular state/`emit()` mechanism (not the
  separate one-shot `focusListeners` channel -- this is persistent state a
  form control and MapCanvas both need to read, same category as
  `selectedEntityIds`/`hoveredEntityId`). New `setShowStateBorders(show)`.

**`MapCanvas.tsx`**
- `applyCameraTransform()`: after the existing `setVisibleAboveZoom(statesLayer,
  ...)` call, an added `if (!interactionStore.getState().showStateBorders)
  statesLayer.visible = false;` -- forces it off regardless of zoom when the
  toggle is off, leaves the zoom-based result alone otherwise.
- `hitTestScreenPoint()`: the `stateEntities` vs `borderEntities` candidate
  selection now also reads `interactionStore.getState().showStateBorders` --
  when off, hit-testing falls through to country/border-level candidates
  even while zoomed in past the state threshold, so states become
  unclickable/unhoverable exactly when their borders are hidden, not just
  invisible.
- Read via `interactionStore.getState()` directly inside the imperative Pixi
  closure (both call sites already run every frame/every hit-test call) --
  no new subscription needed, same pattern already used for other per-frame
  reads in this file.

**`InstructionBuilder.tsx` / `.css`**
- New "Show state borders on zoom" checkbox, calling
  `interactionStore.setShowStateBorders` directly -- same direct-singleton-
  call pattern `pickEntity` already uses, not local `useState` (MapCanvas
  needs to react to it, so it has to live in the shared store).

### Decisions
- **A live store field, not the existing `SHOW_LABELS`/`SHOW_RIVERS`
  build-time env-flag pattern.** Those are compile-time only (need a dev
  server restart), explicitly documented as "not a live in-app toggle" --
  wrong shape for something a user needs to flip at runtime from the form.
- **Disabling hit-testing, not just visibility, per explicit user
  confirmation.** The two were independent before this (`.visible` never
  affected `hitTestScreenPoint`'s own zoom check) -- fixed by reading the
  same store flag in both places rather than trying to derive one from the
  other.
- **State labels needed no separate handling.** `VITE_SHOW_LABELS=false` in
  the repo's `.env` already means no state (or country) label sprites exist
  at all right now, independent of this toggle -- confirmed with the user
  rather than assumed, since a label-visibility interaction was a real
  question until checked.

### Deferred / not yet implemented
- Not yet verified in-browser -- `tsc --noEmit` clean, correct by
  inspection, actual manual toggle-and-click verification still pending.
- `declutterStates()` still runs its viewport-cull/attach logic even while
  `showStateBorders` is off and zoom is above threshold (only its early
  `zoom <= STATE_ZOOM_THRESHOLD` return is unaffected) -- harmless since
  `statesLayer.visible = false` means nothing renders either way, just a
  small amount of wasted per-frame work, not gated for now.

---

## 2026-08-19 — Playback bug fix: deterministic camera start for a fresh Play

### Summary
User-reported: Play's first scene glides from wherever the camera *currently*
happens to be, not from any fixed/known point. Repro: build "Pan to India,
3s" then "Highlight Uganda, 3s"; manually pan the map to world view; hit
Play -- looks fine, since the live camera happened to be at world view.
Hit Play again right after (camera now resting on Uganda, from the end of
the sequence) -- scene 1 now glides Uganda -> India instead, a different-
looking pan every time depending on unrelated prior state (manual input,
where a previous playback stopped). Discussed two candidate fixes before
touching code: force-reset to world view every Play (rejected -- user
doesn't want that forced on every playback), vs. snap directly to scene 1's
target (deterministic, but loses the cinematic "pan in from world view"
look some stories want). Landed on a third option, discussed and agreed
with the user turn-by-turn: a per-story toggle -- off (default) snaps scene
1 straight to its target, on scripts a glide from a fixed world-view start.
Either setting is deterministic; neither depends on live/leftover camera
state anymore. Not yet verified in-browser -- `tsc --noEmit` clean, correct
by inspection, actual repro-based verification still pending.

### Changes

**`interactionStore.ts`**
- `FocusListener`/`requestFocus` widened with an optional 3rd `fromWorldView`
  param (alongside the existing `durationSeconds`) -- all existing callers
  omit it, fully backward compatible.

**`MapCanvas.tsx`**
- `onFocusRequest`'s scripted-glide branch now picks `scriptedPan.from` as
  `clampCamera({x:0,y:0,zoom:MIN_ZOOM}, ...)` (world view) when
  `fromWorldView` is set, instead of always reading the live `current`
  camera value -- the one line that actually fixes the non-determinism.

**`actionRegistry.ts`**
- New `CameraStart = "instant" | "world"` type, threaded through
  `dispatchScene`/`dispatchAction`/`ActionHandler` as an optional trailing
  param -- only ever passed for a scene's `camera` action, never
  `scene.actions`. Only the `pan` handler reads it: `"instant"` calls
  `requestFocus` with no duration at all (reuses the existing fast
  interactive fly-to path -- see Decisions below on why this, not a hard
  cut); `"world"` calls `requestFocus(id, durationSeconds, true)`.
  `highlight`/`clearHighlight` ignore the new param, same pattern already
  used for their ignored `_durationSeconds`.

**`sceneStore.ts`**
- New `startFromWorldView: boolean` (default `false`) + `setStartFromWorldView`.
  Story-level state, not per-scene -- describes how the whole story opens.
- `play()` now computes `isFreshStart = currentSceneIndex === null` *before*
  dispatching (true only for a genuine fresh Play from scene 0, false for a
  resume-from-pause) and passes it into `playFrom`.
- `playFrom(index, isFirstDispatch = false)` -- only when `isFirstDispatch`
  is true does it pass a `cameraStart` mode into `dispatchScene`
  (`startFromWorldView ? "world" : "instant"`); every later scene in the
  same run, every resume, and `jumpToScene` (unchanged, separate call site)
  dispatch exactly as before with no mode at all.

**`Timeline.tsx` / `Timeline.css`**
- New "Start from world view" checkbox next to the Play/Pause toggle, bound
  to `sceneStore`'s new field.

### Decisions
- **Toggle, not a forced default either way.** Discussed three options with
  the user across several turns: always-world-view (rejected -- shouldn't be
  forced on every playback), always-snap (rejected once the user clarified
  they do want a visible pan-in-from-world-view look for some stories), a
  per-story toggle (chosen). A story-level boolean, not per-scene, since it
  describes how the whole thing opens.
- **"Snap" reuses the existing fast interactive fly-to, not a true
  zero-frame hard cut.** Explicitly discussed and decided: the "instant"
  `cameraStart` mode omits `durationSeconds` entirely, which routes through
  the same `target = newTarget` + `lerpCamera` ease `SearchBox`/manual
  entity picks already use -- a quick pop, not a literal single-frame
  snap (that would need also setting `current = newTarget` immediately,
  skipping the ease). Deliberately deferred rather than built now -- fast
  ease is what's shipped; a true hard-cut mode is easy to add later
  (one extra line in the same `MapCanvas.tsx` branch) if it turns out to be
  wanted.

### Deferred / not yet implemented
- Full in-browser verification of the original repro (India/Uganda,
  manual pan, replay, toggle on/off) -- correct by inspection and a clean
  `tsc --noEmit`, but not yet exercised in the running app.
- A true hard-cut/zero-frame snap mode, if "fast ease" turns out to be too
  visible for some use cases -- see Decisions above.

---

## 2026-08-19 — Phase 6.2 (visual timeline) + 6.3.1 (scene selection); 6.3.2/6.3.3 built then pulled

### Summary
Built out the rest of 6.2 (ruler, duration-proportional scene block track,
drag-resize, delete) and started 6.3 (roadmap.md step 8 / scene selection-
scrub sync). 6.3.1 (click a scene to jump straight to its state) landed
along with an added scene-editing flow (clicking a scene also populates
the Instruction Builder to edit it in place, with Update/Cancel). 6.3.2
(a playhead marker) and 6.3.3 (drag-to-scrub) were then built, found to
have a real gap under testing, and deliberately removed again -- kept only
6.3.1 and the edit-in-place flow. `tsc --noEmit` clean and verified
in-browser at each step below.

### Changes

**`timelineLayout.ts` (new), `TimelineRuler.tsx`/`.css` (new)**
- `PIXELS_PER_SECOND` (40) shared scale constant, `pickTickInterval` (picks
  a "nice" interval -- 1/2/5/10/15/30/60/120/300/600s -- so a ruler always
  shows roughly 10 ticks regardless of total duration), `formatTimestamp`
  (m:ss). `TimelineRuler` renders ticks from 0 to one interval past the
  total duration. Verified: a 20s timeline showed 2s ticks, a 60s timeline
  showed 10s ticks with correct "1:00" rollover. Always rendered (floor of
  60s when there are no scenes yet) rather than only appearing once a
  scene exists.

**`Timeline.tsx` / `Timeline.css`**
- Scene list converted from a flex-wrapped list to `.timeline-track`/
  `.timeline-block` -- edge-to-edge blocks (no gap) each sized
  `duration * PIXELS_PER_SECOND`, so block widths land exactly on the
  ruler's ticks above them.
- Delete: a `×` button per block, straddling the block's top border
  (top-right corner, per user request on exact placement/size), calling a
  new `sceneStore.deleteScene`.
- Drag-to-resize: a 6px hit strip on each block's right edge, pointer-
  capture based (same pattern as below), dragging changes that scene's
  duration live via a new `sceneStore.resizeScene`.
- Click-to-select (6.3.1): clicking a block calls `sceneStore.jumpToScene`,
  which dispatches that scene's camera+highlight state directly (no
  transition through scenes in between) and marks it active
  (`.timeline-block-active`).

**`sceneStore.ts`**
- `resizeScene(id, duration)` -- clamps to a 0.5s floor.
- `deleteScene(id)` -- unconditionally resets playback (clears the hold
  timer, `isPlaying: false`, `currentSceneIndex: null`) rather than trying
  to adjust the index for the array shift; also drops `editingSceneId` if
  the deleted scene was the one being edited. Same reasoning as every
  other structural-edit action in this store: adjusting indices to
  preserve position through a shift is fiddly and easy to get subtly
  wrong, so a full reset is the deliberately simple, safe choice.
- `jumpToScene(index)` -- dispatches the scene directly, stops playback,
  sets `currentSceneIndex`, and (see below) `editingSceneId`.
- `editingSceneId`, `updateScene(id, scene)`, `stopEditingScene()` -- the
  scene-editing flow. `jumpToScene` sets `editingSceneId` to the clicked
  scene's id (the two happen together: preview on the map + populate the
  form), `updateScene` replaces that scene in place (keeping its original
  id, discarding the throwaway id `buildScene` generates fresh each call)
  and exits edit mode.

**`scenes.ts`**
- New `sceneAnimationValue(scene)`, extracted out of `describeAnimation`'s
  detection logic -- reverse-maps a Scene back to the `AnimationValue` that
  built it, needed so the edit flow can re-populate the Animation dropdown
  correctly. `describeAnimation` now just looks up that value's label.

**`InstructionBuilder.tsx` / `.css`**
- A `useEffect` keyed on `editingSceneId` (not `scenes`/`entities`, so it
  only re-syncs when a *different* scene is picked to edit, not on every
  unrelated store change) re-populates entity/animation/duration from the
  scene being edited.
- Submit button reads "Update Timeline" (calls `updateScene`) instead of
  "Add to Timeline" while editing; a "Cancel" button appears alongside it
  (`stopEditingScene` + resets the form) -- new `.ib-btn-row`/
  `.ib-cancel-btn`.
- Verified in-browser: clicking a block jumps the map, highlights the
  block, populates the form, and shows Update/Cancel; editing the duration
  and clicking Update Timeline changed that scene's duration in place
  (confirmed both in the block's label and via a fresh click showing the
  updated value) without adding a duplicate scene.

### Built, then removed again: 6.3.2 (playhead marker) and 6.3.3 (scrub)
- Added a draggable playhead marker (`sceneStore.playheadSeconds`,
  `scrubTo`, a wider invisible hitbox around the visible 2px line) that
  moved continuously as you dragged it, re-dispatching the scene under the
  cursor whenever the drag crossed a scene boundary. Verified via
  synthetic pointer events (with proper waits for React to flush) that the
  boundary-crossing mechanism itself worked correctly -- dragging from 3s
  to 7s (both inside one scene) kept that scene active with no redundant
  redispatch, dragging to 12s (into the next scene's span) correctly
  switched the active scene and dispatched it.
- **The real gap, found via user testing, not caught by the synthetic
  test above**: scrubbing *within* a single scene's own span does nothing
  to the camera, even for a Pan scene where the camera position is
  genuinely time-dependent (per the earlier scripted-pan-duration work).
  `scrubTo` only re-dispatches on a boundary crossing; even if it
  re-dispatched on every pixel, `dispatchScene` starts a fresh *real-time*
  glide from wherever the camera happens to be, which is playback
  behavior, not a seek -- there's no way to jump straight to "40% through
  this pan" without knowing (a) the resting camera position right before
  this scene's pan started (recursively, the previous scene's own final
  camera state) and (b) this scene's target framing, then computing
  `tweenCamera(from, to, progress)` as an instant set instead of an
  animated glide. That's real, not-yet-built work -- a second dispatch
  mode (seek vs. real-time glide) plus a per-scene resting-camera
  sequence, not a fix to the boundary-crossing logic.
- Removed rather than left half-working: `TimelineRuler`/`timelineLayout`
  kept (still needed for 6.2's block track), but `sceneStore.ts`'s
  `playheadSeconds`/`scrubTo` and `Timeline.tsx`'s playhead marker/drag
  handlers/`.timeline-body` wrapper were deleted back out. `jumpToScene`
  and the edit-in-place flow (6.3.1) were kept -- they only ever jump to a
  scene's *start*, never an in-between position, so they don't have this
  gap.

### Deferred / not yet implemented
- 6.3.2/6.3.3 themselves -- revisit once there's a seek-mode dispatch path
  and a per-scene resting-camera sequence to interpolate from.
- Reorder (drag-and-drop or up/down buttons) -- was scoped into 6.2,
  briefly built with up/down buttons, then explicitly pulled back out on
  request before this pass; still unbuilt.
- `currentSceneIndex`/resize interaction: resizing a scene doesn't reset
  or adjust `currentSceneIndex`/`editingSceneId` the way delete does --
  not identified as causing an actual problem yet, but worth a look if one
  turns up (a resize doesn't change array order or length, only a
  duration, so the existing index-based state should stay valid, unlike
  delete/reorder).

---

## 2026-08-17 — Live-preview animation bug fix + SearchBox removal

### Summary
Two small follow-ups. First, fixed the live-preview bug flagged since
6.1.a and reverted once already this session: `InstructionBuilder.tsx`'s
`pickEntity` used to fire both `toggleEntity` and `requestFocus` on every
pick regardless of the selected animation, so picking "Pan" still showed a
highlight in the preview even though the Scene being built wouldn't
highlight anything. Second, removed `SearchBox.tsx` (the floating in-map
search overlay) entirely -- with the Instruction Builder now the only path
used to build a story (per `docs/phase_6_arch.md`), the map-embedded search
was redundant.

### Changes

**`InstructionBuilder.tsx`**
- `pickEntity` now branches on `animation`: `requestFocus` fires for every
  animation (visual confirmation of the pick, plan decision #2), but
  `toggleEntity` (the highlight) only fires for `"highlight"`. Deliberately
  *not* reusing `buildScene`/`dispatchScene` here -- `dispatchScene` now
  always threads the Scene's `duration` into a scripted glide (see the
  pan-duration fix), so reusing it for the live preview would make every
  pick glide for the chosen duration instead of confirming it instantly.
  Caught a self-introduced bug while verifying this in-browser: the first
  pass omitted `requestFocus` from the `"clearHighlight"` case entirely,
  giving zero visual feedback when picking a clear-highlight target --
  fixed so it still pans (just never highlights).

**`SearchBox.tsx`** -- deleted. `App.tsx` no longer imports/renders it;
no other file had a real (non-comment) dependency on it.

### Decisions
- **`clearHighlight` previews with a pan, not nothing.** Its Scene ignores
  which entity was picked (the handler just clears whatever's currently
  highlighted), but the live preview still pans there so the user gets
  *some* confirmation they picked the right target.

---

## 2026-08-17 — Antimeridian-aware camera framing (Pan/Highlight bug fix)

### Summary
User-reported: "Pan to Russia" or "Pan to USA" zoomed out to almost the
whole world instead of framing the country. Root cause: `entities.ts`'s
`computeBoundingBox` does a naive min/max over raw longitude, and both
countries have territory that crosses the antimeridian (Russia's Chukotka
peninsula, the USA's western Aleutian islands) -- points cluster near both
-180 and +180, so the naive box comes out ~358-360deg wide, forcing
`focusOnBounds` to zoom out to fit nearly the entire globe's width. This
was a known, previously-documented gap (2026-08-13's camera fly-to entry
flagged it for Russia/Fiji specifically), never fixed because nothing
consumed bounding boxes for framing until Phase 6.

Confirmed the diagnosis by computing both countries' real bounding boxes
directly from the vendored data before touching any code (`minLon: -178.19,
maxLon: 179.78` for the USA; `minLon: -180, maxLon: 179.88` for Russia --
both ~358-360deg spans). A first fix attempt (return the shifted-space box
directly once a crossing is detected) was verified *wrong* in-browser --
"pan to USA" landed on Asia, since `render.ts`'s `project()` is plain
linear with no wraparound and a longitude past 180 projects nowhere near
the entity. Corrected and re-verified: USA now frames mainland+Alaska+
Hawaii tightly, Russia frames Kaliningrad-to-Bering-coast tightly, and
France (a real multi-continental country via overseas territories, not an
antimeridian case) is unaffected -- confirming the fix doesn't misfire on
ordinary countries.

### Changes

**`entities.ts`**
- New `computeFramingBounds(geometry)` -- deliberately a *separate*
  function from `computeBoundingBox`, not a replacement for it.
  `computeBoundingBox`'s naive (antimeridian-wide) output is what populates
  `entity.boundingBox`, which `findEntityAt`/`findRiverAt` (hit-test
  prefilters) and `declutterStates` (viewport-culling prefilter) also read
  -- at every one of those call sites, an overly-*wide* box is explicitly
  documented as harmless (it only ever fails to reject/cull early, never
  produces a wrong result). A *narrow* box computed in a shifted coordinate
  space would actively misreject valid points on the "wrong" side of the
  shift if it were plugged into those same raw-lon prefilters, so the
  framing fix lives in its own function, never stored on `Entity` or fed
  into hit-testing. `computeBoundingBox`'s own doc comment updated to
  explain why it's deliberately left as-is rather than "fixed in place."
- `computeFramingBounds` detects a crossing by comparing the naive
  longitude span against a shifted-by-360 span (shift every negative
  longitude by +360, remeasure) -- if the shifted version is tighter, a
  crossing is confirmed. This never misfires on ordinary countries that
  merely straddle 0deg longitude (Algeria, Ghana, Spain, ...): shifting
  only matters when points cluster near -180, so for those countries the
  shift either has no effect or produces a *larger* span, and the as-is
  version wins on its own.
- Once a crossing is confirmed, splits all points by raw sign (negative vs.
  non-negative longitude) and keeps only the side with the larger span --
  the country's actual dominant landmass -- using its own plain,
  already-valid min/max. The minority sliver on the far side of the seam
  (Chukotka, the westernmost Aleutians) ends up just outside the frame.
  Non-Polygon/MultiPolygon geometry (Point, LineString/MultiLineString --
  rivers) is delegated straight to `computeBoundingBox` unchanged; rivers
  already deliberately skip antimeridian handling entirely (see
  `findRiverAt`/`pointNearLine`), and no vendored river crosses the seam.

**`MapCanvas.tsx`**
- `onFocusRequest`'s entity branch now calls
  `computeFramingBounds(entity.geometry)` instead of reading
  `entity.boundingBox` directly. The world-pan (`id === null`) branch is
  unaffected -- it never reads a bounding box at all.

### Decisions
- **A separate function, not a fix-in-place.** Reusing/narrowing
  `computeBoundingBox` itself was considered and rejected: its result is
  load-bearing for hit-testing/culling prefilters elsewhere, all of which
  are documented as relying on "too wide is harmless." A tighter-but-
  differently-computed box is not a strict improvement for those call
  sites -- it would introduce a real misrejection risk for points on the
  minority side of a crossing (e.g. a click actually landing in Chukotka).
- **Drop the minority side entirely, don't try to represent a wrapping
  box.** Considered returning the shifted-space box directly (simpler code)
  but verified in-browser that it's actively wrong -- `project()` has no
  wraparound, so there is no rectangular, non-wrapping camera viewport on
  this flat map that can frame territory on both sides of the seam in one
  shot. Framing the dominant landmass tightly and letting the minority
  sliver fall outside the frame is the best achievable outcome without a
  much larger change (making the map tile/repeat), which is out of scope.
- **Verified with a real regression check (France), not just the two
  reported countries.** France's bounding box is also very wide (mainland
  Europe to French Guiana/Caribbean overseas territories), but for an
  unrelated reason (real multi-continental territory, no antimeridian
  crossing) -- confirmed the crossing-detection check correctly leaves it
  untouched rather than misfiring on any "wide bbox," specifically only on
  genuine seam crossings.

### Deferred / not yet implemented
- Rivers, lakes, and seas were not audited for antimeridian crossings --
  `computeFramingBounds` would handle one correctly if it existed (same
  Polygon/MultiPolygon logic would apply to a sea/lake), but no vendored
  entity of those types is currently known to cross the seam, so this
  wasn't specifically verified.

---

## 2026-08-16 — Phase 6 follow-up: Scripted (duration-driven) camera pans

### Summary
User-prompted design discussion, then a fix: "2 second pan to India" was
executing as an instant/interactive-speed fly-to followed by a 2-second
*hold* once already arrived, not a camera movement that itself takes 2
seconds. Discussed the two possible readings of "duration" (transition
length vs. hold length) before writing code -- landed on a single
resolution: "duration" always means "how long this scene lasts," uniformly
across animation types; movement actions (pan) glide across the *entire*
window, state actions (highlight/clearHighlight) apply instantly and
simply persist for the rest of it. Avoids introducing a second
`transitionDuration`/`holdDuration` form field (roadmap.md section 16,
still deferred) while still fixing the actual reported behavior. Verified
in-browser: a 30s scripted pan visibly glided across the globe (screenshot
mid-flight over Africa, between Japan and Argentina) rather than snapping;
a Highlight scene's border appeared immediately while the camera was still
mid-glide toward the final framing, confirming the two run concurrently as
intended.

### Changes

**`camera.ts`**
- New `tweenCamera(from, to, progress)` -- fixed-duration interpolation
  between two known endpoints (ease-in-out cubic), deliberately a separate
  function from the existing `lerpCamera`, not a reuse of it. `lerpCamera`
  is an asymptotic ease toward a `target` that can itself keep moving
  (built for open-ended interactive input -- wheel-zoom, drag) and settles
  in a roughly-fixed, distance-independent time regardless of what a caller
  wants; bending it to also do deterministic "arrive in exactly N seconds"
  animation risked subtly regressing the already-proven interactive feel.

**`interactionStore.ts`**
- `requestFocus`/`onFocusRequest`/`FocusListener` widened with an optional
  `durationSeconds` -- omitted, unchanged fast interactive fly-to (every
  existing caller: `SearchBox.tsx`, `InstructionBuilder.tsx`'s live
  preview); given, signals a scripted glide.

**`MapCanvas.tsx`**
- New `scriptedPan` state (`{from, to, startTime, durationMs} | null`),
  checked first each tick in `applyCameraTransform`: while active, `current`
  is set directly from `tweenCamera` against real elapsed wall-clock time
  instead of easing toward `target`; clears itself and syncs `target` once
  `progress >= 1`, so subsequent interactive input (wheel-zoom etc.)
  continues smoothly from the resting position.
- `onFocusRequest`'s handler now branches on whether a duration was given
  -- scripted (`scriptedPan` armed) vs. the original fast interactive path
  (`target` set directly), for both the entity and world-pan cases.

**`actionRegistry.ts`**
- `ActionHandler` now also receives the owning Scene's `durationSeconds`
  (threaded through from `dispatchScene`/`dispatchAction`). The `pan`
  handler forwards it into `requestFocus`; `highlight`/`clearHighlight`
  ignore it (prefixed `_durationSeconds`) since applying a highlight has
  nothing to animate -- `durationSeconds` there is just how long the
  playback engine's hold keeps it visible, not something this handler
  drives itself.

### Decisions
- **One duration field, interpreted per-action-type at dispatch, not a
  transitionDuration/holdDuration split.** Discussed explicitly: "duration"
  keeps meaning the same thing to the person filling out the form ("how
  long is this moment on screen") regardless of which animation they pick
  -- only the internal choreography differs (glide-for-the-whole-window vs.
  snap-and-hold-for-the-whole-window), invisibly to the user. Resolves the
  ambiguity without adding a second input.
- **A new, separate tween mechanism, not a retrofit of the existing
  interactive ease.** Same reasoning as 6.1.c's earlier decisions in this
  file: camera state stays private to `MapCanvas.tsx`, new capability
  layers on top via the existing decoupled `requestFocus` channel rather
  than opening a new hole into it or changing what already works.
- **Known, accepted edge: Pause doesn't freeze an in-flight scripted
  tween.** `sceneStore.ts`'s `pause()` only clears the scene-advance hold
  timer; it has no way to reach into `MapCanvas.tsx`'s private
  `scriptedPan` state to cancel it (same encapsulation principle that kept
  camera internals out of the action registry in 6.1.c), and resuming
  re-dispatches the scene from scratch regardless (6.1.c's already-accepted
  "resume re-holds the full duration" rough edge). Not fixed this pass --
  would need a new cancel-capable channel, out of scope for what was asked.

### Deferred / not yet implemented
- Pause not freezing an in-flight camera tween (see Decisions above).
- No verification of scripted pans interacting with manual wheel-zoom/drag
  input *during* playback -- the architecture doc's "map stays output-only
  during a story" framing makes this a low-priority edge, not hardened
  either way.

---

## 2026-08-16 — Phase 6 follow-up: "Highlight" merged with "Pan + Highlight"

### Summary
Same-day follow-up to 6.1.c, user-prompted design question rather than a
scoped baby-phase step: with "Highlight" and "Pan + Highlight" as two
separate options, picking plain "Highlight" could highlight an entity the
camera wasn't actually showing -- useless in a V1 flat form with no other
way to guarantee the target is in frame. Discussed and agreed: "Highlight"
should always pan too, collapsing the vocabulary from 4 animation options
to 3. Verified in-browser -- from a camera panned to China, playing back a
"Highlight" scene targeting Sri Lanka flew the camera back and highlighted
it, driven entirely by the Scene's own `camera.pan` action (not the
still-reverted live-preview quirk from the entry above).

### Changes

**`scenes.ts`**
- `AnimationValue` narrowed from `"pan" | "highlight" | "clearHighlight" |
  "panHighlight"` to `"pan" | "highlight" | "clearHighlight"` --
  `"panHighlight"` removed entirely, not deprecated/aliased.
- `ANIMATION_OPTIONS` dropped its "Pan + Highlight" entry -- 3 options now,
  not 4.
- `buildScene`: the `"highlight"` branch now unconditionally attaches a
  `camera: {type: "pan", params: {targetEntityId: entity.id}}` alongside
  the highlight action (previously only `"panHighlight"` did this,
  `"highlight"` attached no camera at all).
- `describeAnimation`: `hasHighlight` alone now returns `"Highlight"`
  (previously needed `hasPan && hasHighlight` to distinguish it from a
  highlight-only scene, which can no longer exist).

### Decisions
- **No highlight-without-pan option preserved.** The tradeoff (sequencing
  several highlights within one already-framed shot without the camera
  re-fitting tighter on each) was discussed explicitly and accepted as a
  real but more advanced scripting use case, deliberately not built ahead
  of real demand -- per `docs/phase_6_arch.md`'s "don't over-solve"
  principle. If this comes up in practice, it's the kind of concrete use
  case the architecture doc says should drive the next decision, not
  something to speculatively support now.
- **`"panHighlight"` removed, not kept as a deprecated alias.** No
  persisted Scene data exists yet (nothing is saved/loaded across
  sessions), so there was nothing to migrate -- a clean rename rather than
  carrying dead vocabulary forward.

### Deferred / not yet implemented
- The live-preview animation-mismatch bug from the entry above is still
  unfixed/reverted -- now additionally means picking an entity for *any*
  animation (including plain "Pan", "Clear Highlight") still previews with
  both pan and highlight in `InstructionBuilder.tsx`, regardless of the
  merge here. Same fix (route the preview through `buildScene`/
  `dispatchScene`) still applies whenever that's revisited.

---

## 2026-08-16 — Phase 6, baby-phase 6.1.c: Action registry, sequential Play/Pause

### Summary
Third pass of Phase 6, same day as 6.1.a/6.1.b. Closes out 6.1 (per
`plan-phase6-scenes-timeline.md`'s baby-phase breakdown): scenes built in
the Instruction Builder now actually play back. Preceded by a design
discussion (handler signature, registry shape, how handlers reach
camera/highlight state) before any code was written -- see Decisions.
Verified end-to-end in-browser with the roadmap's own demo sequence
(India, Pakistan, China, all "Pan + Highlight", 3s): Play cycles through
all three unattended, Pause freezes mid-sequence, and a subsequent Play
resumes rather than restarting. Also verified the two previously-untested
code paths this step introduced -- world-pan (no entity) and Clear
Highlight -- each in isolation.

### Changes

**`actionRegistry.ts` (new)**
- `ActionHandler = (params: Record<string, unknown>) => void` -- synchronous
  and fire-and-forget. Handlers only set *intent* (e.g. request a camera
  target); they don't await a transition finishing. The camera's existing
  `lerpCamera` easing already makes the transition itself smooth, and this
  step's playback engine is what sequences whole-scene *holds* on top of
  that -- no transition/hold split (roadmap.md section 16, still deferred).
- `registerAction(type, handler)` / `dispatchAction(action)` -- a `Map`
  keyed by `action.type`, per `plan-phase6-scenes-timeline.md`'s decision
  #6. Unknown types are a silent no-op, not an error, so a Scene from a
  future version doesn't crash playback.
- `dispatchScene(scene)` -- applies a Scene's full `camera` + `actions` in
  one call. Kept as its own callable rather than inlined into the playback
  loop, since 6.3 ("jump to scene N's state" on click/scrub) needs the
  exact same primitive.
- Three handlers registered: `pan` (entity -> `interactionStore.
  requestFocus(entityId)`; no entity -> `requestFocus(null)`, the new
  world-view case), `highlight` (`interactionStore.toggleEntity(entityId,
  false)`), `clearHighlight` (`interactionStore.toggleEntity(null, false)`).
  Handlers never touch `camera.ts`/`MapCanvas.tsx` state directly -- that
  stays private to `MapCanvas.tsx`'s effect closure by design; they go
  through `interactionStore`'s existing decoupled channels instead, the
  same plumbing `SearchBox.tsx`/`InstructionBuilder.tsx` already use.

**`interactionStore.ts`**
- `requestFocus`/`onFocusRequest`/`FocusListener` widened from `(id:
  string)` to `(id: string | null)` -- `null` now means "focus the whole
  world," needed for the `pan` handler's entity-less case. The only two
  existing callers (`SearchBox.tsx`, `InstructionBuilder.tsx`) already pass
  non-null ids, so this is purely additive.

**`MapCanvas.tsx`**
- `onFocusRequest`'s handler gained an `id === null` branch: sets `target =
  clampCamera({x:0, y:0, zoom:MIN_ZOOM}, ...)` directly instead of calling
  `findById`/`focusOnBounds` -- `x:0,y:0,zoom:MIN_ZOOM` *is* the definition
  of the default world view (see `camera.ts`'s `clampCamera`), so no bounds
  math is needed. Closes a gap flagged as deferred in 6.1.a's changelog
  entry ("Focus World has no camera behavior wired up yet").

**`sceneStore.ts`**
- Playback state/actions added to the same store as `scenes` (not a
  separate store) -- it operates directly over `scenes`, and the Play/Pause
  UI needs both together. `currentSceneIndex: number | null` / `isPlaying:
  boolean` are reactive state; the `setTimeout` handle that actually drives
  advancement (`holdTimer`) is deliberately *not* store state -- a
  module-level variable instead, same reasoning `interactionStore.ts` uses
  for its listener sets.
- `playFrom(index)` (internal): calls `dispatchScene(scenes[index])`, sets
  `currentSceneIndex`, arms `setTimeout(() => playFrom(index + 1),
  scene.duration * 1000)`. Running past the last scene stops playback and
  resets `currentSceneIndex` to `null`, so a later `play()` restarts from
  scene 0 rather than staying stuck at the end.
- `play()`: no-ops if already playing or the scene list is empty; otherwise
  calls `playFrom(currentSceneIndex ?? 0)` -- `?? 0` is what makes a
  post-pause `play()` resume from where it left off rather than restarting.
- `pause()`: clears `holdTimer`, sets `isPlaying: false`. Does not track
  elapsed time within the current scene's hold -- see Decisions.

**`Timeline.tsx` / `Timeline.css`**
- New single Play/Pause toggle button (not two separate buttons -- only one
  of the two actions is ever valid at a time, so a second disabled button
  would be redundant), disabled when there are no scenes.
- The active scene's row (`index === currentSceneIndex`) gets a highlighted
  border (`.timeline-row-active`) while playing, so it's visible which
  scene is currently on-screen without watching the map itself.

### Decisions
- **Handlers reuse `interactionStore`'s existing decoupled channels,
  never reach into `MapCanvas.tsx`'s camera state directly.** Camera
  (`target`/`current`/`baseScaleX`/`baseScaleY`) is private to
  `MapCanvas.tsx`'s effect closure by design; `requestFocus`/`toggleEntity`
  were already the established bridge for "intent -> map reacts" (built for
  `SearchBox.tsx` in Phase 5), so extending that bridge (widening
  `requestFocus` to accept `null`) was chosen over opening a second,
  parallel hole into `MapCanvas.tsx`.
- **`highlight`/`clearHighlight` needed no new `interactionStore` method.**
  Initially assumed a new deterministic set/clear method would be needed
  (toggling seemed ambiguous), but `toggleEntity(id, false)` turned out to
  already be non-additive/deterministic (replaces the whole selection
  unconditionally), and `toggleEntity(null, false)` already clears
  everything. Since `highlight` always replaces the entire selection, scene
  playback never has more than one entity highlighted at once -- so
  `clearHighlight`'s `params.entityId` (specific entity vs. clear-all,
  flagged open in 6.1.b) is moot in practice: clearing "this entity" and
  clearing "whatever's highlighted" are the same thing. Resolved
  pragmatically rather than by adding new store surface.
- **Resuming from Pause re-holds the current scene for its full duration,
  not the remaining time.** No elapsed-time tracking -- a deliberately
  rough edge, consistent with `plan-phase6-scenes-timeline.md`'s decision
  #4 ("even a rough/unpolished sequential playback should be available").
  Confirmed in-browser: pausing then resuming holds the paused scene for a
  full new duration rather than continuing from where it was.
- **`dispatchScene` kept as its own exported function, not inlined into the
  playback loop**, specifically because 6.3 needs an identical "apply scene
  N's state directly" primitive for click/scrub-to-jump -- avoids having to
  extract it out of the playback loop later.

### Bugs found, deliberately left unfixed (reverted on request)
- **Live map preview doesn't respect the selected animation.**
  `InstructionBuilder.tsx`'s `pickEntity` fires *both*
  `interactionStore.toggleEntity` and `requestFocus` on every pick,
  regardless of which animation is currently selected -- so picking "Pan"
  (no highlight) still highlights the entity in the live preview, even
  though the Scene actually added to the timeline won't highlight
  anything. Flagged as a known gap back in 6.1.a's changelog entry
  ("decoupling that is 6.1.c's job"), surfaced again by the user this
  session. A fix was written and verified in-browser (route the preview
  through the same `buildScene`/`dispatchScene` path playback uses, so the
  preview can't drift from what's actually added) but reverted at the
  user's request to revisit later -- `InstructionBuilder.tsx` is back to
  the original dual-call `pickEntity`.

### Investigated, ruled out as unrelated
- Chrome DevTools MCP hit the same stale-profile-lock issue documented in
  the 2026-08-12 changelog entry (a leftover Chrome process holding
  `~/.cache/chrome-devtools-mcp/chrome-profile`), confirmed with the user
  and the stale process killed before verification could proceed.
- Screenshotting mid-sequence during verification was unreliable: each
  `click()` tool round-trip cost ~15-20s of real wall-clock time in this
  environment, longer than the 3s scene durations being tested, so a
  couple of early "mid-sequence" screenshots were actually post-completion.
  Not an app bug -- a testing-methodology trap worth remembering (use
  longer scene durations, e.g. 10s+, when verifying timing-sensitive
  behavior this way).

### Deferred / not yet implemented
- The live-preview animation-mismatch bug above -- fix written, reverted,
  to be revisited.
- Visual timeline (6.2): duration-proportional blocks, drag-resize, delete,
  reorder. Today's Timeline is still 6.1.b's plain list, just with a
  Play/Pause toggle and an active-row highlight added on top.
- Scene selection/scrub sync (6.3) -- `dispatchScene` exists and is exactly
  the primitive 6.3 will need, but nothing calls it outside the playback
  loop yet.
- **Playback has no guard against the scene list changing while playing.**
  Not a bug today (nothing can delete/reorder yet), but once 6.2 ships,
  pausing mid-playback and then deleting/reordering scenes will leave
  `currentSceneIndex` pointing at the wrong scene (or past the array end)
  with no correction logic. Worth fixing when 6.2 lands, not before.
- Text instruction layer (6.4) -- unstarted, lowest priority per the plan.

### Phase 6, baby-phase 6.1 — complete
All three sub-steps (6.1.a form + preview, 6.1.b Scene model + timeline
list, 6.1.c action registry + Play/Pause) are done. Next up per
`plan-phase6-scenes-timeline.md` is 6.2 (Visual Timeline).

---

## 2026-08-16 — Phase 6, baby-phase 6.1.b: Scene model, sceneStore, timeline list

### Summary
Second pass of Phase 6, same day as 6.1.a. Adds the actual Scene data model,
a `zustand`-backed `sceneStore`, "Add to Timeline" wiring in the Instruction
Builder, and a minimal (unstyled, no drag/resize) scene list in the Timeline
panel. Preceded by a design discussion on two specific points, both
resolved before writing code: whether "Focus" and "Focus World" should stay
two separate action types (merged into one, see Decisions), and what should
happen to the form after a scene is added (chose: reset entity only, keep
animation/duration -- matches the roadmap's own repeated-pattern demo).
Verified end-to-end with the roadmap's own demo sequence (India, Pakistan,
China, all "Pan + Highlight", 3s) -- three rows landed in order with correct
entity/action/duration, and the map reflected the last add's pan+highlight.

### Changes

**`scenes.ts` (new)**
- `Scene`/`SceneAction`/`CameraAction` types, matching roadmap.md section
  14's shape (`id`, `duration`, `targetEntityId?`, `actions`, `camera?`) --
  but `SceneAction`/`CameraAction` themselves are a generic `{ type,
  params }` pair rather than the roadmap's illustrative per-action custom
  fields (its example puts `entityId` directly on a highlight action).
  Deliberate, per `plan-phase6-scenes-timeline.md`'s decision #6: the
  future playback engine (6.1.c) needs to dispatch on `type` through one
  registry, and a uniform shape is what lets `actions` and `camera` share
  that one dispatcher instead of needing two different mechanisms. `type`
  is a plain `string`, not a literal union -- a new action type later is a
  new registered handler, not an edit to this file.
- `AnimationValue`/`ANIMATION_OPTIONS`: the V1 dropdown vocabulary, now
  living here (not `InstructionBuilder.tsx`) so it can't drift from the
  mapping logic that interprets it. Four options, not five -- see Decisions
  for the Focus/Focus World merge.
- `animationRequiresEntity(animation)`: only `"pan"` can go without an
  entity (pans out to the world); every other V1 animation needs one.
  Exported so the Instruction Builder can disable "Add to Timeline"
  synchronously, without calling `buildScene` just to learn it'd return
  null.
- `buildScene(entity, animation, duration)`: pure mapping from the form's
  flat state into a `Scene`. The one place that knows how each dropdown
  option decomposes -- "Pan + Highlight" becomes *two* things in the Scene
  (a `camera` pan entry and an `actions` highlight entry), not one opaque
  combined action, so 6.1.c's dispatcher never needs to know "combined"
  options exist at all. Returns `null` if a required entity is missing (a
  correctness backstop; the primary validation is
  `animationRequiresEntity` at the call site).
- `describeAnimation(scene)`: the reverse mapping, for display. Reconstructs
  a label ("Pan + Highlight", etc.) from a Scene's actual `actions`/`camera`
  rather than storing the original `AnimationValue` on the Scene -- keeps
  the Scene describing what happens (roadmap.md section 14: "store what the
  user wants to happen, not raw renderer state"), not which dropdown option
  produced it.

**`sceneStore.ts` (new)**
- `useSceneStore` (zustand): `scenes: Scene[]` + `addScene`. A separate
  store from `interactionStore.ts`'s hand-rolled pub/sub, not an extension
  of it -- per decision #7, scoped to this new feature only,
  `interactionStore` itself untouched so nothing about Phase 1-5 risks
  regressing.

**`InstructionBuilder.tsx`**
- Imports `ANIMATION_OPTIONS`/`AnimationValue` from `scenes.ts` instead of
  defining its own local copy (which still had the old 5-option
  Focus/Focus World vocabulary).
- New "Add to Timeline" button: disabled via `animationRequiresEntity`
  until a valid combination exists, calls `buildScene` + `addScene` on
  click. After adding: entity resets to empty, animation and duration
  persist -- see Decisions.
- Entity field's placeholder hints "(leave empty to pan to world)"
  specifically when "Pan" is selected, addressing the one real UX cost of
  merging Focus/Focus World (an empty field silently meaning "the world" is
  not otherwise self-evident).

**`Timeline.tsx` (new) / `Timeline.css` (new)**
- Renders `sceneStore`'s `scenes` as a plain row-per-scene list (flex-wrap,
  not yet a real duration-proportional track -- that's 6.2), each row
  showing the resolved entity name (looked up from `interactionStore`'s
  `entities` by `scene.targetEntityId`, "World" if unset), `describeAnimation`,
  and duration. Empty state ("No scenes yet...") when `scenes.length === 0`.
- Wired into `App.tsx`'s `editor-timeline` div, replacing the placeholder
  text used since 6.1.a; `App.tsx`'s now-unused `placeholderStyle` constant
  removed along with it (Timeline was its last consumer).

### Decisions
- **"Focus" and "Focus World" merged into one `"pan"` action with an
  optional target**, not two separate action types -- discussed explicitly
  this session. `camera.ts`'s `focusOnBounds` already takes bounds as one
  argument regardless of whether they came from an entity or the whole
  world; two registry entries wrapping the identical mechanism would be
  redundant. Also matches how roadmap.md sections 10-12 describe the camera
  conceptually (one "find target's bounds, default world" pipeline, not two
  separate ones) more closely than the section 4's literal two-name list
  does. This is a deliberate, logged deviation from roadmap.md's naming --
  "Pan + Highlight" replaces "Focus + Highlight" throughout the UI and the
  action vocabulary.
- **Post-add form reset: entity only, not animation/duration.** Discussed
  three options (full reset / entity-only reset / no reset). Chose
  entity-only because it matches the one concrete workflow roadmap.md's own
  demo describes (section 2 -- repeating the same Focus+Highlight/3s pattern
  for Pakistan, China, Russia in a row): pick the next entity, hit Add
  again, same style carries over, only change animation/duration when you
  actually want something different.
- **Hardcoding `ANIMATION_OPTIONS`' fixed option list does not conflict with
  "stay extensible."** Reaffirmed from the 6.1.a discussion: the
  extensibility constraint targets the Scene data model and playback
  dispatcher (both of which now exist, and both do use the generic `{type,
  params}` + registry-ready shape), not the UI's fixed vocabulary of
  current options.

### Deferred / not yet implemented
- Action registry + actual Play/Pause execution (6.1.c) -- scenes currently
  just sit in the list, nothing plays them back yet.
- Visual timeline (duration-proportional blocks, drag-resize, delete,
  reorder) -- 6.2. Today's list is flex-wrapped rows in add-order only.
- "Clear Highlight"'s semantics (specific entity vs. clear-all) were left
  as "specific entity" (matches `buildScene`'s current mapping,
  `{type:"clearHighlight", params:{entityId}}`) -- not revisited this pass,
  flagged in the 6.1.a discussion as still open.
- No `Scene.id` collision handling beyond `crypto.randomUUID()`'s own
  guarantees (not a concern in practice, not explicitly tested).

---

## 2026-08-16 — Phase 6, baby-phase 6.1.a: Instruction Builder shell

### Summary
First implementation pass of Phase 6 (roadmap.md), scoped to baby-phase
6.1.a per `.development_logs/plan-phase6-scenes-timeline.md`'s baby-phase
breakdown -- the editor layout shell plus the Instruction Builder's form
fields (entity picker, animation dropdown, duration input), with live map
preview wired up. Explicitly does **not** yet include the Scene data model,
"Add to Timeline," or any playback -- those are 6.1.b/6.1.c, not started.
Preceded by an extended planning discussion (see that plan file and
`docs/phase_6_arch.md`) that locked several decisions before any code was
written: map stays click-free for building a story (form drives it, not the
reverse), live one-way form-to-map preview, incremental UI-testable steps,
and a data-model extensibility constraint (scene actions as a typed
`{type, params}` array + registry dispatch, not hardcoded if/else) that
doesn't apply yet since no Scene model exists this pass.

### Changes

**`App.tsx` / `App.css` (editor layout shell)**
- New CSS grid (`editor-layout`): Map fills the top across both columns
  initially, then revised so the Instruction Builder panel spans the full
  right-column height (both the map and timeline rows), matching the
  reference mockup exactly rather than being confined to the row next to
  the timeline. Timeline and Map share the left column.
- Timeline and Instruction Builder panels given a dark background
  (`#181a1f`) with lighter borders/text for contrast; the map area itself
  was deliberately left untouched.
- The Instruction Builder's fields were initially split into two stacked
  "zones" (mirroring the mockup's two visual boxes), then consolidated back
  into a single compact block once real fields (not placeholder text)
  revealed the 55%/45% split left a large dead gap under a short Animation
  field -- fields now just stack from the top, gap collects harmlessly at
  the bottom of the column instead of between fields.

**`MapCanvas.tsx` (map fit: stretch -> contain)**
- `baseScaleX`/`baseScaleY` changed from independent per-axis stretch
  (world exactly fills the container on both axes, distorting aspect ratio)
  to a uniform contain-fit scale (`Math.min(width/WORLD_WIDTH,
  height/WORLD_HEIGHT)`), computed by a new `applyViewFit()` helper. This is
  a deliberate reversal of a specific decision recorded in this changelog's
  2026-08-02 Phase 2 entry, which chose per-axis stretch specifically to
  avoid letterboxing -- that reasoning no longer holds now that the map's
  area isn't ~2:1 (the editor layout eats into its width), and stretch was
  visibly squashing the map vertically.
- New `viewW`/`viewH` (the resulting contained content size, <= the real
  canvas in one axis) and `letterboxX`/`letterboxY` (the margin that
  centers it). Every existing camera.ts call that already worked in
  "content space" (`clampCamera`, `zoomAt`, `viewportWorldBounds`,
  `focusOnBounds` via `declutterLabels`/`declutterStates`/`onResize`/
  `onFocusRequest`/onPointerMove-drag) needed no logic changes, just
  `viewW`/`viewH` passed in place of the old full `app.screen` width/
  height. Only code that touches *raw* screen/DOM pixel coordinates needed
  an explicit letterbox adjustment: `worldContainer.position` (add the
  offset) and `hitTestScreenPoint`/`onWheel`'s cursor position (subtract
  it) -- verified in-browser that click-to-select is still pixel-accurate
  (tested against Sri Lanka specifically) and cursor-anchored wheel-zoom
  still anchors correctly post-change.

**`InstructionBuilder.tsx` (new) / `InstructionBuilder.css` (new)**
- Entity picker: text input + dropdown, reusing `interactionStore.search`
  (no new search logic, just a new place to render results -- a form field
  instead of a floating map overlay like `SearchBox.tsx`). Picking an
  entity calls `interactionStore.toggleEntity(id, false)` +
  `interactionStore.requestFocus(id)`, the same non-additive
  select-and-fly-to pattern `SearchBox.tsx` uses -- this is the only path
  that drives the map now; direct map click/hover (Phase 4) stays fully
  independent and untouched, verified by clicking the map directly after a
  form pick and confirming the map's selection changes while the form's own
  "Entity" field stays showing the earlier pick (one-way link, no feedback
  from map to form).
- Animation dropdown: hardcoded `ANIMATION_OPTIONS` (Focus, Focus World,
  Highlight, Clear Highlight, Focus + Highlight -- all 5 from roadmap.md
  Phase 6 section 4, not just the 3 example names the plan file's decision
  #6 abbreviated to). Purely local state, **no execution wiring** -- every
  entity pick currently fires both toggleEntity and requestFocus regardless
  of which animation is selected; decoupling that is 6.1.c's job (action
  registry + playback), not this pass's.
- Duration input: plain local numeric state (seconds, default 3), not yet
  part of any Scene since no Scene model exists yet.
- All styling lives in `InstructionBuilder.css`, not inline `style` objects
  -- explicit user preference stated this session ("I dont like to have css
  in tsx files"); existing inline-style code in `SearchBox.tsx`/`App.tsx`
  was flagged but left as-is pending a decision on whether to convert it
  too.
- `color-scheme: dark` added to `.ib-input` (covers the `<select>` and
  `<input>` fields) -- without it, some engines (WebKitGTK, what Tauri uses
  on Linux, specifically flagged) paint a closed `<select>`'s
  background/chevron using the OS's light widget theme regardless of the
  `background`/`color` CSS set on it, producing washed-out low-contrast
  text. Not verified screenshot-side (Chrome devtools, used for the rest of
  this session's verification, doesn't reproduce this specific WebKitGTK
  quirk) -- worth a manual check in the actual Tauri window.

### Decisions
- **Map contain-fit reverses a prior documented decision, deliberately.**
  See MapCanvas.tsx changes above -- flagged explicitly to the user rather
  than silently changed, since Phase 2's original reasoning was recorded in
  this same file.
- **Instruction Builder fields hardcoded, Scene model is not (once it
  exists).** Discussed explicitly this session: hardcoding the dropdown's
  fixed option list does not conflict with the "stay extensible" plan
  decision -- that constraint targets the future Scene data model (`actions`
  as a typed array) and playback dispatcher (registry, not if/else), neither
  of which exists yet. `ANIMATION_OPTIONS`' `value`s (`"focus"`,
  `"focusWorld"`, `"highlight"`, `"clearHighlight"`, `"focusHighlight"`)
  were deliberately chosen to double as the future action-registry key.
- **One-way form-to-map preview, not two-way.** Direct map click/hover
  (Phase 4) and `SearchBox.tsx` remain fully independent of the Instruction
  Builder's local `selectedEntity` state -- picking on the map never updates
  the form, matching the plan file's decision #2.

### Deferred / not yet implemented
- Scene data model, `sceneStore`, "Add to Timeline" (6.1.b).
- Action registry + basic sequential Play/Pause (6.1.c).
- "Focus World" has no actual camera behavior wired up yet -- per
  roadmap.md section 11/12, it should eventually zoom the camera back out
  to frame the whole world (something like a `camera.reset()`), but no such
  function exists in `camera.ts` yet; today picking it in the dropdown does
  nothing (Animation is fully inert, as noted above).
- "Highlight" as a *decoupled* action doesn't exist yet either -- the
  underlying rendering (`drawHighlights`, Phase 4) works, but every pick
  currently triggers both highlight and focus together regardless of the
  dropdown's value.
- Converting `SearchBox.tsx`/`App.tsx`'s remaining inline `style` objects to
  CSS files, per the same-session preference that shaped
  `InstructionBuilder.css` -- flagged to the user, not yet actioned.
- Manual in-Tauri-window verification of the `color-scheme: dark` select
  contrast fix (see above).
- Full 6.1.a in-browser verification pass (todo 8 in this session) -- most
  of it happened incrementally already (entity picker + live preview +
  direct map click coexistence all screenshot-verified above), but hasn't
  been formally closed out as one pass.

---

## 2026-08-13 — Rivers excluded from hit-testing (search-only selection)

### Summary
Second same-day follow-up. User-reported: rivers' hit-test tolerance
(`RIVER_HIT_TOLERANCE_PX`, needed since a river has no interior to test
against) made them easy to hover or click by accident while aiming at
something else nearby -- a country border, a lake edge -- getting in the way
of selecting the thing actually intended. Unlike the sea hover fix directly
above, the user explicitly wanted both hover *and* click blocked for rivers,
not just hover, with search remaining as the only way to select one.

### Changes

**`MapCanvas.tsx`**
- `hitTestScreenPoint()` no longer checks rivers at all -- the `findRiverAt`
  call and its `riverToleranceDegrees` conversion were removed from the
  function entirely, rather than filtering the result afterward. A
  click/hover near a river now just falls through to whatever's underneath
  (land, or the sea fallback), exactly the same "falls through when nothing
  else is there" pattern seas already used for click.
- Because `hitTestScreenPoint` can now never resolve to a river,
  `drawHighlights()`'s hover branch no longer needs a river type-check or a
  LineString-vs-AreaGeometry branch at all (rivers were the only LineString
  entity type) -- simplified back to an unconditional `strokeGeometry` call,
  guarded only by the pre-existing sea exclusion.
- Removed the now-unused `findRiverAt` import and `RIVER_HIT_TOLERANCE_PX`
  constant (both were only ever referenced from the removed hit-test branch).
  `SHOW_RIVERS`'s comment updated to note it no longer has any bearing on
  click/hover, only on the visible line layer.

### Decisions
- **Excluded at the single hit-testing choke point, not filtered per-caller**
  -- `hitTestScreenPoint` already drives both `onPointerMove` (hover) and
  `onPointerUp` (click), so removing the river branch there fixes both at
  once and cleanly, instead of adding a type-check in two separate places
  (as the sea fix above did deliberately, for a narrower hover-only scope).
- **Full exclusion, not hover-only like seas** -- confirmed explicitly with
  the user this time: unlike seas (still click-selectable, only hover was
  noisy), rivers' hit-test tolerance was actively interfering with selecting
  other nearby entities, so click needed to go too. Search remains fully
  unaffected either way -- `SearchBox.tsx` calls
  `interactionStore.toggleEntity`/`requestFocus` directly by id, never
  through `hitTestScreenPoint`.

---

## 2026-08-13 — Sea/ocean hover highlight suppressed (follow-up)

### Summary
Same-day follow-up to the camera fly-to entry above. User-reported: hovering
over open ocean bordered the whole sea/ocean polygon, which for
antimeridian-spanning seas (Pacific, Southern Ocean, ...) draws a huge,
distracting stroke across most of the visible map instead of a small,
readable outline. Confirmed scope with the user before touching anything:
fix hover only, leave direct click-to-select and search-to-select on seas
working exactly as before.

### Changes

**`MapCanvas.tsx`**
- `drawHighlights()`'s hover branch now skips the stroke entirely when
  `hovered.type === "sea"` -- `hoverGraphic` is left empty for seas, no
  border drawn on hover. Selection (`selectionGraphic`, driven by direct
  click or search) is untouched -- clicking a sea directly still highlights
  it, same as searching one does.

### Decisions
- **Hover-only fix, not a hit-testing change** -- confirmed with the user
  against the alternative (seas fully inert to direct map interaction,
  selectable only via search). Chosen as the smaller, more contained change:
  `hitTestScreenPoint`/`findEntityAt` and the click-selection path are
  untouched, only the passive hover stroke is suppressed.

---

## 2026-08-13 — Camera fly-to on search select (Phase 5, first step)

### Summary
First piece of roadmap Phase 5 (Smart Camera), which had been entirely
unimplemented until now -- selecting an entity previously only highlighted
it in place, with no camera reaction. City focus is out of scope (no city
entities yet, per the water-bodies-era decision to defer cities). Trigger is
deliberately scoped to search selection only for this first pass: a plain
(non-additive) click on a search result now flies the camera to frame that
entity; direct map clicks still only select, unchanged, since flying on every
map click would fight with the existing ctrl/cmd multi-select feature.
Needed no new animation system -- reused the camera's existing
target/`lerpCamera` easing loop that wheel-zoom already drives.

### Changes

**`camera.ts`**
- New `focusOnBounds(bounds, screenWidth, screenHeight, baseScaleX, baseScaleY,
  maxZoom, padding = 0.8)` -- computes the `Camera` (x/y/zoom) needed to
  center and fit a world-space `WorldBounds` in the viewport with padding,
  reusing `clampCamera` to keep the result within `[MIN_ZOOM, maxZoom]` and
  on-screen. Takes `WorldBounds` (the same space `render.ts`'s `project()`
  outputs), not raw lon/lat, so `camera.ts` stays free of a `render.ts`
  dependency -- callers project an entity's lon/lat `boundingBox` into world
  space first. New `MIN_BOUNDS_SPAN` constant guards a near-zero-size bbox
  (a point-like entity) from producing `Infinity`/`NaN` zoom.

**`interactionStore.ts`**
- New decoupled focus-request channel -- `onFocusRequest(listener)` /
  `requestFocus(id)` -- separate from the existing `subscribe`/`emit` used
  for selection/hover state. A focus request isn't a state change, so it
  deliberately doesn't fire unrelated subscribers like `drawHighlights`;
  keeps "fly the camera to X" decoupled from selection so a future
  click-to-focus feature (or multi-select) doesn't inherit fly behavior by
  accident.

**`SearchBox.tsx`**
- `selectResult` now calls `interactionStore.requestFocus(entity.id)` right
  after `toggleEntity`, only on a plain (non-additive) click. Ctrl/cmd+click
  deliberately does not trigger focus -- with more than one result
  ctrl+clicked in a row there's no single unambiguous entity to frame.

**`MapCanvas.tsx`**
- New `interactionStore.onFocusRequest` handler registered next to the
  existing `interactionStore.subscribe(drawHighlights)` call: looks the
  entity up via the existing local `findById`, projects its lon/lat
  `boundingBox` into world space via `project()` (with the lat inversion --
  `project()`'s `y = (90 - lat) / 180 * WORLD_HEIGHT`, so `minLat` maps to
  the world-space `maxY` and vice versa), calls `focusOnBounds`, and sets
  `target`. Only `target` is set -- the ticker's existing `lerpCamera` call
  (`applyCameraTransform`) eases `current` toward it every frame, exactly
  like wheel-zoom already does, so the fly animation needed zero new
  per-frame logic. `unsubscribeFocus` hoisted alongside the existing
  `unsubscribeInteraction` and called in the same cleanup.

### Decisions
- **Reused the existing target/`lerpCamera` easing loop instead of a new
  tween system** -- wheel-zoom already established "mutate `target`, let the
  ticker ease `current` toward it" as the pattern; a fly-to is just another
  way to compute a new `target`.
- **Search-only trigger for this pass** -- plain map clicks intentionally
  don't fly the camera, to avoid fighting ctrl/cmd multi-select; can be
  extended to click-to-focus later without touching this plumbing.
- **Decoupled focus-request channel, not reusing `selectedEntityIds`
  change** -- keeps "fly to X" independent of selection state, so selecting
  without flying (e.g. future multi-select flows) stays possible.

### Deferred / not yet implemented
- No fly-to on direct map click, only search selection.
- No fly-to on ctrl/cmd multi-select from search (ambiguous target).
- Antimeridian-crossing entities (Russia, Fiji) still have the pre-existing
  `computeBoundingBox` gap (no antimeridian handling) -- fly-to will
  zoom out further than ideal for those specifically. Not introduced by this
  change; was already documented in `entities.ts` as deferred to Phase 5.
- City focus (Focus City) -- no city entities yet.

---

## 2026-08-12 — Rivers gated behind VITE_SHOW_RIVERS (follow-up)

### Summary
User request, same day as the water-bodies work above: gate river
rendering behind a build-time env flag, mirroring `VITE_SHOW_LABELS`'s
existing pattern exactly, off by default. Unlike that flag (which skips
building the label objects entirely when off), rivers needed a narrower
cut: `riverEntities` must still exist even with the flag off, since the
user explicitly wants rivers to stay selectable via both click and search
regardless of whether the lines are drawn.

### Changes

**`.env`**
- New `VITE_SHOW_RIVERS=false`, documented the same way `VITE_SHOW_LABELS`
  already is.

**`MapCanvas.tsx`**
- New `SHOW_RIVERS = import.meta.env.VITE_SHOW_RIVERS === "true"` constant.
- `riverEntities = buildRiverEntities(...)` stays unconditional -- it feeds
  `interactionStore.setEntities`, `allEntities` (for the highlight overlay),
  and `hitTestScreenPoint`'s `findRiverAt` call regardless of the flag.
  Only the `riversLayer` construction (building each river's `Graphics`,
  calling `strokeLine`, adding the layer to `worldContainer`) is now inside
  `if (SHOW_RIVERS) { ... }` -- when off, that whole block plus its
  per-river `strokeLine` draw calls are skipped entirely, not just hidden,
  same "skip the cost, not just hide the result" approach `SHOW_LABELS`
  already established for country/state labels.

### Decisions
- **Entities always built, only the visible layer gated** -- a narrower cut
  than `SHOW_LABELS` (which skips `buildLabelEntities` entirely when off)
  because labels are a pure display derivative with no independent
  interaction value, while rivers are real selectable entities the user
  explicitly wants reachable via click and search even when not drawn.
- **Not verified live in-browser this pass** -- the chrome-devtools MCP
  session hit a stale-profile lock conflict from a leftover browser
  instance and wouldn't reconnect; killing Chrome processes blindly to
  force a retry risked disrupting a different, possibly-still-active
  session, so this was left unverified visually rather than risking that.
  Confidence instead comes from `tsc --noEmit` passing clean and the change
  being a narrow conditional wrapped around code that was already
  browser-verified working in the Rivers stage above -- worth an actual
  visual check (`VITE_SHOW_RIVERS=true` in `.env.local`, confirm rivers
  render; default `false`, confirm they don't but search/click still finds
  them) next time the environment is available.

---

## 2026-08-12 — Sea/ocean labels removed entirely (follow-up to Stage 3)

### Summary
Same-day follow-up to the Seas entry directly below. User feedback after
seeing it live: a permanently-visible label for all 306 seas/oceans/gulfs/
bays/straits was too cluttered, even with the existing collision-placement
pass culling most of them at any given zoom. First discussed a middle
ground (show a sea's label only while it's selected or searched, piggy-
backing on `drawHighlights`), but once it was clear plain removal was
simpler and matched what the user actually wanted, went with that instead.

### Changes

**`MapCanvas.tsx`**
- Removed `seaLabelsLayer`, `seaLabelObjects`, `SEA_LABEL_STYLE`, and their
  `counterScaleLabelLayer`/declutter call sites entirely. Seas now render
  no label at all, ever, by default.
- `declutterLabels` reverted from the `declutterLabelLayer`-extraction
  refactor back to a single-purpose function -- with the sea pass gone,
  there was only one call site left, so the extra indirection introduced
  purely to support a second layer no longer earned its keep.

### Decisions
- **Selection/search behavior deliberately left untouched** -- `seaEntities`,
  `interactionStore.setEntities`, `hitTestScreenPoint`'s sea fallback, and
  `drawHighlights`'s fill+stroke overlay never depended on the label layer;
  removing labels only removes the permanent text, not the ability to
  click or search a sea and see it highlighted. Verified in-browser:
  searched "Mediterranean", selected it, highlight rendered correctly with
  no label text visible anywhere on the map.
- **Full removal over the discussed "label on selection" middle ground** --
  simpler, and what the user actually asked for once the tradeoff was
  clear; the selection highlight itself already conveys "this is the thing
  you selected" without needing a text label alongside it.

---

## 2026-08-12 — Seas (Phase 3 water bodies, stage 3 of 3 — water bodies complete)

### Summary
Final stage of the water-bodies plan (see
`.development_logs/plan-water-bodies.md`). Unlike lakes/rivers, seas render
labels-only by design: Natural Earth's marine polygons overlap and nest
(a bay inside a gulf inside a sea inside an ocean) in ways that don't work
as disjoint filled areas, so there's no visible fill/border layer at all --
only the name renders, at the polygon's centroid, with the geometry kept
solely for hit-testing and the selection highlight. Also found and fixed a
real, pre-existing bug in the shared label font while making sea labels'
color show up correctly.

### Changes

**New vendored data (`src/map/data/marine-10m.json`)**
- Natural Earth's `ne_10m_geography_marine_polys`, all 306 features kept
  (no scale-rank filter -- already a small dataset, and nothing renders by
  default so there's no clutter/perf reason to trim it). `ne_id` isn't
  reliably unique here (two separate "Great Barrier Reef" polygons share
  one) -- assigned a synthetic `sea_id` instead, same approach as rivers'
  `river_id`. One unrepairable self-intersection flagged during
  simplification, same as lakes/rivers, but didn't happen to zero out a
  geometry this time -- all 306 render.

**`entities.ts`**
- `EntityType` gained `"sea"`. New `SeaGeoFeature`/`SeaGeoFeatureCollection`
  types and `buildSeaEntities()` -- same shape as `buildCountryEntities`,
  geometry is a plain `AreaGeometry` (no `LineGeometry` special-casing
  needed the way rivers required, since sea polygons work with the existing
  `fillGeometry`/`strokeGeometry`/`pointInPolygon` machinery as-is).
- `buildLabelEntities`'s stale comment (claimed it was "only ever called
  with country/state entities") updated now that seas go through it too.

**`loadSeasData.ts` (new)**
- Mirrors the other water-body loaders -- single resolution.

**`MapCanvas.tsx`**
- `seaEntities` built but deliberately given **no visible layer** -- no
  `CountryContainer`, no fill/stroke calls, nothing added to
  `worldContainer` for the polygons themselves. They still feed
  `interactionStore.setEntities(...)` and the highlight overlay's
  `allEntities` lookup, so `findEntityAt` and `drawHighlights` (already
  correct for `AreaGeometry`, no changes needed) can resolve and highlight
  a click into one.
- `hitTestScreenPoint` checks seas *last*, as the fallback once lake,
  river, and land (country/state) all miss -- opposite end of the priority
  order from lakes/rivers, since seas have nothing painted on top to
  justify checking them first; a click only reaches a sea by landing on
  open water with nothing else there. Verified a click on land always
  resolves to the country/state, never the sea underneath it.
- New always-visible `seaLabelsLayer` -- independent of `VITE_SHOW_LABELS`
  (that flag exists specifically for the *known* state-layer label overlap
  bug; seas are new and don't share it) and independent of
  `STATE_ZOOM_THRESHOLD` (ocean/sea names stay relevant at any zoom, unlike
  the country/state label handoff). `declutterLabels` refactored to extract
  a shared `declutterLabelLayer(layer, allLabels, bounds, scaleX, scaleY)`
  helper, so the existing country/state pass and the new sea pass reuse one
  implementation instead of two near-copies. No new reveal-threshold
  constant needed -- the existing collision-priority algorithm
  (`computeArea` as importance) naturally keeps big oceans visible over
  small straits/bays on its own.
- New `SEA_LABEL_STYLE` (`fontSize: 12, color: 0xe8f4f8`) -- light, since a
  sea label's centroid typically sits on the dark ocean background, unlike
  country/state labels which sit on light land.

**`render.ts`**
- `ensureLabelFontInstalled`'s `BitmapFont.install` call now bakes the
  shared glyph atlas in white (`fill: "#ffffff"`), not the canvas default
  (black) -- see Bugs below.

### Bugs found and fixed
1. **`SEA_LABEL_STYLE`'s light color rendered as black, not near-white.**
   `LabelText`'s per-instance `style.color` works by *multiplicatively
   tinting* the shared `BitmapFont` atlas texture, not repainting it. The
   atlas had been generated with no explicit `fill`, defaulting to
   black-inked glyphs -- multiplying black by any color stays black
   (`0 * x = 0`), so a light tint could never appear regardless of what was
   requested. Existing dark labels (country/state) happened to still look
   plausible under this bug (dark-tinting an already-dark texture reads as
   "close enough"), which is why it went unnoticed until a *light* color
   was tried and produced visibly wrong (black) text. Caught by sampling
   actual screenshot pixel colors rather than trusting the configured value
   was applied. Fixed by baking the atlas in white instead -- the only base
   color multiplicative tinting can reach *any* requested color from,
   light or dark -- and reverified existing country/state label colors
   still render correctly afterward.

### Decisions
- **Labels-only, no fill/border, by design** -- not a shortcut taken due to
  time pressure. Marine polygons genuinely don't form a disjoint partition
  the way countries/lakes do (nesting/overlap is inherent to how Natural
  Earth categorizes bays-within-gulfs-within-seas), so a filled rendering
  would need an arbitrary "which one wins the overlap" rule with no
  correct answer. Keeping the geometry for hit-testing/highlighting only
  sidesteps that entirely -- the highlight only ever shows *one* sea at a
  time (whichever was clicked), so overlap never has to be resolved
  visually.
- **Reused the existing label collision-priority algorithm instead of a new
  zoom threshold** -- consistent with how lakes/rivers avoided inventing
  new zoom-threshold constants where an existing mechanism already applied.
- **Sea labels independent of both existing label gates
  (`VITE_SHOW_LABELS`, `STATE_ZOOM_THRESHOLD`)** -- both exist for reasons
  specific to country/state labels that don't apply to seas.

### Deferred / not yet implemented
- Cities (explicitly skipped this whole pass, per user request).
- The pre-existing WebGL `Insufficient buffer size` warning noted in the
  rivers entry above -- still unfixed, still unrelated to water bodies.

### Water bodies (lakes, rivers, seas) — complete
All three stages of the water-bodies plan are done. Roadmap Phase 3's
"Geographic Details" list (states, cities, rivers, lakes) now only has
cities remaining, deferred per explicit user request rather than started.

---

## 2026-08-12 — Rivers (Phase 3 water bodies, stage 2 of 3)

### Summary
Second stage of the water-bodies plan (see
`.development_logs/plan-water-bodies.md`). Rivers are the first entity type
in the codebase with genuinely new geometry -- every existing render/hit-test
primitive (`fillGeometry`, `strokeGeometry`, `pointInPolygon`, `computeArea`,
`computeCentroid`) is built for `Polygon`/`MultiPolygon` only, and a river is
an open `LineString`/`MultiLineString` path with no interior.

### Changes

**New vendored data (`src/map/data/rivers-10m.json`)**
- Natural Earth's `ne_10m_rivers_lake_centerlines`, filtered to
  `scalerank <= 6` (490 of 1455 source features) to drop minor tributaries.
  Unlike lakes, the source has no natural unique key (no `ne_id` here) --
  assigned a synthetic `river_id` (array index) at vendoring time, baked in
  as the topojson id-field. Simplified 8% via mapshaper; one feature (the
  Loire) collapsed to a `null` geometry the same way one lake did, for the
  same reason (an unrepairable self-intersection flagged during simplify) --
  489 of 490 render.

**`loadWorldData.ts`**
- New `LineStringGeometry`/`MultiLineStringGeometry`, aliased as
  `LineGeometry`, added to the broader `Geometry` union alongside the
  existing `AreaGeometry`/`PointGeometry`.

**`entities.ts`**
- `EntityType` gained `"river"`. New `RiverGeoFeature`/
  `RiverGeoFeatureCollection` types and `buildRiverEntities()` -- same shape
  and null-geometry-filtering/missing-name-fallback approach as
  `buildLakeEntities`.
- `computeBoundingBox` gained a `LineString`/`MultiLineString` branch --
  point sequences one level shallower than a polygon's rings, so it's its
  own early return rather than reusing the polygon loop.
- New `pointNearLine()` (river equivalent of `pointInPolygon` -- distance-
  to-segment against a tolerance, not a ray-cast, since a line has no
  interior) built on a new `squaredDistanceToSegment()` helper, plus
  `findRiverAt()` (river equivalent of `findEntityAt`, with the bounding-box
  prefilter grown by the tolerance on every side). Deliberately skips
  `splitAtAntimeridian` -- that helper's ring-closure step assumes a closed
  ring, which doesn't hold for an open path, and no vendored river actually
  crosses the antimeridian.

**`loadRiversData.ts` (new)**
- Mirrors `loadLakesData.ts`/`loadStatesData.ts` -- single resolution.

**`render.ts`**
- New `strokeLine()` -- rivers' line equivalent of `strokeGeometry`, same
  `pixelLine` primitive but drawn open (`poly(points, false)`) instead of
  closed, since a river is a path, not a ring, and has no fill concept.

**`MapCanvas.tsx`**
- New `riversLayer`, added between `statesLayer` and `lakesLayer` per
  architecture.md's layer order (Countries → States → Cities → Rivers →
  Lakes). Plain `Graphics` per river (no `CountryContainer` -- nothing to
  fill), always-visible like lakes, same "no ~4600-entity perf concern"
  reasoning (490 rivers).
- `hitTestScreenPoint` now checks rivers after lakes, before falling
  through to state/country -- same paint-order-follows-hit-priority
  reasoning as lakes, with a new `RIVER_HIT_TOLERANCE_PX` (6px) converted to
  lon/lat degrees at hit-test time (using the current zoom/baseScale) so the
  click target stays a constant on-screen size rather than a fixed
  geographic distance.
- `drawHighlights` needed an actual code change, not just new data: its
  existing `fillGeometry`/`strokeGeometry` calls are typed to `AreaGeometry`
  and would silently misrender a selected/hovered river (force-cast despite
  really being `LineGeometry`). Added a `LineString`/`MultiLineString`
  branch to both the selection and hover paths that calls `strokeLine`
  instead.
- `riverEntities` folded into `interactionStore.setEntities(...)` and the
  highlight overlay's `allEntities` lookup, same as lakes -- no changes
  needed in `SearchBox.tsx`/`interactionStore.ts`.

### Decisions
- **Constant-pixel hit-test tolerance, not a fixed degree value** -- a
  river has no interior to test against, so "close enough" has to mean a
  consistent on-screen distance regardless of zoom, converted to lon/lat
  degrees at the point of use rather than baked into the entity data.
- **No antimeridian handling for rivers** -- `strokeLine`/`pointNearLine`
  both skip it deliberately; applying `splitAtAntimeridian`'s ring-closure
  logic to an open path risks stitching two unrelated ends of a river
  together, and no real river in the vendored data crosses the dateline
  anyway. Lower stakes either way than the polygon cases that motivated the
  original fix.
- **Synthetic id, not a natural key** -- rivers have no `ne_id`-equivalent
  in the source data, unlike lakes; an array-index id assigned once at
  vendoring time is stable enough for a vendored snapshot, with the same
  caveat any such id has (would need reassigning on a re-vendor with a
  different filter/order).

### Investigated, ruled out as unrelated
- A `GL_INVALID_OPERATION: Insufficient buffer size` WebGL warning appeared
  during in-browser verification. Isolated via `git stash` back to the
  already-committed lakes-only baseline (before any river code existed) --
  it reproduces there too, on a clean reload with zero interaction. Same
  family as the known Pixi/React.StrictMode double-invoke pooled-buffer bug
  already documented in this changelog (Phase 3b, bug #2) -- apparently a
  lower total-draw-call threshold triggers it than what was measured back
  then, not something introduced by rivers. Not fixed in this pass; worth
  a dedicated look since it now reproduces without any label code involved
  at all (`VITE_SHOW_LABELS` is off).

### Deferred / not yet implemented
- Seas (stage 3 of the water-bodies plan).
- The pre-existing WebGL buffer warning noted above.
- Cities (explicitly skipped, per user request).

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
