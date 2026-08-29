import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { project, unproject, worldViewCamera } from "./render";
import { computeFramingBounds, findEntityAt, type Entity } from "./entities";
import {
  type Camera,
  MIN_ZOOM,
  clampCamera,
  zoomAt,
  lerpCamera,
  tweenCamera,
  viewportWorldBounds,
  screenToWorld,
  focusOnBounds,
} from "./camera";
import { interactionStore } from "./interactionStore";
import { buildWorldScene, MAX_ZOOM, STATE_ZOOM_THRESHOLD, OCEAN_COLOR } from "./worldRenderer";
import { defaultSelectionColor } from "./mapColors";
import { placeLabelsWithoutOverlap, type LabelCandidate } from "./labelLayout";

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

// A pointerdown/pointerup pair whose cursor never moved more than this many
// screen pixels counts as a click (select/deselect); anything past it is a
// drag (pan), not a click.
const CLICK_MOVE_THRESHOLD_PX = 4;

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
    let unsubscribeFocus: (() => void) | null = null;
    let worldScene: ReturnType<typeof buildWorldScene> | null = null;
    let resizeObserver: ResizeObserver | null = null;

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

        // All pointer interaction here (drag pan, wheel zoom, hover/click
        // selection) is handled manually via raw canvas listeners below --
        // Phase 4 deliberately avoided Pixi's own eventMode/hitArea system
        // to sidestep per-object interactivity cost across thousands of
        // entities (see changelog). But Pixi's EventSystem still installs
        // its own pointer listeners and runs its own recursive hit-test
        // walk of the whole scene graph on every pointermove regardless --
        // it doesn't know it's unused. `eventMode = "none"` on the stage
        // prunes that walk at the root before it recurses into any children.
        app.stage.eventMode = "none";

        // Uniform contain-fit so the world keeps its aspect ratio instead of
        // stretching to the container's. Owned by worldScene (see
        // worldRenderer.ts's applyViewFit) since it's a shared
        // rendering/framing concern, not a live-interaction one.
        const scene = buildWorldScene(app.screen.width, app.screen.height);
        worldScene = scene;
        app.stage.addChild(scene.worldContainer);

        // Feeds Phase 4 interaction (search, and eventually anything else
        // that needs to look an entity up by id from outside this effect).
        interactionStore.setEntities(scene.allEntities);

        // Camera state: current is what's actually rendered each frame,
        // eased toward target by the ticker.
        let current: Camera = worldViewCamera(scene.viewW, scene.viewH, scene.baseScaleX, scene.baseScaleY, MAX_ZOOM);
        let target: Camera = { ...current };

        // A scripted (Phase 6 scene) pan in progress, or null when none is
        // running -- entirely separate from target/lerpCamera's continuous
        // interactive ease above (see camera.ts's tweenCamera comment for
        // why). Sets `current` directly from elapsed wall-clock time each
        // frame while active, instead of easing toward `target`.
        let scriptedPan: { from: Camera; to: Camera; startTime: number; durationMs: number } | null = null;

        // Applies the current camera state to the scene graph -- called
        // once synchronously below (so the initial declutterLabels() call
        // sees correct transforms instead of Pixi's default (1,1) scale,
        // before the ticker has ever run) and every tick thereafter.
        function applyCameraTransform() {
          if (scriptedPan) {
            const elapsed = performance.now() - scriptedPan.startTime;
            const progress = Math.min(1, elapsed / scriptedPan.durationMs);
            current = tweenCamera(scriptedPan.from, scriptedPan.to, progress, scene.viewW, scene.viewH, scene.baseScaleX, scene.baseScaleY);
            if (progress >= 1) {
              target = scriptedPan.to;
              scriptedPan = null;
            }
          } else {
            current = lerpCamera(current, target, EASE_FACTOR);
          }
          scene.applyCamera(current, interactionStore.getState().showStateBorders);
        }
        applyCameraTransform();

        const onResize = () => {
          const { width, height } = app.screen;
          scene.applyViewFit(width, height);
          current = clampCamera(current, scene.viewW, scene.viewH, MAX_ZOOM);
          target = clampCamera(target, scene.viewW, scene.viewH, MAX_ZOOM);
          scheduleLabelDeclutter();
        };
        app.renderer.on("resize", onResize);

        // Pixi's own `resizeTo` (ResizePlugin) only re-measures on the
        // browser window's "resize" event -- it has no observer on
        // `container` itself, so it never notices a layout-only size change
        // (e.g. MapStage.tsx reshaping this container to a chosen export
        // aspect ratio without the window resizing). This ResizeObserver
        // fills that gap by calling the same `app.resize()` resizeTo would
        // have, which re-measures `container.clientWidth/Height` and emits
        // the renderer "resize" event `onResize` above already handles.
        resizeObserver = new ResizeObserver(() => app.resize());
        resizeObserver.observe(container);

        // Hit-tests a screen-space point against whichever entity layer is
        // currently active for interaction -- states once zoomed in past
        // STATE_ZOOM_THRESHOLD, countries otherwise. Lakes are checked
        // first, regardless of zoom: they paint on top of both layers, so a
        // click inside/near one should resolve to it. Seas are checked
        // *last*, as a fallback -- they have no visible layer at all.
        //
        // Rivers are deliberately excluded here -- their hit-test tolerance
        // made them easy to hover/click by accident. They stay fully
        // selectable via the Instruction Builder's entity picker, which
        // calls interactionStore.toggleEntity/requestFocus directly by id.
        function hitTestScreenPoint(screenX: number, screenY: number): Entity | undefined {
          const [wx, wy] = screenToWorld(
            current,
            screenX - scene.letterboxX,
            screenY - scene.letterboxY,
            scene.baseScaleX,
            scene.baseScaleY,
          );
          const [lon, lat] = unproject(wx, wy);
          const lakeHit = findEntityAt(scene.lakeEntities, lon, lat);
          if (lakeHit) return lakeHit;
          const showStates = current.zoom > STATE_ZOOM_THRESHOLD && interactionStore.getState().showStateBorders;
          const candidates = showStates ? scene.stateEntities : scene.borderEntities;
          const landHit = findEntityAt(candidates, lon, lat);
          if (landHit) return landHit;
          return findEntityAt(scene.seaEntities, lon, lat);
        }

        // Drag pan: tracks the cursor 1:1 (no easing/momentum), so both
        // current and target are set directly on move rather than letting
        // the ticker lerp toward a target. Pointer capture keeps the drag
        // going even if the cursor leaves the canvas mid-drag.
        const canvas = app.canvas;
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartCameraX = 0;
        let dragStartCameraY = 0;
        // Tracks whether this pointerdown/up pair has moved past
        // CLICK_MOVE_THRESHOLD_PX yet -- distinguishes a click (select) from
        // a drag (pan).
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

          // Drag delta (offsetX - dragStartX) is letterbox-invariant -- the
          // constant margin cancels out in the subtraction -- so no
          // letterbox adjustment is needed here, unlike the absolute
          // cursor positions hitTestScreenPoint/onWheel use.
          const next = clampCamera(
            {
              x: dragStartCameraX + (e.offsetX - dragStartX),
              y: dragStartCameraY + (e.offsetY - dragStartY),
              zoom: current.zoom,
            },
            scene.viewW,
            scene.viewH,
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
            // ctrl (Windows/Linux) or cmd (Mac) held -- same modifier a file
            // manager uses for multi-select -- toggles the hit entity into/
            // out of the existing selection instead of replacing it.
            interactionStore.toggleEntity(hit?.id ?? null, e.ctrlKey || e.metaKey);
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
        // tick.
        let lodTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLodCheck = () => {
          if (lodTimeout !== null) clearTimeout(lodTimeout);
          lodTimeout = setTimeout(() => {
            lodTimeout = null;
            if (cancelled) return;
            if (scene.resolution === "50m" && current.zoom > LOD_ZOOM_THRESHOLD) {
              scene.setResolution("10m", true);
            } else if (
              scene.resolution === "10m" &&
              current.zoom < LOD_ZOOM_THRESHOLD * LOD_HYSTERESIS
            ) {
              scene.setResolution("50m", true);
            }
          }, LOD_DEBOUNCE_MS);
        };

        // Declutters whichever label layer is currently active (matches the
        // same current.zoom > STATE_ZOOM_THRESHOLD check applyCamera uses
        // for layer visibility, so the two always agree on which layer is
        // "live"). Two passes over *all* of that layer's label objects:
        //  1. Cull to labels inside the current viewport.
        //  2. For the (much smaller) surviving candidates, compute their
        //     screen-space box and run them through labelLayout.ts's greedy
        //     collision placement.
        //
        // The screen-space box is computed directly from data already
        // trusted here, *not* Pixi's getBounds() -- see history for why
        // (getBounds() composes lazily through the parent chain and
        // returns (0,0,0,0) if called synchronously right after addChild).
        function declutterLabels() {
          const isStates = current.zoom > STATE_ZOOM_THRESHOLD;
          const layer = isStates ? scene.stateLabelsLayer : scene.countryLabelsLayer;
          const allLabels = isStates ? scene.stateLabelObjects : scene.countryLabelObjects;
          const bounds = viewportWorldBounds(current, scene.viewW, scene.viewH, scene.baseScaleX, scene.baseScaleY);
          const scaleX = scene.baseScaleX * current.zoom;
          const scaleY = scene.baseScaleY * current.zoom;

          const candidates: LabelCandidate[] = [];
          const candidateLabels: (typeof allLabels)[number][] = [];

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

        // Same viewport-cull idea as declutterLabels, applied to the states
        // layer's ~4600 border containers instead of label objects: only
        // attach whichever are inside the current viewport, detach the
        // rest. No collision placement needed here, just membership. No-ops
        // below STATE_ZOOM_THRESHOLD -- statesLayer is invisible there
        // anyway.
        function declutterStates() {
          if (current.zoom <= STATE_ZOOM_THRESHOLD) return;
          const bounds = viewportWorldBounds(current, scene.viewW, scene.viewH, scene.baseScaleX, scene.baseScaleY);
          for (const item of scene.stateRenderItems) {
            const onScreen =
              item.maxX >= bounds.minX &&
              item.minX <= bounds.maxX &&
              item.maxY >= bounds.minY &&
              item.minY <= bounds.maxY;
            if (onScreen) {
              if (item.container.parent !== scene.statesLayer) scene.statesLayer.addChild(item.container);
            } else if (item.container.parent === scene.statesLayer) {
              scene.statesLayer.removeChild(item.container);
            }
          }
        }

        // Debounced off both wheel (zoom) and drag (pan) -- unlike the LOD
        // check above, panning alone *does* change which labels/states are
        // candidates (the viewport itself moved).
        let labelDeclutterTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLabelDeclutter = () => {
          if (labelDeclutterTimeout !== null) clearTimeout(labelDeclutterTimeout);
          labelDeclutterTimeout = setTimeout(() => {
            labelDeclutterTimeout = null;
            if (cancelled) return;
            declutterLabels();
            declutterStates();
          }, LABEL_DECLUTTER_DEBOUNCE_MS);
        };

        // Declutter the default view immediately rather than waiting for
        // the first interaction to trigger the debounce above.
        declutterLabels();
        declutterStates();

        // Redraws the highlight overlay whenever the store's
        // selected/hovered entity changes -- from pointer events here, or
        // from the Instruction Builder selecting an entity by name.
        const redrawHighlights = () => {
          const {
            selectedEntityIds,
            hoveredEntityId,
            selectedColor,
            selectedFlagCode,
            selectedFillMode,
            selectedFlagOffsetX,
            selectedFlagOffsetY,
            selectedImageSource,
            selectedUploadedImageId,
            selectedUploadOffsetX,
            selectedUploadOffsetY,
            selectedUploadScale,
          } = interactionStore.getState();
          scene.drawHighlights(selectedEntityIds, hoveredEntityId, {
            color: selectedColor ?? defaultSelectionColor,
            flagCode: selectedFlagCode,
            fillMode: selectedFillMode,
            flagOffsetX: selectedFlagOffsetX,
            flagOffsetY: selectedFlagOffsetY,
            imageSource: selectedImageSource,
            uploadedImageId: selectedUploadedImageId,
            uploadOffsetX: selectedUploadOffsetX,
            uploadOffsetY: selectedUploadOffsetY,
            uploadScale: selectedUploadScale,
          });
        };
        unsubscribeInteraction = interactionStore.subscribe(redrawHighlights);
        redrawHighlights();

        // Fly the camera to fit whatever entity the Instruction Builder
        // (fast interactive fly-to) or Phase 6 scene playback (scripted,
        // durationSeconds given) just requested focus for.
        unsubscribeFocus = interactionStore.onFocusRequest((id, options) => {
          const { durationSeconds, fromWorldView, zoomPercent } = options ?? {};
          const zoomMultiplier = (zoomPercent ?? 100) / 100;
          // null = "focus the whole world" -- worldViewCamera (render.ts) is
          // the shared definition of the default world view.
          let newTarget: Camera;
          if (id === null) {
            newTarget = worldViewCamera(scene.viewW, scene.viewH, scene.baseScaleX, scene.baseScaleY, MAX_ZOOM, zoomMultiplier);
          } else {
            const entity = scene.findById(id);
            if (!entity) return;
            // computeFramingBounds, not entity.boundingBox -- the latter is
            // deliberately left naive (antimeridian-wide) for hit-test/
            // culling prefilters; framing needs the tighter,
            // antimeridian-aware box instead (see entities.ts).
            const bb = computeFramingBounds(entity.geometry);
            const [minX, maxY] = project(bb.minLon, bb.minLat);
            const [maxX, minY] = project(bb.maxLon, bb.maxLat);
            newTarget = focusOnBounds(
              { minX, minY, maxX, maxY },
              scene.viewW,
              scene.viewH,
              scene.baseScaleX,
              scene.baseScaleY,
              MAX_ZOOM,
              0.8,
              zoomMultiplier,
            );
          }
          // Scripted: glide from wherever the camera is right now to
          // newTarget over exactly durationSeconds -- unless fromWorldView
          // asks for a deterministic world-view start instead. Unscripted
          // (no duration given): fast interactive ease, only sets `target`.
          if (durationSeconds !== undefined) {
            const from = fromWorldView
              ? worldViewCamera(scene.viewW, scene.viewH, scene.baseScaleX, scene.baseScaleY, MAX_ZOOM)
              : current;
            scriptedPan = { from, to: newTarget, startTime: performance.now(), durationMs: durationSeconds * 1000 };
          } else {
            target = newTarget;
          }
        });

        // Wheel zoom: cursor-anchored, eased (only `target` is set here --
        // the ticker's lerpCamera above carries `current` toward it).
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
          // Clamp the requested zoom *before* anchoring, not after --
          // zoomAt computes x/y assuming the camera ends up at exactly the
          // zoom value it's given.
          const requestedZoom = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, target.zoom * zoomFactor),
          );
          const zoomed = zoomAt(
            target,
            e.offsetX - scene.letterboxX,
            e.offsetY - scene.letterboxY,
            requestedZoom,
          );
          target = clampCamera(zoomed, scene.viewW, scene.viewH, MAX_ZOOM);
          scheduleLodCheck();
          scheduleLabelDeclutter();
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });

        app.ticker.add(applyCameraTransform);
      });

    return () => {
      cancelled = true;
      unsubscribeInteraction?.();
      unsubscribeFocus?.();
      resizeObserver?.disconnect();
      worldScene?.destroy();
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
