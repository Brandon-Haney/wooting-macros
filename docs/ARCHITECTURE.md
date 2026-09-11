# Architecture

How the fork's backend works, for anyone touching `wooting-macro-backend/src/lib.rs` or the Tauri host in `src-tauri/src/main.rs`. Upstream's overall shape (Tauri host, backend crate, React frontend, Chakra UI) is unchanged; this documents what the fork added.

## Input path

```
physical key ──► rdev low-level hook (grab thread) ──► grab_callback
                                                        │
                       KeysPressed (held keys) ◄────────┤ updates
                       pause hotkey check ◄─────────────┤ before the listening gate
                       trigger lookup + matcher ◄───────┤ check_macro_execution_efficiently
                                                        │
                                              execute_macro (sync, on the grab thread)
                                                        │
                        ┌───────────────────────────────┼──────────────────────────┐
                    Single: spawn task          Toggle: registry flip       OnHold: Pending → timer → Running
                                                        │
                                          Macro::execute (async) ──► executor channel ──► keypress_executor_sender thread ──► SendInput
                                                                                                                │
                                                        hook sees the injected event (stamped) ◄────────────────┘ passes it through
```

- **rdev fork** (`Brandon-Haney/rdev`, branch `injected-flag`): every `INPUT` sent by `simulate` carries `dwExtraInfo = 0x574F4F54`, and `Event::injected` reports it back from the hook structs. The grab callback passes injected events through untouched, which is what lets a macro output its own trigger key. The fork also runs a real message loop so hooks can be re-installed (`request_rehook`, `rehook_count`, `unhook`).
- **Executor thread**: all key and mouse events go through one unbounded channel to a thread that calls `SendInput` with a 1 ms gap (Windows). Typed text rides the same channel through a sentinel key event so it keeps its place in the sequence. Announced events (`InjectedEvents`) are a fallback for platforms where rdev cannot stamp input.

## Trigger registry

`RunningMacros` is a `Mutex<HashMap<TriggerKey, TriggerState>>`. `TriggerKey` is the sorted HID codes of a key trigger or the mouse button code; macros have no id and their names are not unique, but two active macros cannot share a trigger. It is a std `Mutex`, not tokio's `RwLock`, because `set_is_listening` is a sync function called from an async Tauri command.

```
              press (matcher)                     timer (hold_threshold_ms)
   Idle ─────────────────────────► Pending ─────────────────────────────► Running
     ▲                               │ release before the threshold           │ release of any trigger key,
     │                               │  tap: replay one synthetic tap         │ pause, collection change,
     │                               │  (DeferredTap) or nothing (PassThrough)│ hook watchdog, toggle press
     └───────────────────────────────┴────────────────────────────────────────┘
```

- `execute_macro` runs synchronously on the grab thread so the registry is updated in event order: the release that ends an On Hold macro can never overtake the press that started it.
- Tap versus hold is decided from timestamps on release, so the threshold is exact even when the timer task fires late. `timeBeginPeriod(1)` is requested so timers and macro delays are accurate on Windows.
- OS auto-repeat: a press whose key is already in `KeysPressed` is a repeat. Repeats of a looping trigger are swallowed outright; other repeats never restart a loop or flip a toggle, but still fire Single macros as upstream did.
- `spawn_macro_loop` repeats `Macro::execute` until the flag clears, with a minimum iteration time so a sequence without delays cannot flood the executor, and a liveness watchdog: injected events come back through the hook, so if the hook stops seeing them for a second the hook is gone and the loop stops itself.
- Modifiers of a multi-key trigger are lifted (synthetic releases) when the macro actually fires; for On Hold that is when the hold is confirmed, so a deferred tap of Ctrl+X still delivers Ctrl+X.

## Hook supervisor

Windows silently removes a low-level hook whose thread stops responding (lock screen, a foreground application that stalls `AttachThreadInput`, heavy load). Every 10 s, while no loop is running, the supervisor asks the grab loop to unhook and re-install (`request_rehook`) and waits 2 s for `rehook_count` to move. If it does not, the hook thread is considered stuck: its hooks are removed from the supervisor's thread and a fresh grab thread is started with a new callback. `BackendStatus::hook_healthy` reflects the last check.

## Foreground and scoping

`spawn_foreground_watcher` (Tauri host) polls the foreground window's executable name every 250 ms and calls `set_foreground_process`, which arms every linked collection whose executable matches and disarms the others, rebuilds the trigger lookup, stops loops whose trigger is no longer active, and returns the data for the `macro-data-updated` event. Per-macro `linked_processes` are checked in the matcher against the same foreground name. `foreground.rs` also lists running programs with a window (EnumWindows) and games from the Steam libraries (registry `SteamPath`, `libraryfolders.vdf`, `appmanifest_*.acf`, plausible executables with launchers and anti-cheat helpers filtered out).

## Host commands and events

Backend → host: `BackendCommand` over an unbounded channel, processed by `spawn_command_processor`: `SetCollectionActive` (from Collection elements and the tray), `MacroFired` (status strip), `ListeningChanged` (pause hotkey).

Host → frontend events: `macro-data-updated` (whole `MacroData` after the backend changed it), `macro-fired` (name), `listening-changed` (bool). The frontend's collections state follows these; its own edits go back through `set_macros`, which applies the foreground rule again and only stops loops whose trigger is no longer active.

Tauri commands added: `list_processes`, `list_applications`, `get_status`.

## Data model additions

`Macro`: `hold_threshold_ms` (default 250), `tap_mode` (`DeferredTap` | `PassThrough`), `repeat_count` (`Option<u32>`), `linked_processes`. `Collection`: `linked_processes`. `ApplicationConfig`: `PauseHotkey` (HID codes), `RecordFixedTimings`. All serde-defaulted so upstream configs load unchanged.

New system actions: `Media` (Next/Prev/Stop/PlayPause as media virtual keys), `Volume::ToggleMicrophoneMute` (Core Audio, default communication capture device), `Macro::Run` (handled inline by `Macro::execute`, depth-limited), `Collection` (Enable/Disable/Toggle, sent to the host), `Text::Type` (queued on the executor).

## Testing

There are no unit tests for the input path; it depends on the real Windows hook. `scratchpad` harnesses (`e2e_test.py`, `e2e_phase1.py`, `e2e_phase2.py`, kept outside the repository) launch the release exe, open a Tk window that records what reaches it and inject keys with `SendInput`, including simulated auto-repeat. They need an idle desktop: anything that steals focus receives the macro output. The app's debug log (`MACRO_LOG_LEVEL=debug`) records every macro start, loop stop, collection change and hook re-install and is the reliable record when focus cannot be guaranteed.
