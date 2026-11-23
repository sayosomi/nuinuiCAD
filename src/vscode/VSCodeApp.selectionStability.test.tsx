import { act, render } from "@testing-library/react";
import type { EvaluationResult } from "../types/geometry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectElement } from "../commands/selectionCommands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { publishTestCanvasSelectionEligibility } from "../test/canvasSelectionTestUtils";
import { VSCodeApp } from "./VSCodeApp";

const evaluation = {
  computedGeometry: new Map(),
  errors: [],
  warnings: []
} as EvaluationResult;

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => ({ evaluation })
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: () => null
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const baseline = [
  "nui 1",
  "",
  "point A = coordinate(",
  "  x: 0,",
  "  y: 0,",
  ")",
  "",
  "point B = coordinate(",
  "  x: 60,",
  "  y: 0,",
  ")",
  "",
  "line AB = segment(",
  "  start: A,",
  "  end: B,",
  ")"
].join("\n");

const errorfulWithoutA = [
  "nui 1",
  "",
  "point B = coordinate(",
  "  x: 60,",
  "  y: 0,",
  ")",
  "",
  "line Temp = segment(",
  "  start: B,",
  "  end:",
  ")"
].join("\n");

const errorfulOnB = baseline.replace("  x: 60,", "  x: ,");

const fatalOnA = [
  "nui 1",
  "point A = coordinate("
].join("\n");

const fatalOnUnrelatedSource = `${baseline}\nconst X: number = "abc"`;

const validWithoutA = [
  "nui 1",
  "",
  "point B = coordinate(",
  "  x: 60,",
  "  y: 0,",
  ")"
].join("\n");

const publish = async (data: Record<string, unknown>) => {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data }));
    await Promise.resolve();
  });
};

const selectCanvasElement = async (elementId: string) => {
  await act(async () => {
    selectElement(elementId, "replace", true);
    await Promise.resolve();
  });
};

const selectedElementId = () => useCadUiStore.getState().selectedElementId;

describe("VSCodeApp transient invalid-source selection lifecycle", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("clears stale A selection through an editor error and does not restore it after recovery", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    await publish({
      type: "replaceTextDocument",
      sourceText: baseline,
      documentVersion: 1
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    act(() => publishTestCanvasSelectionEligibility());
    await selectCanvasElement(initialA!.id);
    expect(selectedElementId()).toBe(initialA!.id);

    await publish({
      type: "commitText",
      sourceText: errorfulWithoutA,
      documentVersion: 2,
      reason: "edit"
    });

    const errorfulState = useCadDocumentStore.getState();
    expect(errorfulState.sourceUpdate.kind).toBe("editor");
    expect(errorfulState.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-attribute-value", severity: "error" })
    );
    expect(errorfulState.elements.some((element) => element.name === "A")).toBe(false);
    expect(selectedElementId()).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasObservationPublication",
      snapshot: expect.objectContaining({ selectedElementIds: [] })
    }));

    await publish({
      type: "commitText",
      sourceText: baseline,
      documentVersion: 3,
      reason: "edit"
    });

    const restoredA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(restoredA?.id).toBe(initialA!.id);
    expect(useCadDocumentStore.getState().diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(selectedElementId()).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasObservationPublication",
      snapshot: expect.objectContaining({ selectedElementIds: [] })
    }));
  });

  it("still clears A when an error-free A-less editor revision becomes authoritative first", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    await publish({
      type: "replaceTextDocument",
      sourceText: baseline,
      documentVersion: 10
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    await selectCanvasElement(initialA!.id);

    await publish({
      type: "commitText",
      sourceText: validWithoutA,
      documentVersion: 11,
      reason: "edit"
    });
    expect(useCadDocumentStore.getState().diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(selectedElementId()).toBeNull();

    await publish({
      type: "commitText",
      sourceText: errorfulWithoutA,
      documentVersion: 12,
      reason: "edit"
    });
    expect(useCadDocumentStore.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-attribute-value", severity: "error" })
    );
    expect(selectedElementId()).toBeNull();
  });

  it("preserves A when an editor error belongs to a different element", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    await publish({
      type: "replaceTextDocument",
      sourceText: baseline,
      documentVersion: 20
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    act(() => publishTestCanvasSelectionEligibility());
    await selectCanvasElement(initialA!.id);

    await publish({
      type: "commitText",
      sourceText: errorfulOnB,
      documentVersion: 21,
      reason: "edit"
    });

    expect(useCadDocumentStore.getState().diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-attribute-value", severity: "error" })
    );
    expect(selectedElementId()).toBe(initialA!.id);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([initialA!.id]);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasObservationPublication",
      snapshot: expect.objectContaining({ selectedElementIds: [initialA!.id] })
    }));
  });

  it("clears A when its fatal Source edit loses exact-current ownership and does not restore it after recovery", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    await publish({
      type: "replaceTextDocument",
      sourceText: baseline,
      documentVersion: 30
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    act(() => publishTestCanvasSelectionEligibility());
    await selectCanvasElement(initialA!.id);
    expect(selectedElementId()).toBe(initialA!.id);

    api.postMessage.mockClear();
    await publish({
      type: "commitText",
      sourceText: fatalOnA,
      documentVersion: 31,
      reason: "edit"
    });

    const fatalState = useCadDocumentStore.getState();
    expect(fatalState.sourceText).toBe(fatalOnA);
    expect(fatalState.diagnostics.some((item) => item.severity === "error")).toBe(true);
    expect(fatalState.currentCompiled.statementMap).toBeNull();
    expect(fatalState.elements).toContainEqual(expect.objectContaining({ id: initialA!.id, name: "A" }));
    expect(fatalState.docText).toBe(baseline);
    expect.soft(selectedElementId()).toBeNull();
    expect.soft(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect.soft(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasObservationPublication",
      snapshot: expect.objectContaining({ selectedElementIds: expect.arrayContaining([initialA!.id]) })
    }));

    api.postMessage.mockClear();
    await publish({
      type: "commitText",
      sourceText: baseline,
      documentVersion: 32,
      reason: "edit"
    });

    const recoveredA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(recoveredA?.id).toBe(initialA!.id);
    expect(useCadDocumentStore.getState().diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect.soft(selectedElementId()).toBeNull();
    expect.soft(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasObservationPublication",
      snapshot: expect.objectContaining({ selectedElementIds: [] })
    }));
  });

  it("preserves A when a fatal Source error leaves its current compiled element unaffected", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    await publish({
      type: "replaceTextDocument",
      sourceText: baseline,
      documentVersion: 40
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    act(() => publishTestCanvasSelectionEligibility());
    await selectCanvasElement(initialA!.id);

    api.postMessage.mockClear();
    await publish({
      type: "commitText",
      sourceText: fatalOnUnrelatedSource,
      documentVersion: 41,
      reason: "edit"
    });

    const fatalState = useCadDocumentStore.getState();
    expect(fatalState.diagnostics.some((item) => item.severity === "error")).toBe(true);
    expect(fatalState.currentCompiled.statementMap).toBeNull();
    expect([...fatalState.currentCompiled.sourceElementsByStatementIndex.values()]).toContainEqual(
      expect.objectContaining({ id: initialA!.id, name: "A" })
    );
    expect(selectedElementId()).toBe(initialA!.id);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([initialA!.id]);
  });
});
