# Wooting firmware and update path

Findings from the Wootility 5.4.2 bundle and the live firmware image for the Wooting 60HE+,
gathered 2026-09-10. Companion to [WOOTING_HID_PROTOCOL.md](WOOTING_HID_PROTOCOL.md), which covers
the runtime configuration protocol. This file covers the firmware image, the bootloader, and how
Wootility fetches and flashes firmware. It exists to answer one question: can we put an on-board
macro engine on the keyboard, and what would that take.

## Short answer

- The firmware is closed, monolithic, STM32-class ARM, built with GCC, and essentially full. There
  is no source, no firmware SDK, and no on-device app loader. A macro engine cannot be "installed";
  it has to be compiled into a firmware image and flashed whole.
- The two public Wooting SDKs (analog, RGB) are host-side libraries that talk to the existing
  firmware over HID. Neither is firmware source.
- The bootloader flashes plain Intel-HEX images and appears to verify only a CRC, not a signature,
  so the keyboard will accept a custom-built image. The certificate machinery in Wootility
  authenticates the keyboard to the app (genuineness), not the app to the keyboard.
- So there are two real routes to on-board macros: get Wooting to add a macro primitive to their
  firmware (they already ship Mod Tap, DKS, SOCD, Rappy Snappy as firmware features), or build
  custom firmware from scratch for the board, which is a large embedded reverse-engineering project
  and forfeits Wooting's analog stack unless reimplemented.

## The firmware image

Fetched from Wootility's own update path (see below). Delivered as Intel HEX (`.fwr`).

| | |
| --- | --- |
| MCU | STM32F103xG-class (Cortex-M3), or a register-compatible clone such as GD32F103 / APM32F103 |
| Internal flash | 1 MB (`0x08000000`..`0x08100000`); the 1 MB top is referenced in code |
| SRAM | 96 KB (initial SP `0x20018000`), the high-density F103 size |
| Load base | `0x08007000`, so the bootloader occupies `0x08000000`..`0x08007000` (28 KB) |
| App region | `0x08007000`..`0x0807D264`, 483,940 bytes (about 472 KB), nearly all non-`0xFF` |
| Free internal flash | about 523 KB (`0x0807D264`..`0x08100000`) |
| Reset vector | `0x08022F99`; roughly 60 external interrupt vectors |
| Toolchain | GCC 10, newlib (build-path strings from a 2021 Jenkins pipeline) |
| RTOS / USB stack | No identifying strings; stripped, bare-metal or a minimal kernel |

How the MCU was identified from the image alone (no photo, no memory-read command, which the
protocol does not have): GPIO accesses cluster on APB2 at `0x40010800`..`0x40011C00` (13 hits), the
STM32F1 layout, versus only 2 stray hits at the `0x48000000` AHB range that F0/F3/L4 use. The flash
controller is at `0x40022000`, RCC at `0x40021000`, and USB is the full-speed device peripheral at
`0x40005C00`, all F1-family. The 96 KB SRAM (from the initial stack pointer) and the referenced 1 MB
flash top (`0x08100000`) fix it as a high-density F103 (the "xG" 1 MB variant). The F1 unique-ID
address `0x1FFFF7E8` also appears. The exact silicon vendor (genuine ST vs a GD32/APM32 clone,
which keyboards of this era commonly use) is not confirmed and does not change the plan, since the
clones copy the F1 register map.

**Flash budget for a patch:** 1 MB total, 28 KB bootloader plus 472 KB app used, leaving about
523 KB of free internal flash. A macro interpreter is a few KB, so code space is a non-issue. Macro
*data* still belongs on the external Winbond flash (megabytes, and the firmware already writes it),
but even internal flash has ample room if convenient.

The only human strings in the image are profile names ("Rapid Profile", "Typing Profile"),
"Wooting 60HE+", "XUSB10", and newlib assert plumbing. No symbol names, no macro/profile schema
strings. Extending it by patching would mean disassembling ~483 KB of stripped Cortex-M, and the
image is full, so there is little room to graft code without moving things.

The exact STM32 part is not confirmed. A teardown photo of the board's main IC would settle it and
is the first thing to get before any custom-firmware work. Note the legacy code path computes an
"XMEGA CRC32": the older Atmel-based Wooting boards (Wooting One/Two) use Atmel XMEGA; the ARM
boards (60HE+, 60HE ARM, 80HE) use STM32. The name carried over.

## Cross-model comparison (all at firmware 2.14.1)

Downloaded every model's current firmware from `/fw/<idstring>.fwr` and fingerprinted the memory map
(stack pointer for SRAM size, load base for bootloader size, GPIO bus and peripheral addresses for
the STM32 family, and the referenced flash top). Firmware is per-model but the version is unified at
2.14.1 across the line. Three ARM chip generations, plus the legacy AVR boards.

| Group | Models | MCU class | SRAM | Flash | Bootloader | App end | Free flash |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 60HE+, 60HE ARM, Two HE ARM | STM32F103xG-class, Cortex-M3, F1 map (GPIO on APB2), USB FS device | 96 KB | 1 MB | 28 KB | ~472-474 KB | ~521-523 KB |
| A? | UwU, UwU RGB | 96 KB / 1 MB, USB FS device present, small app; likely the same F103 class (GPIO heuristic ambiguous on a numpad) | 96 KB | 1 MB | 28 KB | ~290-341 KB | ~683-713 KB |
| B | 80HE | Distinct: 192 KB SRAM, GPIO on AHB, 32 KB bootloader, no F1/USB-FS signatures | 192 KB | 1 MB+ | 32 KB | ~518 KB | ~506 KB |
| C | 60HE v2, 80HE+ | Large modern MCU (STM32H5/H7 class), 768 KB SRAM, 96 KB bootloader, GPIO on AHB | 768 KB | 1 MB+ (possibly 2 MB) | 96 KB | ~570-582 KB | ~410-421 KB (undercount if 2 MB) |
| AVR | One, Two, Two HE, Lekker, 60HE (AVR) | Atmel XMEGA (chipType "AVR"), 128 KB image, not STM32 | | | | | |

Takeaways for the macro patch:

- The 60HE+ shares its exact silicon with the **60HE ARM** and the **Two HE ARM** (Group A, identical
  fingerprint: 96 KB SRAM, F1 map, 28 KB bootloader, 1 MB flash). A patch built on the 60HE+ ports to
  those two with little change. The UwU is probably the same class.
- The current **60HE v2** and the **80HE+** moved to a much larger MCU (768 KB SRAM, Group C). A patch
  for Group A does not carry over; it would need re-porting to that family. Notably, the newest 60HE
  hardware has far more headroom than the 60HE+, which underlines that on-board macros are a policy
  choice at Wooting, not a silicon limit.
- The **80HE** (Group B) is a third distinct ARM part again.
- The **AVR** boards are a different architecture entirely and out of scope for this work.

Every ARM model has hundreds of KB of free internal flash, so code space is never the constraint on
any of them.

## How Wootility fetches firmware

Base URL is the app origin (`https://wootility.io`), path `/api/fw/<endpoint>`, channel from the
hostname (`wootility.io` = stable, `beta.wootility.io` = beta, alpha internal).

| Endpoint | Query | Returns |
| --- | --- | --- |
| `get_update_info` | `wversion, fversion, device, update_channel` | JSON: latest version, updateRequired, title, HTML changelog |
| `get_update_data` | `device, wversion, fversion, update_channel` | the firmware, as Intel HEX text |
| `get_available_test_builds` | `wversion, device` | list of `{version, title}` test builds |

`device` is the numeric device enum, not the string id. For the 60HE+ that is `9`
(`get_update_data?device=9&...` returned a 1.42 MB HEX; the string `WOOTING_60HE_PLUS` returns 500).
Device enum: 0 One, 1 Two, 2 Lekker, 3 TwoHE, 4 60HE, 5 60HE_ARM, 6 TwoHE_ARM, 7 UwU non-RGB,
8 UwU RGB, 9 60HE+, 10 80HE, 11 60HE v2, 12 80HE+.

There is a local fallback served from the app itself when the API fails:
`/fw/wooting_60he_plus.fwr` (the HEX) and `/fw/wooting_60he_plus.json` (`{version, title, description}`).
Current stable is 2.14.1 ("Bugfixes"). Test builds seen include a Tap-Hold-for-Mod-Tap prototype
and KVM-support builds, which shows how Wooting ships firmware features incrementally.

Observed:

```
get_update_info?wversion=5.4.2&fversion=2.14.1&device=WOOTING_60HE_PLUS&update_channel=stable
  -> {"result":{"latestFirmwareVersion":"2.14.1","updateRequired":false,"title":"Bugfixes", ...}}
get_update_data?device=9&wversion=5.4.2&fversion=2.14.1&update_channel=stable
  -> Intel HEX, 1,421,748 bytes
/fw/wooting_60he_plus.fwr -> Intel HEX, 1,361,221 bytes (base 0x0800, load 0x08007000)
```

## Live device probe (read-only config commands, 2026-09-11)

Issued the safe read commands over WebHID directly (no writes, no reset). Results decoded:

| Command | Response | Meaning |
| --- | --- | --- |
| getVersion (1) | `02 0e 01` | firmware 2.14.1, matches the image we pulled |
| getSerial (3,1) | `bd 7c 30 02 18 73 b4 07` + `37 30 32 35` | serial, ends ASCII "7025" |
| getMcuSerial (3,2) | `08 02 10 18 18 26 20 05 28 01 30 ae 89 02 ...` | structured hardware info, not a raw UID |
| getFlashIDs (3,3) | `ef 16 15 c7 4f 2c 32 df 63 a4` | external SPI flash: `0xEF` = Winbond JEDEC id |
| getDeviceConfig (19) | `00 00 00 00 11 00 0c` | |
| isFlashChipConnected (56) | `01` | an external flash chip is present |
| getProfileCount (62) | `04` | |
| getGlobalSettings (51) | `0a 04 08 05 10 0a 10 00` | |

The keyboard has a **separate Winbond SPI NOR flash chip** (manufacturer `0xEF`), confirmed present.
This is where profiles are stored and it is megabyte-class (Winbond W25Q parts are 2 to 16 MB). So
macro *data* has abundant room there, wholly separate from the MCU's internal flash, and the firmware
already contains routines to read and write it (`getFlashIDs`, `getProfileSaveTracker`, the profile
save path). That essentially solves the macro-storage question.

What no ordinary command exposes is the **MCU internal flash size** (the register at a family-specific
`0x1FFF...` address, or `DBGMCU_IDCODE` at `0xE0042000`). There is no read-arbitrary-memory command in
the runtime protocol. So the one remaining number, how much MCU flash is free for the interpreter
*code* (a few KB), still comes from one of: a memory-read primitive found during disassembly (candidates:
`wootDevRawReport`), the bootloader's own commands (entered via the Backspace+Fn restore combo, which
enumerates as a "Wooting Restore" USB device), or a teardown photo of the main IC.

## The bootloader (ARM path)

A separate USB device, its own magic word (`0xDB9F`), reached by resetting the running firmware
into it (config command 2, `resetToBootloader`). Wootility's flashing sequence:

1. `resetToBootloader`, wait for the device to re-enumerate as the bootloader (different id).
2. Read bootloader details: version, serial, restore flags.
3. Download and parse the firmware HEX into a byte image (`parseFirmwareImage`).
4. `unlockAndErase`: bootloader command 6 with a fixed unlock constant.
5. Upload: command 2 sets the page count (`image length / 256`), then for each 256-byte page,
   `writeRaw` the page and command 3 to commit it, reporting progress.
6. `crcCheck`: read the app CRC (command 4) and compare to a CRC-32 computed over the image.
   Mismatch aborts.
7. `resetFlash` if requested, then reboot into the new app (command 5).

The integrity check is a CRC, not a signature. Nothing in the flash path verifies an author
signature over the image, so a correctly formatted custom image is accepted. This is not proof the
bootloader has no signature check (that needs the bootloader disassembled), but the app-side flow
has none, and the on-device check it performs is a CRC. A bad flash is recoverable: the bootloader
persists (separate 28 KB region) and Wootility has a restore path, so bricking is unlikely as long
as the bootloader is not erased.

## Genuineness certificates (not image signing)

The app carries a baked-in root CA certificate ("wootingkb"). It reads an intermediate and a
per-device certificate from the keyboard (config command 79, `getIntermediateCert` /
`getDeviceCert`), checks the chain to the root, and runs a challenge/response (command 80, report
38, `executeChallenge`) where the device signs a random nonce. The device certificate's common name
encodes the serials and layout. This proves the keyboard is genuine Wooting hardware to the app. It
is unrelated to firmware signing and does not gate flashing; at most it could gate cloud firmware
download server-side.

## What "on-board macros" would actually require

Wooting's on-board features today are remaps plus five Advanced Key types (DKS, Mod Tap, Toggle Key,
Rappy Snappy, SOCD). None expresses a timed key sequence. Adding one means new firmware.

**Route A1, collaborate with Wooting (recommended for supported, signed on-board macros).**
They own the source, the analog calibration, the USB stack, and the update/signing infrastructure.
A macro/sequence primitive stored in a profile is the same shape as their existing Advanced Keys.
The realistic asks: a `Macro` AKC item type (sequence of key events with delays), or a small
sequence engine. This is the only route that yields on-board macros that stay updatable and genuine.
Action: open a feature request / dev conversation, referencing that the profile schema already has
the `AKCItem` oneof to extend.

**Route A2a, custom firmware from scratch (R&D, high effort, not recommended).**
Feasible in principle because the bootloader flashes unsigned images, but it means writing STM32
firmware for this board from scratch: identify the MCU and the analog front end (the Hall-effect
sensor matrix and ADC/mux), bring up USB HID, the key matrix, and NKRO, then add the macro engine.
The hard part is not the macro engine; it is reproducing the analog rapid-trigger stack that is the
whole point of the keyboard. QMK/Vial do not support Hall-effect analog out of the box. Multi-month,
and you throw away everything Wooting built.

**Route A2b, patch the stock firmware to add a macro engine (the pragmatic on-board route).**
Instead of replacing the firmware, disassemble the stock image and graft a small macro layer into
it. This keeps the entire analog stack, USB, matrix, and profile storage intact, because we reuse
them. The plan:

1. Identify the MCU (teardown photo of the main IC, or dump and inspect the 28 KB bootloader) so we
   know the exact part, total flash size, and where free flash is. The app image alone does not
   reveal flash size; the app ends at `0x0807D264` with no padding, so headroom depends on the part.
2. Load the image in Ghidra (base `0x08007000`, Cortex-M, little endian, VTOR at the image start).
   Find two things: where the firmware assembles and submits the USB HID keyboard report, and where
   it reads and writes profiles in flash.
3. Add a macro table to flash (a new region, or piggybacked on unused profile space) and a tiny
   interpreter: on a configured trigger, walk the table emitting key-down/up events with delays
   through the firmware's own report path. Because the report is generated by the keyboard's USB
   stack, the output is hardware-origin, which is the whole point.
4. Add one HID command on the config interface to write the macro table, so the enhanced Wootility
   programs macros the same way it writes any profile.

Effort is weeks of reverse engineering, concentrated on step 2. Success is likely but not
guaranteed; the two-milestone spike below de-risks it before any large commitment. Bricking is
recoverable via Wooting's restore (the bootloader is untouched). A stock firmware update from
Wooting would overwrite the patch and require re-applying, which is acceptable for a personal build.

**Spike, before committing to A2b:**
- Milestone 1: identify the MCU and confirm free flash. DONE from the image (2026-09-11): F103xG-class,
  1 MB flash, about 523 KB free. Code space is not a constraint. A photo would only confirm the vendor.
- Milestone 2: in Ghidra, locate the HID report submit point and the flash profile read/write. If
  both are found and understood, injection is viable and the rest is implementation.

## Use case driving this

The target is a locked-down work PC that forbids installing software but allows connecting personal
keyboards. Host-side macro execution (Wootomation) is useless there. Only macros stored on the
keyboard and played by its own firmware work. That makes A2b the actual goal, not a nice-to-have,
and it makes host execution a home-PC-only convenience. Route A1 (asking Wooting) is ruled out:
Wooting leadership has repeatedly declined on-board macros.

**Route B, author now, execute on the host (shippable today).**
Wootomation already runs macros on the host. An enhanced configurator (see the protocol doc) can
author macros and write everything the firmware does support. Macro *output* stays host-injected
until Route A lands. This is the pragmatic bridge and it makes the eventual on-board migration a
back-end swap, not a UI rewrite.

## Reproducing this

```
# update metadata
curl "https://wootility.io/api/fw/get_update_info?wversion=5.4.2&fversion=2.14.1&device=WOOTING_60HE_PLUS&update_channel=stable"
# the firmware image (device 9 = 60HE+), or the local fallback
curl "https://wootility.io/api/fw/get_update_data?device=9&wversion=5.4.2&fversion=2.14.1&update_channel=stable" -o fw.fwr
curl "https://wootility.io/fw/wooting_60he_plus.fwr" -o fw.fwr
```

`.fwr` is Intel HEX. Convert to a flat image (extended-linear-address `0x0800`, load base
`0x08007000`) and read the vector table: word 0 is the initial stack pointer, word 1 the reset
handler. The bootloader/upload/CRC logic is in the Wootility bundle; grep the deobfuscated file for
`uploadFirmware`, `unlockAndErase`, `crcCheck`, and `parseFirmwareImage`.
