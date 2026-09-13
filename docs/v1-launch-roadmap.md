# V1 Launch Roadmap

## Goal

Ship the first paid version of the map-animation product.

The goal is **not** to build the complete map-animation platform. V1 should be good enough for a creator to make a useful map video, export it, and use the product repeatedly.

---

# Phase 1 — Core Product Freeze

Finish and stabilize the core map-animation workflow before adding new features.

### Map & Visuals
- World map with Mercator projection
- Entity selection/search
- Pan / camera movement
- Zoom
- Highlight entities
- Clear highlight
- Custom highlight colors
- Flag SVG overlays
- Custom image overlays clipped to geographic entities
- Map colors/styling

### Animation & Scenes
- Scene creation
- Scene ordering
- Timeline
- Animation duration
- Hold state
- Playback
- Basic scene editing/removal

### Audio & Export
- Audio track
- Audio-aware editing/playback
- MP4 export
- Audio + video export
- Reliable deterministic export
- Fix export freezes/hangs
- Ensure exported output matches preview

### V1 Animation Vocabulary

Keep the initial animation library intentionally small.

Core actions can include:
- Pan
- Highlight
- Clear Highlight
- Pan + Highlight
- Hold
- Zoom where required

Do not add large numbers of speculative effects before launch.

### Phase 1 Completion Rule

The core product is complete when a user can create a complete short map video from start to finish and reliably export it without developer intervention.

After this phase, **freeze the core feature scope**.

---

# Phase 2 — Desktop App / Project Management

Turn the working editor into a usable desktop product.

### Projects

Users should be able to:
- Create a new project
- Open an existing project
- Save a project
- Rename a project
- Delete a project
- See recent projects
- Continue working on a previous project
- each project can have its own individual files and on open project we import these files as well.

A project should preserve the information required to reopen and continue editing the map animation.

Keep this lightweight. V1 does not need collaboration, cloud workspaces, folders, or complex project management.

---

# Phase 3 — Desktop App Distribution & Updates

Make the desktop application feel like a real product.

### Installation
- Production installer
- Proper application metadata
- Versioning
- Production build configuration

### Auto Update
Implement:
- Automatic update checking
- Download/update flow
- Update notifications where appropriate
- Safe installation of new versions
- Basic update error handling

The goal is that users should not need to manually download a new installer every time the application is updated.

---

# Phase 4 — SaaS Foundation

Introduce the account and subscription layer.

### User Management
Implement:
- Sign up
- Login
- Logout
- Account/session management
- Password recovery if applicable
- User identity/profile
- Basic account state

The desktop application should be able to determine whether the current user has access to paid functionality.

### Subscription Management

Launch with a simple pricing model:

**One paid tier: $4.99/month**

Potential founding pricing:
- First 50 users → $4.99/month
- Founding users retain their price while continuously subscribed
- Increase pricing for later users as the product matures

Do not build multiple pricing tiers unless there is a real reason to do so.

### Payments

Implement:
- Checkout
- Subscription creation
- Subscription status
- Renewal handling
- Cancellation
- Payment failure handling
- Customer billing management
- Webhook/event handling
- Server-side entitlement verification

The desktop app should never be the sole authority for whether a user has paid access.

---

# Phase 5 — Landing Page & Launch Surface

Create the public-facing product website.

### Landing Page

The landing page should clearly communicate:

> Create professional map animations for videos without needing After Effects.

Include:
- Product explanation
- Real examples of exported map animations
- Short demo/video
- Core features
- Who the product is for
- Pricing
- $4.99/month launch offer
- Download / Get Started CTA
- FAQ

The examples should focus on what users can actually create rather than listing technical features.

### Pricing

Keep it extremely simple:

**$4.99/month**

No complicated tier comparison at launch.

If using the founding-user model, clearly explain the limited first-50-user pricing.

---

# Phase 6 — Onboarding & Launch Readiness

Before public launch, test the entire journey as a new user.

### New User Flow

Verify:
1. User discovers landing page
2. User understands the product
3. User downloads the desktop app
4. User installs it
5. User creates an account
6. User creates a project
7. User creates a map animation
8. User previews it
9. User exports it
10. User subscribes when required
11. User can reopen the project later
12. User receives future application updates

### Launch Checklist

- Production build works
- Installer works
- Auto-update works
- Project persistence works
- Authentication works
- Subscription works
- Entitlements work
- Export works reliably
- Landing page works
- Pricing works
- Basic error handling exists
- First-time user can understand the workflow without developer help

---

# Phase 7 — V1 Launch

Launch to a small initial group rather than immediately trying to maximize scale.

### Initial Target

Start with creators who regularly make:
- Geography videos
- History videos
- Geopolitics videos
- Economics/resource videos
- Travel videos
- Other map-heavy YouTube content

### Main Validation Question

Do not primarily measure downloads.

Measure:

> **Can creators make useful map animations significantly faster than their current workflow, and are they willing to pay for it?**

The first users should help identify:
- Most-used animation types
- Missing essential features
- Export problems
- UX friction
- Project workflow problems
- Willingness to pay
- Features that belong in V2

---

# V2 — Map Animation / Effects Library

Only begin significant V2 feature expansion after V1 has reached real users.

The long-term product should support a reusable library of map-specific actions/effects.

Potential examples:

### Camera
- Pan to X
- Zoom in
- Zoom out
- Fly to X
- Camera transitions

### Geographic Entities
- Highlight
- Border/perimeter
- Blink
- Fill/color change
- Fade
- Image/flag overlay

### Paths & Objects
- Draw route
- Animate object along route
- Markers
- Arrows
- Labels

### Advanced Overlays
- Images
- SVGs
- Textures
- Video overlays

### Map Environment
- Different map styles
- Ocean styling
- Animated/video ocean backgrounds
- Additional visual effects

These should be composable rather than creating a separate special-case system for every possible combination.

---

# Product Principles

## 1. Keep the map clean

The map is primarily the visual canvas.

Animation creation and configuration should happen through the input/control UI rather than turning the map into a CapCut/After Effects-style editing surface.

## 2. Keep V1 simple

Do not attempt to support every possible map animation before launch.

Build the smallest set of capabilities that can produce genuinely useful map videos.

## 3. Keep the underlying system extensible

The V1 UI can be limited, but the animation/scene architecture should allow new action types to be added without rewriting the editor.

## 4. Hold is a real state

An animation duration describes the transition/action.

A `Hold` scene means:

> Keep the resulting map state unchanged for the specified duration.

Example:

`Pan to Africa → 2s → Hold → 3s → Next scene`

## 5. Do not build a universal editor

The product should not become a complicated general-purpose animation editor.

The objective is a specialized **map-animation machine**.

## 6. Validate before expanding

Real user behavior should determine V2 priorities.

If users repeatedly try to create something V1 cannot express, that is evidence for expanding the animation library.

---

# Final V1 Boundary

The launch is **not blocked by having every possible animation**.

V1 is ready when:

> A real creator can download the application, create and save a map-animation project, build a useful sequence, add audio, preview it, reliably export an MP4, and pay $4.99/month to use the full product.

Everything beyond that should be evaluated as a V2+ feature unless it is necessary to make this workflow work reliably.
