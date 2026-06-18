import type { CommandContext, CommandId } from "../commands/commands";
import { findParameterDefinition, getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ParameterValueKind } from "../parameters/parameterDefinitions";
import type { CadElement } from "../types/geometry";

export type ShortcutDefinition = {
  commandId: CommandId;
  label: string;
  keys: string;
  matches: (event: KeyboardEvent) => boolean;
  context?: (event: KeyboardEvent) => CommandContext;
};

export type KeyboardCommand = {
  commandId: CommandId;
  context?: CommandContext;
};

export type ShortcutHelpItem = {
  id: string;
  commandId: CommandId;
  label: string;
  keys: string;
};

const isMod = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;
const noModifier = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

export const globalShortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "undo",
    label: "元に戻す",
    keys: "Mod+Z",
    matches: (event) => event.key.toLowerCase() === "z" && isMod(event) && !event.altKey && !event.shiftKey
  },
  {
    commandId: "redo",
    label: "やり直す",
    keys: "Mod+Y",
    matches: (event) => event.key.toLowerCase() === "y" && isMod(event) && !event.altKey && !event.shiftKey
  }
];

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
    commandId: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    keys: "Enter",
    matches: (event) => event.key === "Enter" && noModifier(event)
  },
  {
    commandId: "toggleShortcutHelp",
    label: "ショートカット一覧を表示/非表示",
    keys: "?",
    matches: (event) => event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey
  }
];

const arrowStepContext = (event: KeyboardEvent): CommandContext => ({
  stepMultiplier: event.shiftKey ? 10 : event.altKey ? 0.1 : 1
});

export const parameterEditShortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "exitParameterEditMode",
    label: "パラメーター編集モードを終了",
    keys: "Escape",
    matches: (event) => event.key === "Escape" && noModifier(event)
  },
  {
    commandId: "focusSelectedParameterInput",
    label: "選択パラメーターを直接入力",
    keys: "Enter",
    matches: (event) => event.key === "Enter" && noModifier(event)
  },
  {
    commandId: "selectNextParameter",
    label: "次のパラメーターを選択",
    keys: "ArrowDown",
    matches: (event) => event.key === "ArrowDown" && noModifier(event)
  },
  {
    commandId: "selectPreviousParameter",
    label: "前のパラメーターを選択",
    keys: "ArrowUp",
    matches: (event) => event.key === "ArrowUp" && noModifier(event)
  },
  {
    commandId: "incrementSelectedParameter",
    label: "数値を増やす",
    keys: "ArrowRight / Shift / Alt",
    matches: (event) => event.key === "ArrowRight" && !event.metaKey && !event.ctrlKey,
    context: arrowStepContext
  },
  {
    commandId: "decrementSelectedParameter",
    label: "数値を減らす",
    keys: "ArrowLeft / Shift / Alt",
    matches: (event) => event.key === "ArrowLeft" && !event.metaKey && !event.ctrlKey,
    context: arrowStepContext
  },
  {
    commandId: "toggleSelectedBooleanParameter",
    label: "真偽値を切替",
    keys: "Space",
    matches: (event) => event.key === " " && noModifier(event)
  },
  {
    commandId: "selectParameterByKey",
    label: "名前キーでパラメーターを選択",
    keys: "n / v / a / x / y / b / s / t",
    matches: (event) => /^[a-z]$/i.test(event.key) && noModifier(event),
    context: (event) => ({ parameterDirectKey: event.key.toLowerCase() })
  }
];

const helpItem = (shortcut: ShortcutDefinition): ShortcutHelpItem => ({
  id: shortcut.commandId,
  commandId: shortcut.commandId,
  label: shortcut.label,
  keys: shortcut.keys
});

const parameterShortcut = (commandId: CommandId) => {
  const shortcut = parameterEditShortcutDefinitions.find(
    (definition) => definition.commandId === commandId
  );
  if (!shortcut) {
    throw new Error(`Missing parameter shortcut definition: ${commandId}`);
  }
  return shortcut;
};

const parameterValueShortcutItems: Record<ParameterValueKind, ShortcutHelpItem[]> = {
  text: [],
  number: [
    helpItem(parameterShortcut("incrementSelectedParameter")),
    helpItem(parameterShortcut("decrementSelectedParameter"))
  ],
  boolean: [helpItem(parameterShortcut("toggleSelectedBooleanParameter"))],
  reference: [
    {
      id: "cycleSelectedReferenceForward",
      commandId: "incrementSelectedParameter",
      label: "参照候補を次へ",
      keys: "ArrowRight"
    },
    {
      id: "cycleSelectedReferenceBackward",
      commandId: "decrementSelectedParameter",
      label: "参照候補を前へ",
      keys: "ArrowLeft"
    }
  ]
};

export const shortcutHelpItems = ({
  isParameterEditMode = false,
  selectedElement = null,
  selectedParameterKey = null
}: {
  isParameterEditMode?: boolean;
  selectedElement?: CadElement | null;
  selectedParameterKey?: string | null;
} = {}): ShortcutHelpItem[] => {
  if (!isParameterEditMode) {
    return [...globalShortcutDefinitions, ...shortcutDefinitions].map(helpItem);
  }

  const items = [
    ...globalShortcutDefinitions.map(helpItem),
    helpItem(parameterShortcut("exitParameterEditMode")),
    helpItem(parameterShortcut("focusSelectedParameterInput")),
    helpItem(parameterShortcut("selectNextParameter")),
    helpItem(parameterShortcut("selectPreviousParameter"))
  ];

  if (!selectedElement) {
    return items;
  }

  const selectedParameter = findParameterDefinition(selectedElement, selectedParameterKey);
  if (selectedParameter) {
    items.push(...parameterValueShortcutItems[selectedParameter.kind]);
  }

  const directKeys = getParameterDefinitions(selectedElement)
    .map((definition) => definition.directKey)
    .join(" / ");
  if (directKeys) {
    items.push({
      ...helpItem(parameterShortcut("selectParameterByKey")),
      keys: directKeys
    });
  }

  return items;
};

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

export const shouldIgnoreKeyboardEvent = (event: KeyboardEvent) => {
  if (isEditableKeyboardTarget(event)) return true;

  const tagName = eventTargetTagName(event);
  return tagName === "button" && (event.key === "Enter" || event.key === " ");
};

export const keyboardCommandForEvent = (
  event: KeyboardEvent,
  options: { isParameterEditMode?: boolean } = {}
): KeyboardCommand | null => {
  if (shouldIgnoreKeyboardEvent(event)) {
    return null;
  }

  const definitions = [
    ...globalShortcutDefinitions,
    ...(options.isParameterEditMode ? parameterEditShortcutDefinitions : shortcutDefinitions)
  ];
  const shortcut = definitions.find((definition) => definition.matches(event));
  if (!shortcut) return null;
  return {
    commandId: shortcut.commandId,
    context: shortcut.context?.(event)
  };
};

export const commandIdForKeyboardEvent = (
  event: KeyboardEvent,
  options: { isParameterEditMode?: boolean } = {}
): CommandId | null => {
  return keyboardCommandForEvent(event, options)?.commandId ?? null;
};
