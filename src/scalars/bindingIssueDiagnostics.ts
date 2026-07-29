// Task 48: adapts BindingAnalysis.issues (Task 13's duplicate-binding/
// binding-cycle/self-initialization/undefined-binding/forward-binding-reference)
// into the same central DslDiagnostic shape the gutter/Problems popover/
// Quick Fix already consume, with an exact projected span reusing Task 48's
// shared exactPhysicalSpan helper - never a whole-statement span, never a
// second message implementation (formatBindingIssue is reused verbatim).
//
// Deliberately NOT merged into compileDslDocument's gating `diagnostics`
// array by this module's caller: see CompiledDslDocument.bindingIssueDiagnostics
// in dslDocument.ts for why (a BindingIssue-only document must keep
// compiling today's way - per-binding degradation, not whole-document
// failure).
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslDiagnostic, DslStatement } from "../dsl/dslTypes";
import type { BindingAnalysis } from "./bindingAnalysis";
import { formatBindingIssue } from "./bindingDiagnostics";

export const bindingIssuesToDiagnostics = (
  bindingAnalysis: BindingAnalysis,
  statements: readonly DslStatement[],
  spans: DiagnosticSpanContext
): readonly DslDiagnostic[] =>
  // bindingAnalysis.issues is already deterministically ordered (bindingRank,
  // then ISSUE_PRIORITY, then occurrenceIndex - see bindingAnalysis.ts's own
  // module comment); never re-sorted here.
  bindingAnalysis.issues.map((issue) => {
    const formatted = formatBindingIssue(bindingAnalysis, issue);
    const binding = bindingAnalysis.catalog.bindingsById.get(issue.bindingId);
    const statement = binding ? statements[binding.statementIndex] : undefined;
    const physicalSpan = statement && issue.span ? exactPhysicalSpan(spans, statement, issue.span) : null;
    return {
      severity: "error",
      line: statement?.line ?? 1,
      column: (issue.span?.start ?? 0) + 1,
      code: issue.code,
      message: formatted.message,
      exactSpanOnly: true,
      ...(physicalSpan ? { physicalSpan } : {}),
      bindingId: issue.bindingId,
      navigationTarget: { kind: "binding" as const, bindingId: issue.bindingId }
    };
  });
