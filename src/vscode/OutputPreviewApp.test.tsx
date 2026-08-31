import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import type { OutputPlan } from "../output/outputCore";
import { evaluateElementsReferencePayload } from "../geometry/evaluationEngine";
import { OutputPreviewApp } from "./OutputPreviewApp";
import { outputPreviewDiagnosticSourceRangeFor } from "./outputPreviewDiagnostics";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { VscodeToExtensionMessage, VscodeWebviewApi } from "./protocol";
import { outputPreviewManualE2eSource } from "./outputPreviewManualFixture";
import * as vscodeCanvasRibbonIcons from "./vscodeCanvasRibbonIcons";

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
const sourceWithThreeOutputs = `${source}\nsvg C(\n  layout: @L,\n  margin: 2,\n)`;
const coldRevealSource = [
  "nui 4",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "group Other {",
  "  line CD = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout First {",
  "  place @Other(at: (0, 0))",
  "}",
  "layout Target {",
  "  place @G(at: (0, 0))",
  "}",
  "print A(",
  "  layout: @First,",
  "  paper: a4,",
  "  overlap: 5,",
  ")",
  "svg B(",
  "  layout: @Target,",
  "  margin: 1,",
  ")"
].join("\n");
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
    rustPayload: isPrint
      ? {
          version: 1,
          kind: "print",
          bounds,
          drawables: [drawable],
          paper: { widthMm: paperWidthMm, heightMm: paperHeightMm },
          overlapMm: overlap,
          stride: { x: strideXmm, y: strideYmm },
          pages
        }
      : {
          version: 1,
          kind: "svg",
          bounds,
          drawables: [drawable],
          widthMm: bounds.width,
          heightMm: bounds.height,
          contentOrigin: { x: bounds.minX, y: bounds.minY }
        },
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

const planWithRepeatedDrawables = (output: TestOutput): OutputPlan => {
  const plan = planFor(output);
  const drawable = plan.drawables[0];
  if (!drawable) throw new Error("missing test drawable");
  return {
    ...plan,
    drawables: [drawable, { ...drawable }]
  };
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

type RevealResultMessage = Extract<VscodeToExtensionMessage, { type: "outputPreviewRevealResult" }>;
const revealResultMessages = () => vi.mocked(api.postMessage).mock.calls
  .map(([message]) => message)
  .filter((message): message is RevealResultMessage =>
    typeof message === "object" && message !== null && (message as { type?: string }).type === "outputPreviewRevealResult"
  );

const postWindowMessage = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
};

const createControlledRustApi = () => {
  const requests: Array<{ id: number; input: unknown; responded: boolean }> = [];
  const postMessage = vi.fn((message: VscodeToExtensionMessage) => {
    if (message.type === "rustEvaluationRequest") {
      requests.push({ id: message.id, input: message.input, responded: false });
    }
  });
  const api = { postMessage } satisfies VscodeWebviewApi;
  const respondNext = async () => {
    const request = requests.find((candidate) => !candidate.responded);
    if (!request) throw new Error("missing pending Rust evaluation request");
    request.responded = true;
    const input = request.input as { elements: Parameters<typeof evaluateElementsReferencePayload>[0] };
    const payload = evaluateElementsReferencePayload(input.elements);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "rustEvaluationResponse", id: request.id, payload }
      }));
      await Promise.resolve();
    });
  };
  return { api, requests, respondNext };
};

describe("Output Preview application", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useCadDocumentStore.setState(initialCadDocumentState());
    vi.mocked(api.postMessage).mockReset();
    mocks.evaluateOutputPlan.mockReset();
    vi.restoreAllMocks();
  });

  it("shows the default viewport status before pointer entry and tracks Y-up pointer coordinates", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    renderFixture("nui 4");

    const status = screen.getByRole("status", { name: "Output Preview status: ZOOM: 100%, X: —, Y: —" });
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");

    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 150 });
    expect(status).toHaveTextContent("ZOOM100%X-150.0Y150.0");

    fireEvent.pointerMove(viewport, { clientX: 270, clientY: 130 });
    expect(status).toHaveTextContent("ZOOM100%X-130.0Y170.0");

    fireEvent.pointerLeave(viewport);
    expect(status).toHaveTextContent("ZOOM100%X—Y—");
  });

  it("updates the stored pointer anchor for wheel zoom and recomputes status after reset", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    renderFixture("nui 4");
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    expect(status).toHaveTextContent("ZOOM110%X-150.0Y150.0");

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "outputPreviewResetView" } }));
    });
    expect(status).toHaveTextContent("ZOOM100%X-150.0Y150.0");
  });

  it("recomputes a stationary pointer after viewport pan and viewport-size changes", () => {
    let currentRect = {
      ...viewportRect,
      left: 100,
      top: 50,
      right: 900,
      bottom: 650
    } as DOMRect;
    let resize: (() => void) | null = null;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this as unknown as ResizeObserver);
      }

      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => currentRect);
    renderFixture("nui 4");
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });

    fireEvent.pointerMove(viewport, { clientX: 350, clientY: 250 });
    expect(status).toHaveTextContent("ZOOM100%X-150.0Y100.0");

    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 350, clientY: 250 });
    fireEvent.pointerMove(viewport, { button: 1, buttons: 4, pointerId: 1, clientX: 370, clientY: 230 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 370, clientY: 230 });
    expect(status).toHaveTextContent("ZOOM100%X-150.0Y100.0");

    currentRect = {
      ...viewportRect,
      left: 150,
      top: 100,
      right: 1150,
      bottom: 900,
      width: 1000,
      height: 800
    } as DOMRect;
    act(() => resize?.());
    expect(status).toHaveTextContent("ZOOM100%X-300.0Y250.0");
  });

  it("keeps Reset available without a plan while Fit remains plan-dependent", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const iconResolver = vi.spyOn(vscodeCanvasRibbonIcons, "resolveVscodeLucideIcon");
    renderFixture("nui 4");

    const reset = screen.getByRole("button", { name: "Reset Output Preview View" });
    const fit = screen.getByRole("button", { name: "Fit Output Preview" });
    expect(iconResolver).toHaveBeenCalledWith("rotate-ccw");
    expect(iconResolver).toHaveBeenCalledWith("maximize");
    expect(reset).not.toBeDisabled();
    expect(fit).toBeDisabled();

    fireEvent.click(reset);
    expect(api.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });
  });

  it("resets the viewport without changing the selected output or triggering Fit", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));

    const svgKey = outputKeyFor("svg", "B");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: svgKey } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export SVG" })).toBeInTheDocument());
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    expect(screen.getByRole("combobox")).toHaveValue(svgKey);

    fireEvent.click(screen.getByRole("button", { name: "Reset Output Preview View" }));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "outputPreviewResetView" } }));
    });

    expect(screen.getByRole("combobox")).toHaveValue(svgKey);
    expect(screen.getByRole("button", { name: "Fit Output Preview" })).not.toBeDisabled();
    expect(screen.getByRole("status", { name: /Output Preview status:/ })).toHaveTextContent("ZOOM100%");
    expect(Number(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="output-fill"]')?.getAttribute("width"))).toBe(20);
  });

  it("opens with an explicit empty state when there are no current outputs", () => {
    useCadDocumentStore.setState(initialCadDocumentState());

    render(<OutputPreviewApp api={api} />);

    expect(screen.getByText("No print or SVG outputs")).toBeInTheDocument();
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
    const selector = screen.getByRole("combobox");
    expect((selector as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("Print · A");
    const sourceNavigation = screen.getByRole("button", { name: "Go to Source" });
    const maximize = screen.getByRole("button", { name: "Fit Output Preview" });
    expect(sourceNavigation).toBeInTheDocument();
    expect(maximize).toBeInTheDocument();
    const outputGroup = document.querySelector(".output-preview-output-group");
    if (!outputGroup) throw new Error("missing output preview output group");
    expect(outputGroup).toContainElement(selector);
    expect(outputGroup).toContainElement(sourceNavigation);
    expect(outputGroup).not.toContainElement(maximize);
    expect(sourceNavigation.closest(".command-ribbon")).toHaveAttribute("data-ribbon-id", "output-preview-ribbon");
    expect(maximize.closest(".command-ribbon")).toHaveAttribute("data-ribbon-id", "output-preview-fit-ribbon");
    expect(sourceNavigation.closest(".command-ribbon")).not.toBe(maximize.closest(".command-ribbon"));
    expect(sourceNavigation).toHaveAttribute("title", "Go to Source");
    expect(document.getElementById(sourceNavigation.getAttribute("aria-describedby")!)?.textContent).toBe("Go to Source");
    expect(maximize).toHaveAttribute("title", "Fit Output Preview");
    expect(document.getElementById(maximize.getAttribute("aria-describedby")!)?.textContent).toBe("Fit Output Preview");

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    fireEvent.click(sourceNavigation);
    const printStart = source.indexOf("print A(");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: expect.objectContaining({ from: printStart, to: expect.any(Number) })
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Fit Output Preview" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Fit Output Preview" }));
    expect(api.postMessage).toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("exports the exact current print plan once and re-enables after the host result", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const exportButton = await screen.findByRole("button", { name: "Export PDF" });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportAvailability",
      documentVersion: 7,
      outputKey: outputKeyFor("print", "A"),
      format: "pdf"
    })));
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "webviewReady")).toHaveLength(1);

    fireEvent.click(exportButton);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportRequest",
      requestId: 1,
      documentVersion: 7,
      outputKey: outputKeyFor("print", "A"),
      outputName: "A",
      format: "pdf",
      payload: expect.objectContaining({ kind: "print" })
    }));
    expect(exportButton).toBeDisabled();
    fireEvent.click(exportButton);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "outputPreviewExportRequest")).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "outputPreviewExportResult", requestId: 1, status: "saved" }
      }));
    });
    await waitFor(() => expect(exportButton).not.toBeDisabled());
  });

  it("uses the same current export request for Palette dispatch and switches to SVG", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 3 }
      }));
    });
    const svgKey = outputKeyFor("svg", "B");
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: svgKey } });
    const exportButton = await screen.findByRole("button", { name: "Export SVG" });

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "outputPreviewExport" } }));
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportRequest",
      documentVersion: 3,
      outputKey: svgKey,
      outputName: "B",
      format: "svg",
      payload: expect.objectContaining({ kind: "svg" })
    })));
    expect(exportButton).toBeDisabled();
  });

  it("withdraws export availability while the current source is invalid", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    expect(await screen.findByRole("button", { name: "Export PDF" })).toBeInTheDocument();

    act(() => useCadDocumentStore.getState().commitText("nui 4\npoint Broken = coordinate(", "test"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull());
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportAvailability",
      outputKey: null,
      format: null
    }));
  });

  it("positions Output Preview ribbon tooltips relative to the workspace boundary", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    const workspace = document.querySelector<HTMLElement>(".output-preview-workspace");
    if (!workspace) throw new Error("missing output preview workspace");
    const trigger = screen.getByRole("button", { name: "Go to Source" });
    const tooltip = document.getElementById(trigger.getAttribute("aria-describedby") ?? "");
    if (!(tooltip instanceof HTMLElement)) throw new Error("missing output preview tooltip");

    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      ...viewportRect,
      left: 100,
      top: 50,
      right: 500,
      bottom: 350,
      width: 400,
      height: 300
    });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      ...viewportRect,
      left: 200,
      top: 100,
      right: 240,
      bottom: 124,
      width: 40,
      height: 24
    });
    vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue({
      ...viewportRect,
      left: 0,
      top: 0,
      right: 180,
      bottom: 30,
      width: 180,
      height: 30
    });

    expect(document.querySelector(".output-preview-command-ribbon")).toHaveClass("has-viewport-aware-tooltips");
    fireEvent.focus(trigger);
    expect(tooltip).toHaveStyle({ position: "fixed", left: "130px", top: "130px", transform: "none" });
  });

  it("publishes a VS Code blank context without native Cut, Copy, and Paste items", () => {
    renderFixture("nui 4");
    const viewport = document.querySelector(".output-preview-viewport");
    expect(viewport).not.toBeNull();
    expect(JSON.parse(viewport?.getAttribute("data-vscode-context") ?? "{}")).toEqual({
      webviewSection: "blank",
      preventDefaultContextMenuItems: true
    });
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

  it("pans with the middle mouse button after capture even when pointermove buttons are unavailable", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const before = Number(pageFill().getAttribute("x"));
    const viewport = document.querySelector(".output-preview-viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });
    const zoomBeforePan = status.textContent?.match(/ZOOM\d+%/)?.[0];

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 120, clientY: 100 });

    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 20));
    expect(zoomBeforePan).toBeDefined();
    expect(status).toHaveTextContent(zoomBeforePan ?? "");
    expect(status).toHaveTextContent(/X-?\d+\.\d+Y-?\d+\.\d+/);
  });

  it("keeps the viewport owner reachable when the React root pointer boundary is interrupted", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    const container = document.createElement("div");
    document.body.append(container);
    const blockReactPointerBoundary = (event: Event) => event.stopImmediatePropagation();
    const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"];
    pointerEvents.forEach((eventName) => container.addEventListener(eventName, blockReactPointerBoundary));

    try {
      useCadDocumentStore.getState().commitText(source, "test");
      render(<OutputPreviewApp api={api} />, { container });
      await waitFor(() => expect(Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("width"))).toBeGreaterThan(400));
      const viewport = container.querySelector(".output-preview-viewport");
      if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
      const before = Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("x"));

      await act(async () => {
        fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
        await Promise.resolve();
      });

      expect(Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("x"))).toBeCloseTo(before + 20);
    } finally {
      pointerEvents.forEach((eventName) => container.removeEventListener(eventName, blockReactPointerBoundary));
      cleanup();
      container.remove();
    }
  });

  it("ends a captured middle-button pan on pointerup and keeps wheel zoom available", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const before = Number(pageFill().getAttribute("x"));
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 20));
    const afterPan = Number(pageFill().getAttribute("x"));
    const zoomBeforeWheel = status.textContent?.match(/ZOOM\d+%/)?.[0];

    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 160, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterPan);

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    expect(zoomBeforeWheel).toBeDefined();
    expect(status.textContent?.match(/ZOOM\d+%/)?.[0]).not.toBe(zoomBeforeWheel);
  });

  it("keeps the middle-button pan session bound to its pointer and cancels it safely", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    const beforeDifferentPointer = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 2, clientX: 140, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeDifferentPointer);
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 110, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeDifferentPointer + 10));

    fireEvent.pointerCancel(viewport, { pointerId: 1, clientX: 110, clientY: 100 });
    const afterCancel = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 130, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterCancel);
  });

  it("ends a middle-button pan when pointer capture is lost", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const before = Number(pageFill().getAttribute("x"));
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 110, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 10));
    fireEvent.lostPointerCapture(viewport, { pointerId: 1, clientX: 110, clientY: 100 });
    const afterLostCapture = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 130, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterLostCapture);
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

  it("recovers the selected output after a current-source error is repaired", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    const svgKey = outputKeyFor("svg", "B");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: svgKey } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export SVG" })).toBeInTheDocument());

    act(() => useCadDocumentStore.getState().commitText("nui 4\npoint Broken = coordinate(", "test"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    act(() => useCadDocumentStore.getState().commitText(source, "test"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("combobox")).toHaveValue(svgKey);
    expect(screen.getByRole("button", { name: "Export SVG" })).toBeInTheDocument();
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

  it("keeps the current output selection when opened without a source cursor", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    const svgKey = outputKeyFor("svg", "B");
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "outputPreviewOpen",
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("svg B(")
        }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(svgKey));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "outputPreviewOpen", documentVersion: 1, normalizedSourceOffset: null }
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

  it("keeps a selected containing Output selected, installs its highlight, and refits visible geometry", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 11 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 7,
      documentVersion: 11,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 7,
      documentVersion: 11,
      status: "resolved",
      outputKey: outputKeyFor("print", "A")
    }));
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
    expect(screen.getByLabelText("Output preview").querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(1);
    expect(screen.getByRole("status", { name: /Output Preview status:/ })).toHaveTextContent("ZOOM2000%");
  });

  it("keeps a no-containing target distinct from stale and evaluation failures", async () => {
    const sourceWithUnused = source.replace(
      "layout L {",
      "point Unused = coordinate(x: 40, y: 40)\nlayout L {"
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture(sourceWithUnused);
    postWindowMessage({ type: "replaceTextDocument", sourceText: sourceWithUnused, documentVersion: 12 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 8,
      documentVersion: 12,
      normalizedSourceOffset: sourceWithUnused.indexOf("point Unused") + 2
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 8,
      documentVersion: 12,
      status: "failed",
      reason: "no-containing-output"
    }));
  });

  it("keeps the explicit target fit through cross-output Reveal and delayed ordinary evaluation", async () => {
    const crossOutputSource = [
      "nui 4",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout Empty {",
      "}",
      "layout Target {",
      "  place @G(at: (0, 0))",
      "}",
      "print A(",
      "  layout: @Empty,",
      "  paper: a4,",
      "  overlap: 5,",
      ")",
      "svg B(",
      "  layout: @Target,",
      "  margin: 1,",
      ")"
    ].join("\n");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture(crossOutputSource);
    postWindowMessage({ type: "replaceTextDocument", sourceText: crossOutputSource, documentVersion: 13 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));

    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    const initialEvaluationCallCount = mocks.evaluateOutputPlan.mock.calls.length;

    const pending: Array<{
      output: TestOutput;
      promise: Promise<OutputPlan>;
      resolve: (plan: OutputPlan) => void;
    }> = [];
    mocks.evaluateOutputPlan.mockImplementation(({ output }: { output: TestOutput }) => {
      let resolve!: (plan: OutputPlan) => void;
      const promise = new Promise<OutputPlan>((resolvePromise) => { resolve = resolvePromise; });
      pending.push({ output, promise, resolve });
      return promise;
    });
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 9,
      documentVersion: 13,
      normalizedSourceOffset: crossOutputSource.indexOf("layout Target") + 2
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    const firstRevealEvaluation = pending[0];
    if (!firstRevealEvaluation) throw new Error("missing first Reveal evaluation");
    await act(async () => {
      firstRevealEvaluation.resolve(planFor(firstRevealEvaluation.output));
      await firstRevealEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const secondRevealEvaluation = pending[1];
    if (!secondRevealEvaluation) throw new Error("missing second Reveal evaluation");
    await act(async () => {
      secondRevealEvaluation.resolve(planFor(secondRevealEvaluation.output));
      await secondRevealEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 9,
      documentVersion: 13,
      status: "resolved",
      outputKey: outputKeyFor("svg", "B")
    }));
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("svg", "B")));
    await waitFor(() => expect(pending).toHaveLength(3));

    const revealStatus = screen.getByRole("status", { name: /Output Preview status:/ }).textContent;
    const revealGeometryPath = screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="geometry"]')?.getAttribute("d");
    expect(revealStatus).toContain("ZOOM2000%");

    const ordinaryEvaluation = pending[2];
    if (!ordinaryEvaluation) throw new Error("missing delayed selected-output evaluation");
    await act(async () => {
      ordinaryEvaluation.resolve(planFor(ordinaryEvaluation.output));
      await ordinaryEvaluation.promise;
      await Promise.resolve();
    });
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(initialEvaluationCallCount + pending.length);
    expect(screen.getByRole("status", { name: /Output Preview status:/ }).textContent).toBe(revealStatus);
    expect(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="geometry"]')?.getAttribute("d")).toBe(revealGeometryPath);
  });

  it("removes explicit Reveal highlights when Open Output Preview selects another Output", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 14 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 10,
      documentVersion: 14,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(screen.getByLabelText("Output preview").querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(1));

    postWindowMessage({
      type: "outputPreviewOpen",
      documentVersion: 14,
      normalizedSourceOffset: source.indexOf("svg B(") + 2
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("svg", "B")));
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();
  });

  it("removes explicit Reveal highlights when Output Preview focus is cleared", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 15 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 11,
      documentVersion: 15,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).not.toBeNull());

    postWindowMessage({ type: "outputPreviewClearFocus" });
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();
  });

  it("ignores a replacement Reveal result and only resolves the current request", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 16 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    const pending: Array<{
      output: TestOutput;
      promise: Promise<OutputPlan>;
      resolve: (plan: OutputPlan) => void;
    }> = [];
    mocks.evaluateOutputPlan.mockImplementation(({ output }: { output: TestOutput }) => {
      let resolve!: (plan: OutputPlan) => void;
      const promise = new Promise<OutputPlan>((resolvePromise) => { resolve = resolvePromise; });
      pending.push({ output, promise, resolve });
      return promise;
    });
    const revealOffset = source.indexOf("print A(") + 2;
    postWindowMessage({ type: "outputPreviewReveal", requestId: 20, documentVersion: 16, normalizedSourceOffset: revealOffset });
    postWindowMessage({ type: "outputPreviewReveal", requestId: 21, documentVersion: 16, normalizedSourceOffset: revealOffset });
    await waitFor(() => expect(pending).toHaveLength(1));
    const firstRequestFirstEvaluation = pending[0];
    if (!firstRequestFirstEvaluation) throw new Error("missing first request evaluation");
    await act(async () => {
      firstRequestFirstEvaluation.resolve(planFor(firstRequestFirstEvaluation.output));
      await firstRequestFirstEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const firstRequestSecondEvaluation = pending[1];
    if (!firstRequestSecondEvaluation) throw new Error("missing second request evaluation");
    await act(async () => {
      firstRequestSecondEvaluation.resolve(planFor(firstRequestSecondEvaluation.output));
      await firstRequestSecondEvaluation.promise;
      await Promise.resolve();
    });
    expect(revealResultMessages().some(({ requestId, status }) => requestId === 20 && status === "resolved")).toBe(false);
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();

    await waitFor(() => expect(pending).toHaveLength(3));
    const secondRequestFirstEvaluation = pending[2];
    if (!secondRequestFirstEvaluation) throw new Error("missing current request evaluation");
    await act(async () => {
      secondRequestFirstEvaluation.resolve(planFor(secondRequestFirstEvaluation.output));
      await secondRequestFirstEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(pending).toHaveLength(4));
    const secondRequestSecondEvaluation = pending[3];
    if (!secondRequestSecondEvaluation) throw new Error("missing final current request evaluation");
    await act(async () => {
      secondRequestSecondEvaluation.resolve(planFor(secondRequestSecondEvaluation.output));
      await secondRequestSecondEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(revealResultMessages()).toContainEqual(expect.objectContaining({ requestId: 21, status: "resolved" })));
    expect(revealResultMessages().some(({ requestId, status }) => requestId === 20 && status === "resolved")).toBe(false);
  });

  it("removes explicit Reveal highlights when the authoritative document changes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 17 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 22,
      documentVersion: 17,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).not.toBeNull());

    postWindowMessage({
      type: "replaceTextDocument",
      sourceText: repairedSource,
      documentVersion: 18
    });
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();
  });

  it("renders repeated Reveal drawable occurrences with distinct React identity", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planWithRepeatedDrawables(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 19 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 23,
      documentVersion: 19,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(screen.getByLabelText("Output preview").querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(2));
  });
});

describe("Output Preview production Rust transport lifecycle", () => {
  afterEach(() => {
    cleanup();
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  const useProductionOutputEvaluation = async () => {
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    mocks.evaluateOutputPlan.mockImplementation(actual.evaluateOutputPlan);
  };

  it("resolves cold Reveal alongside ordinary Preview evaluation without transport supersession", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    await useProductionOutputEvaluation();
    const controlled = createControlledRustApi();
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={controlled.api} />);

    postWindowMessage({ type: "replaceTextDocument", sourceText: coldRevealSource, documentVersion: 1 });
    await waitFor(() => expect(controlled.requests).toHaveLength(1));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 1,
      documentVersion: 1,
      normalizedSourceOffset: coldRevealSource.indexOf("group G") + 2
    });
    expect(controlled.requests).toHaveLength(1);

    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(2));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(3));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 1,
      documentVersion: 1,
      status: "resolved",
      outputKey: outputKeyFor("svg", "B")
    }));
  }, 30_000);

  it("completes warm Reveal with three Outputs through the ordered production transport path", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    await useProductionOutputEvaluation();
    const controlled = createControlledRustApi();
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={controlled.api} />);

    postWindowMessage({ type: "replaceTextDocument", sourceText: sourceWithThreeOutputs, documentVersion: 2 });
    await waitFor(() => expect(controlled.requests).toHaveLength(1));
    await controlled.respondNext();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 2,
      documentVersion: 2,
      normalizedSourceOffset: sourceWithThreeOutputs.indexOf("group G") + 2
    });
    await waitFor(() => expect(controlled.requests).toHaveLength(2));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(3));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(4));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 2,
      documentVersion: 2,
      status: "resolved",
      outputKey: outputKeyFor("print", "A")
    }));
  }, 30_000);
});
