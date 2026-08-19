import type { Entity } from "./entities";

// Scene/action data model for Phase 6 (roadmap.md, section 14). Shape
// matches that section's Scene interface (id, duration, targetEntityId?,
// actions, camera?) -- what changed from its illustrative example is
// SceneAction/CameraAction's own shape: a generic `{ type, params }` pair
// rather than per-action custom fields (e.g. the roadmap's own example puts
// `entityId` directly on a highlight action). That's deliberate, per
// plan-phase6-scenes-timeline.md's decision #6: the playback engine (6.1.c)
// must dispatch on `type` through a registry/lookup table, not an if/else
// special-casing each action -- a uniform `{ type, params }` shape is what
// makes one dispatcher work for both `actions` and `camera` instead of
// needing two different mechanisms. `type` is a plain `string`, not a
// literal union, so a new action type (Border Draw, Arrow, ...) is a new
// registered handler later, not an edit to this file.

export interface SceneAction {
  type: string;
  params: Record<string, unknown>;
}

export interface CameraAction {
  type: string;
  params: Record<string, unknown>;
}

export interface Scene {
  id: string;
  duration: number;
  targetEntityId?: string;
  actions: SceneAction[];
  camera?: CameraAction;
}

// The V1 animation vocabulary (roadmap.md Phase 6, section 4), as chosen in
// this session's planning discussion: "Focus" and "Focus World" merged into
// one "pan" action with an *optional* target, rather than two separate
// action types -- camera.ts's focusOnBounds already takes bounds as a single
// argument regardless of whether they came from an entity or the whole
// world, so two registry entries calling the same underlying mechanism
// would just be redundant. This is a deliberate naming/shape deviation from
// roadmap.md section 4's literal "Focus"/"Focus World" -- logged here and
// in plan-phase6-scenes-timeline.md rather than left as silent drift.
//
// "Highlight" and "Pan + Highlight" were later merged too (6.1.c
// follow-up): a highlighted entity the camera isn't actually showing is
// useless in a V1 flat form with no other way to guarantee it's in frame,
// so "Highlight" now always pans to the entity as well -- buildScene below
// attaches a camera.pan unconditionally. The camera-only, no-highlight case
// stays reachable via the separate "pan" option (e.g. establishing shots,
// or panning to the whole world). Deliberately not preserving a
// highlight-without-pan option -- per docs/phase_6_arch.md's "don't
// over-solve," that's a more advanced scripting use case (multiple
// highlights within one already-framed shot) worth building only if real
// use actually asks for it.
export type AnimationValue = "pan" | "highlight" | "clearHighlight";

export const ANIMATION_OPTIONS: { value: AnimationValue; label: string }[] = [
  { value: "pan", label: "Pan" },
  { value: "highlight", label: "Highlight" },
  { value: "clearHighlight", label: "Clear Highlight" },
];

// Every V1 animation except a target-less "Pan" (pans out to the world)
// needs a specific entity picked. Exported so the Instruction Builder can
// disable "Add to Timeline" without needing to call buildScene just to find
// out it would return null.
export function animationRequiresEntity(animation: AnimationValue): boolean {
  return animation !== "pan";
}

// Pure mapping from the Instruction Builder's flat form state (one entity,
// one animation, one duration) into a Scene -- the one place that knows how
// each dropdown option decomposes into `camera`/`actions`. "Highlight"
// becomes *two* things in the Scene (a camera.pan and an actions highlight
// entry), not one opaque combined action, so 6.1.c's registry dispatcher
// never needs to know a "combined" option exists at all -- it only ever
// sees plain pan/highlight/clearHighlight entries.
// Returns null if `animation` requires an entity and none was given --
// callers (the "Add to Timeline" button) should already be preventing this
// via animationRequiresEntity, this is a correctness backstop, not the
// primary validation path.
export function buildScene(
  entity: Entity | null,
  animation: AnimationValue,
  duration: number,
  zoomPercent: number = 100,
): Scene | null {
  if (animationRequiresEntity(animation) && !entity) return null;

  const actions: SceneAction[] = [];
  let camera: CameraAction | undefined;

  if (animation === "pan" || animation === "highlight") {
    camera = {
      type: "pan",
      params: { ...(entity ? { targetEntityId: entity.id } : {}), zoomPercent },
    };
  }
  if (animation === "highlight") {
    actions.push({ type: "highlight", params: { entityId: entity!.id } });
  }
  if (animation === "clearHighlight") {
    actions.push({ type: "clearHighlight", params: { entityId: entity!.id } });
  }

  return {
    id: crypto.randomUUID(),
    duration,
    targetEntityId: entity?.id,
    actions,
    camera,
  };
}

// Reverse of buildScene's decomposition -- both for display (the Timeline
// list) and, since 6.3's edit-in-place flow, for re-populating the
// Instruction Builder's animation dropdown when a scene is clicked to
// edit. Reconstructs which dropdown option produced a Scene from its
// actual actions/camera rather than storing the original AnimationValue on
// the Scene itself -- the Scene stores what happens (roadmap.md section
// 14's "store what the user wants to happen, not raw renderer state"), not
// which dropdown option produced it.
export function sceneAnimationValue(scene: Scene): AnimationValue {
  const hasHighlight = scene.actions.some((action) => action.type === "highlight");
  // "highlight" always attaches a camera.pan now (see buildScene), so a
  // scene with both a camera.pan and a highlight action is just
  // "highlight" -- there's no longer a distinct "Pan + Highlight" value it
  // could mean instead.
  if (hasHighlight) return "highlight";
  if (scene.camera?.type === "pan") return "pan";
  return "clearHighlight";
}

// Zoom tightness multiplier for the scene's camera pan, as a percentage --
// 100 (default) is today's plain auto-fit framing, unaffected. Read back
// out of scene.camera.params the same reverse-mapping way
// sceneAnimationValue is, for the Timeline block display and 6.3's
// edit-in-place form repopulation. Falls back to 100 for scenes with no
// camera action (e.g. plain "Clear Highlight") -- there's no pan to scale.
export function sceneZoomPercent(scene: Scene): number {
  const value = scene.camera?.params.zoomPercent;
  return typeof value === "number" ? value : 100;
}

export function describeAnimation(scene: Scene): string {
  if (!scene.camera && scene.actions.length === 0) return "—";
  const value = sceneAnimationValue(scene);
  return ANIMATION_OPTIONS.find((option) => option.value === value)?.label ?? "—";
}
