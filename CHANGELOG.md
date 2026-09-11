# Changelog

All notable changes to this fork. Versions are git tags; each tag is built and published by the release workflow.

## Unreleased

### Added
- Timeline view of the sequence (List / Timeline toggle above the sequence, remembered): one row per key, a bar per press, system events on an Events row, ruler with zoom (Ctrl + wheel, Fit), the trigger press at 0, the end of one iteration and a bracket labelled by the macro type. Bars can be dragged (Shift snaps to 10 ms), resized at their edges, drawn on empty rows, moved to another key, multi-selected with Shift-click, nudged with the arrow keys and deleted; dragging the end marker sets the gap before the next loop. Edits are written back into the same sequence the list shows.
- Simulation panel (play button above the sequence): plays the macro virtually with the backend's rules for hold threshold, tap mode, repeat count and minimum loop time. Start presses the trigger, Release lets it go; shows the state, loop count, keys currently held, everything sent so far and a preview of the text it would type (US layout). A playhead moves over the timeline.
- Recording keeps overlapping keys as overlapping presses instead of flattening them to a list of Down and Up cards; the list shows presses live while recording.
- Browser preview for UI work: `yarn dev` then `http://localhost:1420/?mock` runs the frontend without Tauri on canned data.
- Type Text element: text typed as keystrokes (Unicode key events), for chat boxes and launchers that block paste. A new line presses Enter.
- Global pause hotkey (Settings > Macro Output) that toggles macro output from anywhere, also while paused. Its presses are swallowed.
- Edit All for sequences: set every delay, compact delays, remove all delays, set every key and mouse press duration.
- Record with fixed timings setting: recording uses the default delay for delays and press durations.
- Keycap styling (the HTML `kbd` element) for every key shown in the UI, including the element palette.
- Bottom status strip: state, focused application, armed collections (two names plus +N), last macro fired with a burst count, version; hover for hook and output state, every armed collection with the application it waits for, and the last three macros. Replaces the status block in the left panel.

### Changed
- A mouse press with a duration now holds up the sequence like a key press does (it used to run alongside the next element).
- The editor's side panels stop growing past 380 / 420 px on wide windows; the sequence panel takes the rest. Macro name and type sit together on the left of the header, trigger and save on the right.
- Sequence toolbar wraps at narrow widths; the editor header keeps its actions on screen; the collection header wraps its actions.
- The Trigger Keys dialog keeps its key list when closed without recording, and always shows the "trigger while other keys are held" checkbox for key triggers.
- Macro card switches show the macro's own state rather than the macro AND collection state.
- The updater public key was rotated; the signing key is now password protected.

### Fixed
- Debug builds (`yarn tauri dev`) no longer abort on Rust 1.98: the single-instance plugin is vendored with a null-pointer guard in its Windows window procedure.
- Opening macro settings from outside the editor no longer crashes.

## 1.2.0 — 2026-09-10

First release of the fork. Built from upstream `main` (v1.1.0).

### Added
- On Hold and Toggle macro types (upstream had the buttons disabled).
- Hold threshold with Deferred tap / Pass through modes, exact by timestamps; 1 ms timer resolution so macro delays are accurate.
- Self-trigger filter: simulated input is stamped by the rdev fork and ignored by the trigger matcher, so a macro may output its own trigger key.
- Application-linked collections with a 250 ms foreground poller; Linked Applications dialog with search, running programs, Steam library scan and an .exe picker.
- Per-macro application scope on top of the collection link.
- Trigger while other keys are held (`allow_while_other_keys`), on by default for new macros.
- Per-macro repeat count: Single plays N times, Toggle stops after N loops.
- System events: Play/Pause, Next, Previous, Stop media keys; Toggle mute microphone; Run Macro (chaining, up to 8 deep); Enable / Disable / Toggle Collection.
- Paste Text restores the previous clipboard text.
- Hook supervisor: re-installs the low-level hook every 10 s and replaces a stuck hook thread (upstream #228, "stops working after lock/unlock").
- Loops stop themselves if the hook stops seeing the events they inject.
- Editor keyboard shortcuts: Ctrl+S, Delete/Backspace, Ctrl+D, Escape.
- Tray menu listing collections with their state, toggles for manual collections and macro output.
- Import / export of macros and collections as JSON; copy a macro to another collection.
- Trigger dialog records immediately for a new macro.
- Macro Settings modal (gear) with a Behaviour tab.
- Release workflow on `v*` tags publishing Windows installers and the updater manifest; in-app updater re-enabled against this repository's releases.
- `docs/ROADMAP.md` and `docs/BACKLOG.md`.

### Changed
- Version 1.2.0 across package.json, tauri.conf.json and both crates.
- `time` crate bumped to 0.3.36 so the project builds on current Rust.
- Code signing removed from the Tauri config (no certificate); the updater uses this fork's own key.
- rdev comes from https://github.com/Brandon-Haney/rdev (branch `injected-flag`): injected-input stamping, re-installable hooks.

### Fixed
- Clippy warnings on the Tauri host.
