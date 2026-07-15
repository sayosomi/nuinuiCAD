import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { defaultDocumentPalette } from "../palette/palette";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { PrintLayoutPanel } from "./PrintLayoutView";

const group = (id: string, name: string, printEnabled = true): CadElement => ({
  id,
  name,
  type: "group",
  visible: true,
  enabled: true,
  printEnabled,
  printAnchor: { mode: "coordinate", x: 0, y: 0 }
});

const elements: CadElement[] = [
  {
    id: "scale-var",
    name: "倍率",
    type: "variable",
    visible: true,
    enabled: true,
    scope: "global",
    valueMode: "expression",
    expression: 1.5,
    point1: { mode: "coordinate", x: 0, y: 0 },
    point2: { mode: "coordinate", x: 0, y: 0 },
    point: { mode: "coordinate", x: 0, y: 0 },
    lineId: ""
  },
  group("front", "前身頃"),
  group("back", "後ろ身頃"),
  group("sleeve", "袖"),
  group("hidden-print", "印刷しない", false)
];

const renderPanel = () => {
  render(<PrintLayoutPanel evaluation={evaluateElements(elements)} />);
};

describe("PrintLayoutPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCadDocumentStore.setState({
      elements,
      palette: defaultDocumentPalette(),
      printLayouts: [DEFAULT_PRINT_LAYOUT],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      printLayout: DEFAULT_PRINT_LAYOUT,
      evaluationLimitIndex: elements.length,
      past: [],
      future: [],
      currentFilePath: null,
      dirtySinceSave: false
    });
    useCadUiStore.setState({
      ...initialCadUiState(),
      selectedElementId: elements[0].id,
      selectedElementIds: [elements[0].id],
      selectionAnchorElementId: elements[0].id,
    });
  });

  it("filters printable groups by name", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("印刷グループを検索"), {
      target: { value: "袖" }
    });

    expect(screen.getByRole("button", { name: /袖/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /前身頃/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /印刷しない/ })).not.toBeInTheDocument();
  });

  it("adds a placement and selects it for detail editing", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /前身頃/ }));

    expect(useCadDocumentStore.getState().printLayout.placements).toHaveLength(1);
    expect(useCadUiStore.getState().selectedPrintPlacementId).toBe("placement-1");
    expect(screen.getByText("選択配置")).toBeInTheDocument();
    const detail = screen.getByText("選択配置").closest("section");
    expect(detail).not.toBeNull();
    expect(within(detail!).getAllByText("前身頃").length).toBeGreaterThan(0);
  });

  it("switches detail editing when a placement row is selected", () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 0, mirrorX: false },
          { id: "placement-2", groupId: "back", x: 30, y: 40, angleDeg: 15, mirrorX: true }
        ]
      }],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      printLayout: {
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 0, mirrorX: false },
          { id: "placement-2", groupId: "back", x: 30, y: 40, angleDeg: 15, mirrorX: true }
        ]
      }
    });
    renderPanel();

    const placementSection = screen.getByRole("heading", { name: "配置" }).closest("section");
    expect(placementSection).not.toBeNull();
    const backPlacementRow = within(placementSection!)
      .getByText("後ろ身頃")
      .closest('[role="button"]');
    expect(backPlacementRow).not.toBeNull();
    fireEvent.click(backPlacementRow!);

    expect(useCadUiStore.getState().selectedPrintPlacementId).toBe("placement-2");
    const detail = screen.getByText("選択配置").closest("section");
    expect(detail).not.toBeNull();
    expect(within(detail!).getByDisplayValue("30")).toBeInTheDocument();
    expect(within(detail!).getByDisplayValue("40")).toBeInTheDocument();
    expect(within(detail!).getByDisplayValue("15")).toBeInTheDocument();
  });

  it("duplicates placements without changing their numeric values", () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true }
        ]
      }],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      printLayout: {
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true }
        ]
      }
    });
    renderPanel();

    const placementSection = screen.getByRole("heading", { name: "配置" }).closest("section");
    expect(placementSection).not.toBeNull();
    fireEvent.click(within(placementSection!).getByRole("button", { name: "配置を複製" }));

    expect(useCadDocumentStore.getState().printLayout.placements).toEqual([
      { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true },
      { id: "placement-2", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true }
    ]);
    expect(useCadUiStore.getState().selectedPrintPlacementId).toBe("placement-2");
  });

  it("keeps disabled print group placements visible without offering them as add candidates", () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "hidden-print", x: 10, y: 20, angleDeg: 0, mirrorX: false }
        ]
      }],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      printLayout: {
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "hidden-print", x: 10, y: 20, angleDeg: 0, mirrorX: false }
        ]
      }
    });
    renderPanel();

    const groupSection = screen.getByRole("heading", { name: "印刷グループ" }).closest("section");
    const placementSection = screen.getByRole("heading", { name: "配置" }).closest("section");
    expect(groupSection).not.toBeNull();
    expect(placementSection).not.toBeNull();
    expect(within(groupSection!).queryByRole("button", { name: /印刷しない/ })).not.toBeInTheDocument();
    expect(within(placementSection!).getByText("印刷しない")).toBeInTheDocument();
    expect(within(placementSection!).getByText("印刷OFF")).toBeInTheDocument();
  });

  it("points the empty print group list to the left outline toggles", () => {
    useCadDocumentStore.setState({
      elements: elements.map((element) =>
        element.type === "group" ? { ...element, printEnabled: false } : element
      )
    });
    renderPanel();

    expect(screen.getByText("左のアウトラインで印刷するグループをONにしてください。")).toBeInTheDocument();
  });

  it("increments number inputs with middle-button horizontal drag", () => {
    renderPanel();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.pointerDown(scaleInput, { button: 1, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(scaleInput, { pointerId: 1, clientX: 16 });
    fireEvent.pointerUp(scaleInput, { pointerId: 1, clientX: 16 });

    expect(useCadDocumentStore.getState().printLayout.scale).toBe(1.2);
  });

  it("stores print number inputs as expressions using global variables", () => {
    renderPanel();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "@倍率" } });

    expect(useCadDocumentStore.getState().printLayout.scale).toEqual({
      kind: "expression",
      expression: "@scale-var"
    });
    expect(scaleInput).toHaveValue("@倍率");
  });

  it("offers global variables as explicit print number suggestions", async () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        numericVariables: [{ id: "print-variable-1", name: "倍率", value: 2 }]
      }],
      printLayout: {
        ...DEFAULT_PRINT_LAYOUT,
        numericVariables: [{ id: "print-variable-1", name: "倍率", value: 2 }]
      }
    });
    renderPanel();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, {
      target: { value: "@", selectionStart: 1, selectionEnd: 1 }
    });

    const suggestions = screen.getByRole("listbox", { name: "変数候補" });
    expect(within(suggestions).getByRole("option", { name: /@倍率.*印刷変数/ })).toBeInTheDocument();
    const globalOption = within(suggestions).getByRole("option", { name: /@倍率.*全体変数/ });
    fireEvent.click(globalOption);

    await waitFor(() => {
      expect(useCadDocumentStore.getState().printLayout.scale).toEqual({
        kind: "expression",
        expression: "@scale-var"
      });
    });
  });

  it("shows only PDF-specific settings for PDF layouts", () => {
    renderPanel();

    expect(screen.getByLabelText("出力形式")).toHaveValue("pdf");
    expect(screen.getByLabelText("用紙")).toBeInTheDocument();
    expect(screen.getByLabelText("横枚数")).toBeInTheDocument();
    expect(screen.getByLabelText("縦枚数")).toBeInTheDocument();
    expect(screen.getByLabelText("重複 mm")).toBeInTheDocument();
    expect(screen.queryByLabelText("SVG幅 mm")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SVG高さ mm")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SVG" })).not.toBeInTheDocument();
  });

  it("collapses output settings while keeping the summary visible", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /出力設定/ }));

    expect(screen.getByRole("button", { name: /出力設定/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText(/A4 \/ 2x2 \/ 倍率/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("出力形式")).not.toBeInTheDocument();
  });

  it("edits the SVG canvas size for the active print layout", () => {
    useCadDocumentStore.setState({
      printLayouts: [{ ...DEFAULT_PRINT_LAYOUT, outputKind: "svg" }],
      printLayout: { ...DEFAULT_PRINT_LAYOUT, outputKind: "svg" }
    });
    renderPanel();

    fireEvent.change(screen.getByLabelText("SVG幅 mm"), {
      target: { value: "500" }
    });
    fireEvent.change(screen.getByLabelText("SVG高さ mm"), {
      target: { value: "700" }
    });

    expect(useCadDocumentStore.getState().printLayout).toMatchObject({
      svgCanvasWidthMm: 500,
      svgCanvasHeightMm: 700
    });
  });

  it("switches visible settings when the output format changes", () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText("出力形式"), {
      target: { value: "svg" }
    });

    expect(useCadDocumentStore.getState().printLayout.outputKind).toBe("svg");
    expect(screen.getByLabelText("SVG幅 mm")).toBeInTheDocument();
    expect(screen.getByLabelText("SVG高さ mm")).toBeInTheDocument();
    expect(screen.queryByLabelText("用紙")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("横枚数")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("縦枚数")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重複 mm")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SVG" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PDF" })).not.toBeInTheDocument();
  });

  it("adds print-local variables and prefers them in print number expressions", () => {
    renderPanel();
    const variableSection = screen.getByRole("heading", { name: "印刷変数" }).closest("section");
    expect(variableSection).not.toBeNull();

    fireEvent.click(within(variableSection!).getByRole("button", { name: /印刷変数/ }));
    fireEvent.click(within(variableSection!).getByRole("button", { name: "追加" }));
    fireEvent.change(within(variableSection!).getByLabelText("印刷変数名"), {
      target: { value: "倍率" }
    });
    fireEvent.change(within(variableSection!).getByLabelText("値"), {
      target: { value: "2" }
    });

    const scaleInput = screen.getByLabelText("拡大率");
    fireEvent.change(scaleInput, { target: { value: "@倍率" } });

    expect(useCadDocumentStore.getState().printLayout.numericVariables).toEqual([
      {
        id: "print-variable-1",
        name: "倍率",
        value: 2
      }
    ]);
    expect(useCadDocumentStore.getState().printLayout.scale).toEqual({
      kind: "expression",
      expression: "@print-variable-1"
    });
    expect(scaleInput).toHaveValue("@倍率");
  });

  it("deletes print-local variables from the print layout", () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        numericVariables: [{ id: "print-variable-1", name: "倍率", value: 2 }]
      }],
      printLayout: {
        ...DEFAULT_PRINT_LAYOUT,
        numericVariables: [{ id: "print-variable-1", name: "倍率", value: 2 }]
      }
    });
    renderPanel();
    const variableSection = screen.getByRole("heading", { name: "印刷変数" }).closest("section");
    expect(variableSection).not.toBeNull();

    fireEvent.click(within(variableSection!).getByRole("button", { name: /印刷変数/ }));
    fireEvent.click(within(variableSection!).getByRole("button", { name: "削除" }));

    expect(useCadDocumentStore.getState().printLayout.numericVariables).toEqual([]);
    expect(within(variableSection!).getByText("印刷変数はありません。")).toBeInTheDocument();
  });

  it("keeps print number inputs blank while editing and restores scale to one on Enter", () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        scale: 2
      }],
      printLayout: {
        ...DEFAULT_PRINT_LAYOUT,
        scale: 2
      }
    });
    renderPanel();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "" } });

    expect(useCadDocumentStore.getState().printLayout.scale).toBe(2);
    expect(scaleInput).toHaveValue("");

    fireEvent.keyDown(scaleInput, { key: "Enter" });

    expect(useCadDocumentStore.getState().printLayout.scale).toBe(1);
    expect(scaleInput).toHaveValue("1");
  });
});

describe("PrintLayoutPanel element-parameter completion", () => {
  const point = (id: string, name: string, x: number, y: number): CadElement => ({
    id,
    name,
    type: "freePoint",
    visible: true,
    enabled: true,
    x,
    y
  });

  const lineElements: CadElement[] = [
    {
      id: "scale-var",
      name: "倍率",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 1.5,
      point1: { mode: "coordinate", x: 0, y: 0 },
      point2: { mode: "coordinate", x: 0, y: 0 },
      point: { mode: "coordinate", x: 0, y: 0 },
      lineId: ""
    },
    point("pt-a", "点A", 0, 0),
    point("pt-b", "点B", 10, 0),
    {
      id: "line-ab",
      name: "直線AB",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "pt-a" },
      endPoint: { mode: "reference", pointId: "pt-b" }
    }
  ];

  const renderWithLine = () => {
    useCadDocumentStore.setState({
      elements: lineElements,
      palette: defaultDocumentPalette(),
      printLayouts: [DEFAULT_PRINT_LAYOUT],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      printLayout: DEFAULT_PRINT_LAYOUT,
      evaluationLimitIndex: lineElements.length,
      past: [],
      future: [],
      currentFilePath: null,
      dirtySinceSave: false
    });
    useCadUiStore.setState({
      ...initialCadUiState(),
      selectedElementId: lineElements[0].id,
      selectedElementIds: [lineElements[0].id],
      selectionAnchorElementId: lineElements[0].id
    });
    render(<PrintLayoutPanel evaluation={evaluateElements(lineElements)} />);
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows 直線AB's referenceable parameters after ElementName. and narrows them by prefix", () => {
    renderWithLine();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    const listbox = screen.getByRole("listbox", { name: "変数候補" });
    expect(listbox).toHaveTextContent("length");
    expect(listbox).toHaveTextContent("startTangentAngleDeg");

    fireEvent.change(scaleInput, { target: { value: "直線AB.st", selectionStart: 9, selectionEnd: 9 } });
    const narrowed = screen.getByRole("listbox", { name: "変数候補" });
    expect(narrowed).toHaveTextContent("startTangentAngleDeg");
    expect(narrowed).not.toHaveTextContent("length");
  });

  it("replaces only the member token on selection, leaving ElementName. untouched", async () => {
    renderWithLine();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "直線AB.le", selectionStart: 9, selectionEnd: 9 } });
    fireEvent.click(screen.getByRole("option", { name: /length/ }));

    await waitFor(() => expect(scaleInput).toHaveValue("直線AB.length"));
  });

  it("does not open element-parameter candidates during IME composition (regression for the pre-existing gap)", () => {
    renderWithLine();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.compositionStart(scaleInput);
    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    fireEvent.compositionEnd(scaleInput);
    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("coexists with @variable candidates in the same input without interference", () => {
    renderWithLine();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "@", selectionStart: 1, selectionEnd: 1 } });
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@倍率");

    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });
});
