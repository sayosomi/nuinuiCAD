import { completionStatus, currentCompletions, closeCompletion } from "@codemirror/autocomplete";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { dslAutocompleteExtension } from "./cmAutocomplete";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import {
  createScopeBodyRangeIndex,
  createTypedDeclarationRangeIndex,
  mapScopeBodyRangeIndex,
  mapTypedDeclarationRangeIndex
} from "./statementRangeIndex";

// cmDeleteCompletionRetry.ts (Task 51 manual E2E rerun) is deliberately
// context-kind-agnostic: it never branches on which completion kind is at
// play, only on whether the production completion source itself would offer
// a candidate. This file exercises the shared retry contract itself across
// more than one completion kind (a choice value here, a generic keyword
// context for the "no candidates"/"already open" cases) rather than
// duplicating cmAutocomplete.ts's own per-kind coverage. set target
// completion's own delete-repro fixture lives in cmAutocomplete.test.ts
// alongside the rest of Task 40's coverage.

const baseOptions = () => ({
  elements: () => [] as never[],
  statementRanges: () => new Map(),
  computedVariables: () => undefined,
  computedGeometry: () => undefined,
  effectiveEnabledElementIds: () => undefined,
  evaluationErrors: () => undefined,
  bindingAnalysis: () => undefined,
  typedDeclarationRanges: () => new Map(),
  scopeBodyRanges: () => [],
  statementInfoByElementId: () => undefined
});

const createView = (source: string, isComposing: () => boolean = () => false) => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: source,
      extensions: dslAutocompleteExtension({ ...baseOptions(), isComposing })
    }),
    parent
  });
  return { view, parent };
};

describe("cmDeleteCompletionRetry (Task 51 manual E2E rerun)", () => {
  it("reopens a choice value's own candidates after a real delete lands the cursor at a zero-length value, with no explicit invocation", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "line Off = offset(sources: [AB], distance: 3, side: right, closed: false)"
    ].join("\n");
    const { view, parent } = createView(source);

    const rightStart = source.indexOf("right");
    const rightEnd = rightStart + "right".length;
    view.dispatch({
      changes: { from: rightStart, to: rightEnd },
      selection: { anchor: rightStart },
      annotations: Transaction.userEvent.of("delete.selection")
    });

    // No startCompletion(view) call here on purpose - the shared delete
    // retry mechanism must reopen this on its own now, unlike before Task 51's
    // rerun (see cmAutocomplete.test.ts's own explicit-startCompletion version
    // of this exact repro, kept alongside as its own regression anchor).
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["right", "left"]);
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete").length).toBe(1);

    view.destroy();
    parent.remove();
  });

  it("never opens a popup for a delete that lands on a position with no completion context", async () => {
    const source = ["nui 4", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const { view, parent } = createView(source);

    // Deletes the version digit: "nui 4" -> "nui " has no keyword, call,
    // declaration, set, || element-statement context at all.
    const versionDigit = source.indexOf("4");
    view.dispatch({
      changes: { from: versionDigit, to: versionDigit + 1 },
      selection: { anchor: versionDigit },
      annotations: Transaction.userEvent.of("delete.selection")
    });

    // Give the (would-be) retry's async probe && CM's own debounce every
    // chance to fire, then assert nothing ever opened.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBeNull();
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete").length).toBe(0);

    view.destroy();
    parent.remove();
  });

  it("keeps a single tooltip, never a duplicate, when a delete lands on a position that still has candidates", async () => {
    const { view, parent } = createView("");

    // Opens the line-head keyword popup by typing two characters, then
    // narrows it back down to one by deleting the second - "s" alone is
    // still a valid, non-empty-matching keyword prefix throughout, so a
    // completion is active both immediately before && immediately after
    // the delete transaction the retry mechanism reacts to.
    view.dispatch({
      changes: { from: 0, insert: "se" },
      selection: { anchor: 2 },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");

    view.dispatch({
      changes: { from: 1, to: 2 },
      selection: { anchor: 1 },
      annotations: Transaction.userEvent.of("delete.backward")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    expect(currentCompletions(view.state).map((option) => option.label)).toContain("set");
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete").length).toBe(1);

    view.destroy();
    parent.remove();
  });

  it("never retries while IME composition is active", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "line Off = offset(sources: [AB], distance: 3, side: right, closed: false)"
    ].join("\n");
    const { view, parent } = createView(source, () => true);

    const rightStart = source.indexOf("right");
    const rightEnd = rightStart + "right".length;
    view.dispatch({
      changes: { from: rightStart, to: rightEnd },
      selection: { anchor: rightStart },
      annotations: Transaction.userEvent.of("delete.selection")
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBeNull();

    view.destroy();
    parent.remove();
  });

  it("only ever produces one tooltip for one delete transaction (no duplicate/reopen loop)", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "line Off = offset(sources: [AB], distance: 3, side: right, closed: false)"
    ].join("\n");
    const { view, parent } = createView(source);

    const rightStart = source.indexOf("right");
    const rightEnd = rightStart + "right".length;
    view.dispatch({
      changes: { from: rightStart, to: rightEnd },
      selection: { anchor: rightStart },
      annotations: Transaction.userEvent.of("delete.selection")
    });

    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    // Settle well past the retry's microtask probe && CM's own query debounce,
    // then confirm the popup never doubled up || flickered into a second node.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBe("active");
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete").length).toBe(1);

    view.destroy();
    parent.remove();
  });
});

describe("cmDeleteCompletionRetry only fires for a real user delete origin (blocking review fix)", () => {
  // A blocking review found that gating purely on ChangeSet shape ("did
  // this transaction remove characters") misfires for undo: undoing an
  // insertion also shortens the document, but it is never a user delete
  // gesture. isRealUserDeleteTransaction (cmDeleteCompletionRetry.ts) now
  // additionally requires transaction.isUserEvent("delete") - a real repro
  // ("set " -> type "total" -> undo back to "set ") must never reopen the
  // popup on its own from that undo.
  const buildSetTargetView = () => {
    // A committed document must be a fully valid nui 4 source (an
    // incomplete "set " target has error diagnostics && never compiles) -
    // so this commits a complete "set total = 99" line, exactly like the
    // real duplicate-line repro, then reaches the zero-length "set " state
    // through a real, live delete transaction before the undo/redo/
    // programmatic-change scenarios below take over from there.
    const committedSource = [
      "nui 4",
      "let flag: boolean = true",
      "let total: number = 0",
      "let show: boolean = false",
      "const limit: number = 10",
      "if (@flag) {",
      "} else {",
      "  set total = 99",
      "}"
    ].join("\n");
    const statements = parseDsl(committedSource).statements;
    const assignedStatementIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const compiled = compileDslDocument(committedSource, { assignedStatementIds });
    expect(compiled.document).not.toBeNull();
    expect(compiled.statementMap).not.toBeNull();
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

    const committedDoc = EditorState.create({ doc: committedSource }).doc;
    let liveTypedDeclarationRanges = createTypedDeclarationRangeIndex(committedDoc, compiled.statementMap!);
    let liveScopeBodyRanges = compiled.bindingAnalysis
      ? createScopeBodyRangeIndex(committedDoc, compiled.statementMap!, compiled.bindingAnalysis.catalog.scopeIndex)
      : [];

    const setLine = committedSource.indexOf("  set total = 99");
    const targetPos = setLine + "  set ".length;
    const targetEnd = setLine + "  set total = 99".length;
    const parent = document.createElement("div");
    document.body.append(parent);
    // jsdom has no real text-layout engine; CM's own scrollIntoView-driven
    // measurement (undo/redo's own dispatches set scrollIntoView: true)
    // otherwise throws asynchronously after teardown. Matches the same stub
    // cmAutocomplete.test.ts's own live-EditorView tests already use.
    Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    const view = new EditorView({
      state: EditorState.create({
        doc: committedSource,
        selection: { anchor: targetPos },
        extensions: [
          history(),
          dslAutocompleteExtension({
            ...baseOptions(),
            isComposing: () => false,
            bindingAnalysis: () => compiled.bindingAnalysis,
            typedDeclarationRanges: () => liveTypedDeclarationRanges,
            scopeBodyRanges: () => liveScopeBodyRanges
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            liveTypedDeclarationRanges = mapTypedDeclarationRangeIndex(liveTypedDeclarationRanges, update.changes);
            liveScopeBodyRanges = mapScopeBodyRangeIndex(liveScopeBodyRanges, update.changes);
          })
        ]
      }),
      parent
    });

    // Real user delete, reaching "set |" exactly like the manual repro -
    // this is not itself under test here, only the starting point for it.
    view.dispatch({
      changes: { from: targetPos, to: targetEnd },
      selection: { anchor: targetPos },
      annotations: Transaction.userEvent.of("delete.selection")
    });
    closeCompletion(view);
    return { view, parent, targetPos };
  };

  it("does not reopen the popup when undo removes text back down to a completable zero-length target", async () => {
    const { view, parent, targetPos } = buildSetTargetView();

    view.dispatch({
      changes: { from: targetPos, insert: "total" },
      selection: { anchor: targetPos + "total".length },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    closeCompletion(view);
    expect(completionStatus(view.state)).toBeNull();

    undo(view);
    expect(view.state.doc.toString().slice(targetPos - 6, targetPos)).toBe("  set ");
    expect(view.state.selection.main.head).toBe(targetPos);

    // No further input, and no explicit invocation: a real user delete would
    // reopen this (see the "reopens..." test above), but an undo must not.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBeNull();
    expect(parent.querySelectorAll(".cm-tooltip-autocomplete").length).toBe(0);

    view.destroy();
    parent.remove();
  });

  it("does not misfire the delete retry when redo reinserts text after that undo", async () => {
    const { view, parent, targetPos } = buildSetTargetView();

    view.dispatch({
      changes: { from: targetPos, insert: "total" },
      selection: { anchor: targetPos + "total".length },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    closeCompletion(view);
    undo(view);
    await new Promise((resolve) => setTimeout(resolve, 100));

    redo(view);
    expect(view.state.doc.toString().slice(targetPos, targetPos + "total".length)).toBe("total");

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBeNull();

    view.destroy();
    parent.remove();
  });

  it("does not fire for a programmatic transaction that removes text without a delete-origin userEvent", async () => {
    const { view, parent, targetPos } = buildSetTargetView();

    view.dispatch({
      changes: { from: targetPos, insert: "total" },
      selection: { anchor: targetPos + "total".length },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    closeCompletion(view);
    expect(completionStatus(view.state)).toBeNull();

    // No userEvent annotation at all - the shape a model-patch/source-sync/
    // reset transaction takes in this editor (see sourceEditorController.ts's
    // own modelPatchOrigin/resetOrigin-tagged dispatches), never "delete".
    view.dispatch({
      changes: { from: targetPos, to: targetPos + "total".length },
      selection: { anchor: targetPos }
    });
    expect(view.state.doc.toString().slice(targetPos - 6, targetPos)).toBe("  set ");

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(completionStatus(view.state)).toBeNull();

    view.destroy();
    parent.remove();
  });

  it("still reopens automatically for a real user delete, unaffected by the origin gate", async () => {
    const { view, parent, targetPos } = buildSetTargetView();

    view.dispatch({
      changes: { from: targetPos, insert: "total" },
      selection: { anchor: targetPos + "total".length },
      annotations: Transaction.userEvent.of("input.type")
    });
    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    closeCompletion(view);

    view.dispatch({
      changes: { from: targetPos, to: targetPos + "total".length },
      selection: { anchor: targetPos },
      annotations: Transaction.userEvent.of("delete.selection")
    });

    await expect.poll(() => completionStatus(view.state), { timeout: 500, interval: 20 }).toBe("active");
    const labels = currentCompletions(view.state).map((option) => option.label);
    expect(labels).toEqual(expect.arrayContaining(["flag", "total", "show"]));
    expect(labels).not.toContain("limit");

    view.destroy();
    parent.remove();
  });
});
