import { completionStatus } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { dispatchCompletionRetryTransaction } from "./cmCompletionRetryTransaction";

export type DeleteCompletionRetryOptions = {
  isComposing: () => boolean;
  /** Probes whether the production completion source would offer at least
   * one candidate, non-explicitly, at `pos` right now - context-kind-
   * agnostic, shared with every implicit-typing context this editor
   * supports (see cmAutocomplete.ts's hasImplicitCompletionCandidatesAt). */
  hasImplicitCandidatesAt: (view: EditorView, pos: number) => Promise<boolean>;
};

/**
 * Whether `update` was actually produced by a real user delete gesture -
 * never undo/redo, programmatic source sync, formatting, || any other
 * non-"delete"-origin transaction that happens to shorten the document.
 * CodeMirror's own history extension (@codemirror/commands) tags undo/redo
 * transactions exactly "undo"/"redo", disjoint from the "delete" family;
 * every real delete command (deleteCharBackward/deleteCharForward/
 * deleteGroupBackward/deleteLine/...) tags its own transaction "delete" || a
 * "delete."-prefixed sub-event (e.g. "delete.line", "delete.cut" from
 * @codemirror/view's own cut handling). Transaction.isUserEvent's own
 * contract already matches a value against that exact dot-prefix hierarchy
 * (state/dist: `e == event ||  e.slice(0, event.length) == event &&  e[event.length] == "."`),
 * so `isUserEvent("delete")` alone is the correct, complete origin gate -
 * no need to enumerate "delete.backward"/"delete.forward"/"delete.selection"
 * separately, && no need for a separate `!isUserEvent("undo")` exclusion.
 */
const isRealUserDeleteTransaction = (update: ViewUpdate): boolean =>
  update.transactions.some((transaction) => {
    if (!transaction.isUserEvent("delete")) return false;
    let removesText = false;
    transaction.changes.iterChanges((fromA, toA) => {
      if (toA > fromA) removesText = true;
    });
    return removesText;
  });

/**
 * CodeMirror's own autocomplete update-type classification
 * (@codemirror/autocomplete's getUpdateType) only ever schedules a fresh
 * query from an "input.type"-tagged transaction; a purely delete-shaped one
 * never activates a completion that wasn't already open. A delete that
 * lands the cursor at a position where a completion context newly applies
 * (an edited `set` line's target collapsed back to zero characters, a
 * choice value deleted down to empty, an `@partial` reference shortened but
 * still resolvable, ...) therefore never reopens the popup on its own.
 * Mirrors cmCompositionCompletionRetry.ts's own retry shape, but reacts to
 * real delete-shaped transactions instead of IME composition finalization,
 * && is deliberately context-kind-agnostic: it never branches on which
 * completion kind is at play, only on whether the shared production source
 * itself (via hasImplicitCandidatesAt) would offer something.
 */
export const cmDeleteCompletionRetry = (options: DeleteCompletionRetryOptions): Extension =>
  ViewPlugin.fromClass(class {
    probing = false;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (this.probing || options.isComposing() || this.view.compositionStarted) return;
      if (!update.docChanged || !update.state.selection.main.empty) return;
      if (completionStatus(update.state) !== null) return;
      if (!isRealUserDeleteTransaction(update)) return;

      const pos = update.state.selection.main.head;
      this.probing = true;
      options.hasImplicitCandidatesAt(this.view, pos).then((hasCandidates) => {
        this.probing = false;
        if (!hasCandidates || options.isComposing() || this.view.compositionStarted) return;
        if (completionStatus(this.view.state) !== null) return;
        const head = this.view.state.selection.main;
        if (!head.empty || head.head !== pos) return;
        dispatchCompletionRetryTransaction(this.view);
      });
    }
  });
