// Regression coverage for a real Tauri report: Rust-first evaluation
// (useEvaluationEngine.ts) is asynchronous, so ElementName.property
// completion candidates (computedGeometry/effectiveEnabledElementIds-gated)
// can go blank exactly when @ typed-binding completion (compile-time
// bindingAnalysis only) keeps working. This must surface as an explicit
// "pending" state - never a synchronous TS re-evaluation substitute, and
// never a confirmed "no candidates" result - and once evaluation catches up,
// completion must reopen on its own (see
// SourceEditorController.retryElementParameterCompletionIfNewlyCurrent),
// without the user retyping anything.
import { completionStatus, currentCompletions } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { Transaction } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: EditorState & {
      doc: { toString: () => string; length: number };
    };
    dispatch: (spec: unknown) => void;
  };
};

const POLL = { timeout: 1000, interval: 20 };

let nextEvaluationRequestRevision = 1;

const setUp = () => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  nextEvaluationRequestRevision = 1;
};

// `dx: 直線AB.` (empty suffix) is the same shape already proven to compile
// cleanly in cmAutocomplete.test.ts's "elementParameter" describe block - a
// legacy numeric field tolerates a dangling ElementName. reference as an
// (initially unresolved) dependency rather than a fatal parse error.
const buildSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 },
  { id: "ab", name: "直線AB", type: "line", visible: true, enabled: true, startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
  { id: "p", name: "P", type: "offsetPoint", visible: true, enabled: true, fromPoint: { mode: "reference", pointId: "a" }, dx: { kind: "expression", expression: "直線AB." }, dy: 0 }
]);

const lineGeometryFixture = (elementId: string) => ({
  kind: "line" as const,
  elementId,
  name: "直線AB",
  startPointId: null,
  endPointId: null,
  start: { kind: "point" as const, elementId: "a", name: "a", x: 0, y: 0 },
  end: { kind: "point" as const, elementId: "b", name: "b", x: 10, y: 0 },
  length: 10,
  startAngleDeg: 0,
  endAngleDeg: 0,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 0
});

describe("SourceEditorController element-property completion freshness", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  it("shows no candidates while evaluation is pending, then reopens on its own (no retyping) once it becomes current", async () => {
    const source = buildSource();
    useCadDocumentStore.getState().commitText(source, "test");
    const documentState = useCadDocumentStore.getState();
    const abId = documentState.elements.find((element) => element.type === "line")!.id;
    const pos = source.indexOf("直線AB.") + "直線AB.".length;

    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ selection: { anchor: pos } });

    // No evaluation has been published yet at all (appliedEvaluation is
    // still null - evaluationIsCurrent() defaults to false) - typing here
    // must not show candidates, and must not run a synchronous TS
    // re-evaluation as a substitute.
    internals.view.dispatch({
      changes: { from: pos, insert: "l" },
      selection: { anchor: pos + 1 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => internals.view.state.doc.toString().slice(pos, pos + 1), POLL).toBe("l");
    await expect.poll(() => completionStatus(internals.view.state as never), POLL).toBeNull();

    // Evaluation arrives and is current for this document revision.
    controller.setEvaluation({
      evaluation: {
        computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
        computedVariables: new Map(),
        errors: [],
        warnings: [],
        effectiveEnabledElementIds: new Set([abId])
      } as never,
      compiledDocumentRevision: documentState.compiledDocumentRevision,
      evaluationRequestRevision: nextEvaluationRequestRevision++,
      evaluationIsCurrent: true
    });

    // No further keystroke - the retry fired on its own.
    expect(internals.view.state.doc.toString().slice(pos, pos + 1)).toBe("l");
    await expect.poll(() => completionStatus(internals.view.state as never), POLL).toBe("active");
    const labels = currentCompletions(internals.view.state as never).map((option: { label: string }) => option.label);
    expect(labels).toContain("length");

    controller.destroy();
    parent.remove();
  });

  it("does not loop or duplicate: the retry dispatch fires exactly once, only on the pending -> current edge", async () => {
    const source = buildSource();
    useCadDocumentStore.getState().commitText(source, "test");
    const documentState = useCadDocumentStore.getState();
    const abId = documentState.elements.find((element) => element.type === "line")!.id;
    const pos = source.indexOf("直線AB.") + "直線AB.".length;

    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ selection: { anchor: pos } });
    internals.view.dispatch({
      changes: { from: pos, insert: "l" },
      selection: { anchor: pos + 1 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(internals.view.state as never), POLL).toBeNull();

    const evaluation = {
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      effectiveEnabledElementIds: new Set([abId])
    } as never;
    const isRetryDispatch = (spec: unknown) =>
      typeof spec === "object" && spec !== null && "annotations" in spec &&
      (spec as { annotations: { value?: unknown } }).annotations?.value === "input.type";
    const dispatchSpy = vi.spyOn(internals.view, "dispatch");

    // First publish: appliedEvaluation was null (wasCurrent=false), so this
    // is a genuine pending -> current edge - exactly one retry dispatch.
    controller.setEvaluation({
      evaluation,
      compiledDocumentRevision: documentState.compiledDocumentRevision,
      evaluationRequestRevision: nextEvaluationRequestRevision++,
      evaluationIsCurrent: true
    });
    await expect.poll(() => completionStatus(internals.view.state as never), POLL).toBe("active");
    const retryDispatchesAfterFirst = dispatchSpy.mock.calls.filter((call) => isRetryDispatch(call[0])).length;
    expect(retryDispatchesAfterFirst).toBe(1);

    // Second publish with the same currency: wasCurrent is now already true,
    // so retryElementParameterCompletionIfNewlyCurrent's edge guard must
    // return immediately - no additional retry dispatch.
    controller.setEvaluation({
      evaluation,
      compiledDocumentRevision: documentState.compiledDocumentRevision,
      evaluationRequestRevision: nextEvaluationRequestRevision++,
      evaluationIsCurrent: true
    });
    const retryDispatchesAfterSecond = dispatchSpy.mock.calls.filter((call) => isRetryDispatch(call[0])).length;
    expect(retryDispatchesAfterSecond).toBe(1);

    controller.destroy();
    parent.remove();
  });

  it("@ typed-binding completion keeps working while element-property completion is pending", async () => {
    const source = [
      "nui 3",
      "const length: number = 12.3456",
      "point A = coordinate(x: 0 y: 0)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const pos = source.length;

    const parent = document.createElement("div");
    document.body.append(parent);
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    internals.view.dispatch({ selection: { anchor: pos } });
    const insertion = "\nconst test: number = @";
    internals.view.dispatch({
      changes: { from: pos, insert: insertion },
      selection: { anchor: pos + insertion.length },
      annotations: Transaction.userEvent.of("input.type")
    });

    await expect.poll(() => completionStatus(internals.view.state as never), POLL).toBe("active");
    const labels = currentCompletions(internals.view.state as never).map((option: { label: string }) => option.label);
    expect(labels).toContain("length");

    controller.destroy();
    parent.remove();
  });
});
