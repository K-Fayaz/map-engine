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
  currentSceneIndex: number | null;
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
}

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
  const playFrom = (index: number) => {
    const { scenes } = get();
    if (index >= scenes.length) {
      clearHoldTimer();
      set({ isPlaying: false, currentSceneIndex: null });
      return;
    }
    const scene = scenes[index];
    dispatchScene(scene);
    set({ currentSceneIndex: index });
    holdTimer = setTimeout(() => playFrom(index + 1), scene.duration * 1000);
  };

  return {
    scenes: [],
    addScene: (scene) => set((state) => ({ scenes: [...state.scenes, scene] })),
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
      set({ isPlaying: true });
      playFrom(currentSceneIndex ?? 0);
    },
    pause: () => {
      clearHoldTimer();
      set({ isPlaying: false });
    },
  };
});
