import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { activePrintLayout, DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import { defaultDocumentPalette } from "../palette/palette";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { PrintLayoutPanel } from "./PrintLayoutView";

const group = (id: string, name: string, printEnabled = true): CadElement => ({
  id,
  name,
  type: "group",
  activity: "visible",
  printEnabled,
  printAnchor: { mode: "coordinate", x: 0, y: 0 }
});

const elements: CadElement[] = [
  group("front", "前身頃"),
  group("back", "後ろ身頃"),
  group("sleeve", "袖"),
  group("hidden-print", "印刷しない", false)
];

// PrintLayoutPanel mounts a loadLayoutSettings() effect that resolves via a
// microtask even in the non-Tauri localStorage path. Flushing it here, once,
// keeps every render call site free of the resulting "not wrapped in act"
// warning instead of relying on each test's own timing.
const renderPanel = async () => {
  render(<PrintLayoutPanel evaluation={evaluateElements(elements)} />);
  await act(async () => {});
};
const activeLayout = () => {
  const state = useCadDocumentStore.getState();
  return activePrintLayout(state.printLayouts, state.activePrintLayoutId);
};

describe("PrintLayoutPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCadDocumentStore.setState({
      elements,
      palette: defaultDocumentPalette(),
      printLayouts: [DEFAULT_PRINT_LAYOUT],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
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

  it("filters printable groups by name", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText("印刷グループを検索"), {
      target: { value: "袖" }
    });

    expect(screen.getByRole("button", { name: /袖/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /前身頃/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /印刷しない/ })).not.toBeInTheDocument();
  });

  it("adds a placement and selects it for detail editing", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /前身頃/ }));

    expect(activeLayout().placements).toHaveLength(1);
    expect(useCadUiStore.getState().selectedPrintPlacementId).toBe("placement-1");
    expect(screen.getByText("選択配置")).toBeInTheDocument();
    const detail = screen.getByText("選択配置").closest("section");
    expect(detail).not.toBeNull();
    expect(within(detail!).getAllByText("前身頃").length).toBeGreaterThan(0);
  });

  it("switches detail editing when a placement row is selected", async () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 0, mirrorX: false },
          { id: "placement-2", groupId: "back", x: 30, y: 40, angleDeg: 15, mirrorX: true }
        ]
      }],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id
    });
    await renderPanel();

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

  it("duplicates placements without changing their numeric values", async () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true }
        ]
      }],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id
    });
    await renderPanel();

    const placementSection = screen.getByRole("heading", { name: "配置" }).closest("section");
    expect(placementSection).not.toBeNull();
    fireEvent.click(within(placementSection!).getByRole("button", { name: "配置を複製" }));

    expect(activeLayout().placements).toEqual([
      { id: "placement-1", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true },
      { id: "placement-2", groupId: "front", x: 10, y: 20, angleDeg: 15, mirrorX: true }
    ]);
    expect(useCadUiStore.getState().selectedPrintPlacementId).toBe("placement-2");
  });

  it("keeps disabled print group placements visible without offering them as add candidates", async () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        placements: [
          { id: "placement-1", groupId: "hidden-print", x: 10, y: 20, angleDeg: 0, mirrorX: false }
        ]
      }],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id
    });
    await renderPanel();

    const groupSection = screen.getByRole("heading", { name: "印刷グループ" }).closest("section");
    const placementSection = screen.getByRole("heading", { name: "配置" }).closest("section");
    expect(groupSection).not.toBeNull();
    expect(placementSection).not.toBeNull();
    expect(within(groupSection!).queryByRole("button", { name: /印刷しない/ })).not.toBeInTheDocument();
    expect(within(placementSection!).getByText("印刷しない")).toBeInTheDocument();
    expect(within(placementSection!).getByText("印刷OFF")).toBeInTheDocument();
  });

  it("points the empty print group list to the left outline toggles", async () => {
    useCadDocumentStore.setState({
      elements: elements.map((element) =>
        element.type === "group" ? { ...element, printEnabled: false } : element
      )
    });
    await renderPanel();

    expect(screen.getByText("左のアウトラインで印刷するグループをONにしてください。")).toBeInTheDocument();
  });

  it("increments number inputs with middle-button horizontal drag", async () => {
    await renderPanel();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.pointerDown(scaleInput, { button: 1, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(scaleInput, { pointerId: 1, clientX: 16 });
    fireEvent.pointerUp(scaleInput, { pointerId: 1, clientX: 16 });

    expect(activeLayout().scale).toBe(1.2);
  });

  it("shows only PDF-specific settings for PDF layouts", async () => {
    await renderPanel();

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

  it("collapses output settings while keeping the summary visible", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /出力設定/ }));

    expect(screen.getByRole("button", { name: /出力設定/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText(/A4 \/ 2x2 \/ 倍率/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("出力形式")).not.toBeInTheDocument();
  });

  it("edits the SVG canvas size for the active print layout", async () => {
    useCadDocumentStore.setState({
      printLayouts: [{ ...DEFAULT_PRINT_LAYOUT, outputKind: "svg" }]
    });
    await renderPanel();

    fireEvent.change(screen.getByLabelText("SVG幅 mm"), {
      target: { value: "500" }
    });
    fireEvent.change(screen.getByLabelText("SVG高さ mm"), {
      target: { value: "700" }
    });

    expect(activeLayout()).toMatchObject({
      svgCanvasWidthMm: 500,
      svgCanvasHeightMm: 700
    });
  });

  it("switches visible settings when the output format changes", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText("出力形式"), {
      target: { value: "svg" }
    });

    expect(activeLayout().outputKind).toBe("svg");
    expect(screen.getByLabelText("SVG幅 mm")).toBeInTheDocument();
    expect(screen.getByLabelText("SVG高さ mm")).toBeInTheDocument();
    expect(screen.queryByLabelText("用紙")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("横枚数")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("縦枚数")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("重複 mm")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SVG" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PDF" })).not.toBeInTheDocument();
  });

  it("keeps print number inputs blank while editing and restores scale to one on Enter", async () => {
    useCadDocumentStore.setState({
      printLayouts: [{
        ...DEFAULT_PRINT_LAYOUT,
        scale: 2
      }]
    });
    await renderPanel();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "" } });

    expect(activeLayout().scale).toBe(2);
    expect(scaleInput).toHaveValue("");

    fireEvent.keyDown(scaleInput, { key: "Enter" });

    expect(activeLayout().scale).toBe(1);
    expect(scaleInput).toHaveValue("1");
  });
});

describe("PrintLayoutPanel element-parameter completion", () => {
  const point = (id: string, name: string, x: number, y: number): CadElement => ({
    id,
    name,
    type: "freePoint",
    activity: "visible",
    x,
    y
  });

  const lineElements: CadElement[] = [
    point("pt-a", "点A", 0, 0),
    point("pt-b", "点B", 10, 0),
    {
      id: "line-ab",
      name: "直線AB",
      type: "line",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "pt-a" },
      endPoint: { mode: "reference", pointId: "pt-b" }
    }
  ];

  const renderWithLine = async () => {
    useCadDocumentStore.setState({
      elements: lineElements,
      palette: defaultDocumentPalette(),
      printLayouts: [DEFAULT_PRINT_LAYOUT],
      activePrintLayoutId: DEFAULT_PRINT_LAYOUT.id,
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
    await act(async () => {});
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows 直線AB's referenceable parameters after ElementName. && narrows them by prefix", async () => {
    await renderWithLine();
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
    await renderWithLine();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "直線AB.le", selectionStart: 9, selectionEnd: 9 } });
    fireEvent.click(screen.getByRole("option", { name: /length/ }));

    await waitFor(() => expect(scaleInput).toHaveValue("直線AB.length"));
  });

  it("does not open element-parameter candidates during IME composition (regression for the pre-existing gap)", async () => {
    await renderWithLine();
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.compositionStart(scaleInput);
    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    fireEvent.compositionEnd(scaleInput);
    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("coexists with typed const/let @-candidates in the same input without interference (Task 53)", async () => {
    // Typed binding candidates come from the compiled document's own
    // bindingAnalysis/statementMap (printLayoutTypedBindingCandidates.ts),
    // unlike @Element.property candidates which read the live elements array
    // directly - so this test seeds a real compiled document via commitText
    // rather than raw store-state injection.
    useCadDocumentStore.getState().commitText(
      [
        "nui 4",
        "const 倍率: number = 1.5",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "line 直線AB = segment(start: @A, end: @B)",
        "printLayout Main (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
        "}"
      ].join("\n"),
      "test"
    );
    await act(async () => {});
    const state = useCadDocumentStore.getState();
    const lineElement = state.elements.find((element) => element.name === "直線AB")!;
    useCadUiStore.setState({
      ...initialCadUiState(),
      selectedElementId: lineElement.id,
      selectedElementIds: [lineElement.id],
      selectionAnchorElementId: lineElement.id
    });
    render(<PrintLayoutPanel evaluation={evaluateElements(state.elements)} />);
    await act(async () => {});
    const scaleInput = screen.getByLabelText("拡大率");

    fireEvent.change(scaleInput, { target: { value: "@", selectionStart: 1, selectionEnd: 1 } });
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@倍率");

    fireEvent.change(scaleInput, { target: { value: "直線AB.", selectionStart: 6, selectionEnd: 6 } });
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });
});
