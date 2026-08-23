import { Application, Rectangle } from "pixi.js";
import { invoke } from "@tauri-apps/api/core";
import { buildWorldScene, MAX_ZOOM, OCEAN_COLOR, type WorldScene } from "./worldRenderer";
import { resolveAt, timelineDuration } from "./timelineResolver";
import type { Scene } from "./scenes";
import type { Entity } from "./entities";

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  cameraStart: "instant" | "world";
  showStateBorders: boolean;
}

// `Math.ceil` so a story whose duration isn't an exact multiple of the frame
// interval still gets one final frame covering the remainder, rather than
// truncating the last fraction of a second. `timelineDuration` (an empty
// scene list) is 0, floored to 1 so an export always emits at least one
// frame rather than a zero-length/invalid video.
export function computeTotalFrames(scenes: Scene[], fps: number): number {
  return Math.max(1, Math.ceil(timelineDuration(scenes) * fps));
}

export interface RunExportLoopOptions {
  totalFrames: number;
  fps: number;
  renderFrame: (t: number) => Uint8Array;
  writeFrame: (bytes: Uint8Array) => Promise<void>;
  onProgress?: (frame: number, totalFrames: number) => void;
  shouldCancel?: () => boolean;
  // Overridable for tests -- production passes a real macrotask yield
  // (`setTimeout(resolve, 0)`) so the UI thread gets a chance to paint
  // progress/handle Cancel clicks between frames; tests can pass a no-op to
  // run synchronously.
  yieldToUi?: () => Promise<void>;
}

// The orchestration loop, deliberately separated from anything Pixi/Tauri-
// specific (see runExport below) so it's unit-testable with plain fakes:
// frame timing, cancellation, and progress reporting are pure sequencing
// concerns, independent of how a frame is actually rendered or written.
// Never a single blocking synchronous pass -- see the export plan's "must
// never drop or freeze frames" requirement, which is about UI
// responsiveness during a long export, not frame correctness (resolveAt is
// already a pure function of t regardless of wall-clock timing).
export async function runExportLoop(options: RunExportLoopOptions): Promise<void> {
  const { totalFrames, fps, renderFrame, writeFrame, onProgress, shouldCancel, yieldToUi } = options;
  const yieldFn = yieldToUi ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    if (shouldCancel?.()) return;

    const t = frameIndex / fps;
    const bytes = renderFrame(t);
    await writeFrame(bytes);

    onProgress?.(frameIndex + 1, totalFrames);
    await yieldFn();
  }
}

export interface ExportHandle {
  run(): Promise<void>;
  cancel(): void;
}

// Builds everything the export loop needs to actually render frames: an
// offscreen (never DOM-attached) Pixi Application plus a WorldScene built
// via the same buildWorldScene live playback uses (see worldRenderer.ts) --
// so export renders identically to live, not through a diverging copy.
// Always builds at the highest-detail resolution, unchunked, once, up
// front -- live's chunked LOD swap exists purely to keep an interactive
// rAF loop responsive, which doesn't apply here (see the export plan).
function buildExportRenderer(width: number, height: number): { app: Application; scene: WorldScene } | Promise<{ app: Application; scene: WorldScene }> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const app = new Application();
  return app
    .init({ canvas, width, height, backgroundColor: 0x068494, antialias: true })
    .then(() => {
      const scene = buildWorldScene(width, height);
      app.stage.addChild(scene.worldContainer);
      scene.setResolution("10m");
      return { app, scene };
    });
}

// Wires the pure loop above to real rendering (buildExportRenderer) and the
// real Rust-side ffmpeg sidecar (start_export/write_frame/finish_export/
// cancel_export -- see src-tauri/src/export.rs). Deliberately never touches
// sceneStore.play()/isPlaying/currentSceneIndex -- export only *reads*
// `scenes` as input data, so the live canvas is unaffected by an export
// running, per the plan's "clicking Export must not start the visible
// canvas playing" requirement.
export async function runExport(
  scenes: Scene[],
  entities: Entity[],
  settings: ExportSettings,
  onProgress?: (frame: number, totalFrames: number) => void,
): Promise<ExportHandle> {
  const { width, height, fps, outputPath, cameraStart, showStateBorders } = settings;
  const totalFrames = computeTotalFrames(scenes, fps);

  const { app, scene } = await buildExportRenderer(width, height);
  let cancelled = false;

  const renderFrame = (t: number): Uint8Array => {
    const resolved = resolveAt(scenes, entities, t, width, height, scene.baseScaleX, scene.baseScaleY, MAX_ZOOM, cameraStart);
    scene.drawHighlights(new Set(resolved.highlightedEntityId ? [resolved.highlightedEntityId] : []), null);
    scene.applyCamera(resolved.camera, showStateBorders);
    app.renderer.render(app.stage);
    const { pixels } = app.renderer.extract.pixels({
      target: app.stage,
      frame: new Rectangle(0, 0, width, height),
      // extract.pixels() renders `target` into its own fresh render
      // texture -- it does NOT reuse the Application's `backgroundColor`
      // clear (that only applies when rendering straight to the screen).
      // The ocean is never an actual drawn shape (no Graphics covers it),
      // so without this it extracts as transparent black instead of
      // OCEAN_COLOR. Live playback never hits this, since it always
      // renders to the screen, not through extract.
      clearColor: OCEAN_COLOR,
    });
    // Zero-copy view over the same bytes -- extract.pixels returns a
    // Uint8ClampedArray, but Tauri's invoke() (and this module's own types)
    // expect Uint8Array; both are identical byte layouts for raw RGBA.
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  };

  // Passed as `args` directly (not `{ bytes }`) -- Tauri's IPC bridge
  // special-cases a raw ArrayBuffer/Uint8Array `args` value into the fast
  // binary-body transfer path instead of JSON-encoding every byte as a
  // decimal array element, which matters a lot at ~8.3MB/frame (1920x1080
  // RGBA) -- see InvokeArgs in @tauri-apps/api/core.
  const writeFrame = (bytes: Uint8Array): Promise<void> => invoke("write_frame", bytes);

  const destroy = () => {
    scene.destroy();
    app.destroy(true, { children: true });
  };

  const run = async (): Promise<void> => {
    await invoke("start_export", { width, height, fps, outputPath });
    try {
      await runExportLoop({
        totalFrames,
        fps,
        renderFrame,
        writeFrame,
        onProgress,
        shouldCancel: () => cancelled,
      });
      if (cancelled) {
        await invoke("cancel_export");
      } else {
        await invoke("finish_export");
      }
    } catch (err) {
      await invoke("cancel_export").catch(() => {});
      throw err;
    } finally {
      destroy();
    }
  };

  return {
    run,
    cancel() {
      cancelled = true;
    },
  };
}
