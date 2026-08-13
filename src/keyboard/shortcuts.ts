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
  UnresolvedShortcutOverride,
  ShortcutScope,
  ShortcutSettings
} from "./shortcutTypes";
export {
  configurableShortcutBindings,
  crossFocusShortcutBindings,
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

const isCommandLineBarInputTarget = (event: KeyboardEvent) =>
  event.target instanceof HTMLInputElement && Boolean(event.target.closest(".command-line-bar"));

export const shouldIgnoreKeyboardEvent = (event: KeyboardEvent) => {
  if (isEditableKeyboardTarget(event)) return true;

  const tagName = eventTargetTagName(event);
  return tagName === "button" && (event.key === " " || event.key === "Enter");
};

/** App-level capture must leave the entire Source Editor UI region untouched (CodeMirror
 * itself, its element/text search panel, its element context menu, && its ribbon dock)
 * so their own IME, search, undo, Escape, && pick keymaps run before global canvas
 * commands. */
export const isSourceEditorKeyboardTarget = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement && Boolean(event.target.closest("[data-source-editor-scope='true']"));

/** The CodeMirror document owns its normal editing keys. */
export const isSourceEditorDslKeyboardTarget = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement && Boolean(event.target.closest(".cm-editor"));

/** React's element-search field is an input surface, not CodeMirror's document. */
export const isSourceEditorSearchKeyboardTarget = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement && Boolean(event.target.closest("[data-source-editor-search='true']"));

export const keyboardCommandForEvent = (
  event: KeyboardEvent,
  options: {
    settings?: ShortcutSettings;
    isPickMode?: boolean;
    scopes?: readonly import("./shortcutTypes").ShortcutScope[];
    allowEditableCommandIds?: ReadonlySet<CommandId>;
    allowModifiedEditableCommandIds?: ReadonlySet<CommandId>;
  } = {}
): KeyboardCommand | null => {
  const settings = options.settings ?? defaultShortcutSettings();
  const shortcut = shortcutBindingsForMode(settings, options).find((definition) =>
    bindingMatchesEvent(definition, event)
  );
  if (!shortcut) return null;
  const allowsModifiedEditableShortcut =
    Boolean(options.allowModifiedEditableCommandIds?.has(shortcut.commandId)) &&
    isCommandLineBarInputTarget(event) &&
    (event.metaKey || event.ctrlKey);
  if (
    shortcut.scope !== "crossFocus" &&
    !options.allowEditableCommandIds?.has(shortcut.commandId) &&
    shouldIgnoreKeyboardEvent(event) &&
    !allowsModifiedEditableShortcut
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
    isPickMode?: boolean;
    allowEditableCommandIds?: ReadonlySet<CommandId>;
    allowModifiedEditableCommandIds?: ReadonlySet<CommandId>;
  } = {}
): CommandId | null => {
  return keyboardCommandForEvent(event, options)?.commandId ?? null;
};

export const shortcutHelpItems = (
  options: {
    settings?: ShortcutSettings;
    isPickMode?: boolean;
  } = {}
): ShortcutHelpItem[] => shortcutHelpItemsForSettings(options);
