import type { CommandId } from "../commands/commands";
import { findParameterDefinition, getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ParameterValueKind } from "../parameters/parameterDefinitions";
import type { CadElement } from "../types/geometry";
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
  isParameterEditMode = false,
  isDependencyJumpMode = false,
  isPickMode = false,
  isDslPanelMode = false
}: {
  isParameterEditMode?: boolean;
  isDependencyJumpMode?: boolean;
  isPickMode?: boolean;
  isDslPanelMode?: boolean;
}): ShortcutScope[] => [
  "global",
  "modeInvariant",
  ...(isDslPanelMode
    ? (["dsl"] as ShortcutScope[])
    : isPickMode
    ? (["pick"] as ShortcutScope[])
    : isParameterEditMode
      ? (["parameter"] as ShortcutScope[])
      : isDependencyJumpMode
        ? (["dependencyJump"] as ShortcutScope[])
        : (["normal"] as ShortcutScope[]))
];

export const shortcutBindingsForMode = (
  settings: ShortcutSettings = defaultShortcutSettings(),
  options: {
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
    isPickMode?: boolean;
    isDslPanelMode?: boolean;
  } = {}
) => {
  const activeScopes = new Set(scopesForMode(options));
  return effectiveShortcutBindings(settings).filter((item) => activeScopes.has(item.scope));
};

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

const parameterShortcut = (
  settings: ShortcutSettings,
  commandId: CommandId
): EffectiveShortcutBinding => {
  const shortcut = effectiveShortcutBindings(settings).find(
    (definition) => definition.scope === "parameter" && definition.commandId === commandId
  );
  if (!shortcut) {
    throw new Error(`Missing parameter shortcut definition: ${commandId}`);
  }
  return shortcut;
};

const parameterValueShortcutItems = (
  settings: ShortcutSettings,
  kind: ParameterValueKind
): ShortcutHelpItem[] => {
  const increment = parameterShortcut(settings, "incrementSelectedParameter");
  const decrement = parameterShortcut(settings, "decrementSelectedParameter");
  const toggle = parameterShortcut(settings, "toggleSelectedParameterValue");
  const increaseStep = parameterShortcut(settings, "increaseSelectedParameterStep");
  const decreaseStep = parameterShortcut(settings, "decreaseSelectedParameterStep");

  return {
    text: [],
    number: [
      helpItem(increment),
      helpItem(decrement),
      helpItem(decreaseStep),
      helpItem(increaseStep)
    ],
    boolean: [helpItem(toggle)],
    lineReference: [
      { ...helpItem(increment), id: "cycleSelectedLineReferenceForward", label: "線候補を次へ" },
      { ...helpItem(decrement), id: "cycleSelectedLineReferenceBackward", label: "線候補を前へ" }
    ],
    lineReferenceList: [],
    color: [
      { ...helpItem(increment), id: "cycleSelectedColorForward", label: "色を次へ" },
      { ...helpItem(decrement), id: "cycleSelectedColorBackward", label: "色を前へ" }
    ],
    lineEndpointReference: [
      { ...helpItem(increment), id: "cycleSelectedLineEndpointForward", label: "端点候補を次へ" },
      { ...helpItem(decrement), id: "cycleSelectedLineEndpointBackward", label: "端点候補を前へ" }
    ],
    choice: [
      { ...helpItem(increment), id: "cycleSelectedChoiceForward", label: "候補を次へ" },
      { ...helpItem(decrement), id: "cycleSelectedChoiceBackward", label: "候補を前へ" }
    ],
    reference: [
      { ...helpItem(increment), id: "cycleSelectedReferenceForward", label: "参照候補を次へ" },
      { ...helpItem(decrement), id: "cycleSelectedReferenceBackward", label: "参照候補を前へ" }
    ]
  }[kind];
};

export const shortcutHelpItemsForSettings = ({
  settings = defaultShortcutSettings(),
  isParameterEditMode = false,
  isDependencyJumpMode = false,
  isPickMode = false,
  isDslPanelMode = false,
  selectedElement = null,
  selectedParameterKey = null
}: {
  settings?: ShortcutSettings;
  isParameterEditMode?: boolean;
  isDependencyJumpMode?: boolean;
  isPickMode?: boolean;
  isDslPanelMode?: boolean;
  selectedElement?: CadElement | null;
  selectedParameterKey?: string | null;
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

  if (!isParameterEditMode) {
    return shortcutBindingsForMode(settings, {
      isDependencyJumpMode,
      isPickMode
    })
      .filter((item) => item.chords.length > 0)
      .map(helpItem);
  }

  const items = shortcutBindingsForMode(settings, { isParameterEditMode: true })
    .filter((item) => item.chords.length > 0)
    .filter((item) => item.commandId !== "incrementSelectedParameter")
    .filter((item) => item.commandId !== "decrementSelectedParameter")
    .filter((item) => item.commandId !== "increaseSelectedParameterStep")
    .filter((item) => item.commandId !== "decreaseSelectedParameterStep")
    .filter((item) => item.commandId !== "toggleSelectedParameterValue")
    .map(helpItem);

  if (!selectedElement) {
    return items;
  }

  const selectedParameter = findParameterDefinition(selectedElement, selectedParameterKey);
  if (selectedParameter) {
    items.push(...parameterValueShortcutItems(settings, selectedParameter.kind));
    if (selectedParameter.kind === "reference" && selectedParameter.allowCoordinate) {
      items.push(helpItem(parameterShortcut(settings, "toggleSelectedParameterValue")));
    }
  }

  const directKeys = getParameterDefinitions(selectedElement)
    .map((definition) => definition.directKey)
    .join(" / ");
  if (directKeys) {
    items.push({
      id: "parameter.selectParameterByKey",
      commandId: "selectParameterByKey",
      label: "パラメーターを直接選択",
      keys: directKeys
    });
  }

  return items;
};

const modeScopes: ShortcutScope[][] = [
  ["global", "modeInvariant", "normal"],
  ["global", "modeInvariant", "parameter"],
  ["global", "modeInvariant", "dependencyJump"],
  ["global", "modeInvariant", "pick"],
  ["global", "modeInvariant", "dsl"]
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
