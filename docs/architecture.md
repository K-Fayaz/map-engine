# Map Animation Engine

> A desktop application for creating professional map animations for YouTube, documentaries, education, news, military analysis and storytelling.

---

# Vision

The goal of this project is to build the easiest way to create animated map videos.

Existing tools such as Adobe After Effects, Blender or GIS software are powerful but require significant manual work and animation knowledge.

This project should allow anyone to tell a geographical story without learning animation.

Long term, the application should be capable of generating complete animated map videos directly from a script or narration using AI.

The manual editor and the AI workflow should share the same rendering engine.

---

# Problem Statement

Creating map animations today is painful.

A creator typically has to:

- Download SVG maps
- Separate countries manually
- Animate everything inside After Effects
- Create camera movement
- Animate highlights
- Draw arrows
- Animate labels
- Export manually

This process is slow, repetitive and requires animation expertise.

This project aims to remove those barriers.

---

# Product Philosophy

The software should focus on storytelling rather than animation.

The user should never have to think about keyframes.

Instead, they should simply describe or select locations while the engine automatically handles:

- Camera movement
- Zoom level
- Framing
- Smooth transitions
- Highlight animations
- Timeline generation

The software should feel more like directing a documentary than animating graphics.

---

# Goals

## V1

Build the foundation.

The objective of V1 is **NOT** to create a feature-rich application.

The objective is to build a solid rendering engine.

V1 includes:

- Desktop application (Tauri)
- PixiJS renderer
- Interactive world map
- Countries
- States / Provinces
- Major Cities
- Oceans
- Lakes
- Major Rivers
- Camera system
- Entity selection
- Timeline
- Smooth animations
- High-quality MP4 export

---

# Non Goals

V1 will NOT include:

- AI generation
- Collaboration
- Cloud rendering
- Historical maps
- Plugins
- Marketplace
- Terrain rendering
- Satellite imagery
- Roads
- Railways
- Buildings
- Military assets

Those belong to later versions.

---

# Long Term Vision

The engine should eventually support every type of geographical storytelling.

Possible map packs include:

- Political Map
- Dark Theme
- Light Theme
- Terrain
- Satellite
- Historical Maps
- Fantasy Maps
- Custom Maps

Future entities include:

- Rivers
- Oceans
- Lakes
- Roads
- Railways
- Airports
- Mountains
- Volcanoes
- Military Bases
- Capitals
- Battlefields
- Trade Routes

The renderer should never need modification to support these.

Only the data changes.

---

# Core Architecture

The project is divided into independent systems.

```
                User

                  │

        Manual Editor / AI

                  │

             Timeline

                  │

        Animation Engine

                  │

            Renderer

                  │

             GPU (PixiJS)
```

Every system should be replaceable without affecting the others.

---

# Core Principle

Everything visible on the map is an Entity.

```
Entity

├── Country
├── State
├── City
├── River
├── Ocean
├── Lake
├── Road
├── Airport
├── Mountain
└── Label
```

Every entity exposes the same interface.

```ts
interface Entity {

    id: string

    name: string

    type: EntityType

    geometry: Geometry

    boundingBox: BoundingBox

    metadata: {}

}
```

This allows the renderer and camera to operate on every object identically.

---

# Layers

Maps are built from layers.

Example:

```
Background

Ocean

Land

Countries

States

Cities

Rivers

Lakes

Labels

Effects
```

Layers can be shown, hidden or replaced independently.

---

# Map Packs

The engine never renders "the world".

It renders a Map Pack.

Examples:

```
Political

Dark

Light

Terrain

Satellite

Historical 1945

Fantasy
```

Each map pack contains:

- Layers
- Entities
- Labels
- Styles

Changing maps should never require renderer changes.

---

# Rendering Pipeline

```
Map Pack

↓

Renderer

↓

GPU

↓

Frame

↓

Video Export
```

The renderer only knows how to render geometry.

It does not know what a country, river or city is.

---

# Camera

The camera controls:

- Position
- Zoom
- Rotation

The camera always works using entity bounding boxes.

```
Entity

↓

Bounding Box

↓

Camera Focus

↓

Animation
```

No hardcoded zoom values should exist.

---

# Timeline

Everything in the application becomes a Timeline Event.

Example:

```
Focus India

↓

Highlight India

↓

Draw Arrow

↓

Focus Pakistan

↓

Highlight Pakistan
```

The renderer executes timeline events.

The timeline does not care whether the events were created manually or by AI.

---

# Animation Engine

Animations are reusable primitives.

Examples:

- Zoom
- Pan
- Fade
- Highlight
- Pulse
- Border Draw
- Arrow Draw

Events reuse these animations.

Animations should never be entity-specific.

---

# AI Vision

The AI should never generate images.

Instead, AI generates timeline instructions.

Example:

```
Focus India

Highlight India

Draw Arrow India → Pakistan

Focus Pakistan
```

The renderer executes those instructions exactly like manually created events.

---

# Data Pipeline

The renderer should never load raw GIS data.

Instead:

```
Natural Earth

GeoBoundaries

GeoNames

OpenStreetMap

↓

Map Compiler

↓

Optimized Map Pack

↓

Renderer
```

The compiler is responsible for:

- Geometry simplification
- Layer generation
- Bounding boxes
- Spatial indexing
- Search indexes
- Binary optimization

The desktop application only loads optimized map packs.

---

# Technology Stack

Desktop

- Tauri

Frontend

- React
- TypeScript

Rendering

- PixiJS

Animation

- GSAP (or custom animation system)

Export

- FFmpeg

Map Compiler

- Node.js

---

# Engineering Principles

The following principles should never be violated.

- Maps are data, not code.
- The renderer should never know about countries or rivers.
- Everything on the map is an Entity.
- The camera only works with bounding boxes.
- Every feature should be usable manually and through AI.
- New map packs should not require renderer changes.
- Animations are reusable primitives.
- Rendering must remain deterministic.
- Export should render frame-by-frame instead of recording the screen.

---

# End Goal

The long-term vision is to become the industry-standard tool for creating animated geographical stories.

Not a GIS application.

Not a navigation application.

A storytelling engine for maps.