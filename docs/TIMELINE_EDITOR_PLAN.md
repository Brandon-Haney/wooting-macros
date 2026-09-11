# Timeline macro editor

Plan for a Wootility-style macro editor: a per-key timeline of the sequence, live recording into that timeline, and a simulation panel that plays the macro virtually. Status: **proposal, under discussion** (2026-09-10). Decisions taken during the discussion go into the table at the end and into [ROADMAP.md](ROADMAP.md).

## What the reference does

The reference (Wootility's macro editor) has five parts, mapped here to what we have:

| Part | Reference | Wootomation today |
| --- | --- | --- |
| Views | `List` / `Timeline` toggle over the same macro | List only (sortable cards) |
| Timeline | One row per key, a bar per press (start = down, width = held time), ruler in ms, a purple marker at the trigger press and a yellow marker at the end of one iteration, a `While Held` bracket between them | Nothing; timings only visible as Delay cards and press-duration fields |
| Record | One button; keys pressed while the window is focused become bars in place, overlaps preserved | Record button; keydown/keyup collapsed into DownUp cards with Delay cards in between (overlaps become Down / Delay / Up cards) |
| Simulation | `Start` (press the trigger), `Release`, state badge, loop counter, the keys currently held, the history of everything the macro sent | Nothing; the only way to test is to run it for real, which types into whatever has focus |
| Bindings | Searchable, grouped palette (Basic characters, Extended, Functions, Profiles, Media) | Searchable palette with Keyboard / Mouse / System groups; keycap look already done |
| Playback settings | Gauge button opening the playback options | Gear button opening Macro Settings > Behaviour (type, hold threshold, tap mode, repeat count) |

`Profiles` is a Wootility feature (switch keyboard profile) and stays out of scope, see the README.

## Design

### 1. One model, two views

The stored macro stays exactly what it is: a linear `sequence` of `KeyPressEventAction` (Down / Up / DownUp with `press_duration`), `DelayEventAction`, `MouseEventAction` and `SystemEventAction`. The timeline is a **derived view**, computed by a pure *compiler* in the frontend, and edits on the timeline go back through a *decompiler* into a fresh sequence.

Why not a new time-based storage format:

- The backend, the executor, import/export, the tray, the list view and every existing macro keep working untouched.
- The linear format can already express everything the timeline needs: overlapping keys are `Down` / `Delay` / `Up`. Nothing is lost in either direction.
- The list view stays the exact record of what the executor does, which matters when a timing looks wrong.

The cost: a sequence edited on the timeline with overlapping keys shows as Down / Delay / Up cards in the list view. That is inherent and acceptable; the decompiler keeps the list as tidy as the timing allows.

**Compiler** (`sequence → schedule`), mirroring `Macro::execute` exactly:

```
cursor = 0
KeyPress Down      : open bar (key, cursor)
KeyPress Up        : close the open bar for that key at cursor (no open bar: zero-width "release" marker)
KeyPress DownUp    : bar [cursor, cursor + press_duration]; cursor += press_duration
Mouse   Down/Up    : as keys, on a mouse-button track
Mouse   DownUp     : bar [cursor, cursor + duration]  (see decision 3 about whether the cursor advances)
Delay              : cursor += delay
System event       : instant marker at cursor on the Events track (Type Text shows an estimated width, 3 ms per character)
end                : total = cursor; bars still open extend to total with an open end ("held after the macro")
```

The schedule is `{ tracks: [{ id, kind: key|mouse|events, label }], bars: [{ track, start, end, openEnd, source: element indices }], instants: [{ track, at, source }], total }`. Every bar and instant knows which sequence elements produced it, so selecting it selects the element and the existing right-panel edit forms keep working.

**Decompiler** (`schedule → sequence`):

1. Collect every boundary: bar starts, bar ends, instants. Round to whole milliseconds.
2. Sort by time; at equal times order releases before presses, then instants (a release and a press of the same key at the same ms must never overlap).
3. Walk the boundaries, emitting a `Delay` for every gap, `Down` / `Up` for bar edges, the system event for instants.
4. Tidy: a `Down` immediately followed (after only a Delay) by the `Up` of the same key becomes one `DownUp` with that delay as `press_duration`.

Guarantees, covered by unit tests (Vitest, new to the project, pure functions only): `decompile(compile(seq))` returns `seq` for any sequence the tidy step would produce, and `compile(decompile(sched))` returns `sched` for any schedule. Recording, Edit All and the timeline all go through the same two functions, so the list and timeline views can never disagree.

### 2. Timeline view

Layout inside the centre panel, replacing the card list when `Timeline` is selected:

```
┌ toolbar: [List | Timeline]  [● Record]  [🗑]      [Edit All] [⚙ Behaviour] [▶ Simulate] ┐
│ ruler          0ms      50ms      100ms      150ms      200ms                            │
│ [E]      ·······▮▮▮▮·······································                              │
│ [H]      ▮▮▮▮·············································                              │
│ [Enter]  ····································▮▮▮▮·········                              │
│ [Events] ······◆ Open URL ················································              │
│          ▲ trigger                                        ▲ end of iteration             │
│          └────────────── While Held ──────────────────────┘                              │
├ Simulation (collapsible) ────────────────────────────────────────────────────────────────┤
```

- **Tracks**: one per key or mouse button in order of first use, plus an `Events` track for instants. The label is the keycap. Empty tracks are removed when their last bar goes.
- **Ruler and zoom**: pixels per millisecond; `Fit` on open, Ctrl+wheel zooms around the pointer, horizontal scroll pans. The end-of-iteration marker is always reachable. Sequences with long delays (seconds) fit thanks to zoom; there is no upper bound.
- **Markers**: purple trigger line at 0; yellow end-of-iteration line at `total`; a bracket between them labelled by the macro type: `While Held` (On Hold), `Until toggled` or `× N` (Toggle), `Once` or `× N` (Single). A faded ghost copy of the bars after the end marker shows how the next iteration follows, for looping types (nice to have).
- **Selection**: click selects the bar (and therefore the element) and the right panel shows its form as today; Shift-click and rubber band select many; Delete removes; Ctrl+D duplicates after the end; Escape clears. Keyboard nudge: arrows move ±1 ms, Shift+arrows ±10 ms.
- **Editing**: drag a bar to move it in time; drag either edge to change its press duration; drag on empty track space to draw a new press of that key; drag the end-of-iteration marker to change the trailing delay (the loop gap); drag a bar vertically to another track to change its key. Snapping to whole ms, to a 5 / 10 ms grid when Shift is held, and to other bars' edges. Every drag produces one undoable sequence change.
- **Adding from the palette**: clicking a key adds a press of the default duration at the playhead (end of the sequence by default); dragging a key from the palette onto a track position adds it there. System events land on the Events track. `Add Delay` is hidden in timeline mode: gaps are delays.
- **Implementation**: absolutely positioned elements inside a scrolling container, pointer events with pointer capture in one small `useTimelineDrag` hook. No canvas library, no new dependency; the existing dnd-kit stays for the list. Bars are React elements, which is fine up to several hundred; a recorded 30 s typing session is a few hundred bars.
- **Responsive**: the panel has the same width constraints as the list; at narrow widths the ruler labels thin out and the toolbar wraps as it does today.

### 3. List view

Unchanged. The toggle is a segmented control in the toolbar; the last choice is remembered in the application config (`SequenceView`). Both views edit the same sequence state, so switching is instant.

### 4. Recording into the timeline

The recorder hook keeps capturing keydown / keyup / mousedown / mouseup while the window is focused, with grabbing paused. What changes is where events go:

- Down opens a bar at `now − t0` on that key's track, Up closes it; instants cannot be recorded. Bars grow live under a moving playhead.
- Recording appends at the playhead: at the end of the existing sequence by default, or at the selected position. The trash button clears the sequence, as in the reference.
- On stop, the schedule is decompiled into the sequence, which is where the DownUp tidy and the *Record with fixed timings* setting apply (fixed timings quantise every press and gap to the default delay). Recording in list mode goes through the same path, so both modes produce identical sequences.
- Left click still stops recording (existing behaviour), and the timeline's own pointer handlers are disabled while recording.

### 5. Simulation panel

A virtual player of the schedule plus the macro behaviour, under the timeline and collapsible. It works in both views.

- **Controls**: `Start` presses the trigger; `Release` releases it (On Hold: enabled after Start; Toggle: `Start` becomes `Trigger again`); speed 1× / ¼×; `Reset`.
- **Shows**: state badge (`IDLE`, `HOLDING` before the threshold, `RUNNING`, `COMPLETED`, `STOPPED`), elapsed time, loop counter, **Active keys** (keycaps currently held, from the schedule), **Key history** (every key or event sent, in order, keycaps and event chips such as `Open URL`, `Type "gg"`), and an **Output preview** line rendering what the presses would type (letters, digits, Shift, Enter as a newline; US layout only, labelled as such).
- **Playhead**: the timeline shows the playhead moving in sync, wrapping per iteration.
- **Semantics mirrored from the backend**: hold threshold and tap mode (a Start / Release shorter than the threshold shows one replayed tap for Deferred tap and just the pass-through press for Pass through), repeat count, minimum iteration time (`max(10 ms, injected events × 10 ms)`), release ends the loop after the current iteration, and On Hold ignores auto-repeat. The numbers come from one shared constants module; a Tauri command `get_execution_constants` can hand them over from the backend so the two cannot drift.
- **Fidelity risk**: this is a second implementation of the backend's rules. Two mitigations, in order: unit tests of the player against documented scenarios (the E2E scenarios we already verified), and later an optional **backend dry run** (`simulate_macro` command runs `Macro::execute` with a capturing executor instead of `SendInput`, streaming the events back) for the sequence part.
- **Test pad** (optional): a text box in the panel with focus; `Run for real` executes the macro through the actual executor so the output lands in the box. This is the one honest end-to-end check, and it is safe because the app owns the focus.

### 6. Bindings palette

Regroup the existing palette to the reference's structure, keeping the search and the keycap buttons:

`Basic characters` (letters, digits, punctuation), `Extended` (function keys, navigation, numpad, modifiers, lock keys), `Mouse`, `Functions` (Delay in list mode, Run Macro, Enable / Disable / Toggle Collection), `Media and volume`, `System` (Open, Paste Text, Type Text). A tooltip on each group says what clicking does in the current view.

### 7. Backend and data changes

Small, and none to the stored format:

- `ApplicationConfig.SequenceView` (`List` | `Timeline`, serde default `List`).
- `get_execution_constants` command (min iteration, standard key delay, typing rate).
- Decision 3 below (mouse press duration) if accepted.
- Optional later: `simulate_macro` dry run.

## Phases

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| A. Schedule core | `compile` / `decompile` in `src/utils/schedule.ts`, Vitest set up, round-trip tests, Edit All and the recorder rewired through them (no visible change yet) | |
| B. Timeline, read-only | View toggle, tracks, ruler, zoom, markers and bracket, selection wired to the right panel | A |
| C. Timeline editing | Move, resize, draw, delete, multi-select, nudge, snapping, end-marker drag, palette click / drag-in, undo through the existing unsaved-changes flow | B |
| D. Recording into the timeline | Live bars and playhead, append at playhead, trash, fixed timings through the decompiler | A, B |
| E. Simulation | Player, panel, playhead sync, constants command, scenario tests | A, B |
| F. Palette and polish | Regrouping, tooltips, responsive pass at the minimum window size, keyboard shortcuts, docs and changelog | B–E |
| G. Optional | Backend dry run, test pad, ghost iterations, drag between tracks | E |

A is the foundation and is worth doing even if nothing else ships: it removes the special cases in the recorder and Edit All. B–C are the bulk of the UI work. D and E are independent of each other. Each phase is one pull request and one testable build.

## Decisions to take

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Replace the list, or add the timeline beside it? | Both, with a toggle. List stays the default until the timeline has been used for a few weeks, then Timeline becomes the default for new macros. |
| 2 | Keep the linear sequence as the source of truth? | Yes (section 1). A native time-based format is a full migration for no gain in expressiveness. |
| 3 | Mouse `DownUp` today does **not** hold up the sequence (it runs as a separate task, unlike a key `DownUp` which does). On the timeline that would show the next element starting while the button is still held. | Change the backend to await it like keys. It alters timing only for macros that put something right after a mouse press with a duration, which were overlapping by accident. |
| 4 | Simulation: frontend player first, backend dry run later? | Yes. The player is needed anyway for scrubbing and the playhead; the dry run adds fidelity for the sequence part when it is worth it. |
| 5 | Recording: append at the playhead, or replace the sequence? | Append, with the trash button to clear first. Matches the reference and does not throw work away. |
| 6 | Countdown before recording starts? | No. The first key press defines t = 0, as today. |
| 7 | Rows per key (reference) or one row per element? | Per key; it is the whole point of the view (overlaps become visible). |
| 8 | Output preview keyboard layout | US only, labelled; the HID map has no layout information. |
| 9 | `Profiles` group | Out of scope (Wootility owns profiles). |
