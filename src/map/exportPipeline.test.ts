import { describe, expect, it, vi } from "vitest";
import { computeTotalFrames, runExportLoop } from "./exportPipeline";
import type { Scene } from "./scenes";

function holdScene(duration: number): Scene {
  return { id: "s", duration, actions: [] };
}

describe("computeTotalFrames", () => {
  it("rounds up so a partial final frame interval still gets a frame", () => {
    // 1.5s at 30fps = 45 frames exactly; 1.55s should round up to 47, not 46.
    expect(computeTotalFrames([holdScene(1.5)], 30)).toBe(45);
    expect(computeTotalFrames([holdScene(1.55)], 30)).toBe(47);
  });

  it("never returns fewer than 1 frame, even for an empty timeline", () => {
    expect(computeTotalFrames([], 30)).toBe(1);
  });
});

describe("runExportLoop", () => {
  it("renders and writes every frame in order, reporting progress each time", async () => {
    const rendered: number[] = [];
    const written: number[] = [];
    const progress: Array<[number, number]> = [];

    await runExportLoop({
      totalFrames: 5,
      fps: 10,
      renderFrame: (t) => {
        rendered.push(t);
        return new Uint8Array([t * 10]);
      },
      writeFrame: async (bytes) => {
        written.push(bytes[0]);
      },
      onProgress: (frame, total) => progress.push([frame, total]),
      yieldToUi: async () => {},
    });

    expect(rendered).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(written).toEqual([0, 1, 2, 3, 4]);
    expect(progress).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  });

  it("stops early and writes nothing further once cancelled", async () => {
    const rendered: number[] = [];
    let cancelAfter = 2;

    await runExportLoop({
      totalFrames: 10,
      fps: 10,
      renderFrame: (t) => {
        rendered.push(t);
        return new Uint8Array();
      },
      writeFrame: async () => {},
      shouldCancel: () => rendered.length >= cancelAfter,
      yieldToUi: async () => {},
    });

    expect(rendered).toEqual([0, 0.1]);
  });

  it("renders/writes each frame before starting the next (no overlap)", async () => {
    const events: string[] = [];

    await runExportLoop({
      totalFrames: 3,
      fps: 10,
      renderFrame: (t) => {
        events.push(`render:${t}`);
        return new Uint8Array();
      },
      writeFrame: async () => {
        events.push("write:start");
        await new Promise((resolve) => setTimeout(resolve, 0));
        events.push("write:end");
      },
      yieldToUi: async () => {},
    });

    expect(events).toEqual([
      "render:0",
      "write:start",
      "write:end",
      "render:0.1",
      "write:start",
      "write:end",
      "render:0.2",
      "write:start",
      "write:end",
    ]);
  });

  it("calls the UI yield hook between frames", async () => {
    const yieldSpy = vi.fn(async () => {});

    await runExportLoop({
      totalFrames: 3,
      fps: 10,
      renderFrame: () => new Uint8Array(),
      writeFrame: async () => {},
      yieldToUi: yieldSpy,
    });

    expect(yieldSpy).toHaveBeenCalledTimes(3);
  });
});
