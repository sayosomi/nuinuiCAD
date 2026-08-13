import type { CommandContext, CommandId } from "../commands/commands";

export type ShortcutScope =
  /** Commands intentionally available across Canvas && text-input focus. */
  | "crossFocus"
  | "normal"
  | "pick"
  /** DSL body && line-lens commands. */
  | "sourceEditor"
  /** Reserved for the currently active dialog; no configurable bindings yet. */
  | "modal";

/** Who owns a key while CodeMirror has focus. */
export type ShortcutOwner = "appExclusive" | "editorTransaction";

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
  /** Saved but inactive settings that could not be migrated automatically. */
  unresolvedOverrides?: UnresolvedShortcutOverride[];
};

export type ShortcutOverride = {
  bindingId: string;
  chords: KeyChord[];
};

export type UnresolvedShortcutOverride = ShortcutOverride & {
  reason: string;
};

export type ShortcutConflict = {
  scope: ShortcutScope;
  chord: KeyChord;
  bindingIds: string[];
  kind?: "duplicate" | "sourceEditorModifier" | "codeMirrorOwnership";
  message?: string;
};

export type ShortcutBinding = {
  id: string;
  commandId: CommandId;
  scope: ShortcutScope;
  label: string;
  defaultChords: KeyChord[];
  /** App-exclusive bindings consume a matching key even when unavailable.
   * Editor transactions fall through to CodeMirror when inapplicable. */
  owner?: ShortcutOwner;
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
