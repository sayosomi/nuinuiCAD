import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import type { OutputPlan } from "../output/outputCore";
import { OutputPreviewApp } from "./OutputPreviewApp";
import { outputPreviewDiagnosticSourceRangeFor } from "./outputPreviewDiagnostics";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { VscodeWebviewApi } from "./protocol";
import { outputPreviewManualE2eSource } from "./outputPreviewManualFixture";

const mocks = vi.hoisted(() => ({
  evaluateOutputPlan: vi.fn()
}));

vi.mock("../output/outputCore", async () => {
  const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
  return { ...actual, evaluateOutputPlan: mocks.evaluateOutputPlan };
});

const api: VscodeWebviewApi = { postMessage: vi.fn() };

const source = [
  "nui 4",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout L {",
  "  place @G(at: (0, 0))",
  "}",
  "print A(",
  "  layout: @L,",
  "  paper: a4,",
  "  overlap: 5,",
  ")",
  "svg B(",
  "  layout: @L,",
  "  margin: 1,",
  ")"
].join("\n");

const printSourceWithoutB = source.slice(0, source.indexOf("svg B("));
const repairedSource = source.replace("overlap: 5", "overlap: 20");
const invalidOverlapSource = source.replace("overlap: 5", "overlap: 200");

const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20, width: 20, height: 20 };

type TestOutput = {
  id: string;
  name: string;
  layoutId: string;
  margin?: number | { kind: "expression"; expression: string };
  paper?: "a4" | "a3";
  overlap?: number | { kind: "expression"; expression: string };
};

const planFor = (output: TestOutput): OutputPlan => {
  const isPrint = output.paper !== undefined;
  const overlap = isPrint && typeof output.overlap === "number" ? output.overlap : 0;
  const paperWidthMm = 60;
  const paperHeightMm = 60;
  const strideXmm = paperWidthMm - 2 * overlap;
  const strideYmm = paperHeightMm - 2 * overlap;

  const joiningLabel = (centerX: number) => ({
    text: "1",
    fontSizeMm: 3,
    rotationDeg: 90,
    center: { x: centerX, y: paperHeightMm / 2 },
    widthMm: 1.86,
    advancesMm: [1.86]
  });
  const drawable = {
    kind: "line" as const,
    elementId: "AB",
    name: "AB",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    stroke: { widthMm: 1, style: "solid" as const, colorHex: "#123456" }
  };
  const pages = [
    {
      index: 0,
      column: 0,
      row: 0,
      origin: { x: -overlap, y: -overlap },
      guides: overlap > 0 ? [
        { axis: "vertical" as const, positionMm: overlap },
        {
          axis: "vertical" as const,
          positionMm: paperWidthMm - overlap,
          label: joiningLabel(paperWidthMm - overlap / 2)
        },
        { axis: "horizontal" as const, positionMm: overlap },
        { axis: "horizontal" as const, positionMm: paperHeightMm - overlap }
      ] : []
    },
    {
      index: 1,
      column: 1,
      row: 0,
      origin: { x: -overlap + strideXmm, y: -overlap },
      guides: overlap > 0 ? [
        {
          axis: "vertical" as const,
          positionMm: overlap,
          label: joiningLabel(overlap / 2)
        },
        { axis: "vertical" as const, positionMm: paperWidthMm - overlap },
        { axis: "horizontal" as const, positionMm: overlap },
        { axis: "horizontal" as const, positionMm: paperHeightMm - overlap }
      ] : []
    }
  ];
  return {
    kind: isPrint ? "print" : "svg",
    outputId: output.id,
    outputName: output.name,
    layoutId: output.layoutId,
    placements: [],
    drawables: [drawable],
    renderedBounds: bounds,
    bounds,
    rustPayload: {} as OutputPlan["rustPayload"],
    ...(isPrint
      ? {
          print: {
            paper: "a4" as const,
            orientation: "portrait" as const,
            paperWidthMm,
            paperHeightMm,
            overlapMm: overlap,
            strideXmm,
            strideYmm,
            columns: 2,
            rows: 1,
            pages
          }
        }
      : {
          svg: { widthMm: bounds.width, heightMm: bounds.height, viewBox: { x: 0, y: 0, width: bounds.width, height: bounds.height } }
        })
  } as OutputPlan;
};

const viewportRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
  toJSON: () => ({})
} as DOMRect;

const renderFixture = (sourceText = source) => {
  useCadDocumentStore.getState().commitText(sourceText, "test");
  return render(<OutputPreviewApp api={api} />);
};

const outputKeyFor = (kind: "print" | "svg", name: string): string => {
  const state = useCadDocumentStore.getState();
  const output = kind === "print"
    ? state.printOutputs.find((candidate) => candidate.name === name)
    : state.svgOutputs.find((candidate) => candidate.name === name);
  if (!output) throw new Error(`missing ${kind} output ${name}`);
  return `${kind}:${output.id}`;
};

const pageFill = () => screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="page-fill"]') as SVGRectElement;

describe("Output Preview application", () => {
  afterEach(() => {
    cleanup();
    useCadDocumentStore.setState(initialCadDocumentState());
    vi.mocked(api.postMessage).mockReset();
    mocks.evaluateOutputPlan.mockReset();
    vi.restoreAllMocks();
  });

  it("opens with an explicit empty state when there are no current outputs", () => {
    useCadDocumentStore.setState(initialCadDocumentState());

    render(<OutputPreviewApp api={api} />);

    expect(screen.getByRole("status")).toHaveTextContent("No print or SVG outputs");
    expect(api.postMessage).toHaveBeenCalledWith({ type: "webviewReady" });
  });

  it("shows current-source errors instead of stale last-good output", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText("nui 4\npoint A = coordinate(", "test");

    render(<OutputPreviewApp api={api} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Output Preview unavailable");
  });

  it("offers fatal-source diagnostic navigation when the physical span is safe", async () => {
    const brokenSource = "nui 4\npoint A = coordinate(";
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText(brokenSource, "test");
    render(<OutputPreviewApp api={api} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: brokenSource, documentVersion: 1 }
      }));
    });

    const navigate = await screen.findByRole("button", { name: "Go to source" });
    fireEvent.click(navigate);

    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) })
    }));
  });

  it("navigates from the real invalid-overlap compiler diagnostic to the overlap value", async () => {
    mocks.evaluateOutputPlan.mockRejectedValue(new Error("not relevant to this diagnostic"));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: invalidOverlapSource, documentVersion: 1 }
      }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("A4 portrait では overlap を 105mm 未満にしてください。");
    const navigate = await screen.findByRole("button", { name: "Go to source" });
    fireEvent.click(navigate);

    const from = invalidOverlapSource.indexOf("200");
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: { from, to: from + "200".length }
    });
  });

  it("uses the selector as the output label and exposes crosshair and maximize ribbon actions", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    expect(document.querySelector(".output-preview-title-button")).toBeNull();
    expect((screen.getByRole("combobox") as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("Print · A");
    expect(screen.getByRole("button", { name: "ソースエディタで出力定義を表示" })).toBeInTheDocument();
    const maximize = screen.getByRole("button", { name: "出力全体をプレビューに合わせる" });
    expect(maximize).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    fireEvent.click(screen.getByRole("button", { name: "ソースエディタで出力定義を表示" }));
    const printStart = source.indexOf("print A(");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: expect.objectContaining({ from: printStart, to: expect.any(Number) })
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: "出力全体をプレビューに合わせる" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "出力全体をプレビューに合わせる" }));
    expect(api.postMessage).toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("uses an exact current diagnostic range for a current-source output error", async () => {
    mocks.evaluateOutputPlan.mockRejectedValue(new Error("output evaluation failed"));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const from = source.indexOf("overlap: 5");
    const to = from + "overlap: 5".length;
    useCadDocumentStore.setState({
      diagnostics: [{
        severity: "error",
        line: 10,
        column: 3,
        message: "output value failed",
        physicalSpan: { segments: [{ from, to }], sourceRevision: state.currentSourceRevision },
        navigationTarget: { kind: "property", occurrenceKey: "output:overlap" }
      }]
    });

    const navigate = await screen.findByRole("button", { name: "Go to source" });
    fireEvent.click(navigate);

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: { from, to }
    });
  });

  it("auto-fits the initial selected output", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();

    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
  });

  it("auto-fits after a selector change", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: outputKeyFor("svg", "B") } });

    await waitFor(() => expect(Number(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="output-fill"]')?.getAttribute("width"))).toBeGreaterThan(100));
  });

  it("preserves the viewport across a normal valid source edit", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const before = pageFill().getAttribute("x");

    act(() => useCadDocumentStore.getState().commitText(repairedSource, "test"));

    await waitFor(() => expect(pageFill().getAttribute("x")).not.toBe(before));
  });

  it("pans with the middle mouse button", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const before = Number(pageFill().getAttribute("x"));
    const viewport = document.querySelector(".output-preview-viewport");

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { button: 1, buttons: 4, pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 120, clientY: 100 });

    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 20));
  });

  it("falls back to A, fits once, and keeps A selected when B is re-added", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const initialA = pageFill().getAttribute("x");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: outputKeyFor("svg", "B") } });
    await waitFor(() => expect(Number(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="output-fill"]')?.getAttribute("width"))).toBeGreaterThan(100));
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { button: 1, buttons: 4, pointerId: 1, clientX: 180, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 180, clientY: 100 });

    act(() => useCadDocumentStore.getState().commitText(printSourceWithoutB, "test"));
    await waitFor(() => expect(pageFill().getAttribute("x")).toBe(initialA));
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
    const fallbackA = pageFill().getAttribute("x");

    act(() => useCadDocumentStore.getState().commitText(source, "test"));
    await waitFor(() => expect(pageFill().getAttribute("x")).toBe(fallbackA));
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
  });

  it("recovers after a current-source error is repaired", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    act(() => useCadDocumentStore.getState().commitText("nui 4\npoint Broken = coordinate(", "test"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    act(() => useCadDocumentStore.getState().commitText(source, "test"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
  });

  it("hydrates both Manual E2E outputs and opens the output at a cursor offset", async () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    render(<OutputPreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: outputPreviewManualE2eSource, documentVersion: 1 }
      }));
    });

    await waitFor(() => expect(screen.getByRole("combobox").querySelectorAll("option")).toHaveLength(2));
    expect([...screen.getByRole("combobox").querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Print · 家庭用A4",
      "SVG · 型紙SVG"
    ]);
    expect(useCadDocumentStore.getState().printOutputs.map((output) => output.name)).toEqual(["家庭用A4"]);
    expect(useCadDocumentStore.getState().svgOutputs.map((output) => output.name)).toEqual(["型紙SVG"]);

    const printKey = outputKeyFor("print", "家庭用A4");
    const svgKey = outputKeyFor("svg", "型紙SVG");
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "outputPreviewOpen",
          documentVersion: 1,
          normalizedSourceOffset: outputPreviewManualE2eSource.indexOf("profile: @印刷用")
        }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(printKey));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "outputPreviewOpen",
          documentVersion: 1,
          normalizedSourceOffset: outputPreviewManualE2eSource.indexOf("profile: @SVG用")
        }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(svgKey));
  });

  it("renders overlapping page fills, geometry, boundaries, and guides in contract order", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();

    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const layers = [...screen.getByLabelText("Output preview").querySelectorAll("[data-output-preview-layer]")]
      .map((element) => element.getAttribute("data-output-preview-layer"));

    expect(layers).toEqual([
      "page-fill",
      "page-fill",
      "geometry",
      "page-boundary",
      "page-boundary",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide"
    ]);
  });

  it("accepts exact physical spans for semantic diagnostic targets and fails closed otherwise", () => {
    const diagnostic = (physicalSpan: DslDiagnostic["physicalSpan"], navigationTarget?: DslDiagnostic["navigationTarget"]): DslDiagnostic => ({
      severity: "error",
      line: 1,
      column: 1,
      message: "error",
      physicalSpan,
      ...(navigationTarget ? { navigationTarget } : {})
    });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 2 }))).toBeNull();
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: -1, to: 2 }], sourceRevision: 3 }))).toBeNull();
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }, { from: 4, to: 5 }], sourceRevision: 3 }))).toBeNull();
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }, { kind: "binding", bindingId: "binding" }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }, { kind: "property", occurrenceKey: "property" }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 0, to: 1 }], sourceRevision: 3 }, { kind: "sourceSpan", physicalSpan: { segments: [{ from: 1, to: 2 }], sourceRevision: 3 } }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic(undefined, { kind: "binding", bindingId: "binding" }))).toBeNull();
  });
});
