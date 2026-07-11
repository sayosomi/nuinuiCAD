import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { parseDsl } from "../dsl/dslParser";
import type { DslDiagnostic } from "../dsl/dslTypes";
import {
  mergeDiagnosticLayers,
  toBufferDiagnostics,
  type PositionedDiagnostic
} from "./sourceEditorDiagnostics";

const LINT_DELAY_MS = 50;

export type DiagnosticsExtensionSource = {
  isComposing: () => boolean;
  hasPendingText: () => boolean;
  committedDiagnostics: () => readonly DslDiagnostic[];
  /** Last-committed diagnostics, already remapped through every dirty-buffer change so far. */
  staleBaseline: () => readonly PositionedDiagnostic[];
};

const toCmDiagnostics = (positioned: readonly PositionedDiagnostic[]): Diagnostic[] =>
  positioned.map((diagnostic) => ({
    from: diagnostic.from,
    to: diagnostic.to,
    severity: diagnostic.severity,
    message: diagnostic.message,
    markClass: diagnostic.origin === "stale" ? "cm-diagnostic-stale" : "cm-diagnostic-current"
  }));

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
      lastResult = toCmDiagnostics(toBufferDiagnostics(view.state.doc, source.committedDiagnostics()));
      return lastResult;
    }
    const parsed = parseDsl(view.state.doc.toString());
    const current = toBufferDiagnostics(view.state.doc, parsed.diagnostics);
    const stale = source.staleBaseline();
    lastResult = toCmDiagnostics(mergeDiagnosticLayers(current, stale));
    return lastResult;
  }, { delay: LINT_DELAY_MS });
};
