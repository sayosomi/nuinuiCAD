import type { CommandId } from "../commands/commands";
import type { CadElement } from "../types/geometry";
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
  shortcutConflicts
} from "./shortcutRegistry";
export {
  keyChordFromEvent,
  keyChordLabel,
  keyChordListLabel,
  keyChordMatchesEvent
} from "./shortcutChords";

const eventTargetTagName = (event: KeyboardEvent) => {
  const target = event.target;
  return target instanceof HTMLElement ? target.tagName.toLowerCase() : null;
};

const noModifier = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

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

export const keyboardCommandForEvent = (
  event: KeyboardEvent,
  options: {
    settings?: ShortcutSettings;
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
    isPickMode?: boolean;
  } = {}
): KeyboardCommand | null => {
  const settings = options.settings ?? defaultShortcutSettings();
  const shortcut = shortcutBindingsForMode(settings, options).find((definition) =>
    bindingMatchesEvent(definition, event)
  );
  if (!shortcut) {
    if (
      options.isParameterEditMode &&
      /^[a-z0-9]$/i.test(event.key) &&
      noModifier(event) &&
      !shouldIgnoreKeyboardEvent(event)
    ) {
      return {
        commandId: "selectParameterByKey",
        context: { parameterDirectKey: event.key.toLowerCase() }
      };
    }
    return null;
  }
  if (shortcut.commandId !== "focusElementSearch" && shouldIgnoreKeyboardEvent(event)) return null;
  return {
    commandId: shortcut.commandId,
    context: shortcut.context?.(event)
  };
};

export const commandIdForKeyboardEvent = (
  event: KeyboardEvent,
  options: {
    settings?: ShortcutSettings;
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
    isPickMode?: boolean;
  } = {}
): CommandId | null => {
  return keyboardCommandForEvent(event, options)?.commandId ?? null;
};

export const shortcutHelpItems = (
  options: {
    settings?: ShortcutSettings;
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
    isPickMode?: boolean;
    selectedElement?: CadElement | null;
    selectedParameterKey?: string | null;
  } = {}
): ShortcutHelpItem[] => shortcutHelpItemsForSettings(options);
