import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, type RefObject } from "react";
import type { ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type { ModulePreviewTarget } from "../dsl/modulePreviewTarget";

const mocks = vi.hoisted(() => ({
  queryModulePreviewTarget: vi.fn(),
  session: {
    activate: vi.fn(),
    getState: vi.fn(),
    setValue: vi.fn(),
    useDefaultExplicitly: vi.fn()
  },
  postMessage: vi.fn(),
  evaluationState: {
    evaluation: {
      computedGeometry: new Map(),
      preMutationGeometry: new Map(),
      instanceBaseGeometry: new Map(),
      errors: [],
      warnings: [],
      evaluatedElementIds: new Set(),
      evaluationLimitIndex: 0,
      effectiveVisibleElementIds: new Set(),
      effectiveEnabledElementIds: new Set(),
      effectiveDrawingModifierStrokes: new Map()
    },
    evaluationRevision: 1,
    evaluationRequestRevision: 1,
    mode: "reference" as const,
    source: "reference" as const,
    status: "ready" as const,
    rustEligible: false,
    isStale: false,
    error: null
  },
  canvasMounts: 0,
  canvasUnmounts: 0
}));

vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: ({ canvasFocusRef }: { canvasFocusRef: RefObject<HTMLDivElement | null> }) => {
    useEffect(() => {
      mocks.canvasMounts += 1;
      return () => {
        mocks.canvasUnmounts += 1;
      };
    }, []);
    return <div ref={canvasFocusRef} className="canvas-panel" data-testid="module-preview-canvas" />;
  }
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => mocks.evaluationState
}));

vi.mock("../dsl/modulePreviewState", async () => {
  const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
  return { ...actual, createModulePreviewSession: () => mocks.session };
});

vi.mock("../dsl/modulePreviewTarget", async () => {
  const actual = await vi.importActual<typeof import("../dsl/modulePreviewTarget")>("../dsl/modulePreviewTarget");
  return { ...actual, queryModulePreviewTarget: mocks.queryModulePreviewTarget };
});

vi.mock("./modulePreviewEvaluation", () => ({
  buildModulePreviewEvaluationOptions: () => ({})
}));

import { AutomationDocument } from "@nuinuicad/nui-language/document";
import { ModulePreviewApp } from "./ModulePreviewApp";

const sourceText = "nui 1\nmodule Preview(width: number) {\n}\n";
const target: ModulePreviewTarget = {
  definitionStatementId: "module:preview",
  definitionStatementIndex: 1,
  name: "Preview"
};

const root = {
  target,
  compileResult: {
    elements: [],
    visibilityProfiles: [],
    activeVisibilityProfileId: null
  },
  targetRuntimeElementIds: [],
  diagnostics: [],
  moduleMaterialization: {},
  moduleSemanticAnalysis: {},
  candidateCompiledDocument: {
    spans: { sourceMap: { source: sourceText, sourceRevision: 1 } }
  }
};

const parameter = {
  definitionStatementId: target.definitionStatementId,
  parameterIndex: 0,
  name: "width",
  type: { kind: "number" as const },
  optional: false,
  required: true,
  defaultSourceText: null,
  value: "12",
  diagnostic: null
};

const snapshotFor = (parameters = [parameter]): ModulePreviewSessionSnapshot => ({
  sourceRevision: 1,
  target,
  ancestorContexts: [],
  parameters: {
    kind: "target",
    definitionStatementId: target.definitionStatementId,
    name: target.name,
    parameters
  },
  inputDiagnostics: [],
  preview: { kind: "current", result: root as never }
});

const renderPreview = (snapshot: ModulePreviewSessionSnapshot) => {
  AutomationDocument.fromSource(sourceText);
  mocks.queryModulePreviewTarget.mockReturnValue(target);
  mocks.session.activate.mockReturnValue(snapshot);
  mocks.session.getState.mockReturnValue(snapshot);
  render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Preview") }
    }));
  });
};

afterEach(() => {
  cleanup();
  mocks.queryModulePreviewTarget.mockReset();
  mocks.session.activate.mockReset();
  mocks.session.getState.mockReset();
  mocks.session.setValue.mockReset();
  mocks.session.useDefaultExplicitly.mockReset();
  mocks.postMessage.mockReset();
  mocks.canvasMounts = 0;
  mocks.canvasUnmounts = 0;
});

describe("ModulePreviewApp integrated parameter composition", () => {
  it("renders Parameters above Canvas and omits both when the exact snapshot has no rows", () => {
    renderPreview(snapshotFor());
    const parameters = document.querySelector("[data-module-preview-parameters-region='true']")!;
    const separator = screen.getByRole("separator");
    const canvas = document.querySelector("[data-module-preview-canvas-region='true']")!;
    expect(parameters.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(canvas.querySelector(".canvas-panel")).toBeInTheDocument();

    cleanup();
    mocks.session.activate.mockReturnValue(snapshotFor([]));
    mocks.session.getState.mockReturnValue(snapshotFor([]));
    render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", { data: { type: "replaceTextDocument", sourceText, documentVersion: 1 } }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Preview") }
      }));
    });
    expect(document.querySelector("[data-module-preview-parameters-region='true']")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(document.querySelector("[data-module-preview-canvas-region='true']")).toBeInTheDocument();
  });

  it("resizes the vertical split with pointer and keyboard input without remounting the canvas", () => {
    renderPreview(snapshotFor());
    const workspace = document.querySelector(".module-preview-workspace")!;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 1000,
      height: 1000,
      width: 800,
      left: 0,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect);
    const separator = screen.getByRole("separator");
    const canvas = screen.getByTestId("module-preview-canvas");
    expect(separator).toHaveAttribute("aria-valuenow", "35");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(separator).toHaveAttribute("aria-valuenow", "40");
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientY: 550 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 650 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientY: 650 });
    expect(separator).toHaveAttribute("aria-valuenow", "65");
    expect(screen.getByTestId("module-preview-canvas")).toBe(canvas);
    expect(mocks.canvasMounts).toBe(1);
    expect(mocks.canvasUnmounts).toBe(0);
  });

  it("applies parameter edits through the existing live session and republishes its snapshot", () => {
    const initial = snapshotFor();
    const next = snapshotFor([{ ...parameter, value: "13" }]);
    mocks.session.setValue.mockReturnValue(next);
    renderPreview(initial);

    fireEvent.change(screen.getByLabelText("Value for width"), { target: { value: "13" } });

    expect(mocks.session.setValue).toHaveBeenCalledWith(target.definitionStatementId, 0, "13");
    expect(mocks.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      parameters: expect.objectContaining({
        parameters: [expect.objectContaining({ value: "13" })]
      })
    }));
  });

  it("publishes the edited parameter snapshot before the refreshed focus and completion request", async () => {
    const initial = snapshotFor();
    const next = snapshotFor([{ ...parameter, value: "13" }]);
    mocks.session.setValue.mockReturnValue(next);
    renderPreview(initial);

    const initialParameterSnapshot = mocks.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionRevision?: number })
      .filter((message) => message.type === "modulePreviewParameterSnapshot")
      .at(-1);
    if (!initialParameterSnapshot?.sessionRevision) throw new Error("expected initial parameter snapshot");
    const input = screen.getByLabelText("Value for width");
    input.focus();
    mocks.postMessage.mockClear();

    fireEvent.change(input, { target: { value: "13" } });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    const messages = mocks.postMessage.mock.calls
      .map(([message]) => message as { type?: string; sessionRevision?: number; value?: string })
      .filter((message) => [
        "modulePreviewParameterSnapshot",
        "modulePreviewParameterValueFocus",
        "modulePreviewParameterValueCompletion"
      ].includes(message.type ?? ""));
    const snapshotIndex = messages.findIndex((message) => message.type === "modulePreviewParameterSnapshot");
    const focusIndex = messages.findIndex((message) => message.type === "modulePreviewParameterValueFocus");
    const completionIndex = messages.findIndex((message) => message.type === "modulePreviewParameterValueCompletion");

    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(focusIndex).toBeGreaterThan(snapshotIndex);
    expect(completionIndex).toBeGreaterThan(focusIndex);
    expect(messages[snapshotIndex]).toMatchObject({ sessionRevision: initialParameterSnapshot.sessionRevision + 1 });
    expect(messages[focusIndex]).toMatchObject({ sessionRevision: initialParameterSnapshot.sessionRevision, value: "13" });
    expect(messages[completionIndex]).toMatchObject({ sessionRevision: initialParameterSnapshot.sessionRevision, value: "13" });
  });

  it("keeps the parameter region independently scrollable and the canvas independently sized", () => {
    renderPreview(snapshotFor());
    const parameterRegion = document.querySelector("[data-module-preview-parameters-region='true']")!;
    const canvasRegion = document.querySelector("[data-module-preview-canvas-region='true']")!;
    expect(parameterRegion).toHaveClass("module-preview-parameters-region");
    expect(canvasRegion).toHaveClass("module-preview-canvas-region");
    expect(parameterRegion.firstElementChild).toHaveClass("module-preview-parameters");
    expect(screen.getByTestId("module-preview-canvas")).toHaveClass("canvas-panel");
    expect(mocks.session.activate).toHaveBeenCalledTimes(1);
    expect(mocks.canvasMounts).toBe(1);
  });
});
