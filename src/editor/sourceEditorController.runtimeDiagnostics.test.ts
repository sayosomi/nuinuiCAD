// Task 48 correction: controller-level integration tests for
// runtimeDiagnostics() freshness (including the live, uncommitted CM buffer)
// and the forceLinting-on-evaluation-apply hook. Mirrors
// sourceEditorController.typedSpanNavigation.test.ts's harness conventions.
import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BindingId } from "../scalars/bindingCatalog";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: EditorState & {
      doc: { toString: () => string; length: number };
      selection: { main: { head: number; from: number; to: number; empty: boolean } };
    };
    dispatch: (spec: unknown) => void;
  };
};

const setUp = () => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
};

const typedBindingId = (name: string): BindingId =>
  useCadDocumentStore
    .getState()
    .doc.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === name)!.id;

// Monotonic, never Date.now() - two publishes in the same test can land in
// the same millisecond, which would make setEvaluation's own de-dup guard
// (evaluationRequestRevision must strictly increase) silently drop the second one.
let nextEvaluationRequestRevision = 1;

const publishError = (controller: SourceEditorController, bindingId: BindingId, issueCode: string) => {
  controller.setEvaluation({
    evaluation: {
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedScalarBindings: new Map([[bindingId, { status: "error", type: { kind: "number" }, issueCode }]])
    },
    compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
    evaluationRequestRevision: nextEvaluationRequestRevision++
  });
};

const publishOk = (controller: SourceEditorController, bindingId: BindingId) => {
  controller.setEvaluation({
    evaluation: {
      computedGeometry: new Map(),
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedScalarBindings: new Map([[bindingId, { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } }]])
    },
    compiledDocumentRevision: useCadDocumentStore.getState().compiledDocumentRevision,
    evaluationRequestRevision: nextEvaluationRequestRevision++
  });
};

describe("SourceEditorController Task 48 correction: runtimeDiagnostics() live-buffer dirty check", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 3", "const x: number = 1"].join("\n");

  it("reports a fresh runtime error once published", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const bindingId = typedBindingId("x");

    publishError(controller, bindingId, "poisoned-binding");

    expect(controller.runtimeDiagnostics()).toHaveLength(1);
    controller.destroy();
  });

  it("hides the error immediately once the live buffer has an uncommitted edit, before any debounce commit", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("x");
    publishError(controller, bindingId, "poisoned-binding");
    expect(controller.runtimeDiagnostics()).toHaveLength(1);
    expect(diagnosticCount(internals.view.state)).toBe(1);

    // A single uncommitted keystroke - the store's docText/sourceText have
    // not been touched at all yet.
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "0" } });

    expect(controller.runtimeDiagnostics()).toEqual([]);
    // This is the real CodeMirror diagnostic state backing the gutter, not
    // only the controller getter. It must clear synchronously instead of
    // waiting for the linter's delayed pass or a source commit.
    expect(diagnosticCount(internals.view.state)).toBe(0);
    controller.destroy();
  });

  it("shows nothing at any point during a dirty edit - never a one-frame stale flash", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("x");
    publishError(controller, bindingId, "poisoned-binding");

    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "0" } });
    expect(controller.runtimeDiagnostics()).toEqual([]);
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "1" } });
    expect(controller.runtimeDiagnostics()).toEqual([]);
    controller.destroy();
  });

  it("reappears once the pending edit is reverted back to the committed text and the evaluation is still fresh", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("x");
    publishError(controller, bindingId, "poisoned-binding");
    const originalLength = internals.view.state.doc.length;

    internals.view.dispatch({ changes: { from: originalLength, insert: "0" } });
    expect(controller.runtimeDiagnostics()).toEqual([]);
    // Revert - the buffer now matches the committed source exactly again.
    internals.view.dispatch({ changes: { from: originalLength, to: originalLength + 1, insert: "" } });

    expect(controller.runtimeDiagnostics()).toHaveLength(1);
    controller.destroy();
  });
});

describe("SourceEditorController Task 48 correction: forceLinting on evaluation apply", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 3", "const x: number = 1"].join("\n");

  it("re-runs the linter so a fresh runtime error appears in CodeMirror's own diagnostic state without any doc change", async () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("x");
    expect(diagnosticCount(internals.view.state)).toBe(0);

    publishError(controller, bindingId, "poisoned-binding");
    // forceLinting's own source-function call resolves through a microtask
    // even for a synchronous linter source, so the resulting setDiagnostics
    // transaction lands one tick later - proving the gutter itself (not just
    // the pure runtimeDiagnostics() getter) picked up the fresh error
    // without any doc change is still the point of this test.
    await vi.waitFor(() => expect(diagnosticCount(internals.view.state)).toBeGreaterThan(0));
    controller.destroy();
  });

  it("re-runs the linter again on recovery, removing the marker from CodeMirror's own diagnostic state", async () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("x");
    publishError(controller, bindingId, "poisoned-binding");
    await vi.waitFor(() => expect(diagnosticCount(internals.view.state)).toBeGreaterThan(0));

    publishOk(controller, bindingId);

    await vi.waitFor(() => expect(diagnosticCount(internals.view.state)).toBe(0));
    controller.destroy();
  });

  it("poison -> recovery -> re-poison: only the latest state is ever shown, never a stale intermediate one", async () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("x");

    publishError(controller, bindingId, "poisoned-binding");
    await vi.waitFor(() => expect(diagnosticCount(internals.view.state)).toBe(1));

    publishOk(controller, bindingId);
    await vi.waitFor(() => expect(diagnosticCount(internals.view.state)).toBe(0));

    publishError(controller, bindingId, "evaluation-divide-by-zero");
    await vi.waitFor(() => {
      expect(diagnosticCount(internals.view.state)).toBe(1);
      let message = "";
      forEachDiagnostic(internals.view.state, (diagnostic) => { message = diagnostic.message; });
      expect(message).toBe("0での除算が発生しました。");
    });
    controller.destroy();
  });

  it("keeps compile-time BindingIssue diagnostics while directly replacing runtime diagnostics", () => {
    const bindingIssueSource = ["nui 3", "const missing: number = @notFound", "const y: number = 1"].join("\n");
    useCadDocumentStore.getState().commitText(bindingIssueSource, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("y");

    publishError(controller, bindingId, "poisoned-binding");
    expect(diagnosticCount(internals.view.state)).toBe(2);

    publishOk(controller, bindingId);
    // The runtime marker is gone, while the non-gating BindingIssue remains.
    expect(diagnosticCount(internals.view.state)).toBe(1);
    let message = "";
    forEachDiagnostic(internals.view.state, (diagnostic) => { message = diagnostic.message; });
    expect(message).toContain("未定義の変数");
    controller.destroy();
  });

  it("uses the dirty-buffer layer when an evaluation arrives during an edit, never restoring a shifted BindingIssue marker", () => {
    const bindingIssueSource = ["nui 3", "const missing: number = @notFound", "const y: number = 1"].join("\n");
    useCadDocumentStore.getState().commitText(bindingIssueSource, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const bindingId = typedBindingId("y");

    publishError(controller, bindingId, "poisoned-binding");
    expect(diagnosticCount(internals.view.state)).toBe(2);

    // A leading blank line preserves valid syntax while shifting every
    // committed physical span. The direct evaluation refresh must use the
    // dirty parser/remapped layer rather than project the old @notFound span.
    internals.view.dispatch({ changes: { from: 0, insert: "\n" } });
    expect(diagnosticCount(internals.view.state)).toBe(0);

    publishError(controller, bindingId, "evaluation-divide-by-zero");
    expect(diagnosticCount(internals.view.state)).toBe(0);
    controller.destroy();
  });
});

describe("SourceEditorController Task 48 correction: selectSourceSpan", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const source = ["nui 3", "const x: number = @missing"].join("\n");

  const selectedText = (internals: ControllerInternals) => {
    const main = internals.view.state.selection.main;
    return internals.view.state.doc.toString().slice(main.from, main.to);
  };

  it("selects exactly the given exact span and focuses the editor", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const from = text.indexOf("@missing");
    const to = from + "@missing".length;
    const sourceRevision = useCadDocumentStore.getState().doc.statementMap.sourceRevision;

    const result = controller.selectSourceSpan({ segments: [{ from, to }], sourceRevision });

    expect(result).toBe(true);
    expect(selectedText(internals)).toBe("@missing");
    controller.destroy();
  });

  it("no-ops while the buffer has an uncommitted edit (dirty), never selecting a possibly-shifted position", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const from = text.indexOf("@missing");
    const to = from + "@missing".length;
    const sourceRevision = useCadDocumentStore.getState().doc.statementMap.sourceRevision;
    const before = internals.view.state.selection.main.head;
    internals.view.dispatch({ changes: { from: internals.view.state.doc.length, insert: "0" } });

    const result = controller.selectSourceSpan({ segments: [{ from, to }], sourceRevision });

    expect(result).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });

  it("no-ops when the span's sourceRevision no longer matches the current compiled document", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const from = text.indexOf("@missing");
    const to = from + "@missing".length;
    const staleRevision = useCadDocumentStore.getState().doc.statementMap.sourceRevision - 1;
    const before = internals.view.state.selection.main.head;

    const result = controller.selectSourceSpan({ segments: [{ from, to }], sourceRevision: staleRevision });

    expect(result).toBe(false);
    expect(internals.view.state.selection.main.head).toBe(before);
    controller.destroy();
  });

  it("does not select while composing", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const content = parent.querySelector(".cm-content")!;
    const text = (controller as unknown as ControllerInternals).view.state.doc.toString();
    const from = text.indexOf("@missing");
    const to = from + "@missing".length;
    const sourceRevision = useCadDocumentStore.getState().doc.statementMap.sourceRevision;
    fireEvent.compositionStart(content);

    expect(controller.selectSourceSpan({ segments: [{ from, to }], sourceRevision })).toBe(false);

    fireEvent.compositionEnd(content);
    controller.destroy();
  });
});

describe("SourceEditorController Task 48 correction: end-to-end BindingIssue Problems navigation", () => {
  beforeEach(setUp);
  afterEach(() => vi.restoreAllMocks());

  const selectedText = (internals: ControllerInternals) => {
    const main = internals.view.state.selection.main;
    return internals.view.state.doc.toString().slice(main.from, main.to);
  };

  it("an undefined-binding Problems row selects exactly the `@missing` reference, using real production diagnostics", async () => {
    const { bindingIssuesToDiagnostics } = await import("../scalars/bindingIssueDiagnostics");
    const source = ["nui 3", "const x: number = @missing"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const state = useCadDocumentStore.getState();
    const diagnostics = bindingIssuesToDiagnostics(state.doc.bindingAnalysis!, state.doc.statements, state.doc.spans);
    const diagnostic = diagnostics.find((item) => item.code === "undefined-binding")!;
    expect(diagnostic.navigationTarget?.kind).toBe("sourceSpan");

    const target = diagnostic.navigationTarget as { kind: "sourceSpan"; physicalSpan: NonNullable<typeof diagnostic.physicalSpan> };
    const result = controller.selectSourceSpan(target.physicalSpan);

    expect(result).toBe(true);
    expect(selectedText(internals)).toBe("@missing");
    controller.destroy();
  });

  it("a duplicate-binding Problems row (declaration-origin) jumps to the matching declaration, not a reference", () => {
    const source = ["nui 3", "const x: number = 1", "const x: number = 2"].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    const internals = controller as unknown as ControllerInternals;
    const text = internals.view.state.doc.toString();
    const secondDeclarationOffset = text.lastIndexOf("const x: number = 2");

    const secondBindingId = useCadDocumentStore
      .getState()
      .doc.bindingAnalysis!.catalog.bindings.filter((binding) => binding.kind === "typed" && binding.name === "x")[1].id;

    const result = controller.jumpToBindingDeclaration(secondBindingId);

    expect(result).toBe(true);
    expect(internals.view.state.selection.main.head).toBe(secondDeclarationOffset);
    controller.destroy();
  });
});
