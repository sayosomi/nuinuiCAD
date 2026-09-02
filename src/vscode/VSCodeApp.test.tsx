import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectElement } from "../commands/selectionCommands";
import * as commandRegistry from "../commands/commands";
import { confirmCommandLineSession, submitCommandLineInput } from "../commands/commandLineSessionCommands";
import type { SourceCreationCommitMetadata } from "../commands/commandTypes";
import { planInlineModule } from "../document/inlineModulePlanner";
import { applyLineSplices } from "../document/textPatch";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import type { CadElement, EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";
import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import type { VscodeMultiDocumentCanvasRuntimePresentation } from "./multiDocumentRuntimeTransport";
import type { VscodeReferencePickAuthorityFor } from "./useVSCodeReferencePickSession";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { webviewPresentationFor } from "../../vscode-extension/src/webviewPresentationLocalization";

const drawingCanvasProps = vi.hoisted(() => ({
  postCanonicalSourceText: null as ((sourceText: string, metadata?: SourceCreationCommitMetadata) => void) | null,
  currentReferencePickAuthorityFor: null as VscodeReferencePickAuthorityFor | null,
  bakeSandboxTargetIds: null as string[] | null,
  bakeSandboxPromise: null as Promise<unknown> | null,
  multiDocumentRuntimePresentation: null as VscodeMultiDocumentCanvasRuntimePresentation | null,
  evaluation: { computedGeometry: new Map(), errors: [], warnings: [] } as EvaluationResult
}));

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/evaluationEngine", () => ({
  evaluateElementsWithRust: vi.fn(async (_elements: unknown, options: { allowDisabledElementIds?: ReadonlySet<string> }) => {
    drawingCanvasProps.bakeSandboxTargetIds = [...(options.allowDisabledElementIds ?? [])];
    if (drawingCanvasProps.bakeSandboxPromise) return drawingCanvasProps.bakeSandboxPromise;
    return {};
  })
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => ({
    evaluation: drawingCanvasProps.evaluation
  })
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: ({
    canvasFocusRef,
    postCanonicalSourceText,
    currentReferencePickAuthorityFor,
    multiDocumentRuntimePresentation
  }: {
    canvasFocusRef: RefObject<HTMLDivElement | null>;
    postCanonicalSourceText: (sourceText: string, metadata?: SourceCreationCommitMetadata) => void;
    currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
    multiDocumentRuntimePresentation?: VscodeMultiDocumentCanvasRuntimePresentation | null;
  }) => {
    drawingCanvasProps.postCanonicalSourceText = postCanonicalSourceText;
    drawingCanvasProps.currentReferencePickAuthorityFor = currentReferencePickAuthorityFor;
    drawingCanvasProps.multiDocumentRuntimePresentation = multiDocumentRuntimePresentation ?? null;
    return <div ref={canvasFocusRef} data-testid="canvas" tabIndex={-1} />;
  }
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const sourceForSelectionChronology = (x: number) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: x + 10, y: 0 }
]);

const h3Source = [
  "nui 1",
  "point Left = coordinate(x: -50, y: 0)",
  "point Right = coordinate(x: 50, y: 0)",
  "line Guide = segment(start: @Left, end: @Right)"
].join("\n");

const h3GuideSourcePosition = { line: 3, character: "line ".length };

const multiDocumentRuntimePublicationFor = (
  source: string,
  documentVersion: number,
  graphSourceRevision: number,
  runtimeRootSourceRevision: number,
  elements: CadElement[]
): VscodeMultiDocumentGraphPublication => ({
  type: "multiDocumentGraphPublication",
  documentVersion,
  status: "current",
  graph: {
    revision: 12,
    rootDocumentId: "file:///workspace/root.nui",
    rootSource: {
      kind: "root-current",
      documentId: "file:///workspace/root.nui",
      normalizedSource: source,
      sourceRevision: graphSourceRevision
    },
    valid: true,
    nodes: [],
    edges: [],
    dependencyFingerprints: [],
    diagnostics: []
  },
  canvasRuntime: {
    graphRevision: 12,
    rootDocumentId: "file:///workspace/root.nui",
    rootSourceRevision: runtimeRootSourceRevision,
    preparedRustEvaluation: {
      rustEligible: true,
      input: {
        elements,
        evaluationLimitIndex: elements.length
      }
    },
    visibilityProfiles: [],
    activeVisibilityProfileId: "",
    modulePresentation: {
      instanceBaseGeometrySnapshots: [],
      origins: []
    }
  }
});

const publishAllCurrentElementsAsPresented = () => {
  const elements = useCadDocumentStore.getState().elements;
  useCadUiStore.getState().setCanvasSelectionEligibility(
    elements,
    new Set(elements.map((element) => element.id))
  );
};

describe("VSCodeApp Canvas history coordinator", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    drawingCanvasProps.postCanonicalSourceText = null;
    drawingCanvasProps.currentReferencePickAuthorityFor = null;
    drawingCanvasProps.bakeSandboxTargetIds = null;
    drawingCanvasProps.bakeSandboxPromise = null;
    drawingCanvasProps.multiDocumentRuntimePresentation = null;
    drawingCanvasProps.evaluation = { computedGeometry: new Map(), errors: [], warnings: [] };
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["ja", "Canvas上にポインターを置いてから実行してください。"],
    ["en", "Place the pointer on the Canvas before running this command."]
  ] as const)("localizes invalid Canvas pointer errors for the %s host without changing rejection behavior", async (language, expectedError) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewPresentation", presentation: webviewPresentationFor(language) }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 601,
          documentVersion: 7,
          pointer: { x: Number.NaN, y: 2 },
          sourcePosition: { line: 0, character: 0 }
        }
      }));
    });

    expect(useCadUiStore.getState().commandErrorMessage).toBe(expectedError);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasFreePointAtPointerResult",
      requestId: 601,
      status: "rejected",
      documentVersion: 7
    });
  });

  it.each([
    ["ja", "現在のSource位置が古くなっています。現在のSourceでキャレットを再確定してから再試行してください。"],
    ["en", "The current Source position is stale. Reconfirm the caret in the current Source and try again."]
  ] as const)("localizes stale Canvas source anchors for the %s host without starting creation", async (language, expectedError) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewPresentation", presentation: webviewPresentationFor(language) }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: "nui 1\n", documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewAuthoritativeDocumentReady", documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCreationCommand",
          commandId: "addLine",
          requestId: 602,
          documentVersion: 7,
          sourcePosition: { line: 4, character: 0 }
        }
      }));
    });

    expect(useCadUiStore.getState().commandErrorMessage).toBe(expectedError);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "canvasCommit" }));
  });

  it("accepts a graph/runtime source revision that differs from the Webview compiler revision", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const webviewSourceRevision = useCadDocumentStore.getState().currentSourceRevision;
    expect(webviewSourceRevision).not.toBe(37);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: multiDocumentRuntimePublicationFor(
          source,
          7,
          37,
          37,
          useCadDocumentStore.getState().elements
        )
      }));
    });

    expect(drawingCanvasProps.multiDocumentRuntimePresentation).not.toBeNull();
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootSourceRevision).toBe(37);
  });

  it("fails closed when the host runtime source revision disagrees with the graph root", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewAuthoritativeDocumentReady", documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: multiDocumentRuntimePublicationFor(
          source,
          7,
          37,
          38,
          useCadDocumentStore.getState().elements
        )
      }));
    });

    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
  });

  it("keeps the Rust transport alive across benchmark configuration and disposes it on unmount", async () => {
    const dispose = vi.spyOn(VscodeRustTransport.prototype, "dispose");
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "benchmarkConfig", config: {} }
      }));
    });

    expect(dispose).not.toHaveBeenCalled();
    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("signals Webview readiness once without recompiling the authoritative document for benchmark configuration", async () => {
    const source = sourceForSelectionChronology(0);
    let readyCount = 0;
    const api = {
      postMessage: vi.fn((message: { type?: string }) => {
        if (message.type !== "webviewReady") return;
        readyCount += 1;
        if (readyCount > 2) return;
        queueMicrotask(() => {
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
          }));
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "benchmarkConfig", config: { runId: `run-${readyCount}` } }
          }));
        });
      })
    };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const documentAfterInitialSync = useCadDocumentStore.getState();
    const readinessMessages = api.postMessage.mock.calls.filter(([message]) => message.type === "webviewReady");
    expect(readinessMessages).toHaveLength(1);
    expect(readyCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "benchmarkConfig", config: { runId: "repeated-1" } }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "benchmarkConfig", config: { runId: "repeated-2" } }
      }));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message.type === "webviewReady")).toHaveLength(1);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(documentAfterInitialSync.sourceRevision);
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(documentAfterInitialSync.compiledDocumentRevision);
  });

  it("passes the VSCodeApp-owned Reference Pick authority through the Canvas boundary", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const currentReferencePickAuthorityFor = drawingCanvasProps.currentReferencePickAuthorityFor;
    expect(currentReferencePickAuthorityFor).not.toBeNull();
    expect(currentReferencePickAuthorityFor!(7)).toEqual({
      documentVersion: 7,
      normalizedSource: source
    });
    expect(currentReferencePickAuthorityFor!(6)).toBeNull();
  });

  it("keeps Reference Pick authority on exact current Source text while the compiled document is last-good", async () => {
    const valid = sourceForSelectionChronology(0);
    const fatal = `${valid}\nconst X: number = `;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: valid, documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: fatal, documentVersion: 8, reason: "edit" }
      }));
    });

    expect(useCadDocumentStore.getState().docText).toBe(valid);
    expect(drawingCanvasProps.currentReferencePickAuthorityFor!(8)).toEqual({
      documentVersion: 8,
      normalizedSource: fatal
    });
  });

  it("applies native conversion success to exactly the reported Canvas targets", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const elements = useCadDocumentStore.getState().elements;
    const first = elements.find((element) => element.name === "A")!;
    const second = elements.find((element) => element.name === "B")!;
    useCadUiStore.getState().setCanvasSelectionEligibility(elements, new Set(elements.map((element) => element.id)));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 3,
          documentVersion: 7,
          successfulTargetIds: [second.id]
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual([second.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(second.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(first.id);
  });

  it("dispatches only runtime-validated Canvas creation messages through the shared command registry", async () => {
    const dispatchCommand = vi.spyOn(commandRegistry, "dispatchCommand").mockReturnValue(false);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      const sourceText = useCadDocumentStore.getState().sourceText;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewAuthoritativeDocumentReady", documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCreationCommand",
          commandId: "addLine",
          requestId: 1,
          documentVersion: 1,
          sourcePosition: { line: 0, character: 0 }
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCreationCommand", commandId: "not-allowlisted" }
      }));
    });

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledWith("addLine", expect.objectContaining({
      recordSelectionHistory: true
    }));
  });

  it("dispatches Select Instance Canvas messages through the shared command registry", async () => {
    const dispatchCommand = vi.spyOn(commandRegistry, "dispatchCommand").mockReturnValue(false);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "selectInstance" }
      }));
    });

    expect(dispatchCommand).toHaveBeenCalledWith("selectInstance", expect.objectContaining({
      recordSelectionHistory: true
    }));
  });

  it("starts the existing command-line creation session for a valid Canvas creation message", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      const sourceText = useCadDocumentStore.getState().sourceText;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewAuthoritativeDocumentReady", documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCreationCommand",
          commandId: "addLine",
          requestId: 1,
          documentVersion: 1,
          sourcePosition: { line: 0, character: 0 }
        }
      }));
    });

    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      recipe: { type: "line" }
    });
  });

  it("routes retained Canvas creation persistence through the existing canvasCommit bridge", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewAuthoritativeDocumentReady", documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCreationCommand",
          commandId: "addFreePoint",
          requestId: 1,
          documentVersion: 7,
          sourcePosition: { line: 0, character: 0 }
        }
      }));
    });

    await act(async () => {
      submitCommandLineInput("");
      submitCommandLineInput("1");
      submitCommandLineInput("2");
      expect(confirmCommandLineSession()).toBe(true);
    });

    const committedDocument = useCadDocumentStore.getState();
    const created = committedDocument.elements.find((element) => element.name === "");
    const createdInfo = created && committedDocument.doc.statementMap.byElementId.get(created.id);
    const nextSourceLine = createdInfo && Math.max(createdInfo.range.endLine, createdInfo.endLine) - 1;
    expect(committedDocument.sourceUpdate.kind).toBe("model-patch");
    const committedSplices = committedDocument.sourceUpdate.kind === "model-patch"
      ? committedDocument.sourceUpdate.splices
      : [];
    expect(drawingCanvasProps.postCanonicalSourceText).not.toBeNull();
    await act(async () => {
      drawingCanvasProps.postCanonicalSourceText!(committedDocument.sourceText, {
        requestId: 1,
        insertedElementId: created?.id,
        nextSourcePosition: nextSourceLine === undefined ? undefined : {
          line: nextSourceLine,
          character: committedDocument.sourceText.split("\n")[nextSourceLine]?.length ?? 0
        }
      });
    });

    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommit",
      sourceText: committedDocument.sourceText,
      expectedDocumentVersion: 7,
      mutationKind: "model-patch",
      splices: committedSplices,
      operationId: 1,
      sourceCreation: {
        requestId: 1,
        insertedElementId: created?.id,
        nextSourcePosition: nextSourceLine === undefined ? undefined : {
          line: nextSourceLine,
          character: committedDocument.sourceText.split("\n")[nextSourceLine]?.length ?? 0
        }
      }
    }));
  });

  it("rolls back a rejected Canvas free-point commit to the exact Source and selection snapshot", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0, id: a)",
      "point B = coordinate(x: 20, y: 0, id: b)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    const beforeElements = useCadDocumentStore.getState().elements;
    const beforeElementIds = beforeElements.map((element) => element.id);
    const beforeSelection = {
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: [...useCadUiStore.getState().selectedElementIds],
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 42,
          documentVersion: 7,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 1, character: 0 }
        }
      }));
    });

    const locallyInsertedState = useCadDocumentStore.getState();
    const locallyInsertedIds = locallyInsertedState.elements
      .map((element) => element.id)
      .filter((id) => !beforeElementIds.includes(id));
    const locallyInsertedName = locallyInsertedState.elements.find((element) => locallyInsertedIds.includes(element.id))?.name;
    expect(locallyInsertedState.sourceText).not.toBe(source);
    expect(locallyInsertedState.elements).toHaveLength(beforeElements.length + 1);
    expect(locallyInsertedIds).toHaveLength(1);
    expect(locallyInsertedName).toBeTypeOf("string");
    expect(locallyInsertedState.elements.find((element) => element.id === locallyInsertedIds[0])?.type).toBe("freePoint");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommit",
      operationId: 42,
      expectedDocumentVersion: 7,
      sourceText: locallyInsertedState.sourceText
    }));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommitResult",
          operationId: 42,
          status: "rejected",
          documentVersion: 7
        }
      }));
    });

    const rolledBackState = useCadDocumentStore.getState();
    expect(rolledBackState.sourceText).toBe(source);
    expect(rolledBackState.elements.some((element) => element.name === locallyInsertedName)).toBe(false);
    expect({
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: useCadUiStore.getState().selectedElementIds,
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    }).toEqual(beforeSelection);

    const freePointResults = api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasFreePointAtPointerResult");
    expect(freePointResults).toEqual([{
      type: "canvasFreePointAtPointerResult",
      requestId: 42,
      status: "rejected",
      documentVersion: 7
    }]);
    expect(freePointResults.some((message) => message.status === "applied")).toBe(false);
    expect(freePointResults[0]).not.toHaveProperty("nextSourcePosition");
    publishAllCurrentElementsAsPresented();
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
  });

  it("materializes an unnamed freePoint and defers selection until Canvas presents it", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      publishAllCurrentElementsAsPresented();
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 43,
          documentVersion: 7,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 1, character: 0 }
        }
      }));
    });

    const originalElementIds = new Set([...
      useCadDocumentStore.getState().elements
        .filter((element) => element.name === "A" || element.name === "B")
        .map((element) => element.id)
    ]);
    const locallyInserted = useCadDocumentStore.getState().elements.find(
      (element) => !originalElementIds.has(element.id) && element.type === "freePoint"
    )!;
    expect(locallyInserted.name).toBe("");
    expect(useCadDocumentStore.getState().sourceText).toContain("point = coordinate(");
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    const createdSource = useCadDocumentStore.getState().sourceText;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "commitText",
          sourceText: createdSource,
          documentVersion: 8,
          reason: "edit"
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasFreePointAtPointerResult")).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommitResult",
          operationId: 43,
          status: "accepted",
          documentVersion: 8
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    await act(async () => {
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(locallyInserted.id);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([locallyInserted.id]);
  });

  it.each([
    ["commitText -> commitResult", "commitText-first"],
    ["commitResult -> commitText", "commitResult-first"]
  ] as const)("creates two consecutive unnamed free points through the real H3 source path (%s)", async (_label, ordering) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    const requestedPointers: Array<{ x: number; y: number }> = [];
    const send = async (data: unknown) => {
      if (typeof data === "object" && data !== null && (data as { type?: string }).type === "canvasFreePointAtPointer") {
        requestedPointers.push((data as { pointer: { x: number; y: number } }).pointer);
      }
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };
    const messagesOfType = (type: string) => api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === type);
    const presentCanvasElements = async () => {
      await act(async () => {
        publishAllCurrentElementsAsPresented();
      });
    };
    const canvasCommitFor = (requestId: number) => messagesOfType("canvasCommit")
      .find((message) => message.operationId === requestId) as {
        sourceText: string;
        expectedDocumentVersion: number;
      } | undefined;
    const completeCommit = async (commit: {
      sourceText: string;
      expectedDocumentVersion: number;
    }, requestId: number, documentVersion: number) => {
      const commitText = {
        type: "commitText" as const,
        sourceText: commit.sourceText,
        documentVersion,
        reason: "edit" as const
      };
      const commitResult = {
        type: "canvasCommitResult" as const,
        operationId: requestId,
        status: "accepted" as const,
        documentVersion
      };
      if (ordering === "commitText-first") {
        await send(commitText);
        await send(commitResult);
      } else {
        await send(commitResult);
        await send(commitText);
      }
    };

    await send({ type: "replaceTextDocument", sourceText: h3Source, documentVersion: 1 });
    await presentCanvasElements();

    await send({
      type: "canvasFreePointAtPointer",
      requestId: 221,
      documentVersion: 1,
      pointer: { x: 12.5, y: -8 },
      sourcePosition: h3GuideSourcePosition
    });
    const firstCommit = canvasCommitFor(221);
    expect(firstCommit).toBeDefined();
    expect(firstCommit?.sourceText).toContain("line Guide = segment(start: @Left, end: @Right)");
    expect(firstCommit?.sourceText).toContain("point = coordinate(\n  x: 12.5,\n  y: -8,\n)");
    expect(firstCommit?.sourceText.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)")).toBeGreaterThan(
      firstCommit?.sourceText.indexOf("line Guide = segment(start: @Left, end: @Right)") ?? -1
    );

    await completeCommit(firstCommit!, 221, 2);
    const firstResult = messagesOfType("canvasFreePointAtPointerResult")
      .find((message) => message.requestId === 221) as {
        status: string;
        documentVersion: number;
        nextSourcePosition?: { line: number; character: number };
      } | undefined;
    expect(firstResult).toMatchObject({ status: "applied", documentVersion: 2 });
    expect(firstResult?.nextSourcePosition).toBeDefined();

    await send({
      type: "canvasFreePointAtPointer",
      requestId: 222,
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: firstResult!.nextSourcePosition!
    });
    const secondCommit = canvasCommitFor(222);
    expect(secondCommit).toBeDefined();
    expect(secondCommit?.sourceText).toContain("point = coordinate(\n  x: 91,\n  y: -37,\n)");
    expect(secondCommit?.sourceText.indexOf("point = coordinate(\n  x: 91,\n  y: -37,\n)")).toBeGreaterThan(
      secondCommit?.sourceText.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)") ?? -1
    );

    await completeCommit(secondCommit!, 222, 3);
    await presentCanvasElements();

    const finalSource = useCadDocumentStore.getState().sourceText;
    const pointDeclarations = finalSource.match(/^point(?: [A-Za-z_][A-Za-z0-9_]*)? = coordinate\(/gm) ?? [];
    expect(pointDeclarations).toHaveLength(4);
    expect(finalSource.indexOf("line Guide = segment(start: @Left, end: @Right)")).toBeLessThan(
      finalSource.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)")
    );
    expect(finalSource.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)")).toBeLessThan(
      finalSource.indexOf("point = coordinate(\n  x: 91,\n  y: -37,\n)")
    );
    expect(requestedPointers).toEqual([
      { x: 12.5, y: -8 },
      { x: 91, y: -37 }
    ]);
    expect(messagesOfType("canvasCommit").map((message) => message.sourceText)).toEqual([
      firstCommit!.sourceText,
      secondCommit!.sourceText
    ]);
    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) =>
        element.type === "freePoint" && element.name === "" && element.x === 91 && element.y === -37
      )?.id
    );
    expect(messagesOfType("canvasFreePointAtPointerResult")).toEqual([
      expect.objectContaining({ requestId: 221, status: "applied" }),
      expect.objectContaining({ requestId: 222, status: "applied" })
    ]);
  });

  it("keeps the creation selection contract through host Undo and Redo", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 44,
          documentVersion: 7,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 1, character: 0 }
        }
      }));
    });
    const createdSource = useCadDocumentStore.getState().sourceText;
    const createdPoint = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommitResult", operationId: 44, status: "accepted", documentVersion: 8 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(createdPoint.id);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: source, documentVersion: 9, reason: "undo" }
      }));
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().elements.some((element) => element.id === createdPoint.id)).toBe(false);
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: createdSource, documentVersion: 10, reason: "redo" }
      }));
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(createdSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(createdPoint.id);
  });

  it("queues Canvas history until the authoritative result and restores focus after completion", async () => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    publishAllCurrentElementsAsPresented();
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(
      <>
        <VSCodeAppForTest api={api} />
        <input data-testid="focus-sink" />
      </>
    );
    const canvas = screen.getByTestId("canvas");
    const focusSink = screen.getByTestId("focus-sink");
    focusSink.focus();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    const canvasHistoryRequests = () => api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    );
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(canvasHistoryRequests()[0]?.[0]).toEqual({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      publishAllCurrentElementsAsPresented();
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(oldSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(document.activeElement).toBe(focusSink);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasHistoryResult",
          direction: "undo",
          status: "completed",
          documentVersion: 2
        }
      }));
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(canvas);
    expect(useCadUiStore.getState().selectedElementId).toBe(a);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    expect(canvasHistoryRequests()).toHaveLength(1);
  });

  it.each(["resynced", "failed"] as const)("discards queued Canvas history after a %s result", async (status) => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    publishAllCurrentElementsAsPresented();
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    const canvasHistoryRequests = () => api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    );
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(useCadUiStore.getState().selectedElementId).toBe(b);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasHistoryResult", direction: "undo", status, documentVersion: 2 }
      }));
      await Promise.resolve();
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(a).not.toBe(useCadUiStore.getState().selectedElementId);
  });

  it("uses the second Undo for local selection history after authoritative source Undo", async () => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    publishAllCurrentElementsAsPresented();
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      publishAllCurrentElementsAsPresented();
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    const historyRequestsBeforeLocalUndo = api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    ).length;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(a);
    expect(api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    )).toHaveLength(historyRequestsBeforeLocalUndo);
  });

  it("revalidates an Editor target, replaces selection through history, and focuses the viewport", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });
    const editorTarget = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    drawingCanvasProps.evaluation.computedGeometry.set(editorTarget.id, {
      kind: "point",
      elementId: editorTarget.id,
      name: editorTarget.name,
      x: 20,
      y: 0
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 12, documentVersion: 7, normalizedSourceOffset: source.indexOf("B") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.id
    );
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 12,
      status: "resolved",
      degradations: []
    });

    const canvas = screen.getByTestId("canvas");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 12 }
      }));
    });
    expect(document.activeElement).toBe(canvas);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 12,
      status: "focused"
    });
    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(1);
  });

  it("does not acknowledge Canvas focus while the Webview document is unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 21, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 21 }
      }));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("acknowledges pending Canvas focus on the Webview window focus event", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 22, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 22 }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(document.activeElement).toBe(screen.getByTestId("canvas"));
    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(1);
  });

  it("does not duplicate the Canvas focus acknowledgement on repeated window focus events", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 23, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 23 }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(1);
  });

  it("does not duplicate the Canvas focus acknowledgement when focus re-enters synchronously", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 231, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    const canvas = screen.getByTestId("canvas");
    const originalFocus = canvas.focus.bind(canvas);
    let focusEventDispatched = false;
    vi.spyOn(canvas, "focus").mockImplementation(() => {
      originalFocus();
      if (focusEventDispatched) return;
      focusEventDispatched = true;
      window.dispatchEvent(new Event("focus"));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 231 }
      }));
    });

    expect(api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasNavigationResult" && message.status === "focused"
    )).toHaveLength(1);
  });

  it("does not complete pending focus after a newer Canvas navigation request", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 24, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 24 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 25, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("does not complete pending focus after an authoritative document change", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const changedSource = `${source}\n// authoritative change`;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 26, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 26 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: changedSource, documentVersion: 2 }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("does not complete pending focus after Canvas history handoff starts", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 27, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 27 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasHistoryRequest")).toHaveLength(1);
    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("fails closed for stale host navigation without changing selection", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const newerSource = `${source}\n// newer authoritative text`;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: newerSource, documentVersion: 6 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 13, documentVersion: 6, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 13,
      status: "failed",
      reason: "source-mismatch"
    });
  });

  it("rejects a Canvas-local source ahead of the host until its acknowledgement arrives", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const localSource = `${source}\n// Canvas-local edit`;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });
    expect(drawingCanvasProps.postCanonicalSourceText).not.toBeNull();

    await act(async () => {
      useCadDocumentStore.getState().commitText(localSource, "test");
      drawingCanvasProps.postCanonicalSourceText!(localSource);
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 14, documentVersion: 7, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 14,
      status: "failed",
      reason: "source-mismatch"
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: localSource, documentVersion: 8, reason: "edit" }
      }));
    });
    const localTarget = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    drawingCanvasProps.evaluation.computedGeometry.set(localTarget.id, {
      kind: "point",
      elementId: localTarget.id,
      name: localTarget.name,
      x: 0,
      y: 0
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 15, documentVersion: 8, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id
    );
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 15,
      status: "resolved",
      degradations: []
    });
  });

  it("blocks navigation while Canvas history is in flight", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 16, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 16,
      status: "failed",
      reason: "source-mismatch"
    });
  });

  it("reveals every runtime materialization of one module-body statement once", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "instance A = M()",
      "instance B = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const statementIndex = state.doc.statements.findIndex((statement) => statement.name === "P");
    const owners = sourceOwnerByRuntimeElementId(state.doc);
    const runtimeIds = state.elements
      .filter((element) => owners.get(element.id)?.sourceStatementIndex === statementIndex)
      .map((element) => element.id);
    expect(runtimeIds.length).toBeGreaterThan(1);
    for (const runtimeId of runtimeIds) {
      drawingCanvasProps.evaluation.computedGeometry.set(runtimeId, {
        kind: "point",
        elementId: runtimeId,
        name: runtimeId,
        x: 10,
        y: 20
      });
    }

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 17, documentVersion: 1, normalizedSourceOffset: source.indexOf("P") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual(runtimeIds);
    expect(useCadUiStore.getState().selectedElementId).toBe(runtimeIds[0]);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 18, documentVersion: 1, normalizedSourceOffset: source.indexOf("P") }
      }));
    });

    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(runtimeIds);
  });

  it.each([
    ["hidden", "nui 1\npoint A = coordinate(x: 0, y: 0, state: hidden)", "A", false],
    ["disabled", "nui 1\npoint A = coordinate(x: 0, y: 0, state: disabled)", "A", false],
    ["non-renderable", "nui 1\nmodule M() {\n  point P = coordinate(x: 0, y: 0)\n}\ninstance A = M()", "A", false]
  ] as const)("handles a %s primary without changing activity or viewport", async (_label, source, token, shouldSelect) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    useCadUiStore.getState().setCanvasViewport({ panX: 17, panY: -9, zoom: 2 });
    const beforeViewport = useCadUiStore.getState().canvasViewport;
    const beforeElements = useCadDocumentStore.getState().elements.map((element) => ({
      id: element.id,
      activity: element.activity
    }));
    const beforeModifiers = useCadDocumentStore.getState().modifiers;
    const beforeVisibilityProfiles = useCadDocumentStore.getState().visibilityProfiles;
    const beforeActiveVisibilityProfileId = useCadDocumentStore.getState().activeVisibilityProfileId;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 19, documentVersion: 1, normalizedSourceOffset: source.indexOf(token) }
      }));
    });

    const targetId = useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id;
    if (shouldSelect) {
      expect(useCadUiStore.getState().selectedElementId).toBe(targetId);
    } else {
      expect(useCadUiStore.getState()).toMatchObject({
        selectedElementId: null,
        selectedElementIds: [],
        selectionAnchorElementId: null
      });
    }
    expect(useCadDocumentStore.getState().elements.map((element) => ({ id: element.id, activity: element.activity }))).toEqual(beforeElements);
    expect(useCadDocumentStore.getState().modifiers).toEqual(beforeModifiers);
    expect(useCadDocumentStore.getState().visibilityProfiles).toEqual(beforeVisibilityProfiles);
    expect(useCadDocumentStore.getState().activeVisibilityProfileId).toBe(beforeActiveVisibilityProfileId);
    expect(useCadUiStore.getState().canvasViewport).toEqual(beforeViewport);
  });

  it("does not use an ineligible Module instance for a target-scoped Bake sandbox", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point Broken = coordinate(x: 0, y: 0, state: disabled)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const instance = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    selectElement(instance.id, "replace", true);

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
    });

    expect(drawingCanvasProps.bakeSandboxTargetIds).toBeNull();
  });

  it("uses the resolved Source Bake target for a target-scoped sandbox", async () => {
    const source = [
      "nui 1",
      "point Dependency = coordinate(x: 0, y: 0, state: disabled)",
      "line Broken = segment(start: @Dependency, end: (10, 0), state: disabled)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const broken = useCadDocumentStore.getState().elements.find((element) => element.name === "Broken")!;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 20,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("Broken"),
          mode: "current",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
    });

    expect(drawingCanvasProps.bakeSandboxTargetIds).toEqual([broken.id]);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeSourceResult",
      requestId: 20,
      status: "nothing"
    });
  });

  it("rejects a stale Source Bake sandbox without mutating the newer document", async () => {
    const source = [
      "nui 1",
      "point Dependency = coordinate(x: 0, y: 0, state: disabled)",
      "line Broken = segment(start: @Dependency, end: (10, 0), state: disabled)"
    ].join("\n");
    let resolveSandbox!: (value: unknown) => void;
    drawingCanvasProps.bakeSandboxPromise = new Promise((resolve) => {
      resolveSandbox = resolve;
    });
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const newerSource = `${source}\n// newer authoritative text`;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 21,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("Broken"),
          mode: "current",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newerSource, documentVersion: 2, reason: "edit" }
      }));
      resolveSandbox({});
      await Promise.resolve();
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(newerSource);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("Bake skipped:");
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeSourceResult",
      requestId: 21,
      status: "stale"
    });
  });

  it("selects a concrete Module instance when a descendant is presented", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 31 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });
    const canvas = screen.getByTestId("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({})
    } as DOMRect);
    useCadUiStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: 1 });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 311,
          documentVersion: 31,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual([instance.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(instance.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(child.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual({ panX: -80, panY: 0, zoom: 1 });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 311,
      status: "resolved",
      degradations: []
    });
  });

  it("keeps the existing selection and viewport when a Module instance has no own presentation", async () => {
    const source = [
      "nui 1",
      "point Existing = coordinate(x: 0, y: 0)",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0, state: hidden)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 32 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const existing = state.elements.find((element) => element.name === "Existing")!;
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });
    useCadUiStore.getState().setCanvasSelectionEligibility(state.elements, new Set([existing.id]));
    selectElement(existing.id, "replace", true);
    useCadUiStore.getState().setCanvasViewport({ panX: 17, panY: -9, zoom: 2 });
    const viewportBefore = { ...useCadUiStore.getState().canvasViewport };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 321,
          documentVersion: 32,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: existing.id,
      selectedElementIds: [existing.id],
      selectionAnchorElementId: existing.id
    });
    expect(useCadUiStore.getState().canvasViewport).toEqual(viewportBefore);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 321,
      status: "failed",
      reason: "no-revealable-runtime-target"
    });
  });

  it("reselects current materializations for a generated group inside a reusable Module body", async () => {
    const source = [
      "nui 1",
      "module Leaf() {",
      "  point P = coordinate(x: 80, y: 0)",
      "}",
      "module Outer() {",
      "  instance FirstChild = Leaf()",
      "  instance SecondChild = Leaf()",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 61 }
      }));
    });
    const before = useCadDocumentStore.getState();
    const childIndexes = before.doc.statements.flatMap((statement, index) =>
      statement.kind === "moduleInstance" && (statement.name === "FirstChild" || statement.name === "SecondChild")
        ? [index]
        : []
    );
    const childTargets = childIndexes.map((childIndex) => ({
      childIndex,
      statementId: before.doc.statementMap?.statementIdByStatementIndex?.get(childIndex)
    }));
    expect(childTargets).toHaveLength(2);
    expect(childTargets.every((target) => target.statementId)).toBe(true);
    if (childTargets.some((target) => !target.statementId)) return;
    const oldChildRuntimeIds = new Set(
      before.doc.moduleMaterialization?.executionStatements
        .filter((entry) => childIndexes.includes(entry.sourceStatementIndex))
        .map((entry) => entry.runtimeElementId) ?? []
    );

    const planned = planInlineModule({
      source: {
        normalizedSource: source,
        sourceRevision: before.currentSourceRevision
      },
      compiled: before.doc,
      targets: childTargets.map((target) => ({ documentKey: null, statementId: target.statementId! })),
      policy: {
        emitOmittedBranchComments: true,
        includeHiddenInstances: false,
        includeDisabledInstances: false
      }
    });
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    expect(planned.targets.filter((target) => target.status === "inlined")).toHaveLength(2);
    const nextSource = applyLineSplices(source, planned.splices);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: nextSource, documentVersion: 62, reason: "edit" }
      }));
    });
    const after = useCadDocumentStore.getState();
    const generatedGroupIndexes = after.doc.statements.flatMap((statement, index) =>
      statement.kind === "group" && (statement.name === "FirstChild" || statement.name === "SecondChild")
        ? [index]
        : []
    );
    expect(generatedGroupIndexes).toHaveLength(2);
    const generatedGroups = generatedGroupIndexes.map((index) => after.doc.statements[index]);
    expect(generatedGroups.every((statement) => statement?.kind === "group")).toBe(true);
    if (generatedGroups.some((statement) => statement?.kind !== "group")) return;

    const generatedGroupMaterializations = after.doc.moduleMaterialization!.executionStatements
      .filter((entry) => generatedGroupIndexes.includes(entry.sourceStatementIndex))
      .map((entry) => entry.runtimeElementId)
      .filter((id) => after.elements.some((element) => element.id === id));
    expect(generatedGroupMaterializations.length).toBeGreaterThanOrEqual(4);
    const generatedGroupMaterializationsInSourceOrder = generatedGroupIndexes.flatMap((groupIndex) =>
      after.doc.moduleMaterialization!.executionStatements
        .filter((entry) => entry.sourceStatementIndex === groupIndex)
        .map((entry) => entry.runtimeElementId)
        .filter((id) => after.elements.some((element) => element.id === id))
    );
    const generatedGeometryMaterializations = generatedGroupMaterializationsInSourceOrder.flatMap((groupId) =>
      after.elements.filter((element) => element.parentGroupId === groupId && element.name === "P").map((element) => element.id)
    );
    expect(generatedGeometryMaterializations.length).toBeGreaterThanOrEqual(4);
    for (const element of after.elements.filter((element) => element.name === "P")) {
      drawingCanvasProps.evaluation.computedGeometry.set(element.id, {
        kind: "point",
        elementId: element.id,
        name: element.name,
        x: 80,
        y: 0
      });
    }
    await act(async () => {
      publishAllCurrentElementsAsPresented();
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "inlineModuleSelectionRequest",
          requestId: 621,
          documentVersion: 62,
          normalizedSource: nextSource,
          generatedGroups: generatedGroupIndexes.map((generatedGroupIndex, index) => {
            const generatedGroup = generatedGroups[index]!;
            return {
              sourceStatementIndex: generatedGroupIndex,
              sourceRange: {
                from: generatedGroup.documentRange.from,
                to: generatedGroup.documentRange.to
              },
              generatedGroupName: generatedGroup.name
            };
          })
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual(generatedGeometryMaterializations);
    expect(useCadUiStore.getState().selectedElementIds.some((id) => oldChildRuntimeIds.has(id))).toBe(false);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "inlineModuleSelectionResult",
      requestId: 621,
      documentVersion: 62,
      status: "selected",
      selectedRuntimeElementIds: generatedGeometryMaterializations
    });
  });

});
