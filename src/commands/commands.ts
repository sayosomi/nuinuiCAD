import { useCadStore } from "../state/useCadStore";
import type { CadElement, CadElementType, ElementId } from "../types/geometry";

export type CommandId =
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
  | "toggleShortcutHelp";

export type CommandContext = {
  focusCanvas?: () => void;
  focusElementList?: () => void;
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

const makeElement = (type: CadElementType, elements: CadElement[]): CadElement => {
  const points = elements.filter(
    (element) => element.type === "freePoint" || element.type === "offsetPoint"
  );
  const firstPointId = points[0]?.id ?? "";
  const secondPointId = points[1]?.id ?? firstPointId;

  switch (type) {
    case "freePoint":
      return {
        id: createId(type),
        name: `点${points.length + 1}`,
        type,
        visible: true,
        enabled: true,
        x: 80 + points.length * 20,
        y: 80 + points.length * 20
      };
    case "offsetPoint":
      return {
        id: createId(type),
        name: `オフセット点${points.length + 1}`,
        type,
        visible: true,
        enabled: true,
        fromPointId: firstPointId,
        dx: 30,
        dy: 0
      };
    case "line": {
      const lineCount = elements.filter((element) => element.type === "line").length;
      return {
        id: createId(type),
        name: `直線${lineCount + 1}`,
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
  useCadStore.setState({
    elements: [...elements, element],
    selectedElementId: element.id
  });
};

export const commands: Record<CommandId, Command> = {
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
      useCadStore.setState({ elements: nextElements });
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
      useCadStore.setState({ elements: nextElements });
    }
  },
  toggleSelectedElementVisibility: {
    id: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    run: () => {
      const { elements, selectedElementId } = useCadStore.getState();
      if (!selectedElementId) return;
      useCadStore.setState({
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
      useCadStore.setState({
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
  }
};

export const dispatchCommand = (commandId: CommandId, context?: CommandContext) => {
  commands[commandId].run(context);
};
