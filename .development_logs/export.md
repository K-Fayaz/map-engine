# Video Export Architecture — Independent Deterministic Export

## Goal

Replace the current export implementation where the visible map canvas plays the animation and is recorded.

Export must be completely independent of live canvas playback.

When the user clicks Export:

- The visible canvas must NOT start playing.
- The user's current canvas state must NOT matter.
- Export must NOT depend on `requestAnimationFrame`.
- Export must NOT depend on real-time playback.
- Export must render every video frame deterministically from the scenes/timeline.
- A slow machine should make export slower, but must never create dropped or frozen frames.
- The exported video should be generated from the story definition, not from what is visibly happening on the screen.

---

# 1. Current Architecture

The current implementation effectively does:

    Export clicked
        ↓
    Start animation playback
        ↓
    Canvas visibly plays
        ↓
    Capture frames
        ↓
    Encode video

This is the wrong architecture for a reliable export system.

It couples video generation to:

- real-time playback
- `requestAnimationFrame`
- WebKitGTK scheduling
- browser throttling
- window focus
- rendering speed
- encoder speed
- visible UI state

If rendering stalls for 500ms, export can effectively contain a frozen section.

If the window is throttled or loses focus, export can be affected.

If the encoder cannot keep up with real-time rendering, frames can be lost.

Export should not have any of these dependencies.

---

# 2. Correct Architecture

The scenes/timeline should be the single source of truth.

    ┌─────────────────────┐
    │   Scenes / Timeline │
    └──────────┬──────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
    ┌────────────┐   ┌────────────────┐
    │ Live Player│   │ Export Engine  │
    └─────┬──────┘   └───────┬────────┘
          │                  │
    real-time playback    explicit time
          │                  │
          ▼                  ▼
    ┌────────────┐   ┌────────────────┐
    │ Pixi Canvas│   │ Pixi Renderer  │
    └────────────┘   └───────┬────────┘
                              │
                              ▼
                         RGBA pixels
                              │
                              ▼
                            FFmpeg
                              │
                              ▼
                             MP4

Live preview and export share the same timeline/state calculation, but they must be separate rendering flows.

---

# 3. Core Principle

Export should answer:

"What should the map look like at timestamp `t`?"

It should NOT answer:

"What is currently happening on the screen?"

The exporter controls time explicitly.

For a 30 FPS video:

    Frame 0  → t = 0.000s
    Frame 1  → t = 0.033s
    Frame 2  → t = 0.067s
    Frame 3  → t = 0.100s
    ...
    Frame N  → t = N / 30

For every frame:

    timestamp
        ↓
    timeline.resolveAt(timestamp)
        ↓
    camera / highlights / visual state
        ↓
    render Pixi state
        ↓
    extract RGBA pixels
        ↓
    send to FFmpeg
        ↓
    MP4

There is NO real-time playback involved.

---

# 4. Timeline Resolver

The existing `timelineResolver.ts` should remain the source of truth.

It should expose something similar to:

```ts
resolveAt(time: number): {
  camera: CameraState;
  highlightedEntityId?: string;
  // other visual state
}