import { keyChordEquals, keyChordId, keyChordListLabel, keyChordMatchesEvent } from "./shortcutChords";
import {
  configurableShortcutBindings,
  shortcutBindings
} from "./shortcutDefaultBindings";
import type {
  EffectiveShortcutBinding,
  KeyChord,
  ShortcutConflict,
  ShortcutHelpItem,
  ShortcutScope,
  ShortcutSettings
} from "./shortcutTypes";

export { configurableShortcutBindings };

export const defaultShortcutSettings = (): ShortcutSettings => ({
  version: 1,
  overrides: []
});

export const effectiveShortcutBindings = (
  settings: ShortcutSettings = defaultShortcutSettings()
): EffectiveShortcutBinding[] => {
  const overrides = new Map(settings.overrides.map((override) => [override.bindingId, override.chords]));
  return shortcutBindings.map((item) => ({
    ...item,
    chords: overrides.get(item.id) ?? item.defaultChords
  }));
};

const scopesForMode = ({
  isPickMode = false
}: {
  isPickMode?: boolean;
}): ShortcutScope[] => [
  "crossFocus",
  ...(isPickMode
    ? (["pick"] as ShortcutScope[])
    : (["normal"] as ShortcutScope[]))
];

export const shortcutBindingsForMode = (
  settings: ShortcutSettings = defaultShortcutSettings(),
  options: {
    isPickMode?: boolean;
    scopes?: readonly ShortcutScope[];
  } = {}
) => {
  const activeScopes = new Set(options.scopes ?? scopesForMode(options));
  return effectiveShortcutBindings(settings).filter((item) => activeScopes.has(item.scope));
};

/** Source of truth for structural shortcuts that may run while CodeMirror owns focus. */
export const sourceEditorShortcutBindings = (
  settings: ShortcutSettings = defaultShortcutSettings()
) => effectiveShortcutBindings(settings).filter((item) => item.scope === "sourceEditor");

export const crossFocusShortcutBindings = (
  settings: ShortcutSettings = defaultShortcutSettings()
) => effectiveShortcutBindings(settings).filter((item) => item.scope === "crossFocus");

export const bindingMatchesEvent = (binding: EffectiveShortcutBinding, event: KeyboardEvent) =>
  binding.chords.some((chord) => {
    const matcher = binding.defaultChords.some((defaultChord) => keyChordEquals(defaultChord, chord))
      ? binding.defaultChordMatches
      : undefined;
    return matcher ? matcher(event, chord) : keyChordMatchesEvent(chord, event);
  });

const sourceEditorBindingRequiresMod = (binding: EffectiveShortcutBinding) =>
  binding.owner !== "editorTransaction";

const isCodeMirrorDeleteLineChord = (chord: KeyChord) =>
  chord.key.toLowerCase() === "k" && chord.mod === true && chord.shift === true && !chord.alt;

const helpItem = (shortcut: EffectiveShortcutBinding): ShortcutHelpItem => ({
  id: shortcut.id,
  commandId: shortcut.commandId,
  label: shortcut.label,
  keys: keyChordListLabel(shortcut.chords)
});

export const shortcutHelpItemsForSettings = ({
  settings = defaultShortcutSettings(),
  isPickMode = false
}: {
  settings?: ShortcutSettings;
  isPickMode?: boolean;
} = {}): ShortcutHelpItem[] => {
  if (isPickMode) {
    return shortcutBindingsForMode(settings, { isPickMode: true })
      .filter((item) => item.chords.length > 0)
      .map(helpItem);
  }

  return shortcutBindingsForMode(settings, { isPickMode })
    .filter((item) => item.chords.length > 0)
    .map(helpItem);
};

const modeScopes: ShortcutScope[][] = [
  ["crossFocus", "normal"],
  ["crossFocus", "pick"],
  ["crossFocus", "sourceEditor"],
  ["modal"]
];

export const shortcutConflicts = (
  settings: ShortcutSettings = defaultShortcutSettings()
): ShortcutConflict[] => {
  const bindings = effectiveShortcutBindings(settings).filter((item) => item.chords.length > 0);
  const conflicts: ShortcutConflict[] = [];

  for (const binding of bindings.filter((item) => item.scope === "sourceEditor" || item.scope === "crossFocus")) {
    for (const chord of binding.chords) {
      if (binding.scope === "sourceEditor" && sourceEditorBindingRequiresMod(binding) && chord.mod !== true) {
        conflicts.push({
          scope: "sourceEditor",
          chord,
          bindingIds: [binding.id],
          kind: "sourceEditorModifier",
          message: "Source EditorのアプリショートカットにはModキーが必要です。"
        });
      }
      if (binding.owner !== "editorTransaction" && isCodeMirrorDeleteLineChord(chord)) {
        conflicts.push({
          scope: "sourceEditor",
          chord,
          bindingIds: [binding.id],
          kind: "codeMirrorOwnership",
          message: "Mod+Shift+KはCodeMirrorの「現在行を削除」です。意味の異なるアプリ操作には登録できません。"
        });
      }
    }
  }

  for (const scopes of modeScopes) {
    const candidates = bindings.filter((bindingItem) => scopes.includes(bindingItem.scope));
    const byChord = new Map<string, { chord: KeyChord; bindingIds: string[] }>();
    for (const candidate of candidates) {
      for (const chord of candidate.chords) {
        const id = keyChordId(chord);
        const current = byChord.get(id) ?? { chord, bindingIds: [] };
        current.bindingIds.push(candidate.id);
        byChord.set(id, current);
      }
    }

    for (const item of byChord.values()) {
      const uniqueBindingIds = [...new Set(item.bindingIds)];
      if (uniqueBindingIds.length > 1) {
        conflicts.push({
          scope: scopes.at(-1) ?? "normal",
          chord: item.chord,
          bindingIds: uniqueBindingIds,
          kind: "duplicate"
        });
      }
    }
  }

  return conflicts;
};
