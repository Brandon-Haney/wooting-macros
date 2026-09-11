# Roadmap

Where the fork is, what is planned, and what has been decided. Companion to
[BACKLOG.md](BACKLOG.md), which triages the upstream issue tracker; this file tracks our own
priorities. Update it in the same commit as the feature.

Status legend: **done** (on `feature/on-hold-macros`; released items are listed in [CHANGELOG.md](../CHANGELOG.md)), **building** (in progress),
**next** (agreed, not started), **proposed** (needs a decision), **later** (agreed, low priority),
**dropped** (decided against, with the reason).

## Goal

A community-maintained macro tool for Wooting keyboards that fills the gaps Wootility leaves:
macros that repeat while a key is held, armed only for the game in focus, without placeholder key
remaps, and reliable across a whole gaming session.

## Must haves

| Feature | Status | Notes |
| --- | --- | --- |
| On Hold macro type (repeat while held) | done | Registry of running loops keyed by trigger, stops on release of any trigger key, watchdog if the hook dies |
| Toggle macro type | done | Optional loop limit |
| Hold threshold with Deferred tap / Pass through | done | Exact by timestamps; 1 ms timer resolution requested |
| Trigger key may be the output key | done | rdev fork stamps injected input (`injected-flag` branch) |
| Application-scoped collections | done | Foreground poller at 250 ms, Linked Applications dialog with search, running apps, Steam library, exe picker |
| Trigger while other keys are held | done | `allow_while_other_keys`, default on for new macros |
| Survive lock/unlock and hook loss (upstream #228) | done | Hook supervisor re-installs every 10 s, replaces a stuck hook thread |
| Per-macro repeat count | done | Single plays N times, Toggle stops after N loops |
| Media and microphone system events | done | Play/Pause, Next, Previous, Stop, Toggle mute microphone |
| Macro chaining (Run Macro element) | done | Up to 8 levels deep |
| Enable/Disable/Toggle Collection elements (upstream #254) | done | Linked collections refuse macro control |
| Paste Text restores the clipboard (upstream #260) | done | Text content only |
| Trigger dialog records immediately for new macros | done | |
| Macro Settings modal (gear) with Behaviour tab | done | Repeat count, hold threshold, tap mode |
| Editor keyboard shortcuts | done | Delete removes the selected element, Ctrl+S saves, Escape closes dialogs, Ctrl+D duplicates |
| Status bar / activity feedback | done, unreleased | Bottom status strip (option A of the mockups): state, focus, armed +N, last fired with burst count, version; hover card with every armed collection and recent activity |
| Tray menu with collection states | done | See and toggle collections from the tray icon |
| Import / export / duplicate | done | Collections and macros to JSON files; duplicate into another collection (upstream #161, #162) |
| Type text element (upstream #237) | done, unreleased | Text as keystrokes for apps that block paste |
| Per-macro application scope | done | "Only in these applications" on a macro, layered on the collection link |
| Global pause hotkey | done, unreleased | Settings > Macro Output; works while paused too, keys are swallowed |
| Versioning and release builds | done | 1.2.0; GitHub Releases with installers; updater on our own key |

## Quality of life

| Feature | Status | Notes |
| --- | --- | --- |
| Bulk element edits (upstream #262) | done, unreleased | Edit All: set every delay, compact delays, remove delays, set every press duration. Multi-select still later |
| Timeline macro editor with simulation (Wootility-style) | done, unreleased | List / Timeline toggle, per-key bars with drag, resize, draw and snapping, end-marker loop gap, simulation panel with playhead; recording keeps overlaps. Plan and remaining polish in [TIMELINE_EDITOR_PLAN.md](TIMELINE_EDITOR_PLAN.md) |
| Inline element editing on the sequence card | later | |
| Recording with a single global delay / compact delays | done, unreleased | Settings: Record with fixed timings; Compact delays in Edit All |
| Sound on macro activation (upstream #144) | later | rodio is already a dependency |
| Diagnostics export | later | Zip log and config |
| Default element duration setting (upstream #163) | later | Macro Defaults tab is still a placeholder |
| Mouse movement actions and recording (upstream #157) | later | |
| Scroll wheel and modifier+mouse triggers (upstream #258, #257) | later | |
| Trigger on release macro type (upstream PR #259) | later | Small on top of the trigger state machine |
| Spongebob text, custom URL schemes (upstream PRs #242, #240) | later | Trivial ports |

## Platform and maintenance

| Item | Status | Notes |
| --- | --- | --- |
| Backlog triage of upstream issues and PRs | done | [BACKLOG.md](BACKLOG.md) |
| Debug builds crash on Rust 1.98 (single-instance plugin) | done, unreleased | Plugin vendored under src-tauri/vendor with a null guard |
| Tauri 2 migration, dependency refresh | later | Phase 3 |
| Rebase the rdev fork on upstream Narsil/rdev | later | Phase 3 |
| Linux/Wayland stability | later | Phase 3 |
| Automated end-to-end test in CI | later | The harness exists (SendInput into a Tk window) but needs an idle desktop; a self-hosted runner or a VM |

## Decisions

| Question | Decision |
| --- | --- |
| Base branch | Upstream `main` (v1.1.0), not the unreleased `feature/1.2_release` refactor |
| Code signing and updater | No code signing (no certificate). Updater enabled on our own minisign key (password protected since the evening of 2026-09-10; key rotated, so installs of the 1.2.0 release need a fresh install once), feed = GitHub Releases latest.json |
| Registry lock type | std `Mutex`, because `set_is_listening` is sync inside an async Tauri command |
| Default tap mode | Deferred tap (Brandon uses Pass through for his X macro) |
| UI option names | Keep upstream's names; clarify with tooltips, don't rename |
| Per-macro application scope | Yes: "Only in these applications" per macro, layered on the collection link (2026-09-10) |
| Version number and app name | Bump to 1.2.0, keep the Wootomation name for now (2026-09-10) |
| Auto-update via GitHub Releases | Yes: CI builds installers on tag, in-app updater on our own signing key (2026-09-10) |
| Timeline editor | Derived view over the linear sequence, List/Timeline toggle, frontend simulation first, recording appends, timed mouse presses will block the sequence like keys; full table in [TIMELINE_EDITOR_PLAN.md](TIMELINE_EDITOR_PLAN.md) (2026-09-10) |
| Priority order of the "next" items | Editor shortcuts, status bar, tray menu, import/export, then per-macro scope and releases (2026-09-10) |
| Keyboard protocol work | Brandon owns the hardware; reverse engineering Wootility's HID protocol for a local companion is in scope. Captured and documented in [WOOTING_HID_PROTOCOL.md](WOOTING_HID_PROTOCOL.md) (2026-09-10) |

## Hardware companion (long term)

| Item | Status | Notes |
| --- | --- | --- |
| Wootility HID protocol reference | done | [WOOTING_HID_PROTOCOL.md](WOOTING_HID_PROTOCOL.md): framing, command and report tables, profile schema. The firmware has no macro primitive; on-board behaviours are remaps plus DKS, Mod Tap, Toggle Key, Rappy Snappy and SOCD |
| Elevated-window warning | next | SendInput into an elevated window is dropped silently (UIPI); detect it and tell the user, or offer to run elevated |
| Scan-code-only output option | later | Per-macro or global toggle to send `KEYEVENTF_SCANCODE` events for apps that read scan codes |
| Keyboard profile switching from the foreground poller | later | `activateProfile` (cmd 23) over the config interface; would replace the Wootility service for app-linked profiles |
| Local Wootility replacement (profiles, remaps, Advanced Keys) | later | Everything in the protocol doc is writable from a companion; needs a WebHID or hidapi client and the protobuf schema |
| On-board macros (firmware) | in progress | Confirmed chip STM32F103xG XL-density; RE environment set up (radare2), flash-write and USB-descriptor routines located. Tracked in [ONBOARD_MACROS.md](ONBOARD_MACROS.md); background in [FIRMWARE_NOTES.md](FIRMWARE_NOTES.md) |
| Author macros in an enhanced configurator | design | Same WebHID/Rust client as the local Wootility replacement; macros as a binding in the key picker. Executes on the host until firmware supports sequences |

## Out of scope

Anti-cheat evasion (making injected input look like hardware from the host side needs a kernel driver and breaks the injected-flag self-detection), macOS.
See the README.
