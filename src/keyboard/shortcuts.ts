import type { CommandId } from "../commands/commands";
import {
  bindingMatchesEvent,
  defaultShortcutSettings,
  shortcutBindingsForMode,
  shortcutHelpItemsForSettings
} from "./shortcutRegistry";
import type {
  KeyboardCommand,
  ShortcutHelpItem,
  ShortcutSettings
} from "./shortcutTypes";

export type {
  KeyboardCommand,
  KeyChord,
  ShortcutBinding,
  ShortcutConflict,
  ShortcutHelpItem,
  ShortcutOverride,
  ShortcutScope,
  ShortcutSettings
} from "./shortcutTypes";
export {
  configurableShortcutBindings,
  defaultShortcutSettings,
  effectiveShortcutBindings,
  sourceEditorShortcutBindings,
  shortcutConflicts
} from "./shortcutRegistry";
export {
  keyChordFromEvent,
  keyChordLabel,
  keyChordListLabel,
  keyChordMatchesEvent,
  keyChordMatchesSearch
} from "./shortcutChords";

const eventTargetTagName = (event: KeyboardEvent) => {
  const target = event.target;
  return target instanceof HTMLElement ? target.tagName.toLowerCase() : null;
};

const isElementListTarget = (event: KeyboardEvent) => {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("[data-element-list='true'], [data-element-list-row='true']"))
  );
};

const isEditableKeyboardTarget = (event: KeyboardEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.getAttribute("contenteditable") === "true" ||
    target.isContentEditable
  );
};

export const shouldIgnoreKeyboardEvent = (event: KeyboardEvent) => {
  if (isEditableKeyboardTarget(event)) return true;

  const tagName = eventTargetTagName(event);
  return (
    tagName === "button" &&
    (event.key === " " || (event.key === "Enter" && !isElementListTarget(event)))
  );
};

/** App-level capture must leave the entire Source Editor UI region untouched (CodeMirror
 * itself, its element/text search panel, its element context menu, and its ribbon dock)
 * so their own IME, search, undo, Escape, and pick keymaps run before global canvas
 * commands. */
export const isSourceEditorKeyboardTarget = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement && Boolean(event.target.closest("[data-source-editor-scope='true']"));

export const keyboardCommandForEvent = (
  event: KeyboardEvent,
  options: {
    settings?: ShortcutSettings;
    isInspectorFocused?: boolean;
    isPickMode?: boolean;
    isDslPanelMode?: boolean;
    allowEditableCommandIds?: ReadonlySet<CommandId>;
  } = {}
): KeyboardCommand | null => {
  const settings = options.settings ?? defaultShortcutSettings();
  const shortcut = shortcutBindingsForMode(settings, options).find((definition) =>
    bindingMatchesEvent(definition, event)
  );
  if (!shortcut) return null;
  if (
    shortcut.commandId !== "focusElementSearch" &&
    !options.allowEditableCommandIds?.has(shortcut.commandId) &&
    shouldIgnoreKeyboardEvent(event)
  ) return null;
  return {
    commandId: shortcut.commandId,
    context: shortcut.context?.(event)
  };
};

export const commandIdForKeyboardEvent = (
  event: KeyboardEvent,
  options: {
    settings?: ShortcutSettings;
    isInspectorFocused?: boolean;
    isPickMode?: boolean;
    isDslPanelMode?: boolean;
    allowEditableCommandIds?: ReadonlySet<CommandId>;
  } = {}
): CommandId | null => {
  return keyboardCommandForEvent(event, options)?.commandId ?? null;
};

export const shortcutHelpItems = (
  options: {
    settings?: ShortcutSettings;
    isInspectorFocused?: boolean;
    isPickMode?: boolean;
    isDslPanelMode?: boolean;
  } = {}
): ShortcutHelpItem[] => shortcutHelpItemsForSettings(options);
