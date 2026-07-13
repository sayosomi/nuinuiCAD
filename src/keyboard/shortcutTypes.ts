import type { CommandContext, CommandId } from "../commands/commands";

export type ShortcutScope =
  | "global"
  | "modeInvariant"
  | "normal"
  | "pick"
  | "dsl"
  /** CodeMirror-only structural commands; normal text keys remain editor-owned. */
  | "sourceEditor";

export type ShortcutModifier = boolean | "any";

export type KeyChord = {
  key: string;
  mod?: ShortcutModifier;
  alt?: ShortcutModifier;
  shift?: ShortcutModifier;
};

export type ShortcutSettings = {
  version: 1;
  overrides: ShortcutOverride[];
};

export type ShortcutOverride = {
  bindingId: string;
  chords: KeyChord[];
};

export type ShortcutConflict = {
  scope: ShortcutScope;
  chord: KeyChord;
  bindingIds: string[];
};

export type ShortcutBinding = {
  id: string;
  commandId: CommandId;
  scope: ShortcutScope;
  label: string;
  defaultChords: KeyChord[];
  configurable?: boolean;
  context?: (event: KeyboardEvent) => CommandContext;
  defaultChordMatches?: (event: KeyboardEvent, chord: KeyChord) => boolean;
};

export type EffectiveShortcutBinding = ShortcutBinding & {
  chords: KeyChord[];
};

export type KeyboardCommand = {
  commandId: CommandId;
  context?: CommandContext;
};

export type ShortcutHelpItem = {
  id: string;
  commandId: CommandId;
  label: string;
  keys: string;
};
