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
  "nui 4",
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
  "  start: @A,",
  "  end: @B,",
  ")"
].join("\n");

const errorfulWithoutA = [
  "nui 4",
  "",
  "point B = coordinate(",
  "  x: 60,",
  "  y: 0,",
  ")",
  "",
  "line Temp = segment(",
  "  start: @B,",
  "  end:",
  ")"
].join("\n");

const validWithoutA = [
  "nui 4",
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

  it("preserves A through the exact authoritative host load, Unit 1 error, and recovery", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeApp api={api} />);

    await publish({
      type: "replaceTextDocument",
      sourceText: baseline,
      documentVersion: 1
    });

    const initialA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(initialA).toBeDefined();
    publishTestCanvasSelectionEligibility();
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
    expect(selectedElementId()).toBe(initialA!.id);

    await publish({
      type: "commitText",
      sourceText: baseline,
      documentVersion: 3,
      reason: "edit"
    });

    const restoredA = useCadDocumentStore.getState().elements.find((element) => element.name === "A");
    expect(restoredA?.id).toBe(initialA!.id);
    expect(useCadDocumentStore.getState().diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(selectedElementId()).toBe(initialA!.id);
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
});
