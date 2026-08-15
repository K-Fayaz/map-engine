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

# Phase 6 — Story Scenes & Instruction-Based Timeline

## Objective

Build the first real storytelling workflow of the application.

The user should not manually create keyframes, camera coordinates, zoom values, or animation curves.

Instead, the user should:

1. Select a geographic entity.
2. Choose what should happen to it.
3. Set a duration.
4. Add the instruction to the timeline.
5. Repeat for other entities.
6. Play the resulting story.

The core workflow is:

Map
  ↓
Select Entity
  ↓
Instruction Builder
  ↓
Scene
  ↓
Timeline
  ↓
Playback


---

## 1. Editor Layout

The editor should have three primary areas:

┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                          MAP                                │
│                                                             │
│                                                             │
├──────────────────────────────────────────────┬──────────────┤
│                                              │              │
│                 TIMELINE                     │ INSTRUCTION  │
│                                              │   BUILDER    │
│                                              │              │
└──────────────────────────────────────────────┴──────────────┘

### Map

The map remains the primary workspace.

Users can:

- Search for an entity.
- Click an entity.
- Select an entity.
- See its selected/highlighted state.
- Preview the resulting animation.

### Instruction Builder

The right panel allows the user to define what should happen to the selected entity.

### Timeline

The bottom panel contains the resulting sequence of scenes.


---

## 2. Core User Workflow

Example:

User searches "India"
        ↓
India is selected
        ↓
Instruction Builder appears
        ↓
User chooses "Focus + Highlight"
        ↓
User chooses duration
        ↓
Add to Timeline

Timeline:

┌──────────────────────────────┐
│ 🇮🇳 India                    │
│ Focus + Highlight            │
│ 3 seconds                    │
└──────────────────────────────┘

The user can then repeat the process for Pakistan, China, Russia, etc.


---

## 3. Instruction Builder

When an entity is selected, the right panel should show its available actions.

Example:

┌─────────────────────────────────┐
│ India                           │
│                                 │
│ Animation                       │
│ [ Focus + Highlight ▼ ]         │
│                                 │
│ Duration                        │
│ [ 3.0 sec ]                     │
│                                 │
│        [ Add to Timeline ]       │
└─────────────────────────────────┘

The first version should be deterministic and controlled.

Do not depend on an LLM for this phase.


---

## 4. Initial Animation Actions

The first animation vocabulary should be intentionally small.

### Camera

- Focus
- Focus World

### Entity

- Highlight
- Clear Highlight

### Combined

- Focus + Highlight

Future actions can include:

- Border Draw
- Arrow
- Path
- Label
- Fade In
- Fade Out
- Pulse

Do not implement these until the basic scene/timeline workflow is working.


---

## 5. Text-Based Instructions

The application should eventually support simple natural-language instructions.

Examples:

highlight India

focus India

focus and highlight India

The text should be converted into a structured instruction.

Example:

{
  target: "india",

  actions: [
    {
      type: "focus"
    },
    {
      type: "highlight"
    }
  ],

  duration: 3
}

The text input is only an input method.

The renderer and animation engine must never depend directly on raw user text.


---

## 6. Structured Instructions First

For V1, the UI should preferably use controlled options.

Example:

Entity:
India

Animation:
[ Focus + Highlight ]

Duration:
[ 3 seconds ]

[ Add to Timeline ]

This gives deterministic behaviour.

Natural-language input can later sit on top of the same underlying instruction model.


---

## 7. Scenes

Every submitted instruction creates a Scene.

A scene represents one geographic moment in the story.

Example:

Scene 1

Target:
India

Actions:
Focus + Highlight

Duration:
3 seconds

Next:

Scene 2

Target:
Pakistan

Actions:
Focus + Highlight

Duration:
3 seconds

Next:

Scene 3

Target:
China

Actions:
Focus + Highlight

Duration:
3 seconds

The timeline is therefore a sequence of scenes.


---

## 8. Timeline UX

The timeline should initially be simple.

It should display scene blocks rather than raw keyframes.

Example:

0s                 3s                 6s                 9s
│──────────────────│──────────────────│──────────────────│

┌──────────────────┐
│ 🇮🇳 India        │
│ Focus + Highlight│
└──────────────────┘

                   ┌──────────────────┐
                   │ 🇵🇰 Pakistan     │
                   │ Focus + Highlight│
                   └──────────────────┘

                                      ┌──────────────────┐
                                      │ 🇨🇳 China        │
                                      │ Focus + Highlight│
                                      └──────────────────┘

The user should understand this as:

"These are the scenes in my video."

Not:

"These are camera keyframes."


---

## 9. Timeline Controls

Keep timeline controls deliberately limited.

### Required

- Play
- Pause
- Scrub
- Select scene
- Delete scene
- Reorder scene
- Change scene duration

### Duration

The user should be able to drag the edge of a scene to increase or decrease its duration.

Example:

3 seconds

can become:

5 seconds

by dragging the scene boundary.

### Do NOT implement yet

- Manual keyframes
- Camera X/Y editing
- Raw zoom values
- Animation curves
- Multiple animation tracks
- Complex easing editors
- Manual camera animation

The engine should handle these details automatically.


---

## 10. Camera + Timeline Architecture

The timeline should not directly manipulate camera coordinates.

A scene describes the intended camera action.

Example:

{
  camera: {
    type: "focus",
    targetEntityId: "india"
  }
}

The Camera Controller determines the actual camera state.

Timeline
   ↓
"Focus India"
   ↓
Camera Controller
   ↓
Find India's bounds
   ↓
Calculate target position
   ↓
Calculate target zoom
   ↓
Animate current camera → target camera

The timeline defines:

"Where the story goes."

The camera determines:

"How the camera gets there."


---

## 11. Zoom In and Zoom Out

Do not expose separate low-level controls such as:

- Zoom In
- Zoom Out
- Pan Left
- Pan Right

initially.

Instead, use entity-focused camera states.

Example:

World
  ↓
Focus India

automatically produces the required zoom-in.

And:

India
  ↓
Focus World

automatically produces the zoom-out.

Likewise:

India
  ↓
Focus Pakistan

can automatically produce the required combination of:

- Zoom Out
- Pan
- Zoom In

The user only needs to say:

Focus Pakistan

The camera system determines the appropriate transition.


---

## 12. Camera State

The camera should maintain:

{
  x: number,
  y: number,
  zoom: number
}

It should have a current state and a target state.

Conceptually:

Current Camera
      ↓
Target Camera
      ↓
Smooth Interpolation
      ↓
PixiJS Renderer

The camera should already support:

camera.focus(entity)

camera.fitBounds(bounds)

camera.reset()

Phase 6 builds the timeline on top of this existing camera system.


---

## 13. Scene Selection

Selecting a scene on the timeline should update the map to represent that scene.

Example:

Click "India" scene
        ↓
Map moves to India's camera state
        ↓
India becomes highlighted

This keeps the map and timeline synchronized.


---

## 14. Scene Data Model

Scenes should describe intent, not PixiJS implementation details.

Example:

interface Scene {
  id: string;

  duration: number;

  targetEntityId?: string;

  actions: SceneAction[];

  camera?: CameraAction;
}

Example scene:

{
  id: "scene-001",

  duration: 3,

  targetEntityId: "india",

  actions: [
    {
      type: "highlight",
      entityId: "india"
    }
  ],

  camera: {
    type: "focus",
    targetEntityId: "india"
  }
}

The exact data model can evolve, but the principle should remain:

Store what the user wants to happen, not raw renderer state.


---

## 15. Playback

When the user presses Play, scenes execute sequentially.

Example:

World
  ↓
Focus India
  ↓
Hold
  ↓
Focus Pakistan
  ↓
Hold
  ↓
Focus China
  ↓
Hold

The camera automatically interpolates between scene states.

The user should not need to manually create:

Zoom Keyframe
Pan Keyframe
Zoom Keyframe

for each transition.


---

## 16. Scene Duration vs Transition

For the first implementation, the user can control only the overall scene duration.

Internally, the engine should leave room to separate:

transitionDuration
holdDuration

For example:

India

1 second → camera transition
3 seconds → hold

This does not need to be exposed in the first version.

Later, the UI can provide more control if required.


---

## 17. Manual and Future AI Workflow

The manual workflow:

User
  ↓
Instruction Builder
  ↓
Scene
  ↓
Timeline

The future AI workflow:

Audio / Script
  ↓
Transcript
  ↓
AI
  ↓
Scene
  ↓
Timeline

Both must converge on the same scene format.

The AI should never directly control PixiJS.

It should generate valid scene instructions.

This allows the future automatic workflow to reuse the exact same animation system built in this phase.


---

## 18. Phase 6 Implementation Order

Build Phase 6 in this order:

### Step 1 — Scene Data Structure

Create a basic scene model.

Scene
 ├── target entity
 ├── actions
 ├── camera action
 └── duration

### Step 2 — Create Scene From Selected Entity

Select an entity → choose an action → create a scene.

### Step 3 — Timeline Rendering

Display scenes as blocks in chronological order.

### Step 4 — Scene Duration Editing

Allow the user to resize a scene.

### Step 5 — Scene Deletion and Reordering

Allow basic timeline editing.

### Step 6 — Scene Playback

Execute scenes sequentially.

### Step 7 — Camera Integration

Connect scene camera actions to the existing camera controller.

### Step 8 — Scene Selection

Clicking a scene should reproduce that scene on the map.

### Step 9 — Text Instruction Layer

Allow simple text instructions to generate the same structured scene.


---

## 19. Definition of Done

Phase 6 is complete when this workflow works:

Search India
      ↓
Select India
      ↓
Choose Focus + Highlight
      ↓
Set duration
      ↓
Add to Timeline
      ↓
Search Pakistan
      ↓
Choose Focus + Highlight
      ↓
Add to Timeline
      ↓
Search China
      ↓
Choose Focus + Highlight
      ↓
Add to Timeline
      ↓
Play

The resulting animation should be:

World
  ↓
Smooth camera transition
  ↓
India highlighted
  ↓
Hold
  ↓
Smooth camera transition
  ↓
Pakistan highlighted
  ↓
Hold
  ↓
Smooth camera transition
  ↓
China highlighted

The user must be able to:

- Create scenes without touching keyframes
- Rearrange scenes
- Change scene duration
- Delete scenes
- Preview the sequence
- Scrub through the timeline
- Select a scene and see its state on the map


---

## 20. Phase 6 Success Criteria

A non-technical user should be able to understand the workflow without knowing animation software.

The experience should essentially be:

Select a place
      ↓
Tell the application what to do
      ↓
Add it to the story
      ↓
Repeat
      ↓
Play

At the end of Phase 6, the application should feel like a map storytelling tool, not a GIS viewer and not a traditional animation editor.

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