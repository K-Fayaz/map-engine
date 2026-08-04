// Pure camera math, no Pixi/DOM dependency -- MapCanvas.tsx owns the actual
// mutable state (current + target Camera, held in refs) and wires these
// functions to input events and the render ticker.
//
// The world is stretched per-axis to exactly fill the screen at zoom = 1
// (matching the original non-uniform "always fills the window" behavior --
// see MapCanvas.tsx's baseScaleX/baseScaleY). `zoom` is a uniform multiplier
// on top of that base stretch, so zooming in doesn't introduce further
// distortion beyond whatever the base stretch already has. Because the base
// stretch is defined to exactly fill the screen, camera math here only needs
// screen pixels, not world-space units at all.

export interface Camera {
  // Screen-space position of the (stretched) world's top-left corner, i.e.
  // what gets applied directly as `worldContainer.position`.
  x: number;
  y: number;
  // Uniform multiplier on top of the base per-axis stretch. 1 = default
  // view, world exactly fills the screen with no panning possible.
  zoom: number;
}

export const MIN_ZOOM = 1;

// Clamps zoom to [MIN_ZOOM, maxZoom] and position so the world always covers
// the screen (no panning past its own edges -- no wraparound, no empty
// space beyond it). At zoom = 1 the content exactly matches the screen size,
// so x/y are forced to (0, 0) -- can't pan at all until zoomed in, which is
// the intended camera bound.
export function clampCamera(
  camera: Camera,
  screenWidth: number,
  screenHeight: number,
  maxZoom: number,
): Camera {
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, camera.zoom));

  const contentWidth = screenWidth * zoom;
  const contentHeight = screenHeight * zoom;

  const x = Math.min(0, Math.max(screenWidth - contentWidth, camera.x));
  const y = Math.min(0, Math.max(screenHeight - contentHeight, camera.y));

  return { x, y, zoom };
}

// Cursor-anchored zoom: recomputes x/y so the point currently under
// (screenX, screenY) stays under it after zoom changes to newZoom.
// Doesn't clamp -- callers should run the result through clampCamera.
export function zoomAt(
  camera: Camera,
  screenX: number,
  screenY: number,
  newZoom: number,
): Camera {
  const contentX = (screenX - camera.x) / camera.zoom;
  const contentY = (screenY - camera.y) / camera.zoom;

  return {
    x: screenX - contentX * newZoom,
    y: screenY - contentY * newZoom,
    zoom: newZoom,
  };
}

// Eases `current` toward `target` by `factor` (0..1 per call, e.g. ~0.2 for
// a snappy-but-smooth feel at 60fps). Used by the ticker each frame for the
// "eased zoom" requirement -- drag pan sets current = target directly
// instead of going through this, since drag is meant to track 1:1.
export function lerpCamera(current: Camera, target: Camera, factor: number): Camera {
  return {
    x: current.x + (target.x - current.x) * factor,
    y: current.y + (target.y - current.y) * factor,
    zoom: current.zoom + (target.zoom - current.zoom) * factor,
  };
}

// Screen point -> world-space point (same space project()/unproject() in
// render.ts use), the inverse of the transform MapCanvas.tsx's ticker
// applies each frame. Same formula viewportWorldBounds below applies to each
// of the four viewport corners, extracted here since hit-testing (see
// MapCanvas.tsx) needs it for a single arbitrary point (the cursor), not the
// viewport edges.
export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number,
  baseScaleX: number,
  baseScaleY: number,
): [number, number] {
  const scaleX = baseScaleX * camera.zoom;
  const scaleY = baseScaleY * camera.zoom;
  return [(screenX - camera.x) / scaleX, (screenY - camera.y) / scaleY];
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// The world-space rectangle (same coordinate space render.ts's `project()`
// outputs, and what each label's `.position` is set to) currently visible
// on screen -- the inverse of the transform MapCanvas.tsx's ticker applies
// every frame (worldContainer.position = camera.x/y, worldContainer.scale =
// baseScaleX/Y * camera.zoom). Used to cull which labels are even
// candidates for collision placement instead of checking all ~4800 of them
// every time.
//
// Unlike every other function in this file, this one needs baseScaleX/Y
// explicitly: clampCamera/zoomAt deliberately never leave "screen-content"
// space (where the per-axis stretch is already implicitly folded into the
// zoom=1 baseline, so it cancels out and never needs to appear), but this
// function's whole job is to cross into true world units, which can't be
// done without it.
export function viewportWorldBounds(
  camera: Camera,
  screenWidth: number,
  screenHeight: number,
  baseScaleX: number,
  baseScaleY: number,
): WorldBounds {
  const scaleX = baseScaleX * camera.zoom;
  const scaleY = baseScaleY * camera.zoom;

  return {
    minX: (0 - camera.x) / scaleX,
    maxX: (screenWidth - camera.x) / scaleX,
    minY: (0 - camera.y) / scaleY,
    maxY: (screenHeight - camera.y) / scaleY,
  };
}
