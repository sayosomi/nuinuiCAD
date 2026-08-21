import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";
import type { VscodeCanvasRibbon } from "./vscodeCanvasRibbonConfig";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn(),
  hostAdapter: null as CanvasHostAdapter | null,
  canvasFocusRef: null as { current: HTMLDivElement | null } | null
}));

vi.mock("../commands/commands", () => ({
  dispatchCommand: mocks.dispatchCommand
}));

vi.mock("../components/DrawingCanvas", async () => {
  const React = await import("react");
  return {
    DrawingCanvas: React.forwardRef((_props: {
      hostAdapter: CanvasHostAdapter;
      canvasFocusRef: { current: HTMLDivElement | null };
    }, ref) => {
      void ref;
      const props = _props;
      mocks.hostAdapter = props.hostAdapter;
      mocks.canvasFocusRef = props.canvasFocusRef;
      return React.createElement("div", {
        "data-testid": "drawing-canvas",
        ref: props.canvasFocusRef,
        "data-vscode-context": props.hostAdapter.canvasContextMenuData
      });
    })
  };
});

afterEach(() => {
  mocks.dispatchCommand.mockReset();
  mocks.hostAdapter = null;
  mocks.canvasFocusRef = null;
});

const makeEvaluationState = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationRequestRevision: number,
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation,
  evaluationRevision: evaluationRequestRevision,
  evaluationRequestRevision,
  mode: "rust" as EvaluationEngineState["mode"],
  source: "rust",
  status: "evaluating",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const renderCanvas = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationState: EvaluationEngineState | undefined,
  postCanonicalSourceText = vi.fn(),
  canvasRibbonRibbons: VscodeCanvasRibbon[] = [],
  onEditCanvasRibbon = vi.fn()
) => {
  const view = render(
    <VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={evaluationState}
      canvasFocusRef={createRef()}
      postCanonicalSourceText={postCanonicalSourceText}
      canvasRibbonRibbons={canvasRibbonRibbons}
      onEditCanvasRibbon={onEditCanvasRibbon}
    />
  );
  const adapter = mocks.hostAdapter;
  if (!adapter) throw new Error("Canvas host adapter was not captured");
  return { view, adapter, postCanonicalSourceText };
};

describe("VSCodeDrawingCanvas adapter", () => {
  it.each([
    ["blank", false],
    ["blank", true],
    ["element", false],
    ["element", true]
  ] as const)("projects %s Canvas context with selection=%s", (kind, hasSelection) => {
    useCadUiStore.setState({ selectedElementIds: hasSelection ? ["selected"] : [] });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const viewport = screen.getByTestId("drawing-canvas");

    adapter.publishCanvasContextMenu?.({ kind });

    expect(JSON.parse(viewport.getAttribute("data-vscode-context")!)).toEqual({
      webviewSection: kind,
      "nuinuiCAD.canvasHasSelection": hasSelection,
      preventDefaultContextMenuItems: true
    });
  });

  it("refreshes Canvas context from current selection across blank and element transitions", () => {
    useCadUiStore.setState({ selectedElementIds: [] });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const { adapter } = renderCanvas(evaluation, undefined);
    const viewport = screen.getByTestId("drawing-canvas");
    const context = () => JSON.parse(viewport.getAttribute("data-vscode-context")!);

    adapter.publishCanvasContextMenu?.({ kind: "blank" });
    expect(context()).toMatchObject({ webviewSection: "blank", "nuinuiCAD.canvasHasSelection": false });

    useCadUiStore.setState({ selectedElementIds: ["selected"] });
    adapter.publishCanvasContextMenu?.({ kind: "element" });
    expect(context()).toMatchObject({ webviewSection: "element", "nuinuiCAD.canvasHasSelection": true });

    useCadUiStore.setState({ selectedElementIds: [] });
    adapter.publishCanvasContextMenu?.({ kind: "blank" });
    expect(context()).toMatchObject({ webviewSection: "blank", "nuinuiCAD.canvasHasSelection": false });
  });

  it("renders the closed Ribbon surface from shared Canvas state and routes only allowed commands", () => {
    useCadUiStore.setState({
      selectedElementIds: [],
      showCanvasPointNames: true,
      showCanvasGeometryNames: false,
      showCanvasPoints: false
    });
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const onEditCanvasRibbon = vi.fn();
    const ribbons: VscodeCanvasRibbon[] = [{
      id: "ribbon",
      label: "Ribbon",
      x: null,
      y: 12,
      orientation: "vertical",
      items: [
        { id: "clear", type: "command", commandId: "clearCanvasSelection", icon: "x", showLabel: true },
        { id: "names", type: "command", commandId: "toggleCanvasPointNames", icon: "tags", showLabel: false },
        { id: "points", type: "command", commandId: "toggleCanvasPoints", icon: "dot", showLabel: false },
        { id: "unknown", type: "command", commandId: "workbench.action.files.openFile", icon: "circle", showLabel: false },
        { id: "zoom", type: "value", valueId: "canvasZoom" },
        { id: "edit", type: "command", commandId: "editCanvasRibbon", icon: "settings-2", showLabel: false }
      ]
    }];
    const { adapter } = renderCanvas(evaluation, undefined, vi.fn(), ribbons, onEditCanvasRibbon);
    const overlay = adapter.renderHostOverlay?.({ width: 400, height: 300 });
    if (!overlay) throw new Error("Ribbon overlay was not rendered");
    render(overlay);

    expect(screen.getByRole("button", { name: "Ribbonを移動" })).toBeInTheDocument();
    const unavailable = screen.getByRole("button", { name: "workbench.action.files.openFile" });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(unavailable);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("workbench.action.files.openFile", expect.anything());
    expect(screen.getByRole("button", { name: "Toggle Point Names" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "キャンバス点を表示/非表示" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "キャンバス選択を解除" })).toHaveTextContent("キャンバス選択を解除");
    expect(screen.queryByRole("button", { name: "Toggle Canvas Element Names (Legacy)" })).toBeNull();
    expect(screen.getByRole("status", { name: /Canvas status: ZOOM: \d+%, X: —, Y: —/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Canvas Ribbon" }));
    expect(onEditCanvasRibbon).toHaveBeenCalledTimes(1);
  });

  it("uses the VS Code side-handle presentation and inherited currentColor for vertical Ribbons", () => {
    const evaluation = emptyEvaluationResult(useCadDocumentStore.getState().elements);
    const ribbons: VscodeCanvasRibbon[] = [{
      id: "vertical-ribbon",
      label: "Vertical Ribbon",
      x: 12,
      y: 12,
      orientation: "vertical",
      items: [{
        id: "edit",
        type: "command",
        commandId: "editCanvasRibbon",
        icon: "settings-2",
        showLabel: true
      }]
    }];
    const { adapter } = renderCanvas(evaluation, undefined, vi.fn(), ribbons);
    const overlay = adapter.renderHostOverlay?.({ width: 400, height: 300 });
    if (!overlay) throw new Error("Ribbon overlay was not rendered");
    const view = render(overlay);

    expect(view.container.querySelector(".command-ribbon")).toHaveClass("is-vertical", "has-side-handle");
    expect(view.container.querySelector(".command-ribbon")?.children).toHaveLength(2);
    expect(view.container.querySelector(".command-ribbon-buttons")?.children).toHaveLength(1);
    expect(view.container.querySelector("svg")?.getAttribute("style")).toMatch(/color:\s*currentcolor/i);
    expect(view.container.querySelector("svg")).toHaveAttribute("width", "16");
    expect(view.container.querySelector("svg")).toHaveAttribute("height", "16");
  });

  it("keeps preview mutations in the Webview and sends one canonical source after each commit", () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const postCanonicalSourceText = vi.fn();
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const { adapter } = renderCanvas(evaluation, undefined, postCanonicalSourceText);
    const basePointAction = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    adapter.movePointElementByDelta(basePointAction);
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("movePointElementByDelta", basePointAction);
    expect(mocks.dispatchCommand.mock.calls[0]![1].baseElements).toBe(baseElements);

    const pointCommit = { ...basePointAction, commitMode: "commit" as const };
    adapter.movePointElementByDelta(pointCommit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);
    expect(postCanonicalSourceText).toHaveBeenCalledWith(useCadDocumentStore.getState().sourceText);

    const bezierCommit = {
      elementId: baseElements[0]!.id,
      bezierHandleRole: "start" as const,
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "commit" as const,
      baseElements
    };
    adapter.moveBezierHandleByDelta(bezierCommit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand.mock.calls[2]![1].baseElements).toBe(baseElements);
  });

  it("coalesces preview actions until the current evaluation settles", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const evaluating = makeEvaluationState(evaluation, 1);
    const { view, adapter } = renderCanvas(evaluation, evaluating);
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const intermediate = { ...first, dx: 2 };
    const latest = { ...first, dx: 3 };

    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(intermediate);
    adapter.movePointElementByDelta(latest);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", latest);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("movePointElementByDelta", intermediate);
  });

  it("does not flush for stale evaluation and flushes the latest action after current settlement", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const { view, adapter } = renderCanvas(evaluation, makeEvaluationState(evaluation, 1));
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const latest = { ...first, dx: 4 };
    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(latest);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready", isStale: true })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 3, { status: "failed" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", latest);
  });

  it("bypasses the scheduler for canonical commits and drops pending preview", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const postCanonicalSourceText = vi.fn();
    const { view, adapter } = renderCanvas(
      evaluation,
      makeEvaluationState(evaluation, 1),
      postCanonicalSourceText
    );
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const pending = { ...first, dx: 2 };
    const commit = { ...first, dx: 3, commitMode: "commit" as const };
    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(pending);
    adapter.movePointElementByDelta(commit);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", commit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={postCanonicalSourceText}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("movePointElementByDelta", pending);
  });

  it("does not hand off source text for a rejected canonical commit", () => {
    mocks.dispatchCommand
      .mockReturnValueOnce({ status: "applied" })
      .mockReturnValueOnce({ status: "rejected" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const postCanonicalSourceText = vi.fn();
    const { adapter } = renderCanvas(evaluation, undefined, postCanonicalSourceText);
    const preview = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    adapter.movePointElementByDelta(preview);
    adapter.movePointElementByDelta({ ...preview, commitMode: "commit" });
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
  });
});
