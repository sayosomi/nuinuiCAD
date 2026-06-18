import type { CommandId } from "../commands/commands";

export type ShortcutDefinition = {
  commandId: CommandId;
  label: string;
  keys: string;
  matches: (event: KeyboardEvent) => boolean;
};

const isMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
const noModifier = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "moveSelectedElementUp",
    label: "選択要素を上へ移動",
    keys: "Mod+ArrowUp",
    matches: (event) => event.key === "ArrowUp" && isMod(event)
  },
  {
    commandId: "moveSelectedElementDown",
    label: "選択要素を下へ移動",
    keys: "Mod+ArrowDown",
    matches: (event) => event.key === "ArrowDown" && isMod(event)
  },
  {
    commandId: "selectPreviousElement",
    label: "前の要素を選択",
    keys: "ArrowUp",
    matches: (event) => event.key === "ArrowUp" && noModifier(event)
  },
  {
    commandId: "selectNextElement",
    label: "次の要素を選択",
    keys: "ArrowDown",
    matches: (event) => event.key === "ArrowDown" && noModifier(event)
  },
  {
    commandId: "deleteSelectedElement",
    label: "選択要素を削除",
    keys: "Delete / Backspace",
    matches: (event) => (event.key === "Delete" || event.key === "Backspace") && noModifier(event)
  },
  {
    commandId: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    keys: "v",
    matches: (event) => event.key.toLowerCase() === "v" && noModifier(event)
  },
  {
    commandId: "addFreePoint",
    label: "free point を追加",
    keys: "p",
    matches: (event) => event.key.toLowerCase() === "p" && noModifier(event)
  },
  {
    commandId: "addOffsetPoint",
    label: "offset point を追加",
    keys: "o",
    matches: (event) => event.key.toLowerCase() === "o" && noModifier(event)
  },
  {
    commandId: "addLine",
    label: "line を追加",
    keys: "l",
    matches: (event) => event.key.toLowerCase() === "l" && noModifier(event)
  },
  {
    commandId: "toggleShortcutHelp",
    label: "ショートカット一覧を表示/非表示",
    keys: "?",
    matches: (event) => event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey
  }
];

export const shouldIgnoreKeyboardEvent = (event: KeyboardEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
};

export const commandIdForKeyboardEvent = (event: KeyboardEvent): CommandId | null => {
  if (shouldIgnoreKeyboardEvent(event)) {
    return null;
  }

  return shortcutDefinitions.find((shortcut) => shortcut.matches(event))?.commandId ?? null;
};
