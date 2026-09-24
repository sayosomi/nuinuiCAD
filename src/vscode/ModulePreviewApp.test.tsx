import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import type { ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type { ModulePreviewTarget } from "../dsl/modulePreviewTarget";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";

const mocks = vi.hoisted(() => ({
  queryModulePreviewTarget: vi.fn(),
  session: { activate: vi.fn(), getState: vi.fn(), setParameterValue: vi.fn() },
  postMessage: vi.fn(),
  canvasMounts: 0,
  hostAdapter: null as CanvasHostAdapter | null
}));

vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: ({
    canvasFocusRef,
    hostAdapter
  }: {
    canvasFocusRef: RefObject<HTMLDivElement | null>;
    hostAdapter: CanvasHostAdapter;
  }) => {
    mocks.canvasMounts += 1;
    mocks.hostAdapter = hostAdapter;
    return (
      <div ref={canvasFocusRef} data-testid="module-preview-canvas">
        {hostAdapter.renderHostOverlay?.({ width: 400, height: 300 }, { canvasModeChromeHeight: 0 })}
      </div>
    );
  }
}));
vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => ({
    evaluation: {
      computedGeometry: new Map(), preMutationGeometry: new Map(), instanceBaseGeometry: new Map(),
      errors: [], warnings: [], evaluatedElementIds: new Set(), evaluationLimitIndex: 0,
      effectiveVisibleElementIds: new Set(), effectiveEnabledElementIds: new Set(), effectiveDrawingModifierStrokes: new Map()
    },
    evaluationRevision: 1, evaluationRequestRevision: 1, mode: "reference", source: "reference",
    status: "ready", rustEligible: false, isStale: false, error: null
  })
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

import { AutomationDocument } from "@nuinuicad/nui-language/document";
import { ModulePreviewApp } from "./ModulePreviewApp";

const sourceText = "nui 1\nmodule Preview(anchor: point) {\n}\n";
const target: ModulePreviewTarget = { definitionStatementId: "module:preview", definitionStatementIndex: 1, name: "Preview" };
const root = {
  target,
  compileResult: { elements: [], visibilityProfiles: [], activeVisibilityProfileId: null },
  targetRuntimeElementIds: [], diagnostics: [], moduleMaterialization: {}, moduleSemanticAnalysis: {},
  candidateCompiledDocument: { spans: { sourceMap: { source: sourceText, sourceRevision: 1 } } }
};
const snapshot: ModulePreviewSessionSnapshot = {
  sourceRevision: 1,
  target,
  ancestorContexts: [],
  parameters: {
    kind: "target", definitionStatementId: target.definitionStatementId, definitionStatementIndex: target.definitionStatementIndex,
    name: target.name,
    parameters: [{ definitionStatementId: target.definitionStatementId, parameterIndex: 0, name: "anchor", type: { kind: "point" }, optional: false, required: true, defaultSourceText: null, value: "@Top", active: true, diagnostic: null }]
  },
  inputDiagnostics: [], preview: { kind: "current", result: root as never }
};

const renderPreview = () => {
  AutomationDocument.fromSource(sourceText);
  mocks.queryModulePreviewTarget.mockReturnValue(target);
  mocks.session.activate.mockReturnValue(snapshot);
  mocks.session.getState.mockReturnValue(snapshot);
  render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);
  act(() => {
    const bootstrap = {
      type: "modulePreviewBootstrap",
      sessionId: "module-preview-session:1",
      sessionGeneration: 1,
      documentUri: "file:///pattern.nui",
      documentVersion: 1,
      sourceText
    };
    window.dispatchEvent(new MessageEvent("message", { data: bootstrap }));
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewTarget",
        sessionId: bootstrap.sessionId,
        sessionGeneration: bootstrap.sessionGeneration,
        documentUri: bootstrap.documentUri,
        documentVersion: bootstrap.documentVersion,
        normalizedSourceOffset: sourceText.indexOf("module Preview")
      }
    }));
  });
};

afterEach(() => {
  cleanup();
  mocks.queryModulePreviewTarget.mockReset();
  mocks.session.activate.mockReset();
  mocks.session.getState.mockReset();
  mocks.session.setParameterValue.mockReset();
  mocks.postMessage.mockReset();
  mocks.canvasMounts = 0;
  mocks.hostAdapter = null;
});

describe("ModulePreviewApp Canvas-first composition", () => {
  it("mounts Canvas with compact preview actions and no invocation editor", () => {
    renderPreview();
    expect(screen.getByTestId("module-preview-canvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Values..." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert Instance" })).toBeInTheDocument();
    expect(document.querySelector("[data-module-preview-invocation-surface]")).toBeNull();
    expect(document.querySelector("[data-canvas-viewport-controls]")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    act(() => screen.getByRole("button", { name: "Preview Values..." }).click());
    expect(mocks.postMessage).toHaveBeenCalledWith({ type: "modulePreviewEditValues" });
    act(() => screen.getByRole("button", { name: "Insert Instance" }).click());
    expect(mocks.postMessage).toHaveBeenCalledWith({ type: "modulePreviewInsertInstance" });
  });

  it("publishes value-site proof without editing canonical Source", () => {
    renderPreview();
    const valueSnapshot = mocks.postMessage.mock.calls.map(([message]) => message).find((message) => message?.type === "modulePreviewValueSnapshot");
    expect(valueSnapshot).toMatchObject({
      target: { definitionStatementIndex: 1, name: "Preview" },
      groups: [{ kind: "target", definitionStatementIndex: 1, parameters: [{ parameterIndex: 0, name: "anchor", value: "@Top", valueState: "explicit" }] }]
    });
    expect(AutomationDocument.fromSource(sourceText).getSource()).toBe(sourceText);
  });

  it("accepts live Canvas grid configuration without mutating canonical Source", () => {
    renderPreview();
    const sourceBefore = AutomationDocument.fromSource(sourceText).getSource();

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasGridConfiguration",
          settings: { enabled: false, spacingMm: 2.5, majorEvery: 1 }
        }
      }));
    });

    expect(mocks.hostAdapter?.canvasGridSettings).toEqual({ enabled: false, spacingMm: 2.5, majorEvery: 1 });
    expect(AutomationDocument.fromSource(sourceText).getSource()).toBe(sourceBefore);
  });
});
