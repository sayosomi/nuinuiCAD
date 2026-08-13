// Task 48: adapts fresh TS/Rust ScalarEvaluation runtime errors
// (computedScalarBindings) into the same central DslDiagnostic shape the
// gutter/Problems popover already consume for compile-time diagnostics.
//
// Pure && re-run on every read, never cached across a source/evaluation
// change (see sourceEditorController.ts's runtimeDiagnostics() - the only
// caller): freshness is checked here, every single call, against whatever
// `freshness` the caller currently has, so a stale/dirty moment yields an
// empty array immediately rather than a snapshot taken once && held.
//
// Never re-parses source && never re-resolves a name: every span comes from
// exactPhysicalSpan against the already-compiled statements/span index, &&
// every consumer occurrence comes from propertyBindingCompiler.ts's
// precomputed occurrenceKeysByBindingId (built once per compile, O(1) get
// per binding here).
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslDiagnostic, DslStatement } from "../dsl/dslTypes";
import { isRuntimeBindingDisplayFresh, type RuntimeBindingFreshnessInput } from "../model/runtimeBindingFreshness";
import type { ElementId, EvaluationResult } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { parsePropertyBindingOccurrenceKey, type ScalarValueSource } from "./propertyBindingCompiler";
import { runtimeIssueMessage } from "./runtimeIssueMessages";

export type RuntimeScalarDiagnosticsInput = {
  computedScalarBindings: EvaluationResult["computedScalarBindings"];
  bindingAnalysis: BindingAnalysis;
  statements: readonly DslStatement[];
  spans: DiagnosticSpanContext;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  propertySourcesByOccurrenceKey: ReadonlyMap<string, ScalarValueSource>;
  occurrenceKeysByBindingId: ReadonlyMap<BindingId, readonly string[]>;
  freshness: RuntimeBindingFreshnessInput;
};

const declarationDiagnostic = (
  bindingId: BindingId,
  issueCode: string,
  input: RuntimeScalarDiagnosticsInput
): DslDiagnostic | null => {
  const binding = input.bindingAnalysis.catalog.bindingsById.get(bindingId);
  const statement = binding ? input.statements[binding.statementIndex] : undefined;
  const nameSpan = binding?.nameSpan;
  if (!statement || !nameSpan) return null;
  const physicalSpan = exactPhysicalSpan(input.spans, statement, nameSpan);
  return {
    severity: "error",
    line: statement.line,
    column: nameSpan.start + 1,
    code: issueCode,
    message: runtimeIssueMessage(issueCode),
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    origin: "runtime",
    bindingId,
    navigationTarget: { kind: "binding", bindingId }
  };
};

const consumerDiagnostic = (
  occurrenceKey: string,
  bindingId: BindingId,
  issueCode: string,
  input: RuntimeScalarDiagnosticsInput
): DslDiagnostic | null => {
  const source = input.propertySourcesByOccurrenceKey.get(occurrenceKey);
  const parsedKey = parsePropertyBindingOccurrenceKey(occurrenceKey);
  if (!source || source.kind !== "binding" || !parsedKey) return null;
  const statement = input.statements[parsedKey.statementIndex];
  const elementId = input.elementIdByStatementIndex.get(parsedKey.statementIndex);
  if (!statement || !elementId) return null;
  const physicalSpan = exactPhysicalSpan(input.spans, statement, source.span);
  return {
    severity: "error",
    line: statement.line,
    column: source.span.start + 1,
    code: issueCode,
    message: runtimeIssueMessage(issueCode),
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    origin: "runtime",
    bindingId,
    elementId,
    propertyKey: parsedKey.parameterKey,
    navigationTarget: { kind: "property", occurrenceKey }
  };
};

export const runtimeScalarDiagnostics = (input: RuntimeScalarDiagnosticsInput): readonly DslDiagnostic[] => {
  if (!isRuntimeBindingDisplayFresh(input.freshness) || !input.computedScalarBindings) return [];

  const diagnostics: DslDiagnostic[] = [];
  // computedScalarBindings' own iteration order is insertion order from the
  // evaluation payload decode, i.e. document/catalog order - never re-sorted
  // here, matching the deterministic-order contract compile diagnostics use.
  for (const [bindingId, evaluation] of input.computedScalarBindings) {
    if (evaluation.status !== "error") continue;
    const occurrenceKeys = input.occurrenceKeysByBindingId.get(bindingId);
    if (occurrenceKeys && occurrenceKeys.length > 0) {
      // A binding with live property consumers reports at each consumer's
      // exact value span, not at its declaration - the user sees the wrong
      // value where it is actually used. Never both: this is the one place
      // a runtime error for this binding is reported.
      for (const occurrenceKey of occurrenceKeys) {
        const diagnostic = consumerDiagnostic(occurrenceKey, bindingId, evaluation.issueCode, input);
        if (diagnostic) diagnostics.push(diagnostic);
      }
      continue;
    }
    const diagnostic = declarationDiagnostic(bindingId, evaluation.issueCode, input);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
};
