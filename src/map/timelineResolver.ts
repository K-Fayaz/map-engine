import type { Entity } from "./entities";
import { computeFramingBounds } from "./entities";
import { project, worldViewCamera } from "./render";
import {
  focusOnBounds,
  tweenCamera,
  type Camera,
  type WorldBounds,
} from "./camera";
import type { Scene } from "./scenes";

// Deterministic, pure "what should the map look like at time t" resolver --
// the `resolveAt` piece .development_logs/export.md calls for but never
// specifies. Deliberately depends only on scenes.ts (data), camera.ts (pure
// math) and entities.ts/render.ts (framing/projection), NOT on
// interactionStore.ts/actionRegistry.ts -- those are event/intent-based
// ("requestFocus", fire-and-forget handlers) and built for live, incremental,
// wall-clock-driven dispatch, not "give me the value at time t." This file
// re-derives the same visual outcome directly from Scene data instead, so
// export never depends on the live canvas, a ticker, or performance.now().
//
// actionRegistry.ts/sceneStore.ts are untouched -- they keep serving only
// live playback. This is a second, independent consumer of the same
// Scene[] data, not a shared dispatcher trying to do both jobs.

export interface ResolvedState {
  camera: Camera;
  highlightedEntityId: string | null;
}

// Sum of every scene's duration -- the export loop's `totalFrames = ceil(
// timelineDuration(scenes) * fps)`.
export function timelineDuration(scenes: Scene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.duration, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Resolves a scene's own camera.pan action (if it has one) into a target
// Camera -- mirrors MapCanvas.tsx's onFocusRequest exactly: a world pan
// (no targetEntityId) uses the shared worldViewCamera (render.ts) baseline;
// an entity pan projects that entity's antimeridian-aware framing bounds
// and runs focusOnBounds with padding=0.8 (matching MapCanvas's hardcoded
// value). Returns null for a scene with no camera.pan action at all (e.g. a
// bare clearHighlight, or "hold") -- the caller inherits the previous
// scene's resting camera for those, same as live playback never moving the
// camera for them.
function resolveSceneTargetCamera(
  scene: Scene,
  entities: Entity[],
  screenWidth: number,
  screenHeight: number,
  baseScaleX: number,
  baseScaleY: number,
  maxZoom: number,
): Camera | null {
  if (!scene.camera || scene.camera.type !== "pan") return null;

  const targetEntityId = scene.camera.params.targetEntityId;
  const zoomPercent = scene.camera.params.zoomPercent;
  const zoomMultiplier = (typeof zoomPercent === "number" ? zoomPercent : 100) / 100;

  if (typeof targetEntityId !== "string") {
    return worldViewCamera(screenWidth, screenHeight, baseScaleX, baseScaleY, maxZoom, zoomMultiplier);
  }

  const entity = entities.find((candidate) => candidate.id === targetEntityId);
  // Defensive only -- a scene referencing an entity that no longer exists
  // shouldn't happen via the normal authoring flow, but resolving to "stay
  // put" is safer than throwing mid-export.
  if (!entity) return null;

  const bb = computeFramingBounds(entity.geometry);
  const [minX, maxY] = project(bb.minLon, bb.minLat);
  const [maxX, minY] = project(bb.maxLon, bb.maxLat);
  const bounds: WorldBounds = { minX, minY, maxX, maxY };

  return focusOnBounds(
    bounds,
    screenWidth,
    screenHeight,
    baseScaleX,
    baseScaleY,
    maxZoom,
    0.8,
    zoomMultiplier,
  );
}

interface PerSceneState {
  start: number;
  duration: number;
  from: Camera;
  to: Camera;
  highlightedEntityId: string | null;
}

// One O(scenes) pass building each scene's start/end camera and the
// highlighted entity in effect during it -- mirrors what live dispatch does
// incrementally (dispatchScene walking one scene at a time as Play advances)
// but computed synchronously, all at once, independent of any wall clock.
function buildPerSceneTable(
  scenes: Scene[],
  entities: Entity[],
  screenWidth: number,
  screenHeight: number,
  baseScaleX: number,
  baseScaleY: number,
  maxZoom: number,
  cameraStart: "instant" | "world",
): PerSceneState[] {
  const perScene: PerSceneState[] = [];
  let cursor = 0;
  let previousCamera: Camera | null = null;
  // Export is always a fresh run (never a resume), so the stale-highlight
  // reset (registerReset/resetToBaseline's unconditional toggleEntity(null))
  // always applies before scene 0 -- no resume-from-pause ambiguity here.
  let currentHighlight: string | null = null;

  for (const scene of scenes) {
    const resolvedTarget = resolveSceneTargetCamera(
      scene,
      entities,
      screenWidth,
      screenHeight,
      baseScaleX,
      baseScaleY,
      maxZoom,
    );
    // A scene with no camera.pan action inherits wherever the previous scene
    // rested -- Hold's documented semantics, and also correct for a bare
    // clearHighlight (which never touches the camera live either). Falls
    // back to the world-view baseline only if this is scene 0 and it has no
    // camera action of its own (e.g. a story that opens on a Hold).
    const to: Camera =
      resolvedTarget ??
      previousCamera ??
      worldViewCamera(screenWidth, screenHeight, baseScaleX, baseScaleY, maxZoom);

    const from =
      perScene.length === 0
        ? cameraStart === "world"
          ? worldViewCamera(screenWidth, screenHeight, baseScaleX, baseScaleY, maxZoom)
          : to // "instant": scene 0 starts already at its target, no glide
        : (previousCamera as Camera);

    for (const action of scene.actions) {
      if (action.type === "highlight" && typeof action.params.entityId === "string") {
        currentHighlight = action.params.entityId;
      } else if (action.type === "clearHighlight") {
        currentHighlight = null;
      }
    }

    perScene.push({
      start: cursor,
      duration: scene.duration,
      from,
      to,
      highlightedEntityId: currentHighlight,
    });

    previousCamera = to;
    cursor += scene.duration;
  }

  return perScene;
}

// The core primitive: "what should the map look like at timestamp t," as a
// pure function of the scene list -- never "what is currently on screen."
// Recomputes the per-scene table on every call; with typical scene counts
// (tens, not thousands) this is negligible next to rendering/extraction cost
// per frame, and keeps this function simple to call and to unit test in
// isolation with no setup/teardown between calls.
export function resolveAt(
  scenes: Scene[],
  entities: Entity[],
  t: number,
  screenWidth: number,
  screenHeight: number,
  baseScaleX: number,
  baseScaleY: number,
  maxZoom: number,
  cameraStart: "instant" | "world",
): ResolvedState {
  if (scenes.length === 0) {
    return {
      camera: worldViewCamera(screenWidth, screenHeight, baseScaleX, baseScaleY, maxZoom),
      highlightedEntityId: null,
    };
  }

  const perScene = buildPerSceneTable(
    scenes,
    entities,
    screenWidth,
    screenHeight,
    baseScaleX,
    baseScaleY,
    maxZoom,
    cameraStart,
  );
  const totalDuration = timelineDuration(scenes);
  const clampedT = clamp(t, 0, totalDuration);

  // Locate the containing scene; t === totalDuration (or a scene with
  // duration 0) resolves into the final scene at full progress.
  let index = perScene.length - 1;
  for (let i = 0; i < perScene.length; i++) {
    if (clampedT < perScene[i].start + perScene[i].duration) {
      index = i;
      break;
    }
  }

  const scene = perScene[index];
  const localProgress =
    scene.duration <= 0 ? 1 : clamp((clampedT - scene.start) / scene.duration, 0, 1);

  const camera = tweenCamera(
    scene.from,
    scene.to,
    localProgress,
    screenWidth,
    screenHeight,
    baseScaleX,
    baseScaleY,
  );

  return { camera, highlightedEntityId: scene.highlightedEntityId };
}
