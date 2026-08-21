import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import type { OutputPlan } from "../output/outputCore";
import { OutputPreviewApp, outputPreviewDiagnosticSourceRangeFor } from "./OutputPreviewApp";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { VscodeWebviewApi } from "./protocol";

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
  "  margin: 10,",
  "  overlap: 5,",
  ")",
  "svg B(",
  "  layout: @L,",
  "  margin: 1,",
  ")"
].join("\n");

const printSourceWithoutB = source.slice(0, source.indexOf("svg B("));
const repairedSource = source.replace("margin: 10", "margin: 20");

const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20, width: 20, height: 20 };

type TestOutput = {
  id: string;
  name: string;
  layoutId: string;
  margin: number | { kind: "expression"; expression: string };
  paper?: "a4" | "a3";
};

const planFor = (output: TestOutput): OutputPlan => {
  const isPrint = output.paper !== undefined;
  const margin = typeof output.margin === "number" ? output.margin : 1;
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
      origin: { x: -margin, y: -margin },
      guides: [{ axis: "vertical" as const, positionMm: 50, label: "", labelFontSizeMm: 0, labelRotationDeg: 0, labelCenter: { x: 0, y: 0 }, labelWidthMm: 0, labelAdvancesMm: [] }]
    },
    {
      index: 1,
      column: 1,
      row: 0,
      origin: { x: 80 - margin, y: -margin },
      guides: [{ axis: "vertical" as const, positionMm: 50, label: "", labelFontSizeMm: 0, labelRotationDeg: 0, labelCenter: { x: 0, y: 0 }, labelWidthMm: 0, labelAdvancesMm: [] }]
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
            paperWidthMm: 100,
            paperHeightMm: 100,
            marginMm: margin,
            overlapMm: 20,
            effectiveWidthMm: 60,
            effectiveHeightMm: 60,
            strideXmm: 80,
            strideYmm: 80,
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

  it("offers current diagnostic source navigation when the physical span is safe", async () => {
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
      "overlap-guide"
    ]);
  });

  it("exposes only a single current-revision diagnostic physical span for navigation", () => {
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
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }, { kind: "binding", bindingId: "binding" }))).toBeNull();
  });
});
