import { create } from "zustand";
import { save } from "@tauri-apps/plugin-dialog";
import type { Scene } from "./scenes";
import type { Entity } from "./entities";
import { runExport, type ExportHandle } from "./exportPipeline";
import { interactionStore } from "./interactionStore";

// Export's own store, separate from sceneStore/interactionStore -- same
// reasoning sceneStore.ts already gives for being separate from
// interactionStore: scoped to this one new feature, so nothing about
// existing playback/interaction state risks regressing. Export only ever
// *reads* sceneStore's `scenes` (passed in by the caller, see startExport
// below) -- it never calls sceneStore.play()/pause() or touches
// isPlaying/currentSceneIndex, so the live canvas is provably unaffected by
// an export running (the design doc's core requirement).
export type ExportStatus = "idle" | "exporting" | "done" | "error";

const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
const EXPORT_FPS = 30;

interface ExportStore {
  status: ExportStatus;
  currentFrame: number;
  totalFrames: number;
  errorMessage: string | null;
  startExport: (scenes: Scene[], startFromWorldView: boolean) => Promise<void>;
  cancelExport: () => void;
}

let activeHandle: ExportHandle | null = null;

export const useExportStore = create<ExportStore>((set, get) => ({
  status: "idle",
  currentFrame: 0,
  totalFrames: 0,
  errorMessage: null,

  startExport: async (scenes, startFromWorldView) => {
    if (get().status === "exporting" || scenes.length === 0) return;

    try {
      // Standard "Save As" dialog rather than a fixed path -- matches how a
      // desktop export feature is expected to behave, and the design doc
      // never specifies a fixed location.
      const outputPath = await save({
        defaultPath: "export.mp4",
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      });
      if (!outputPath) return; // user cancelled the dialog -- not an error

      // Captured once, now, rather than read live during the export --
      // showStateBorders isn't part of Scene data (see the plan's §6.8), so
      // "whatever it was when Export was clicked" is the only sensible
      // source, and reading it live mid-export would make output depend on
      // something the user could still be toggling on screen.
      const showStateBorders = interactionStore.getState().showStateBorders;
      // Same reasoning for entities: a snapshot, not a live subscription --
      // export must depend only on the story definition, not on anything
      // that could change while it runs.
      const entities: Entity[] = interactionStore.getState().entities;

      set({ status: "exporting", currentFrame: 0, totalFrames: 0, errorMessage: null });

      const handle = await runExport(
        scenes,
        entities,
        {
          width: EXPORT_WIDTH,
          height: EXPORT_HEIGHT,
          fps: EXPORT_FPS,
          outputPath,
          cameraStart: startFromWorldView ? "world" : "instant",
          showStateBorders,
        },
        (currentFrame, totalFrames) => set({ currentFrame, totalFrames }),
      );
      activeHandle = handle;
      await handle.run();
      activeHandle = null;
      set({ status: get().status === "exporting" ? "done" : get().status });
    } catch (err) {
      activeHandle = null;
      set({ status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
    }
  },

  cancelExport: () => {
    activeHandle?.cancel();
    set({ status: "idle" });
  },
}));
