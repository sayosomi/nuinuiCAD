import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, useCadStore } from "../state/useCadStore";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { dispatchCommand } from "../commands/commands";

const emptyEvaluation: EvaluationResult = {
  computedGeometry: new Map(),
  computedVariables: new Map(),
  errors: [],
  warnings: []
};

const evaluationEngineState = (
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation: emptyEvaluation,
  mode: "rust",
  source: "rust",
  status: "ready",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const resetStore = () => {
  useCadStore.setState({
    elements: sampleElements,
    evaluationLimitIndex: sampleElements.length,
    selectedElementId: sampleElements[0].id,
    selectedElementIds: [sampleElements[0].id],
    selectionAnchorElementId: sampleElements[0].id,
    isParameterEditMode: false,
    selectedParameterKey: "name",
    showElementInfoPanel: true,
    isDependencyJumpMode: false,
    activePointPickTarget: null,
    activeNumericReferencePickTarget: null,
    activeLinePickTarget: null,
    activeExpressionInsertTarget: null,
    activeMeasurementInsertTarget: null,
    activePickCursor: null,
    selectedDependencyJumpIndex: 0,
    elementSearchQuery: "",
    elementSearchCursorId: null,
    elementSearchPickableOnly: false,
    showCanvasElementNames: true,
    showCanvasPoints: true,
    showShortcutHelp: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
};

const renderRightPanel = (
  evaluation = emptyEvaluation,
  engineState?: EvaluationEngineState,
  options: {
    isParameterEditMode?: boolean;
    isDependencyJumpMode?: boolean;
  } = {}
) =>
  render(
    <RightPanel
      evaluation={evaluation}
      evaluationState={engineState}
      isParameterEditMode={options.isParameterEditMode ?? false}
      isDependencyJumpMode={options.isDependencyJumpMode ?? false}
      registerParameterControl={() => undefined}
    />
  );

const renderLeftPanel = (evaluation = emptyEvaluation) =>
  render(
    <LeftPanel
      evaluation={evaluation}
      elementListFocusRef={createRef<HTMLDivElement>()}
      elementSearchInputRef={createRef<HTMLInputElement>()}
    />
  );

const renderShortcutHelpOverlay = (
  props = { isParameterEditMode: false, isDependencyJumpMode: false }
) => render(<ShortcutHelpOverlay {...props} />);

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

const mockElementListRowRects = () => {
  document.querySelectorAll<HTMLElement>("[data-element-list-row='true']").forEach((row, index) => {
    row.getBoundingClientRect = () => ({
      x: 0,
      y: index * 100,
      top: index * 100,
      left: 0,
      right: 320,
      bottom: index * 100 + 100,
      width: 320,
      height: 100,
      toJSON: () => ({})
    });
  });
};

const mockScrollableElementListRects = () => {
  const list = document.querySelector<HTMLElement>("[data-element-list='true']");
  expect(list).toBeInstanceOf(HTMLElement);
  list!.scrollTop = 0;
  list!.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 320,
    bottom: 100,
    width: 320,
    height: 100,
    toJSON: () => ({})
  });
  document.querySelectorAll<HTMLElement>("[data-element-list-row='true']").forEach((row, index) => {
    row.getBoundingClientRect = () => {
      const top = index * 100 - list!.scrollTop;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 320,
        bottom: top + 100,
        width: 320,
        height: 100,
        toJSON: () => ({})
      };
    };
  });
  return list!;
};

const mockAnimationFrames = () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  return {
    runNextFrame: () => {
      const callback = callbacks.shift();
      if (!callback) return;
      act(() => {
        callback(performance.now());
      });
    }
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LeftPanel numeric input dragging", () => {
  beforeEach(() => {
    resetStore();
  });

  it("shows the current document file state", () => {
    useCadStore.setState({
      currentFilePath: "/tmp/pattern.nuinui.json",
      dirtySinceSave: true
    });

    renderLeftPanel();

    expect(screen.getByText("pattern.nuinui.json")).toBeInTheDocument();
    expect(screen.getByText("未保存の変更")).toBeInTheDocument();
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

    expect(screen.getByText("要素内変数")).toBeInTheDocument();
    expect(screen.getByText("要素内変数はありません。")).toBeInTheDocument();
  });

  it("shows numeric variables for line elements", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"]
    });

    renderRightPanel();

    expect(screen.getByText("要素内変数")).toBeInTheDocument();
  });

  it("scrolls the selected right-panel parameter into view while parameter edit mode moves", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    const animationFrames = mockAnimationFrames();
    renderRightPanel(emptyEvaluation, undefined, { isParameterEditMode: true });
    animationFrames.runNextFrame();
    scrollIntoView.mockClear();

    act(() => {
      useCadStore.setState({ selectedParameterKey: "y" });
    });
    animationFrames.runNextFrame();

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest"
    });
    expect(document.querySelector(".right-panel .selected-parameter")).toContainElement(
      screen.getByLabelText("y 値")
    );
  });

  it("marks a coordinate point-anchor parent parameter as selected", () => {
    const lineWithCoordinateStart: CadElement = {
      ...(sampleElements[3] as Extract<CadElement, { type: "line" }>),
      startPoint: { mode: "coordinate", x: 10, y: -20 }
    };
    useCadStore.setState({
      elements: [
        ...sampleElements.slice(0, 3),
        lineWithCoordinateStart,
        ...sampleElements.slice(4)
      ],
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "startPoint"
    });

    renderRightPanel(emptyEvaluation, undefined, { isParameterEditMode: true });

    expect(
      document.querySelector(".right-panel .point-anchor-editor.selected-parameter")
    ).toBeInTheDocument();
  });

  it("keeps a blank numeric parameter input while focused and commits zero on blur", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
    expect(input).toHaveValue("");

    fireEvent.blur(input);

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 0 });
    expect(input).toHaveValue("0");
  });

  it("lets a numeric parameter expression start with a local variable reference", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "@v1" } });

    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "@v1" }
    });
    expect(input).toHaveValue("@v1");
  });

  it("shows a numeric expression inserted while a blank input draft is focused", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    act(() => {
      dispatchCommand("insertNumericExpressionSnippet", {
        elementId: "point-a",
        parameterKey: "x",
        numericExpressionSnippet: "line-ab.length",
        displayedExpression: (input as HTMLInputElement).value,
        selectionStart: null,
        selectionEnd: null
      });
    });

    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });
    expect(input).toHaveValue("直線AB.長さ");
  });

  it("keeps an incomplete negative numeric input until it becomes a valid number", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "-" } });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
    expect(input).toHaveValue("-");

    fireEvent.change(input, { target: { value: "-12" } });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: -12 });
    expect(input).toHaveValue("-12");
  });

  it("starts numeric reference picking from a numeric parameter", () => {
    renderRightPanel();

    expect(screen.queryByText("参照数値")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("数値選択")[0]);

    expect(useCadStore.getState().activeNumericReferencePickTarget).toEqual({
      elementId: "point-a",
      parameterKey: "x"
    });
    expect(screen.getByText("数値選択中")).toBeInTheDocument();
  });

  it("inserts point distance measurements into variable expressions", () => {
    const variable: CadElement = {
      id: "variable",
      name: "変数",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 0,
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };
    useCadStore.setState({
      elements: [...sampleElements, variable],
      selectedElementId: "variable",
      selectedElementIds: ["variable"],
      selectedParameterKey: "expression"
    });
    renderRightPanel();

    expect(screen.queryByText("測定・参照を挿入")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("参照を挿入"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("点を選択")[0]);
    act(() => {
      dispatchCommand("applyPickedPoint", { pickedPointId: "point-a" });
    });
    fireEvent.click(screen.getAllByText("点を選択").at(-1)!);
    act(() => {
      dispatchCommand("applyPickedPoint", { pickedPointId: "point-b" });
    });
    fireEvent.click(screen.getByText("式に挿入"));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      expression: { kind: "expression", expression: "距離(point-a, point-b)" }
    });
  });

  it("inserts point-line distance measurements into variable expressions", () => {
    const variable: CadElement = {
      id: "variable",
      name: "変数",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 0,
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };
    useCadStore.setState({
      elements: [...sampleElements, variable],
      selectedElementId: "variable",
      selectedElementIds: ["variable"],
      selectedParameterKey: "expression"
    });
    renderRightPanel();

    fireEvent.click(screen.getByText("参照を挿入"));
    fireEvent.click(screen.getAllByText("点と線の距離").at(-1)!);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("点を選択"));
    act(() => {
      dispatchCommand("applyPickedPoint", { pickedPointId: "point-c" });
    });
    fireEvent.click(screen.getByText("線を選択"));
    act(() => {
      dispatchCommand("applyPickedLine", { pickedLineId: "line-ab" });
    });
    fireEvent.click(screen.getByText("式に挿入"));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      expression: { kind: "expression", expression: "点線距離(point-c, line-ab)" }
    });
  });

  it("inserts line properties and valid variable references from the expression tray", () => {
    const baseVariable: CadElement = {
      id: "base-variable",
      name: "基準寸法",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 20,
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };
    const variable: CadElement = {
      ...baseVariable,
      id: "variable",
      name: "変数",
      expression: 0
    };
    useCadStore.setState({
      elements: [...sampleElements, baseVariable, variable],
      selectedElementId: "variable",
      selectedElementIds: ["variable"],
      selectedParameterKey: "expression"
    });
    renderRightPanel();

    fireEvent.click(screen.getByText("参照を挿入"));
    fireEvent.click(screen.getAllByText("長さ")[0]);
    fireEvent.click(screen.getByText("@基準寸法"));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      expression: { kind: "expression", expression: "line-ab.length + @base-variable" }
    });
    expect(screen.getByLabelText("変数式")).toHaveValue("直線AB.長さ + @base-variable");
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

  it("uses a click-pick button instead of a dropdown for offset line base lines", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds"
    });

    renderRightPanel();

    expect(screen.getByRole("button", { name: "線を選択" })).toBeInTheDocument();
    expect(screen.queryByLabelText("追加する基準線")).not.toBeInTheDocument();
  });

  it("uses a click-pick button instead of a dropdown for line division endpoints", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "line-division",
          name: "線上分点",
          type: "lineDivisionPoint",
          visible: true,
          enabled: true,
          endpoint: { lineId: "line-ab", endpointKey: "start" },
          placementMode: "ratio",
          distance: 30,
          ratio: 0.5
        }
      ],
      selectedElementId: "line-division",
      selectedElementIds: ["line-division"],
      selectedParameterKey: "endpoint"
    });

    renderRightPanel();

    expect(screen.getByRole("button", { name: "端点を選択" })).toBeInTheDocument();
    expect(screen.getByText("直線AB.始点")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
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

  it("shows evaluation warnings without treating them as errors", () => {
    const evaluation: EvaluationResult = {
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [],
      warnings: [
        {
          elementId: "curve-ac",
          elementName: "曲線AC",
          message: "オフセット量が曲線の曲率半径を超える箇所があるため、一部区間をトリムしました。"
        }
      ]
    };

    renderLeftPanel(evaluation);

    const row = screen.getByLabelText(/曲線AC, Bezier curve/);
    expect(row).toHaveClass("has-warning");
    expect(row).not.toHaveClass("has-error");
  });

  it("shows evaluation warning messages in the validation section", () => {
    renderRightPanel({
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [],
      warnings: [
        {
          elementId: "curve-ac",
          elementName: "曲線AC",
          message: "オフセット量が曲線の曲率半径を超える箇所があるため、一部区間をトリムしました。"
        }
      ]
    });

    expect(screen.getByText(/一部区間をトリムしました/)).toBeInTheDocument();
  });

  it("shows Tauri evaluation engine status in the validation section", () => {
    renderRightPanel(emptyEvaluation, evaluationEngineState({
      status: "evaluating",
      isStale: true
    }));

    expect(screen.getByText("Rust評価中 / stale")).toBeInTheDocument();
  });

  it("shows fallback evaluation engine status in the validation section", () => {
    renderRightPanel(emptyEvaluation, evaluationEngineState({
      source: "fallback",
      status: "failed",
      error: new Error("failed")
    }));

    expect(screen.getByText("TS fallback")).toBeInTheDocument();
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

  it("collapses hierarchy spacing for non-group rows", () => {
    renderLeftPanel();

    expect(screen.getByText("点A").closest("[data-element-list-row='true']")).toHaveClass(
      "is-flat-list"
    );
  });

  it("shows for group template and generated preview rows", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "プリーツ繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 3,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "pleat",
        name: "プリーツ点",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        x: { kind: "expression", expression: "@i * 10" },
        y: 0
      }
    ];
    useCadStore.setState({
      elements,
      evaluationLimitIndex: elements.length
    });

    renderLeftPanel(evaluateElements(elements));

    expect(screen.getByText("for i = 0..2 step 1")).toBeInTheDocument();
    expect(screen.getByText("テンプレート")).toBeInTheDocument();
    expect(screen.getByText("生成結果")).toBeInTheDocument();
    expect(screen.getByText("[i=0] プリーツ点")).toBeInTheDocument();
    expect(screen.getByText("[i=1] プリーツ点")).toBeInTheDocument();
    expect(screen.getByText("[i=2] プリーツ点")).toBeInTheDocument();
  });

  it("includes shown for group generated rows while searching", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "プリーツ繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 2,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "pleat",
        name: "プリーツ点",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "loop",
        x: { kind: "expression", expression: "@i * 10" },
        y: 0
      }
    ];
    useCadStore.setState({
      elements,
      evaluationLimitIndex: elements.length,
      elementSearchQuery: "i=1"
    });

    renderLeftPanel(evaluateElements(elements));

    expect(screen.getByText("[i=1] プリーツ点")).toBeInTheDocument();
  });

  it("shows the evaluation divider and marks later rows as unevaluated", () => {
    useCadStore.setState({
      evaluationLimitIndex: 2
    });

    renderLeftPanel(evaluateElements(sampleElements, { evaluationLimitIndex: 2 }));

    expect(screen.getByText("ここまで評価")).toBeInTheDocument();
    expect(screen.getByText("2 / 6")).toBeInTheDocument();
    expect(screen.getByText("点C").closest("[data-element-list-row='true']")).toHaveClass(
      "is-unevaluated"
    );
  });

  it("moves the evaluation divider with pointer dragging", () => {
    useCadStore.setState({
      evaluationLimitIndex: 2
    });
    renderLeftPanel(evaluateElements(sampleElements, { evaluationLimitIndex: 2 }));
    mockElementListRowRects();
    const divider = screen.getByLabelText(/評価区切り線。6件中2件を評価/);
    const targetRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(targetRow).toBeInstanceOf(HTMLElement);

    fireEvent.pointerDown(divider, { button: 0, clientY: 205, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 325, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 325, pointerId: 1 });

    expect(useCadStore.getState().evaluationLimitIndex).toBe(3);
  });

  it("cancels evaluation divider pointer dragging without committing", () => {
    useCadStore.setState({
      evaluationLimitIndex: 2
    });
    renderLeftPanel(evaluateElements(sampleElements, { evaluationLimitIndex: 2 }));
    mockElementListRowRects();
    const divider = screen.getByLabelText(/評価区切り線。6件中2件を評価/);

    fireEvent.pointerDown(divider, { button: 0, clientY: 205, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 325, pointerId: 1 });
    expect(divider).toHaveClass("dragging");

    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(useCadStore.getState().evaluationLimitIndex).toBe(2);
    expect(divider).not.toHaveClass("dragging");
  });

  it("moves the evaluation divider from keyboard focus", () => {
    useCadStore.setState({
      evaluationLimitIndex: 3
    });
    renderLeftPanel(evaluateElements(sampleElements, { evaluationLimitIndex: 3 }));
    let divider = screen.getByLabelText(/評価区切り線。6件中3件を評価/);

    divider.focus();
    expect(divider).toHaveFocus();

    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(useCadStore.getState().evaluationLimitIndex).toBe(2);

    fireEvent.keyDown(divider, { key: "ArrowDown", shiftKey: true });
    expect(useCadStore.getState().evaluationLimitIndex).toBe(sampleElements.length);

    divider = screen.getByLabelText(/評価区切り線。6件中6件を評価/);
    fireEvent.keyDown(divider, { key: "Home" });
    expect(useCadStore.getState().evaluationLimitIndex).toBe(0);

    divider = screen.getByLabelText(/評価区切り線。6件中0件を評価/);
    fireEvent.keyDown(divider, { key: "End" });
    expect(useCadStore.getState().evaluationLimitIndex).toBe(sampleElements.length);
  });

  it("searches collapsed group children and selects the active result with Enter", () => {
    useCadStore.setState({
      elements: [
        {
          id: "group-1",
          name: "身頃",
          type: "group",
          visible: true,
          enabled: true,
          expanded: false
        },
        { ...sampleElements[0], parentGroupId: "group-1" },
        sampleElements[1]
      ],
      selectedElementId: "group-1",
      selectedElementIds: ["group-1"],
      selectionAnchorElementId: "group-1"
    });

    renderLeftPanel();

    const searchInput = screen.getByRole("textbox", { name: "要素を検索" });
    fireEvent.change(searchInput, { target: { value: "点A" } });

    expect(screen.getByText("点A")).toBeInTheDocument();
    expect(screen.getByText("身頃")).toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: "Enter" });

    expect(useCadStore.getState().selectedElementId).toBe("point-a");
  });

  it("shows group child counts with a folder icon instead of the child label", () => {
    useCadStore.setState({
      elements: [
        {
          id: "group-1",
          name: "身頃",
          type: "group",
          visible: true,
          enabled: true,
          expanded: true
        },
        { ...sampleElements[0], parentGroupId: "group-1" },
        { ...sampleElements[1], parentGroupId: "group-1" }
      ],
      selectedElementId: "group-1",
      selectedElementIds: ["group-1"],
      selectionAnchorElementId: "group-1"
    });

    renderLeftPanel();

    const groupRow = screen.getByText("身頃").closest("[data-element-list-row='true']");
    expect(groupRow).not.toHaveClass("is-flat-list");
    expect(screen.getByText("点A").closest("[data-element-list-row='true']")).toHaveClass(
      "is-flat-list"
    );
    expect(screen.queryByText(/配下/)).not.toBeInTheDocument();
    expect(screen.getByText("2件")).toBeInTheDocument();
    expect(groupRow?.querySelector(".element-group-icon")).toBeInTheDocument();
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

  it("reorders elements by pointer dragging a handle before another row", () => {
    renderLeftPanel();
    mockElementListRowRects();
    const handle = screen.getByLabelText("点Aを並び替え");

    fireEvent.pointerDown(handle, { button: 0, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 325, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 325, pointerId: 1 });

    expect(useCadStore.getState().elements.map((element) => element.id).slice(0, 4)).toEqual([
      "point-b",
      "point-c",
      "point-a",
      "line-ab"
    ]);
    expect(useCadStore.getState().selectedElementId).toBe("point-a");
    expect(useCadStore.getState().past).toHaveLength(1);
  });

  it("auto-scrolls while pointer dragging an element near the list edge", () => {
    renderLeftPanel();
    const list = mockScrollableElementListRects();
    const animationFrames = mockAnimationFrames();
    const handle = screen.getByLabelText("点Aを並び替え");

    fireEvent.pointerDown(handle, { button: 0, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 95, pointerId: 1 });
    for (let index = 0; index < 7; index += 1) {
      animationFrames.runNextFrame();
    }
    fireEvent.pointerUp(window, { clientY: 95, pointerId: 1 });

    expect(list.scrollTop).toBeGreaterThan(100);
    expect(useCadStore.getState().elements.map((element) => element.id).slice(0, 4)).toEqual([
      "point-b",
      "point-a",
      "point-c",
      "line-ab"
    ]);
  });

  it("auto-scrolls while pointer dragging the evaluation divider near the list edge", () => {
    useCadStore.setState({
      evaluationLimitIndex: 0
    });
    renderLeftPanel(evaluateElements(sampleElements, { evaluationLimitIndex: 0 }));
    const list = mockScrollableElementListRects();
    const animationFrames = mockAnimationFrames();
    const divider = screen.getByLabelText(/評価区切り線。6件中0件を評価/);

    fireEvent.pointerDown(divider, { button: 0, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 95, pointerId: 1 });
    for (let index = 0; index < 7; index += 1) {
      animationFrames.runNextFrame();
    }
    fireEvent.pointerUp(window, { clientY: 95, pointerId: 1 });

    expect(list.scrollTop).toBeGreaterThan(100);
    expect(useCadStore.getState().evaluationLimitIndex).toBe(2);
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

  it("applies a picked line endpoint from the element list while endpoint picking", () => {
    const point = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint" as const,
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-ab", endpointKey: "start" as const },
      placementMode: "ratio" as const,
      distance: 30,
      ratio: 0.5
    };
    useCadStore.setState({
      elements: [...sampleElements, point],
      selectedElementId: point.id,
      selectedElementIds: [point.id],
      selectedParameterKey: "endpoint",
      activePointPickTarget: {
        elementId: point.id,
        parameterKey: "endpoint"
      }
    });
    renderLeftPanel(evaluateElements(useCadStore.getState().elements));

    const pointRow = screen.getByText("点C").closest("[data-element-list-row='true']");
    const lineRow = screen.getByText("直線BC").closest("[data-element-list-row='true']");
    expect(pointRow).toHaveClass("is-not-point-pick-candidate");
    expect(lineRow).toHaveClass("is-point-pick-candidate");

    fireEvent.click(pointRow!);
    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: point.id,
      parameterKey: "endpoint"
    });

    const endpointButtons = lineRow!.querySelectorAll(".element-point-pick-actions button");
    fireEvent.click(endpointButtons[1]);

    const updated = useCadStore.getState().elements.find((element) => element.id === point.id);
    expect(useCadStore.getState().activePointPickTarget).toBeNull();
    expect(updated).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-bc", endpointKey: "end" }
    });
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

  it("shows numeric reference candidates in the element list and applies one", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x",
      activeNumericReferencePickTarget: {
        elementId: "point-a",
        parameterKey: "x"
      }
    });
    renderLeftPanel(evaluateElements(sampleElements));

    const pointRow = screen.getByText("点C").closest("[data-element-list-row='true']");
    const lineRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(pointRow).toHaveClass("is-not-numeric-reference-pick-candidate");
    expect(lineRow).toHaveClass("is-numeric-reference-pick-candidate");

    fireEvent.click(lineRow!.querySelector(".element-numeric-reference-actions button")!);

    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });
  });

  it("marks the active keyboard pick row and row option", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x",
      activeNumericReferencePickTarget: {
        elementId: "point-a",
        parameterKey: "x"
      },
      activePickCursor: {
        elementId: "line-ab",
        optionIndex: 1
      }
    });
    renderLeftPanel(evaluateElements(sampleElements));

    const lineRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(lineRow).toHaveClass("selected-pick-candidate");

    const optionButtons = lineRow!.querySelectorAll(".element-numeric-reference-actions button");
    expect(optionButtons[1]).toHaveClass("selected-pick-option");
    expect(optionButtons[0]).not.toHaveClass("selected-pick-option");
  });

  it("adds a base line from the element list while line picking", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: [],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds",
      activeLinePickTarget: {
        elementId: "offset-line",
        parameterKey: "baseLineIds"
      }
    });
    renderLeftPanel(evaluateElements(useCadStore.getState().elements));

    const pointRow = screen.getByText("点C").closest("[data-element-list-row='true']");
    const lineRow = screen.getByText("直線BC").closest("[data-element-list-row='true']");
    expect(pointRow).toHaveClass("is-not-line-pick-candidate");
    expect(lineRow).toHaveClass("is-line-pick-candidate");

    fireEvent.click(lineRow!);
    fireEvent.click(pointRow!);

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "offset-line",
      parameterKey: "baseLineIds"
    });
    expect(useCadStore.getState().selectedElementId).toBe("offset-line");
    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-bc"]
    });
  });

  it("does not offer already picked base lines while line picking", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "offset-line",
          name: "オフセット線",
          type: "offsetLine",
          visible: true,
          enabled: true,
          numericVariables: [],
          baseLineIds: ["line-bc"],
          offset: 10,
          side: "right",
          closed: false
        }
      ],
      selectedElementId: "offset-line",
      selectedElementIds: ["offset-line"],
      selectedParameterKey: "baseLineIds",
      activeLinePickTarget: {
        elementId: "offset-line",
        parameterKey: "baseLineIds"
      }
    });
    renderLeftPanel(evaluateElements(useCadStore.getState().elements));

    const lineRow = screen.getByText("直線BC").closest("[data-element-list-row='true']");
    expect(lineRow).toHaveClass("is-not-line-pick-candidate");

    fireEvent.click(lineRow!);

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      type: "offsetLine",
      baseLineIds: ["line-bc"]
    });
  });

  it("reorders selected elements together by dragging one selected handle", () => {
    useCadStore.setState({
      selectedElementId: "point-c",
      selectedElementIds: ["point-b", "point-c"],
      selectionAnchorElementId: "point-b"
    });
    renderLeftPanel();
    mockElementListRowRects();
    const handle = screen.getByLabelText("点Cを並び替え");

    fireEvent.pointerDown(handle, { button: 0, clientY: 225, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 425, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 425, pointerId: 1 });

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

  it("does not start pointer reordering while searching", () => {
    renderLeftPanel();
    mockElementListRowRects();
    const searchInput = screen.getByRole("textbox", { name: "要素を検索" });
    fireEvent.change(searchInput, { target: { value: "点" } });
    const handle = screen.getByLabelText("点Aを並び替え");

    fireEvent.pointerDown(handle, { button: 0, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 325, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 325, pointerId: 1 });

    expect(useCadStore.getState().elements.map((element) => element.id).slice(0, 4)).toEqual([
      "point-a",
      "point-b",
      "point-c",
      "line-ab"
    ]);
  });
});
