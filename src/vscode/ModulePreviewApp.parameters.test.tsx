import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  hostAdapter: null as unknown,
  evaluationState: null as unknown
}));

vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: (props: { hostAdapter: unknown }) => {
    mocks.hostAdapter = props.hostAdapter;
    return null;
  }
}));

vi.mock("../geometry/useEvaluationEngine", async () => {
  const actual = await vi.importActual<typeof import("../geometry/useEvaluationEngine")>("../geometry/useEvaluationEngine");
  return {
    ...actual,
    useEvaluationEngine: vi.fn(() => mocks.evaluationState ?? {
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
      evaluationRevision: 0,
      evaluationRequestRevision: 0,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    })
  };
});

vi.mock("../dsl/modulePreviewState", async () => {
  const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
  return { ...actual, createModulePreviewSession: () => mocks.session };
});

vi.mock("../dsl/modulePreviewTarget", async () => {
  const actual = await vi.importActual<typeof import("../dsl/modulePreviewTarget")>("../dsl/modulePreviewTarget");
  return { ...actual, queryModulePreviewTarget: mocks.queryModulePreviewTarget };
});

import { ModulePreviewApp } from "./ModulePreviewApp";
import { AutomationDocument } from "../document/automationDocument";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { evaluateElements } from "../geometry/evaluate";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";

const target: ModulePreviewTarget = {
  definitionStatementId: "module:preview",
  definitionStatementIndex: 1,
  name: "Preview"
};

const snapshot = {
  sourceRevision: 1,
  target,
  ancestorContexts: [{
    kind: "ancestor" as const,
    definitionStatementId: "module:outer",
    name: "Outer",
    parameters: [{
      definitionStatementId: "module:outer",
      parameterIndex: 0,
      name: "scale",
      type: { kind: "number" as const },
      optional: false,
      required: true,
      defaultSourceText: null,
      value: "2",
      diagnostic: null
    }]
  }],
  parameters: {
    kind: "target" as const,
    definitionStatementId: target.definitionStatementId,
    name: target.name,
    parameters: [{
      definitionStatementId: target.definitionStatementId,
      parameterIndex: 0,
      name: "width",
      type: { kind: "number" as const },
      optional: false,
      required: true,
      defaultSourceText: null,
      value: "3",
      diagnostic: null
    }]
  },
  inputDiagnostics: [],
  preview: { kind: "noValidPreview" as const, result: null }
} satisfies ModulePreviewSessionSnapshot;

const source = "nui 1\nmodule Preview(width: number) {\n}\n";

afterEach(() => {
  cleanup();
  mocks.queryModulePreviewTarget.mockReset();
  mocks.session.activate.mockReset();
  mocks.session.getState.mockReset();
  mocks.session.setValue.mockReset();
  mocks.session.useDefaultExplicitly.mockReset();
  mocks.postMessage.mockReset();
  mocks.hostAdapter = null;
  mocks.evaluationState = null;
});

describe("ModulePreviewApp parameter relay", () => {
  it("routes accepted value and unavailable-default actions through the live session", () => {
    mocks.queryModulePreviewTarget.mockReturnValue(target);
    mocks.session.activate.mockReturnValue(snapshot);
    mocks.session.getState.mockReturnValue(snapshot);
    mocks.session.setValue.mockReturnValue(snapshot);
    mocks.session.useDefaultExplicitly.mockReturnValue({ applied: false, state: snapshot });
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: source.indexOf("module Preview") }
      }));
    });

    expect(mocks.session.activate).toHaveBeenCalledWith(expect.objectContaining({ target }));
    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      sessionId: "module-preview-session:1",
      target
    }));

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewSetValue",
        sessionId: "module-preview-session:1",
        documentUri: "file:///pattern.nui",
        documentVersion: 1,
        sourceRevision: 1,
        sessionRevision: 2,
        targetDefinitionStatementId: target.definitionStatementId,
        definitionStatementId: target.definitionStatementId,
        parameterIndex: 0,
        expression: "4"
      }
    })));
    expect(mocks.session.setValue).toHaveBeenCalledWith(target.definitionStatementId, 0, "4");

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewUseDefault",
        sessionId: "module-preview-session:1",
        documentUri: "file:///pattern.nui",
        documentVersion: 1,
        sourceRevision: 1,
        sessionRevision: 3,
        targetDefinitionStatementId: target.definitionStatementId,
        definitionStatementId: target.definitionStatementId,
        parameterIndex: 0
      }
    })));
    expect(mocks.session.useDefaultExplicitly).toHaveBeenCalledWith(target.definitionStatementId, 0);
    expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      sessionRevision: 4
    }));
  });

  it("keeps point and Bezier drag previews ephemeral until the host accepts a source patch", () => {
    const source = [
      "nui 1",
      "module Preview() {",
      "  point P = coordinate(x: 1, y: 2)",
      "  point Q = coordinate(x: 100, y: 0)",
      "  curve C = bezier(start: @P, end: @Q, startAngle: 0, startLength: 20, endAngle: 180, endLength: 30)",
      "}"
    ].join("\n");
    const document = AutomationDocument.fromSource(source);
    const compiled = document.getState().currentCompiled;
    const sourceRevision = compiled.spans.sourceMap.sourceRevision;
    const target = compiled.moduleSemanticAnalysis?.definitions.find((definition) => definition.name === "Preview");
    if (!target) throw new Error("expected Preview definition");
    const root = compileModulePreviewRoot({
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled },
      target: {
        definitionStatementId: target.statementId,
        definitionStatementIndex: target.statementIndex,
        name: target.name
      }
    });
    if (!root) throw new Error("expected Preview root");
    const evaluation = evaluateElements(root.compileResult.elements, {
      moduleMaterialization: root.moduleMaterialization
    });
    mocks.queryModulePreviewTarget.mockReturnValue(root.target);
    const validSnapshot = {
      sourceRevision,
      target: root.target,
      ancestorContexts: [],
      parameters: {
        kind: "target" as const,
        definitionStatementId: root.target.definitionStatementId,
        name: root.target.name,
        parameters: []
      },
      inputDiagnostics: [],
      preview: { kind: "current" as const, result: root }
    } satisfies ModulePreviewSessionSnapshot;
    mocks.session.activate.mockReturnValue(validSnapshot);
    mocks.session.getState.mockReturnValue(validSnapshot);
    mocks.evaluationState = {
      evaluation,
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    const fromSource = vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(document);
    const sourceBefore = useCadDocumentStore.getState().sourceText;
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: source.indexOf("module Preview") }
      }));
    });

    const hostAdapter = mocks.hostAdapter as CanvasHostAdapter | null;
    expect(hostAdapter).not.toBeNull();
    if (!hostAdapter) throw new Error("expected Module Preview Canvas host");
    const base = hostAdapter.getCurrentCanonicalDocument();
    const point = base.elements.find((element) =>
      element.name === "P" && root.targetRuntimeElementIds.includes(element.id)
    );
    const curve = base.elements.find((element) =>
      element.name === "C" && root.targetRuntimeElementIds.includes(element.id)
    );
    if (!point || !curve) throw new Error("expected Preview geometry");
    expect(sourceOwnerForRuntimeElementId({
      statementMap: document.getState().doc.statementMap,
      moduleMaterialization: root.moduleMaterialization,
      moduleRuntimeContext: document.getState().doc.moduleRuntimeContext
    }, point.id)).toMatchObject({ kind: "moduleBody" });
    expect(sourceOwnerForRuntimeElementId({
      statementMap: document.getState().doc.statementMap,
      moduleMaterialization: root.moduleMaterialization,
      moduleRuntimeContext: document.getState().doc.moduleRuntimeContext
    }, curve.id)).toMatchObject({ kind: "moduleBody" });
    let pointResult: unknown;
    act(() => {
      pointResult = hostAdapter.movePointElementByDelta({
        elementId: point.id,
        dx: 2,
        dy: 0,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "preview",
        baseElements: base.elements,
        baseEvaluation: evaluation
      });
    });
    expect(pointResult).toEqual({ status: "applied" });
    const previewHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    expect(previewHostAdapter.canonicalElements.find((element) => element.id === point.id)).toEqual(point);
    expect(previewHostAdapter.elements.find((element) => element.id === point.id)).toMatchObject({ x: 3, y: 2 });
    expect(document.getSource()).toBe(source);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);

    const bezierBase = previewHostAdapter.getCurrentCanonicalDocument();
    let bezierResult: unknown;
    act(() => {
      bezierResult = previewHostAdapter.moveBezierHandleByDelta({
        elementId: curve.id,
        bezierHandleRole: "start",
        dx: 0,
        dy: 10,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "preview",
        baseElements: bezierBase.elements,
        baseEvaluation: evaluation
      });
    });
    expect(bezierResult).toEqual({ status: "applied" });
    expect(document.getSource()).toBe(source);
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewModelPatch" }));
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { type: "commitText", sourceText: source, documentVersion: 2, reason: "edit" }
    })));
    expect(previewHostAdapter.movePointElementByDelta({
      elementId: point.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "commit",
      baseElements: base.elements,
      baseEvaluation: evaluation
    })).toMatchObject({ status: "rejected" });
    expect(document.getSource()).toBe(source);
    fromSource.mockRestore();
  });

  it("applies consecutive same-revision value actions in order", () => {
    mocks.queryModulePreviewTarget.mockReturnValue(target);
    mocks.session.activate.mockReturnValue(snapshot);
    mocks.session.getState.mockReturnValue(snapshot);
    mocks.session.setValue.mockImplementation((_definitionStatementId, _parameterIndex, expression) => ({
      ...snapshot,
      parameters: {
        ...snapshot.parameters,
        parameters: snapshot.parameters.parameters.map((parameter) =>
          parameter.parameterIndex === 0 ? { ...parameter, value: expression } : parameter
        )
      }
    }));
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: source.indexOf("module Preview") }
      }));
    });
    mocks.postMessage.mockClear();

    const valueAction = (expression: string) => ({
      type: "modulePreviewSetValue" as const,
      sessionId: "module-preview-session:1",
      documentUri: "file:///pattern.nui",
      documentVersion: 1,
      sourceRevision: 1,
      sessionRevision: 2,
      targetDefinitionStatementId: target.definitionStatementId,
      definitionStatementId: target.definitionStatementId,
      parameterIndex: 0,
      expression
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: valueAction("4") }));
      window.dispatchEvent(new MessageEvent("message", { data: valueAction("5") }));
    });

    expect(mocks.session.setValue).toHaveBeenNthCalledWith(1, target.definitionStatementId, 0, "4");
    expect(mocks.session.setValue).toHaveBeenNthCalledWith(2, target.definitionStatementId, 0, "5");
    expect(mocks.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "modulePreviewParameterSnapshot",
      sessionRevision: 4,
      parameters: expect.objectContaining({
        parameters: expect.arrayContaining([expect.objectContaining({ value: "5" })])
      })
    }));
  });
});
