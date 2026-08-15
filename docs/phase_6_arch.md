# V1 UX Principle — Keep the Map Clean

## Core Decision

For V1, the **map is primarily a visual canvas/output**, not the place where users create or configure animations.

All animation-related interaction should happen through the **input/control area**.

Example:

`[Choose Entity] [Choose Animation] [Duration] [Parameters]`

The user should not need to click directly on the map to select an entity and configure its animation.

## Why

Map animation can have a very large number of possible use cases. Trying to make the map itself an interactive editor for every possible operation will quickly make the UI complicated and difficult to understand.

Keeping editing outside the map gives us:

- A clean, distraction-free map.
- A predictable editing workflow.
- A simpler V1 implementation.
- Freedom to add new animation types without turning the map into a complex editor.

## V1 Approach

Start with a small set of common animation actions, for example:

- Highlight entity
- Fade in / out
- Zoom to entity
- Pan / move camera
- Show / hide label
- Add marker
- Draw route/path

The UI does **not** need to support every possible map animation initially.

## Important Architectural Constraint

The V1 UI can be limited, but the underlying animation system should remain extensible.

Adding a new animation type later should ideally mean:

`Add new animation/action type`

rather than:

`Redesign the entire editor`

The animation input should conceptually represent something like:

`Entity → Animation → Parameters → Duration`

This allows more complex animation types to be introduced later without breaking the basic UX.

## Do Not Over-Solve This

Do not design a universal UI for every possible map animation before real users tell us what they need.

Build the simple V1 workflow first.

If users repeatedly try to create something that the current input model cannot express, **that real use case should drive the next UX/architecture decision**.

## Rule to Remember

**Keep the V1 UI simple. Keep the underlying animation system extensible.**

**Map = visual canvas**  
**Input area = editing/control**  
**Animation system = extensible**

## V2+ — Map Animation / Effects Library

The system should eventually support a reusable library of map-specific actions/effects, such as:

- Pan / zoom / fly-to
- Polygon border/perimeter
- Polygon blink/highlight/color changes
- Image or flag overlays on polygons
- Markers, labels, arrows, and routes
- Map/ocean styling and animated/video backgrounds
- Other common visual effects used in map-based videos

These should be composable so users can combine multiple actions into a scene/sequence.

The V1 architecture should allow this library to grow without requiring a fundamental rewrite of the editor or animation engine.