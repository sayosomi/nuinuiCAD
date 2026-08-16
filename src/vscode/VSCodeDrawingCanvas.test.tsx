import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
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

const makeEvaluationState = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationRequestRevision: number,
  overrides: Partial<EvaluationEngineState> = {}
): EvaluationEngineState => ({
  evaluation,
  evaluationRevision: evaluationRequestRevision,
  evaluationRequestRevision,
  mode: "rust" as EvaluationEngineState["mode"],
  source: "rust",
  status: "evaluating",
  rustEligible: true,
  isStale: false,
  error: null,
  ...overrides
});

const renderCanvas = (
  evaluation: ReturnType<typeof emptyEvaluationResult>,
  evaluationState: EvaluationEngineState | undefined,
  postCanonicalSourceText = vi.fn()
) => {
  const view = render(
    <VSCodeDrawingCanvas
      evaluation={evaluation}
      evaluationState={evaluationState}
      canvasFocusRef={createRef()}
      postCanonicalSourceText={postCanonicalSourceText}
    />
  );
  const adapter = mocks.hostAdapter;
  if (!adapter) throw new Error("Canvas host adapter was not captured");
  return { view, adapter, postCanonicalSourceText };
};

describe("VSCodeDrawingCanvas adapter", () => {
  it("keeps preview mutations in the Webview and sends one canonical source after each commit", () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const postCanonicalSourceText = vi.fn();
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const { adapter } = renderCanvas(evaluation, undefined, postCanonicalSourceText);
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

  it("coalesces preview actions until the current evaluation settles", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const evaluating = makeEvaluationState(evaluation, 1);
    const { view, adapter } = renderCanvas(evaluation, evaluating);
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const intermediate = { ...first, dx: 2 };
    const latest = { ...first, dx: 3 };

    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(intermediate);
    adapter.movePointElementByDelta(latest);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", latest);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("movePointElementByDelta", intermediate);
  });

  it("does not flush for stale evaluation and flushes the latest action after current settlement", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const { view, adapter } = renderCanvas(evaluation, makeEvaluationState(evaluation, 1));
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const latest = { ...first, dx: 4 };
    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(latest);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready", isStale: true })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 3, { status: "failed" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={vi.fn()}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", latest);
  });

  it("bypasses the scheduler for canonical commits and drops pending preview", async () => {
    mocks.dispatchCommand.mockReturnValue({ status: "applied" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const postCanonicalSourceText = vi.fn();
    const { view, adapter } = renderCanvas(
      evaluation,
      makeEvaluationState(evaluation, 1),
      postCanonicalSourceText
    );
    const first = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    const pending = { ...first, dx: 2 };
    const commit = { ...first, dx: 3, commitMode: "commit" as const };
    adapter.movePointElementByDelta(first);
    adapter.movePointElementByDelta(pending);
    adapter.movePointElementByDelta(commit);
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).toHaveBeenLastCalledWith("movePointElementByDelta", commit);
    expect(postCanonicalSourceText).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(
        <VSCodeDrawingCanvas
          evaluation={evaluation}
          evaluationState={makeEvaluationState(evaluation, 2, { status: "ready" })}
          canvasFocusRef={createRef()}
          postCanonicalSourceText={postCanonicalSourceText}
        />
      );
      await Promise.resolve();
    });
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchCommand).not.toHaveBeenCalledWith("movePointElementByDelta", pending);
  });

  it("does not hand off source text for a rejected canonical commit", () => {
    mocks.dispatchCommand
      .mockReturnValueOnce({ status: "applied" })
      .mockReturnValueOnce({ status: "rejected" });
    const baseElements = useCadDocumentStore.getState().elements;
    const evaluation = emptyEvaluationResult(baseElements);
    const postCanonicalSourceText = vi.fn();
    const { adapter } = renderCanvas(evaluation, undefined, postCanonicalSourceText);
    const preview = {
      elementId: baseElements[0]!.id,
      dx: 1,
      dy: 0,
      angleLocked: false,
      distanceLocked: false,
      commitMode: "preview" as const,
      baseElements
    };
    adapter.movePointElementByDelta(preview);
    adapter.movePointElementByDelta({ ...preview, commitMode: "commit" });
    expect(postCanonicalSourceText).not.toHaveBeenCalled();
  });
});
