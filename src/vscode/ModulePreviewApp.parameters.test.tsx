import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import type { ModulePreviewSession, ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import type { ModulePreviewTarget } from "../dsl/modulePreviewTarget";
import type { VscodeModulePreviewModelPatchRequest } from "./protocol";

const mocks = vi.hoisted(() => ({
  queryModulePreviewTarget: vi.fn(),
  session: {
    activate: vi.fn(),
    getState: vi.fn(),
    setParameterValue: vi.fn()
  },
  postMessage: vi.fn(),
  evaluateElementsWithRust: vi.fn(),
  hostAdapter: null as unknown,
  evaluationState: null as unknown,
  dragPointTransform: null as unknown
}));

vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: (props: {
    hostAdapter: CanvasHostAdapter;
    canvasFocusRef: RefObject<HTMLDivElement | null>;
  }) => {
    mocks.hostAdapter = props.hostAdapter;
    const pickOverlay = props.hostAdapter.activePickModeSession && props.hostAdapter.renderHostOverlay
      ? props.hostAdapter.renderHostOverlay({ width: 800, height: 600 })
      : null;
    return <div ref={props.canvasFocusRef} data-canvas-viewport="true" data-testid="module-preview-canvas-viewport">{pickOverlay}</div>;
  }
}));

vi.mock("../model/elementDragTransforms", async () => {
  const actual = await vi.importActual<typeof import("../model/elementDragTransforms")>("../model/elementDragTransforms");
  return {
    ...actual,
    movePointElementByDeltaInElements: (
      ...args: Parameters<typeof actual.movePointElementByDeltaInElements>
    ): ReturnType<typeof actual.movePointElementByDeltaInElements> => {
      const override = mocks.dragPointTransform as (
        ...overrideArgs: Parameters<typeof actual.movePointElementByDeltaInElements>
      ) => ReturnType<typeof actual.movePointElementByDeltaInElements> | null;
      return override ? override(...args) : actual.movePointElementByDeltaInElements(...args);
    }
  };
});

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

vi.mock("../geometry/evaluationEngine", async () => {
  const actual = await vi.importActual<typeof import("../geometry/evaluationEngine")>("../geometry/evaluationEngine");
  return { ...actual, evaluateElementsWithRust: mocks.evaluateElementsWithRust };
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
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { evaluateElements } from "../geometry/evaluate";
import { buildModulePreviewEvaluationOptions } from "./modulePreviewEvaluation";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import type { CadElement } from "../types/geometry";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { modulePreviewAggregateSource } from "../dsl/__fixtures__/modulePreviewAggregate";

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
    definitionStatementIndex: 0,
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
      active: true,
      diagnostic: null
    }]
  }],
  parameters: {
    kind: "target" as const,
    definitionStatementId: target.definitionStatementId,
    definitionStatementIndex: target.definitionStatementIndex,
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
      active: true,
      diagnostic: null
    }]
  },
  inputDiagnostics: [],
  preview: { kind: "noValidPreview" as const, result: null }
} satisfies ModulePreviewSessionSnapshot;

const source = "nui 1\nmodule Preview(width: number) {\n}\n";

const previewFixtureFor = (sourceText: string, moduleName = "Preview") => {
  const document = AutomationDocument.fromSource(sourceText);
  const compiled = document.getState().currentCompiled;
  const sourceRevision = compiled.spans.sourceMap.sourceRevision;
  const definition = compiled.moduleSemanticAnalysis?.definitions.find((candidate) => candidate.name === moduleName);
  if (!definition) throw new Error("expected Preview definition");
  const root = compileModulePreviewRoot({
    source: { normalizedSource: sourceText, sourceRevision },
    semantic: { sourceRevision, compiled },
    target: {
      definitionStatementId: definition.statementId,
      definitionStatementIndex: definition.statementIndex,
      name: definition.name
    }
  });
  if (!root) throw new Error("expected Preview root");
  const evaluationOptions = buildModulePreviewEvaluationOptions(root);
  const evaluation = evaluateElements(root.compileResult.elements, evaluationOptions);
  const snapshot = {
    sourceRevision,
    target: root.target,
    ancestorContexts: [],
    parameters: {
      kind: "target" as const,
      definitionStatementId: root.target.definitionStatementId,
      definitionStatementIndex: root.target.definitionStatementIndex,
      name: root.target.name,
      parameters: definition.parameters.map((parameter) => ({
        definitionStatementId: definition.statementId,
        parameterIndex: parameter.parameterIndex,
        name: parameter.name,
        type: parameter.type,
        ...(parameter.numericTypeOptions ? { numericTypeOptions: parameter.numericTypeOptions } : {}),
        optional: parameter.optional,
        required: parameter.required,
        defaultSourceText: parameter.defaultValue,
        value: "",
        active: false,
        diagnostic: null
      }))
    },
    inputDiagnostics: [],
    preview: { kind: "current" as const, result: root }
  } satisfies ModulePreviewSessionSnapshot;
  return { document, root, evaluation, evaluationOptions, snapshot, sourceRevision };
};

const renderPreviewFixture = (fixture: ReturnType<typeof previewFixtureFor>) => {
  mocks.queryModulePreviewTarget.mockReturnValue(fixture.root.target);
  mocks.session.activate.mockReturnValue(fixture.snapshot);
  mocks.session.getState.mockReturnValue(fixture.snapshot);
  mocks.evaluationState = {
    evaluation: fixture.evaluation,
    evaluationRevision: 1,
    evaluationRequestRevision: 1,
    mode: "reference",
    source: "reference",
    status: "ready",
    rustEligible: false,
    isStale: false,
    error: null
  };
  const api = { postMessage: mocks.postMessage };
  vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(fixture.document);
  render(<ModulePreviewApp api={api} />);
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "replaceTextDocument", sourceText: fixture.document.getSource(), documentVersion: 1 }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: fixture.document.getSource().indexOf("module Preview") }
    }));
  });
  mocks.postMessage.mockClear();
  return api;
};

const selectPreviewElements = (elements: CadElement[]) => {
  const selectedElementIds = elements.map((element) => element.id);
  useCadUiStore.getState().applySelection(
    elements,
    {
      selectedElementId: selectedElementIds[0] ?? null,
      selectedElementIds,
      selectionAnchorElementId: selectedElementIds[0] ?? null
    },
    new Set(selectedElementIds)
  );
};

const preparePartialBake = async () => {
  const sourceText = [
    "nui 1",
    "module Preview() {",
    "  point P = coordinate(x: 1, y: 2)",
    "  text Memo = label(text: \"memo\", anchor: none, size: 3)",
    "}"
  ].join("\n");
  const fixture = previewFixtureFor(sourceText);
  renderPreviewFixture(fixture);
  const selected = fixture.root.compileResult.elements.filter((element) =>
    (element.name === "P" || element.name === "Memo") && fixture.root.targetRuntimeElementIds.includes(element.id)
  );
  expect(selected).toHaveLength(2);
  selectPreviewElements(selected);

  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "canvasCommand",
        commandId: "bakeCurrentShape",
        emitSkippedComments: false,
        includeHiddenGeometry: false,
        includeDisabledGeometry: false
      }
    }));
    await Promise.resolve();
  });

  const request = mocks.postMessage.mock.calls
    .map(([message]) => message)
    .find((message): message is VscodeModulePreviewModelPatchRequest => message?.type === "modulePreviewModelPatch");
  if (!request) throw new Error("expected partial Module Preview Bake patch");
  return { fixture, request };
};

const prepareEphemeralDragFixture = () => {
  const source = [
    "nui 1",
    "module Preview() {",
    "  point P = coordinate(x: 1, y: 2)",
    "  point Q = coordinate(x: 100, y: 0)",
    "  curve C = bezier(start: @P, end: @Q, startAngle: 0, startLength: 20, endAngle: 180, endLength: 30)",
    "}"
  ].join("\n");
  const fixture = previewFixtureFor(source);
  const sourceBefore = useCadDocumentStore.getState().sourceText;
  renderPreviewFixture(fixture);
  const hostAdapter = mocks.hostAdapter as CanvasHostAdapter | null;
  expect(hostAdapter).not.toBeNull();
  if (!hostAdapter) throw new Error("expected Module Preview Canvas host");
  const base = hostAdapter.getCurrentCanonicalDocument();
  const point = base.elements.find((element) =>
    element.name === "P" && fixture.root.targetRuntimeElementIds.includes(element.id)
  );
  const curve = base.elements.find((element) =>
    element.name === "C" && fixture.root.targetRuntimeElementIds.includes(element.id)
  );
  if (!point || !curve) throw new Error("expected Preview geometry");
  return { source, fixture, sourceBefore, hostAdapter, base, point, curve };
};

const publishPresentation = (language: "ja" | "en") => {
  act(() => window.dispatchEvent(new MessageEvent("message", {
    data: {
      type: "webviewPresentation",
      presentation: {
        locale: language,
        strings: {
          "modulePreview.dragStale": language === "ja"
            ? "Module Previewのドラッグ状態が古くなっています。"
            : "Module Preview drag state is stale.",
          "modulePreview.noWritableOwner": language === "ja"
            ? "Module Previewのジオメトリに書き込み可能な作成元がありません。"
            : "Module Preview geometry has no writable authored owner.",
          "modulePreview.dragTargetUnavailable": language === "ja"
            ? "Module Previewのドラッグ対象を利用できません。"
            : "Module Preview drag target is unavailable.",
          "modulePreview.parameters.diagnostic.required-value-missing": language === "ja"
            ? "パラメータ「{name}」には値が必要です。"
            : "Parameter \"{name}\" requires a value.",
          "modulePreview.parameters.diagnostic.invalid-expression": language === "ja"
            ? "「{name}」の値はこのコンテキストで有効なModule引数式ではありません。"
            : "Value for \"{name}\" is not a valid Module argument expression in this context."
        },
        diagnosticTemplates: {}
      }
    }
  })));
};

afterEach(() => {
  cleanup();
  mocks.queryModulePreviewTarget.mockReset();
  mocks.session.activate.mockReset();
  mocks.session.getState.mockReset();
  mocks.session.setParameterValue.mockReset();
  mocks.postMessage.mockReset();
  mocks.evaluateElementsWithRust.mockReset();
  mocks.hostAdapter = null;
  mocks.evaluationState = null;
  mocks.dragPointTransform = null;
  useCadUiStore.getState().setSelectedElementIds([]);
  vi.restoreAllMocks();
});

describe("ModulePreviewApp Canvas and Preview boundary", () => {
  it("keeps the transport and readiness handshake alive across Preview transitions and disposes on unmount", () => {
    const sourceText = [
      "nui 1",
      "module First() {",
      "  point FirstPoint = coordinate(x: 10, y: 10)",
      "}",
      "module Second() {",
      "  point SecondPoint = coordinate(x: 20, y: 20)",
      "}"
    ].join("\n");
    const firstFixture = previewFixtureFor(sourceText, "First");
    const secondFixture = previewFixtureFor(sourceText, "Second");
    const dispose = vi.spyOn(VscodeRustTransport.prototype, "dispose");
    const api = { postMessage: mocks.postMessage };
    mocks.queryModulePreviewTarget
      .mockReturnValueOnce(firstFixture.root.target)
      .mockReturnValueOnce(secondFixture.root.target);
    mocks.session.activate
      .mockReturnValueOnce(firstFixture.snapshot)
      .mockReturnValueOnce(secondFixture.snapshot);
    mocks.session.getState.mockReturnValue(firstFixture.snapshot);
    mocks.evaluationState = {
      evaluation: firstFixture.evaluation,
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(firstFixture.document);
    const view = render(<ModulePreviewApp api={api} />);
    const readinessMessages = () => api.postMessage.mock.calls.filter(([message]) => message?.type === "webviewReady");

    expect(readinessMessages()).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module First") }
      }));
    });

    expect(readinessMessages()).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();

    mocks.evaluationState = {
      evaluation: secondFixture.evaluation,
      evaluationRevision: 2,
      evaluationRequestRevision: 2,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Second") }
      }));
    });

    expect(readinessMessages()).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
    expect((mocks.hostAdapter as CanvasHostAdapter | null)?.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "SecondPoint" })])
    );

    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("fits only the current target drawing through the shared Fit Drawing command", () => {
    const sourceText = [
      "nui 1",
      "point Outside = coordinate(x: 1000, y: 1000)",
      "module Preview() {",
      "  point Start = coordinate(x: 0, y: 0)",
      "  point End = coordinate(x: 100, y: 50)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    const previousElements = useCadDocumentStore.getState().elements;
    const previousViewport = useCadUiStore.getState().canvasViewport;
    try {
      useCadDocumentStore.setState({
        elements: [{
          id: "global-only",
          name: "global-only",
          type: "freePoint",
          activity: "visible",
          x: -500,
          y: -500
        }]
      });
      useCadUiStore.getState().setCanvasViewport({ panX: 240, panY: -120, zoom: 0.75 });
      renderPreviewFixture(fixture);

      const targetElements = fixture.root.compileResult.elements.filter((element) =>
        fixture.root.targetRuntimeElementIds.includes(element.id)
      );
      const supportElement = fixture.root.compileResult.elements.find((element) => element.name === "Outside");
      expect(supportElement).toBeDefined();
      expect(targetElements.map((element) => element.id)).not.toContain(supportElement?.id);
      const hostAdapter = mocks.hostAdapter as CanvasHostAdapter | null;
      expect(hostAdapter?.elements.map((element) => element.id)).toEqual(targetElements.map((element) => element.id));

      const viewport = screen.getByTestId("module-preview-canvas-viewport");
      vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
        width: 400,
        height: 300
      } as DOMRect);

      act(() => window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "fitDrawing" }
      })));

      expect(useCadUiStore.getState().canvasViewport).toEqual({
        zoom: 3.36,
        panX: -168,
        panY: 84
      });
    } finally {
      useCadDocumentStore.setState({ elements: previousElements });
      useCadUiStore.getState().setCanvasViewport(previousViewport);
    }
  });

  it("publishes the current display state in a valid Module Preview Canvas context", () => {
    const previousUi = useCadUiStore.getState();
    try {
      useCadUiStore.setState({
        showCanvasPointNames: false,
        showCanvasGeometryNames: true,
        showCanvasPoints: false
      });
      const fixture = previewFixtureFor([
        "nui 1",
        "module Preview() {",
        "  point P = coordinate(x: 1, y: 2)",
        "}"
      ].join("\n"));
      renderPreviewFixture(fixture);

      const hostAdapter = mocks.hostAdapter as CanvasHostAdapter | null;
      expect(hostAdapter).not.toBeNull();
      if (!hostAdapter) throw new Error("expected Module Preview Canvas host");
      expect(JSON.parse(hostAdapter.canvasContextMenuData!)).toMatchObject({
        webviewSection: "blank",
        "nuinuiCAD.showCanvasPointNames": false,
        "nuinuiCAD.showCanvasGeometryNames": true,
        "nuinuiCAD.showCanvasPoints": false
      });
    } finally {
      useCadUiStore.setState(previousUi);
    }
  });

  it("renders the host-published Japanese status without changing Module identity", () => {
    render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "webviewPresentation",
          presentation: {
            locale: "ja",
            strings: {
              "modulePreview.initial": "Source EditorのModule定義からModule Previewを開いてください。"
            },
            diagnosticTemplates: {}
          }
        }
      }));
    });

    expect(screen.getByText("Source EditorのModule定義からModule Previewを開いてください。")).toBeInTheDocument();
  });

  it("handles synchronous host bootstrap responses after installing the message listener", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actual.createModulePreviewSession();
    mocks.session.activate.mockImplementation((input) => liveSession.activate(input));
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    mocks.queryModulePreviewTarget.mockReturnValue(fixture.root.target);
    mocks.evaluationState = {
      evaluation: fixture.evaluation,
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(fixture.document);
    const api = {
      postMessage: vi.fn((message: { type?: string }) => {
        if (message.type !== "webviewReady") return;
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "modulePreviewSession", sessionId: "module-preview-session:sync", documentUri: "file:///pattern.nui" }
        }));
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
        }));
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Preview") }
        }));
      })
    };

    await act(async () => {
      render(<ModulePreviewApp api={api} />);
      await Promise.resolve();
    });

    expect(api.postMessage).toHaveBeenCalledWith({ type: "webviewReady" });
    expect(mocks.session.activate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No valid Module Preview")).not.toBeInTheDocument();
  });

  it("renders an omitted default-only Module Preview through the live session boundary", async () => {
    const sourceText = [
      "nui 1",
      "module Alternate(size: number = 30) {",
      "  point AltStart = coordinate(x: 0, y: 0)",
      "  point AltEnd = coordinate(x: @size, y: @size)",
      "  line AltLine = segment(start: @AltStart, end: @AltEnd)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText, "Alternate");
    const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actual.createModulePreviewSession();
    mocks.session.activate.mockImplementation((input) => liveSession.activate(input));
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    mocks.queryModulePreviewTarget.mockReturnValue(fixture.root.target);
    mocks.evaluationState = {
      evaluation: fixture.evaluation,
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(fixture.document);
    render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Alternate") }
      }));
    });

    const valueSnapshot = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "modulePreviewValueSnapshot")
      .at(-1);
    expect(valueSnapshot).toMatchObject({
      previewStatus: "current",
      groups: [expect.objectContaining({
        kind: "target",
        name: "Alternate",
        parameters: [expect.objectContaining({
          name: "size",
          defaultSourceText: "30",
          value: "",
          valueState: "omitted-defaulted",
          diagnostic: null
        })]
      })],
      inputDiagnostics: []
    });
    expect(mocks.session.activate).toHaveBeenCalledTimes(1);
    expect(mocks.session.activate.mock.calls[0]?.[0].arguments).toBeUndefined();
    expect(screen.queryByText("No valid Module Preview")).not.toBeInTheDocument();

    const state = mocks.session.getState() as ModulePreviewSessionSnapshot | null;
    expect(state?.preview.kind).toBe("current");
    if (!state || state.preview.kind !== "current") throw new Error("expected current Module Preview state");
    const liveRoot = state.preview.result;
    const liveEnd = liveRoot.compileResult.elements.find((element) =>
      element.name === "AltEnd" && liveRoot.targetRuntimeElementIds.includes(element.id)
    );
    expect(liveEnd).toBeDefined();
    expect(fixture.evaluation.computedGeometry.get(liveEnd!.id)).toMatchObject({
      kind: "point",
      x: 30,
      y: 30
    });
    expect((mocks.hostAdapter as CanvasHostAdapter | null)?.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "AltEnd" })])
    );
    expect(globalThis.document.querySelector<HTMLElement>("[data-module-preview-value-summary='true']"))
      .toHaveTextContent("Target: Alternate.size = omitted (default: 30)");
    expect(mocks.postMessage.mock.calls.filter(([message]) => message?.type === "webviewReady")).toHaveLength(1);
    const syntheticCall = liveRoot.candidateCompiledDocument.statements.find(
      (statement) => statement.kind === "moduleInstance" && statement.name === "__module_preview_0"
    );
    expect(syntheticCall?.kind).toBe("moduleInstance");
    expect(syntheticCall?.kind === "moduleInstance" ? syntheticCall.arguments : []).toHaveLength(0);
    expect(fixture.document.getSource()).toBe(sourceText);
  });

  it("renders an aggregate Module Preview root through the live session boundary", async () => {
    const sourceText = modulePreviewAggregateSource;
    const fixture = previewFixtureFor(sourceText, "Alternate");
    const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actual.createModulePreviewSession();
    mocks.session.activate.mockImplementation((input) => liveSession.activate(input));
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    mocks.queryModulePreviewTarget.mockReturnValue(fixture.root.target);
    mocks.evaluationState = {
      evaluation: fixture.evaluation,
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      mode: "reference",
      source: "reference",
      status: "ready",
      rustEligible: false,
      isStale: false,
      error: null
    };
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(fixture.document);
    render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Alternate") }
      }));
    });

    const valueSnapshot = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "modulePreviewValueSnapshot")
      .at(-1);
    expect(valueSnapshot).toMatchObject({
      previewStatus: "current",
      groups: [expect.objectContaining({
        kind: "target",
        name: "Alternate",
        parameters: [expect.objectContaining({
          name: "size",
          defaultSourceText: "30",
          value: "",
          valueState: "omitted-defaulted",
          diagnostic: null
        })]
      })],
      inputDiagnostics: []
    });

    const state = mocks.session.getState() as ModulePreviewSessionSnapshot | null;
    expect(state?.preview.kind).toBe("current");
    if (!state || state.preview.kind !== "current") throw new Error("expected current Module Preview state");
    const liveRoot = state.preview.result;
    const liveEnd = liveRoot.compileResult.elements.find((element) =>
      element.name === "AltEnd" && liveRoot.targetRuntimeElementIds.includes(element.id)
    );
    expect(liveEnd).toBeDefined();
    expect(fixture.evaluation.computedGeometry.get(liveEnd!.id)).toMatchObject({
      kind: "point",
      x: 30,
      y: 30
    });
    expect((mocks.hostAdapter as CanvasHostAdapter | null)?.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "AltEnd" })])
    );
    expect(fixture.document.getSource()).toBe(sourceText);
  });

  it("reaches current Preview for the exact zero-parameter SmokePreview reproduction", async () => {
    const sourceText = [
      "nui 1",
      "",
      "module SmokePreview() {",
      "point SmokePoint = coordinate(x: 10, y: 10)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText, "SmokePreview");
    const actualTargetModule = await vi.importActual<typeof import("../dsl/modulePreviewTarget")>("../dsl/modulePreviewTarget");
    const actualStateModule = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actualStateModule.createModulePreviewSession();
    const dispose = vi.spyOn(VscodeRustTransport.prototype, "dispose");
    mocks.queryModulePreviewTarget.mockImplementation(actualTargetModule.queryModulePreviewTarget);
    mocks.session.activate.mockImplementation((input) => {
      const snapshot = liveSession.activate(input);
      if (snapshot?.preview.kind === "current") {
        const evaluation = evaluateElements(
          snapshot.preview.result.compileResult.elements,
          buildModulePreviewEvaluationOptions(snapshot.preview.result)
        );
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
      }
      return snapshot;
    });
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(fixture.document);
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module SmokePreview") }
      }));
    });

    const state = liveSession.getState();
    expect(state?.preview.kind).toBe("current");
    expect(screen.queryByText("No valid Module Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("VS Code Rust transport disposed")).not.toBeInTheDocument();
    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "webviewReady")).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
    if (!state || state.preview.kind !== "current") throw new Error("expected current Module Preview state");
    const smokePoint = state.preview.result.compileResult.elements.find((element) => element.name === "SmokePoint");
    expect(smokePoint).toBeDefined();
    expect((mocks.evaluationState as { evaluation: { computedGeometry: Map<string, unknown> } }).evaluation.computedGeometry.get(smokePoint!.id)).toMatchObject({
      kind: "point",
      x: 10,
      y: 10
    });
  });

  it("materializes parameterless Preview geometry after authoritative hydration", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  point P0 = coordinate(x: 0, y: 0)",
      "  point P1 = coordinate(x: 40, y: 0)",
      "  line Edge = segment(start: @P0, end: @P1)",
      "}"
    ].join("\n");
    const actualTargetModule = await vi.importActual<typeof import("../dsl/modulePreviewTarget")>("../dsl/modulePreviewTarget");
    const actualStateModule = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actualStateModule.createModulePreviewSession();
    mocks.queryModulePreviewTarget.mockImplementation(actualTargetModule.queryModulePreviewTarget);
    mocks.session.activate.mockImplementation((input) => {
      const snapshot = liveSession.activate(input);
      if (snapshot?.preview.kind === "current") {
        mocks.evaluationState = {
          evaluation: evaluateElements(
            snapshot.preview.result.compileResult.elements,
            buildModulePreviewEvaluationOptions(snapshot.preview.result)
          ),
          evaluationRevision: 1,
          evaluationRequestRevision: 1,
          mode: "reference",
          source: "reference",
          status: "ready",
          rustEligible: false,
          isStale: false,
          error: null
        };
      }
      return snapshot;
    });
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    const api = { postMessage: mocks.postMessage };
    render(<ModulePreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
    });

    expect(mocks.session.activate).not.toHaveBeenCalled();
    expect(mocks.postMessage).toHaveBeenCalledWith({
      type: "webviewAuthoritativeDocumentReady",
      documentVersion: 1
    });

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewTarget",
          documentVersion: 1,
          normalizedSourceOffset: sourceText.indexOf("module Preview")
        }
      }));
    });

    expect(mocks.session.activate).toHaveBeenCalledTimes(1);
    const state = liveSession.getState();
    expect(state?.preview.kind).toBe("current");
    if (!state || state.preview.kind !== "current") throw new Error("expected current Module Preview state");
    const root = state.preview.result;
    const edge = root.compileResult.elements.find((element) =>
      element.name === "Edge" && root.targetRuntimeElementIds.includes(element.id)
    );
    expect(edge).toBeDefined();
    const evaluation = (mocks.evaluationState as { evaluation: { computedGeometry: Map<string, unknown> } }).evaluation;
    expect(evaluation.computedGeometry.get(edge!.id)).toMatchObject({
      kind: "line",
      start: { x: 0, y: 0 },
      end: { x: 40, y: 0 }
    });
    expect((mocks.hostAdapter as CanvasHostAdapter | null)?.elements).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Edge" })])
    );
    expect(screen.queryByText("No valid Module Preview")).not.toBeInTheDocument();
  });

  it("keeps an omitted required Module parameter invalid at the live session boundary", async () => {
    const sourceText = [
      "nui 1",
      "module Required(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}"
    ].join("\n");
    const document = AutomationDocument.fromSource(sourceText);
    const compiled = document.getState().currentCompiled;
    const definition = compiled.moduleSemanticAnalysis?.definitions.find((candidate) => candidate.name === "Required");
    if (!definition) throw new Error("expected Required definition");
    const requiredTarget: ModulePreviewTarget = {
      definitionStatementId: definition.statementId,
      definitionStatementIndex: definition.statementIndex,
      name: definition.name
    };
    const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actual.createModulePreviewSession();
    mocks.session.activate.mockImplementation((input) => liveSession.activate(input));
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    mocks.session.setParameterValue.mockImplementation((...args: Parameters<ModulePreviewSession["setParameterValue"]>) =>
      liveSession.setParameterValue(...args)
    );
    mocks.queryModulePreviewTarget.mockReturnValue(requiredTarget);
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(document);
    render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewSession", sessionId: "module-preview-session:1", documentUri: "file:///pattern.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "modulePreviewTarget", documentVersion: 1, normalizedSourceOffset: sourceText.indexOf("module Required") }
      }));
    });

    const valueSnapshot = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "modulePreviewValueSnapshot")
      .at(-1);
    expect(valueSnapshot).toMatchObject({
      previewStatus: "noValidPreview",
      groups: [expect.objectContaining({
        kind: "target",
        name: "Required",
        parameters: [expect.objectContaining({
          name: "width", value: "", valueState: "required-missing",
          diagnostic: expect.objectContaining({ code: "required-value-missing" })
        })]
      })],
      inputDiagnostics: [expect.objectContaining({ code: "required-value-missing" })]
    });
    expect(screen.getByText("No valid Module Preview")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent('Parameter "width" requires a value.');
    expect(screen.getByRole("status")).not.toHaveTextContent("Module Preview is unavailable.");
    publishPresentation("ja");
    const parameterLink = screen.getByRole("button", { name: "width" });
    expect(screen.getByRole("status")).toHaveTextContent("パラメータ「width」には値が必要です。");
    expect(screen.getByRole("status")).not.toHaveTextContent("Parameter \"width\" requires a value.");
    const status = screen.getByRole("status");
    const emptySurface = globalThis.document.querySelector<HTMLElement>("[data-module-preview-empty='true']");
    expect(emptySurface).not.toBeNull();
    expect(JSON.parse(emptySurface?.getAttribute("data-vscode-context") ?? "{}")).toMatchObject({
      webviewSection: "blank",
      preventDefaultContextMenuItems: true
    });
    expect(status.style.pointerEvents).toBe("none");
    expect(status.style.zIndex).toBe("1");
    expect(emptySurface?.style.zIndex).toBe("0");
    expect(Number(status.style.zIndex)).toBeGreaterThan(Number(emptySurface?.style.zIndex));
    expect(parameterLink.style.pointerEvents).toBe("auto");
    fireEvent.click(parameterLink);
    const directSiteRequest = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewValueSiteEdit");
    expect(directSiteRequest).toMatchObject({
      type: "modulePreviewValueSiteEdit",
      targetDefinitionStatementIndex: requiredTarget.definitionStatementIndex,
      targetName: "Required",
      definitionStatementIndex: definition.statementIndex,
      definitionName: "Required",
      blockKind: "target",
      parameterIndex: 0,
      parameterName: "width"
    });
    expect(directSiteRequest).not.toHaveProperty("definitionStatementId");
    if (!directSiteRequest) throw new Error("expected direct Preview value-site request");
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { ...directSiteRequest, type: "modulePreviewValueEdit", expression: "12" }
    })));
    expect(mocks.session.setParameterValue).toHaveBeenCalledWith(definition.statementId, 0, "12");
    expect(liveSession.getState()?.parameters.parameters[0]).toMatchObject({ value: "12", active: true });
    expect(liveSession.getState()?.inputDiagnostics).toEqual([]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(globalThis.document.querySelector<HTMLElement>("[data-module-preview-value-summary='true']"))
      .toHaveTextContent("Target: Required.width = 12");
    expect(globalThis.document.querySelector<HTMLElement>("[data-module-preview-empty='true']")).toBeNull();
    expect(document.getSource()).toBe(sourceText);
  });

  it("distinguishes explicit, defaulted, and optional values in the current-value summary", () => {
    const fixture = previewFixtureFor([
      "nui 1",
      "module Preview(withDefault: number = 30) {",
      "}"
    ].join("\n"));
    const defaulted = fixture.snapshot.parameters.parameters[0];
    if (!defaulted) throw new Error("expected defaulted parameter");
    const parameterFor = (
      overrides: Partial<ModulePreviewSessionSnapshot["parameters"]["parameters"][number]>
    ): ModulePreviewSessionSnapshot["parameters"]["parameters"][number] => ({
      ...defaulted,
      ...overrides
    });
    const summaryParameters: ModulePreviewSessionSnapshot["parameters"]["parameters"] = [
      parameterFor({
        parameterIndex: 0,
        name: "explicit",
        defaultSourceText: null,
        value: "7",
        active: true,
        optional: false,
        required: true
      }),
      parameterFor({
        name: "withDefault",
        parameterIndex: 1,
        value: "",
        active: false
      }),
      parameterFor({
        parameterIndex: 2,
        name: "optional",
        defaultSourceText: null,
        value: "",
        active: false,
        optional: true,
        required: false
      })
    ];
    fixture.snapshot.parameters.parameters = summaryParameters as unknown as typeof fixture.snapshot.parameters.parameters;
    renderPreviewFixture(fixture);

    const summary = globalThis.document.querySelector<HTMLElement>("[data-module-preview-value-summary='true']");
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("Target: Preview.explicit = 7");
    expect(summary).toHaveTextContent("Target: Preview.withDefault = omitted (default: 30)");
    expect(summary).toHaveTextContent("Target: Preview.optional = omitted (optional)");
  });

  it("starts authored-source Reference Pick from an initially invalid required geometry Preview", async () => {
    const sourceText = [
      "nui 1",
      "point RootA = coordinate(x: 15, y: 20)",
      "module Preview(anchor: point) {",
      "  point P = coordinate(x: @anchor.x, y: @anchor.y)",
      "}"
    ].join("\n");
    const document = AutomationDocument.fromSource(sourceText);
    const compiled = document.getState().currentCompiled;
    const definition = compiled.moduleSemanticAnalysis?.definitions.find((candidate) => candidate.name === "Preview");
    if (!definition) throw new Error("expected Preview definition");
    const previewTarget: ModulePreviewTarget = {
      definitionStatementId: definition.statementId,
      definitionStatementIndex: definition.statementIndex,
      name: definition.name
    };
    const actual = await vi.importActual<typeof import("../dsl/modulePreviewState")>("../dsl/modulePreviewState");
    const liveSession = actual.createModulePreviewSession();
    mocks.session.activate.mockImplementation((input) => liveSession.activate(input));
    mocks.session.getState.mockImplementation(() => liveSession.getState());
    mocks.queryModulePreviewTarget.mockReturnValue(previewTarget);
    vi.spyOn(AutomationDocument, "fromSource").mockReturnValue(document);
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

    const snapshot = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "modulePreviewValueSnapshot");
    expect(snapshot).toMatchObject({ previewStatus: "noValidPreview" });
    if (!snapshot) throw new Error("expected no-valid Preview snapshot");
    const emptySurfaceBeforePick = globalThis.document.querySelector<HTMLElement>("[data-module-preview-empty='true']");
    expect(emptySurfaceBeforePick).not.toBeNull();
    expect(JSON.parse(emptySurfaceBeforePick?.getAttribute("data-vscode-context") ?? "{}")).toMatchObject({
      webviewSection: "blank",
      preventDefaultContextMenuItems: true
    });

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewReferencePickStartRequest",
          requestId: 1,
          sessionId: snapshot.sessionId,
          documentUri: snapshot.documentUri,
          documentVersion: snapshot.documentVersion,
          normalizedSource: snapshot.normalizedSource,
          sourceRevision: snapshot.sourceRevision,
          sessionRevision: snapshot.sessionRevision,
          targetDefinitionStatementIndex: snapshot.target.definitionStatementIndex,
          targetName: snapshot.target.name,
          definitionStatementIndex: definition.statementIndex,
          definitionName: definition.name,
          blockKind: "target",
          parameterIndex: 0,
          parameterName: "anchor",
          expectedGeometryInterface: "point",
          role: "geometry",
          multiplicity: "single"
        }
      }));
    });

    expect(mocks.postMessage.mock.calls.map(([message]) => message)).toContainEqual(expect.objectContaining({
      type: "modulePreviewReferencePickResult",
      requestId: 1,
      status: "started",
      candidateReferences: [{ base: "RootA" }]
    }));
    expect(globalThis.document.querySelector("[data-module-preview-empty='true']")).toBeNull();
    expect(screen.getByTestId("module-preview-canvas-viewport")).toBeInTheDocument();
    const canvasHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    expect(canvasHostAdapter.activePickModeSession).toMatchObject({
      kind: "point",
      targetElementId: null,
      targetDisplayLabel: "Preview / anchor",
      draft: []
    });
    expect(canvasHostAdapter.pickModeCandidates).toEqual([
      expect.objectContaining({
        options: [expect.objectContaining({ kind: "point", label: "RootA", sourceReference: { base: "RootA" } })]
      })
    ]);
    expect(canvasHostAdapter.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "RootA" })
    ]));
    expect(screen.getByText("PICK MODE")).toBeInTheDocument();
    expect(globalThis.document.querySelector("[data-reference-pick-frame='true']")).toBeNull();
    expect(globalThis.document.querySelector("[data-reference-pick-visuals='true']")).toBeNull();
    const pointCandidate = canvasHostAdapter.pickModeCandidates?.[0];
    const pointOption = pointCandidate?.options[0];
    if (!pointCandidate || pointOption?.kind !== "point") throw new Error("expected authored point candidate");
    act(() => {
      canvasHostAdapter.applyPickedPoint({
        pickedPointAnchor: pointOption.anchor,
        pickedPointCandidateElementId: pointCandidate.elementId,
        pickedPointSourceReference: pointOption.sourceReference
      });
    });
    expect(document.getSource()).toBe(sourceText);
    const updatedCanvasHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    act(() => {
      updatedCanvasHostAdapter.dispatchCanvasPickCommand?.("finishPickMode");
    });
    expect(mocks.postMessage.mock.calls.map(([message]) => message)).toContainEqual(expect.objectContaining({
      type: "modulePreviewReferencePickResult",
      requestId: 1,
      status: "confirmed",
      references: [{ base: "RootA" }]
    }));
  });

  it("shows one concise fallback when a no-root preview has no concrete diagnostic", () => {
    mocks.queryModulePreviewTarget.mockReturnValue(target);
    mocks.session.activate.mockReturnValue(snapshot);
    mocks.session.getState.mockReturnValue(snapshot);
    render(<ModulePreviewApp api={{ postMessage: mocks.postMessage }} />);

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

    const previewStatuses = document.querySelectorAll<HTMLElement>(
      '[data-module-preview-status="true"][role="status"]'
    );
    expect(previewStatuses).toHaveLength(1);
    expect(previewStatuses[0]?.textContent).toBe("Module Preview is unavailable.");
  });

  it("keeps point drag previews ephemeral until the host accepts a source patch", () => {
    const { source, fixture, sourceBefore, hostAdapter, base, point } = prepareEphemeralDragFixture();
    expect(sourceOwnerForRuntimeElementId({
      statementMap: fixture.document.getState().doc.statementMap,
      moduleMaterialization: fixture.root.moduleMaterialization,
      moduleRuntimeContext: fixture.document.getState().doc.moduleRuntimeContext
    }, point.id)).toMatchObject({ kind: "moduleBody" });
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
        baseEvaluation: fixture.evaluation
      });
    });
    expect(pointResult).toEqual({ status: "applied" });
    const previewHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    expect(previewHostAdapter.canonicalElements.find((element) => element.id === point.id)).toEqual(point);
    expect(previewHostAdapter.elements.find((element) => element.id === point.id)).toMatchObject({ x: 3, y: 2 });
    expect(fixture.document.getSource()).toBe(source);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
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
      baseEvaluation: fixture.evaluation
    })).toMatchObject({ status: "rejected" });
    expect(fixture.document.getSource()).toBe(source);
  });

  it("keeps Bezier drag previews ephemeral until the host accepts a source patch", () => {
    const { source, fixture, sourceBefore, hostAdapter, base, curve } = prepareEphemeralDragFixture();
    expect(sourceOwnerForRuntimeElementId({
      statementMap: fixture.document.getState().doc.statementMap,
      moduleMaterialization: fixture.root.moduleMaterialization,
      moduleRuntimeContext: fixture.document.getState().doc.moduleRuntimeContext
    }, curve.id)).toMatchObject({ kind: "moduleBody" });

    let bezierResult: unknown;
    act(() => {
      bezierResult = hostAdapter.moveBezierHandleByDelta({
        elementId: curve.id,
        bezierHandleRole: "start",
        dx: 0,
        dy: 10,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "preview",
        baseElements: base.elements,
        baseEvaluation: fixture.evaluation
      });
    });
    expect(bezierResult).toEqual({ status: "applied" });
    const previewHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    expect(previewHostAdapter.canonicalElements.find((element) => element.id === curve.id)).toEqual(curve);
    const previewCurve = previewHostAdapter.elements.find((element) => element.id === curve.id);
    expect(previewCurve).toBeDefined();
    if (!previewCurve || previewCurve.type !== "bezierCurve") throw new Error("expected Preview Bezier curve");
    expect(previewCurve.startHandleAngleDeg).toBeCloseTo(Math.atan2(10, 20) * 180 / Math.PI);
    expect(previewCurve.startHandleLength).toBeCloseTo(Math.hypot(20, 10));
    expect(fixture.document.getSource()).toBe(source);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewModelPatch" }));
  });

  it.each([
    ["ja", "Module Previewのドラッグ状態が古くなっています。"],
    ["en", "Module Preview drag state is stale."]
  ] as const)("uses the host locale for stale Module Preview drag rejection (%s)", (language, reason) => {
    const { source, fixture, point } = prepareEphemeralDragFixture();
    publishPresentation(language);
    const previewHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    const base = previewHostAdapter.getCurrentCanonicalDocument();
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: { type: "commitText", sourceText: source, documentVersion: 2, reason: "edit" }
    })));

    let result: unknown;
    act(() => {
      result = (mocks.hostAdapter as CanvasHostAdapter).movePointElementByDelta({
        elementId: point.id,
        dx: 1,
        dy: 0,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "commit",
        baseElements: base.elements,
        baseEvaluation: fixture.evaluation
      });
    });

    expect(result).toEqual({ status: "rejected", reason });
  });

  it.each([
    ["ja", "Module Previewのジオメトリに書き込み可能な作成元がありません。"],
    ["en", "Module Preview geometry has no writable authored owner."]
  ] as const)("uses the host locale for no-writable-owner Module Preview drag rejection (%s)", (language, reason) => {
    const { fixture } = prepareEphemeralDragFixture();
    publishPresentation(language);
    const previewHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    const base = previewHostAdapter.getCurrentCanonicalDocument();

    let result: unknown;
    act(() => {
      result = previewHostAdapter.movePointElementByDelta({
        elementId: "unowned-preview-element",
        dx: 1,
        dy: 0,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "preview",
        baseElements: base.elements,
        baseEvaluation: fixture.evaluation
      });
    });

    expect(result).toEqual({ status: "rejected", reason });
  });

  it.each([
    ["ja", "Module Previewのドラッグ対象を利用できません。"],
    ["en", "Module Preview drag target is unavailable."]
  ] as const)("uses the host locale for unavailable Module Preview drag targets (%s)", (language, reason) => {
    const { fixture, point } = prepareEphemeralDragFixture();
    publishPresentation(language);
    const previewHostAdapter = mocks.hostAdapter as CanvasHostAdapter;
    const base = previewHostAdapter.getCurrentCanonicalDocument();
    mocks.dragPointTransform = (elements: CadElement[]) => elements.filter((element) => element.id !== point.id);

    let result: unknown;
    act(() => {
      result = previewHostAdapter.movePointElementByDelta({
        elementId: point.id,
        dx: 1,
        dy: 0,
        angleLocked: false,
        distanceLocked: false,
        commitMode: "commit",
        baseElements: base.elements,
        baseEvaluation: fixture.evaluation
      });
    });

    expect(result).toEqual({ status: "rejected", reason });
  });

  it("keeps a pending drag patch through its exact authoritative commit acknowledgement", () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    renderPreviewFixture(fixture);
    const hostAdapter = mocks.hostAdapter as CanvasHostAdapter | null;
    expect(hostAdapter).not.toBeNull();
    if (!hostAdapter) throw new Error("expected Module Preview Canvas host");
    const base = hostAdapter.getCurrentCanonicalDocument();
    const point = base.elements.find((element) =>
      element.name === "P" && fixture.root.targetRuntimeElementIds.includes(element.id)
    );
    expect(point).toBeDefined();
    if (!point) throw new Error("expected Preview point");

    expect(hostAdapter.movePointElementByDelta({
      elementId: point.id,
      dx: 2,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "commit",
      baseElements: base.elements,
      baseEvaluation: fixture.evaluation
    })).toEqual({ status: "pending" });
    const request = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is VscodeModulePreviewModelPatchRequest => message?.type === "modulePreviewModelPatch");
    expect(request).toBeDefined();
    if (!request) throw new Error("expected drag Module Preview patch");

    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "commitText",
        sourceText: request.expectedPatchedSource,
        documentVersion: request.expectedDocumentVersion + 1,
        reason: "edit"
      }
    })));
    act(() => window.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "modulePreviewModelPatchResult",
        operationId: request.operationId,
        sessionId: "module-preview-session:1",
        documentUri: "file:///pattern.nui",
        documentVersion: request.expectedDocumentVersion + 1,
        status: "applied"
      }
    })));

    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));
  });

  it("bakes selected Preview leaves into authored source without mutating the local canonical mirror", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  point P = coordinate(x: 1, y: 2)",
      "  point Q = coordinate(x: 10, y: 20)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    renderPreviewFixture(fixture);
    const selected = fixture.root.compileResult.elements.filter((element) =>
      (element.name === "P" || element.name === "Q") && fixture.root.targetRuntimeElementIds.includes(element.id)
    );
    expect(selected).toHaveLength(2);
    selectPreviewElements(selected);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeCurrentShape",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: false
        }
      }));
      await Promise.resolve();
    });

    const request = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is VscodeModulePreviewModelPatchRequest => message?.type === "modulePreviewModelPatch");
    expect(request).toBeDefined();
    expect(request).toMatchObject({
      type: "modulePreviewModelPatch",
      sourceOwners: expect.arrayContaining(selected.map((element) => expect.objectContaining({ runtimeElementId: element.id }))),
      splices: expect.arrayContaining([
        expect.objectContaining({ replacementLines: expect.arrayContaining([expect.stringContaining("P_bake")]) }),
        expect.objectContaining({ replacementLines: expect.arrayContaining([expect.stringContaining("Q_bake")]) })
      ])
    });
    expect(request!.splices).toHaveLength(2);
    expect(request!.expectedPatchedSource).toContain("point P_bake = coordinate(x: 1, y: 2)");
    expect(request!.expectedPatchedSource).toContain("point Q_bake = coordinate(x: 10, y: 20)");
    expect(request!.expectedPatchedSource).not.toContain("_module_preview");
    expect(fixture.document.getSource()).toBe(sourceText);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("P_bake");
  });

  it("posts exact structured skip details without a model patch when all Preview targets are skipped", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  text Memo = label(text: \"memo\", anchor: none, size: 3)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    renderPreviewFixture(fixture);
    const skipped = fixture.root.compileResult.elements.find((element) =>
      element.name === "Memo" && fixture.root.targetRuntimeElementIds.includes(element.id)
    );
    expect(skipped).toBeDefined();
    selectPreviewElements([skipped!]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeCurrentShape",
          emitSkippedComments: false,
          includeHiddenGeometry: false,
          includeDisabledGeometry: false
        }
      }));
      await Promise.resolve();
    });

    const result = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message?.type === "bakeOperationResult");
    expect(result).toMatchObject({
      type: "bakeOperationResult",
      surface: "modulePreview",
      mode: "current",
      status: "nothing",
      summary: {
        successfulTargetCount: 0,
        skippedTargetCount: 1,
        skippedTargets: [{
          targetId: skipped!.id,
          reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
        }]
      }
    });
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewModelPatch" }));
  });

  it("holds partial Preview Bake diagnostics until the matching model patch is applied", async () => {
    const { request } = await preparePartialBake();

    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewModelPatchResult",
          operationId: request.operationId + 1,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: 2,
          status: "applied"
        }
      }));
      await Promise.resolve();
    });
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewModelPatchResult",
          operationId: request.operationId,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: 2,
          status: "applied"
        }
      }));
      await Promise.resolve();
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewModelPatchResult",
          operationId: request.operationId,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: 2,
          status: "applied"
        }
      }));
      await Promise.resolve();
    });

    const results = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "bakeOperationResult");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      surface: "modulePreview",
      mode: "current",
      status: "applied",
      summary: {
        successfulTargetCount: 1,
        skippedTargetCount: 1,
        skippedTargets: [{
          sourceLabel: "text Memo",
          reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
        }]
      }
    });
  });

  it("waits for the applied model patch result after its own authoritative commitText", async () => {
    const { request } = await preparePartialBake();
    const expectedDocumentVersion = request.expectedDocumentVersion + 1;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "commitText",
          sourceText: request.expectedPatchedSource,
          documentVersion: expectedDocumentVersion,
          reason: "edit"
        }
      }));
      await Promise.resolve();
    });
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewModelPatchResult",
          operationId: request.operationId,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: expectedDocumentVersion,
          status: "applied"
        }
      }));
      await Promise.resolve();
    });

    const resultsAfterAcceptance = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "bakeOperationResult");
    expect(resultsAfterAcceptance).toHaveLength(1);
    expect(resultsAfterAcceptance[0]).toMatchObject({
      surface: "modulePreview",
      mode: "current",
      status: "applied",
      summary: {
        successfulTargetCount: 1,
        skippedTargetCount: 1,
        skippedTargets: [{
          sourceLabel: "text Memo",
          reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
        }]
      }
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewModelPatchResult",
          operationId: request.operationId,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: expectedDocumentVersion,
          status: "applied"
        }
      }));
      await Promise.resolve();
    });
    expect(mocks.postMessage.mock.calls.filter(([message]) => message?.type === "bakeOperationResult")).toHaveLength(1);
  });

  it("clears a pending Preview Bake after a nonmatching authoritative commitText", async () => {
    const { fixture, request } = await preparePartialBake();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "commitText",
          sourceText: fixture.document.getSource(),
          documentVersion: request.expectedDocumentVersion + 2,
          reason: "edit"
        }
      }));
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "modulePreviewModelPatchResult",
          operationId: request.operationId,
          sessionId: "module-preview-session:1",
          documentUri: "file:///pattern.nui",
          documentVersion: request.expectedDocumentVersion + 1,
          status: "applied"
        }
      }));
      await Promise.resolve();
    });

    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));
  });

  it.each(["stale", "rejected"] as const)(
    "clears a pending Preview Bake result after a matching %s model patch result",
    async (status) => {
      const { request } = await preparePartialBake();

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "modulePreviewModelPatchResult",
            operationId: request.operationId,
            sessionId: "module-preview-session:1",
            documentUri: "file:///pattern.nui",
            documentVersion: 2,
            status
          }
        }));
        await Promise.resolve();
      });

      expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "modulePreviewModelPatchResult",
            operationId: request.operationId,
            sessionId: "module-preview-session:1",
            documentUri: "file:///pattern.nui",
            documentVersion: 2,
            status: "applied"
          }
        }));
        await Promise.resolve();
      });
      expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "bakeOperationResult" }));
    }
  );

  it("uses the shared Base geometry semantics for Module Preview Bake", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    renderPreviewFixture(fixture);
    const line = fixture.root.compileResult.elements.find((element) =>
      element.name === "L" && fixture.root.targetRuntimeElementIds.includes(element.id)
    );
    expect(line).toBeDefined();
    selectPreviewElements([line!]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeBaseShape",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: false
        }
      }));
      await Promise.resolve();
    });

    const request = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is VscodeModulePreviewModelPatchRequest => message?.type === "modulePreviewModelPatch");
    expect(request?.expectedPatchedSource).toContain(
      "line L_bake = segment(start: (0, 0), end: (10, 0))"
    );
    expect(fixture.document.getSource()).toBe(sourceText);
  });

  it("rejects a disabled Preview Bake when authority drifts during sandbox evaluation", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  point Disabled = coordinate(x: 3, y: 4, enabled: false)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    const disabled = fixture.root.compileResult.elements.find((element) =>
      element.name === "Disabled" && fixture.root.targetRuntimeElementIds.includes(element.id)
    );
    expect(disabled).toBeDefined();
    const sandbox = evaluateElements(fixture.root.compileResult.elements, {
      ...fixture.evaluationOptions,
      allowDisabledElementIds: new Set([disabled!.id])
    });
    let resolveSandbox: ((value: typeof sandbox) => void) | undefined;
    const pendingSandbox = new Promise<typeof sandbox>((resolve) => {
      resolveSandbox = resolve;
    });
    mocks.evaluateElementsWithRust.mockReturnValue(pendingSandbox);
    renderPreviewFixture(fixture);
    selectPreviewElements([disabled!]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeCurrentShape",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText, documentVersion: 2, reason: "edit" }
      }));
      resolveSandbox?.(sandbox);
      await pendingSandbox;
    });

    expect(mocks.evaluateElementsWithRust).toHaveBeenCalledTimes(1);
    expect(mocks.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "modulePreviewModelPatch" }));
    expect(fixture.document.getSource()).toBe(sourceText);
  });

  it("revalidates a valid disabled Preview Bake before sending the authored patch", async () => {
    const sourceText = [
      "nui 1",
      "module Preview() {",
      "  point Disabled = coordinate(x: 3, y: 4, enabled: false)",
      "}"
    ].join("\n");
    const fixture = previewFixtureFor(sourceText);
    const disabled = fixture.root.compileResult.elements.find((element) =>
      element.name === "Disabled" && fixture.root.targetRuntimeElementIds.includes(element.id)
    );
    expect(disabled).toBeDefined();
    const sandbox = evaluateElements(fixture.root.compileResult.elements, {
      ...fixture.evaluationOptions,
      allowDisabledElementIds: new Set([disabled!.id])
    });
    mocks.evaluateElementsWithRust.mockResolvedValue(sandbox);
    renderPreviewFixture(fixture);
    selectPreviewElements([disabled!]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeCurrentShape",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.evaluateElementsWithRust).toHaveBeenCalledTimes(1);
    const request = mocks.postMessage.mock.calls
      .map(([message]) => message)
      .find((message): message is VscodeModulePreviewModelPatchRequest => message?.type === "modulePreviewModelPatch");
    expect(request?.expectedPatchedSource).toContain(
      "point Disabled_bake = coordinate(x: 3, y: 4, enabled: false)"
    );
    expect(fixture.document.getSource()).toBe(sourceText);
  });

});
