import { interactionStore } from "./interactionStore";
import type { Scene, SceneAction, CameraAction } from "./scenes";

// Phase 6 playback dispatcher (roadmap.md section 14 / 6.1.c). A lookup
// table keyed by action.type, per plan-phase6-scenes-timeline.md's decision
// #6 -- adding a new action type later (Border Draw, Arrow, ...) means
// registering a new handler here, not editing a dispatcher if/else chain.
//
// Handlers are synchronous and fire-and-forget: they only set *intent*
// (e.g. request a camera target via interactionStore), they don't await a
// transition finishing. Every handler also receives the owning Scene's
// `duration` (seconds) -- movement handlers (pan) use it to drive a
// fixed-duration camera glide (camera.ts's tweenCamera, via
// interactionStore.requestFocus's optional duration) instead of an instant/
// interactive fly-to, so "a 2-second pan" actually takes 2 seconds rather
// than snapping there and then holding; state handlers (highlight,
// clearHighlight) apply instantly and ignore it, since there's nothing to
// animate about a border appearing/disappearing. No separate
// transitionDuration/holdDuration split (roadmap.md section 16, still
// deferred) -- one duration field, interpreted per-action-type at dispatch
// time instead.
//
// Handlers never touch camera.ts or MapCanvas.tsx's camera state directly
// -- that stays private to MapCanvas.tsx's effect closure by design. They
// go through interactionStore's existing decoupled requestFocus/toggleEntity
// channels instead, the same plumbing InstructionBuilder.tsx's live preview
// already uses for "pick an entity -> map reacts."
// `cameraStart`, only ever passed for a scene's `camera` action, resolves
// the "what does the camera start from" bug (a fresh Play used to glide
// from whatever the live camera happened to be, e.g. a manual pan or the
// end of a previous playback -- not deterministic). "instant" reuses the
// existing fast interactive fly-to (no scripted glide at all); "world"
// scripts a glide from a fixed world-view start instead of the live camera.
// Only sceneStore.ts's playFrom passes this, and only for a fresh Play's
// very first dispatch -- every other dispatch (later scenes, resume,
// jumpToScene) omits it and behaves exactly as before.
export type CameraStart = "instant" | "world";

// A reset handler undoes some persistent visual state an action type owns
// (today: highlight/selection) back to a known baseline. Called once by
// sceneStore.ts's play(), only on a genuine fresh start (never on resume,
// never between later scenes), so a story's replay -- or its very first
// play, if something was already highlighted from an earlier manual pick --
// never silently inherits leftover state from outside itself.
//
// Deliberately *not* the same mechanism as CameraStart above, even though
// both exist to make a fresh Play deterministic: camera's determinism is
// about how its own next *in-scene* dispatch begins (scene 0 might not even
// have a camera action), so forcing an unconditional camera reset here
// would fight with `cameraStart: "instant"`'s "snap directly to scene 1,
// no visible motion first" behavior. Highlight has no such coupling --
// it's always correct to clear it before a fresh run, whether or not scene
// 0's own actions happen to touch it -- so it gets this simpler,
// unconditional mechanism instead. A future action type with similar
// "flag that outlives a single scene" semantics would register its own
// reset here too, rather than sceneStore needing to know about it by name.
export type ResetHandler = () => void;
const resetHandlers: ResetHandler[] = [];

export function registerReset(handler: ResetHandler): void {
  resetHandlers.push(handler);
}

export function resetToBaseline(): void {
  for (const handler of resetHandlers) handler();
}

export type ActionHandler = (
  params: Record<string, unknown>,
  durationSeconds: number,
  cameraStart?: CameraStart,
) => void;

const registry = new Map<string, ActionHandler>();

export function registerAction(type: string, handler: ActionHandler): void {
  registry.set(type, handler);
}

// Unknown action types are a silent no-op, not an error -- a forward-compat
// default (e.g. a Scene saved before a type existed, or one from a future
// version) shouldn't crash playback.
export function dispatchAction(
  action: SceneAction | CameraAction,
  durationSeconds: number,
  cameraStart?: CameraStart,
): void {
  const handler = registry.get(action.type);
  if (!handler) return;
  handler(action.params, durationSeconds, cameraStart);
}

// Applies a Scene's full state (camera + actions) in one call -- the
// playback engine's per-scene step, but also the exact primitive 6.3 will
// need for "jump straight to scene N" (click/scrub), so it's kept as its
// own callable here rather than inlined into the playback loop. `cameraStart`
// only ever affects `scene.camera`'s dispatch (see the type above) --
// `scene.actions` (highlight etc.) always dispatch normally.
export function dispatchScene(scene: Scene, cameraStart?: CameraStart): void {
  if (scene.camera) dispatchAction(scene.camera, scene.duration, cameraStart);
  for (const action of scene.actions) dispatchAction(action, scene.duration);
}

// "pan": entity -> fly/fit the camera to it over `durationSeconds` (reuses
// the fly-to path InstructionBuilder's live preview triggers, but with a
// duration now so it glides instead of snapping); no entity -> fit the
// whole world (interactionStore.requestFocus(null, durationSeconds), see
// MapCanvas.tsx's onFocusRequest null branch).
registerAction("pan", (params, durationSeconds, cameraStart) => {
  const targetEntityId = params.targetEntityId as string | undefined;
  const zoomPercent = params.zoomPercent as number | undefined;
  if (cameraStart === "instant") {
    // No duration passed through -- the same fast interactive fly-to
    // InstructionBuilder's live preview uses, not a scripted glide.
    interactionStore.requestFocus(targetEntityId ?? null, { zoomPercent });
  } else {
    interactionStore.requestFocus(targetEntityId ?? null, {
      durationSeconds,
      fromWorldView: cameraStart === "world",
      zoomPercent,
    });
  }
});

// "highlight": toggleEntity(id, false) is non-additive -- it deterministically
// replaces the whole selection with just this entity, not a toggle. So at
// most one entity is ever highlighted by scene playback at a time. Applies
// instantly -- durationSeconds is how long it then *stays* highlighted
// (the playback engine's hold), not something this handler animates.
registerAction("highlight", (params, _durationSeconds, _cameraStart) => {
  const entityId = params.entityId as string;
  const color = params.color as number | undefined;
  const flagCode = (params.flagCode as string | null | undefined) ?? undefined;
  const fillMode = params.fillMode as "color" | "image" | undefined;
  const flagOffsetX = params.flagOffsetX as number | undefined;
  const flagOffsetY = params.flagOffsetY as number | undefined;
  const imageSource = (params.imageSource as "flag" | "upload" | null | undefined) ?? undefined;
  const uploadedImageId = (params.uploadedImageId as string | null | undefined) ?? undefined;
  const uploadOffsetX = params.uploadOffsetX as number | undefined;
  const uploadOffsetY = params.uploadOffsetY as number | undefined;
  const uploadScale = params.uploadScale as number | undefined;
  interactionStore.toggleEntity(entityId, false, {
    color,
    flagCode,
    fillMode,
    flagOffsetX,
    flagOffsetY,
    imageSource,
    uploadedImageId,
    uploadOffsetX,
    uploadOffsetY,
    uploadScale,
  });
});

// "clearHighlight": clears the whole selection rather than removing only
// params.entityId. Since "highlight" above always replaces the entire
// selection, scene playback never has more than one entity highlighted at
// once -- "clear this specific entity" and "clear whatever's highlighted"
// are equivalent in practice, so this resolves the semantics 6.1.b's
// changelog left open without needing a new interactionStore method.
registerAction("clearHighlight", (_params, _durationSeconds, _cameraStart) => {
  interactionStore.toggleEntity(null, false);
});

// Highlight's baseline is "nothing selected" -- the same call clearHighlight
// makes, registered separately here since a reset must run unconditionally
// at a fresh Play's start, regardless of whether scene 0 is a clearHighlight
// itself.
registerReset(() => interactionStore.toggleEntity(null, false));
