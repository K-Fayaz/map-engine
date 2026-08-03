import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { loadWorldData, type Resolution } from "./loadWorldData";
import { buildCountryEntities } from "./entities";
import {
  fillGeometry,
  strokeGeometry,
  CountryContainer,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from "./render";
import { type Camera, MIN_ZOOM, clampCamera, zoomAt, lerpCamera } from "./camera";

const OCEAN_COLOR = 0x068494;
const LAND_COLOR = 0xf5f5f2;

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

export function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const app = new Application();

    app
      .init({
        resizeTo: container,
        backgroundColor: OCEAN_COLOR,
        antialias: true,
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
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
          strokeGeometry(c.stroke, entity.geometry);
          countriesLayer.addChild(c);
          return c;
        });
        worldContainer.addChild(countriesLayer);

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
            if (match) fillGeometry(c.fill, match.geometry, LAND_COLOR);
          }
        }

        applyFill("50m");

        // Camera state: current is what's actually rendered each frame,
        // eased toward target by the ticker. No pan/zoom input is wired up
        // yet (that's the next todos) -- for now both start at the default
        // view (zoom = 1, world exactly fills the screen) and stay there.
        let current: Camera = { x: 0, y: 0, zoom: 1 };
        let target: Camera = { ...current };

        const onResize = () => {
          const { width, height } = app.screen;
          baseScaleX = width / WORLD_WIDTH;
          baseScaleY = height / WORLD_HEIGHT;
          current = clampCamera(current, width, height, MAX_ZOOM);
          target = clampCamera(target, width, height, MAX_ZOOM);
        };
        app.renderer.on("resize", onResize);

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

        const onPointerDown = (e: PointerEvent) => {
          dragging = true;
          dragStartX = e.offsetX;
          dragStartY = e.offsetY;
          dragStartCameraX = current.x;
          dragStartCameraY = current.y;
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = "grabbing";
        };

        const onPointerMove = (e: PointerEvent) => {
          if (!dragging) return;
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
        };

        const onPointerUp = (e: PointerEvent) => {
          dragging = false;
          canvas.releasePointerCapture(e.pointerId);
          canvas.style.cursor = "grab";
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
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });

        app.ticker.add(() => {
          current = lerpCamera(current, target, EASE_FACTOR);
          worldContainer.position.set(current.x, current.y);
          worldContainer.scale.set(baseScaleX * current.zoom, baseScaleY * current.zoom);
        });
      });

    return () => {
      cancelled = true;
      if (app.renderer) {
        app.destroy(true, { children: true });
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
  );
}
