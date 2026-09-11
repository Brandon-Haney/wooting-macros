# On-board macros (firmware patch) — working doc

**Status: milestone 2 in progress.** Dispatcher + handler table and the internal flash write API are
done and verified; the keyboard report buffer (macro injection point) is the remaining M2 item. Last
updated 2026-09-11 (session 2).

This is the living project doc for putting a macro engine on the keyboard itself. It is written to be
picked up and put down across sessions: read the Status, the Landmarks table, and Next steps, and you
know exactly where things stand. Companion references: [WOOTING_HID_PROTOCOL.md](WOOTING_HID_PROTOCOL.md)
(runtime config protocol) and [FIRMWARE_NOTES.md](FIRMWARE_NOTES.md) (firmware image, bootloader,
update path, cross-model comparison).

## Goal and why

Store macros on the keyboard and have its own firmware play them, so the keystrokes originate from the
keyboard's USB stack, not from host software. The driving constraint: a locked-down work PC that
forbids installing software but allows connecting personal keyboards. Host-side execution (Wootomation)
cannot help there. Only on-board macros do.

Wooting will not add this themselves (leadership has repeatedly declined), so the route is a custom
firmware patch. Two deliverables:

1. A patched firmware for the 60HE+ that stores a macro table and plays it through the existing report path.
2. A home-PC programmer (reusing Wootomation's editor and data model) that writes macros to the keyboard.

## Approach: patch the stock firmware, do not replace it

Reverse the stock 2.14.1 image and graft in a macro layer, keeping Wooting's analog stack, USB, matrix,
and flash storage intact by reusing them. Rejected alternative: custom firmware from scratch, which
means reimplementing the Hall-effect rapid-trigger engine, months of work for no gain. See
[FIRMWARE_NOTES.md](FIRMWARE_NOTES.md) "What on-board macros would actually require" for the full
comparison. Route A1 (ask Wooting) is closed.

## Target hardware (confirmed)

STM32F103xG-class **XL-density**, Cortex-M3. Confirmed three ways: the F1 register map (GPIO on APB2),
96 KB SRAM from the stack pointer, and the flash routine driving **two flash banks** (second-bank
registers at offset +0x40, e.g. KEYR2 at 0x44, CR2 at 0x50), which only the XL-density F103 has. A
GD32/APM32 clone is possible and register-compatible; it does not change the work.

| | |
| --- | --- |
| Flash | 1 MB (`0x08000000`..`0x08100000`), dual bank |
| Bootloader | 28 KB (`0x08000000`..`0x08007000`), separate, recoverable via Wooting restore |
| App | `0x08007000`..`0x0807D264` (~472 KB) |
| Free internal flash | ~523 KB |
| SRAM | 96 KB (`0x20000000`..`0x20018000`) |
| External flash | Winbond SPI NOR (MB-class), holds profiles; firmware already writes it |

Code space is a non-issue. Macro data goes on the external Winbond flash. The 60HE ARM and Two HE ARM
share this exact chip, so a working patch covers all three (see the cross-model table in FIRMWARE_NOTES).

## Planned patch architecture

1. **Macro storage:** a macro table in a reserved region of the external Winbond flash (or an unused
   slice of profile storage), written via the firmware's own flash routines. No new flash driver needed.
2. **A new config command** on the 0xFF55 interface (magic `D1DA`) to write and read the macro table, so
   the home-PC programmer speaks the same protocol as everything else.
3. **A small interpreter** hooked into the input pipeline: on a configured trigger (a key index, or a
   spare remapped usage), walk the macro table and emit key-down/up events with delays through the
   firmware's existing HID keyboard report path. Output is therefore hardware-origin.
4. **Trigger:** reuse the remap/Advanced-Key hook point if possible, so a normal keypress still behaves
   normally and only the configured macro key diverts into the interpreter.

The two functions that make or break this are the **HID keyboard report submit** (where pressed keys are
written to the USB IN endpoint) and the **flash read/write API**. Both are being located in milestone 2.

## Reverse-engineering environment (how to resume)

Working files live in `firmware-re/` at the repo root. **It is gitignored** (firmware is Wooting's
copyright; the radare2 binary is large). If the folder is missing (fresh clone, or scratchpad was
cleared), recreate it:

```bash
mkdir -p firmware-re && cd firmware-re
# 1. Firmware image (Intel HEX), from Wootility's own server:
curl -s https://wootility.io/fw/wooting_60he_plus.fwr -o wooting_60he_plus.fwr
# 2. Convert HEX -> flat binary (load base 0x08007000). hex2bin.js is below in this doc.
node hex2bin.js wooting_60he_plus.fwr wooting_60he_plus.bin
# 3. radare2 (Windows static blob):
curl -sL "$(curl -s https://api.github.com/repos/radareorg/radare2/releases/latest \
  | grep -o 'https://[^\"]*w64\.zip' | head -1)" -o r2.zip && unzip -o r2.zip
# (yields r2blob.static.exe; it dispatches as r2)
```

Load and analyze (the `analyze.r2` script sets arch/base, analyzes, and defines the landmark flags):

```bash
./r2blob.static.exe -a arm -b 16 -m 0x08007000 -i analyze.r2 wooting_60he_plus.bin
```

Auto-analysis takes under a second and finds 422 functions. Key r2 idioms used:
`axt <addr>` (who references an address), `/v4 <u32>` (find a 32-bit literal, e.g. a pointer or a
register address), `pdf @ <fn>` (disassemble a function), `f~<substr>` (list landmark flags).

`hex2bin.js` (Intel HEX to flat image, honoring extended-linear-address records):

```js
const fs=require('fs');const t=fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/);
let base=0,min=Infinity,max=0;const ch=[];
for(const l of t){if(l[0]!==':')continue;const n=parseInt(l.substr(1,2),16),a=parseInt(l.substr(3,4),16),
ty=parseInt(l.substr(7,2),16),d=Buffer.from(l.substr(9,n*2),'hex');
if(ty===0){const ad=base+a;ch.push([ad,d]);min=Math.min(min,ad);max=Math.max(max,ad+n);}
else if(ty===4)base=parseInt(l.substr(9,4),16)<<16;else if(ty===2)base=parseInt(l.substr(9,4),16)<<4;}
const o=Buffer.alloc(max-min,0xff);for(const[a,d]of ch)d.copy(o,a-min);
fs.writeFileSync(process.argv[3],o);console.log('base 0x'+min.toString(16),'size',o.length);
```

## Landmarks found (session 1)

All addresses are virtual (app base `0x08007000`). Flags are set by `analyze.r2`.

All flags are set by `analyze.r2`. Grouped by subsystem.

| Flag | Address | What it is |
| --- | --- | --- |
| (vectors) | `0x08007000` | SP `0x20018000`, reset `0x08022F99`; USB ISR at IRQ 19/20 -> `usb_isr_thunk` |
| `desc_keyboard` / `desc_keyboard2` | `0x08029FB0` / `0x08029FEC` | HID report descriptors, boot keyboard + NKRO |
| `desc_vendorcfg` | `0x0807BD50` | HID descriptor, vendor `0xFF55` config collection |
| `usb_isr_thunk` | `0x0801AE28` | USB ISR, `b usb_core` |
| `usb_core` | `0x0801A8C8` | USB core interrupt handler |
| `usb_ep_fifo` | `0x08017ABC` | generic endpoint FIFO enqueue |
| `cmd_dispatcher` | `0x080095D8` | command dispatcher: cmd byte -> handler table -> handler; writes `0xDAD1` |
| `cmd_processor` | `0x08021DF4` | hub calling the dispatcher and flash save |
| `cmd_handler_tbl` | `0x08029AA0` | handler pointer table, `[base + cmd*4]` |
| `cmd_stub` | `0x08007A41` | default handler for unimplemented commands |
| `h_cmd01_version` | `0x08007A60` | getVersion handler (verifies the response ABI) |
| `h_cmd42_savekb` | `0x080087F8` | saveKeyboardProfile -> `storage_writer` |
| `flash_prog_hw` | `0x08020BDC` | program_halfword(addr,u16), dual-bank |
| `flash_erase_pg` | `0x08020C44` | erase_page(addr), dual-bank |
| `flash_wait_b1` / `flash_wait_b2` | `0x0801D348` / `0x0801D314` | wait BSY, bank1 / bank2 |
| `flash_save_cfg` | `0x0800C67C` | high-level save to internal config region |
| `flash_cfg_region` | `0x080FD000` | internal-flash config region (~12 KB to `0x08100000`) |
| `storage_writer` | `0x08020B14` | profile storage writer |

## Milestones

- [x] **M1 — Identify the MCU and confirm free flash.** Done: F103xG XL-density, 1 MB, ~523 KB free.
- [~] **M2 — Locate the pivot routines.** In progress.
  - [x] Flash write/erase family located (`fn_flash_unlock` + sites B/C).
  - [x] USB descriptor handler located (`fn_usb_desc`).
  - [x] **Internal flash read/write API fully characterized** (see below). This is a callable interface
    for writing a macro table to internal flash; the external SPI flash is now optional.
  - [x] USB stack entry mapped: ISR thunk `0x0801AE28`/`0x0801AE2C` -> core handler `fcn.0801A8C8` ->
    endpoint helper `fcn.08017ABC`. USB peripheral at `0x40005C00`.
  - [x] **Config-command dispatcher and handler table found and verified** (see below). This is where a
    new "write macro table" command hooks in.
  - [ ] HID **keyboard report submit** / the keyboard report buffer (the macro injection point). USB stack
    is mapped (`usb_core`, `usb_ep_fifo`); the report buffer and matrix-scan write are the remaining lead.

### Config command protocol (confirmed, verified)

`cmd_dispatcher` = `fcn.080095D8`. It receives a request (`r0`: `[r0]` = command byte, `[r0+4]` = param),
indexes a **handler pointer table `cmd_handler_tbl` at `0x08029AA0`** by `[base + cmd*4]`, and calls the
handler as `handler(r0 = param, r1 = response buffer)`. Called via `cmd_processor` (`fcn.08021DF4`).

Response buffer ABI (verified against `getVersion`, cmd 1, `h_cmd01_version` `0x08007A60`):

| Offset | Field |
| --- | --- |
| `[0..1]` | magic `0xDAD1` (written by the dispatcher) |
| `[2]` | command byte echo |
| `[3]` | status, `0x88` = OK |
| `[4..5]` | body length, u16 LE |
| `[6..]` | body |

The handler table spans commands 0..~87. Unimplemented commands point to the stub `cmd_stub`
(`0x08007A41`); commands 4, 5, 6, 9, 10 are empty (`0x00000000`). Verified handler examples:
cmd 1 getVersion `0x08007A60` (writes `02 0E 01`), cmd 42 saveKeyboardProfile `0x080087F8` (-> storage
writer `fcn.08020B14`). **To add a macro command:** point an unused table slot (a `cmd_stub` entry, or a
new index) at a new handler placed in free flash; the handler writes the macro table via the flash API
above and returns a `0x88` response. The table lives in flash at `0x08029AA0`, inside the app image, so
it is patched when the image is reflashed.

### Internal flash write API (confirmed, verified)

The firmware programs an internal-flash **config region at `0x080FD000`** (about 12 KB up to the
`0x08100000` flash top) via the dual-bank controller at `0x40022000`. The primitives are reusable:

| Routine | Signature | Notes |
| --- | --- | --- |
| `fcn.08020BDC` | program_halfword(r0=flash addr, r1=u16) | Reads FLASH_SIZE reg `0x1FFFF7E0`, picks bank: bank1 CR `+0x10`, bank2 CR2 `+0x50`; sets PG, stores halfword, waits BSY, clears PG. Boundary `0x08080000` (u16 addr limit const `0x0807FFFF`). |
| `fcn.08020C44` | erase_page(r0=page addr) | Page erase (PER), same bank logic. F103 XL-density page size is 2 KB. |
| `fcn.0801D348` / `fcn.0801D314` | wait_bsy bank1 / bank2 | Poll SR/SR2 BSY. |
| unlock | write `0x45670123` then `0xCDEF89AB` to KEYR (`+0x04`, bank1) / KEYR2 (`+0x44`, bank2) | In `fcn.0800C67C`. |
| `fcn.0800C67C` | high-level "save config to `0x080FD000`" | unlock, clear SR error flags, erase, program-halfword loop. Callers: `fcn.0800C774`, `fcn.08021DF4`. |

**Free internal flash for our use:** the app ends at `0x0807D264` and this config region starts at
`0x080FD000`, leaving ~508 KB of contiguous free flash (`0x0807E000`..`0x080FD000`, 2 KB-page aligned)
for the macro table and the interpreter. No external SPI flash needed. `fcn.08020BDC` /
`fcn.08020C44` write it; the unlock sequence is in `fcn.0800C67C`.

- [ ] **M3 — Design the patch.** Macro table format, storage location, trigger hook, interpreter, new command.
- [ ] **M4 — Home-PC programmer.** Extend Wootomation to write the macro table over `D1DA`.
- [ ] **M5 — Build, flash, test.** Toolchain for the patched image; flash via the bootloader; verify on the work PC.

## Next steps (start here next session)

The two critical pivots (dispatcher, flash API) are done. Remaining, in order:

1. **Keyboard report buffer / injection point (item 1 + item 5).** Find the RAM buffer holding the
   current keyboard HID report and where the matrix scan / remap layer writes keycodes into it. That is
   where the interpreter injects synthetic key events so they go out through the stock report path
   (hardware-origin). Leads: the keyboard IN endpoint config, callers of `usb_ep_fifo` that pass the
   keyboard endpoint, and the struct at `0x20000ACC` seen in `h_cmd42_savekb`. Cross-ref `desc_keyboard`.
2. **External SPI flash driver (item 4) — now optional.** Only if we prefer external storage over the
   ~508 KB free internal flash. Lead: `fcn.080186B8` (page/wrap copy logic) and the SPI peripheral.
3. **Trigger identity (item 5).** How a key is identified (matrix index vs HID usage) at the injection
   point, so a macro can be bound to a specific key. Falls out of step 1.
4. **Hook mechanism (item 6).** Pick the free-flash address for the interpreter blob and the single
   call/branch to redirect. Then move to M3 (design) and M4 (home-PC programmer over the new command).

## Open questions

- Is the trigger better hooked at the remap/AKC layer (so it composes with existing features) or at the
  raw scan layer? Decide after M2 reveals the input pipeline.
- Macro table on external Winbond flash vs a spare internal-flash page. External has room and existing
  write routines; internal is simpler to address. Decide in M3.
- What toolchain rebuilds a flashable image? Options: assemble the patch as a separate blob placed in
  free flash and redirect a hook (no full rebuild needed), or a full relink (needs the source, which we
  do not have). The hook-and-blob approach is expected. Confirm in M3.

## Risks and recovery

- **Bricking:** low and recoverable. The 28 KB bootloader is never written by the app-flash path, and
  Wooting's restore (Backspace+Fn at plug-in enumerates a "Wooting Restore" device, then Wootility
  reflashes stock) recovers a bad app image. Never erase the bootloader region.
- **Firmware updates overwrite the patch.** Acceptable for a personal build; re-apply after any Wootility
  update. Pin the firmware version we patched (2.14.1).
- **Anti-cheat / genuineness:** the patch does not touch the certificate machinery (device-to-app auth),
  and output through the stock report path is indistinguishable from normal keyboard input.

## Session log

- **2026-09-11 (session 1).** Confirmed the chip (F103xG XL-density) from the image. Set up the RE
  environment: radare2 6.2.2 static blob in `firmware-re/` (gitignored), `analyze.r2` reproducible
  script, `hex2bin.js`. Auto-analysis finds 422 functions. Located: USB HID descriptors (keyboard,
  vendor config), the USB descriptor handler, the flash unlock/program routine (dual-bank, which
  confirmed XL-density), the flash-controller touch sites, and the nine `D1DA` code sites.
- **2026-09-11 (session 2).** Two of the three M2 pivots done and verified.
  - **Internal flash write API** fully characterized: `flash_prog_hw` (program halfword, dual-bank,
    reads FLASH_SIZE `0x1FFFF7E0`), `flash_erase_pg`, wait-BSY helpers, unlock sequence. ~508 KB of free
    internal flash between the app end and the config region, so storage can be internal; external SPI is
    optional. Reconfirmed XL-density via the runtime flash-size check.
  - **Command dispatcher and handler table** found and verified: `cmd_dispatcher` `0x080095D8`,
    `cmd_handler_tbl` `0x08029AA0` (`[base + cmd*4]`), response ABI confirmed against getVersion
    (`02 0E 01`, status `0x88`). Adding a macro command = point an unused table slot at a new handler.
    Verified profile-save path (cmd 42 -> `storage_writer`).
  - USB stack mapped (ISR thunk -> `usb_core` -> `usb_ep_fifo`). Remaining M2 item: the keyboard report
    buffer / injection point. Updated `analyze.r2` (19 landmark flags) and this doc.
