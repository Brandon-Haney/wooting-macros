# Wooting HID configuration protocol

What Wootility 5.4.2 says to a Wooting 60HE+ over WebHID, captured on 2026-09-10 and cross-checked
against the deobfuscated Wootility bundle (`assets/index-BaoALhfv.js`, run through `webcrack`).
Brandon owns the hardware; this is interoperability work for a local companion to Wootomation.

The headline for the macro roadmap: **the firmware has no macro primitive**. The profile schema
(156 protobuf message types) has no macro, sequence, or delay message, and the 4.6 MB bundle does not
contain the string "macro" once. On-board behaviours are exactly the Advanced Key types listed below.

## Device

| | |
| --- | --- |
| Vendor / product | `0x31E3` / `0x1322`, "Wooting 60HE+" |
| Firmware (cmd 1 body) | `02 0e 01`, three bytes, read as 2.14.1 |
| Protocol revision | 3 ("Multi interface"); revisions 0 to 2 are the legacy 128-byte report protocol |

HID interfaces the keyboard exposes (usage page / usage):

| Usage page | Reports | Role |
| --- | --- | --- |
| `0xFF55` / 1 | feature 1, input 1 to 6, output 1 to 6 | configuration ("Multi interface", everything below) |
| `0xFF53` / 1 | input 0 | analog stream, pushed continuously once opened (about 40 reports/s idle) |
| `0xFF00` / 1 | input 0 | legacy analog/raw interface |
| `0x0C` / 1 | input 2 | consumer control (media keys) |
| `0x01` / 6, `0x01` / 2, `0x01` / 0x80 | | keyboard, mouse, system control (standard HID) |

Wootility asks for `{vendorId: 0x31E3, usagePage: 0xFF55}` (plus the analog page) in `requestDevice`.

## Framing (revision 3)

Every packet starts with the magic word `0xD1DA`, big endian. Bodies are protobuf (`protobuf-ts`),
package `profiles`; field layouts are in the schema section.

**Command** (host to device): feature report ID 1, 7 bytes.

```
D1 DA <cmd u8> <param u32 little endian>
```

Profile-scoped commands pack the parameter as `profileId | param1 << 16 | param2 << 24` where
`profileId = namespace << 8 | index` (namespace 0 = onboard, 1 = linked; `0xFFFF` = none/current).
`getKeymapLayer(profile, layer)` therefore sends `index` in byte 0 and `layer` in byte 2.

**Response** (device to host): input report whose ID is the size class of the payload
(1: 32 B, 2: 62 B, 3: 254 B, 4: 510 B, 5: 1022 B, 6: 2046 B).

```
D1 DA <cmd u8> <status u8> <len u16 little endian> <body[len]> <stale bytes...>
```

`status` is `0x88` for success; anything else is raised as a device error with the body as detail.
Only `len` bytes of body are valid: the firmware reuses its transmit buffer, so a short reply
carries the tail of an earlier long one after `len`. The host matches replies by `cmd` and drops
responses for a different command.

**Data write** (host to device): output report, ID by the same size classes, no CRC on revision 3.

```
D1 DA <reportId u8> <body>
```

with `body` in one of four shapes:

| bodyType | Layout |
| --- | --- |
| raw | bytes |
| withLength | `len u16`, bytes |
| profile | `flags u8`, `len u16`, protobuf bytes |
| profileExtended | `flags u8`, `param1 u8`, `additional u16`, `len u16`, protobuf bytes |

`flags`: bit 0 = save to flash, bits 1 to 5 = profile index, bits 6 to 7 = namespace.

Legacy revisions use a fixed 128-byte report `D1 DA <id> <body...> <crc16>` with CRC-16/XMODEM
(polynomial `0x1021`, init 0) over the first 126 bytes, and one-byte lengths.

## Commands (feature report, read side)

Numbers are the `cmd` byte. Names are Wootility's method names.

| cmd | Name | cmd | Name |
| --- | --- | --- | --- |
| 0 | ping | 48 | getKeymapLayer(profile, layer) |
| 1 | getVersion | 49 | getActuationProfile(profile) |
| 2 | resetToBootloader | 50 | getRgbProfileCore(profile) |
| 3 | getSerial / getMcuSerial / getFlashIDs (param 1 / 2 / 3) | 51 | getGlobalSettings |
| 5 | getCurrentRgbProfileIndex | 52 | getAKCProfile(profile) |
| 7 | reloadProfile (legacy) | 53 | saveAKCProfile(profile) |
| 8 | saveRgbProfile | 54 | getRapidTriggerProfile(profile) |
| 11 | getCurrentKeyboardProfileIndex | 55 | getProfileMetadata(profile) |
| 19 | getDeviceConfig / getCalibrationStatus | 56 | getIsFlashChipConnected |
| 20 | getAnalogValues | 57 | getRgbLayer(profile, layer) |
| 21 | disableKeys | 59 | getRGBBins |
| 22 | enableKeys | 61 | getFullRapidTriggerProfile(profile) |
| 23 | activateProfile(profile) | 62 | getProfileCount |
| 24 | getDksItem | 63 | deleteProfile(profile) |
| 25 | doSoftReset | 64 | createProfile |
| 29 | refreshRgbColors | 66 | getLEDBarProfile(profile) |
| 32 | colorServiceReset | 67 | getGlobalLEDBarProfile |
| 33 | colorServiceInit | 68 | getLEDBarColors |
| 34 / 35 | start / stopXinputDetection | 70 / 71 | LED bar profile metadata |
| 38 | reloadProfile | 72 | getProfileSaveTracker(profile) |
| 39 | getKeyboardProfile(profile) | 73 | heartbeat (sent every second while open) |
| 40 | getGamepadMapping(profile) | 74 | getKeyboardColors |
| 41 | getGamepadProfile(profile) | 76 | eventSubscription |
| 42 | saveKeyboardProfile(profile) | 79 | getDeviceCert / getIntermediateCert |
| 43 | resetSettings | 80 | executeChallenge |
| 44 | setRawScanning | 81 | getHs |
| 45 / 46 | start / stopGamepadDetection | 82 | getSensorConfigProfile / default |
| | | 83 | getSupportedSwitches |
| | | 85 | getLinkedProfileId |
| | | 86 / 87 | getLinkedAppCount / getLinkedAppProfiles |

## Reports (output report, write side)

| id | Name | id | Name |
| --- | --- | --- | --- |
| 2, 3, 4 | setAnalogProfile main / curve parts (legacy) | 24 | setAKCProfile |
| 7 | saveDeviceConfig | 25 | setRapidTriggerProfile |
| 8 | saveDks (legacy) | 26 | saveProfileMetadata |
| 11 | wootDevRawReport | 27 | setRgbLayer |
| 12 | saveSerial | 28 | setRGBBin |
| 14, 15 | sendRgbProfileColors | 29 | setFullRapidTriggerProfile |
| 17 | sendKeyboardProfile | 30 | setRgbLedBar |
| 18 | sendGamepadMapping | 32 to 35 | LED bar profiles and metadata |
| 19 | sendGamepadProfile | 38 | executeChallenge |
| 20 | saveKeymapLayer | 39 | setHs |
| 21 | setActuationProfile | 40 | setSensorConfigProfile |
| 22 | sendRgbProfileCore | 43 | wiggleOverride |
| 23 | setGlobalSettings | 44 | setLinkedAppProfiles |

Writes go through a serial queue; each is a plain output report with the `profile` body and the
save bit set when the user presses "Save to Keyboard" (the same report without the save bit is the
live preview).

## Connect sequence observed

Wootility opens the config and analog interfaces, then reads in this order. The block marked `*`
repeats for profiles 1 to 3; profile 0 is not read during connect.

```
ping(0) -> ff
getSerial(3, 2) -> HardwareProperties          getDeviceConfig(19) -> 00 00 00 00 11 00 0c
getVersion(1) -> 02 0e 01                      getSupportedSwitches(59) -> 14 bytes
getSerial(3, 1), getFlashIDs(3, 3)             getProfileCount(62) -> 04
getProfileSaveTracker(72, p) for p = 0..3      getProfileCount(62, param 1) -> 01
getProfileSaveTracker(72, 0x100) -> 64 00 00 00
getGlobalSettings(51) -> 00                    getCurrentKeyboardProfileIndex(11) -> 00 00
getSupportedSwitches(83) -> 590 bytes (report id 5)
getSensorConfigProfile(82) -> 12 02 08 00 18 01
colorServiceInit(33) -> 0a 04 08 05 10 0a 10 00
* getRgbProfileCore(50, p)                     * getRgbLayer(35, p), (36, p) -> 90 to 140 bytes
* getRgbLayer(57, p, layer 1)                  * getKeyboardProfile(39, p) -> 14 bytes
* getRapidTriggerProfile(54, p)                * getFullRapidTriggerProfile(61, p)
* getGamepadProfile(41, p)                     * getGamepadMapping(40, p)
* getKeymapLayer(48, p, 0)                     * getActuationProfile(49, p)
* getAKCProfile(52, p) -> empty here           * getProfileMetadata(55, p) -> name string
heartbeat(73) every second afterwards -> 08 00 10 00 18 00 20 00
```

Decoded examples from the capture:

- `getProfileMetadata(55, 1)` body `0a 0d "Rapid Profile"`: `ProfileMetadata { name = "Rapid Profile" }`.
- `getKeyboardProfile(39, p)` body `0a 0c 08 1a 10 01 18 01 20 1a 28 00 38 01`:
  `KeyboardProfile { base { ActuationPoint = 26, isDigitalOn = 1, enableRapidTrigger = 1,
  rapidTriggerSensitivity = 26, tachyonModeEnabled = 0, rapidTriggerStrictActuationRange = 1 } }`.
- `getGamepadProfile(41, 2)` returns four `AnalogCurvePoint { x, y }`; profile 1 returns nothing
  because it has no gamepad curve.

## Profile schema (the parts that matter for macros)

```
KeyboardProfile { base: KBase }
KBase { 1 ActuationPoint u32, 2 isDigitalOn bool, 3 enableRapidTrigger bool,
        4 rapidTriggerSensitivity u32, 5 tachyonModeEnabled bool, 6 tickRate enum,
        7 rapidTriggerStrictActuationRange bool, 8 rapidTriggerSecondarySensitivity u32,
        9 tachyonMode enum }

KeyMapping { 1 rows: repeated KeyMappingRow }      one per keymap layer (Main, Fn1, Fn2)
KeyMappingRow { 1 values: bytes }                   one HID usage byte per key column

AKCProfile { 1 items: repeated AKCItem }            "Advanced Keys", max 40 per profile in the UI
AKCItem { oneof akc { 1 dks: AKC_DKSItem, 2 modTap: AKC_ModTapItem, 3 toggleKey: AKC_ToggleKeyItem,
                      4 rappySnappy: AKC_RappySnappyItem, 5 socd: AKC_SOCDItem },
          8 keyIndex u32, 9 layer u32 }
AKC_DKSItem         { 1 keys bytes (4 bindings), 2 bitmappedActions bytes, 3 secondaryActuation u32 }
AKC_ModTapItem      { 1 tapKey u32, 2 holdKey u32, 3 holdDuration u32, 4 jitActivation enum }
AKC_ToggleKeyItem   { 1 keybind u32 }
AKC_SOCDItem        { 1 secondaryKey u32, 2 socd enum SOCDType, 3 inputBothOnBottomOut bool }
AKC_RappySnappyItem { 1 secondaryKey u32, 2 socd enum SOCDType }

ProfileMetadata { 1 name string, 2 color RGB24, 3 icon string }
GlobalSettings  { 1 rgbSleepTimeout, 2 invertNumLock bool, 3 debounceFilter, 4 deviceName string }
DeviceSettings  { 1 nkroEnabled bool, 2 gamepadMode enum, 3 forceUsbFullSpeed bool, 4 gamepadInterval enum }
LinkedAppProfile{ 1 name string, oneof app { 2 custom CustomApp, 3 steamId } }
```

DKS is the only on-board primitive that emits more than one key from one physical key: up to four
bindings, each pressed or released at up to four actuation events (press to first point, press to
bottom, release from bottom, release past first point). There is no timing, no repetition, and no
release-after-delay, so it cannot express a Wootomation sequence.

Other message families in the schema, for reference: RGB effects and layers, LED bar, rapid trigger
and actuation per key, sensor calibration (`SensorConfig`, `SensorLearningReport`), gamepad and
X360 mappings, data-source subscriptions (`DataPoint*`, the RGB "data sources" feature, fed by the
desktop service), and `wooting_service.*` (the local gRPC helper: heartbeat, autostart, update check,
app-switch notifications). Commands 79 and 80 and report 38 are a certificate challenge/response
that was not exercised during the capture.

## What this enables

- A local companion that does what Wootility does: read and write profiles, keymap layers,
  Advanced Keys, rapid trigger and actuation settings, profile names, and the linked-app list. The
  keyboard already stores app links (`LinkedAppProfile`, command 87, report 44), and
  `activateProfile` (command 23) switches profiles. Wootomation's foreground poller could drive
  that directly, without the Wootility desktop service.
- Verifying macro output "from the keyboard" is only possible for what the firmware runs itself:
  remaps and the five Advanced Key types. Everything else stays host-injected. On-board sequences
  need a firmware feature from Wooting; the protocol has no slot for one today.

## How the capture was made

Open `https://wootility.io/` on the intro screen (the device is paired but not yet opened), run the
snippet below in the console, then click "Go to Wootility". Every `sendFeatureReport`, `sendReport`
and input report is appended to `window.__hidcap` as hex.

```js
(() => {
  const log = window.__hidcap = [];
  const hex = b => Array.from(b instanceof ArrayBuffer ? new Uint8Array(b)
    : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  const t0 = performance.now(), push = e => { e.t = Math.round(performance.now() - t0); log.push(e); };
  const P = HIDDevice.prototype, tag = d => (d.collections[0]?.usagePage ?? 0).toString(16);
  for (const [name, fmt] of [['open', () => ({})], ['sendReport', ([id, data]) => ({id, data: hex(data)})],
      ['sendFeatureReport', ([id, data]) => ({id, data: hex(data)})], ['receiveFeatureReport', ([id]) => ({id})]]) {
    const orig = P[name];
    P[name] = async function (...a) { const e = {op: name, dev: tag(this), ...fmt(a)};
      const r = await orig.apply(this, a); if (r instanceof DataView) e.resp = hex(r); push(e); return r; };
  }
  const add = P.addEventListener;
  P.addEventListener = function (type, fn, ...rest) {
    if (type !== 'inputreport') return add.call(this, type, fn, ...rest);
    const dev = this;
    return add.call(this, type, ev => { push({op: 'in', dev: tag(dev), id: ev.reportId, data: hex(ev.data)}); return fn.call(this, ev); }, ...rest);
  };
})();
```

Static analysis: download `assets/index-<hash>.js` from wootility.io and run `npx webcrack` on it.
The command numbers are inlined; grep for `new Le(this.magicWord, <n>` and `sendReport(new`, and
for `super("profiles.` to find the message schemas.
