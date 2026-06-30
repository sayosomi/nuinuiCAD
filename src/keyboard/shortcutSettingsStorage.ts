import { isTauriRuntime } from "../geometry/evaluationEngine";
import { defaultShortcutSettings } from "./shortcutRegistry";
import type { KeyChord, ShortcutOverride, ShortcutSettings } from "./shortcutTypes";

const STORAGE_KEY = "nuinuiCAD.shortcutSettings.v1";

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

export const normalizeShortcutSettings = (value: unknown): ShortcutSettings => {
  if (!isObject(value) || !Array.isArray(value.overrides)) return defaultShortcutSettings();
  return {
    version: 1,
    overrides: value.overrides
      .map(parseOverride)
      .filter((override): override is ShortcutOverride => Boolean(override))
  };
};

const loadShortcutSettingsFromLocalStorage = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultShortcutSettings();
  try {
    return normalizeShortcutSettings(JSON.parse(raw));
  } catch {
    return defaultShortcutSettings();
  }
};

const saveShortcutSettingsToLocalStorage = (settings: ShortcutSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const loadShortcutSettings = async (): Promise<ShortcutSettings> => {
  if (!isTauriRuntime()) return loadShortcutSettingsFromLocalStorage();
  const { invoke } = await import("@tauri-apps/api/core");
  const settings = await invoke<unknown>("load_shortcut_settings");
  return normalizeShortcutSettings(settings);
};

export const saveShortcutSettings = async (settings: ShortcutSettings) => {
  const normalized = normalizeShortcutSettings(settings);
  if (!isTauriRuntime()) {
    saveShortcutSettingsToLocalStorage(normalized);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("save_shortcut_settings", { input: normalized });
};
