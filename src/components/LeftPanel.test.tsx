import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import type { CadElement, EvaluationResult } from "../types/geometry";

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
  errors: []
};

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    isParameterEditMode: false,
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    activePointPickTarget: null,
    selectedDependencyJumpIndex: 0,
    showShortcutHelp: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: []
  });
};

const renderRightPanel = () =>
  render(
    <RightPanel
      evaluation={emptyEvaluation}
      isParameterEditMode={false}
      isDependencyJumpMode={false}
      registerParameterControl={() => undefined}
    />
  );

const renderLeftPanel = () =>
  render(
    <LeftPanel
      evaluation={emptyEvaluation}
      elementListFocusRef={createRef<HTMLDivElement>()}
    />
  );

const renderShortcutHelpOverlay = (
  props = { isParameterEditMode: false, isDependencyJumpMode: false }
) => render(<ShortcutHelpOverlay {...props} />);

const dragDataTransfer = () => {
  const data: Record<string, string> = {};
  return {
    dropEffect: "",
    effectAllowed: "",
    getData: (type: string) => data[type] ?? "",
    setData: (type: string, value: string) => {
      data[type] = value;
    }
  } as unknown as DataTransfer;
};

const dragNumericInput = (
  input: HTMLElement,
  {
    button = 1,
    fromX = 0,
    toX
  }: {
    button?: number;
    fromX?: number;
    toX: number;
  }
) => {
  fireEvent.pointerDown(input, { button, clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(input, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(input, { clientX: toX, pointerId: 1 });
};

describe("LeftPanel numeric input dragging", () => {
  beforeEach(() => {
    resetStore();
  });

  it("rounds numeric parameter display to at most two decimal places", () => {
    const editedPoint: CadElement = {
      ...(sampleElements[0] as Extract<CadElement, { type: "freePoint" }>),
      x: 12.345,
      y: 67.8,
      numericParameterSteps: { x: 0.125 }
    };

    useCadStore.setState({
      elements: [
        editedPoint,
        ...sampleElements.slice(1)
      ]
    });

    renderRightPanel();

    expect(screen.getByLabelText("x 値")).toHaveValue("12.35");
    expect(screen.getByLabelText("y 値")).toHaveValue("67.8");
    expect(screen.getByDisplayValue("0.13")).toBeInTheDocument();
  });

  it("shows numeric variables for numeric elements", () => {
    useCadStore.setState({
      selectedElementId: "point-b",
      selectedElementIds: ["point-b"]
    });

    renderRightPanel();

    expect(screen.getByText("共通変数")).toBeInTheDocument();
    expect(screen.getByText("共通変数はありません。")).toBeInTheDocument();
  });

  it("shows numeric variables for line elements", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"]
    });

    renderRightPanel();

    expect(screen.getByText("共通変数")).toBeInTheDocument();
  });

  it("normalizes a blank numeric parameter input to zero", () => {
    renderRightPanel();

    fireEvent.change(screen.getByLabelText("x 値"), { target: { value: "" } });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 0 });
    expect(screen.getByLabelText("x 値")).toHaveValue("0");
  });

  it("increments a numeric parameter after an 8px middle-button drag to the right", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 8 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 51 });
  });

  it("decrements a numeric parameter after an 8px middle-button drag to the left", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { fromX: 8, toX: 0 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 49 });
  });

  it("applies one parameter step for each full 8px of middle-button drag", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 16 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 52 });
  });

  it("does not change a numeric parameter below the drag threshold", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 7 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
  });

  it("ignores left-button drags", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { button: 0, toX: 16 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
  });

  it("uses the selected parameter's configured numeric step", () => {
    useCadStore.setState({
      elements: [
        {
          ...sampleElements[0],
          numericParameterSteps: { x: 2.5 }
        },
        ...sampleElements.slice(1)
      ]
    });
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 8 });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 52.5 });
  });

  it("folds repeated middle-button drags into a stable expression offset", () => {
    useCadStore.setState({
      elements: [
        {
          ...(sampleElements[0] as Extract<CadElement, { type: "freePoint" }>),
          x: { kind: "expression", expression: "line-ab.length + 10" }
        },
        ...sampleElements.slice(1)
      ],
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectedParameterKey: "x"
    });
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 値"), { toX: 56 });

    expect(screen.getByLabelText("x 値")).toHaveValue("直線AB.長さ + 17");
    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length + 17" }
    });
  });

  it("keeps expression display stable when middle-button dragging back and forth", () => {
    useCadStore.setState({
      elements: [
        {
          ...(sampleElements[0] as Extract<CadElement, { type: "freePoint" }>),
          x: { kind: "expression", expression: "line-bc.startAngleDeg" }
        },
        ...sampleElements.slice(1)
      ],
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectedParameterKey: "x"
    });
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    dragNumericInput(input, { fromX: 240, toX: 0 });
    dragNumericInput(input, { fromX: 0, toX: 240 });
    dragNumericInput(input, { fromX: 240, toX: 0 });

    expect(screen.getByLabelText("x 値")).toHaveValue("直線BC.始角度 - 30");
    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-bc.startAngleDeg - 30" }
    });
  });
});

describe("Shortcut help display", () => {
  beforeEach(() => {
    resetStore();
  });

  it("keeps the right panel shortcut section compact", () => {
    useCadStore.setState({ showShortcutHelp: true });
    renderRightPanel();

    expect(screen.getByText("? でショートカット")).toBeInTheDocument();
    expect(screen.queryByText("選択要素を削除")).not.toBeInTheDocument();
  });

  it("shows shortcuts in an overlay when enabled", () => {
    useCadStore.setState({ showShortcutHelp: true });
    renderShortcutHelpOverlay();

    expect(screen.getByRole("dialog", { name: "ショートカット一覧" })).toBeInTheDocument();
    expect(screen.getByText("通常")).toBeInTheDocument();
    expect(screen.getByText("選択要素を削除")).toBeInTheDocument();
  });

  it("uses the parameter edit mode heading in the overlay", () => {
    useCadStore.setState({ showShortcutHelp: true });
    renderShortcutHelpOverlay({ isParameterEditMode: true, isDependencyJumpMode: false });

    expect(screen.getByText("パラメーター編集")).toBeInTheDocument();
  });

  it("closes the overlay with Escape", () => {
    useCadStore.setState({ showShortcutHelp: true });
    renderShortcutHelpOverlay();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useCadStore.getState().showShortcutHelp).toBe(false);
  });
});

describe("LeftPanel element list dragging", () => {
  beforeEach(() => {
    resetStore();
  });

  it("uses row styling instead of visible state text in the element list", () => {
    useCadStore.setState({
      elements: [
        { ...sampleElements[0], visible: false },
        { ...sampleElements[1], enabled: false },
        ...sampleElements.slice(2)
      ]
    });

    renderLeftPanel();

    expect(screen.queryByText("非表示")).not.toBeInTheDocument();
    expect(screen.queryByText("表示")).not.toBeInTheDocument();
    const hiddenRow = screen.getByText("点A").closest("[data-element-list-row='true']");
    const disabledRow = screen.getByText("点B").closest("[data-element-list-row='true']");
    expect(hiddenRow).toHaveClass("is-hidden");
    expect(disabledRow).toHaveClass("is-disabled");
    expect(hiddenRow?.querySelector(".element-status-icons")).toHaveAttribute("data-visible-state", "hidden");
    expect(disabledRow?.querySelector(".element-status-icons")).toHaveAttribute(
      "data-evaluation-state",
      "disabled"
    );
  });

  it("toggles row visibility from the status icon without changing selection", () => {
    renderLeftPanel();

    fireEvent.click(screen.getByLabelText("点Bを非表示にする"));

    const state = useCadStore.getState();
    expect(state.elements[0].visible).toBe(true);
    expect(state.elements[1].visible).toBe(false);
    expect(state.selectedElementId).toBe("point-a");
    expect(state.selectedElementIds).toEqual(["point-a"]);
  });

  it("toggles row enabled state from the status icon without changing selection", () => {
    renderLeftPanel();

    fireEvent.click(screen.getByLabelText("点Bを評価しない"));

    const state = useCadStore.getState();
    expect(state.elements[0].enabled).toBe(true);
    expect(state.elements[1].enabled).toBe(false);
    expect(state.selectedElementId).toBe("point-a");
    expect(state.selectedElementIds).toEqual(["point-a"]);
  });

  it("reorders elements by dragging a handle before another row", () => {
    renderLeftPanel();
    const dataTransfer = dragDataTransfer();
    const handle = screen.getByLabelText("点Aを並び替え");
    const targetRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(targetRow).toBeInstanceOf(HTMLElement);

    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(targetRow!, { dataTransfer });
    fireEvent.drop(targetRow!, { dataTransfer });

    expect(useCadStore.getState().elements.map((element) => element.id).slice(0, 4)).toEqual([
      "point-b",
      "point-c",
      "point-a",
      "line-ab"
    ]);
    expect(useCadStore.getState().selectedElementId).toBe("point-a");
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("selects a range with shift click and toggles with mod click", () => {
    renderLeftPanel();

    fireEvent.click(screen.getByText("点C").closest("[data-element-list-row='true']")!, {
      shiftKey: true
    });
    expect(useCadStore.getState().selectedElementIds).toEqual(["point-a", "point-b", "point-c"]);

    fireEvent.click(screen.getByText("点B").closest("[data-element-list-row='true']")!, {
      metaKey: true
    });
    expect(useCadStore.getState().selectedElementIds).toEqual(["point-a", "point-c"]);
  });

  it("applies a picked point from the element list while point picking", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "endPoint",
      activePointPickTarget: {
        elementId: "line-ab",
        parameterKey: "endPoint"
      }
    });
    renderLeftPanel();

    fireEvent.click(screen.getByText("点C").closest("[data-element-list-row='true']")!);

    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(useCadStore.getState().elements[3]).toMatchObject({
      endPoint: { mode: "reference", pointId: "point-c" }
    });
    expect(useCadStore.getState().selectedElementId).toBe("line-ab");
  });

  it("dims non-point rows and ignores them while point picking", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "endPoint",
      activePointPickTarget: {
        elementId: "line-ab",
        parameterKey: "endPoint"
      }
    });
    renderLeftPanel();

    const pointRow = screen.getByText("点C").closest("[data-element-list-row='true']");
    const lineRow = screen.getByText("直線BC").closest("[data-element-list-row='true']");
    expect(pointRow).toHaveClass("is-point-pick-candidate");
    expect(lineRow).toHaveClass("is-not-point-pick-candidate");

    fireEvent.click(lineRow!);

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "line-ab",
      parameterKey: "endPoint"
    });
    expect(useCadStore.getState().selectedElementId).toBe("line-ab");
    expect(useCadStore.getState().elements[3]).toMatchObject({
      endPoint: { mode: "reference", pointId: "point-b" }
    });
  });

  it("reorders selected elements together by dragging one selected handle", () => {
    useCadStore.setState({
      selectedElementId: "point-c",
      selectedElementIds: ["point-b", "point-c"],
      selectionAnchorElementId: "point-b"
    });
    renderLeftPanel();
    const dataTransfer = dragDataTransfer();
    const handle = screen.getByLabelText("点Cを並び替え");
    const targetRow = screen.getByText("直線BC").closest("[data-element-list-row='true']");
    expect(targetRow).toBeInstanceOf(HTMLElement);

    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(targetRow!, { dataTransfer });
    fireEvent.drop(targetRow!, { dataTransfer });

    expect(useCadStore.getState().elements.map((element) => element.id)).toEqual([
      "point-a",
      "line-ab",
      "point-b",
      "point-c",
      "line-bc",
      "curve-ac"
    ]);
    expect(useCadStore.getState().selectedElementIds).toEqual(["point-b", "point-c"]);
  });
});
