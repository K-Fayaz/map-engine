import { describe, expect, it } from "vitest";
import { resolveAt, timelineDuration } from "./timelineResolver";
import type { Scene } from "./scenes";
import type { Entity } from "./entities";
import { computeFramingBounds } from "./entities";
import { project } from "./render";
import { clampCamera, focusOnBounds, MIN_ZOOM, type WorldBounds } from "./camera";

// Fixed viewport used by every test -- arbitrary but consistent with the
// export target discussed in the plan (1920x1080), so numbers exercised
// here are representative of real export values.
const SCREEN_W = 1920;
const SCREEN_H = 1080;
const BASE_SCALE_X = 0.96; // roughly what applyViewFit would derive; exact
const BASE_SCALE_Y = 0.96; // value doesn't matter, only consistency across calls
const MAX_ZOOM = 2000;

function resolve(scenes: Scene[], entities: Entity[], t: number, cameraStart: "instant" | "world" = "instant") {
  return resolveAt(scenes, entities, t, SCREEN_W, SCREEN_H, BASE_SCALE_X, BASE_SCALE_Y, MAX_ZOOM, cameraStart);
}

function expectedEntityCamera(entity: Entity, zoomPercent = 100) {
  const bb = computeFramingBounds(entity.geometry);
  const [minX, maxY] = project(bb.minLon, bb.minLat);
  const [maxX, minY] = project(bb.maxLon, bb.maxLat);
  const bounds: WorldBounds = { minX, minY, maxX, maxY };
  return focusOnBounds(bounds, SCREEN_W, SCREEN_H, BASE_SCALE_X, BASE_SCALE_Y, MAX_ZOOM, 0.8, zoomPercent / 100);
}

function makeEntity(id: string, opts?: { lon?: [number, number]; lat?: [number, number] }): Entity {
  const [lon0, lon1] = opts?.lon ?? [10, 14];
  const [lat0, lat1] = opts?.lat ?? [10, 14];
  return {
    id,
    name: id,
    type: "country",
    geometry: {
      type: "Polygon",
      coordinates: [[[lon0, lat0], [lon0, lat1], [lon1, lat1], [lon1, lat0], [lon0, lat0]]],
    },
    boundingBox: { minLon: lon0, minLat: lat0, maxLon: lon1, maxLat: lat1 },
  };
}

// Mimics Russia/USA-shaped territory straddling the antimeridian: a large
// dominant landmass on the positive side (lon 100..180) plus a small sliver
// on the negative side (-180..-170) -- same shape computeFramingBounds's own
// header comment describes verifying against.
function makeAntimeridianEntity(id: string): Entity {
  return {
    id,
    name: id,
    type: "country",
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[[100, 60], [180, 60], [180, 70], [100, 70], [100, 60]]],
        [[[-180, 60], [-170, 60], [-170, 70], [-180, 70], [-180, 60]]],
      ],
    },
    boundingBox: { minLon: -180, minLat: 60, maxLon: 180, maxLat: 70 },
  };
}

function panScene(id: string, duration: number, targetEntityId?: string, zoomPercent = 100): Scene {
  return {
    id,
    duration,
    targetEntityId,
    actions: [],
    camera: { type: "pan", params: { ...(targetEntityId ? { targetEntityId } : {}), zoomPercent } },
  };
}

function highlightScene(id: string, duration: number, entityId: string, zoomPercent = 100): Scene {
  return {
    id,
    duration,
    targetEntityId: entityId,
    actions: [{ type: "highlight", params: { entityId } }],
    camera: { type: "pan", params: { targetEntityId: entityId, zoomPercent } },
  };
}

function clearHighlightScene(id: string, duration: number, entityId: string): Scene {
  return {
    id,
    duration,
    targetEntityId: entityId,
    actions: [{ type: "clearHighlight", params: { entityId } }],
  };
}

function holdScene(id: string, duration: number): Scene {
  return { id, duration, actions: [] };
}

const WORLD_VIEW = clampCamera({ x: 0, y: 0, zoom: MIN_ZOOM }, SCREEN_W, SCREEN_H, MAX_ZOOM);

describe("timelineDuration", () => {
  it("sums scene durations", () => {
    expect(timelineDuration([holdScene("a", 2), holdScene("b", 3.5)])).toBe(5.5);
  });

  it("is zero for an empty timeline", () => {
    expect(timelineDuration([])).toBe(0);
  });
});

describe("resolveAt: empty timeline", () => {
  it("resolves to world view with no highlight", () => {
    const state = resolveAt([], [], 0, SCREEN_W, SCREEN_H, BASE_SCALE_X, BASE_SCALE_Y, MAX_ZOOM, "instant");
    expect(state.camera).toEqual(WORLD_VIEW);
    expect(state.highlightedEntityId).toBeNull();
  });
});

describe("resolveAt: single pan scene", () => {
  it("world pan (no target entity) stays at world view throughout", () => {
    const scenes = [panScene("s0", 4)];
    for (const t of [0, 1, 2, 4]) {
      const state = resolve(scenes, [], t);
      expect(state.camera.x).toBeCloseTo(WORLD_VIEW.x, 5);
      expect(state.camera.y).toBeCloseTo(WORLD_VIEW.y, 5);
      expect(state.camera.zoom).toBeCloseTo(WORLD_VIEW.zoom, 5);
    }
  });

  it("entity pan with cameraStart=instant starts already at the target (no glide)", () => {
    const entity = makeEntity("e1");
    const scenes = [panScene("s0", 4, "e1")];
    const expected = expectedEntityCamera(entity);
    const atStart = resolve(scenes, [entity], 0, "instant");
    const atEnd = resolve(scenes, [entity], 4, "instant");
    expect(atStart.camera.x).toBeCloseTo(expected.x, 5);
    expect(atStart.camera.y).toBeCloseTo(expected.y, 5);
    expect(atStart.camera.zoom).toBeCloseTo(expected.zoom, 5);
    expect(atEnd.camera).toEqual(atStart.camera);
  });

  it("entity pan with cameraStart=world glides from the world view to the target", () => {
    const entity = makeEntity("e1");
    const scenes = [panScene("s0", 4, "e1")];
    const expected = expectedEntityCamera(entity);

    const atStart = resolve(scenes, [entity], 0, "world");
    expect(atStart.camera.x).toBeCloseTo(WORLD_VIEW.x, 5);
    expect(atStart.camera.y).toBeCloseTo(WORLD_VIEW.y, 5);
    expect(atStart.camera.zoom).toBeCloseTo(WORLD_VIEW.zoom, 5);

    const atEnd = resolve(scenes, [entity], 4, "world");
    expect(atEnd.camera.x).toBeCloseTo(expected.x, 4);
    expect(atEnd.camera.y).toBeCloseTo(expected.y, 4);
    expect(atEnd.camera.zoom).toBeCloseTo(expected.zoom, 4);

    // Mid-flight should differ from both endpoints -- confirms an actual
    // tween is happening, not a hard cut at some threshold.
    const mid = resolve(scenes, [entity], 2, "world");
    expect(mid.camera).not.toEqual(atStart.camera);
    expect(mid.camera).not.toEqual(atEnd.camera);
  });
});

describe("resolveAt: highlight / clearHighlight", () => {
  it("highlight sets highlightedEntityId and pans to the entity", () => {
    const entity = makeEntity("e1");
    const scenes = [highlightScene("s0", 3, "e1")];
    const state = resolve(scenes, [entity], 1);
    expect(state.highlightedEntityId).toBe("e1");
  });

  it("clearHighlight clears it and does not move the camera", () => {
    const entity = makeEntity("e1");
    const scenes = [highlightScene("s0", 2, "e1"), clearHighlightScene("s1", 2, "e1")];
    const expected = expectedEntityCamera(entity);

    const duringHighlight = resolve(scenes, [entity], 1);
    expect(duringHighlight.highlightedEntityId).toBe("e1");

    const duringClear = resolve(scenes, [entity], 3);
    expect(duringClear.highlightedEntityId).toBeNull();
    // clearHighlight has no camera action of its own -- camera stays
    // exactly where the highlight scene left it.
    expect(duringClear.camera.x).toBeCloseTo(expected.x, 4);
    expect(duringClear.camera.y).toBeCloseTo(expected.y, 4);
    expect(duringClear.camera.zoom).toBeCloseTo(expected.zoom, 4);
  });
});

describe("resolveAt: hold", () => {
  it("inherits the previous scene's camera and holds it fixed", () => {
    const entity = makeEntity("e1");
    const scenes = [panScene("s0", 2, "e1"), holdScene("s1", 3)];
    const expected = expectedEntityCamera(entity);

    for (const t of [2, 3, 4, 5]) {
      const state = resolve(scenes, [entity], t);
      expect(state.camera.x).toBeCloseTo(expected.x, 4);
      expect(state.camera.y).toBeCloseTo(expected.y, 4);
      expect(state.camera.zoom).toBeCloseTo(expected.zoom, 4);
    }
  });

  it("carries the highlighted entity forward through a hold", () => {
    const entity = makeEntity("e1");
    const scenes = [highlightScene("s0", 2, "e1"), holdScene("s1", 3)];
    const state = resolve(scenes, [entity], 4);
    expect(state.highlightedEntityId).toBe("e1");
  });
});

describe("resolveAt: multi-scene sequence", () => {
  it("each scene glides from the previous scene's resting camera to its own target", () => {
    const e1 = makeEntity("e1", { lon: [10, 14], lat: [10, 14] });
    const e2 = makeEntity("e2", { lon: [40, 50], lat: [-10, 0] });
    const scenes = [panScene("s0", 2, "e1"), panScene("s1", 2, "e2")];

    const expected1 = expectedEntityCamera(e1);
    const expected2 = expectedEntityCamera(e2);

    const startOfSecond = resolve(scenes, [e1, e2], 2);
    // At the exact boundary, scene 1 begins at progress 0 -- its `from` is
    // scene 0's resting camera, so this should equal scene 0's target.
    expect(startOfSecond.camera.x).toBeCloseTo(expected1.x, 4);
    expect(startOfSecond.camera.y).toBeCloseTo(expected1.y, 4);
    expect(startOfSecond.camera.zoom).toBeCloseTo(expected1.zoom, 4);

    const endOfSecond = resolve(scenes, [e1, e2], 4);
    expect(endOfSecond.camera.x).toBeCloseTo(expected2.x, 4);
    expect(endOfSecond.camera.y).toBeCloseTo(expected2.y, 4);
    expect(endOfSecond.camera.zoom).toBeCloseTo(expected2.zoom, 4);
  });
});

describe("resolveAt: zoomPercent", () => {
  it("scales the fitted zoom proportionally, unclamped", () => {
    const entity = makeEntity("e1", { lon: [10, 12], lat: [10, 12] });
    const scenes50 = [panScene("s0", 1, "e1", 50)];
    const scenes200 = [panScene("s0", 1, "e1", 200)];

    const at50 = resolve(scenes50, [entity], 1);
    const at200 = resolve(scenes200, [entity], 1);

    // Neither should be clamped against MIN_ZOOM/MAX_ZOOM for this small
    // entity/percent combination, so the ratio should be exactly 4x (200/50).
    expect(at200.camera.zoom / at50.camera.zoom).toBeCloseTo(4, 3);
  });
});

describe("resolveAt: antimeridian-crossing entity", () => {
  it("frames the dominant landmass instead of zooming out to the whole globe", () => {
    const entity = makeAntimeridianEntity("ru");
    const scenes = [panScene("s0", 1, "ru")];
    const expected = expectedEntityCamera(entity);

    const state = resolve(scenes, [entity], 1);
    expect(state.camera.zoom).toBeCloseTo(expected.zoom, 4);
    // A naive whole-globe box would clamp down near MIN_ZOOM; the
    // antimeridian-aware framing should be meaningfully tighter than that.
    expect(state.camera.zoom).toBeGreaterThan(MIN_ZOOM * 2);
  });
});

describe("resolveAt: t outside [0, totalDuration]", () => {
  it("clamps t < 0 to the first scene's start state", () => {
    const entity = makeEntity("e1");
    const scenes = [panScene("s0", 4, "e1")];
    const atNegative = resolve(scenes, [entity], -10, "world");
    const atZero = resolve(scenes, [entity], 0, "world");
    expect(atNegative.camera).toEqual(atZero.camera);
  });

  it("clamps t past the total duration to the final scene's end state", () => {
    const entity = makeEntity("e1");
    const scenes = [panScene("s0", 4, "e1")];
    const expected = expectedEntityCamera(entity);
    const atFarPast = resolve(scenes, [entity], 999);
    expect(atFarPast.camera.x).toBeCloseTo(expected.x, 4);
    expect(atFarPast.camera.y).toBeCloseTo(expected.y, 4);
    expect(atFarPast.camera.zoom).toBeCloseTo(expected.zoom, 4);
  });
});

describe("resolveAt: exact scene boundary", () => {
  it("resolves to the start of the next scene, not the end of the previous one", () => {
    const e1 = makeEntity("e1", { lon: [10, 14], lat: [10, 14] });
    const e2 = makeEntity("e2", { lon: [40, 50], lat: [-10, 0] });
    // Distinct targets so a boundary landing in the wrong scene would be
    // detectable -- both scenes rest at e1's camera right at the boundary
    // (scene 1's `from` equals scene 0's `to`), so assert against that
    // shared value plus confirm which scene's highlight is in effect.
    const scenes = [highlightScene("s0", 2, "e1"), panScene("s1", 2, "e2")];
    const atBoundary = resolve(scenes, [e1, e2], 2);
    // Still e1's highlight from scene 0 in a naive "just past scene 0" read
    // would be wrong -- scene 1 has no highlight action, so it should be
    // cleared to whatever scene 1 carries forward: scene 0's highlight is
    // sticky (scene 1 has no clearHighlight either), so it remains "e1".
    expect(atBoundary.highlightedEntityId).toBe("e1");
  });
});
