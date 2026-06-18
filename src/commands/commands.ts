import { useCadStore } from "../state/useCadStore";
import { makeUniqueElementName } from "../model/elementNames";
import { getDependencyJumpTargets } from "../model/dependencies";
import {
  findParameterByDirectKey,
  findParameterDefinition,
  getFirstParameterKey,
  getNumericParameterStep,
  getParameterDefinitions,
  normalizeParameterKey,
  pointReferenceOptions
} from "../parameters/parameterDefinitions";
import type { CadElement, CadElementType, ElementId } from "../types/geometry";

export type CommandId =
  | "undo"
  | "redo"
  | "selectNextElement"
  | "selectPreviousElement"
  | "moveSelectedElementUp"
  | "moveSelectedElementDown"
  | "toggleSelectedElementVisibility"
  | "deleteSelectedElement"
  | "addFreePoint"
  | "addOffsetPoint"
  | "addLine"
  | "zoomInCanvas"
  | "zoomOutCanvas"
  | "resetCanvasView"
  | "openCommandPalette"
  | "closeCommandPalette"
  | "focusCanvas"
  | "focusElementList"
  | "toggleShortcutHelp"
  | "toggleElementInfoPanel"
  | "enterDependencyJumpMode"
  | "exitDependencyJumpMode"
  | "selectNextDependencyJumpTarget"
  | "selectPreviousDependencyJumpTarget"
  | "jumpToSelectedDependencyTarget"
  | "enterParameterEditMode"
  | "exitParameterEditMode"
  | "selectNextParameter"
  | "selectPreviousParameter"
  | "selectParameterByKey"
  | "incrementSelectedParameter"
  | "decrementSelectedParameter"
  | "increaseSelectedParameterStep"
  | "decreaseSelectedParameterStep"
  | "cycleSelectedReferenceForward"
  | "cycleSelectedReferenceBackward"
  | "toggleSelectedBooleanParameter"
  | "focusSelectedParameterInput";

export type CommandContext = {
  focusCanvas?: () => void;
  focusElementList?: () => void;
  focusSelectedParameterInput?: () => void;
  getCanvasViewportRect?: () => DOMRect | null;
  parameterDirectKey?: string;
  stepMultiplier?: number;
};

export type Command = {
  id: CommandId;
  label: string;
  run: (context?: CommandContext) => void;
};

let idSequence = 1;

const createId = (type: CadElementType) => {
  idSequence += 1;
  return `${type}-${Date.now().toString(36)}-${idSequence}`;
};

const getSelectedIndex = (elements: CadElement[], selectedElementId: ElementId | null) =>
  selectedElementId ? elements.findIndex((element) => element.id === selectedElementId) : -1;

const getSelectedElement = () => {
  const { elements, selectedElementId } = useCadStore.getState();
  return selectedElementId ? elements.find((element) => element.id === selectedElementId) ?? null : null;
};

const updateSelectedElement = (updater: (element: CadElement) => CadElement) => {
  const { elements, selectedElementId } = useCadStore.getState();
  if (!selectedElementId) return;

  useCadStore.getState().commitDocumentChange({
    elements: elements.map((element) => (element.id === selectedElementId ? updater(element) : element))
  });
};

const selectedParameterDefinition = () => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return null;
  const { selectedParameterKey } = useCadStore.getState();
  return findParameterDefinition(selectedElement, selectedParameterKey);
};

const makeElement = (type: CadElementType, elements: CadElement[]): CadElement => {
  const points = elements.filter(
    (element) => element.type === "freePoint" || element.type === "offsetPoint"
  );
  const firstPointId = points[0]?.id ?? "";
  const secondPointId = points[1]?.id ?? firstPointId;
  const uniqueName = (elementId: ElementId, requestedName: string) =>
    makeUniqueElementName({
      elements,
      elementId,
      requestedName,
      fallbackBaseName: requestedName
    });

  switch (type) {
    case "freePoint": {
      const id = createId(type);
      const requestedName = `点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        x: 80 + points.length * 20,
        y: 80 + points.length * 20
      };
    }
    case "offsetPoint": {
      const id = createId(type);
      const requestedName = `オフセット点${points.length + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        fromPointId: firstPointId,
        dx: 30,
        dy: 0
      };
    }
    case "line": {
      const id = createId(type);
      const lineCount = elements.filter((element) => element.type === "line").length;
      const requestedName = `直線${lineCount + 1}`;
      return {
        id,
        name: uniqueName(id, requestedName),
        type,
        visible: true,
        enabled: true,
        startPointId: firstPointId,
        endPointId: secondPointId
      };
    }
  }
};

const addElement = (type: CadElementType) => {
  const { elements } = useCadStore.getState();
  const element = makeElement(type, elements);
  useCadStore.getState().commitDocumentChange({
    elements: [...elements, element],
    selectedElementId: element.id,
    selectedParameterKey: getFirstParameterKey(element)
  });
};

const selectParameterByOffset = (offset: number) => {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return;

  const definitions = getParameterDefinitions(selectedElement);
  const { selectedParameterKey } = useCadStore.getState();
  const index = definitions.findIndex((definition) => definition.key === selectedParameterKey);
  const currentIndex = index < 0 ? 0 : index;
  const nextIndex = (currentIndex + offset + definitions.length) % definitions.length;
  useCadStore.setState({ selectedParameterKey: definitions[nextIndex].key });
};

const stepForContext = (context?: CommandContext) => context?.stepMultiplier ?? 1;

const numericParameterStepLevels = [0.1, 1, 10, 100] as const;

const nextNumericParameterStep = (currentStep: number, direction: 1 | -1) => {
  if (direction > 0) {
    return numericParameterStepLevels.find((step) => step > currentStep) ?? numericParameterStepLevels.at(-1)!;
  }

  for (let index = numericParameterStepLevels.length - 1; index >= 0; index -= 1) {
    const step = numericParameterStepLevels[index];
    if (step < currentStep) return step;
  }
  return numericParameterStepLevels[0];
};

const updateNumericParameter = (direction: 1 | -1, context?: CommandContext) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || !definition) return;
  if (definition.kind === "reference") {
    cycleReferenceParameter(direction);
    return;
  }
  if (definition.kind !== "number") return;

  const delta = getNumericParameterStep(selectedElement, definition.key) * stepForContext(context) * direction;
  updateSelectedElement((element) => ({
    ...element,
    [definition.key]: Number(element[definition.key as keyof CadElement]) + delta
  } as CadElement));
};

const updateSelectedNumericParameterStep = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "number") return;

  const currentStep = getNumericParameterStep(selectedElement, definition.key);
  const nextStep = nextNumericParameterStep(currentStep, direction);
  updateSelectedElement((element) => ({
    ...element,
    numericParameterSteps: {
      ...element.numericParameterSteps,
      [definition.key]: nextStep
    }
  }));
};

const cycleReferenceParameter = (direction: 1 | -1) => {
  const selectedElement = getSelectedElement();
  const definition = selectedParameterDefinition();
  if (!selectedElement || definition?.kind !== "reference") return;

  const options = pointReferenceOptions(useCadStore.getState().elements);
  if (options.length === 0) return;

  const currentValue = selectedElement[definition.key as keyof CadElement] as ElementId;
  const currentIndex = options.indexOf(currentValue);
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + direction + options.length) % options.length;
  updateSelectedElement((element) => ({ ...element, [definition.key]: options[nextIndex] } as CadElement));
};

const toggleBooleanParameter = () => {
  const definition = selectedParameterDefinition();
  if (definition?.kind !== "boolean") return;

  updateSelectedElement((element) => ({
    ...element,
    [definition.key]: !element[definition.key as keyof CadElement]
  } as CadElement));
};

const selectedDependencyJumpTargets = () => {
  const { elements, selectedElementId } = useCadStore.getState();
  const selectedElement = selectedElementId
    ? elements.find((element) => element.id === selectedElementId) ?? null
    : null;
  return getDependencyJumpTargets(selectedElement, elements);
};

const selectDependencyJumpTargetByOffset = (offset: number) => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadStore.getState();
  const currentIndex =
    selectedDependencyJumpIndex >= 0 && selectedDependencyJumpIndex < targets.length
      ? selectedDependencyJumpIndex
      : 0;
  const nextIndex = (currentIndex + offset + targets.length) % targets.length;
  useCadStore.setState({ selectedDependencyJumpIndex: nextIndex });
};

const jumpToSelectedDependencyTarget = () => {
  const targets = selectedDependencyJumpTargets();
  if (targets.length === 0) {
    useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 });
    return;
  }

  const { selectedDependencyJumpIndex } = useCadStore.getState();
  const target = targets[Math.min(Math.max(selectedDependencyJumpIndex, 0), targets.length - 1)];
  if (!target) return;

  useCadStore.getState().setSelectedElementId(target.id);
  const nextTargets = selectedDependencyJumpTargets();
  useCadStore.setState({
    isDependencyJumpMode: nextTargets.length > 0,
    selectedDependencyJumpIndex: 0
  });
};

const canvasZoomAnchor = (context?: CommandContext) => {
  const rect = context?.getCanvasViewportRect?.();
  if (!rect) return undefined;
  return {
    x: rect.width / 2,
    y: rect.height / 2,
    width: rect.width,
    height: rect.height
  };
};

export const commands: Record<CommandId, Command> = {
  undo: {
    id: "undo",
    label: "元に戻す",
    run: () => useCadStore.getState().undo()
  },
  redo: {
    id: "redo",
    label: "やり直す",
    run: () => useCadStore.getState().redo()
  },
  selectNextElement: {
    id: "selectNextElement",
    label: "次の要素を選択",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      if (elements.length === 0) return;
      const index = getSelectedIndex(elements, selectedElementId);
      const nextIndex = index < 0 ? 0 : Math.min(index + 1, elements.length - 1);
      useCadStore.setState({ selectedElementId: elements[nextIndex].id });
    }
  },
  selectPreviousElement: {
    id: "selectPreviousElement",
    label: "前の要素を選択",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      if (elements.length === 0) return;
      const index = getSelectedIndex(elements, selectedElementId);
      const previousIndex = index < 0 ? 0 : Math.max(index - 1, 0);
      useCadStore.setState({ selectedElementId: elements[previousIndex].id });
    }
  },
  moveSelectedElementUp: {
    id: "moveSelectedElementUp",
    label: "選択要素を上へ",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      const index = getSelectedIndex(elements, selectedElementId);
      if (index <= 0) return;
      const nextElements = [...elements];
      [nextElements[index - 1], nextElements[index]] = [nextElements[index], nextElements[index - 1]];
      useCadStore.getState().commitDocumentChange({ elements: nextElements });
    }
  },
  moveSelectedElementDown: {
    id: "moveSelectedElementDown",
    label: "選択要素を下へ",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      const index = getSelectedIndex(elements, selectedElementId);
      if (index < 0 || index >= elements.length - 1) return;
      const nextElements = [...elements];
      [nextElements[index], nextElements[index + 1]] = [nextElements[index + 1], nextElements[index]];
      useCadStore.getState().commitDocumentChange({ elements: nextElements });
    }
  },
  toggleSelectedElementVisibility: {
    id: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      if (!selectedElementId) return;
      useCadStore.getState().commitDocumentChange({
        elements: elements.map((element) =>
          element.id === selectedElementId ? { ...element, visible: !element.visible } : element
        )
      });
    }
  },
  deleteSelectedElement: {
    id: "deleteSelectedElement",
    label: "選択要素を削除",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      const index = getSelectedIndex(elements, selectedElementId);
      if (index < 0) return;
      const nextElements = elements.filter((element) => element.id !== selectedElementId);
      useCadStore.getState().commitDocumentChange({
        elements: nextElements,
        selectedElementId: nextElements[Math.min(index, nextElements.length - 1)]?.id ?? null
      });
    }
  },
  addFreePoint: {
    id: "addFreePoint",
    label: "free point を追加",
    run: () => addElement("freePoint")
  },
  addOffsetPoint: {
    id: "addOffsetPoint",
    label: "offset point を追加",
    run: () => addElement("offsetPoint")
  },
  addLine: {
    id: "addLine",
    label: "line を追加",
    run: () => addElement("line")
  },
  zoomInCanvas: {
    id: "zoomInCanvas",
    label: "キャンバスを拡大",
    run: (context) => useCadStore.getState().zoomCanvasViewportAt(1.1, canvasZoomAnchor(context))
  },
  zoomOutCanvas: {
    id: "zoomOutCanvas",
    label: "キャンバスを縮小",
    run: (context) => useCadStore.getState().zoomCanvasViewportAt(1 / 1.1, canvasZoomAnchor(context))
  },
  resetCanvasView: {
    id: "resetCanvasView",
    label: "キャンバス表示をリセット",
    run: () => useCadStore.getState().resetCanvasViewport()
  },
  openCommandPalette: {
    id: "openCommandPalette",
    label: "コマンドパレットを開く",
    run: () => useCadStore.setState({ showCommandPalette: true })
  },
  closeCommandPalette: {
    id: "closeCommandPalette",
    label: "コマンドパレットを閉じる",
    run: () => useCadStore.setState({ showCommandPalette: false })
  },
  focusCanvas: {
    id: "focusCanvas",
    label: "キャンバスへフォーカス",
    run: (context) => context?.focusCanvas?.()
  },
  focusElementList: {
    id: "focusElementList",
    label: "要素リストへフォーカス",
    run: (context) => context?.focusElementList?.()
  },
  toggleShortcutHelp: {
    id: "toggleShortcutHelp",
    label: "ショートカット一覧を表示/非表示",
    run: () => {
      const { showShortcutHelp } = useCadStore.getState();
      useCadStore.setState({ showShortcutHelp: !showShortcutHelp });
    }
  },
  toggleElementInfoPanel: {
    id: "toggleElementInfoPanel",
    label: "要素詳細を表示/非表示",
    run: () => {
      const { showElementInfoPanel } = useCadStore.getState();
      useCadStore.setState({
        showElementInfoPanel: !showElementInfoPanel,
        isDependencyJumpMode: showElementInfoPanel ? false : useCadStore.getState().isDependencyJumpMode
      });
    }
  },
  enterDependencyJumpMode: {
    id: "enterDependencyJumpMode",
    label: "親子要素ジャンプモードに入る",
    run: () => {
      const targets = selectedDependencyJumpTargets();
      if (targets.length === 0) return;
      useCadStore.setState({
        showElementInfoPanel: true,
        isParameterEditMode: false,
        isDependencyJumpMode: true,
        selectedDependencyJumpIndex: 0
      });
    }
  },
  exitDependencyJumpMode: {
    id: "exitDependencyJumpMode",
    label: "親子要素ジャンプモードを終了",
    run: () => useCadStore.setState({ isDependencyJumpMode: false, selectedDependencyJumpIndex: 0 })
  },
  selectNextDependencyJumpTarget: {
    id: "selectNextDependencyJumpTarget",
    label: "次の親子要素を選択",
    run: () => selectDependencyJumpTargetByOffset(1)
  },
  selectPreviousDependencyJumpTarget: {
    id: "selectPreviousDependencyJumpTarget",
    label: "前の親子要素を選択",
    run: () => selectDependencyJumpTargetByOffset(-1)
  },
  jumpToSelectedDependencyTarget: {
    id: "jumpToSelectedDependencyTarget",
    label: "選択中の親子要素へジャンプ",
    run: () => jumpToSelectedDependencyTarget()
  },
  enterParameterEditMode: {
    id: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    run: () => {
      const selectedElement = getSelectedElement();
      if (!selectedElement) return;
      useCadStore.setState({
        isParameterEditMode: true,
        isDependencyJumpMode: false,
        selectedParameterKey: normalizeParameterKey(
          selectedElement,
          useCadStore.getState().selectedParameterKey
        )
      });
    }
  },
  exitParameterEditMode: {
    id: "exitParameterEditMode",
    label: "パラメーター編集モードを終了",
    run: () => useCadStore.setState({ isParameterEditMode: false })
  },
  selectNextParameter: {
    id: "selectNextParameter",
    label: "次のパラメーターを選択",
    run: () => selectParameterByOffset(1)
  },
  selectPreviousParameter: {
    id: "selectPreviousParameter",
    label: "前のパラメーターを選択",
    run: () => selectParameterByOffset(-1)
  },
  selectParameterByKey: {
    id: "selectParameterByKey",
    label: "キーでパラメーターを選択",
    run: (context) => {
      const selectedElement = getSelectedElement();
      if (!selectedElement || !context?.parameterDirectKey) return;
      const definition = findParameterByDirectKey(selectedElement, context.parameterDirectKey);
      if (!definition) return;
      useCadStore.setState({ selectedParameterKey: definition.key });
    }
  },
  incrementSelectedParameter: {
    id: "incrementSelectedParameter",
    label: "選択パラメーターを増やす",
    run: (context) => updateNumericParameter(1, context)
  },
  decrementSelectedParameter: {
    id: "decrementSelectedParameter",
    label: "選択パラメーターを減らす",
    run: (context) => updateNumericParameter(-1, context)
  },
  increaseSelectedParameterStep: {
    id: "increaseSelectedParameterStep",
    label: "増減単位を大きくする",
    run: () => updateSelectedNumericParameterStep(1)
  },
  decreaseSelectedParameterStep: {
    id: "decreaseSelectedParameterStep",
    label: "増減単位を小さくする",
    run: () => updateSelectedNumericParameterStep(-1)
  },
  cycleSelectedReferenceForward: {
    id: "cycleSelectedReferenceForward",
    label: "参照パラメーターを次へ",
    run: () => cycleReferenceParameter(1)
  },
  cycleSelectedReferenceBackward: {
    id: "cycleSelectedReferenceBackward",
    label: "参照パラメーターを前へ",
    run: () => cycleReferenceParameter(-1)
  },
  toggleSelectedBooleanParameter: {
    id: "toggleSelectedBooleanParameter",
    label: "真偽値パラメーターを切替",
    run: () => toggleBooleanParameter()
  },
  focusSelectedParameterInput: {
    id: "focusSelectedParameterInput",
    label: "選択パラメーターの入力欄へフォーカス",
    run: (context) => context?.focusSelectedParameterInput?.()
  }
};

export const dispatchCommand = (commandId: CommandId, context?: CommandContext) => {
  commands[commandId].run(context);
};

export type CommandPaletteItem = {
  commandId: CommandId;
  label: string;
  keywords: string[];
};

const paletteCommandIds: CommandId[] = [
  "addFreePoint",
  "addOffsetPoint",
  "addLine",
  "zoomInCanvas",
  "zoomOutCanvas",
  "resetCanvasView",
  "undo",
  "redo",
  "selectNextElement",
  "selectPreviousElement",
  "moveSelectedElementUp",
  "moveSelectedElementDown",
  "toggleSelectedElementVisibility",
  "deleteSelectedElement",
  "focusCanvas",
  "focusElementList",
  "toggleShortcutHelp",
  "toggleElementInfoPanel",
  "enterDependencyJumpMode",
  "enterParameterEditMode",
  "exitParameterEditMode",
  "focusSelectedParameterInput"
];

const paletteKeywords: Partial<Record<CommandId, string[]>> = {
  addFreePoint: ["point", "free", "free point", "点", "追加"],
  addOffsetPoint: ["offset", "offset point", "オフセット", "点", "追加"],
  addLine: ["line", "直線", "線", "追加"],
  zoomInCanvas: ["zoom", "in", "拡大", "キャンバス"],
  zoomOutCanvas: ["zoom", "out", "縮小", "キャンバス"],
  resetCanvasView: ["zoom", "reset", "pan", "origin", "リセット", "原点", "キャンバス"],
  undo: ["undo", "戻す"],
  redo: ["redo", "やり直す"],
  selectNextElement: ["select", "next", "次", "要素"],
  selectPreviousElement: ["select", "previous", "前", "要素"],
  moveSelectedElementUp: ["move", "up", "上", "並べ替え"],
  moveSelectedElementDown: ["move", "down", "下", "並べ替え"],
  toggleSelectedElementVisibility: ["visibility", "visible", "hide", "show", "表示", "非表示"],
  deleteSelectedElement: ["delete", "remove", "削除"],
  focusCanvas: ["focus", "canvas", "キャンバス"],
  focusElementList: ["focus", "element list", "構成リスト", "要素リスト"],
  toggleShortcutHelp: ["shortcut", "help", "ショートカット", "ヘルプ"],
  toggleElementInfoPanel: ["information", "info", "要素詳細", "折り畳み", "表示"],
  enterDependencyJumpMode: ["dependency", "parent", "child", "親子", "ジャンプ"],
  enterParameterEditMode: ["parameter", "edit", "パラメーター", "編集"],
  exitParameterEditMode: ["parameter", "edit", "escape", "パラメーター", "終了"],
  focusSelectedParameterInput: ["parameter", "input", "direct", "パラメーター", "入力"]
};

export const commandPaletteItems: CommandPaletteItem[] = paletteCommandIds.map((commandId) => ({
  commandId,
  label: commands[commandId].label,
  keywords: paletteKeywords[commandId] ?? []
}));

const normalizePaletteText = (text: string) => text.trim().toLowerCase();

export const filterCommandPaletteItems = (query: string) => {
  const normalizedQuery = normalizePaletteText(query);
  if (!normalizedQuery) return commandPaletteItems;

  return commandPaletteItems.filter((item) => {
    const searchableText = [item.commandId, item.label, ...item.keywords]
      .map(normalizePaletteText)
      .join(" ");
    return searchableText.includes(normalizedQuery);
  });
};
