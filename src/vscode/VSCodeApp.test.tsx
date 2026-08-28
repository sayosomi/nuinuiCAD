import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectElement } from "../commands/selectionCommands";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import type { EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";
import type { VscodeReferencePickAuthorityFor } from "./useVSCodeReferencePickSession";

const drawingCanvasProps = vi.hoisted(() => ({
  postCanonicalSourceText: null as ((sourceText: string) => void) | null,
  currentReferencePickAuthorityFor: null as VscodeReferencePickAuthorityFor | null,
  bakeSandboxTargetIds: null as string[] | null,
  bakeSandboxPromise: null as Promise<unknown> | null,
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
    currentReferencePickAuthorityFor
  }: {
    canvasFocusRef: RefObject<HTMLDivElement | null>;
    postCanonicalSourceText: (sourceText: string) => void;
    currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
  }) => {
    drawingCanvasProps.postCanonicalSourceText = postCanonicalSourceText;
    drawingCanvasProps.currentReferencePickAuthorityFor = currentReferencePickAuthorityFor;
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

describe("VSCodeApp Canvas history coordinator", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    drawingCanvasProps.postCanonicalSourceText = null;
    drawingCanvasProps.currentReferencePickAuthorityFor = null;
    drawingCanvasProps.bakeSandboxTargetIds = null;
    drawingCanvasProps.bakeSandboxPromise = null;
    drawingCanvasProps.evaluation = { computedGeometry: new Map(), errors: [], warnings: [] };
  });

  afterEach(() => vi.restoreAllMocks());

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

  it("queues Canvas history until the authoritative result and restores focus after completion", async () => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
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
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
    ["hidden", "nui 4\npoint A = coordinate(x: 0, y: 0, state: hidden)", "A", false],
    ["disabled", "nui 4\npoint A = coordinate(x: 0, y: 0, state: disabled)", "A", false],
    ["non-renderable", "nui 4\nmodule M() {\n  point P = coordinate(x: 0, y: 0)\n}\ninstance A = M()", "A", true]
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

  it("uses the captured Canvas selection for a target-scoped Bake sandbox", async () => {
    const source = [
      "nui 4",
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
    const broken = useCadDocumentStore.getState().elements.find(
      (element) => element.name === "Broken" && element.parentGroupId === instance.id
    )!;
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

    expect(drawingCanvasProps.bakeSandboxTargetIds).toEqual([broken.id]);
  });

  it("uses the resolved Source Bake target for a target-scoped sandbox", async () => {
    const source = [
      "nui 4",
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
      "nui 4",
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

  it("reveals a concrete Module instance as one identity and centers its point-like descendant bounds without zooming", async () => {
    const source = [
      "nui 4",
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

  it("selects a Module instance without moving the viewport when it has no renderable descendants", async () => {
    const source = [
      "nui 4",
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
      selectedElementId: instance.id,
      selectedElementIds: [instance.id],
      selectionAnchorElementId: instance.id
    });
    expect(useCadUiStore.getState().canvasViewport).toEqual(viewportBefore);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 321,
      status: "resolved",
      degradations: []
    });
  });

});
