import { commands, type CommandContext, type CommandId } from "../commands/commands";
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

const commandShortcut = (
  commandId: CommandId,
  shortcutIndex: number,
  matches: (event: KeyboardEvent) => boolean,
  context?: (event: KeyboardEvent) => CommandContext
): ShortcutDefinition => {
  const shortcut = commands[commandId].shortcuts?.[shortcutIndex];
  if (!shortcut) {
    throw new Error(`Missing shortcut metadata: ${commandId}#${shortcutIndex}`);
  }
  return {
    commandId,
    label: shortcut.label ?? commands[commandId].label,
    keys: shortcut.keys,
    matches,
    context
  };
};

export const globalShortcutDefinitions: ShortcutDefinition[] = [
  commandShortcut("openCommandPalette", 0, (event) => event.key === "/" && noModifier(event)),
  commandShortcut(
    "focusElementSearch",
    0,
    (event) => event.key.toLowerCase() === "f" && isMod(event) && !event.altKey && !event.shiftKey
  ),
  commandShortcut(
    "undo",
    0,
    (event) => event.key.toLowerCase() === "z" && isMod(event) && !event.altKey && !event.shiftKey
  ),
  commandShortcut(
    "redo",
    0,
    (event) => event.key.toLowerCase() === "y" && isMod(event) && !event.altKey && !event.shiftKey
  ),
  commandShortcut("enterElementListMode", 0, (event) => event.key.toLowerCase() === "g" && noModifier(event)),
  commandShortcut("enterParameterEditMode", 0, (event) => event.key.toLowerCase() === "e" && noModifier(event)),
  commandShortcut("enterDependencyJumpMode", 0, (event) => event.key.toLowerCase() === "j" && noModifier(event))
];

export const modeInvariantShortcutDefinitions: ShortcutDefinition[] = [
  commandShortcut("toggleElementInfoPanel", 0, (event) => event.key.toLowerCase() === "i" && noModifier(event)),
  commandShortcut(
    "toggleShortcutHelp",
    0,
    (event) => event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey
  )
];

export const shortcutDefinitions: ShortcutDefinition[] = [
  commandShortcut(
    "groupSelectedElements",
    0,
    (event) => event.key.toLowerCase() === "g" && isMod(event) && !event.altKey && !event.shiftKey
  ),
  commandShortcut(
    "ungroupSelectedGroup",
    0,
    (event) => event.key.toLowerCase() === "g" && isMod(event) && !event.altKey && event.shiftKey
  ),
  commandShortcut(
    "moveSelectedElementUp",
    0,
    (event) =>
      event.key === "ArrowUp" &&
      ((isMod(event) && !event.altKey) ||
        (event.altKey && !event.metaKey && !event.ctrlKey && isElementListTarget(event)))
  ),
  commandShortcut(
    "moveSelectedElementDown",
    0,
    (event) =>
      event.key === "ArrowDown" &&
      ((isMod(event) && !event.altKey) ||
        (event.altKey && !event.metaKey && !event.ctrlKey && isElementListTarget(event)))
  ),
  commandShortcut("selectPreviousElement", 0, (event) => event.key === "ArrowUp" && noModifier(event)),
  commandShortcut("selectNextElement", 0, (event) => event.key === "ArrowDown" && noModifier(event)),
  commandShortcut(
    "extendSelectionToPreviousElement",
    0,
    (event) => event.key === "ArrowUp" && shiftOnly(event)
  ),
  commandShortcut(
    "extendSelectionToNextElement",
    0,
    (event) => event.key === "ArrowDown" && shiftOnly(event)
  ),
  commandShortcut("toggleGroupExpanded", 0, (event) => event.key === "ArrowRight" && noModifier(event)),
  commandShortcut("selectParentGroup", 0, (event) => event.key === "ArrowLeft" && noModifier(event)),
  commandShortcut(
    "outdentSelectedElements",
    0,
    (event) => event.key === "[" && noModifier(event) && isElementListTarget(event)
  ),
  commandShortcut(
    "indentSelectedElements",
    0,
    (event) => event.key === "]" && noModifier(event) && isElementListTarget(event)
  ),
  commandShortcut(
    "deleteSelectedElement",
    0,
    (event) =>
      (event.key.toLowerCase() === "d" || event.key === "Delete" || event.key === "Backspace") &&
      noModifier(event)
  ),
  commandShortcut(
    "toggleSelectedElementVisibility",
    0,
    (event) => event.key.toLowerCase() === "v" && noModifier(event)
  ),
  commandShortcut(
    "toggleSelectedElementEnabled",
    0,
    (event) => event.key.toLowerCase() === "a" && noModifier(event)
  ),
  commandShortcut("enterParameterEditMode", 1, (event) => event.key === "Enter" && noModifier(event)),
  commandShortcut("zoomInCanvas", 0, (event) => (event.key === "+" || event.key === "=") && noModifier(event)),
  commandShortcut("zoomOutCanvas", 0, (event) => event.key === "-" && noModifier(event)),
  commandShortcut("resetCanvasView", 0, (event) => event.key === "0" && noModifier(event)),
  commandShortcut("addIntersectionPoint", 0, (event) => event.key.toLowerCase() === "x" && noModifier(event)),
  commandShortcut("addBezierCurve", 0, (event) => event.key.toLowerCase() === "c" && noModifier(event)),
  commandShortcut("addCornerRadiusArcLine", 0, (event) => event.key.toLowerCase() === "r" && shiftOnly(event)),
  commandShortcut("addOffsetLine", 0, (event) => event.key.toLowerCase() === "o" && shiftOnly(event))
];

export const dependencyJumpShortcutDefinitions: ShortcutDefinition[] = [
  commandShortcut("exitDependencyJumpMode", 0, (event) => event.key === "Escape" && noModifier(event)),
  commandShortcut("jumpToSelectedDependencyTarget", 0, (event) => event.key === "Enter" && noModifier(event)),
  commandShortcut(
    "selectNextDependencyJumpTarget",
    0,
    (event) => event.key === "ArrowDown" && noModifier(event)
  ),
  commandShortcut(
    "selectPreviousDependencyJumpTarget",
    0,
    (event) => event.key === "ArrowUp" && noModifier(event)
  ),
  commandShortcut("selectPreviousElement", 1, (event) => event.key === "ArrowUp" && shiftOnly(event)),
  commandShortcut("selectNextElement", 1, (event) => event.key === "ArrowDown" && shiftOnly(event))
];

export const pickShortcutDefinitions: ShortcutDefinition[] = [
  commandShortcut("selectPreviousPickCandidate", 0, (event) => event.key === "ArrowUp" && noModifier(event)),
  commandShortcut("selectNextPickCandidate", 0, (event) => event.key === "ArrowDown" && noModifier(event)),
  commandShortcut("selectPreviousPickOption", 0, (event) => event.key === "ArrowLeft" && noModifier(event)),
  commandShortcut("selectNextPickOption", 0, (event) => event.key === "ArrowRight" && noModifier(event)),
  commandShortcut("applySelectedPickCandidate", 0, (event) => event.key === "Enter" && noModifier(event))
];

const arrowStepContext = (event: KeyboardEvent): CommandContext => ({
  stepMultiplier: event.shiftKey ? 10 : event.altKey ? 0.1 : 1
});

export const parameterEditShortcutDefinitions: ShortcutDefinition[] = [
  commandShortcut("exitParameterEditMode", 0, (event) => event.key === "Escape" && noModifier(event)),
  commandShortcut("activateSelectedParameter", 0, (event) => event.key === "Enter" && noModifier(event)),
  commandShortcut("selectNextParameter", 0, (event) => event.key === "ArrowDown" && noModifier(event)),
  commandShortcut("selectPreviousParameter", 0, (event) => event.key === "ArrowUp" && noModifier(event)),
  commandShortcut("selectPreviousElement", 1, (event) => event.key === "ArrowUp" && shiftOnly(event)),
  commandShortcut("selectNextElement", 1, (event) => event.key === "ArrowDown" && shiftOnly(event)),
  commandShortcut(
    "incrementSelectedParameter",
    0,
    (event) => event.key === "ArrowRight" && !event.metaKey && !event.ctrlKey,
    arrowStepContext
  ),
  commandShortcut(
    "decrementSelectedParameter",
    0,
    (event) => event.key === "ArrowLeft" && !event.metaKey && !event.ctrlKey,
    arrowStepContext
  ),
  commandShortcut("decreaseSelectedParameterStep", 0, (event) => event.key === "[" && noModifier(event)),
  commandShortcut("increaseSelectedParameterStep", 0, (event) => event.key === "]" && noModifier(event)),
  commandShortcut("toggleSelectedParameterValue", 0, (event) => event.key === " " && noModifier(event)),
  commandShortcut(
    "toggleBooleanParameterByDirectKey",
    0,
    (event) => ["v", "a"].includes(event.key.toLowerCase()) && noModifier(event),
    (event) => ({ parameterDirectKey: event.key.toLowerCase() })
  ),
  commandShortcut(
    "selectParameterByKey",
    0,
    (event) => /^[a-z0-9]$/i.test(event.key) && noModifier(event),
    (event) => ({ parameterDirectKey: event.key.toLowerCase() })
  )
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
  if (shortcut.commandId !== "focusElementSearch" && shouldIgnoreKeyboardEvent(event)) return null;
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
