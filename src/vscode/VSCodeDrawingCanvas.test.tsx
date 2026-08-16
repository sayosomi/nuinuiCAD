import { createRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { VSCodeDrawingCanvas } from "./VSCodeDrawingCanvas";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn(),
  hostAdapter: null as CanvasHostAdapter | null
}));

vi.mock("../commands/commands", () => ({
  dispatchCommand: mocks.dispatchCommand
}));

vi.mock("../components/DrawingCanvas", async () => {
  const React = await import("react");
  return {
    DrawingCanvas: React.forwardRef((props: { hostAdapter: CanvasHostAdapter }) => {
      mocks.hostAdapter = props.hostAdapter;
      return null;
    })
  };
});

afterEach(() => {
  mocks.dispatchCommand.mockReset();
  mocks.hostAdapter = null;
});

describe("VSCodeDrawingCanvas adapter", () => {
  it("keeps preview mutations in the Webview and sends one canonical source after each commit", () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const postCanonicalSourceText = vi.fn();
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    render(
      <VSCodeDrawingCanvas
        evaluation={evaluation}
        canvasFocusRef={createRef()}
        postCanonicalSourceText={postCanonicalSourceText}
      />
    );

    const adapter = mocks.hostAdapter;
    if (!adapter) throw new Error("Canvas host adapter was not captured");
    const basePointAction = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    adapter.movePointElementByDelta(basePointAction);
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
    expect(mocks.dispatchCommand).toHaveBeenCalledWith("movePointElementByDelta", basePointAction);
    expect(mocks.dispatchCommand.mock.calls[0]![1].baseElements).toBe(baseElements);

    const pointCommit = { ...basePointAction, commitMode: "commit" as const };
    adapter.movePointElementByDelta(pointCommit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);
    expect(postCanonicalSourceText).toHaveBeenCalledWith(useCadDocumentStore.getState().sourceText);

    const bezierCommit = {
      elementId: baseElements[0]!.id,
      bezierHandleRole: "start" as const,
      dx: 1,
      dy: 2,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "commit" as const,
      baseElements
    };
    adapter.moveBezierHandleByDelta(bezierCommit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand.mock.calls[2]![1].baseElements).toBe(baseElements);
  });
});
