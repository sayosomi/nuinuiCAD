import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { configurableShortcutBindings, defaultShortcutSettings } from "./shortcutRegistry";
import { keyChordId } from "./shortcutChords";
import type { KeyChord, ShortcutOverride, ShortcutSettings } from "./shortcutTypes";

const STORAGE_KEY = "nuinuiCAD.shortcutSettings.v1";

/**
 * Phase 3d replaced the parameter-form and dependency-jump scopes with the
 * Inspector scope. Settings store binding IDs (rather than command IDs), so
 * keep this translation at the persistence boundary only.
 */
const legacyBindingIdMap: Readonly<Record<string, string>> = {
  "modeInvariant.toggleElementInfoPanel": "modeInvariant.toggleInspectorPanel",
  "normal.toggleElementInfoPanel": "normal.toggleInspectorPanel",
  "global.enterParameterEditMode": "global.focusInspectorParameterRows",
  "normal.enterParameterEditMode": "normal.focusInspectorParameterRows",
  "global.enterDependencyJumpMode": "global.focusInspectorDependencyRows",
  "normal.enterDependencyJumpMode": "normal.focusInspectorDependencyRows",
  "parameter.exitParameterEditMode": "inspector.exitInspector",
  "dependencyJump.exitDependencyJumpMode": "inspector.exitInspector",
  "parameter.selectNextParameter": "inspector.selectNextInspectorRow",
  "dependencyJump.selectNextDependencyJumpTarget": "inspector.selectNextInspectorRow",
  "parameter.selectPreviousParameter": "inspector.selectPreviousInspectorRow",
  "dependencyJump.selectPreviousDependencyJumpTarget": "inspector.selectPreviousInspectorRow",
  "parameter.activateSelectedParameter": "inspector.activateInspectorRow",
  "dependencyJump.jumpToSelectedDependencyTarget": "inspector.activateInspectorRow",
  "parameter.incrementSelectedParameter": "sourceEditor.stepSourceValueForward",
  "parameter.decrementSelectedParameter": "sourceEditor.stepSourceValueBackward"
};

const retiredCommandIds = new Set([
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
  "toggleExpressionInsertTray",
  "openExpressionInsertTray",
  "closeExpressionInsertTray"
]);

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
  const validBindingIds = new Set(configurableShortcutBindings.map((binding) => binding.id));
  const explicitOverrides = new Map<string, { override: ShortcutOverride; index: number }>();

  parsedOverrides.forEach((override, index) => {
    if (!override || legacyBindingIdMap[override.bindingId]) return;
    if (
      !retiredCommandIds.has(commandIdForBinding(override.bindingId)) &&
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

    if (
      retiredCommandIds.has(commandIdForBinding(override.bindingId)) ||
      !validBindingIds.has(override.bindingId)
    ) {
      return;
    }

    const explicit = explicitOverrides.get(override.bindingId);
    if (explicit?.index === index) overrides.push(explicit.override);
  });

  const settings: ShortcutSettings = { version: 1, overrides };
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
