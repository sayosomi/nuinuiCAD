import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectElement } from "../commands/selectionCommands";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";

const drawingCanvasProps = vi.hoisted(() => ({
  postCanonicalSourceText: null as ((sourceText: string) => void) | null
}));

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => ({
    evaluation: {},
    evaluationState: { evaluation: {} }
  })
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: ({
    canvasFocusRef,
    postCanonicalSourceText
  }: {
    canvasFocusRef: RefObject<HTMLDivElement | null>;
    postCanonicalSourceText: (sourceText: string) => void;
  }) => {
    drawingCanvasProps.postCanonicalSourceText = postCanonicalSourceText;
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
      status: "ready"
    });

    const canvas = screen.getByTestId("canvas");
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
      status: "stale"
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
      status: "stale"
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
      status: "ready"
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
      status: "stale"
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
    ["hidden", "nui 4\npoint A = coordinate(x: 0, y: 0, state: hidden)", "A"],
    ["disabled", "nui 4\npoint A = coordinate(x: 0, y: 0, state: disabled)", "A"],
    ["non-renderable", "nui 4\nmodule M() {\n  point P = coordinate(x: 0, y: 0)\n}\ninstance A = M()", "A"]
  ] as const)("selects a %s primary without changing activity or viewport", async (_label, source, token) => {
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

    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id
    );
    expect(useCadDocumentStore.getState().elements.map((element) => ({ id: element.id, activity: element.activity }))).toEqual(beforeElements);
    expect(useCadDocumentStore.getState().modifiers).toEqual(beforeModifiers);
    expect(useCadDocumentStore.getState().visibilityProfiles).toEqual(beforeVisibilityProfiles);
    expect(useCadDocumentStore.getState().activeVisibilityProfileId).toBe(beforeActiveVisibilityProfileId);
    expect(useCadUiStore.getState().canvasViewport).toEqual(beforeViewport);
  });
});
