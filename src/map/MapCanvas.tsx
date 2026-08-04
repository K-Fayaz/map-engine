import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { loadWorldData, type Resolution, type AreaGeometry } from "./loadWorldData";
import { loadStatesData } from "./loadStatesData";
import {
  buildCountryEntities,
  buildStateEntities,
  buildLabelEntities,
  findEntityAt,
  type Entity,
} from "./entities";
import {
  fillGeometry,
  strokeGeometry,
  unproject,
  CountryContainer,
  LabelText,
  counterScaleLabelLayer,
  type LabelStyle,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from "./render";
import {
  type Camera,
  MIN_ZOOM,
  clampCamera,
  zoomAt,
  lerpCamera,
  viewportWorldBounds,
  screenToWorld,
} from "./camera";
import { placeLabelsWithoutOverlap, type LabelCandidate } from "./labelLayout";
import { interactionStore } from "./interactionStore";

// Labels (country/state) are mid-rework -- state-layer decluttering still
// has known overlap issues (see .development_logs/changelog.md). Off by
// default via .env so a fresh clone doesn't show the rough edges; flip to
// "true" in .env.local (gitignored) while actively working on labels.
// Build-time flag, not a live in-app toggle -- changing it needs a dev
// server restart / rebuild.
const SHOW_LABELS = import.meta.env.VITE_SHOW_LABELS === "true";

const OCEAN_COLOR = 0x068494;
const LAND_COLOR = 0xf5f5f2;
// Lighter than render.ts's country BORDER_COLOR (0x4a4a4a) so state
// boundaries read as subordinate to country borders. Can't lean on width to
// do that instead -- see strokeGeometry's comment on why pixelLine ignores
// it.
const STATE_BORDER_COLOR = 0xa8a8a8;
// Smaller and lighter than render.ts's default label style, same
// subordinate-to-country relationship as STATE_BORDER_COLOR above.
const STATE_LABEL_STYLE: LabelStyle = { fontSize: 10, color: 0x555555 };

// How far past the default view (world exactly fills the screen) the user
// can zoom in. Arbitrary reasonable cap for V1 -- there's no Phase 3
// city/state detail yet to justify a specific number, revisit once that
// exists.
const MAX_ZOOM = 16;

// Fraction of the current->target gap closed per tick (~60fps), giving the
// eased-zoom feel without full momentum/velocity physics.
const EASE_FACTOR = 0.2;

// Tuned by feel: how much a single wheel tick's deltaY changes zoom.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

// Zoom level past which the higher-detail 10m dataset swaps in. Swapping
// back down to 50m only happens below threshold * LOD_HYSTERESIS, so
// hovering right at the boundary doesn't repeatedly reload both datasets.
const LOD_ZOOM_THRESHOLD = 4;
const LOD_HYSTERESIS = 0.85;
const LOD_DEBOUNCE_MS = 150;

// Same debounce duration as LOD_DEBOUNCE_MS, but a logically separate
// trigger: label decluttering needs to re-run on *panning* too (the
// viewport shifts, so which labels are candidates changes), unlike the LOD
// swap, which panning alone can never affect.
const LABEL_DECLUTTER_DEBOUNCE_MS = 150;

// Threshold past which states become visible. Deeper than
// LOD_ZOOM_THRESHOLD since states are a finer detail level than 10m country
// fill -- tuned by feel, same as the other zoom constants here.
const STATE_ZOOM_THRESHOLD = 6;

// A pointerdown/pointerup pair whose cursor never moved more than this many
// screen pixels counts as a click (select/deselect); anything past it is a
// drag (pan), not a click -- Phase 2's drag handling never needed to make
// this distinction since it had nothing else pointer events could mean.
const CLICK_MOVE_THRESHOLD_PX = 4;

// Selection reads as stronger than hover: brighter stroke, more opaque
// fill tint. Both are translucent so the underlying country/state fill and
// borders stay visible underneath.
const HOVER_COLOR = 0xffd54a;
const HOVER_FILL_ALPHA = 0.15;
const SELECTION_COLOR = 0xffa000;
const SELECTION_FILL_ALPHA = 0.3;

// Toggles a layer's visibility based on zoom. Unlike the LOD fill swap
// above, nothing gets rebuilt here, so this is cheap enough to run every
// tick straight off the eased camera zoom instead of needing
// scheduleLodCheck's debounce -- no risk of "thrashing" when a flag flip is
// the only cost. Reused by whichever Phase 3 layer needs a "hidden until
// zoomed in" reveal next (labels, cities, rivers/lakes).
function setVisibleAboveZoom(layer: Container, zoom: number, threshold: number) {
  layer.visible = zoom > threshold;
}

// Complementary "hidden once zoomed in" version, for country labels: they
// show at the default view and hide the moment state labels take over at
// the same STATE_ZOOM_THRESHOLD, rather than both being visible at once.
function setVisibleAtOrBelowZoom(layer: Container, zoom: number, threshold: number) {
  layer.visible = zoom <= threshold;
}

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const app = new Application();
    // Hoisted out of the .then() below (unlike everything else there) --
    // interactionStore is a persistent module-level singleton, not
    // recreated per mount like `app` is, so a StrictMode double-invoke
    // cleanup must actually unsubscribe or it leaks one subscriber per
    // discarded mount.
    let unsubscribeInteraction: (() => void) | null = null;

    app
      .init({
        resizeTo: container,
        backgroundColor: OCEAN_COLOR,
        antialias: true,
      })
      .then(() => {
        if (cancelled) {
          // releaseGlobalResources clears Pixi's pooled batcher buffers on
        // cleanup -- without it, React.StrictMode's dev-mode double-invoke
        // (mount -> cleanup -> mount again) leaves the second Application
        // with a stale, undersized buffer inherited from the first, which
        // then throws "GL_INVALID_OPERATION: glDrawElements: Insufficient
        // buffer size" once enough BitmapText glyph batches are drawn to
        // exceed it (see https://github.com/pixijs/pixijs/discussions/11678).
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
          return;
        }

        container.appendChild(app.canvas);

        // Base per-axis stretch so the world exactly fills the screen at
        // zoom = 1 -- matches the original non-uniform "always fills the
        // window" behavior. Camera x/y/zoom then layers a uniform pan/zoom
        // transform on top, recomputed on resize.
        let baseScaleX = app.screen.width / WORLD_WIDTH;
        let baseScaleY = app.screen.height / WORLD_HEIGHT;

        // Country containers are built once, from 50m data, and persist for
        // the lifetime of the map -- both their identity (useful later for
        // Phase 4 selection, which shouldn't lose its target every time the
        // LOD resolution changes) and their `stroke` child (pixelLine,
        // zoom-invariant, and always sourced from this same 50m geometry
        // regardless of which resolution is currently showing -- see
        // render.ts's strokeGeometry for why that avoids ever needing a
        // rebuild). Only `fill` -- on every country, plus `land` -- gets
        // redrawn when the LOD resolution actually changes.
        const initialWorld = loadWorldData("50m");
        const borderEntities = buildCountryEntities(initialWorld.countries);

        const worldContainer = new Container();

        const land = new Graphics();
        worldContainer.addChild(land);

        const countriesLayer = new Container();
        const countryContainers = borderEntities.map((entity) => {
          const c = new CountryContainer(entity);
          // Safe: borderEntities comes from buildCountryEntities, which never
          // produces label (Point) geometry -- entity.geometry's static type
          // is just the broader Entity-wide Geometry union.
          strokeGeometry(c.stroke, entity.geometry as AreaGeometry);
          countriesLayer.addChild(c);
          return c;
        });
        worldContainer.addChild(countriesLayer);

        // States sit above countries in the layer stack (see
        // architecture.md's layer list). They only ship at one resolution
        // (10m) -- no LOD swap needed, see loadStatesData.ts -- so, unlike
        // countries, containers are built once and never touched again.
        // Border only, no fill: the country/land fill underneath already
        // colors the area, and a state fill only becomes useful once Phase 4
        // selection needs one to highlight. Starts hidden to avoid a one-
        // frame flash before the ticker's setVisibleAboveZoom takes over.
        const stateEntities = buildStateEntities(loadStatesData(), initialWorld.countries);
        const statesLayer = new Container();
        statesLayer.visible = false;
        for (const entity of stateEntities) {
          const c = new CountryContainer(entity);
          // Safe: same reasoning as the countryContainers cast above --
          // buildStateEntities never produces label geometry either.
          strokeGeometry(c.stroke, entity.geometry as AreaGeometry, STATE_BORDER_COLOR);
          statesLayer.addChild(c);
        }
        worldContainer.addChild(statesLayer);

        // Feeds Phase 4 interaction (search, and eventually anything else
        // that needs to look an entity up by id from outside this effect) --
        // countries and states only, no labels (they're derived display
        // artifacts, not user-facing selectable entities).
        interactionStore.setEntities([...borderEntities, ...stateEntities]);

        // Labels sit above everything (see architecture.md's layer list --
        // Labels is the topmost layer). They're children of worldContainer
        // too, not a separate top-level overlay: that way each label's
        // *position* rides worldContainer's existing pan/zoom transform for
        // free (see render.ts's LabelText), and only *scale* needs
        // correcting per tick to keep text a constant screen size despite
        // that same transform.
        //
        // The label *objects* are all built upfront (countryLabelObjects /
        // stateLabelObjects), but the layers themselves start empty --
        // declutterLabels() (below) is what actually attaches/detaches
        // labels as Pixi children, adding only whatever survives viewport
        // culling + collision placement. Measured directly that this
        // matters, not just tidiness: leaving all ~4600 state labels
        // permanently parented (even individually hidden via
        // `.visible = false`) caused several hundred ms of one-time cost
        // somewhere in Pixi's own render/bounds pipeline the moment their
        // shared parent container first turned visible -- not reproducible
        // by timing this file's own JS, so it's Pixi-internal cost that
        // scales with a container's actual child count. Keeping the live
        // child count down to only what's currently placed (tens, not
        // thousands) avoids it.
        // Empty arrays when SHOW_LABELS is off -- skips buildLabelEntities/
        // LabelText/BitmapFont-install cost entirely, not just hiding the
        // result. The layers themselves are still created (declutterLabels,
        // counterScaleLabelLayer etc. all reference them unconditionally),
        // but stay empty, so every downstream label operation becomes a
        // no-op over a 0-length array/child list rather than needing
        // SHOW_LABELS checks sprinkled through this whole file.
        const countryLabelObjects = SHOW_LABELS
          ? buildLabelEntities(borderEntities).map((entity) => new LabelText(entity))
          : [];
        const countryLabelsLayer = new Container();
        worldContainer.addChild(countryLabelsLayer);

        const stateLabelObjects = SHOW_LABELS
          ? buildLabelEntities(stateEntities).map((entity) => new LabelText(entity, STATE_LABEL_STYLE))
          : [];
        const stateLabelsLayer = new Container();
        stateLabelsLayer.visible = false;
        worldContainer.addChild(stateLabelsLayer);

        // Selection/hover highlight -- last child of worldContainer so it
        // renders above labels too, avoiding having to pick between the two
        // label layers for z-order. Two persistent Graphics, redrawn (not
        // rebuilt) only when the store's selected/hovered id actually
        // changes -- see drawHighlights below, wired to
        // interactionStore.subscribe near the label-declutter setup.
        const highlightLayer = new Container();
        const hoverGraphic = new Graphics();
        const selectionGraphic = new Graphics();
        highlightLayer.addChild(hoverGraphic);
        highlightLayer.addChild(selectionGraphic);
        worldContainer.addChild(highlightLayer);

        const allEntities = [...borderEntities, ...stateEntities];
        function findById(id: string | null): Entity | undefined {
          if (!id) return undefined;
          return allEntities.find((e) => e.id === id);
        }

        // Redraws whichever of the two highlight graphics changed. Hover is
        // skipped when it matches the current selection -- otherwise the
        // stronger selection highlight would sit underneath a redundant,
        // weaker hover highlight of the exact same shape.
        function drawHighlights() {
          const { selectedEntityId, hoveredEntityId } = interactionStore.getState();

          selectionGraphic.clear();
          const selected = findById(selectedEntityId);
          if (selected) {
            const geometry = selected.geometry as AreaGeometry;
            fillGeometry(selectionGraphic, geometry, SELECTION_COLOR, SELECTION_FILL_ALPHA);
            strokeGeometry(selectionGraphic, geometry, SELECTION_COLOR);
          }

          hoverGraphic.clear();
          if (hoveredEntityId && hoveredEntityId !== selectedEntityId) {
            const hovered = findById(hoveredEntityId);
            if (hovered) {
              const geometry = hovered.geometry as AreaGeometry;
              fillGeometry(hoverGraphic, geometry, HOVER_COLOR, HOVER_FILL_ALPHA);
              strokeGeometry(hoverGraphic, geometry, HOVER_COLOR);
            }
          }
        }

        app.stage.addChild(worldContainer);

        let resolution: Resolution = "50m";

        function applyFill(nextResolution: Resolution) {
          resolution = nextResolution;
          const world = resolution === "50m" ? initialWorld : loadWorldData(resolution);

          land.clear();
          for (const f of world.land.features) {
            fillGeometry(land, f.geometry, LAND_COLOR);
          }

          const fillEntities = new Map(
            (resolution === "50m" ? borderEntities : buildCountryEntities(world.countries)).map(
              (e) => [e.id, e],
            ),
          );
          for (const c of countryContainers) {
            const match = fillEntities.get(c.entity.id);
            c.fill.clear();
            // Safe: same reasoning as above -- fillEntities is built from
            // buildCountryEntities, never label entities.
            if (match) fillGeometry(c.fill, match.geometry as AreaGeometry, LAND_COLOR);
          }
        }

        applyFill("50m");

        // Camera state: current is what's actually rendered each frame,
        // eased toward target by the ticker. No pan/zoom input is wired up
        // yet (that's the next todos) -- for now both start at the default
        // view (zoom = 1, world exactly fills the screen) and stay there.
        let current: Camera = { x: 0, y: 0, zoom: 1 };
        let target: Camera = { ...current };

        // Applies the current camera state to the scene graph -- called
        // once synchronously below (so the initial declutterLabels() call
        // sees correct transforms instead of Pixi's default (1,1) scale,
        // before the ticker has ever run) and every tick thereafter.
        function applyCameraTransform() {
          current = lerpCamera(current, target, EASE_FACTOR);
          worldContainer.position.set(current.x, current.y);
          worldContainer.scale.set(baseScaleX * current.zoom, baseScaleY * current.zoom);
          setVisibleAboveZoom(statesLayer, current.zoom, STATE_ZOOM_THRESHOLD);
          setVisibleAboveZoom(stateLabelsLayer, current.zoom, STATE_ZOOM_THRESHOLD);
          setVisibleAtOrBelowZoom(countryLabelsLayer, current.zoom, STATE_ZOOM_THRESHOLD);
          counterScaleLabelLayer(countryLabelsLayer, baseScaleX, baseScaleY, current.zoom);
          counterScaleLabelLayer(stateLabelsLayer, baseScaleX, baseScaleY, current.zoom);
        }
        applyCameraTransform();

        const onResize = () => {
          const { width, height } = app.screen;
          baseScaleX = width / WORLD_WIDTH;
          baseScaleY = height / WORLD_HEIGHT;
          current = clampCamera(current, width, height, MAX_ZOOM);
          target = clampCamera(target, width, height, MAX_ZOOM);
          scheduleLabelDeclutter();
        };
        app.renderer.on("resize", onResize);

        // Hit-tests a screen-space point against whichever entity layer is
        // currently active for interaction -- states once zoomed in past
        // STATE_ZOOM_THRESHOLD, countries otherwise. Same threshold
        // declutterLabels uses for the same "which layer is live" question.
        function hitTestScreenPoint(screenX: number, screenY: number): Entity | undefined {
          const [wx, wy] = screenToWorld(current, screenX, screenY, baseScaleX, baseScaleY);
          const [lon, lat] = unproject(wx, wy);
          const candidates = current.zoom > STATE_ZOOM_THRESHOLD ? stateEntities : borderEntities;
          return findEntityAt(candidates, lon, lat);
        }

        // Drag pan: tracks the cursor 1:1 (no easing/momentum, per Phase 2
        // scope), so both current and target are set directly on move
        // rather than letting the ticker lerp toward a target. Pointer
        // capture keeps the drag going even if the cursor leaves the
        // canvas mid-drag, instead of needing pointerleave handling.
        const canvas = app.canvas;
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartCameraX = 0;
        let dragStartCameraY = 0;
        // Tracks whether this pointerdown/up pair has moved past
        // CLICK_MOVE_THRESHOLD_PX yet -- distinguishes a click (select) from
        // a drag (pan), since onPointerDown/onPointerUp alone can't tell
        // those apart (both start/end with dragging = true/false).
        let movedPastClickThreshold = false;

        const onPointerDown = (e: PointerEvent) => {
          dragging = true;
          movedPastClickThreshold = false;
          dragStartX = e.offsetX;
          dragStartY = e.offsetY;
          dragStartCameraX = current.x;
          dragStartCameraY = current.y;
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = "grabbing";
        };

        const onPointerMove = (e: PointerEvent) => {
          if (!dragging) {
            const hit = hitTestScreenPoint(e.offsetX, e.offsetY);
            interactionStore.hoverEntity(hit?.id ?? null);
            canvas.style.cursor = hit ? "pointer" : "grab";
            return;
          }

          if (
            !movedPastClickThreshold &&
            Math.hypot(e.offsetX - dragStartX, e.offsetY - dragStartY) > CLICK_MOVE_THRESHOLD_PX
          ) {
            movedPastClickThreshold = true;
          }

          const { width, height } = app.screen;
          const next = clampCamera(
            {
              x: dragStartCameraX + (e.offsetX - dragStartX),
              y: dragStartCameraY + (e.offsetY - dragStartY),
              zoom: current.zoom,
            },
            width,
            height,
            MAX_ZOOM,
          );
          current = next;
          target = next;
          scheduleLabelDeclutter();
        };

        const onPointerUp = (e: PointerEvent) => {
          dragging = false;
          canvas.releasePointerCapture(e.pointerId);
          canvas.style.cursor = "grab";

          if (!movedPastClickThreshold) {
            const hit = hitTestScreenPoint(e.offsetX, e.offsetY);
            interactionStore.selectEntity(hit?.id ?? null);
          }
        };

        canvas.style.cursor = "grab";
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);

        // Debounced off wheel events (panning alone never changes zoom, so
        // it can't cross the LOD threshold) so a continuous scroll only
        // triggers one fill refresh after it stops, rather than one per
        // tick. Only actually calls applyFill when the resolution genuinely
        // needs to change -- borders never need touching here at all.
        let lodTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLodCheck = () => {
          if (lodTimeout !== null) clearTimeout(lodTimeout);
          lodTimeout = setTimeout(() => {
            lodTimeout = null;
            if (cancelled) return;
            if (resolution === "50m" && current.zoom > LOD_ZOOM_THRESHOLD) {
              applyFill("10m");
            } else if (
              resolution === "10m" &&
              current.zoom < LOD_ZOOM_THRESHOLD * LOD_HYSTERESIS
            ) {
              applyFill("50m");
            }
          }, LOD_DEBOUNCE_MS);
        };

        // Declutters whichever label layer is currently active (matches the
        // same current.zoom > STATE_ZOOM_THRESHOLD check the ticker uses for
        // layer visibility, so the two always agree on which layer is
        // "live"). Two passes over *all* of that layer's label objects
        // (not just its current children -- see the layer-building comment
        // above for why child count is kept minimal):
        //  1. Cull to labels inside the current viewport (see camera.ts's
        //     viewportWorldBounds) -- cheap numeric comparisons against
        //     each label's world-space position, no Pixi work, so doing
        //     this over all ~4600 state labels every time is fine.
        //  2. For only the (much smaller) surviving candidates, compute
        //     their screen-space box and run them through labelLayout.ts's
        //     greedy collision placement. Collision winners get attached;
        //     losers stay detached -- keeping labels as actual children
        //     even while invisible is exactly the cost this whole
        //     attach/detach approach exists to avoid.
        //
        // The screen-space box is computed directly from data already
        // trusted here (world position + camera state), *not* Pixi's
        // getBounds(): getBounds() composes through the parent chain, which
        // Pixi only updates lazily during its own render cycle. Calling it
        // synchronously right after addChild -- the first version of this
        // function did -- returned (0,0,0,0) every time, which silently
        // broke collision detection (every pair of zero-size boxes reads as
        // "not overlapping", so nothing ever lost). label.width/height are
        // local-only and correct immediately, parent or not -- but they
        // reflect the label's *current* .scale, which the ticker's
        // counterScaleLabelLayer only updates for already-attached
        // children, so a label becoming a candidate for the first time this
        // cycle needs that correction applied here explicitly too.
        function declutterLabels() {
          const isStates = current.zoom > STATE_ZOOM_THRESHOLD;
          const layer = isStates ? stateLabelsLayer : countryLabelsLayer;
          const allLabels = isStates ? stateLabelObjects : countryLabelObjects;
          const { width, height } = app.screen;
          const bounds = viewportWorldBounds(current, width, height, baseScaleX, baseScaleY);
          const scaleX = baseScaleX * current.zoom;
          const scaleY = baseScaleY * current.zoom;

          const candidates: LabelCandidate[] = [];
          const candidateLabels: LabelText[] = [];

          for (const label of allLabels) {
            const { x: wx, y: wy } = label.position;
            if (wx < bounds.minX || wx > bounds.maxX || wy < bounds.minY || wy > bounds.maxY) {
              if (label.parent === layer) layer.removeChild(label);
              continue;
            }
            label.scale.set(1 / scaleX, 1 / scaleY);
            const screenX = current.x + wx * scaleX;
            const screenY = current.y + wy * scaleY;
            candidates.push({
              id: label.entity.id,
              importance: label.entity.metadata?.area ?? 0,
              x: screenX - label.width / 2,
              y: screenY - label.height / 2,
              width: label.width,
              height: label.height,
            });
            candidateLabels.push(label);
          }

          const keep = placeLabelsWithoutOverlap(candidates);
          for (const label of candidateLabels) {
            const shouldShow = keep.has(label.entity.id);
            label.visible = shouldShow;
            if (shouldShow) {
              if (label.parent !== layer) layer.addChild(label);
            } else if (label.parent === layer) {
              layer.removeChild(label);
            }
          }
        }

        // Debounced off both wheel (zoom) and drag (pan) -- unlike the LOD
        // check above, panning alone *does* change which labels are
        // candidates (the viewport itself moved), so this can't reuse
        // scheduleLodCheck's wheel-only trigger.
        let labelDeclutterTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLabelDeclutter = () => {
          if (labelDeclutterTimeout !== null) clearTimeout(labelDeclutterTimeout);
          labelDeclutterTimeout = setTimeout(() => {
            labelDeclutterTimeout = null;
            if (cancelled) return;
            declutterLabels();
          }, LABEL_DECLUTTER_DEBOUNCE_MS);
        };

        // Declutter the default view immediately rather than waiting for
        // the first interaction to trigger the debounce above.
        declutterLabels();

        // Redraws the highlight overlay whenever the store's
        // selected/hovered entity changes -- from pointer events here, or
        // from SearchBox selecting an entity by name. Not run per-frame:
        // selection/hover change only on discrete events, not continuously,
        // unlike applyCameraTransform above.
        unsubscribeInteraction = interactionStore.subscribe(drawHighlights);
        drawHighlights();

        // Wheel zoom: cursor-anchored, eased (only `target` is set here --
        // the ticker's lerpCamera above carries `current` toward it). Based
        // on `target` rather than `current` so repeated fast wheel ticks
        // compose against the intended zoom level instead of drifting from
        // whatever the easing hasn't caught up to yet. preventDefault stops
        // the browser's own page-zoom/scroll; needs { passive: false } for
        // that to be allowed.
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const { width, height } = app.screen;
          const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
          // Clamp the requested zoom *before* anchoring, not after: zoomAt
          // computes x/y assuming the camera ends up at exactly the zoom
          // value it's given, so anchoring against an unclamped value (which
          // regularly overshoots MAX_ZOOM near the top of the range) and
          // only clamping the zoom number afterward leaves x/y anchored for
          // a different zoom than what's actually applied -- a large,
          // sudden position jump. Clamping first keeps them in agreement.
          const requestedZoom = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, target.zoom * zoomFactor),
          );
          const zoomed = zoomAt(target, e.offsetX, e.offsetY, requestedZoom);
          target = clampCamera(zoomed, width, height, MAX_ZOOM);
          scheduleLodCheck();
          scheduleLabelDeclutter();
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });

        app.ticker.add(applyCameraTransform);
      });

    return () => {
      cancelled = true;
      unsubscribeInteraction?.();
      if (app.renderer) {
        // releaseGlobalResources clears Pixi's pooled batcher buffers on
        // cleanup -- without it, React.StrictMode's dev-mode double-invoke
        // (mount -> cleanup -> mount again) leaves the second Application
        // with a stale, undersized buffer inherited from the first, which
        // then throws "GL_INVALID_OPERATION: glDrawElements: Insufficient
        // buffer size" once enough BitmapText glyph batches are drawn to
        // exceed it (see https://github.com/pixijs/pixijs/discussions/11678).
        app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
  );
}
