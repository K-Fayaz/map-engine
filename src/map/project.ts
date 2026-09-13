import {
  BaseDirectory,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Scene } from "./scenes";
import type { ExportRatio } from "./exportStore";

// Project persistence (V1 launch roadmap Phase 2). Projects live at
// `$APPDATA/projects/<generated-uuid>/`, each holding `project.json` plus an
// `assets/` subfolder for copied audio/highlight-image files -- no raw OS
// paths are ever persisted, since a project must still open correctly if the
// original source files it was built from move or are deleted (the gap the
// audio-path story had before this).
//
// This module is pure data + fs I/O, no React/zustand, mirroring how
// uploadedImages.ts is a plain module that stores (sceneStore.ts) call into
// rather than a store itself.

export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectAudioMeta {
  /** Filename (incl. extension) inside `<project>/assets/`, e.g. "<uuid>.mp3". */
  id: string;
  /** Original picked filename, for display only. */
  originalName: string;
}

export interface ProjectFile {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
  showStateBorders: boolean;
  selectedProfile: ExportRatio;
  startFromWorldView: boolean;
  audio: ProjectAudioMeta | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

const PROJECT_DIR = "projects";

export function projectDir(id: string): string {
  return `${PROJECT_DIR}/${id}`;
}

export function projectFilePath(id: string): string {
  return `${projectDir(id)}/project.json`;
}

export function projectAssetsDir(id: string): string {
  return `${projectDir(id)}/assets`;
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  let entries;
  try {
    entries = await readDir(PROJECT_DIR, { baseDir: BaseDirectory.AppData });
  } catch {
    // No projects/ directory yet -- first launch, nothing to list.
    return [];
  }

  const summaries: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    // A corrupt/partial project folder must not take down the whole list --
    // skip it rather than letting one bad entry fail every other project.
    try {
      const raw = await readTextFile(projectFilePath(entry.name), {
        baseDir: BaseDirectory.AppData,
      });
      const parsed = JSON.parse(raw) as Partial<ProjectFile>;
      if (!parsed.id || !parsed.name || !parsed.updatedAt) continue;
      summaries.push({
        id: parsed.id,
        name: parsed.name,
        updatedAt: parsed.updatedAt,
      });
    } catch {
      continue;
    }
  }

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function readProjectFile(id: string): Promise<ProjectFile> {
  const raw = await readTextFile(projectFilePath(id), {
    baseDir: BaseDirectory.AppData,
  });
  const parsed = JSON.parse(raw) as ProjectFile;
  // schemaVersion is written from day one for future migrations, but there
  // is nothing to migrate yet -- treat a missing value (e.g. a hand-edited
  // file) as version 1 rather than throwing.
  return { ...parsed, schemaVersion: parsed.schemaVersion ?? 1 };
}

export async function writeProjectFile(project: ProjectFile): Promise<void> {
  await mkdir(projectDir(project.id), {
    recursive: true,
    baseDir: BaseDirectory.AppData,
  });
  await writeTextFile(
    projectFilePath(project.id),
    JSON.stringify(project, null, 2),
    { baseDir: BaseDirectory.AppData },
  );
}

export async function deleteProjectFolder(id: string): Promise<void> {
  await remove(projectDir(id), {
    recursive: true,
    baseDir: BaseDirectory.AppData,
  });
}
