# Roadmap

Where the fork is, what is planned, and what has been decided. Companion to
[BACKLOG.md](BACKLOG.md), which triages the upstream issue tracker; this file tracks our own
priorities. Update it in the same commit as the feature.

Status legend: **done** (shipped on `feature/on-hold-macros`), **building** (in progress),
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
| Status bar / activity feedback | done | Hook alive, foreground application, armed collections, last macro fired |
| Tray menu with collection states | done | See and toggle collections from the tray icon |
| Import / export / duplicate | done | Collections and macros to JSON files; duplicate into another collection (upstream #161, #162) |
| Type text element (upstream #237) | done | Text as keystrokes for apps that block paste |
| Per-macro application scope | done | "Only in these applications" on a macro, layered on the collection link |
| Global pause hotkey | done | Settings > Macro Output; works while paused too, keys are swallowed |
| Versioning and release builds | done | 1.2.0; GitHub Releases with installers; updater on our own key |

## Quality of life

| Feature | Status | Notes |
| --- | --- | --- |
| Bulk element edits (upstream #262) | done | Edit All: set every delay, compact delays, remove delays, set every press duration. Multi-select still later |
| Inline element editing on the sequence card | later | |
| Recording with a single global delay / compact delays | done | Settings: Record with fixed timings; Compact delays in Edit All |
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
| Debug builds crash on Rust 1.98 (single-instance plugin) | done | Plugin vendored under src-tauri/vendor with a null guard |
| Tauri 2 migration, dependency refresh | later | Phase 3 |
| Rebase the rdev fork on upstream Narsil/rdev | later | Phase 3 |
| Linux/Wayland stability | later | Phase 3 |
| Automated end-to-end test in CI | later | The harness exists (SendInput into a Tk window) but needs an idle desktop; a self-hosted runner or a VM |

## Decisions

| Question | Decision |
| --- | --- |
| Base branch | Upstream `main` (v1.1.0), not the unreleased `feature/1.2_release` refactor |
| Code signing and updater | No code signing (no certificate). Updater enabled on our own minisign key, feed = GitHub Releases latest.json (2026-09-10) |
| Registry lock type | std `Mutex`, because `set_is_listening` is sync inside an async Tauri command |
| Default tap mode | Deferred tap (Brandon uses Pass through for his X macro) |
| UI option names | Keep upstream's names; clarify with tooltips, don't rename |
| Per-macro application scope | Yes: "Only in these applications" per macro, layered on the collection link (2026-09-10) |
| Version number and app name | Bump to 1.2.0, keep the Wootomation name for now (2026-09-10) |
| Auto-update via GitHub Releases | Yes: CI builds installers on tag, in-app updater on our own signing key (2026-09-10) |
| Priority order of the "next" items | Editor shortcuts, status bar, tray menu, import/export, then per-macro scope and releases (2026-09-10) |

## Out of scope

On-board (firmware) macros, profile switching (Wootility does it), anti-cheat evasion, macOS.
See the README.
