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

        // Border stroke width in world-space units, recomputed whenever zoom
        // settles (see scheduleLodCheck) so the on-screen thickness stays
        // roughly constant regardless of zoom level. Computed ourselves
        // rather than using Pixi's zoom-invariant `pixelLine` stroke mode --
        // see render.ts's strokeGeometry for why that turned out to look
        // inconsistent between 50m and 10m data.
        const TARGET_BORDER_SCREEN_PX = 1;
        const computeBorderWidth = (zoom: number) =>
          TARGET_BORDER_SCREEN_PX / (((baseScaleX + baseScaleY) / 2) * zoom);

        // Geometry is built once per resolution, in fixed world-space (see
        // render.ts) -- unlike the old draw(), this never re-runs on
        // resize. Pan/zoom is purely a transform on worldContainer, applied
        // by the ticker below; only a LOD swap or border-width refresh (see
        // below) rebuilds this.
        function buildLayers(resolution: Resolution, borderWidth: number) {
          const world = loadWorldData(resolution);
          const countryEntities = buildCountryEntities(world.countries);

          const land = new Graphics();
          for (const f of world.land.features) {
            fillGeometry(land, f.geometry, LAND_COLOR);
          }

          const countriesLayer = new Container();
          for (const entity of countryEntities) {
            const countryContainer = new CountryContainer(entity);
            const g = new Graphics();
            fillGeometry(g, entity.geometry, LAND_COLOR);
            strokeGeometry(g, entity.geometry, borderWidth);
            countryContainer.addChild(g);
            countriesLayer.addChild(countryContainer);
          }

          return { land, countriesLayer };
        }

        const worldContainer = new Container();
        let resolution: Resolution = "50m";
        let { land, countriesLayer } = buildLayers(resolution, computeBorderWidth(1));
        worldContainer.addChild(land);
        worldContainer.addChild(countriesLayer);

        app.stage.addChild(worldContainer);

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

        // Rebuilds land/countriesLayer inside the same worldContainer --
        // the camera transform on worldContainer itself is untouched, so
        // there's no visual jump. Used both for LOD resolution swaps and
        // for refreshing border width after zoom settles (see
        // scheduleLodCheck), so it always rebuilds rather than bailing out
        // when the resolution itself hasn't changed.
        const rebuildLayers = (nextResolution: Resolution) => {
          resolution = nextResolution;
          const old = { land, countriesLayer };
          ({ land, countriesLayer } = buildLayers(resolution, computeBorderWidth(current.zoom)));
          worldContainer.addChild(land);
          worldContainer.addChild(countriesLayer);
          old.land.destroy({ children: true });
          old.countriesLayer.destroy({ children: true });
        };

        // Debounced off wheel events (panning alone never changes zoom, so
        // it can't affect either the LOD threshold or border width) so a
        // continuous scroll only triggers one rebuild after it stops,
        // rather than one per tick.
        let lodTimeout: ReturnType<typeof setTimeout> | null = null;
        const scheduleLodCheck = () => {
          if (lodTimeout !== null) clearTimeout(lodTimeout);
          lodTimeout = setTimeout(() => {
            lodTimeout = null;
            if (cancelled) return;
            let nextResolution = resolution;
            if (resolution === "50m" && current.zoom > LOD_ZOOM_THRESHOLD) {
              nextResolution = "10m";
            } else if (
              resolution === "10m" &&
              current.zoom < LOD_ZOOM_THRESHOLD * LOD_HYSTERESIS
            ) {
              nextResolution = "50m";
            }
            rebuildLayers(nextResolution);
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
