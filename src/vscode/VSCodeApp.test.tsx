import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectElement } from "../commands/selectionCommands";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  useEvaluationEngine: () => ({
    evaluation: {},
    evaluationState: { evaluation: {} }
  })
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: ({ canvasFocusRef }: { canvasFocusRef: RefObject<HTMLDivElement | null> }) => (
    <div ref={canvasFocusRef} data-testid="canvas" tabIndex={-1} />
  )
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
});
