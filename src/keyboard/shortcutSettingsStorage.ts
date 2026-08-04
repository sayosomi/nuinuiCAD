import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { configurableShortcutBindings, defaultShortcutSettings } from "./shortcutRegistry";
import { keyChordId } from "./shortcutChords";
import type { KeyChord, ShortcutOverride, ShortcutSettings, UnresolvedShortcutOverride } from "./shortcutTypes";

const STORAGE_KEY = "nuinuiCAD.shortcutSettings.v1";

/** Settings store binding IDs rather than command IDs, so the few durable
 * replacements stay isolated at the persistence boundary. Inspector navigation
 * bindings are deliberately not mapped: the mouse-only Inspector has no
 * replacement keyboard scope or command.
 */
export const legacyBindingIdMap: Readonly<Record<string, string>> = {
  "global.newDocument": "crossFocus.newDocument",
  "global.openDocument": "crossFocus.openDocument",
  "global.saveDocument": "crossFocus.saveDocument",
  "global.saveDocumentAs": "crossFocus.saveDocumentAs",
  "global.openCommandPalette": "crossFocus.openCommandPalette",
  "global.focusElementSearch": "crossFocus.focusElementSearch",
  "global.undo": "normal.undo",
  "global.redo": "normal.redo",
  "global.enterElementListMode": "normal.focusSourceEditor",
  "normal.focusElementList": "normal.focusSourceEditor",
  "normal.enterElementListMode": "normal.focusSourceEditor",
  "modeInvariant.toggleInspectorPanel": "normal.toggleInspectorPanel",
  "modeInvariant.toggleShortcutHelp": "crossFocus.toggleShortcutHelp",
  "normal.openShortcutSettings": "crossFocus.openShortcutSettings",
  "modeInvariant.toggleElementInfoPanel": "modeInvariant.toggleInspectorPanel",
  "normal.toggleElementInfoPanel": "normal.toggleInspectorPanel",
  "parameter.incrementSelectedParameter": "sourceEditor.stepSourceValueForward",
  "parameter.decrementSelectedParameter": "sourceEditor.stepSourceValueBackward",
  "normal.commandLineAddFreePoint": "normal.addFreePoint",
  "normal.commandLineAddOffsetPoint": "normal.addOffsetPoint",
  "normal.commandLineAddPolarOffsetPoint": "normal.addPolarOffsetPoint",
  "normal.commandLineAddDivisionPoint": "normal.addDivisionPoint",
  "normal.commandLineAddLineDivisionPoint": "normal.addLineDivisionPoint",
  "normal.commandLineAddIntersectionPoint": "normal.addIntersectionPoint",
  "normal.commandLineAddLineTangentOffsetPoint": "normal.addLineTangentOffsetPoint",
  "normal.commandLineAddLine": "normal.addLine",
  "normal.commandLineAddAngleLengthLine": "normal.addAngleLengthLine",
  "normal.commandLineAddArcLine": "normal.addArcLine",
  "normal.commandLineAddThreePointArcLine": "normal.addThreePointArcLine",
  "normal.commandLineAddCornerRadiusArcLine": "normal.addCornerRadiusArcLine",
  "normal.commandLineAddEdge": "normal.addEdge",
  "normal.commandLineAddExtendTrim": "normal.addExtendTrim",
  "normal.commandLineAddBezierCurve": "normal.addBezierCurve",
  "normal.commandLineAddOffsetLine": "normal.addOffsetLine",
  "normal.commandLineAddCopyLine": "normal.addCopyLine",
  "normal.commandLineAddSymmetricCopyLine": "normal.addSymmetricCopyLine",
  "normal.commandLineAddMove": "normal.addMove",
  "normal.commandLineAddSymmetricMove": "normal.addSymmetricMove",
  "normal.commandLineAddSplitLine": "normal.addSplitLine",
  "normal.commandLineAddText": "normal.addText"
};

export const retiredCommandIds = [
  "openDslPanel",
  "exportDslSelection",
  "validateDslPanel",
  "applyDslPanel",
  "closeDslPanel",
  "enterParameterEditMode",
  "enterDependencyJumpMode",
  "exitParameterEditMode",
  "exitDependencyJumpMode",
  "selectNextParameter",
  "selectPreviousParameter",
  "selectNextDependencyJumpTarget",
  "selectPreviousDependencyJumpTarget",
  "activateSelectedParameter",
  "jumpToSelectedDependencyTarget",
  "focusInspectorParameterRows",
  "focusInspectorDependencyRows",
  "exitInspector",
  "selectNextInspectorRow",
  "selectPreviousInspectorRow",
  "activateInspectorRow",
  "startInspectorParameterPick",
  "selectParameterByKey",
  "focusSelectedParameterInput",
  "increaseSelectedParameterStep",
  "decreaseSelectedParameterStep",
  "cycleSelectedReferenceForward",
  "cycleSelectedReferenceBackward",
  "toggleSelectedParameterValue",
  "toggleSelectedPointAnchorMode",
  "setSelectedPointAnchorReferenceMode",
  "setSelectedPointAnchorCoordinateMode",
  "toggleSelectedBooleanParameter",
  "toggleBooleanParameterByDirectKey",
  "toggleElementLocked",
  "toggleSelectedElementLocked",
  "toggleExpressionInsertTray",
  "openExpressionInsertTray",
  "closeExpressionInsertTray",
  "toggleElementVisibility",
  "toggleElementEnabled",
  "toggleSelectedElementVisibility",
  "toggleSelectedElementEnabled",
  "commandLineAddVariable"
] as const;

const retiredCommandIdSet = new Set<string>(retiredCommandIds);

const commandIdForBinding = (bindingId: string) => bindingId.slice(bindingId.indexOf(".") + 1);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseModifier = (value: unknown): KeyChord["mod"] =>
  value === true || value === "any" ? value : false;

const parseChord = (value: unknown): KeyChord | null => {
  if (!isObject(value) || typeof value.key !== "string" || value.key.length === 0) return null;
  return {
    key: value.key,
    mod: parseModifier(value.mod),
    alt: parseModifier(value.alt),
    shift: parseModifier(value.shift)
  };
};

const parseOverride = (value: unknown): ShortcutOverride | null => {
  if (!isObject(value) || typeof value.bindingId !== "string" || !Array.isArray(value.chords)) {
    return null;
  }
  return {
    bindingId: value.bindingId,
    chords: value.chords.map(parseChord).filter((chord): chord is KeyChord => Boolean(chord))
  };
};

const normalizeShortcutSettingsWithStatus = (value: unknown) => {
  if (!isObject(value) || !Array.isArray(value.overrides)) {
    return { settings: defaultShortcutSettings(), changed: true };
  }

  const parsedOverrides = value.overrides.map(parseOverride);
  const unresolved: UnresolvedShortcutOverride[] = Array.isArray(value.unresolvedOverrides)
    ? value.unresolvedOverrides.map(parseOverride).flatMap((override) =>
      override ? [{ ...override, reason: "以前の設定を自動移行できませんでした。" }] : []
    )
    : [];
  const validBindingIds = new Set(configurableShortcutBindings.map((binding) => binding.id));
  const bindingById = new Map(configurableShortcutBindings.map((binding) => [binding.id, binding]));
  const explicitOverrides = new Map<string, { override: ShortcutOverride; index: number }>();

  parsedOverrides.forEach((override, index) => {
    if (!override || legacyBindingIdMap[override.bindingId]) return;
    const binding = bindingById.get(override.bindingId);
    if (
      binding?.scope === "sourceEditor" &&
      binding.owner !== "editorTransaction" &&
      override.chords.some((chord) => chord.mod !== true)
    ) {
      unresolved.push({
        ...override,
        reason: "Source EditorのアプリショートカットにはModキーが必要です。"
      });
      return;
    }
    if (
      !retiredCommandIdSet.has(commandIdForBinding(override.bindingId)) &&
      validBindingIds.has(override.bindingId)
    ) {
      // This also preserves the previous effective-settings behaviour for a
      // duplicate saved override: the later entry wins.
      explicitOverrides.set(override.bindingId, { override, index });
    }
  });

  const migratedOverrides = new Map<string, ShortcutOverride>();
  const overrides: ShortcutOverride[] = [];

  parsedOverrides.forEach((override, index) => {
    if (!override) return;

    const targetBindingId = legacyBindingIdMap[override.bindingId];
    if (targetBindingId) {
      // A user override saved against the new binding is authoritative. Legacy
      // bindings only contribute when no replacement override exists.
      if (explicitOverrides.has(targetBindingId)) return;

      const target = bindingById.get(targetBindingId);
      if (target?.scope === "sourceEditor" && override.chords.some((chord) => chord.mod !== true)) {
        unresolved.push({
          ...override,
          reason: "移行先のSource EditorアプリショートカットにはModキーが必要です。"
        });
        return;
      }

      const current = migratedOverrides.get(targetBindingId) ?? {
        bindingId: targetBindingId,
        chords: []
      };
      const seen = new Set(current.chords.map(keyChordId));
      for (const chord of override.chords) {
        if (!seen.has(keyChordId(chord))) {
          current.chords.push(chord);
          seen.add(keyChordId(chord));
        }
      }
      if (!migratedOverrides.has(targetBindingId)) {
        migratedOverrides.set(targetBindingId, current);
        overrides.push(current);
      }
      return;
    }

    if (retiredCommandIdSet.has(commandIdForBinding(override.bindingId)) || !validBindingIds.has(override.bindingId)) {
      unresolved.push({
        ...override,
        reason: "対応するショートカット項目がなく、自動移行できませんでした。"
      });
      return;
    }

    const explicit = explicitOverrides.get(override.bindingId);
    if (explicit?.index === index) overrides.push(explicit.override);
  });

  const settings: ShortcutSettings = unresolved.length > 0
    ? { version: 1, overrides, unresolvedOverrides: unresolved }
    : { version: 1, overrides };
  return { settings, changed: JSON.stringify(value) !== JSON.stringify(settings) };
};

export const normalizeShortcutSettings = (value: unknown): ShortcutSettings =>
  normalizeShortcutSettingsWithStatus(value).settings;

const loadShortcutSettingsFromLocalStorage = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultShortcutSettings();
  try {
    const normalized = normalizeShortcutSettingsWithStatus(JSON.parse(raw));
    if (normalized.changed) {
      try {
        saveShortcutSettingsToLocalStorage(normalized.settings);
      } catch {
        // A storage quota/privacy failure must not prevent using the migrated settings.
      }
    }
    return normalized.settings;
  } catch {
    return defaultShortcutSettings();
  }
};

const saveShortcutSettingsToLocalStorage = (settings: ShortcutSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const loadShortcutSettings = async (): Promise<ShortcutSettings> => {
  if (!isTauriRuntime()) return loadShortcutSettingsFromLocalStorage();
  const normalized = normalizeShortcutSettingsWithStatus(
    await invoke<unknown>("load_shortcut_settings")
  );
  if (normalized.changed) {
    void invoke<void>("save_shortcut_settings", { input: normalized.settings }).catch(() => undefined);
  }
  return normalized.settings;
};

export const saveShortcutSettings = async (settings: ShortcutSettings) => {
  const normalized = normalizeShortcutSettings(settings);
  if (!isTauriRuntime()) {
    saveShortcutSettingsToLocalStorage(normalized);
    return;
  }
  await invoke<void>("save_shortcut_settings", { input: normalized });
};
