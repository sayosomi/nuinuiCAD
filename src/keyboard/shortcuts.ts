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
const shiftOnly = (event: KeyboardEvent) =>
  event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;

export const globalShortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "openCommandPalette",
    label: "コマンドパレットを開く",
    keys: "/",
    matches: (event) => event.key === "/" && noModifier(event)
  },
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
  },
  {
    commandId: "enterElementListMode",
    label: "構成リストモードに入る",
    keys: "g",
    matches: (event) => event.key.toLowerCase() === "g" && noModifier(event)
  },
  {
    commandId: "enterParameterEditMode",
    label: "要素設定モードに入る",
    keys: "e",
    matches: (event) => event.key.toLowerCase() === "e" && noModifier(event)
  },
  {
    commandId: "enterDependencyJumpMode",
    label: "親子ジャンプモードに入る",
    keys: "j",
    matches: (event) => event.key.toLowerCase() === "j" && noModifier(event)
  }
];

export const modeInvariantShortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "toggleElementInfoPanel",
    label: "要素詳細を表示/非表示",
    keys: "i",
    matches: (event) => event.key.toLowerCase() === "i" && noModifier(event)
  },
  {
    commandId: "toggleShortcutHelp",
    label: "ショートカット一覧を表示/非表示",
    keys: "?",
    matches: (event) => event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey
  }
];

export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "moveSelectedElementUp",
    label: "選択要素を上へ移動",
    keys: "Mod+ArrowUp / Alt+ArrowUp",
    matches: (event) =>
      event.key === "ArrowUp" &&
      ((isMod(event) && !event.altKey) ||
        (event.altKey && !event.metaKey && !event.ctrlKey && isElementListTarget(event)))
  },
  {
    commandId: "moveSelectedElementDown",
    label: "選択要素を下へ移動",
    keys: "Mod+ArrowDown / Alt+ArrowDown",
    matches: (event) =>
      event.key === "ArrowDown" &&
      ((isMod(event) && !event.altKey) ||
        (event.altKey && !event.metaKey && !event.ctrlKey && isElementListTarget(event)))
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
    commandId: "extendSelectionToPreviousElement",
    label: "前の要素まで選択",
    keys: "Shift+ArrowUp",
    matches: (event) => event.key === "ArrowUp" && shiftOnly(event)
  },
  {
    commandId: "extendSelectionToNextElement",
    label: "次の要素まで選択",
    keys: "Shift+ArrowDown",
    matches: (event) => event.key === "ArrowDown" && shiftOnly(event)
  },
  {
    commandId: "deleteSelectedElement",
    label: "選択要素を削除",
    keys: "d / Delete / Backspace",
    matches: (event) =>
      (event.key.toLowerCase() === "d" || event.key === "Delete" || event.key === "Backspace") &&
      noModifier(event)
  },
  {
    commandId: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    keys: "v",
    matches: (event) => event.key.toLowerCase() === "v" && noModifier(event)
  },
  {
    commandId: "toggleSelectedElementEnabled",
    label: "評価する/しないを切替",
    keys: "a",
    matches: (event) => event.key.toLowerCase() === "a" && noModifier(event)
  },
  {
    commandId: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    keys: "Enter",
    matches: (event) => event.key === "Enter" && noModifier(event)
  },
  {
    commandId: "zoomInCanvas",
    label: "キャンバスを拡大",
    keys: "+ / =",
    matches: (event) => (event.key === "+" || event.key === "=") && noModifier(event)
  },
  {
    commandId: "zoomOutCanvas",
    label: "キャンバスを縮小",
    keys: "-",
    matches: (event) => event.key === "-" && noModifier(event)
  },
  {
    commandId: "resetCanvasView",
    label: "キャンバス表示をリセット",
    keys: "0",
    matches: (event) => event.key === "0" && noModifier(event)
  },
  {
    commandId: "addIntersectionPoint",
    label: "交点を追加",
    keys: "x",
    matches: (event) => event.key.toLowerCase() === "x" && noModifier(event)
  },
  {
    commandId: "addBezierCurve",
    label: "曲線を追加",
    keys: "c",
    matches: (event) => event.key.toLowerCase() === "c" && noModifier(event)
  },
  {
    commandId: "addOffsetLine",
    label: "オフセット線を追加",
    keys: "Shift+O",
    matches: (event) => event.key.toLowerCase() === "o" && shiftOnly(event)
  }
];

export const dependencyJumpShortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "exitDependencyJumpMode",
    label: "親子要素ジャンプモードを終了",
    keys: "Escape",
    matches: (event) => event.key === "Escape" && noModifier(event)
  },
  {
    commandId: "jumpToSelectedDependencyTarget",
    label: "選択中の親子要素へジャンプ",
    keys: "Enter",
    matches: (event) => event.key === "Enter" && noModifier(event)
  },
  {
    commandId: "selectNextDependencyJumpTarget",
    label: "次の親子要素を選択",
    keys: "ArrowDown",
    matches: (event) => event.key === "ArrowDown" && noModifier(event)
  },
  {
    commandId: "selectPreviousDependencyJumpTarget",
    label: "前の親子要素を選択",
    keys: "ArrowUp",
    matches: (event) => event.key === "ArrowUp" && noModifier(event)
  },
  {
    commandId: "selectPreviousElement",
    label: "前の要素を選択",
    keys: "Shift+ArrowUp",
    matches: (event) => event.key === "ArrowUp" && shiftOnly(event)
  },
  {
    commandId: "selectNextElement",
    label: "次の要素を選択",
    keys: "Shift+ArrowDown",
    matches: (event) => event.key === "ArrowDown" && shiftOnly(event)
  }
];

export const pickShortcutDefinitions: ShortcutDefinition[] = [
  {
    commandId: "selectPreviousPickCandidate",
    label: "前の選択候補へ",
    keys: "ArrowUp",
    matches: (event) => event.key === "ArrowUp" && noModifier(event)
  },
  {
    commandId: "selectNextPickCandidate",
    label: "次の選択候補へ",
    keys: "ArrowDown",
    matches: (event) => event.key === "ArrowDown" && noModifier(event)
  },
  {
    commandId: "selectPreviousPickOption",
    label: "行内の前の候補へ",
    keys: "ArrowLeft",
    matches: (event) => event.key === "ArrowLeft" && noModifier(event)
  },
  {
    commandId: "selectNextPickOption",
    label: "行内の次の候補へ",
    keys: "ArrowRight",
    matches: (event) => event.key === "ArrowRight" && noModifier(event)
  },
  {
    commandId: "applySelectedPickCandidate",
    label: "選択候補を確定",
    keys: "Enter",
    matches: (event) => event.key === "Enter" && noModifier(event)
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
    commandId: "activateSelectedParameter",
    label: "選択パラメーターを実行",
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
    commandId: "selectPreviousElement",
    label: "前の要素を選択",
    keys: "Shift+ArrowUp",
    matches: (event) => event.key === "ArrowUp" && shiftOnly(event)
  },
  {
    commandId: "selectNextElement",
    label: "次の要素を選択",
    keys: "Shift+ArrowDown",
    matches: (event) => event.key === "ArrowDown" && shiftOnly(event)
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
    commandId: "decreaseSelectedParameterStep",
    label: "増減単位を小さくする",
    keys: "[",
    matches: (event) => event.key === "[" && noModifier(event)
  },
  {
    commandId: "increaseSelectedParameterStep",
    label: "増減単位を大きくする",
    keys: "]",
    matches: (event) => event.key === "]" && noModifier(event)
  },
  {
    commandId: "toggleSelectedParameterValue",
    label: "値または指定方法を切替",
    keys: "Space",
    matches: (event) => event.key === " " && noModifier(event)
  },
  {
    commandId: "toggleBooleanParameterByDirectKey",
    label: "表示/評価を切替",
    keys: "v / a",
    matches: (event) => ["v", "a"].includes(event.key.toLowerCase()) && noModifier(event),
    context: (event) => ({ parameterDirectKey: event.key.toLowerCase() })
  },
  {
    commandId: "selectParameterByKey",
    label: "名前キーでパラメーターを選択",
    keys: "n / x / y / b / s / t / r / h / m / u / i / o / e / g / 1 / 2 / 3",
    matches: (event) => /^[a-z0-9]$/i.test(event.key) && noModifier(event),
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

const parameterModeElementSelectionShortcutItems = [
  helpItem(parameterShortcut("selectPreviousElement")),
  helpItem(parameterShortcut("selectNextElement"))
];

const parameterValueShortcutItems: Record<ParameterValueKind, ShortcutHelpItem[]> = {
  text: [],
  number: [
    helpItem(parameterShortcut("incrementSelectedParameter")),
    helpItem(parameterShortcut("decrementSelectedParameter")),
    helpItem(parameterShortcut("decreaseSelectedParameterStep")),
    helpItem(parameterShortcut("increaseSelectedParameterStep"))
  ],
  boolean: [helpItem(parameterShortcut("toggleSelectedParameterValue"))],
  lineReference: [
    {
      id: "cycleSelectedLineReferenceForward",
      commandId: "incrementSelectedParameter",
      label: "線候補を次へ",
      keys: "ArrowRight"
    },
    {
      id: "cycleSelectedLineReferenceBackward",
      commandId: "decrementSelectedParameter",
      label: "線候補を前へ",
      keys: "ArrowLeft"
    }
  ],
  lineReferenceList: [],
  lineEndpointReference: [
    {
      id: "cycleSelectedLineEndpointForward",
      commandId: "incrementSelectedParameter",
      label: "端点候補を次へ",
      keys: "ArrowRight"
    },
    {
      id: "cycleSelectedLineEndpointBackward",
      commandId: "decrementSelectedParameter",
      label: "端点候補を前へ",
      keys: "ArrowLeft"
    }
  ],
  choice: [
    {
      id: "cycleSelectedChoiceForward",
      commandId: "incrementSelectedParameter",
      label: "候補を次へ",
      keys: "ArrowRight"
    },
    {
      id: "cycleSelectedChoiceBackward",
      commandId: "decrementSelectedParameter",
      label: "候補を前へ",
      keys: "ArrowLeft"
    }
  ],
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
  isDependencyJumpMode = false,
  isPickMode = false,
  selectedElement = null,
  selectedParameterKey = null
}: {
  isParameterEditMode?: boolean;
  isDependencyJumpMode?: boolean;
  isPickMode?: boolean;
  selectedElement?: CadElement | null;
  selectedParameterKey?: string | null;
} = {}): ShortcutHelpItem[] => {
  if (isPickMode) {
    return [
      ...globalShortcutDefinitions,
      ...modeInvariantShortcutDefinitions,
      ...pickShortcutDefinitions
    ].map(helpItem);
  }

  if (!isParameterEditMode) {
    if (isDependencyJumpMode) {
      return [
        ...globalShortcutDefinitions,
        ...modeInvariantShortcutDefinitions,
        ...dependencyJumpShortcutDefinitions
      ].map(helpItem);
    }

    return [
      ...globalShortcutDefinitions,
      ...modeInvariantShortcutDefinitions,
      ...shortcutDefinitions
    ].map(helpItem);
  }

  const items = [
    ...globalShortcutDefinitions.map(helpItem),
    ...modeInvariantShortcutDefinitions.map(helpItem),
    helpItem(parameterShortcut("exitParameterEditMode")),
    helpItem(parameterShortcut("activateSelectedParameter")),
    helpItem(parameterShortcut("selectNextParameter")),
    helpItem(parameterShortcut("selectPreviousParameter")),
    ...parameterModeElementSelectionShortcutItems
  ];

  if (!selectedElement) {
    return items;
  }

  const selectedParameter = findParameterDefinition(selectedElement, selectedParameterKey);
  if (selectedParameter) {
    items.push(...parameterValueShortcutItems[selectedParameter.kind]);
    if (selectedParameter.kind === "reference" && selectedParameter.allowCoordinate) {
      items.push(helpItem(parameterShortcut("toggleSelectedParameterValue")));
    }
  }

  items.push(helpItem(parameterShortcut("toggleBooleanParameterByDirectKey")));

  const directKeys = getParameterDefinitions(selectedElement)
    .filter((definition) => !["v", "a"].includes(definition.directKey))
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
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
    isPickMode?: boolean;
  } = {}
): KeyboardCommand | null => {
  const definitions = [
    ...globalShortcutDefinitions,
    ...modeInvariantShortcutDefinitions,
    ...(options.isPickMode
      ? pickShortcutDefinitions
      : options.isParameterEditMode
        ? parameterEditShortcutDefinitions
        : options.isDependencyJumpMode
        ? dependencyJumpShortcutDefinitions
        : shortcutDefinitions)
  ];
  const shortcut = definitions.find((definition) => definition.matches(event));
  if (!shortcut) return null;
  if (shouldIgnoreKeyboardEvent(event)) return null;
  return {
    commandId: shortcut.commandId,
    context: shortcut.context?.(event)
  };
};

export const commandIdForKeyboardEvent = (
  event: KeyboardEvent,
  options: {
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
    isPickMode?: boolean;
  } = {}
): CommandId | null => {
  return keyboardCommandForEvent(event, options)?.commandId ?? null;
};
