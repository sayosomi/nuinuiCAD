import { useCadStore } from "../state/useCadStore";
import { makeUniqueElementName } from "../model/elementNames";
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
  | "focusCanvas"
  | "focusElementList"
  | "toggleShortcutHelp"
  | "enterParameterEditMode"
  | "exitParameterEditMode"
  | "selectNextParameter"
  | "selectPreviousParameter"
  | "selectParameterByKey"
  | "incrementSelectedParameter"
  | "decrementSelectedParameter"
  | "cycleSelectedReferenceForward"
  | "cycleSelectedReferenceBackward"
  | "toggleSelectedBooleanParameter"
  | "focusSelectedParameterInput";

export type CommandContext = {
  focusCanvas?: () => void;
  focusElementList?: () => void;
  focusSelectedParameterInput?: () => void;
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
  enterParameterEditMode: {
    id: "enterParameterEditMode",
    label: "パラメーター編集モードに入る",
    run: () => {
      const selectedElement = getSelectedElement();
      if (!selectedElement) return;
      useCadStore.setState({
        isParameterEditMode: true,
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
