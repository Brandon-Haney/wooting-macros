# Backlog triage

Triage of the upstream [WootingKb/wooting-macros](https://github.com/WootingKb/wooting-macros) issues and pull requests as of 2026-09-10 (46 open issues, 5 open PRs), against this fork. Reactions and comment counts are from upstream.

## Done in this fork

| Upstream | Ask | Fork status |
| --- | --- | --- |
| #250 (👍5, most discussed), #131 | Loop / stop macros, playback settings | On Hold and Toggle macro types, hold threshold, per-macro repeat count |
| #99, #128 | Application-aware collections, macros per application | Collections linked to executables, armed by the foreground window |
| #151 | Media playback controls | Play/Pause, Next, Previous, Stop system events |
| #254 | Shortcut to enable/disable a collection | Enable/Disable/Toggle Collection system events |
| #260 | Paste Text does not restore the clipboard | Previous text content is restored after the paste |
| #228 (💬8) | Stops working after locking and unlocking the PC | Hook supervisor re-installs the input hook every 10 s and replaces a stuck hook thread. Root cause is Windows removing unresponsive low-level hooks; the same mechanism killed the hook when a Teams window stole focus during testing |
| #171 | Trigger modifier carries into the macro | Modifiers are lifted only once the macro actually fires (on-hold: when the hold is confirmed) |
| self-trigger warning | Trigger key inside the sequence re-triggers the macro | Simulated input is stamped (rdev fork) and ignored by the hook |
| (new) | Macro chaining | Run Macro system event, up to 8 levels deep |
| (new) | Mic mute | Toggle Mute Microphone system event (Windows Core Audio) |

## Open PRs

| PR | Verdict |
| --- | --- |
| #264 Mouse emulation (YOLOOO, +3209) | Large feature built on the Wooting Analog SDK (analog keys drive the mouse). Independent of the macro engine; could be merged as an opt-in view later. Not rebased: it predates the Phase 1 backend changes and touches `lib.rs`, so it needs a manual port. Candidate for Phase 3 after the Tauri 2 move. |
| #259 Trigger on release (coathier) | Targets the unreleased `feature/1.2_release` refactor, not `main`; cannot be rebased as-is. The idea (a `Release` macro type) is small on top of the fork's trigger state machine. Backlog. |
| #242 Spongebob text (NexusNovaz, +63) | Tiny clipboard transform like Sarcasm. Easy to port. Backlog, low priority. |
| #240 Custom URL protocol handlers (Martmists, 1 line) | `opener::open` instead of `open_browser` for non-http schemes. Easy. Backlog. |
| #245 dependabot bump | Superseded by the fork's dependency bumps. Close. |

## Next candidates (Phase 2, remaining)

1. **#157 / #133 mouse movement recording and gestures.** Needs a `MouseMove` action (absolute or relative) and recording of moves at a sample rate. Medium.
2. **#237 Enter Text (type text as keystrokes).** Alternative to Paste Text for apps without clipboard support. Needs a character-to-scancode mapping per layout. Medium.
3. **#262 editor ergonomics:** delete shortcut, bulk selection, per-element loop count. Frontend only. Medium.
4. **#161 / #162 import, export and duplicate macros/collections.** Frontend plus a file dialog. Small.
5. **#144 sound on macro activation.** `rodio` is already a dependency. Small.
6. **#258 scroll wheel triggers, #257 modifier + mouse button triggers.** Trigger matcher work. Medium.
7. **#252 / #244 allow_while_other_keys.** The field exists but is unimplemented upstream. Medium.
8. **#163 default element duration.** Small setting.

## Bugs still open upstream, not reproduced here

- #251 blank window on openSUSE / Wayland, #246 fails to launch, #226 slow and laggy, #243 RAM usage: Linux/Wayland and environment specific. Phase 3.
- #203 / #241 accent and dead keys, #129 / #212 CapsLock triggers, #239 Shift+Arrow: layout handling in the trigger matcher and in rdev's key naming. Phase 3 (rdev rebase).
- #249 running as administrator changes held-key behaviour: likely the same hook timeout class as #228; re-test with the supervisor.
- #248 RDP sessions: input injection into RDP is blocked by Windows; document as unsupported.

## Won't do

- #178 on-board macros, #104 live macro keys: firmware features, see the README.
- #106 macOS: rdev grab needs accessibility permissions and a main-thread event loop; not planned.
- #107 MIDI, #170 scripting/plugin system: out of scope for a macro tool.
- #85 updater UI: the updater is disabled in the fork.
