import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel, RightPanel } from "./LeftPanel";
import { PaletteSettingsDialog } from "./PalettePanel";
import { SelectionColorPickerDialog } from "./SelectionColorPickerDialog";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { defaultDocumentPalette } from "../palette/palette";
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
    palette: defaultDocumentPalette(),
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
    showElementListColorAccents: false,
    showPrintLayout: false,
    commandErrorMessage: null,
    showShortcutHelp: false,
    showPaletteSettings: false,
    showSelectionColorPicker: false,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    past: [],
    future: [],
    currentFilePath: null,
    dirtySinceSave: false
  });
};

const selectOnlyElement = (element: CadElement) => {
  useCadStore.setState({
    elements: [element],
    evaluationLimitIndex: 1,
    selectedElementId: element.id,
    selectedElementIds: [element.id],
    selectionAnchorElementId: element.id
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

  it("edits for group parameters from the right panel", () => {
    const loop: CadElement = {
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
      showGenerated: false
    };
    useCadStore.setState({
      elements: [loop],
      evaluationLimitIndex: 1,
      selectedElementId: "loop",
      selectedElementIds: ["loop"],
      selectionAnchorElementId: "loop"
    });

    renderRightPanel();

    expect(screen.getByText("変数名")).toBeInTheDocument();
    expect(screen.getByText("開始")).toBeInTheDocument();
    expect(screen.getByText("回数")).toBeInTheDocument();
    expect(screen.getByText("ステップ")).toBeInTheDocument();
    expect(screen.getByText("展開する")).toBeInTheDocument();
    expect(screen.getByText("生成結果を表示")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("プリーツ繰り返し の変数名"), {
      target: { value: "n" }
    });
    fireEvent.change(screen.getByLabelText("ステップ"), {
      target: { value: "2" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /生成結果を表示/ }));

    expect(useCadStore.getState().elements[0]).toMatchObject({
      variableName: "n",
      step: 2,
      showGenerated: true
    });
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

  it("keeps a blank numeric parameter input while focused and restores the saved value on blur", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
    expect(input).toHaveValue("");

    fireEvent.blur(input);

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
    expect(input).toHaveValue("50");
  });

  it("selects an element name input value when focused", async () => {
    renderRightPanel();

    const input = screen.getByDisplayValue("点A") as HTMLInputElement;
    input.focus();

    await waitFor(() => expect(input.selectionStart).toBe(0));
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("selects a numeric parameter input value when focused", async () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値") as HTMLInputElement;
    input.focus();

    await waitFor(() => expect(input.selectionStart).toBe(0));
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("commits zero when pressing Enter on a blank numeric parameter input", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 0 });
    expect(input).toHaveValue("0");
  });

  it("does not commit or blur a numeric parameter input on IME composition Enter", () => {
    renderRightPanel();

    const input = screen.getByLabelText("x 値");
    input.focus();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(useCadStore.getState().elements[0]).toMatchObject({ x: 50 });
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("does not commit or blur an element name input on IME composition Enter", () => {
    renderRightPanel();

    const nameInput = screen.getByDisplayValue("点A");
    nameInput.focus();
    fireEvent.change(nameInput, { target: { value: "点あ" } });
    fireEvent.keyDown(nameInput, { key: "Enter", isComposing: true });

    expect(useCadStore.getState().elements[0]).toMatchObject({ name: "点A" });
    expect(nameInput).toHaveValue("点あ");
    expect(nameInput).toHaveFocus();
  });

  it("commits one when pressing Enter on a blank image scale input", () => {
    selectOnlyElement({
      id: "image",
      name: "画像",
      type: "image",
      visible: true,
      enabled: true,
      sourcePath: "underlay.png",
      originPoint: { mode: "coordinate", x: 0, y: 0 },
      naturalWidthPx: 100,
      naturalHeightPx: 50,
      sourceDpi: 300,
      targetPixelsPerMm: 10,
      scale: 2,
      angleDeg: 0,
      mirrorX: false
    });
    renderRightPanel();

    const input = screen.getByLabelText("画像倍率");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ scale: 1 });
    expect(input).toHaveValue("1");
  });

  it("commits one when pressing Enter on a blank ratio input", () => {
    selectOnlyElement({
      id: "division",
      name: "分点",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placementMode: "ratio",
      distance: 10,
      ratio: 0.5
    });
    renderRightPanel();

    const input = screen.getByLabelText("割合");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ ratio: 1 });
    expect(input).toHaveValue("1");
  });

  it("commits one when pressing Enter on blank identity numeric inputs", () => {
    selectOnlyElement({
      id: "loop",
      name: "forブロック",
      type: "forGroup",
      visible: true,
      enabled: true,
      variableName: "i",
      start: 0,
      count: 3,
      step: 2,
      expanded: true,
      showGenerated: false
    });
    renderRightPanel();

    const stepInput = screen.getByLabelText("ステップ");
    fireEvent.focus(stepInput);
    fireEvent.change(stepInput, { target: { value: "" } });
    fireEvent.keyDown(stepInput, { key: "Enter" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ step: 1 });
    expect(stepInput).toHaveValue("1");
  });

  it("commits one when pressing Enter on a blank conditional group condition", () => {
    selectOnlyElement({
      id: "condition",
      name: "ifブロック",
      type: "conditionalGroup",
      visible: true,
      enabled: true,
      condition: 0,
      expanded: true,
      elseExpanded: true
    });
    renderRightPanel();

    const input = screen.getByLabelText("ifブロック の条件");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useCadStore.getState().elements[0]).toMatchObject({ condition: 1 });
    expect(input).toHaveValue("1");
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
      parameterKey: "x",
      mode: "replace",
      property: "length"
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
    fireEvent.click(screen.getByRole("button", { name: "線・曲線を選択" }));
    act(() => {
      dispatchCommand("applyPickedNumericReference", { numericReferenceExpression: "line-ab.length" });
    });
    fireEvent.click(screen.getByText("@基準寸法"));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      expression: { kind: "expression", expression: "line-ab.length + @base-variable" }
    });
    expect(screen.getByLabelText("変数式")).toHaveValue("直線AB.長さ + @base-variable");
  });

  it("suggests available variables when typing @ in a numeric input", () => {
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
    const elements = [...sampleElements, baseVariable, variable];
    useCadStore.setState({
      elements,
      evaluationLimitIndex: elements.length,
      selectedElementId: "variable",
      selectedElementIds: ["variable"],
      selectedParameterKey: "expression"
    });
    renderRightPanel(evaluateElements(elements));

    const input = screen.getByLabelText("変数式") as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "@", selectionStart: 1, selectionEnd: 1 }
    });

    fireEvent.click(screen.getByRole("option", { name: /@基準寸法/ }));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      expression: { kind: "expression", expression: "@base-variable" }
    });
    expect(input).toHaveValue("@base-variable");
  });

  it("inserts conditional comparison and logical operators from the expression tray", () => {
    const conditionalGroup: CadElement = {
      id: "if",
      name: "ifブロック",
      type: "conditionalGroup",
      visible: true,
      enabled: true,
      condition: { kind: "expression", expression: "line-ab.length > 0" },
      expanded: true,
      elseExpanded: false
    };
    useCadStore.setState({
      elements: [...sampleElements, conditionalGroup],
      selectedElementId: "if",
      selectedElementIds: ["if"],
      selectedParameterKey: "condition"
    });
    renderRightPanel();

    expect(screen.queryByText("増減単位")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("参照を挿入"));

    const operatorGroup = screen.getByRole("group", { name: "挿入する条件演算子" });
    const operatorDescriptions = [
      [">", "A > B: AがBより大きいとき真"],
      [">=", "A >= B: AがB以上のとき真"],
      ["<", "A < B: AがBより小さいとき真"],
      ["<=", "A <= B: AがB以下のとき真"],
      ["==", "A == B: AとBが等しいとき真"],
      ["!=", "A != B: AとBが等しくないとき真"],
      ["&&", "A && B: AとBの両方が真のとき真"],
      ["||", "A || B: AとBのどちらかが真のとき真"]
    ] as const;
    for (const [operator, description] of operatorDescriptions) {
      const button = within(operatorGroup).getByTitle(description);
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent(operator);
    }

    const input = screen.getByLabelText("ifブロック の条件") as HTMLInputElement;
    const operatorIndex = input.value.indexOf(">");
    input.focus();
    input.setSelectionRange(operatorIndex - 1, operatorIndex + 2);
    fireEvent.select(input);
    fireEvent.click(within(operatorGroup).getByTitle("A != B: AとBが等しくないとき真"));

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.select(input);
    fireEvent.click(within(operatorGroup).getByTitle("A && B: AとBの両方が真のとき真"));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      condition: { kind: "expression", expression: "line-ab.length != 0 &&" }
    });
  });

  it("keeps line reference insertion working from the conditional expression tray", () => {
    const conditionalGroup: CadElement = {
      id: "if",
      name: "ifブロック",
      type: "conditionalGroup",
      visible: true,
      enabled: true,
      condition: 0,
      expanded: true,
      elseExpanded: false
    };
    useCadStore.setState({
      elements: [...sampleElements, conditionalGroup],
      selectedElementId: "if",
      selectedElementIds: ["if"],
      selectedParameterKey: "condition"
    });
    renderRightPanel();

    fireEvent.click(screen.getByText("参照を挿入"));
    fireEvent.click(screen.getByRole("button", { name: "線・曲線を選択" }));
    act(() => {
      dispatchCommand("applyPickedNumericReference", { numericReferenceExpression: "line-ab.length" });
    });

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      condition: { kind: "expression", expression: "line-ab.length" }
    });
    expect(screen.getByLabelText("ifブロック の条件")).toHaveValue("直線AB.長さ");
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

  it("allows direct positive numeric parameter step input", () => {
    renderRightPanel();

    fireEvent.change(screen.getByLabelText("x 増減単位"), { target: { value: "0.01" } });

    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 0.01 });
    expect(screen.getByLabelText("x 増減単位")).toHaveValue("0.01");
  });

  it("keeps empty numeric parameter step input as a draft while editing", () => {
    useCadStore.setState({
      elements: [
        {
          ...sampleElements[0],
          numericParameterSteps: { x: 0.01 }
        },
        ...sampleElements.slice(1)
      ]
    });
    renderRightPanel();

    const stepInput = screen.getByLabelText("x 増減単位");
    fireEvent.change(stepInput, { target: { value: "" } });

    expect(stepInput).toHaveValue("");
    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 0.01 });

    fireEvent.blur(stepInput);

    expect(stepInput).toHaveValue("0.01");
  });

  it("allows negative numeric parameter step drafts without saving them", () => {
    renderRightPanel();

    const stepInput = screen.getByLabelText("x 増減単位");
    fireEvent.change(stepInput, { target: { value: "-" } });

    expect(stepInput).toHaveValue("-");
    expect(useCadStore.getState().elements[0].numericParameterSteps?.x).toBeUndefined();

    fireEvent.change(stepInput, { target: { value: "-1" } });

    expect(stepInput).toHaveValue("-1");
    expect(useCadStore.getState().elements[0].numericParameterSteps?.x).toBeUndefined();

    fireEvent.blur(stepInput);

    expect(stepInput).toHaveValue("1");
  });

  it("changes numeric parameter steps by fixed levels with arrow keys", () => {
    renderRightPanel();

    const stepInput = screen.getByLabelText("x 増減単位");
    fireEvent.keyDown(stepInput, { key: "ArrowUp" });

    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 10 });
    expect(stepInput).toHaveValue("10");

    useCadStore.setState({
      elements: [
        {
          ...useCadStore.getState().elements[0],
          numericParameterSteps: { x: 1 }
        },
        ...useCadStore.getState().elements.slice(1)
      ]
    });

    fireEvent.keyDown(stepInput, { key: "ArrowDown" });

    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 0.1 });
    expect(stepInput).toHaveValue("0.1");
  });

  it("changes numeric parameter steps with middle-button horizontal drag", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 増減単位"), { toX: 8 });

    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 10 });
  });

  it("decreases numeric parameter steps with middle-button horizontal drag to the left", () => {
    renderRightPanel();

    dragNumericInput(screen.getByLabelText("x 増減単位"), { fromX: 8, toX: 0 });

    expect(useCadStore.getState().elements[0].numericParameterSteps).toMatchObject({ x: 0.1 });
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

  it("lays out offset line side choices as a compact choice parameter", () => {
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
      selectedParameterKey: "side"
    });

    renderRightPanel(emptyEvaluation, undefined, { isParameterEditMode: true });

    const sideChoices = screen.getByRole("group", { name: "オフセット位置" });
    expect(sideChoices.closest(".choice-parameter-editor")).toBeInTheDocument();
    expect(sideChoices.closest(".selected-parameter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "左" }));

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({ side: "left" });
  });

  it("uses the reference display instead of a dropdown for line division endpoint picking", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "参照端点直線AB.始点" }));

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "line-division",
      parameterKey: "endpoint"
    });
    expect(screen.queryByRole("combobox", { name: /端点/ })).not.toBeInTheDocument();
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

describe("Palette and element color editing", () => {
  beforeEach(() => {
    resetStore();
  });

  it("changes and clears the selected element display color from the right panel", () => {
    renderRightPanel();

    expect(screen.queryByRole("listbox", { name: "点A の表示色候補" })).not.toBeInTheDocument();
    expect(screen.queryByText("親グループ / 既定色")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "点A の表示色" }));
    const colorOptions = screen.getByRole("listbox", { name: "点A の表示色候補" });
    expect(within(colorOptions).getByText("親グループ / 既定色")).toBeInTheDocument();
    expect(within(colorOptions).getByRole("option", { name: /裁断線/ })).toBeInTheDocument();

    fireEvent.click(within(colorOptions).getByRole("option", { name: /裁断線/ }));

    expect(useCadStore.getState().elements[0].colorId).toBe("cut-red");
    expect(screen.queryByRole("listbox", { name: "点A の表示色候補" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "点A の表示色" }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "点A の表示色候補" })).getByRole("option", {
        name: /自動/
      })
    );

    expect(useCadStore.getState().elements[0].colorId).toBeUndefined();
  });

  it("hides the display color field for elements that do not draw their own color", () => {
    const move: CadElement = {
      id: "move",
      name: "移動",
      type: "move",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      angleDeg: 0,
      mirrorX: false,
      baseLineIds: ["line-ab"]
    };
    useCadStore.setState({
      elements: [...sampleElements, move],
      selectedElementId: move.id,
      selectedElementIds: [move.id],
      selectionAnchorElementId: move.id
    });

    renderRightPanel();

    expect(screen.queryByText("表示色")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /表示する/ })).toBeInTheDocument();
  });

  it("keeps palette editing out of the permanent left panel and opens it from the left button", () => {
    render(
      <>
        <LeftPanel
          evaluation={emptyEvaluation}
          elementListFocusRef={createRef<HTMLDivElement>()}
          elementSearchInputRef={createRef<HTMLInputElement>()}
        />
        <PaletteSettingsDialog />
      </>
    );

    expect(screen.queryByLabelText("裁断線 の名前")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "パレット" }));

    expect(screen.getByRole("dialog", { name: "パレット設定" })).toBeInTheDocument();
    expect(screen.getByLabelText("裁断線 の名前")).toBeInTheDocument();
  });

  it("opens palette editing from the selected element color field", () => {
    render(
      <>
        <RightPanel
          evaluation={emptyEvaluation}
          isParameterEditMode={false}
          isDependencyJumpMode={false}
          registerParameterControl={() => undefined}
        />
        <PaletteSettingsDialog />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "編集" }));

    expect(screen.getByRole("dialog", { name: "パレット設定" })).toBeInTheDocument();
  });

  it("closes palette editing with Escape", () => {
    useCadStore.setState({ showPaletteSettings: true });
    render(<PaletteSettingsDialog />);

    const dialog = screen.getByRole("dialog", { name: "パレット設定" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(useCadStore.getState().showPaletteSettings).toBe(false);
  });

  it("removes deleted palette colors from elements", () => {
    useCadStore.setState({
      elements: [{ ...sampleElements[0], colorId: "cut-red" }, ...sampleElements.slice(1)]
    });
    useCadStore.setState({ showPaletteSettings: true });
    render(<PaletteSettingsDialog />);

    const nameInput = screen.getByLabelText("裁断線 の名前");
    const row = nameInput.closest(".palette-color-row");
    if (!row) throw new Error("Missing palette color row");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "削除" }));

    expect(useCadStore.getState().palette.colors.some((color) => color.id === "cut-red")).toBe(false);
    expect(useCadStore.getState().elements[0].colorId).toBeUndefined();
  });

  it("applies a display color to the current selection from the batch picker", () => {
    useCadStore.setState({
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[0].id, sampleElements[1].id],
      selectionAnchorElementId: sampleElements[0].id
    });
    render(<SelectionColorPickerDialog />);

    act(() => dispatchCommand("openSelectionColorPicker"));

    const dialog = screen.getByRole("dialog", { name: "選択範囲の表示色" });
    expect(within(dialog).getByText("2件に適用")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: /裁断線/ }));

    expect(useCadStore.getState().elements[0].colorId).toBe("cut-red");
    expect(useCadStore.getState().elements[1].colorId).toBe("cut-red");
    expect(screen.queryByRole("dialog", { name: "選択範囲の表示色" })).not.toBeInTheDocument();
  });

  it("closes the batch display color picker with Escape without changing colors", () => {
    useCadStore.setState({
      elements: [{ ...sampleElements[0], colorId: "guide-blue" }, ...sampleElements.slice(1)],
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      showSelectionColorPicker: true
    });
    render(<SelectionColorPickerDialog />);

    fireEvent.keyDown(screen.getByRole("dialog", { name: "選択範囲の表示色" }), { key: "Escape" });

    expect(useCadStore.getState().elements[0].colorId).toBe("guide-blue");
    expect(screen.queryByRole("dialog", { name: "選択範囲の表示色" })).not.toBeInTheDocument();
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

  it("shows selected element display color as a row accent instead of a separate swatch", () => {
    useCadStore.setState({
      elements: [{ ...sampleElements[0], colorId: "cut-red" }, ...sampleElements.slice(1)]
    });

    renderLeftPanel();

    const row = screen.getByText("点A").closest("[data-element-list-row='true']") as HTMLElement;
    expect(row.querySelector(".element-color-swatch")).not.toBeInTheDocument();
    expect(row).toHaveStyle({ "--element-color": "#b42318" });
    expect(row).toHaveClass("has-color-accent", "has-selected-color-tint");
    expect(within(row).getByRole("button", { name: "点Aを並び替え" })).toBeInTheDocument();
  });

  it("can show display color accents on non-selected element list rows", () => {
    useCadStore.setState({
      elements: [
        { ...sampleElements[0], colorId: "cut-red" },
        { ...sampleElements[1], colorId: "guide-blue" },
        ...sampleElements.slice(2)
      ],
      showElementListColorAccents: true
    });

    renderLeftPanel();

    const selectedRow = screen.getByText("点A").closest("[data-element-list-row='true']");
    const nonSelectedRow = screen.getByText("点B").closest("[data-element-list-row='true']");
    expect(selectedRow).toHaveClass("has-color-accent", "has-selected-color-tint");
    expect(nonSelectedRow).toHaveClass("has-color-accent");
    expect(nonSelectedRow).not.toHaveClass("has-selected-color-tint");
  });

  it("shows group print toggles in the element list only while editing print layout", () => {
    const group: CadElement = {
      id: "group-print",
      name: "前身頃",
      type: "group",
      visible: true,
      enabled: true,
      expanded: true,
      printEnabled: false
    };
    useCadStore.setState({
      elements: [group, sampleElements[0]],
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectionAnchorElementId: sampleElements[0].id,
      evaluationLimitIndex: 2,
      showPrintLayout: true
    });

    renderLeftPanel();

    const groupRow = screen.getByText("前身頃").closest("[data-element-list-row='true']");
    const pointRow = screen.getByText("点A").closest("[data-element-list-row='true']");
    expect(groupRow).not.toBeNull();
    expect(pointRow).not.toBeNull();
    expect(within(groupRow as HTMLElement).getByRole("button", { name: "前身頃を印刷する" }))
      .toBeInTheDocument();
    expect(within(pointRow as HTMLElement).queryByRole("button", { name: /印刷/ }))
      .not.toBeInTheDocument();
  });

  it("hides group print toggles outside print layout editing", () => {
    const group: CadElement = {
      id: "group-print",
      name: "前身頃",
      type: "group",
      visible: true,
      enabled: true,
      expanded: true,
      printEnabled: false
    };
    useCadStore.setState({
      elements: [group],
      selectedElementId: group.id,
      selectedElementIds: [group.id],
      selectionAnchorElementId: group.id,
      evaluationLimitIndex: 1,
      showPrintLayout: false
    });

    renderLeftPanel();

    const groupRow = screen.getByText("前身頃").closest("[data-element-list-row='true']");
    expect(groupRow).not.toBeNull();
    expect(within(groupRow as HTMLElement).queryByRole("button", { name: /印刷/ }))
      .not.toBeInTheDocument();
  });

  it("toggles group print enabled from the print layout element list without changing selection", () => {
    const group: CadElement = {
      id: "group-print",
      name: "前身頃",
      type: "group",
      visible: true,
      enabled: true,
      expanded: true,
      printEnabled: false
    };
    useCadStore.setState({
      elements: [group, sampleElements[0]],
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectionAnchorElementId: sampleElements[0].id,
      evaluationLimitIndex: 2,
      showPrintLayout: true
    });
    renderLeftPanel();

    fireEvent.click(screen.getByRole("button", { name: "前身頃を印刷する" }));

    expect(useCadStore.getState().elements[0]).toMatchObject({ printEnabled: true });
    expect(useCadStore.getState().selectedElementId).toBe(sampleElements[0].id);
    expect(screen.getByRole("button", { name: "前身頃を印刷しない" })).toBeInTheDocument();
  });

  it("keeps error row styling ahead of selected display color tint", () => {
    useCadStore.setState({
      elements: [{ ...sampleElements[0], colorId: "cut-red" }, ...sampleElements.slice(1)]
    });

    renderLeftPanel({
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [
        {
          elementId: "point-a",
          elementName: "点A",
          missingDependencyId: "missing",
          message: "broken"
        }
      ],
      warnings: []
    });

    const row = screen.getByText("点A").closest("[data-element-list-row='true']");
    expect(row).toHaveClass("has-error", "has-color-accent");
    expect(row).not.toHaveClass("has-selected-color-tint");
  });

  it("collapses hierarchy spacing for non-group rows", () => {
    renderLeftPanel();

    expect(screen.getByText("点A").closest("[data-element-list-row='true']")).toHaveClass(
      "is-flat-list"
    );
  });

  it("keeps long element names available in the element list", () => {
    const longName = "前身頃ダーツ展開後の脇線補助線と縫い代確認用の長い要素名";
    useCadStore.setState({
      elements: [{ ...sampleElements[0], name: longName }]
    });

    renderLeftPanel();

    const nameText = screen.getByText(longName);
    expect(nameText).toHaveClass("element-name-text");
    expect(nameText).toHaveClass("is-compact-name");
    expect(nameText).toHaveAttribute("title", longName);
  });

  it("keeps short element names at the normal list font size", () => {
    renderLeftPanel();

    expect(screen.getByText("点A")).toHaveClass("element-name-text");
    expect(screen.getByText("点A")).not.toHaveClass("is-compact-name");
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

  it("uses the compact element name font for long generated preview row names", () => {
    const longName = "プリーツ展開後の長い生成プレビュー用補助点";
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "プリーツ繰り返し",
        type: "forGroup",
        visible: true,
        enabled: true,
        variableName: "i",
        start: 0,
        count: 1,
        step: 1,
        expanded: true,
        showGenerated: true
      },
      {
        id: "pleat",
        name: longName,
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

    const generatedName = screen.getByText(`[i=0] ${longName}`);
    expect(generatedName).toHaveClass("element-name-text");
    expect(generatedName).toHaveClass("is-compact-name");
    expect(generatedName).toHaveAttribute("title", `[i=0] ${longName}`);
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

  it("does not select an element search result on IME composition Enter", () => {
    useCadStore.setState({
      selectedElementId: "point-b",
      selectedElementIds: ["point-b"],
      selectionAnchorElementId: "point-b"
    });

    renderLeftPanel();

    const searchInput = screen.getByRole("textbox", { name: "要素を検索" });
    searchInput.focus();
    fireEvent.change(searchInput, { target: { value: "点A" } });
    fireEvent.keyDown(searchInput, { key: "Enter", isComposing: true });

    expect(useCadStore.getState().selectedElementId).toBe("point-b");
    expect(searchInput).toHaveFocus();
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
    const childRow = screen.getByText("点A").closest("[data-element-list-row='true']");
    expect(groupRow).not.toHaveClass("is-flat-list");
    expect(childRow).toHaveClass("is-flat-list");
    expect(groupRow).toHaveStyle({ "--outline-depth": "0" });
    expect(childRow).toHaveStyle({ "--outline-depth": "1" });
    expect(screen.queryByText(/配下/)).not.toBeInTheDocument();
    expect(screen.getByText("2件")).toBeInTheDocument();
    expect(groupRow?.querySelector(".element-group-icon")).toBeInTheDocument();
    expect(groupRow?.querySelector(".element-expand-button")).toBeInTheDocument();
    expect(childRow?.querySelector(".element-expand-button")).not.toBeInTheDocument();
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

  it("moves an element into an existing group by dropping on the group row", () => {
    useCadStore.setState({
      elements: [
        {
          id: "group-1",
          name: "本体",
          type: "group",
          visible: true,
          enabled: true,
          expanded: true
        },
        { ...sampleElements[0], parentGroupId: "group-1" },
        sampleElements[1],
        sampleElements[2]
      ],
      selectedElementId: sampleElements[1].id,
      selectedElementIds: [sampleElements[1].id],
      selectionAnchorElementId: sampleElements[1].id
    });
    renderLeftPanel();
    mockElementListRowRects();
    const handle = screen.getByLabelText("点Bを並び替え");

    fireEvent.pointerDown(handle, { button: 0, clientY: 225, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 50, pointerId: 1 });
    expect(screen.getByText("本体").closest("[data-element-list-row='true']")).toHaveClass(
      "drop-inside"
    );
    fireEvent.pointerUp(window, { clientY: 50, pointerId: 1 });

    expect(useCadStore.getState().elements[2]).toMatchObject({
      id: sampleElements[1].id,
      parentGroupId: "group-1"
    });
  });

  it("moves an element out of a group by dropping beside a root row", () => {
    useCadStore.setState({
      elements: [
        {
          id: "group-1",
          name: "本体",
          type: "group",
          visible: true,
          enabled: true,
          expanded: true
        },
        { ...sampleElements[0], parentGroupId: "group-1" },
        { ...sampleElements[1], parentGroupId: "group-1" },
        sampleElements[2]
      ],
      selectedElementId: sampleElements[0].id,
      selectedElementIds: [sampleElements[0].id],
      selectionAnchorElementId: sampleElements[0].id
    });
    renderLeftPanel();
    mockElementListRowRects();
    const handle = screen.getByLabelText("点Aを並び替え");

    fireEvent.pointerDown(handle, { button: 0, clientY: 125, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 325, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 325, pointerId: 1 });

    expect(useCadStore.getState().elements[2]).toMatchObject({
      id: sampleElements[0].id,
      parentGroupId: undefined
    });
  });

  it("shows command errors in the element list area", () => {
    useCadStore.setState({
      commandErrorMessage: "違う階層の要素はまとめてグループ化できません。"
    });

    renderLeftPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("違う階層の要素");
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
        parameterKey: "x",
        mode: "replace",
        property: "length"
      }
    });
    renderLeftPanel(evaluateElements(sampleElements));

    const pointRow = screen.getByText("点C").closest("[data-element-list-row='true']");
    const lineRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(pointRow).toHaveClass("is-not-numeric-reference-pick-candidate");
    expect(lineRow).toHaveClass("is-numeric-reference-pick-candidate");

    fireEvent.click(lineRow!);

    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements[0]).toMatchObject({
      x: { kind: "expression", expression: "line-ab.length" }
    });
  });

  it("shows variable candidates in the element list while numeric reference picking", () => {
    const variable: CadElement = {
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
    const elements = [variable, ...sampleElements];
    useCadStore.setState({
      elements,
      evaluationLimitIndex: elements.length,
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x",
      activeNumericReferencePickTarget: {
        elementId: "point-a",
        parameterKey: "x",
        mode: "replace",
        property: "length"
      }
    });
    renderLeftPanel(evaluateElements(elements));

    const variableRow = screen.getByText("基準寸法").closest("[data-element-list-row='true']");
    expect(variableRow).toHaveClass("is-numeric-reference-pick-candidate");

    fireEvent.click(variableRow!);

    expect(useCadStore.getState().activeNumericReferencePickTarget).toBeNull();
    expect(useCadStore.getState().elements[1]).toMatchObject({
      x: { kind: "expression", expression: "@base-variable" }
    });
  });

  it("marks the active keyboard pick row", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectedParameterKey: "x",
      activeNumericReferencePickTarget: {
        elementId: "point-a",
        parameterKey: "x",
        mode: "replace",
        property: "length"
      },
      activePickCursor: {
        elementId: "line-ab",
        optionIndex: 0
      }
    });
    renderLeftPanel(evaluateElements(sampleElements));

    const lineRow = screen.getByText("直線AB").closest("[data-element-list-row='true']");
    expect(lineRow).toHaveClass("selected-pick-candidate");
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
