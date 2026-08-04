// Compiles typed references embedded in the numeric-expression language.
// Geometry measurements and element-local numeric variables remain in that
// language; only a resolved typed `@name` occurrence is replaced by
// its stable BindingId at runtime.
import type { CadElement, ElementId, NumericValue } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { resolveParameterValueSpan } from "../dsl/dslParameterSpans";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { tokenize } from "../geometry/numericExpressionParser";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type SiteReferenceRequest } from "./bindingResolution";
import type { BindingReferenceSite } from "./bindingResolution";
import { buildElementLocalRangeIndexFromElements } from "./elementLocalRangeIndex";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { unresolvedReferenceMessage } from "./typedDeclarationAnalysis";

export type CompiledNumericBindingReference = {
  bindingId: BindingId;
  name: string;
  span: DslSpan;
  nameSpan: DslSpan;
  /** Exact parser-projected bare-name source span; absent means fail closed for rename/cursor. */
  physicalNameSpan: DslPhysicalSpan | null;
  /** Offsets in the normalized NumericValue.expression, never source text. */
  expressionStart: number;
  expressionEnd: number;
  site: BindingReferenceSite;
};

export type CompiledNumericBinding = {
  parameterKey: string;
  /** Identity check for runtime materialization; never used as a lookup key. */
  expression: string;
  references: readonly CompiledNumericBindingReference[];
};

export type NumericBindingCompilation = {
  sourcesByOccurrenceKey: ReadonlyMap<string, CompiledNumericBinding>;
  diagnostics: readonly DslDiagnostic[];
};

export const NUMERIC_BINDING_UNRESOLVED_CODE = "numeric-binding-unresolved";
export const NUMERIC_BINDING_TYPE_MISMATCH_CODE = "numeric-binding-type-mismatch";
export const NUMERIC_BINDING_MAPPING_CODE = "numeric-binding-mapping";

type CandidateReference = { name: string; span: DslSpan; nameSpan: DslSpan };
type Candidate = {
  key: string;
  statement: DslStatement;
  statementIndex: number;
  parameterKey: string;
  expression: string;
  references: readonly CandidateReference[];
  elementId: ElementId;
};

const diagnosticAt = (spans: DiagnosticSpanContext, statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error", line: statement.line, column: span.start + 1, code, message, exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

// This intentionally mirrors the numeric local-variable token boundary.
// In particular `@AB.length` is not a binding occurrence: the established
// measurement spelling is `AB.length`.
const referencesIn = (source: string, outer: DslSpan): CandidateReference[] => {
  const result: CandidateReference[] = [];
  const pattern = /@([\p{L}_][\p{L}\p{N}_]*)/gu;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (source[end] === ".") continue;
    result.push({ name: match[1], span: { start: outer.start + start, end: outer.start + end }, nameSpan: { start: outer.start + start + 1, end: outer.start + end } });
  }
  return result;
};

export const compileNumericBindings = ({
  statements, elementIdByStatementIndex, elements, bindingAnalysis, spans
}: {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  spans: DiagnosticSpanContext;
}): NumericBindingCompilation => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const candidates: Candidate[] = [];
  const requests: SiteReferenceRequest[] = [];

  statements.forEach((statement, statementIndex) => {
    if (statement.kind !== "element" && statement.kind !== "group") return;
    const element = byId.get(elementIdByStatementIndex.get(statementIndex) ?? "");
    const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!element || !logical) return;
    for (const definition of getParameterDefinitions(element)) {
      if (definition.kind !== "number" || (element.type === "conditionalGroup" && definition.key === "condition")) continue;
      const value = getParameterValue(element, definition.key) as NumericValue | undefined;
      if (!value || !isNumericExpression(value)) continue;
      const valueSpan = resolveParameterValueSpan(logical.logicalText, element, definition.key);
      if (!valueSpan) continue;
      const refs = referencesIn(logical.logicalText.slice(valueSpan.start, valueSpan.end), valueSpan);
      if (!refs.length) continue;
      const key = propertyBindingOccurrenceKey(statementIndex, definition.key);
      candidates.push({ key, statement, statementIndex, parameterKey: definition.key, expression: value.expression, references: refs, elementId: element.id });
      const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
      // Geometry properties are evaluated after this element's local
      // variables have been computed, so every local is visible here -
      // Number.MAX_SAFE_INTEGER always includes the element's full local range.
      refs.forEach((reference, index) => requests.push({
        key: `${key}:${index}`,
        name: reference.name,
        site: { scopeId, statementIndex, elementLocal: { ownerId: element.id, order: Number.MAX_SAFE_INTEGER } }
      }));
    }
  });

  const elementLocalRangeIndex = buildElementLocalRangeIndexFromElements(elements);
  const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests, elementLocalRangeIndex);
  const sourcesByOccurrenceKey = new Map<string, CompiledNumericBinding>();
  const diagnostics: DslDiagnostic[] = [];
  for (const candidate of candidates) {
    const resolvedTyped = candidate.references.some((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      return resolution?.kind === "resolved" && resolution.binding.kind === "typed";
    });
    if (!resolvedTyped) continue; // Pure local/iteration expression stays in the numeric evaluator.

    let rejected = false;
    const typedRefs: { reference: CandidateReference; bindingId: BindingId }[] = [];
    candidate.references.forEach((reference, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      if (!resolution || resolution.kind === "undefined" || resolution.kind === "forward") {
        diagnostics.push(diagnosticAt(spans, candidate.statement, reference.span, NUMERIC_BINDING_UNRESOLVED_CODE, unresolvedReferenceMessage(reference.name, resolution)));
        rejected = true;
        return;
      }
      if (resolution.kind === "resolvedLocal") {
        // Element-local references keep the existing numeric evaluator path
        // even when another occurrence in this same expression is a
        // compiled typed slot.
        return;
      }
      if (resolution.kind !== "resolved") {
        // Binding analysis already emits the duplicate/self invalidation
        // diagnostic.  Do not report the same underlying cause again here.
        rejected = true;
        return;
      }
      const binding = resolution.binding;
      if (binding.kind !== "typed") {
        // Iteration references keep the existing numeric evaluator path
        // even when another occurrence in this same expression is a
        // compiled typed slot.
        return;
      }
      const entry = bindingAnalysis.entriesById.get(binding.id);
      if (entry?.status.kind === "invalid") { rejected = true; return; } // binding diagnostics already own this cause.
      if (binding.declaredType?.kind !== "number") {
        diagnostics.push(diagnosticAt(spans, candidate.statement, reference.span, NUMERIC_BINDING_TYPE_MISMATCH_CODE, `型が一致しません(期待: number, 実際: ${binding.declaredType?.kind ?? "unknown"})。`));
        rejected = true;
        return;
      }
      typedRefs.push({ reference, bindingId: binding.id });
    });
    if (rejected) continue;
    let tokens: ReturnType<typeof tokenize>;
    try {
      tokens = tokenize(candidate.expression);
    } catch {
      diagnostics.push(diagnosticAt(
        spans, candidate.statement, candidate.references[0].span, NUMERIC_BINDING_MAPPING_CODE,
        "numeric 式の型付き参照を正準の評価対象へ対応付けられません。"
      ));
      continue;
    }
    const references: CompiledNumericBindingReference[] = [];
    for (const { reference, bindingId } of typedRefs) {
      const token = tokens.find((item) => item.type === "localVariable" && item.variableId === reference.name && !references.some((used) => used.expressionStart === item.start));
      if (!token) {
        diagnostics.push(diagnosticAt(
          spans, candidate.statement, reference.span, NUMERIC_BINDING_MAPPING_CODE,
          "numeric 式の型付き参照を正準の評価対象へ対応付けられません。"
        ));
        rejected = true;
        break;
      }
      references.push({ bindingId, name: reference.name, span: reference.span, nameSpan: reference.nameSpan,
        physicalNameSpan: exactPhysicalSpan(spans, candidate.statement, reference.nameSpan), expressionStart: token.start, expressionEnd: token.end,
        site: {
          scopeId: bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(candidate.statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId,
          statementIndex: candidate.statementIndex,
          elementLocal: { ownerId: candidate.elementId, order: Number.MAX_SAFE_INTEGER }
        } });
    }
    if (!rejected && references.length) sourcesByOccurrenceKey.set(candidate.key, { parameterKey: candidate.parameterKey, expression: candidate.expression, references });
  }
  return { sourcesByOccurrenceKey, diagnostics };
};
