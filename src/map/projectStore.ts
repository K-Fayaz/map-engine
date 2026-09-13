import { create } from "zustand";
import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { ProjectFile, ProjectSummary } from "./project";
import {
  PROJECT_SCHEMA_VERSION,
  deleteProjectFolder,
  listProjectSummaries,
  projectAssetsDir,
  readProjectFile,
  writeProjectFile,
} from "./project";
import { useSceneStore } from "./sceneStore";
import { interactionStore } from "./interactionStore";
import { useExportStore } from "./exportStore";
import { useAudioStore } from "./audioStore";

// Orchestrates project create/open/save/rename/delete across every store
// that holds project-scoped data (sceneStore, interactionStore, exportStore,
// audioStore). None of those stores know about "projects" themselves -- this
// is the only module that reaches into all four, mirroring how sceneStore.ts
// already reaches into interactionStore/uploadedImages.ts for its own
// cross-cutting concerns (playback highlights, orphaned-upload cleanup)
// without those modules needing to know why.

function blankProjectFile(id: string, name: string): ProjectFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    scenes: [],
    showStateBorders: true,
    selectedProfile: "9:16",
    startFromWorldView: false,
    audio: null,
  };
}

// Applies `project`'s data to every store that holds project-scoped state.
// Deliberately awaits audio last (its copy-read is slower than the other
// three, plain-data hydrations) so callers can await the whole thing before
// treating a project as "loaded" -- the editor should never mount with
// scenes already populated but audio still blank/stale.
async function hydrateStoresFromProject(project: ProjectFile): Promise<void> {
  useSceneStore.setState({
    scenes: project.scenes,
    editingSceneId: null,
    currentSceneIndex: null,
    currentSceneStartedAt: null,
    isPlaying: false,
    startFromWorldView: project.startFromWorldView,
  });
  interactionStore.hydrate({ showStateBorders: project.showStateBorders });
  useExportStore.getState().cancelExport();
  useExportStore.setState({
    selectedProfile: project.selectedProfile,
    status: "idle",
    currentFrame: 0,
    totalFrames: 0,
    errorMessage: null,
  });
  await useAudioStore.getState().hydrateFromProject(project.audio, project.id);
}

// Reads every store's current project-scoped state and folds it into a
// ProjectFile, preserving `id`/`createdAt` (and `name`, unless overridden --
// see renameProject) from what's already known rather than the caller
// re-deriving them.
function gatherProjectFile(base: Pick<ProjectFile, "id" | "name" | "createdAt">): ProjectFile {
  const { scenes, startFromWorldView } = useSceneStore.getState();
  const { showStateBorders } = interactionStore.getState();
  const { selectedProfile } = useExportStore.getState();
  const { assetId, fileName } = useAudioStore.getState();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: base.id,
    name: base.name,
    createdAt: base.createdAt,
    updatedAt: new Date().toISOString(),
    scenes,
    showStateBorders,
    selectedProfile,
    startFromWorldView,
    audio: assetId ? { id: assetId, originalName: fileName ?? assetId } : null,
  };
}

interface ProjectStoreState {
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectCreatedAt: string | null;
  isSaving: boolean;
  isDirty: boolean;
  error: string | null;

  listProjects: () => Promise<ProjectSummary[]>;
  createProject: (name: string) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  saveProject: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  closeProject: () => void;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  activeProjectId: null,
  activeProjectName: null,
  activeProjectCreatedAt: null,
  isSaving: false,
  isDirty: false,
  error: null,

  listProjects: () => listProjectSummaries(),

  createProject: async (name) => {
    const id = crypto.randomUUID();
    const project = blankProjectFile(id, name);
    await writeProjectFile(project);
    await mkdir(projectAssetsDir(id), { recursive: true, baseDir: BaseDirectory.AppData });
    await hydrateStoresFromProject(project);
    set({
      activeProjectId: id,
      activeProjectName: name,
      activeProjectCreatedAt: project.createdAt,
      isDirty: false,
      error: null,
    });
  },

  loadProject: async (id) => {
    const project = await readProjectFile(id);
    await hydrateStoresFromProject(project);
    set({
      activeProjectId: project.id,
      activeProjectName: project.name,
      activeProjectCreatedAt: project.createdAt,
      isDirty: false,
      error: null,
    });
  },

  saveProject: async () => {
    const { activeProjectId, activeProjectName, activeProjectCreatedAt, isSaving } = get();
    if (!activeProjectId || !activeProjectName || !activeProjectCreatedAt || isSaving) return;
    set({ isSaving: true, error: null });
    try {
      const project = gatherProjectFile({
        id: activeProjectId,
        name: activeProjectName,
        createdAt: activeProjectCreatedAt,
      });
      await writeProjectFile(project);
      set({ isSaving: false, isDirty: false });
    } catch (err) {
      set({ isSaving: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  renameProject: async (id, name) => {
    const { activeProjectId, activeProjectCreatedAt } = get();
    if (id === activeProjectId) {
      // The project is open -- fold the new name into whatever's currently
      // in the stores (which may include unsaved edits) rather than an
      // independent read-modify-write against disk, which would read stale
      // saved state back over live changes.
      set({ activeProjectName: name });
      if (!activeProjectCreatedAt) return;
      set({ isSaving: true, error: null });
      try {
        const project = gatherProjectFile({ id, name, createdAt: activeProjectCreatedAt });
        await writeProjectFile(project);
        set({ isSaving: false });
      } catch (err) {
        set({ isSaving: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    // Not open -- nothing unsaved to clobber, safe to read-modify-write.
    const project = await readProjectFile(id);
    await writeProjectFile({ ...project, name, updatedAt: new Date().toISOString() });
  },

  deleteProject: async (id) => {
    await deleteProjectFolder(id);
    if (id === get().activeProjectId) get().closeProject();
  },

  closeProject: () => {
    const blank = blankProjectFile(crypto.randomUUID(), "");
    void hydrateStoresFromProject(blank);
    set({
      activeProjectId: null,
      activeProjectName: null,
      activeProjectCreatedAt: null,
      isDirty: false,
      error: null,
    });
  },
}));

// Guards any place the user could lose unsaved work -- the TopBar's "back
// to Projects" button and the OS window-close request (App.tsx). Returns
// true when it's safe to proceed (nothing unsaved, or the user chose to
// save first); false means the user chose to stay, and the caller must not
// navigate away / must cancel the close. Uses the dialog plugin's confirm()
// rather than the browser's window.confirm() -- Tauri's webview (WebKitGTK
// on Linux) doesn't implement window.confirm as a real blocking dialog; it
// silently resolves without ever showing anything, which is what made this
// guard appear to do nothing. The user's explicit choice: Save & Leave vs.
// Cancel, no separate "discard" path.
export async function confirmLeaveWithUnsavedChanges(): Promise<boolean> {
  const { isDirty, saveProject } = useProjectStore.getState();
  if (!isDirty) return true;
  const shouldSave = await confirm("You have unsaved changes. Save before leaving?", {
    title: "Unsaved changes",
    okLabel: "Save & Leave",
    cancelLabel: "Cancel",
  });
  if (!shouldSave) return false;
  await saveProject();
  return true;
}

// Best-effort dirty tracking for a "you have unsaved changes" UI hint --
// Save stays a manual action regardless, so exactness isn't required here.
// hydrateStoresFromProject's own setState calls also trigger these
// subscribers; loadProject/createProject/closeProject all set isDirty:false
// *after* hydration finishes, which stomps the trailing false-positive from
// hydration's own writes. Every field gatherProjectFile actually persists
// needs a corresponding trigger here, or an edit to it can go "unsaved"
// forever with no prompt ever firing.
function markDirty() {
  if (useProjectStore.getState().activeProjectId) useProjectStore.setState({ isDirty: true });
}

useSceneStore.subscribe(markDirty); // scenes, startFromWorldView

let lastShowStateBorders = interactionStore.getState().showStateBorders;
interactionStore.subscribe(() => {
  const current = interactionStore.getState().showStateBorders;
  if (current !== lastShowStateBorders) {
    lastShowStateBorders = current;
    markDirty();
  }
});

useExportStore.subscribe((s, prev) => {
  if (s.selectedProfile !== prev.selectedProfile) markDirty();
});

useAudioStore.subscribe((s, prev) => {
  if (s.assetId !== prev.assetId || s.fileName !== prev.fileName) markDirty();
});
