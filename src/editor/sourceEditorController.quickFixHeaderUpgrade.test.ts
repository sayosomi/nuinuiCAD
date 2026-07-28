import type { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { parseDsl } from "../dsl/dslParser";
import { typedVariableQuickFixes } from "../scalars/typedVariableQuickFixes";
import { buildTypedVariableLintActions, type TypedVariableQuickFixActionDeps } from "./typedVariableQuickFixActions";
import { SourceEditorController } from "./sourceEditorController";

type ControllerInternals = {
  view: {
    state: EditorState;
    dispatch: (spec: unknown) => void;
  };
  protocol: { composing: boolean };
  hasPendingText: () => boolean;
};

// The version-gate error is itself what keeps `store.getState().doc` from
// ever becoming this source's own last-good compile (any error-severity
// diagnostic nulls `document`/`statementMap`, so the store keeps whichever
// earlier document *was* last-good instead) - this fixture only exists to
// exercise that exact case end to end.
const source = ["nui 2", "const x: number = 1"].join("\n");

/** Mirrors exactly how sourceEditorController.ts wires createDiagnosticsExtension's
 * accessors (see its `createDiagnosticsExtension({...})` call) - a real integration
 * test must exercise the same deps shape the production pipeline actually builds,
 * not a hand-picked subset. */
const realActionDeps = (controller: SourceEditorController): TypedVariableQuickFixActionDeps => {
  const internals = controller as unknown as ControllerInternals;
  return {
    isComposing: () => internals.protocol.composing,
    hasPendingText: () => internals.hasPendingText(),
    upgradeDslMajorVersion: (target) => useCadDocumentStore.getState().upgradeDslMajorVersion(target)
  };
};

/** Locates the real "upgrade to nui 3" Quick Fix action by running the same
 * pure descriptor generator + adapter the production linter extension uses
 * (`currentDiagnosticsWithActions`'s own fresh-parse + typedVariableQuickFixes
 * call), against the controller's own live view/store state. */
const findUpgradeAction = (controller: SourceEditorController) => {
  const internals = controller as unknown as ControllerInternals;
  const state = useCadDocumentStore.getState();
  const deps = realActionDeps(controller);
  const liveText = internals.view.state.doc.toString();
  const parsed = parseDsl(liveText);
  const descriptors = typedVariableQuickFixes(liveText, parsed.statements, state.diagnostics);
  const flatIndex = state.diagnostics.findIndex((d) => d.code === "typed-syntax-requires-nui3");
  expect(flatIndex).toBeGreaterThanOrEqual(0);
  const [action] = buildTypedVariableLintActions(deps, descriptors[flatIndex]);
  expect(action).toBeTruthy();
  return { action, view: internals.view, internals };
};

describe("Quick Fix nui2->3 header upgrade - real editor/store path", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    // Individual tests destroy their own controller.
  });

  it("offers the fix even though the version-gate error itself keeps store.doc from being this source's own last-good compile", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    expect(useCadDocumentStore.getState().docText).not.toBe(useCadDocumentStore.getState().sourceText);
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);
    findUpgradeAction(controller); // throws/fails the assertions inside if not found
    controller.destroy();
  });

  it("changes only the nui2->nui3 header digit and leaves the body byte-for-byte identical", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    const { action, view } = findUpgradeAction(controller);
    action.apply(view as never, 0, 0);

    const after = useCadDocumentStore.getState().sourceText;
    expect(after).toBe(["nui 3", "const x: number = 1"].join("\n"));
    // Body (everything after the header line) is untouched.
    expect(after.split("\n").slice(1).join("\n")).toBe(source.split("\n").slice(1).join("\n"));
    // The live CM view is kept in sync with the store by the same commit path
    // every other editor mutation uses.
    expect(view.state.doc.toString()).toBe(after);

    controller.destroy();
  });

  it("is exactly one Undo away from the original nui2 source, and Redo re-applies it", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    const { action, view } = findUpgradeAction(controller);
    action.apply(view as never, 0, 0);
    expect(useCadDocumentStore.getState().sourceText).toBe(["nui 3", "const x: number = 1"].join("\n"));

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);

    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(["nui 3", "const x: number = 1"].join("\n"));

    controller.destroy();
  });

  it("is a complete no-op when the live source has drifted from the descriptor's snapshot (stale)", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    const { action, view } = findUpgradeAction(controller);
    // Simulate drift: another edit landed on the live view after the fix was
    // computed, before the user clicked it.
    view.dispatch({ changes: { from: 0, insert: "# drift\n" } });

    const before = useCadDocumentStore.getState().sourceText;
    action.apply(view as never, 0, 0);
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
    expect(useCadDocumentStore.getState().sourceText).not.toBe(["nui 3", "const x: number = 1"].join("\n"));

    controller.destroy();
  });

  it("is a complete no-op mid-IME-composition", () => {
    useCadDocumentStore.getState().commitText(source, "test");
    const parent = document.createElement("div");
    const controller = new SourceEditorController(parent);

    const { action, view, internals } = findUpgradeAction(controller);
    internals.protocol.composing = true;

    action.apply(view as never, 0, 0);
    expect(useCadDocumentStore.getState().sourceText).toBe(source);

    internals.protocol.composing = false;
    controller.destroy();
  });
});
