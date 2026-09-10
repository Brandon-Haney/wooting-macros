# Wootomation

<p align="center">
  <img alt="Wootomation* – Create macros to use with any keyboard and any mouse" src=".github/assets/app-hero-banner.jpg">
</p>

## Features

- **Create Macros:** Perform keystrokes, open applications, folders, and websites, paste text with emojis, and more.
- **Organize your macros:** Group macros into specific collections, allowing you to toggle the entire collection on/off.
- **Single, Toggle or On Hold:** Play a macro once per press, keep it repeating until the trigger is pressed again, or repeat it only while the trigger is held down. On Hold macros have a hold threshold, so a quick tap of the trigger stays a normal key press and only a long press starts the stream. A macro may use the same key as trigger and output.
- **Application-scoped collections:** Link a collection to one or more applications and it arms itself while one of them is the focused window, and disarms otherwise.
- **Any Keyboard, Any Mouse:** You can bind the macros to be activated by any keyboard key or mouse button*.
- **Open Source:** Want to help out? See below on how to get started.
- **Windows & Linux:** Support for Windows 10/11 and most Linux distros**. MacOS support is on our radar.

*Mice with more than 5 buttons may experience unintended behaviour. Please report any issues on the [Discord](https://discord.gg/wooting)!

**Linux is supported, but may be unstable with Wayland. Different DEs and distributions may result in various bugs - please report them. Some input latency may be introduced on Linux due to the scheduler. You can increase the niceness of the process manually to eliminate it.

## About this fork

This is a community-maintained fork of [WootingKb/wooting-macros](https://github.com/WootingKb/wooting-macros), whose last release dates from February 2024. It adds the On Hold and Toggle macro types, the hold threshold, the self-trigger filter and application-scoped collections. Later phases are planned to triage the upstream backlog (more system actions, mouse movement recording, macro chaining, repeat counts) and to move to Tauri 2.

Explicitly out of scope:

- **On-board (firmware) macros.** Wootility and the keyboard firmware are closed source; no software project can store macros on the keyboard.
- **Profile switching.** Wootility already switches keyboard profiles per application through its background service; this app does not duplicate it.
- **Anti-cheat evasion.** The app injects input through a low-level hook, which anti-cheat software can detect. That risk is documented below and not engineered around.

## Warnings

**Please do be aware that this application does grab and analyze keystrokes. While you are able to disable this temporarily using an appropriate function, you should still not have this application running alongside games (use at your own risk!). Macros (depending on how you configure them) are considered cheating.**

## Installing the App

Download the [Latest Release here](https://github.com/WootingKb/wooting-macros/releases/latest)

For MS Windows, download the MSI and then run it to install the application.

For Linux, download the AppImage or .deb and install the application. You might also need to add yourself to the ``input`` group.

## Contributing

Interested in contributing? We have some [contributing guidelines](./CONTRIBUTING.md) to help you out.

## Screenshots

<p align="center">
  <img width="33%" alt="Initial view of the application" src=".github/assets/1.png">
  <img width="33%" alt="View of creating a macro" src=".github/assets/2.png">
  <img width="33%" alt="An example macro that opens up several applications and a website" src=".github/assets/5.png">
</p>

## License

This project is licensed under the GNU GENERAL PUBLIC LICENSE Version 3 - see the [LICENSE](LICENSE) file for details.
