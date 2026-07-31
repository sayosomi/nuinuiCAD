import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Dispatches a no-op transaction tagged exactly like a real typed keystroke,
 * so CodeMirror's own autocomplete update-type classification
 * (@codemirror/autocomplete's getUpdateType) schedules a fresh, non-explicit
 * completion query at the current cursor position. Shared by every
 * completion-retry mechanism in this editor (IME composition finalization in
 * cmCompositionCompletionRetry.ts, post-delete context changes in
 * cmDeleteCompletionRetry.ts) so they stay on one dispatch shape instead of
 * drifting.
 */
export const dispatchCompletionRetryTransaction = (view: EditorView): void => {
  view.dispatch({ annotations: Transaction.userEvent.of("input.type") });
};
