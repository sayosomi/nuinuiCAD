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

const sourceFor = (x: number) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y: 0 }
]);

const sourceForSelectionChronology = (x: number) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: x + 10, y: 0 }
]);

describe("VSCodeApp Canvas history coordinator", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("does not speculate or issue a second host transition while the first is in flight", async () => {
    const oldSource = sourceFor(0);
    const newSource = sourceFor(10);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(<VSCodeAppForTest api={api} />);
    const canvas = screen.getByTestId("canvas");
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(newSource);
    expect(api.postMessage).toHaveBeenCalledTimes(2);
    expect(api.postMessage).toHaveBeenLastCalledWith({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      await Promise.resolve();
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(oldSource);
    expect(document.activeElement).toBe(canvas);
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
