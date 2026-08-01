# Roadmap

This document describes the development roadmap for the Map Animation Engine.

Each phase has a single objective and produces a usable milestone.

The project is intentionally built from the bottom up.

The rendering engine is completed first, followed by interaction, animation, exporting and finally AI generation.

---

# Roadmap

Every phase should produce something that can be opened, tested and demonstrated.

The application should become more capable after every phase.

---

# Phase 1 — First World Map

## Goal

Render the first political world map.

This is the first visible milestone.

The application should open directly into an interactive world map.

## Features

- Create Tauri desktop application
- Integrate PixiJS
- Load first world dataset
- Render oceans
- Render land
- Render country borders
- Render country fills
- Basic map styling

## Demo

Launch application.

See the world map.

## Definition of Done

✅ Application launches

✅ World map renders

✅ Stable rendering at 60 FPS

---

# Phase 2 — Camera Navigation

## Goal

Allow users to explore the map.

## Features

- Mouse Drag Pan
- Mouse Wheel Zoom
- Zoom Limits
- Camera Bounds
- Smooth Camera Movement

## Demo

User can freely navigate around the world.

Zoom into Europe.

Pan to Asia.

Zoom back out.

## Definition of Done

✅ Smooth navigation

✅ Stable camera

---

# Phase 3 — Geographic Details

## Goal

Increase map detail.

## Features

- States / Provinces
- Major Cities
- Rivers
- Lakes
- Labels

## Demo

Zoom into India.

States appear.

Cities appear.

Major rivers become visible.

## Definition of Done

✅ Geographic hierarchy works

---

# Phase 4 — Interaction

## Goal

Everything becomes selectable.

## Features

- Hover Detection
- Country Selection
- State Selection
- City Selection
- Search
- Selection Overlay

## Demo

Click India.

India becomes selected.

Click Karnataka.

Karnataka becomes selected.

Click Bengaluru.

Bengaluru becomes selected.

## Definition of Done

✅ Every entity selectable

---

# Phase 5 — Smart Camera

## Goal

Automatically frame entities.

## Features

- Focus Country
- Focus State
- Focus City
- Fit Bounding Box
- Smooth Camera Animation

## Demo

Search India.

Camera flies to India.

Search Karnataka.

Camera frames Karnataka.

Search Bengaluru.

Camera frames Bengaluru.

## Definition of Done

✅ Camera always frames correctly

---

# Phase 6 — Timeline

## Goal

Build stories instead of clicks.

## Features

- Timeline
- Event Cards
- Reordering
- Delete Events
- Playback

## Demo

Click

India

↓

Pakistan

↓

China

Timeline automatically grows.

Press Play.

Camera replays the journey.

## Definition of Done

✅ Timeline is fully functional

---

# Phase 7 — Animation

## Goal

Bring the map to life.

## Features

- Highlight
- Border Draw
- Arrow Draw
- Fade
- Pulse
- Label Animation

## Demo

Play the timeline.

Countries highlight.

Camera moves.

Arrows animate.

Labels appear.

## Definition of Done

✅ Smooth cinematic animation

---

# Phase 8 — Video Export

## Goal

Generate production-ready videos.

## Features

- Frame Rendering
- FFmpeg Integration
- MP4 Export
- 1080p
- 4K
- Vertical Export

## Demo

Create timeline.

Export.

Watch MP4.

## Definition of Done

✅ High quality export

---

# Phase 9 — Better Editor

## Goal

Improve usability.

## Features

- Toolbar
- Undo
- Redo
- Keyboard Shortcuts
- Inspector
- Floating Actions

## Demo

Editing feels fast and intuitive.

## Definition of Done

✅ Comfortable editing workflow

---

# Phase 10 — Multiple Maps

## Goal

Support multiple map styles.

## Features

- Political
- Dark
- Light
- Terrain
- Historical

## Demo

Switch map style without restarting.

## Definition of Done

✅ Renderer works with any compatible map pack

---

# Phase 11 — AI Story Generation

## Goal

Generate complete animations from narration.

## Features

- Audio Upload
- Speech-to-Text
- Entity Extraction
- Timeline Generation
- Camera Planning

## Demo

Upload narration.

Receive complete editable animation.

## Definition of Done

✅ AI produces usable timelines

---