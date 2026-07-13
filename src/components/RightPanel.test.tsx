import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RightPanel } from "./RightPanel";
import type { InspectorPanelHandle } from "./InspectorPanel";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import { PaletteSettingsDialog } from "./PalettePanel";
import { SelectionColorPickerDialog } from "./SelectionColorPickerDialog";
import { ShortcutHelpOverlay } from "./ShortcutHelpOverlay";
import { evaluateElements } from "../geometry/evaluate";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { defaultDocumentPalette } from "../palette/palette";
import { sampleElements } from "../sampleData";
import { DEFAULT_CANVAS_VIEWPORT, DEFAULT_PRINT_PREVIEW_WINDOW, useCadStore } from "../state/useCadStore";
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
  evaluationRevision: 0,
  evaluationRequestRevision: 0,
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
    referenceHelperPosition: null,
    selectedDependencyJumpIndex: 0,
    elementSearchQuery: "",
    elementSearchCursorId: null,
    elementSearchPickableOnly: false,
    showCanvasElementNames: true,
    showCanvasPoints: true,
    showElementListColorAccents: false,
    showPrintLayout: false,
    showPrintPreviewWindow: false,
    commandErrorMessage: null,
    showShortcutHelp: false,
    showPaletteSettings: false,
    showVisibilityProfileSettings: false,
    showSelectionColorPicker: false,
    showDslPanel: false,
    dslPanelSourceRequest: null,
    showCommandPalette: false,
    canvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printCanvasViewport: DEFAULT_CANVAS_VIEWPORT,
    printPreviewWindow: DEFAULT_PRINT_PREVIEW_WINDOW,
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
  {
    const inspectorRef = createRef<InspectorPanelHandle>();
    const sourceEditorRef = createRef<SourceEditorHandle>();
    return render(
    <RightPanel
      evaluation={evaluation}
      evaluationState={engineState}
      isParameterEditMode={options.isParameterEditMode ?? false}
      isDependencyJumpMode={options.isDependencyJumpMode ?? false}
      registerParameterControl={() => undefined}
      inspectorRef={inspectorRef}
      sourceEditorRef={sourceEditorRef}
      onExitInspector={() => undefined}
    />
    );
  };


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

describe("RightPanel numeric input dragging", () => {
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

  it("shows numeric variables for variable elements", () => {
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
      selectedElementIds: ["variable"]
    });

    renderRightPanel();

    expect(screen.getByText("要素内変数")).toBeInTheDocument();
    expect(screen.getByText("要素内変数はありません。")).toBeInTheDocument();
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

    expect(within(document.querySelector(".editor-grid")!).getByText("変数名")).toBeInTheDocument();
    expect(within(document.querySelector(".editor-grid")!).getByText("開始")).toBeInTheDocument();
    expect(within(document.querySelector(".editor-grid")!).getByText("回数")).toBeInTheDocument();
    expect(within(document.querySelector(".editor-grid")!).getByText("ステップ")).toBeInTheDocument();
    expect(within(document.querySelector(".editor-grid")!).getByText("展開する")).toBeInTheDocument();
    expect(within(document.querySelector(".editor-grid")!).getByText("生成結果を表示")).toBeInTheDocument();

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
    expect(screen.queryByText("点を選択")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("距離()"));
    act(() => {
      dispatchCommand("applyPickedPoint", { pickedPointId: "point-a" });
    });
    act(() => {
      dispatchCommand("applyPickedPoint", { pickedPointId: "point-b" });
    });

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
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("線を選択")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("点線距離()"));
    act(() => {
      dispatchCommand("applyPickedPoint", { pickedPointId: "point-c" });
    });
    act(() => {
      dispatchCommand("applyPickedLine", { pickedLineId: "line-ab" });
    });

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
    expect(screen.getByLabelText("変数式")).toHaveValue("直線AB.長さ + @基準寸法");
  });

  it("inserts variable suggestions into text elements as brace expressions", () => {
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
    const text: CadElement = {
      id: "text",
      name: "注記",
      type: "text",
      visible: true,
      enabled: true,
      text: "",
      anchor: { mode: "reference", pointId: "point-a" },
      fontSize: 4
    };
    const elements = [...sampleElements, baseVariable, text];
    useCadStore.setState({
      elements,
      evaluationLimitIndex: elements.length,
      selectedElementId: "text",
      selectedElementIds: ["text"],
      selectedParameterKey: "text"
    });
    renderRightPanel(evaluateElements(elements));

    const textarea = screen.getByLabelText("注記 のテキスト") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ゆとり @" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      text: "ゆとり {@基準寸法}"
    });
  });

  it("inserts reference helper candidates into text elements as brace expressions", () => {
    const text: CadElement = {
      id: "text",
      name: "注記",
      type: "text",
      visible: true,
      enabled: true,
      text: "長さ ",
      anchor: { mode: "reference", pointId: "point-a" },
      fontSize: 4
    };
    const elements = [...sampleElements, text];
    useCadStore.setState({
      elements,
      evaluationLimitIndex: elements.length,
      selectedElementId: "text",
      selectedElementIds: ["text"],
      selectedParameterKey: "text"
    });
    renderRightPanel(evaluateElements(elements));

    const textarea = screen.getByLabelText("注記 のテキスト") as HTMLTextAreaElement;
    act(() => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      fireEvent.select(textarea);
    });
    const textField = textarea.closest(".parameter-field") as HTMLElement;
    fireEvent.click(within(textField).getByText("参照を挿入"));
    const lineLengthCandidate = screen
      .getAllByRole("button", { name: /直線AB\.length/ })
      .find((button) => !button.hasAttribute("disabled"));
    expect(lineLengthCandidate).toBeDefined();
    fireEvent.doubleClick(lineLengthCandidate!);

    expect(useCadStore.getState().elements.at(-1)).toMatchObject({
      text: "長さ {直線AB.length}"
    });
  });

  it("shows the reference helper without the elements tab and keeps normal element candidates searchable", () => {
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

    const categories = screen.getByRole("navigation", { name: "参照カテゴリ" });
    expect(within(categories).queryByRole("button", { name: "elements" })).not.toBeInTheDocument();
    expect(screen.getByText("点A.params.x")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("参照候補を検索"), {
      target: { value: "点A" }
    });

    expect(screen.getByText("点A.params.x")).toBeInTheDocument();
  });

  it("moves the reference helper window by dragging its header", () => {
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
    const header = screen.getByText("参照ヘルパー").closest(".reference-helper-header");
    expect(header).not.toBeNull();

    fireEvent.pointerDown(header!, { pointerId: 1, button: 0, clientX: 40, clientY: 90 });
    fireEvent.pointerMove(header!, { pointerId: 1, clientX: 140, clientY: 140 });
    fireEvent.pointerUp(header!, { pointerId: 1, clientX: 140, clientY: 140 });

    expect(useCadStore.getState().referenceHelperPosition).toEqual({ x: 124, y: 122 });
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
    expect(input).toHaveValue("@基準寸法");
  });

  it("inserts conditional comparison and logical operators from the expression tray", () => {
    const conditionalGroup: CadElement = {
      id: "if",
      name: "ifブロック",
      type: "conditionalGroup",
      visible: true,
      enabled: true,
      condition: { kind: "expression", expression: "line-ab.length > 0" },
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

  it("uses the reference display for single line reference picking", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "tangent-point",
          name: "接線オフセット点",
          type: "lineTangentOffsetPoint",
          visible: true,
          enabled: true,
          baseLineId: "line-ab",
          basePoint: { mode: "reference", pointId: "point-a" },
          tangentAngleDeg: 90,
          distance: 30
        }
      ],
      selectedElementId: "tangent-point",
      selectedElementIds: ["tangent-point"],
      selectedParameterKey: "baseLineId"
    });

    renderRightPanel();

    fireEvent.click(screen.getByRole("button", { name: "参照線直線AB" }));

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "tangent-point",
      parameterKey: "baseLineId"
    });
    expect(screen.queryByRole("combobox", { name: /基準線/ })).not.toBeInTheDocument();
  });

  it("starts single line picking from the line reference card background", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "tangent-point",
          name: "接線オフセット点",
          type: "lineTangentOffsetPoint",
          visible: true,
          enabled: true,
          baseLineId: "line-ab",
          basePoint: { mode: "reference", pointId: "point-a" },
          tangentAngleDeg: 90,
          distance: 30
        }
      ],
      selectedElementId: "tangent-point",
      selectedElementIds: ["tangent-point"],
      selectedParameterKey: "baseLineId"
    });

    renderRightPanel();

    fireEvent.click(document.querySelector(".right-panel .line-anchor-editor")!);

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "tangent-point",
      parameterKey: "baseLineId"
    });
  });

  it("starts a line to point pick flow for line tangent offset points", () => {
    useCadStore.setState({
      elements: [
        ...sampleElements,
        {
          id: "tangent-point",
          name: "接線オフセット点",
          type: "lineTangentOffsetPoint",
          visible: true,
          enabled: true,
          baseLineId: "line-ab",
          basePoint: { mode: "reference", pointId: "point-a" },
          tangentAngleDeg: 90,
          distance: 30
        }
      ],
      selectedElementId: "tangent-point",
      selectedElementIds: ["tangent-point"],
      selectedParameterKey: "baseLineId"
    });

    renderRightPanel();

    fireEvent.click(screen.getByRole("button", { name: "線→点" }));

    expect(useCadStore.getState().activeLinePickTarget).toEqual({
      elementId: "tangent-point",
      parameterKey: "baseLineId",
      nextPointParameterKey: "basePoint",
      pickFlow: "lineAndPoint"
    });
  });

  it("starts point picking from a point reference card background", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"],
      selectedParameterKey: "startPoint"
    });

    renderRightPanel();

    fireEvent.click(document.querySelector(".right-panel .point-anchor-editor")!);

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "line-ab",
      parameterKey: "startPoint"
    });
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

  it("starts endpoint picking from the endpoint reference card background", () => {
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

    fireEvent.click(document.querySelector(".right-panel .point-anchor-editor")!);

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "line-division",
      parameterKey: "endpoint"
    });
  });

  it("starts endpoint pair picking for corner radius arcs", () => {
    const element: CadElement = {
      id: "corner",
      name: "角丸",
      type: "cornerRadiusArcLine",
      visible: true,
      enabled: true,
      endpoint1: { lineId: "line-ab", endpointKey: "start" },
      endpoint2: { lineId: "line-bc", endpointKey: "start" },
      radius: 10,
      intersectionIndex: 0
    };
    useCadStore.setState({
      elements: [...sampleElements, element],
      selectedElementId: element.id,
      selectedElementIds: [element.id],
      selectedParameterKey: "endpoint1"
    });

    renderRightPanel();

    fireEvent.click(screen.getByRole("button", { name: "端点1→端点2" }));

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "corner",
      parameterKey: "endpoint1",
      nextParameterKey: "endpoint2",
      pickFlow: "endpointPair"
    });
  });

  it("starts endpoint to point picking for extend trim elements", () => {
    const element: CadElement = {
      id: "extend",
      name: "延長短縮",
      type: "extendTrim",
      visible: true,
      enabled: true,
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      point: { mode: "reference", pointId: "point-a" }
    };
    useCadStore.setState({
      elements: [...sampleElements, element],
      selectedElementId: element.id,
      selectedElementIds: [element.id],
      selectedParameterKey: "endpoint"
    });

    renderRightPanel();

    fireEvent.click(screen.getByRole("button", { name: "端点→点" }));

    expect(useCadStore.getState().activePointPickTarget).toEqual({
      elementId: "extend",
      parameterKey: "endpoint",
      nextParameterKey: "point",
      pickFlow: "endpointAndPoint"
    });
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
      scale: 1,
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

  it("opens palette editing from the selected element color field", () => {
    const inspectorRef = createRef<InspectorPanelHandle>();
    const sourceEditorRef = createRef<SourceEditorHandle>();
    render(
      <>
        <RightPanel
          evaluation={emptyEvaluation}
          isParameterEditMode={false}
          isDependencyJumpMode={false}
          registerParameterControl={() => undefined}
          inspectorRef={inspectorRef}
          sourceEditorRef={sourceEditorRef}
          onExitInspector={() => undefined}
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

  it("keeps the shortcut footer outside the single scrolling content region", () => {
    const { container } = renderRightPanel();
    const panel = container.querySelector<HTMLElement>(".right-panel");
    const scrollRegion = container.querySelector<HTMLElement>(".right-panel-scroll");
    const footer = container.querySelector<HTMLElement>(".right-panel-footer");

    expect(panel).toContainElement(scrollRegion);
    expect(panel).toContainElement(footer);
    expect(scrollRegion).toContainElement(screen.getByRole("region", { name: "インスペクタ" }));
    expect(scrollRegion).not.toContainElement(footer);
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

describe("RightPanel evaluation status", () => {
  beforeEach(() => {
    resetStore();
  });

  it("shows selected element warning messages in the element detail section", () => {
    useCadStore.setState({
      selectedElementId: "curve-ac",
      selectedElementIds: ["curve-ac"]
    });

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
    expect(screen.queryByText("バリデーション")).not.toBeInTheDocument();
  });

  it("shows selected element dependency errors on parent rows", () => {
    useCadStore.setState({
      selectedElementId: "line-ab",
      selectedElementIds: ["line-ab"]
    });

    renderRightPanel({
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [
        {
          elementId: "line-ab",
          elementName: "直線AB",
          missingDependencyId: "point-b",
          missingDependencyName: "点B",
          message: "直線AB は 点B を参照していますが、点B はこの要素より後にあります。"
        }
      ],
      warnings: []
    });

    expect(screen.getByText(/直線AB は 点B を参照しています/)).toBeInTheDocument();
    expect(screen.queryByText("バリデーション")).not.toBeInTheDocument();
  });

  it("shows child element errors on child rows", () => {
    useCadStore.setState({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"]
    });

    renderRightPanel({
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [
        {
          elementId: "line-ab",
          elementName: "直線AB",
          missingDependencyId: "point-b",
          missingDependencyName: "点B",
          message: "直線AB は 点B を参照していますが、点B はこの要素より後にあります。"
        }
      ],
      warnings: []
    });

    expect(screen.getByText(/直線AB は 点B を参照しています/)).toBeInTheDocument();
  });

  it("shows Tauri evaluation engine status in the element detail header", () => {
    renderRightPanel(emptyEvaluation, evaluationEngineState({
      status: "evaluating",
      isStale: true
    }));

    expect(screen.getByText("Rust評価中 / stale")).toBeInTheDocument();
  });

  it("shows fallback evaluation engine status in the element detail header", () => {
    renderRightPanel(emptyEvaluation, evaluationEngineState({
      source: "fallback",
      status: "failed",
      error: new Error("failed")
    }));

    expect(screen.getByText("TS fallback")).toBeInTheDocument();
  });
});
