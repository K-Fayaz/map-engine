import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { projectAssetsDir } from "./project";
import type { ProjectAudioMeta } from "./project";
import { useProjectStore } from "./projectStore";

// One reference audio track for the whole story -- background music/
// voiceover the user can see (waveform) and hear (independent play/seek,
// see Timeline.tsx) while timing scene durations against it. Deliberately
// its own store, same separation rationale exportStore.ts already gives:
// a distinct, self-contained concern (its own async load/decode lifecycle)
// that doesn't belong in sceneStore.ts's story/scene data. Not synced to
// live camera playback -- sceneStore.ts's playFrom has no shared clock to
// hook one into, and that's out of scope for this pass.
//
// The picked file is copied into the active project's own `assets/`
// folder (same "don't trust the original path to still exist" reasoning
// uploadedImages.ts already established) rather than kept as a raw OS
// path -- a project must still open with its audio intact even if the
// original source file was moved/renamed/deleted after import. `assetId`
// (a filename inside `<project>/assets/`) is what gets persisted in
// project.json; ffmpeg still needs a real absolute OS path at export time
// (it's an external process, oblivious to Tauri's virtual AppData scoping)
// -- exportStore.ts resolves that from assetId via appDataDir()/join().

// Fixed number of peaks regardless of the clip's actual duration -- same
// "target count, not one sample per pixel" idea timelineLayout.ts's
// pickTickInterval already applies to ruler ticks. AudioWaveform.tsx
// stretches these across whatever pixel width the clip's duration works
// out to.
const PEAK_COUNT = 800;

function computePeaks(buffer: AudioBuffer, peakCount: number): number[] {
  const channel = buffer.getChannelData(0);
  const samplesPerPeak = Math.max(1, Math.floor(channel.length / peakCount));
  const peaks: number[] = [];
  for (let i = 0; i < peakCount; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(channel.length, start + samplesPerPeak);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channel[j]);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  return peaks;
}

interface DecodedAudio {
  objectUrl: string;
  durationSeconds: number;
  peaks: number[];
}

// Shared by pickAudioFile (fresh bytes just read from the picked path) and
// hydrateFromProject (bytes read back from the project's own assets/ copy)
// -- both need the same decode-then-build-playable-state steps.
async function decodeAudioBytes(bytes: Uint8Array): Promise<DecodedAudio> {
  // decodeAudioData detaches/consumes its input buffer, and the <audio>
  // element's Blob needs its own copy of the bytes anyway -- slice rather
  // than share the one ArrayBuffer between both uses.
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blobArrayBuffer = arrayBuffer.slice(0);

  const audioContext = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    audioContext.close();
  }

  return {
    objectUrl: URL.createObjectURL(new Blob([blobArrayBuffer])),
    durationSeconds: audioBuffer.duration,
    peaks: computePeaks(audioBuffer, PEAK_COUNT),
  };
}

async function deleteAudioAsset(projectId: string, assetId: string): Promise<void> {
  await remove(`${projectAssetsDir(projectId)}/${assetId}`, {
    baseDir: BaseDirectory.AppData,
  }).catch(() => {
    // Already gone -- not worth surfacing as an error.
  });
}

interface AudioStore {
  fileName: string | null;
  // Filename (incl. extension) inside the active project's `assets/`
  // folder -- replaces the old raw OS `filePath`. Persisted into
  // project.json as ProjectAudioMeta; resolved back to an absolute path
  // only at export time (see exportStore.ts).
  assetId: string | null;
  // Object URL over the same bytes, for the <audio> element's src --
  // transient, rebuilt on every pick/hydrate, never persisted.
  objectUrl: string | null;
  durationSeconds: number | null;
  peaks: number[] | null;
  isLoading: boolean;
  error: string | null;
  pickAudioFile: () => Promise<void>;
  clearAudio: () => void;
  // Rebuilds playable state from a project's saved audio reference --
  // called by projectStore.ts when loading/creating/closing a project.
  // `audio: null` (no track saved, or a fresh/closed project) resets to
  // blank.
  hydrateFromProject: (audio: ProjectAudioMeta | null, projectId: string) => Promise<void>;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  fileName: null,
  assetId: null,
  objectUrl: null,
  durationSeconds: null,
  peaks: null,
  isLoading: false,
  error: null,

  pickAudioFile: async () => {
    if (get().isLoading) return;
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return; // no project open -- shouldn't be reachable once Home routing exists

    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "ogg", "flac", "aac"] }],
      });
      if (!path) return; // user cancelled the dialog -- not an error

      set({ isLoading: true, error: null });

      // Tauri v2's dialog plugin grants fs-read scope for whatever path the
      // user just picked through it -- no static filesystem scope needed.
      const bytes = await readFile(path);
      const decoded = await decodeAudioBytes(bytes);

      const extension = path.split(".").pop();
      const assetId = extension ? `${crypto.randomUUID()}.${extension}` : crypto.randomUUID();
      await mkdir(projectAssetsDir(projectId), { recursive: true, baseDir: BaseDirectory.AppData });
      await writeFile(`${projectAssetsDir(projectId)}/${assetId}`, bytes, {
        baseDir: BaseDirectory.AppData,
      });

      // Audio is a single slot per project (unlike highlight images, which
      // can have many live references) -- importing a new track replaces
      // the old one outright, so its now-orphaned copy is deleted rather
      // than left to accumulate in assets/.
      const previousAssetId = get().assetId;
      const previousUrl = get().objectUrl;
      if (previousAssetId) await deleteAudioAsset(projectId, previousAssetId);
      if (previousUrl) URL.revokeObjectURL(previousUrl);

      const fileName = path.split(/[\\/]/).pop() ?? path;
      set({
        fileName,
        assetId,
        objectUrl: decoded.objectUrl,
        durationSeconds: decoded.durationSeconds,
        peaks: decoded.peaks,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearAudio: () => {
    const { objectUrl, assetId } = get();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const projectId = useProjectStore.getState().activeProjectId;
    if (assetId && projectId) void deleteAudioAsset(projectId, assetId);
    set({
      fileName: null,
      assetId: null,
      objectUrl: null,
      durationSeconds: null,
      peaks: null,
      error: null,
    });
  },

  hydrateFromProject: async (audio, projectId) => {
    const previousUrl = get().objectUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);

    if (!audio) {
      set({
        fileName: null,
        assetId: null,
        objectUrl: null,
        durationSeconds: null,
        peaks: null,
        isLoading: false,
        error: null,
      });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const bytes = await readFile(`${projectAssetsDir(projectId)}/${audio.id}`, {
        baseDir: BaseDirectory.AppData,
      });
      const decoded = await decodeAudioBytes(bytes);
      set({
        fileName: audio.originalName,
        assetId: audio.id,
        objectUrl: decoded.objectUrl,
        durationSeconds: decoded.durationSeconds,
        peaks: decoded.peaks,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({
        fileName: null,
        assetId: null,
        objectUrl: null,
        durationSeconds: null,
        peaks: null,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
