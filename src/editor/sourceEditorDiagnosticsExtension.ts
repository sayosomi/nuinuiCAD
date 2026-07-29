import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseDsl } from "../dsl/dslParser";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { DslMajorVersion } from "../dsl/dslVersion";
import type { UpgradeDslMajorVersionResult } from "../state/cadDocumentStore";
import { typedVariableQuickFixes } from "../scalars/typedVariableQuickFixes";
import { buildTypedVariableLintActions } from "./typedVariableQuickFixActions";
import {
  mergeDiagnosticLayers,
  positionedFromDiagnostic,
  toBufferDiagnostics,
  type PositionedDiagnostic
} from "./sourceEditorDiagnostics";

const LINT_DELAY_MS = 50;

export type DiagnosticsExtensionSource = {
  isComposing: () => boolean;
  hasPendingText: () => boolean;
  committedDiagnostics: () => readonly DslDiagnostic[];
  /** Task 48: fresh TS/Rust runtime issues, live-computed on every call - see
   * SourceEditorController.runtimeDiagnostics(). Self-gates to empty while
   * source is dirty/evaluation is stale, so it is safe to merge into both the
   * clean and dirty-buffer branches below without a second dirty check here. */
  runtimeDiagnostics: () => readonly DslDiagnostic[];
  /** Last-committed diagnostics, already remapped through every dirty-buffer change so far. */
  staleBaseline: () => readonly PositionedDiagnostic[];
  upgradeDslMajorVersion: (target: DslMajorVersion) => UpgradeDslMajorVersionResult;
};

const toCmDiagnostic = (diagnostic: PositionedDiagnostic, actions?: Diagnostic["actions"]): Diagnostic => ({
  from: diagnostic.from,
  to: diagnostic.to,
  severity: diagnostic.severity,
  message: diagnostic.message,
  markClass: diagnostic.origin === "stale" ? "cm-diagnostic-stale" : "cm-diagnostic-current",
  ...(actions && actions.length > 0 ? { actions } : {})
});

const toCmDiagnostics = (positioned: readonly PositionedDiagnostic[]): Diagnostic[] =>
  positioned.map((diagnostic) => toCmDiagnostic(diagnostic));

/**
 * Builds diagnostics for the clean (`!hasPendingText()`) case with Quick Fix
 * actions attached.
 *
 * Statements come from a *fresh* `parseDsl(view.state.doc.toString())` here,
 * never from `store.getState().doc.statements` - `state.doc` is the
 * last-*good* compiled document, and every one of the diagnostic codes this
 * module offers a fix for (`typed-syntax-requires-nui3`,
 * `missing-declared-type`, `invalid-choice-literal`, `scalar-type-mismatch`,
 * `unexpected-token`, `element-state-conflict`) is itself an error-severity
 * diagnostic - `compileDslDocument` nulls `document`/`statementMap` (so the
 * store keeps the *previous* `doc`) for any error-severity diagnostic
 * anywhere in the source. So precisely when one of these diagnostics is
 * present, `state.doc.statements` reflects an older source that may not even
 * contain the offending statement. `state.diagnostics` itself has no such
 * gate - it is always the current `sourceText`'s own diagnostics - so a
 * fresh, cheap `parseDsl` call (the same call the dirty-buffer branch below
 * already makes on every keystroke) is the only way to get statements that
 * actually correspond to those diagnostics.
 */
export const currentDiagnosticsWithActions = (
  view: EditorView,
  source: Pick<DiagnosticsExtensionSource, "committedDiagnostics" | "runtimeDiagnostics" | "isComposing" | "hasPendingText" | "upgradeDslMajorVersion">
): Diagnostic[] => {
  const diagnostics = source.committedDiagnostics();
  const parsed = parseDsl(view.state.doc.toString());
  const descriptorsByIndex = typedVariableQuickFixes(view.state.doc.toString(), parsed.statements, diagnostics);
  const actionDeps = {
    isComposing: source.isComposing,
    hasPendingText: source.hasPendingText,
    upgradeDslMajorVersion: source.upgradeDslMajorVersion
  };
  const results: Diagnostic[] = [];
  diagnostics.forEach((diagnostic, index) => {
    const positioned = positionedFromDiagnostic(view.state.doc, diagnostic, "current");
    if (!positioned) return;
    const descriptors = descriptorsByIndex[index] ?? [];
    const actions = descriptors.length > 0 ? buildTypedVariableLintActions(actionDeps, descriptors) : undefined;
    results.push(toCmDiagnostic(positioned, actions));
  });
  // Task 48: runtime diagnostics never offer a Quick Fix (there is no source
  // edit that fixes a runtime value) and are positioned straight from their
  // own already-exact physicalSpan - exactSpanOnly diagnostics without one
  // are dropped by positionedFromDiagnostic's caller contract here, never
  // shown at a coarser/wrong position.
  for (const diagnostic of source.runtimeDiagnostics()) {
    const positioned = positionedFromDiagnostic(view.state.doc, diagnostic, "current");
    if (positioned) results.push(toCmDiagnostic(positioned));
  }
  return results;
};

/**
 * Builds the diagnostics linter extension. During IME composition the source
 * function returns the previously computed result unchanged rather than
 * re-parsing a mid-composition buffer.
 */
export const createDiagnosticsExtension = (source: DiagnosticsExtensionSource): Extension => {
  let lastResult: Diagnostic[] = [];
  return linter((view) => {
    if (source.isComposing()) return lastResult;
    if (!source.hasPendingText()) {
      lastResult = currentDiagnosticsWithActions(view, source);
      return lastResult;
    }
    const parsed = parseDsl(view.state.doc.toString());
    const current = toBufferDiagnostics(view.state.doc, parsed.diagnostics);
    const stale = source.staleBaseline();
    const runtimeCurrent = source.runtimeDiagnostics()
      .map((diagnostic) => positionedFromDiagnostic(view.state.doc, diagnostic, "current"))
      .filter((positioned): positioned is PositionedDiagnostic => positioned !== null);
    lastResult = toCmDiagnostics(mergeDiagnosticLayers([...current, ...runtimeCurrent], stale));
    return lastResult;
  }, { delay: LINT_DELAY_MS });
};
