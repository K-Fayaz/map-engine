import { interactionStore } from "./interactionStore";
import type { Scene, SceneAction, CameraAction } from "./scenes";

// Phase 6 playback dispatcher (roadmap.md section 14 / 6.1.c). A lookup
// table keyed by action.type, per plan-phase6-scenes-timeline.md's decision
// #6 -- adding a new action type later (Border Draw, Arrow, ...) means
// registering a new handler here, not editing a dispatcher if/else chain.
//
// Handlers are synchronous and fire-and-forget: they only set *intent*
// (e.g. request a camera target via interactionStore), they don't await a
// transition finishing. The camera's existing lerpCamera easing
// (MapCanvas.tsx's ticker) already makes the transition itself smooth;
// 6.1.c's playback engine is the thing that sequences whole-scene *holds*
// on top of that, not this dispatcher (roadmap.md section 16's
// transition/hold split stays deferred).
//
// Handlers never touch camera.ts or MapCanvas.tsx's camera state directly
// -- that stays private to MapCanvas.tsx's effect closure by design. They
// go through interactionStore's existing decoupled requestFocus/toggleEntity
// channels instead, the same plumbing SearchBox.tsx and InstructionBuilder.tsx
// already use for "pick an entity -> map reacts."
export type ActionHandler = (params: Record<string, unknown>) => void;

const registry = new Map<string, ActionHandler>();

export function registerAction(type: string, handler: ActionHandler): void {
  registry.set(type, handler);
}

// Unknown action types are a silent no-op, not an error -- a forward-compat
// default (e.g. a Scene saved before a type existed, or one from a future
// version) shouldn't crash playback.
export function dispatchAction(action: SceneAction | CameraAction): void {
  const handler = registry.get(action.type);
  if (!handler) return;
  handler(action.params);
}

// Applies a Scene's full state (camera + actions) in one call -- the
// playback engine's per-scene step, but also the exact primitive 6.3 will
// need for "jump straight to scene N" (click/scrub), so it's kept as its
// own callable here rather than inlined into the playback loop.
export function dispatchScene(scene: Scene): void {
  if (scene.camera) dispatchAction(scene.camera);
  for (const action of scene.actions) dispatchAction(action);
}

// "pan": entity -> fly/fit the camera to it (reuses the exact fly-to path
// SearchBox/InstructionBuilder already trigger); no entity -> fit the whole
// world (interactionStore.requestFocus(null), see MapCanvas.tsx's
// onFocusRequest null branch).
registerAction("pan", (params) => {
  const targetEntityId = params.targetEntityId as string | undefined;
  interactionStore.requestFocus(targetEntityId ?? null);
});

// "highlight": toggleEntity(id, false) is non-additive -- it deterministically
// replaces the whole selection with just this entity, not a toggle. So at
// most one entity is ever highlighted by scene playback at a time.
registerAction("highlight", (params) => {
  const entityId = params.entityId as string;
  interactionStore.toggleEntity(entityId, false);
});

// "clearHighlight": clears the whole selection rather than removing only
// params.entityId. Since "highlight" above always replaces the entire
// selection, scene playback never has more than one entity highlighted at
// once -- "clear this specific entity" and "clear whatever's highlighted"
// are equivalent in practice, so this resolves the semantics 6.1.b's
// changelog left open without needing a new interactionStore method.
registerAction("clearHighlight", () => {
  interactionStore.toggleEntity(null, false);
});
