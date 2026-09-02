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
// every consumer occurrence comes from the compile-owned property/numeric
// consumer indexes (built once per compile, O(1) get per binding here).
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslDiagnostic, DslDiagnosticPresentation, DslSpan, DslStatement } from "../dsl/dslTypes";
import { isRuntimeBindingDisplayFresh, type RuntimeBindingFreshnessInput } from "../model/runtimeBindingFreshness";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import type { NumericBindingConsumerReference } from "./numericBindingCompiler";
import { parsePropertyBindingOccurrenceKey, type ScalarValueSource } from "./propertyBindingCompiler";
import { runtimeIssueMessage } from "./runtimeIssueMessages";
import type { ScalarEvaluationErrorContext } from "./types";

export type RuntimeScalarDiagnosticsInput = {
  computedScalarBindings: EvaluationResult["computedScalarBindings"];
  bindingAnalysis: BindingAnalysis;
  statements: readonly DslStatement[];
  spans: DiagnosticSpanContext;
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  propertySourcesByOccurrenceKey: ReadonlyMap<string, ScalarValueSource>;
  occurrenceKeysByBindingId: ReadonlyMap<BindingId, readonly string[]>;
  numericConsumerReferencesByBindingId?: ReadonlyMap<BindingId, readonly NumericBindingConsumerReference[]>;
  elements?: readonly CadElement[];
  freshness: RuntimeBindingFreshnessInput;
};

/**
 * Host-neutral runtime diagnostic payload. It remains a DslDiagnostic for all
 * existing consumers while retaining the structured ScalarEvaluation context
 * needed by later document-session sidecars without parsing localized text.
 */
export type RuntimeScalarDiagnostic = DslDiagnostic & {
  origin: "runtime";
  code: string;
  bindingId: BindingId;
  runtimeContext?: ScalarEvaluationErrorContext;
};

const structuredRuntimeContext = (
  context: ScalarEvaluationErrorContext | undefined
): Pick<RuntimeScalarDiagnostic, "runtimeContext"> =>
  context ? { runtimeContext: { ...context } } : {};

const runtimePresentation = (
  issueCode: string,
  context: ScalarEvaluationErrorContext | undefined,
  elements: readonly CadElement[] | undefined
): DslDiagnosticPresentation => {
  if (issueCode === "evaluation-geometry-builtin-disabled" && context?.kind === "geometryBuiltinTarget") {
    const target = elements?.find((element) => element.id === context.targetElementId);
    const base = target?.name && target.name.trim().length > 0 ? target.name : context.targetElementId;
    const displayTarget = context.pointKey !== undefined ? `${base}.${context.pointKey}` : base;
    return {
      key: "diagnostic.runtime.evaluation-geometry-builtin-disabled.target",
      parameters: { target: displayTarget, base }
    };
  }
  return { key: `diagnostic.runtime.${issueCode}` };
};

const declarationDiagnostic = (
  bindingId: BindingId,
  issueCode: string,
  context: ScalarEvaluationErrorContext | undefined,
  input: RuntimeScalarDiagnosticsInput
): RuntimeScalarDiagnostic | null => {
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
    message: runtimeIssueMessage(issueCode, context, input.elements),
    presentation: runtimePresentation(issueCode, context, input.elements),
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    origin: "runtime",
    bindingId,
    navigationTarget: { kind: "binding", bindingId },
    ...structuredRuntimeContext(context)
  };
};

type ConsumerOccurrence = {
  occurrenceKey: string;
  span: DslSpan;
};

const consumerDiagnostic = (
  consumer: ConsumerOccurrence,
  bindingId: BindingId,
  issueCode: string,
  context: ScalarEvaluationErrorContext | undefined,
  input: RuntimeScalarDiagnosticsInput
): RuntimeScalarDiagnostic | null => {
  const { occurrenceKey, span } = consumer;
  const parsedKey = parsePropertyBindingOccurrenceKey(occurrenceKey);
  if (!parsedKey) return null;
  const statement = input.statements[parsedKey.statementIndex];
  const elementId = input.elementIdByStatementIndex.get(parsedKey.statementIndex);
  if (!statement || !elementId) return null;
  const physicalSpan = exactPhysicalSpan(input.spans, statement, span);
  return {
    severity: "error",
    line: statement.line,
    column: span.start + 1,
    code: issueCode,
    message: runtimeIssueMessage(issueCode, context, input.elements),
    presentation: runtimePresentation(issueCode, context, input.elements),
    exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {}),
    origin: "runtime",
    bindingId,
    elementId,
    propertyKey: parsedKey.parameterKey,
    navigationTarget: { kind: "property", occurrenceKey },
    ...structuredRuntimeContext(context)
  };
};

export const runtimeScalarDiagnostics = (input: RuntimeScalarDiagnosticsInput): readonly RuntimeScalarDiagnostic[] => {
  if (!isRuntimeBindingDisplayFresh(input.freshness) || !input.computedScalarBindings) return [];

  const diagnostics: RuntimeScalarDiagnostic[] = [];
  // computedScalarBindings' own iteration order is insertion order from the
  // evaluation payload decode, i.e. document/catalog order - never re-sorted
  // here, matching the deterministic-order contract compile diagnostics use.
  for (const [bindingId, evaluation] of input.computedScalarBindings) {
    if (evaluation.status !== "error") continue;
    const occurrenceKeys = input.occurrenceKeysByBindingId.get(bindingId);
    const numericConsumers = input.numericConsumerReferencesByBindingId?.get(bindingId);
    if ((occurrenceKeys && occurrenceKeys.length > 0) || (numericConsumers && numericConsumers.length > 0)) {
      // A binding with live property/numeric consumers reports at each consumer's
      // exact value span, not at its declaration - the user sees the wrong
      // value where it is actually used. Never both: this is the one place
      // a runtime error for this binding is reported.
      for (const occurrenceKey of occurrenceKeys ?? []) {
        const source = input.propertySourcesByOccurrenceKey.get(occurrenceKey);
        if (!source || source.kind !== "binding") continue;
        const diagnostic = consumerDiagnostic(
          { occurrenceKey, span: source.span },
          bindingId,
          evaluation.issueCode,
          evaluation.context,
          input
        );
        if (diagnostic) diagnostics.push(diagnostic);
      }
      for (const numericConsumer of numericConsumers ?? []) {
        const diagnostic = consumerDiagnostic(
          { occurrenceKey: numericConsumer.occurrenceKey, span: numericConsumer.reference.span },
          bindingId,
          evaluation.issueCode,
          evaluation.context,
          input
        );
        if (diagnostic) diagnostics.push(diagnostic);
      }
      continue;
    }
    const diagnostic = declarationDiagnostic(bindingId, evaluation.issueCode, evaluation.context, input);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
};
