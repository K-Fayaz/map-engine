import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

// One reference audio track for the whole story -- background music/
// voiceover the user can see (waveform) and hear (independent play/seek,
// see Timeline.tsx) while timing scene durations against it. Deliberately
// its own store, same separation rationale exportStore.ts already gives:
// a distinct, self-contained concern (its own async load/decode lifecycle)
// that doesn't belong in sceneStore.ts's story/scene data. Not synced to
// live camera playback -- sceneStore.ts's playFrom has no shared clock to
// hook one into, and that's out of scope for this pass.

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

interface AudioStore {
  fileName: string | null;
  // Local filesystem path -- ffmpeg reads this itself, as its own OS
  // process, for export muxing (see exportStore.ts/export.rs). Never sent
  // anywhere as bytes.
  filePath: string | null;
  // Object URL over the same bytes readFile() already returned, for the
  // <audio> element's src.
  objectUrl: string | null;
  durationSeconds: number | null;
  peaks: number[] | null;
  isLoading: boolean;
  error: string | null;
  pickAudioFile: () => Promise<void>;
  clearAudio: () => void;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  fileName: null,
  filePath: null,
  objectUrl: null,
  durationSeconds: null,
  peaks: null,
  isLoading: false,
  error: null,

  pickAudioFile: async () => {
    if (get().isLoading) return;

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
      // decodeAudioData detaches/consumes its input buffer, and the <audio>
      // element's Blob needs its own copy of the bytes anyway -- slice
      // rather than share the one ArrayBuffer between both uses.
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

      const previousUrl = get().objectUrl;
      const objectUrl = URL.createObjectURL(new Blob([blobArrayBuffer]));
      if (previousUrl) URL.revokeObjectURL(previousUrl);

      const fileName = path.split(/[\\/]/).pop() ?? path;
      set({
        fileName,
        filePath: path,
        objectUrl,
        durationSeconds: audioBuffer.duration,
        peaks: computePeaks(audioBuffer, PEAK_COUNT),
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearAudio: () => {
    const previousUrl = get().objectUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    set({
      fileName: null,
      filePath: null,
      objectUrl: null,
      durationSeconds: null,
      peaks: null,
      error: null,
    });
  },
}));
