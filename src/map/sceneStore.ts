import { create } from "zustand";
import type { Scene } from "./scenes";
import { dispatchScene } from "./actionRegistry";

// Scene/timeline state, read by both the Instruction Builder ("Add to
// Timeline" pushes here) and the Timeline panel (renders whatever's in
// here). A separate zustand store from interactionStore.ts's hand-rolled
// pub/sub, not an extension of it -- deliberate, per
// plan-phase6-scenes-timeline.md's decision #7: scoped to this new feature
// only, interactionStore stays exactly as it was so nothing about Phase 1-5
// risks regressing.
//
// Playback (6.1.c) lives in this same store rather than a separate one --
// it operates directly over `scenes`, and the Play/Pause UI needs both
// together. `currentSceneIndex`/`isPlaying` are plain reactive state (for
// UI to read); the setTimeout handle that actually drives advancement is
// intentionally *not* store state -- it's an implementation detail no
// component needs to render off, kept as a module-level variable instead
// (same reasoning interactionStore.ts uses for its listener sets).
interface SceneStore {
  scenes: Scene[];
  addScene: (scene: Scene) => void;
  resizeScene: (id: string, duration: number) => void;
  deleteScene: (id: string) => void;
  jumpToScene: (index: number) => void;
  // 6.3: which scene, if any, the Instruction Builder is currently
  // editing in place (vs. building a brand-new one to append). Lives here
  // rather than as InstructionBuilder-local state so clicking a scene
  // block in Timeline.tsx can drive it -- the two components don't
  // otherwise share state.
  editingSceneId: string | null;
  // Takes a full Scene (including its own, throwaway generated id from
  // buildScene) purely so callers don't have to destructure it away --
  // the id param here always wins, `scene.id` is ignored.
  updateScene: (id: string, scene: Scene) => void;
  stopEditingScene: () => void;
  currentSceneIndex: number | null;
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  // Whether a fresh Play (starting from scene 0, not a resume-from-pause)
  // opens with a scripted glide from world view into scene 1, vs. snapping
  // straight there. Either way the start is now deterministic -- neither
  // depends on wherever the camera happened to be left (a manual pan, or
  // the end of a previous playback). Story-level, not per-scene: it
  // describes how the whole story opens, not any one scene's own behavior.
  startFromWorldView: boolean;
  setStartFromWorldView: (value: boolean) => void;
}

// Floor for drag-to-resize, same as the Instruction Builder's duration
// input -- a scene can't shrink to zero/negative.
const MIN_SCENE_DURATION = 0.5;

let holdTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoldTimer() {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

export const useSceneStore = create<SceneStore>((set, get) => {
  // Dispatches scenes[index]'s camera+actions (via actionRegistry's
  // dispatchScene) and arms the hold timer for its duration, advancing to
  // index+1 when it fires. Reaching past the last scene stops playback,
  // resetting currentSceneIndex to null (so a subsequent Play restarts from
  // scene 0, matching the plan's "replay" expectation rather than staying
  // stuck at the end).
  // `isFirstDispatch` is only true for a fresh Play's very first scene (see
  // play() below) -- that's the one dispatch that needs a deterministic
  // camera start instead of gliding from whatever the live camera happens
  // to be. Every later scene in the same run, and every resume-from-pause,
  // omits it and dispatches exactly as before.
  const playFrom = (index: number, isFirstDispatch = false) => {
    const { scenes, startFromWorldView } = get();
    if (index >= scenes.length) {
      clearHoldTimer();
      set({ isPlaying: false, currentSceneIndex: null });
      return;
    }
    const scene = scenes[index];
    dispatchScene(scene, isFirstDispatch ? (startFromWorldView ? "world" : "instant") : undefined);
    set({ currentSceneIndex: index });
    holdTimer = setTimeout(() => playFrom(index + 1), scene.duration * 1000);
  };

  return {
    scenes: [],
    addScene: (scene) => set((state) => ({ scenes: [...state.scenes, scene] })),
    resizeScene: (id, duration) =>
      set((state) => ({
        scenes: state.scenes.map((scene) =>
          scene.id === id ? { ...scene, duration: Math.max(MIN_SCENE_DURATION, duration) } : scene,
        ),
      })),
    // Unconditionally resets playback (clears the hold timer, stops, drops
    // currentSceneIndex to null) rather than trying to adjust the index to
    // account for the shift -- deleting the currently-playing/paused scene,
    // or one before it, would otherwise leave currentSceneIndex pointing at
    // the wrong scene. Same "start over" reset playFrom already does when
    // it runs off the end of the array.
    deleteScene: (id) => {
      clearHoldTimer();
      set((state) => ({
        scenes: state.scenes.filter((scene) => scene.id !== id),
        isPlaying: false,
        currentSceneIndex: null,
        // Deleting the scene currently being edited would otherwise leave
        // editingSceneId pointing at nothing -- drop out of edit mode too.
        editingSceneId: state.editingSceneId === id ? null : state.editingSceneId,
      }));
    },
    // 6.3: jumps straight to scene N's camera+highlight state via the same
    // dispatchScene primitive playFrom uses -- no transition through
    // scenes in between, and no hold timer armed (this is a one-shot
    // jump, not "start playing from here"). Stops playback if any was
    // running, same reasoning as deleteScene: a manual jump while a hold
    // timer is armed for a *different* scene would otherwise leave that
    // stale timer firing later and clobbering the jump.
    // Also enters edit mode for the clicked scene (editingSceneId) --
    // clicking a block is the only way jumpToScene is triggered today, and
    // per this session's request the two are meant to happen together
    // (preview on the map + populate the form to edit it).
    jumpToScene: (index) => {
      clearHoldTimer();
      const { scenes } = get();
      if (index < 0 || index >= scenes.length) return;
      dispatchScene(scenes[index]);
      set({ isPlaying: false, currentSceneIndex: index, editingSceneId: scenes[index].id });
    },
    editingSceneId: null,
    updateScene: (id, scene) =>
      set((state) => ({
        scenes: state.scenes.map((s) => (s.id === id ? { ...scene, id } : s)),
        editingSceneId: null,
      })),
    stopEditingScene: () => set({ editingSceneId: null }),
    currentSceneIndex: null,
    isPlaying: false,
    // No transition/hold split (roadmap.md section 16, explicitly deferred)
    // -- resuming from Pause re-dispatches and re-holds the current scene
    // for its *full* duration rather than tracking elapsed time, a
    // deliberately rough edge consistent with "even a rough/unpolished
    // sequential playback" per plan-phase6-scenes-timeline.md decision #4.
    play: () => {
      const { isPlaying, scenes, currentSceneIndex } = get();
      if (isPlaying || scenes.length === 0) return;
      const isFreshStart = currentSceneIndex === null;
      set({ isPlaying: true });
      playFrom(currentSceneIndex ?? 0, isFreshStart);
    },
    pause: () => {
      clearHoldTimer();
      set({ isPlaying: false });
    },
    startFromWorldView: false,
    setStartFromWorldView: (value) => set({ startFromWorldView: value }),
  };
});
