export enum ViewState {
  Overview,
  Addview,
  Editview
}

/** Mirrors the backend `MacroType` enum: the string name is what gets serialized. */
export enum MacroType {
  Single,
  Toggle,
  OnHold
}

/** Display names for each MacroType, in enum order. */
export const MacroTypeNames: string[] = ['Single', 'Toggle', 'On Hold']

/** Help text for each MacroType, in enum order. */
export const MacroTypeDefinitions: string[] = [
  'The macro will play once after the trigger key(s) is pressed.',
  'The macro will continuously repeat until the trigger key(s) is pressed again.',
  'The macro will repeat only while the trigger key(s) is held down.'
]

export enum KeyType {
  Down,
  Up,
  DownUp
}

export enum MouseButton {
  Left = 257,
  Right = 258,
  Middle = 259,
  Mouse4 = 260,
  Mouse5 = 261
}

export enum SettingsCategory {
  General,
  Macro,
  Other
}

export enum HIDCategory {
  Alphanumeric,
  Numpad,
  Function, // F1-24
  Modifier,
  Navigation, // arrow keys and pg up, pg down, etc
}

/** To be Expanded */
export enum PluginGroup {
  // e.g. PhillipsHue, or OBS
}