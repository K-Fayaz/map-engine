# Plan: Phase 6 — Story Scenes & Instruction-Based Timeline

Tracks roadmap.md's Phase 6 (Story Scenes & Instruction-Based Timeline).
Companion to `docs/phase_6_arch.md`, which documents the V1 UX principle
("keep the map clean") this plan builds on. Update this file as baby-phases
are scoped and as work lands, same convention as `plan-water-bodies.md`.

---

## Decisions (locked, discussed with user before any code)

1. **Map stays output-only; entity selection happens in the input area, not
   on the map.** Per `docs/phase_6_arch.md`. The Instruction Builder is a
   fill-in-the-blank form — `<Entity> <Animation> <Duration>` — not a map
   click. The existing map click/hover-to-select interaction (Phase 4) is
   left as-is/unaffected; the form is simply the *only* path that feeds the
   Instruction Builder / timeline, so the map never needs to be clicked to
   build a story.
2. **Live preview, one-way (form → map).** Picking an entity in the form
   still drives `interactionStore`'s existing `requestFocus`/highlight
   plumbing (built in Phase 5), so the user gets visual confirmation
   they've picked the right entity — the map just isn't the *input*
   mechanism anymore.
3. **"Add to Timeline" appends immediately.** No separate "compose
   everything, then preview" step — a scene shows up in the timeline the
   moment it's added, matching the incremental build/verify philosophy
   below.
4. **Play/Pause (and scrub) must exist early, not be deferred to a late
   baby-phase.** Even a rough/unpolished sequential playback should be
   available as soon as two or more scenes exist, since stepping through
   what's already built is core to testing incrementally rather than
   building the whole timeline UI first and wiring playback at the end.
5. **Build order must be incremental and demoable in the running UI at every
   step** — explicit user preference: fix bugs as they're found on a small
   slice, not build everything then debug it all at once. This is the main
   axis the baby-phase breakdown (below) is organized around.
6. **Scene/action data model must stay extensible**, per
   `docs/phase_6_arch.md`'s V2 note (border draw, arrows, markers, image
   overlays, paths, composable multi-action scenes):
   - `Scene.actions` is an array of `{ type, params }` from day one — even
     though V1 only ever populates it with 1-2 actions (Focus, Highlight,
     Focus + Highlight, per roadmap.md Phase 6 section 4). Never collapse
     this to a single flat action field as a V1 shortcut.
   - The playback engine dispatches on `action.type` through a
     registry/lookup table of handlers, not an if/else chain special-casing
     "Focus + Highlight." Adding a new action type later should mean
     registering a new handler, not touching the dispatcher's control flow.
   - V1 explicitly does **not** build: dynamic form-schema generation, a
     plugin system, or stub future action types (Border Draw / Arrow /
     Marker / Path / Fade / Pulse). Only the `Scene`/action *shape* and the
     dispatcher need to be generic — the Instruction Builder form itself can
     hardcode UI for its 3 V1 options. Don't over-solve ahead of real
     use cases, per `docs/phase_6_arch.md`.
7. **New state (scenes/timeline) introduces a real state library** (e.g.
   zustand) rather than extending the existing hand-rolled pub/sub pattern
   `interactionStore.ts` uses. `interactionStore` itself is **not**
   migrated — stays on its current pattern, so this doesn't risk
   regressing working Phase 1-5 code. Smaller blast radius, one new
   dependency scoped to the new feature only.

## Open / not yet decided

- Exact baby-phase boundaries and their individual "definition of done" —
  next planning pass, to be logged below once agreed.
- Specific state library choice (zustand assumed in discussion, not yet
  confirmed/installed).
- Exact TypeScript shape of the action registry (handler signature, how a
  handler gets access to camera/interactionStore/highlight APIs).
- `transitionDuration` vs `holdDuration` split (roadmap.md section 16) —
  explicitly deferred, internal-only if/when it lands, not exposed in V1 UI.
- Whether text-based instructions (roadmap.md section 5, step 9) land inside
  Phase 6 or slip to a later phase — lowest priority of the roadmap's own
  step list, revisit once the form + timeline + playback baby-phases are
  solid.

---

## Baby phases

Grouped so each one is independently demoable in the running app, not just
inspectable in devtools — per decision #5 above. 6.1 → 6.2 → 6.3 together
satisfy roadmap.md Phase 6's Definition of Done (section 19) and Success
Criteria (section 20) in full; 6.4 is additive on top, not required for
either.

Maps onto roadmap.md section 18's own step list as: 6.1 = steps 1, 2 + a
first cut of 6, 7; 6.2 = steps 3, 4, 5; 6.3 = step 8; 6.4 = step 9.

### 6.1 — Instruction Builder, Scene model, basic Play/Pause

Three sub-steps, each demoable on its own before the next is built —
deliberately not built as one combined slice, so a bug in (say) the form
doesn't get tangled up with a bug in playback.

- [ ] **6.1.a — Instruction Builder form + live map preview.** Right-panel
  form: entity dropdown (reuses `interactionStore.search`'s existing
  substring match, no new search logic — just a new place to render it),
  animation dropdown hardcoded to the 5 V1 actions (Focus, Focus World,
  Highlight, Clear Highlight, Focus + Highlight — roadmap.md section 4),
  duration input. Picking an entity fires the existing
  `requestFocus`/`toggleEntity` calls (Phase 5) so the map flies/highlights
  live. No "Add to Timeline" wiring yet, no store yet — this step only
  validates "map stays clean, form drives map" (docs/phase_6_arch.md) in
  isolation.
  *Demo:* pick "India" from the dropdown; map flies to it and highlights it,
  without touching the canvas.
- [ ] **6.1.b — Scene model + sceneStore + minimal scene list.** `Scene`/
  `SceneAction` types (`actions: {type, params}[]`, per decision #6 above —
  array from day one even though only 1-2 actions ever populate it in V1).
  New state-library-backed `sceneStore` (decision #7 — new dependency,
  `interactionStore` untouched). "Add to Timeline" pushes a scene built from
  the form's current state. Rendered as a plain unstyled list for now — no
  drag, no resize, no visual timeline blocks (that's 6.2).
  *Demo:* add India, Pakistan, China via the form; three rows appear in
  order with correct entity/action/duration.
- [ ] **6.1.c — Basic sequential Play/Pause.** Small action-registry
  dispatcher (decision #6 — lookup table keyed by `action.type`, not an
  if/else chain) with handlers for the 5 V1 actions. Play/Pause buttons walk
  `scenes` in order, executing each one's actions and holding for its
  `duration` before advancing. No transition/hold split yet (roadmap.md
  section 16 explicitly defers this) — existing camera easing already makes
  the transition itself smooth; this just sequences whole-scene holds on
  top of it.
  *Demo:* build the India → Pakistan → China list from 6.1.b, hit Play,
  watch the map cycle through all three unattended; Pause freezes it
  mid-sequence.

### 6.2 — Visual Timeline (roadmap.md steps 3, 4, 5)

- [ ] Render scene blocks left-to-right by cumulative duration along a track
  (roadmap.md section 8's mockup), replacing 6.1.b's plain list
- [ ] Drag the right edge of a block to resize its duration
- [ ] Delete a scene
- [ ] Reorder scenes (drag-and-drop, or up/down buttons for a first pass)

Purely visual/interaction polish on data that's already correct after 6.1 —
no new engine/playback logic, playback (6.1.c) keeps working underneath
unchanged.

*Demo:* build a 3-scene story, drag China's block wider (3s → 5s), delete
Pakistan, drag India after China to reorder, hit Play — sequence reflects
the edits.

### 6.3 — Scene Selection / Scrub sync (roadmap.md step 8, section 13)

- [ ] Extract "jump to scene N's camera+highlight state" out of 6.1.c's
  sequential player into a standalone callable (not just play-from-start)
- [ ] Clicking a scene block jumps the map straight to that scene's state
- [ ] Scrubbing a playhead across the timeline does the same continuously

*Demo:* with playback paused, click the China block directly — map jumps
straight to China's focused+highlighted state, no transition through
India/Pakistan first.

### 6.4 — Text instruction layer (roadmap.md step 9, section 5) — optional/stretch

Lowest priority — 6.1-6.3 alone already satisfy Phase 6's Definition of
Done and Success Criteria; this is additive, not required, and can slip out
of Phase 6 entirely if not wanted.

Two scope tiers, discussed but not yet chosen between:
- **Roadmap-literal (smaller):** fixed vocabulary, no embedded duration —
  e.g. `focus and highlight India`, duration stays a separate form field
  regardless of whether text or dropdowns picked the entity/action.
- **Free-form (bigger, later stretch on top of the above):** natural
  phrasing with embedded duration extraction — e.g. `"zoom to India and
  stay for 3 seconds"`. Needs synonym handling and a small rule-based
  duration parser, real (if small) added scope vs. the roadmap-literal
  version. No LLM either way (roadmap.md section 3: "do not depend on an
  LLM for this phase").
