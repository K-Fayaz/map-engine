import { create } from "zustand";
import type { Scene } from "./scenes";

// Scene/timeline state, read by both the Instruction Builder ("Add to
// Timeline" pushes here) and the Timeline panel (renders whatever's in
// here). A separate zustand store from interactionStore.ts's hand-rolled
// pub/sub, not an extension of it -- deliberate, per
// plan-phase6-scenes-timeline.md's decision #7: scoped to this new feature
// only, interactionStore stays exactly as it was so nothing about Phase 1-5
// risks regressing.
interface SceneStore {
  scenes: Scene[];
  addScene: (scene: Scene) => void;
}

export const useSceneStore = create<SceneStore>((set) => ({
  scenes: [],
  addScene: (scene) => set((state) => ({ scenes: [...state.scenes, scene] })),
}));
