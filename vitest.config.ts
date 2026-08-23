import { defineConfig } from "vitest/config";

// Tests import from render.ts (for the pure `project`/WORLD_WIDTH/WORLD_HEIGHT
// helpers timelineResolver.ts also uses), which pulls in pixi.js at module
// scope -- pixi.js's browser-environment detection touches `navigator` at
// import time, so a plain node environment throws. jsdom gives it a `navigator`
// to find without needing a real WebGL/canvas context (nothing here actually
// renders).
export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
