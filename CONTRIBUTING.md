# Contributing

This is a community fork of Wooting's Wootomation. Issues and pull requests go to [Brandon-Haney/wooting-macros](https://github.com/Brandon-Haney/wooting-macros). The project currently targets Windows 10/11; Linux builds still work for the upstream feature set, macOS is not supported (the input grab cannot run there).

## What to work on

[docs/ROADMAP.md](docs/ROADMAP.md) lists planned features with their status, [docs/BACKLOG.md](docs/BACKLOG.md) triages upstream's issue tracker. Pick something marked *next* or *later*, or open an issue for anything else. Update the roadmap in the same pull request as the feature.

## Reporting bugs

Open an issue with the steps to reproduce, the app version (bottom right of the status strip), and the log. The log lives in `%APPDATA%\wooting-macro-app\Wootomation.log`; for more detail set the environment variable `MACRO_LOG_LEVEL=debug` before starting the app.

## Building

### Dependencies

- [Rust](https://www.rust-lang.org/tools/install), stable. The project builds on current stable (tested on 1.98).
- On Windows, Visual Studio 2022 Build Tools with the "Desktop development with C++" workload, and the WebView2 runtime (present on Windows 10/11).
- [Node.js](https://nodejs.org/en/) 20 or newer. Yarn 3 comes with Node through corepack.
- [Tauri 1 prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites/).
- Linux only: `xserver-xorg-input-evdev`, `libevdev2`, membership of the `input` group.

### Commands

```
corepack enable            # or prefix every yarn call with "corepack yarn" if this needs admin rights
yarn install
yarn tauri dev             # debug build with the Vite dev server
yarn tauri build           # release installers under src-tauri/target/release/bundle/
```

Before submitting, both Rust crates must be clean and the frontend must type-check and lint:

```
cd wooting-macro-backend && cargo clippy --all-targets
cd src-tauri && cargo clippy
yarn build
yarn lint
```

Warnings are treated as errors in CI. Use the `log` macros (`info!`, `debug!`, ...) in the backend, never `println!`.

### Things that bite

- Debug builds read and write `data_json.json`, `config.json` and `Wootomation.log` in the repository root (gitignored); release builds use `%APPDATA%\wooting-macro-app`, the same folder the installed app uses.
- The app is single-instance: stop the installed Wootomation before launching a dev build.
- `cargo` prints an "invalid character `{` in package name: `tauri-plugin-{{name}}`" error from a template inside the plugins-workspace git checkout. It is harmless.
- The `rdev` dependency is this fork's own branch (`Brandon-Haney/rdev`, `injected-flag`); after changing it, run `cargo update -p rdev` in both `wooting-macro-backend` and `src-tauri`.
- `tauri-plugin-single-instance` is vendored under `src-tauri/vendor` with a null-pointer guard; the upstream git versions abort debug builds on recent Rust.
- Release builds sign the updater bundles. Without `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD` in the environment the CLI prints an error after producing the installers (which are still usable locally); with the key but an empty password it prompts interactively, because Windows drops empty environment variables. Only releases need signing.

## Releasing

Releases are built by `.github/workflows/release.yml` on a version tag and published with the installers and the updater manifest (`latest.json`). Installed apps check that manifest on launch.

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `wooting-macro-backend/Cargo.toml`.
2. Move the *Unreleased* section of `CHANGELOG.md` under the new version.
3. Commit, then `git tag v1.x.y && git push origin v1.x.y`.

The workflow needs the repository secrets `TAURI_PRIVATE_KEY` (the minisign private key) and `TAURI_KEY_PASSWORD`. If the key is ever replaced, the public key in `tauri.conf.json` must be updated and existing installs need a fresh install once, since they only trust the key they were built with.

## Where things are

- `wooting-macro-backend/src/lib.rs`: input hook, trigger matching, the loop registry, execution. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- `wooting-macro-backend/src/foreground.rs`: foreground window, running programs, Steam library scan.
- `wooting-macro-backend/src/plugin/`: actions (`system_event.rs`, `typing.rs`, `audio.rs`, `key_press.rs`, `mouse.rs`, ...).
- `src-tauri/src/main.rs`: Tauri commands, tray menu, foreground poller, backend command processor, updater.
- `src/`: React frontend. Types in `types.d.ts`; system events are declared in `constants/SystemEventMap.ts`, rendered by `constants/utils.ts` and edited by forms under `components/macroview/rightPanel/editForms/`.

### Adding a system action

1. Backend: add the variant to `SystemAction` (or a nested enum) in `plugin/system_event.rs` and implement it in `execute`, or intercept it in `Macro::execute` if it needs the macro library or the host (see `Macro::Run` and `Collection`).
2. Frontend: extend `SystemAction` in `types.d.ts`, add an entry to `SystemEventMap.ts`, handle it in `checkIfElementIsEditable` and `getElementDisplayString` in `utils.ts`, and add a form in `editForms/` wired through `SystemEventActionForm.tsx` if it has settings.

## License

By contributing you agree to license your contribution under the GNU General Public License v3, the license of this project.
