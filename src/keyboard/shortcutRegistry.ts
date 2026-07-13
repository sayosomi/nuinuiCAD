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
  isPickMode = false,
  isDslPanelMode = false
}: {
  isPickMode?: boolean;
  isDslPanelMode?: boolean;
}): ShortcutScope[] => [
  "global",
  "modeInvariant",
  ...(isDslPanelMode
    ? (["dsl"] as ShortcutScope[])
    : isPickMode
    ? (["pick"] as ShortcutScope[])
    : (["normal"] as ShortcutScope[]))
];

export const shortcutBindingsForMode = (
  settings: ShortcutSettings = defaultShortcutSettings(),
  options: {
    isPickMode?: boolean;
    isDslPanelMode?: boolean;
  } = {}
) => {
  const activeScopes = new Set(scopesForMode(options));
  return effectiveShortcutBindings(settings).filter((item) => activeScopes.has(item.scope));
};

/** Source of truth for structural shortcuts that may run while CodeMirror owns focus. */
export const sourceEditorShortcutBindings = (
  settings: ShortcutSettings = defaultShortcutSettings()
) => effectiveShortcutBindings(settings).filter((item) => item.scope === "sourceEditor");

export const bindingMatchesEvent = (binding: EffectiveShortcutBinding, event: KeyboardEvent) =>
  binding.chords.some((chord) => {
    const matcher = binding.defaultChords.some((defaultChord) => keyChordEquals(defaultChord, chord))
      ? binding.defaultChordMatches
      : undefined;
    return matcher ? matcher(event, chord) : keyChordMatchesEvent(chord, event);
  });

const helpItem = (shortcut: EffectiveShortcutBinding): ShortcutHelpItem => ({
  id: shortcut.id,
  commandId: shortcut.commandId,
  label: shortcut.label,
  keys: keyChordListLabel(shortcut.chords)
});

export const shortcutHelpItemsForSettings = ({
  settings = defaultShortcutSettings(),
  isPickMode = false,
  isDslPanelMode = false
}: {
  settings?: ShortcutSettings;
  isPickMode?: boolean;
  isDslPanelMode?: boolean;
} = {}): ShortcutHelpItem[] => {
  if (isDslPanelMode) {
    return shortcutBindingsForMode(settings, { isDslPanelMode: true })
      .filter((item) => item.scope === "dsl")
      .filter((item) => item.chords.length > 0)
      .map(helpItem);
  }

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
  ["global", "modeInvariant", "normal"],
  ["global", "modeInvariant", "pick"],
  ["global", "modeInvariant", "dsl"],
  ["sourceEditor"]
];

export const shortcutConflicts = (
  settings: ShortcutSettings = defaultShortcutSettings()
): ShortcutConflict[] => {
  const bindings = effectiveShortcutBindings(settings).filter((item) => item.chords.length > 0);
  const conflicts: ShortcutConflict[] = [];

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
          bindingIds: uniqueBindingIds
        });
      }
    }
  }

  return conflicts;
};
