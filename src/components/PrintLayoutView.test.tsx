import { fireEvent, render, screen, within } from "@testing-library/react";
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
  expanded: true,
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
    useCadDocumentStore.setState({
      elements,
      palette: defaultDocumentPalette(),
      printLayouts: [DEFAULT_PRINT_LAYOUT],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
      printLayout: DEFAULT_PRINT_LAYOUT,
      evaluationLimitIndex: elements.length,
      selectedElementId: elements[0].id,
      selectedElementIds: [elements[0].id],
      selectionAnchorElementId: elements[0].id,
      selectedParameterKey: "name",
      past: [],
      future: [],
      currentFilePath: null,
      dirtySinceSave: false
    });
    useCadUiStore.setState(initialCadUiState());
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
