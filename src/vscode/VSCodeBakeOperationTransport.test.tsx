import { act, render } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BakeCommandResult } from "../commands/bakeOperationResult";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";

const dispatchCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../commands/commands", () => ({
  dispatchCommand: dispatchCommandMock
}));

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/evaluationEngine", () => ({
  evaluateElementsWithRust: vi.fn(async () => ({}))
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => true,
  useEvaluationEngine: () => ({
    evaluation: {},
    evaluationState: { evaluation: {} }
  })
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: ({ canvasFocusRef }: { canvasFocusRef: RefObject<HTMLDivElement | null> }) =>
    <div ref={canvasFocusRef} data-testid="canvas" tabIndex={-1} />
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const source = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)"
].join("\n");

const commandResult: BakeCommandResult = {
  status: "noop",
  bakeSummary: {
    successfulTargetCount: 0,
    skippedTargetCount: 1,
    skippedTargets: [{
      targetId: "target-1",
      sourceElementId: "source-1",
      sourceLabel: "text Memo",
      reason: { code: "unsupported-geometry-kind", geometryKind: "text" }
    }]
  }
};

describe("VSCodeApp Bake operation transport", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    dispatchCommandMock.mockReset();
    dispatchCommandMock.mockReturnValue(commandResult);
  });

  it("sends the same semantic summary and explicit mode for Canvas Bake", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeCurrentShape",
          emitSkippedComments: false,
          includeHiddenGeometry: false,
          includeDisabledGeometry: false
        }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeOperationResult",
      surface: "canvas",
      mode: "current",
      status: "nothing",
      summary: commandResult.bakeSummary
    });
  });

  it("sends the Source semantic result before the legacy envelope", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 7,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("A"),
          mode: "current",
          emitSkippedComments: false,
          includeHiddenGeometry: false,
          includeDisabledGeometry: false
        }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeOperationResult",
      surface: "source",
      requestId: 7,
      mode: "current",
      status: "nothing",
      summary: commandResult.bakeSummary
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeSourceResult",
      requestId: 7,
      status: "nothing"
    });
    const operationIndex = api.postMessage.mock.calls.findIndex(
      ([message]) => message?.type === "bakeOperationResult" && message.surface === "source"
    );
    const legacyIndex = api.postMessage.mock.calls.findIndex(
      ([message]) => message?.type === "bakeSourceResult" && message.requestId === 7
    );
    expect(operationIndex).toBeGreaterThanOrEqual(0);
    expect(legacyIndex).toBeGreaterThan(operationIndex);
  });
});
