// Task 41: thin CodeMirror adapter over src/scalars/typedVariableQuickFixes.ts.
// This file's only job is applying a descriptor's splice/action to a live
// EditorView - it computes no offsets and re-derives no diagnostic routing
// itself. See docs/typed-variables/tasks/41-typed-variable-quick-fixes.md.

import type { Action } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { DslMajorVersion } from "../dsl/dslVersion";
import type { UpgradeDslMajorVersionResult } from "../state/cadDocumentStore";
import type { TypedVariableQuickFixDescriptor } from "../scalars/typedVariableQuickFixes";
import { sourceEditSession } from "./sourceEditSession";

export type TypedVariableQuickFixActionDeps = {
  isComposing: () => boolean;
  hasPendingText: () => boolean;
  upgradeDslMajorVersion: (target: DslMajorVersion) => UpgradeDslMajorVersionResult;
};

/**
 * Re-checked at apply time, not just at generation time - editor/store state
 * can change between a diagnostic being rendered and the user clicking its
 * Quick Fix button (composition starting, another edit landing, etc.). The
 * full-text snapshot check below (`view.state.doc.toString() ===
 * descriptor.sourceSnapshot`) independently catches any actual text drift;
 * `hasPendingText()` is kept as an explicit, cheap second guard against the
 * buffer having diverged from the last commit even in the rare case its
 * *current* text happens to still equal the snapshot mid-edit.
 */
const canApply = (deps: TypedVariableQuickFixActionDeps): boolean =>
  !deps.isComposing() && !deps.hasPendingText();

const applySplice = (
  view: EditorView,
  action: Extract<TypedVariableQuickFixDescriptor["action"], { kind: "splice" }>
): void => {
  const { from, to, insert, expectedOldText, selection } = action;
  if (to > view.state.doc.length) return;
  if (view.state.doc.sliceString(from, to) !== expectedOldText) return;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: selection } });
  sourceEditSession.flush("command");
};

/**
 * Every action independently re-verifies the *entire* live document still
 * equals the descriptor's own `sourceSnapshot` before touching anything -
 * the splice-range re-check inside `applySplice` runs only after that full-
 * text check has already passed, as an explicit second guard for the
 * specific target range.
 */
export const buildTypedVariableLintActions = (
  deps: TypedVariableQuickFixActionDeps,
  descriptors: readonly TypedVariableQuickFixDescriptor[]
): Action[] =>
  descriptors.map((descriptor) => ({
    name: descriptor.label,
    apply: (view: EditorView) => {
      if (!canApply(deps)) return;
      if (view.state.doc.toString() !== descriptor.sourceSnapshot) return;
      if (descriptor.action.kind === "upgrade-major-version") {
        deps.upgradeDslMajorVersion(descriptor.action.target);
        return;
      }
      applySplice(view, descriptor.action);
    }
  }));
