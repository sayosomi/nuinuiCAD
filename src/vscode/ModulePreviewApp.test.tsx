import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, type RefObject } from "react";
import type { DslReferencePickTarget } from "@nuinuicad/nui-language";
import type { ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import { modulePreviewInvocationFor } from "../dsl/modulePreviewInvocation";
import type { ModulePreviewInvocationEditorAppProps } from "./ModulePreviewInvocationEditorApp";
import type { ModulePreviewTarget } from "../dsl/modulePreviewTarget";

const mocks = vi.hoisted(() => ({
  queryModulePreviewTarget: vi.fn(),
  session: { activate: vi.fn(), getState: vi.fn(), setInvocationText: vi.fn() },
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
  canvasUnmounts: 0,
  referencePickTargetFor: vi.fn(),
  referencePickCandidates: vi.fn(() => [])
}));

vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: ({ canvasFocusRef }: { canvasFocusRef: RefObject<HTMLDivElement | null> }) => {
    useEffect(() => {
      mocks.canvasMounts += 1;
      return () => { mocks.canvasUnmounts += 1; };
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
vi.mock("./modulePreviewEvaluation", () => ({ buildModulePreviewEvaluationOptions: () => ({}) }));
vi.mock("./modulePreviewReferencePick", () => ({
  modulePreviewReferencePickTargetFor: mocks.referencePickTargetFor
}));
vi.mock("../model/referencePickCandidates", async () => {
  const actual = await vi.importActual<typeof import("../model/referencePickCandidates")>("../model/referencePickCandidates");
  return { ...actual, referencePickCandidates: mocks.referencePickCandidates };
});
vi.mock("./ModulePreviewInvocationEditorApp", () => ({
  ModulePreviewInvocationEditorApp: ({ invocation }: ModulePreviewInvocationEditorAppProps) => invocation ? (
    <div data-module-preview-invocation-surface="true">
      {invocation.blocks.map((block) => <section key={block.definitionStatementId} data-module-preview-invocation-block-kind={block.kind}>{block.kind === "target" ? "Target" : "Context"}: {block.name}</section>)}
    </div>
  ) : <div data-module-preview-invocation-unavailable="true" />
}));

import { AutomationDocument } from "@nuinuicad/nui-language/document";
import { ModulePreviewApp } from "./ModulePreviewApp";

const sourceText = "nui 1\nmodule Preview(anchor: point) {\n}\n";
const target: ModulePreviewTarget = { definitionStatementId: "module:preview", definitionStatementIndex: 1, name: "Preview" };
const root = {
  target,
  compileResult: { elements: [], visibilityProfiles: [], activeVisibilityProfileId: null },
  targetRuntimeElementIds: [],
  diagnostics: [],
  moduleMaterialization: {},
  moduleSemanticAnalysis: {},
  candidateCompiledDocument: { spans: { sourceMap: { source: sourceText, sourceRevision: 1 } } }
};
const invocation = modulePreviewInvocationFor({ blocks: [{
  kind: "target",
  definitionStatementId: target.definitionStatementId,
  definitionStatementIndex: target.definitionStatementIndex,
  declarationScopeId: "scope:root",
  name: target.name,
  parameters: [{
    definitionStatementId: target.definitionStatementId,
    parameterIndex: 0,
    name: "anchor",
    type: { kind: "point" },
    optional: false,
    required: true,
    defaultSourceText: null,
    active: true,
    value: "@Top",
    caller: { statementIndex: 1, scopeId: "scope:root", sourceOrderIndex: 1 }
  }]
}]});
const snapshot: ModulePreviewSessionSnapshot = {
  sourceRevision: 1,
  target,
  ancestorContexts: [],
  parameters: { kind: "target", definitionStatementId: target.definitionStatementId, name: target.name, parameters: [] },
  invocation,
  inputDiagnostics: [],
  preview: { kind: "current", result: root as never }
};

const referencePickTarget: DslReferencePickTarget = {
  sourceAnchor: {
    sourceRevision: 1,
    statementId: target.definitionStatementId,
    statementIndex: target.definitionStatementIndex,
    sourceOrderIndex: target.definitionStatementIndex,
    scopeId: "scope:root",
    statementRange: { from: sourceText.indexOf("module Preview"), to: sourceText.length, startLine: 2, endLine: 3 }
  },
  expectedGeometryInterface: "point",
  role: "geometry",
  multiplicity: "single",
  range: { from: sourceText.indexOf("module Preview"), to: sourceText.length }
};

const renderPreview = () => {
  AutomationDocument.fromSource(sourceText);
  mocks.queryModulePreviewTarget.mockReturnValue(target);
  mocks.session.activate.mockReturnValue(snapshot);
  mocks.session.getState.mockReturnValue(snapshot);
  render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "replaceTextDocument", sourceText, documentVersion: 1 } }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Preview") } }));
  });
};

afterEach(() => {
  cleanup();
  mocks.queryModulePreviewTarget.mockReset();
  mocks.referencePickTargetFor.mockReset();
  mocks.referencePickCandidates.mockReset();
  mocks.referencePickCandidates.mockReturnValue([]);
  mocks.session.activate.mockReset();
  mocks.session.getState.mockReset();
  mocks.session.setInvocationText.mockReset();
  mocks.postMessage.mockReset();
  mocks.canvasMounts = 0;
  mocks.canvasUnmounts = 0;
});

describe("ModulePreviewApp invocation composition", () => {
  it("renders the invocation editor above the existing Canvas split", () => {
    renderPreview();
    const editor = document.querySelector("[data-module-preview-invocation-surface='true']")!;
    const separator = screen.getByRole("separator");
    const canvas = document.querySelector("[data-module-preview-canvas-region='true']")!;
    expect(editor.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editor).toHaveTextContent("Target: Preview");
    expect(screen.getByTestId("module-preview-canvas")).toBeInTheDocument();
  });

  it("keeps split resizing and the Canvas mounted while invocation content is present", () => {
    renderPreview();
    const workspace = document.querySelector(".module-preview-workspace")!;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 1000, height: 1000, width: 800, left: 0, right: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const separator = screen.getByRole("separator");
    const canvas = screen.getByTestId("module-preview-canvas");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(separator).toHaveAttribute("aria-valuenow", "40");
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientY: 550 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientY: 650 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientY: 650 });
    expect(screen.getByTestId("module-preview-canvas")).toBe(canvas);
    expect(mocks.canvasMounts).toBe(1);
    expect(mocks.canvasUnmounts).toBe(0);
  });

  it("routes a production Reference Pick request through ModulePreviewApp current context into the Canvas session hook", () => {
    mocks.referencePickTargetFor.mockReturnValue(referencePickTarget);
    renderPreview();
    const parameter = snapshot.invocation.blocks[0]!.parameters[0]!;
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewReferencePickStartRequest",
          requestId: 1,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: 1,
          normalizedSource: sourceText,
          sourceRevision: snapshot.sourceRevision,
          sessionRevision: 2,
          targetDefinitionStatementId: snapshot.target.definitionStatementId,
          targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
          targetName: snapshot.target.name,
          definitionStatementId: parameter.definitionStatementId,
          blockKind: snapshot.invocation.blocks[0]!.kind,
          blockDefinitionStatementIndex: snapshot.invocation.blocks[0]!.definitionStatementIndex,
          blockName: snapshot.invocation.blocks[0]!.name,
          parameterIndex: parameter.parameterIndex,
          invocationText: snapshot.invocation.blocks[0]!.text,
          selectionStart: parameter.valueRange.from,
          selectionEnd: parameter.valueRange.to,
          expectedGeometryInterface: "point",
          role: "geometry",
          multiplicity: "single"
        }
      }));
    });

    expect(mocks.referencePickTargetFor).toHaveBeenCalledWith(expect.objectContaining({
      root,
      definitionStatementId: target.definitionStatementId,
      parameterIndex: 0,
      expectedGeometryInterface: "point"
    }));
    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewReferencePickResult",
      requestId: 1,
      status: "started"
    }));
  });
});
