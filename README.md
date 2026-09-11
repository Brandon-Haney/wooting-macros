# Wootomation

<p align="center">
  <img alt="Wootomation – Create macros to use with any keyboard and any mouse" src=".github/assets/app-hero-banner.jpg">
</p>

A community-maintained fork of [WootingKb/wooting-macros](https://github.com/WootingKb/wooting-macros), the macro tool for Wooting (and any other) keyboards. Upstream's last release dates from February 2024; this fork adds the features people kept asking for and fixes the reliability problems that made them give up on it.

The main use case: launch a game, Wootility switches your keyboard profile, this app arms the macro collection linked to that game. A quick tap of a key stays a normal tap; holding it past a threshold streams the macro until you let go. Nothing has to be remapped to placeholder keys, and everything disarms when the game loses focus.

## Features

**Macro types**
- **Single** plays the sequence once per trigger press, optionally a set number of times.
- **Toggle** starts repeating on one press and stops on the next, optionally after a set number of loops.
- **On Hold** repeats while the trigger is held. A hold threshold (default 250 ms) keeps short presses as normal taps: in **Deferred tap** mode the press is held back and replayed as one tap on release, so the game never sees the key held; in **Pass through** mode the press reaches the game immediately and the stream starts when the threshold elapses.
- A macro may use its own trigger key as output. Simulated input is stamped and ignored by the trigger matcher, so X can send X without re-triggering itself.
- Triggers can fire while other keys are held (Shift, W while moving), configurable per trigger.

**Scoping**
- **Application-linked collections:** link a collection to one or more executables (search running programs, pick from your Steam library, or browse for an .exe). The collection arms itself while one of them owns the focused window and disarms otherwise, stopping any running loops.
- **Per-macro application scope:** on top of the collection, a macro can be limited to specific applications.

**Sequence elements**
- Key presses, mouse buttons, delays, open file / folder / website, paste text (the clipboard is restored afterwards), **type text** as keystrokes for apps that block paste, volume and **media keys**, **microphone mute**, **run another macro**, **enable / disable / toggle a collection**.

**Editor and app**
- Keyboard shortcuts in the editor: Ctrl+S saves, Delete removes the selected element, Ctrl+D duplicates it, Escape deselects.
- **Edit All** on a sequence: set every delay or press duration, compact delays, remove delays. Recording can use fixed timings instead of measured ones.
- **Import / export** macros and collections as JSON, copy a macro to another collection.
- **Status strip** along the bottom: hook health, focused application, armed collections, last macro fired; hover for details.
- **Tray menu** with every collection's state, toggles for manual collections and for macro output; a global **pause hotkey** toggles macro output from anywhere.
- **Self-healing input hook:** the low-level hook Windows uses for global keystrokes gets silently removed after a lock screen or a stalled application; the app re-installs it every ten seconds and replaces a stuck hook thread, so macros keep working through a whole session (upstream issue #228).
- Automatic updates from this repository's GitHub Releases.

**Any keyboard, any mouse.** Triggers can be any key or mouse button*. Windows 10/11 is the primary platform; Linux builds from upstream still work but application scoping, typed text and microphone mute are Windows-only for now.

*Mice with more than 5 buttons may behave unexpectedly.

## Warning

This application grabs and analyses every keystroke through a low-level hook, and injects input the same way. Anti-cheat software can detect that, and macros are considered cheating in many games. Use it with games at your own risk; nothing here tries to hide from anti-cheat, and nothing will.

## Installing

Download the latest installer from the [Releases page](https://github.com/Brandon-Haney/wooting-macros/releases/latest):

- `Wootomation_<version>_x64-setup.exe` installs for the current user (no administrator prompt). Recommended.
- `Wootomation_<version>_x64_en-US.msi` installs for all users.

Neither is code-signed, so Windows SmartScreen will warn on first run. The app checks the Releases page for updates on launch and offers to install them.

If you had Wooting's original Wootomation installed, uninstall it first: both use the same single-instance lock and the same configuration folder (`%APPDATA%\wooting-macro-app`). Your macros carry over.

## Quick start

1. **Create a collection per game** and click **Link Applications** in its header. Search for the game (running programs and your Steam library are listed) or browse for its .exe. The collection now shows an Armed / Off badge instead of a switch.
2. **Add a macro.** The trigger dialog opens already recording: press the key you want as trigger. In the header pick the macro type; the gear button above the sequence opens the hold threshold, tap mode and repeat count.
3. **Build the sequence** from the element palette or record it. For a "spam X while held" macro: type On Hold, trigger X, sequence X (full press, 20 ms) + delay 20 ms, tap mode Pass through.
4. **Save** (Ctrl+S). Focus the game; the status strip at the bottom shows the collection as armed and the last macro fired.

## Out of scope

- **On-board (firmware) macros.** The keyboard firmware has no macro primitive (see [docs/WOOTING_HID_PROTOCOL.md](docs/WOOTING_HID_PROTOCOL.md)); until Wooting adds one, no software can store macros on the keyboard.
- **Profile switching.** Wootility already switches keyboard profiles per application through its background service; this app does not duplicate it.
- **Anti-cheat evasion.** See the warning above.
- **macOS.** The input grab needs accessibility permissions and a main-thread event loop the backend does not have.

## Project documents

- [CHANGELOG.md](CHANGELOG.md): what changed in each version.
- [docs/ROADMAP.md](docs/ROADMAP.md): planned work, status and decisions.
- [docs/TIMELINE_EDITOR_PLAN.md](docs/TIMELINE_EDITOR_PLAN.md): proposal for a timeline editor with simulation.
- [docs/BACKLOG.md](docs/BACKLOG.md): triage of the upstream issue tracker.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the backend works.
- [CONTRIBUTING.md](CONTRIBUTING.md): building, testing and releasing.

## Screenshots

<p align="center">
  <img width="33%" alt="Initial view of the application" src=".github/assets/1.png">
  <img width="33%" alt="View of creating a macro" src=".github/assets/2.png">
  <img width="33%" alt="An example macro that opens up several applications and a website" src=".github/assets/5.png">
</p>

## License

GNU General Public License v3, see [LICENSE](LICENSE). The original application is by Wooting; this fork keeps their license and attribution.
