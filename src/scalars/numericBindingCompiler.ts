// Compiles typed references embedded in the numeric-expression language.
// Geometry measurements and element-local numeric variables remain in that
// language; only a resolved typed `@name` occurrence is replaced by
// its stable BindingId at runtime.
import type { CadElement, ElementId, NumericValue, PrintLayout } from "../types/geometry";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslStatementInclusion } from "../dsl/dslCompilationGuard";
import { exactPhysicalSpan, type DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { resolveParameterValueSpan } from "../dsl/dslParameterSpans";
import { coordinateComponent } from "../dsl/dslParameterSpanScanner";
import {
  placeAngleAttrKey,
  placeAtAttrKey,
  placeCoordinateAttrKeys,
  placeNumericAttrKeys,
  placeXAttrKey,
  placeYAttrKey,
  printLayoutCanvasAttrKey,
  printLayoutColumnsAttrKey,
  printLayoutCoordinateAttrKeys,
  printLayoutHeightAttrKey,
  printLayoutNumericAttrKeys,
  printLayoutOverlapAttrKey,
  printLayoutRowsAttrKey,
  printLayoutScaleAttrKey,
  printLayoutWidthAttrKey
} from "../dsl/dslPrintLayoutAttributes";
import { buildPlacementRefsByStatementIndex } from "../dsl/dslPrintLayoutPlacementIndex";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression } from "../geometry/numericExpressions";
import { tokenize } from "../geometry/numericExpressionParser";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import type { BindingReferenceSite } from "./bindingResolution";
import { buildElementLocalRangeIndexFromElements } from "./elementLocalRangeIndex";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { unresolvedReferenceMessage } from "./typedDeclarationAnalysis";
import { scanExpressionReferences } from "../dsl/expressionReferenceToken";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import type { ScalarExpressionResolvedReference } from "./typedExpressionAst";

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
  /** Original DSL value, before numeric normalization removes geometry sigils. */
  source: string;
  valueSpan: DslSpan;
  references: readonly CandidateReference[];
  /** Absent for printLayout/place occurrences - they have no element-local pool. */
  elementId?: ElementId;
};

const diagnosticAt = (spans: DiagnosticSpanContext, statement: DslStatement, span: DslSpan, code: string, message: string): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error", line: statement.line, column: span.start + 1, code, message, exactSpanOnly: true,
    ...(physicalSpan ? { physicalSpan } : {})
  };
};

// Geometry properties are not binding occurrences. Use the shared scanner so
// scoped `@Group::Element.property` references are excluded exactly like the
// existing `@Element.property` spelling.
const referencesIn = (source: string, outer: DslSpan): CandidateReference[] => {
  return scanExpressionReferences(source)
    .filter((match): match is Extract<typeof match, { kind: "binding" }> => match.kind === "binding" && !match.qualifiedPath)
    .map((match) => ({
      name: match.query,
      span: { start: outer.start + match.from, end: outer.start + match.to },
      nameSpan: { start: outer.start + match.from + 1, end: outer.start + match.to }
    }));
};

/** printLayout/place statement's own attribute value span, in the same
 * logical-text coordinate space `resolveParameterValueSpan` returns for
 * element parameters - `DslAttribute.valueStart/valueEnd` are already
 * logical-text offsets (dslCompiler.ts's `attr()` reads the same fields
 * directly with no coordinate transform). */
const attributeValueSpan = (statement: DslStatement, attrKey: string): DslSpan | null => {
  const attribute = statement.attrs.find((item) => item.key === attrKey);
  return attribute ? { start: attribute.valueStart, end: attribute.valueEnd } : null;
};

export const compileNumericBindings = ({
  statements, elementIdByStatementIndex, elements, bindingAnalysis, spans,
  printLayouts, printLayoutIdsByStatementIndex, includeStatement
}: {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  spans: DiagnosticSpanContext;
  /** Task 53: needed to resolve printLayout/place `@name` occurrences to
   * typed bindings - absent (or without any printLayouts) leaves those
   * statements untouched by this compiler, same as before Task 53. */
  printLayouts?: readonly PrintLayout[];
  printLayoutIdsByStatementIndex?: ReadonlyMap<number, string>;
  includeStatement?: DslStatementInclusion;
}): NumericBindingCompilation => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const printLayoutById = new Map((printLayouts ?? []).map((layout) => [layout.id, layout]));
  const candidates: Candidate[] = [];
  const requests: SiteReferenceRequest[] = [];

  const pushCandidate = (
    key: string,
    statement: DslStatement,
    statementIndex: number,
    parameterKey: string,
    value: NumericValue | undefined,
    logicalText: string,
    valueSpan: DslSpan | null,
    elementId?: ElementId
  ) => {
    if (!value || !isNumericExpression(value) || !valueSpan) return;
    const refs = referencesIn(logicalText.slice(valueSpan.start, valueSpan.end), valueSpan);
    const hasGeometryProperty = scanExpressionReferences(logicalText.slice(valueSpan.start, valueSpan.end))
      .some((match) => match.kind === "elementProperty" && match.sigil);
    if (!refs.length && !hasGeometryProperty) return;
    candidates.push({
      key,
      statement,
      statementIndex,
      parameterKey,
      expression: value.expression,
      source: logicalText.slice(valueSpan.start, valueSpan.end),
      valueSpan,
      references: refs,
      elementId
    });
    const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
    refs.forEach((reference, index) => requests.push({
      key: `${key}:${index}`,
      name: reference.name,
      site: elementId
        ? { scopeId, statementIndex, elementLocal: { ownerId: elementId, order: Number.MAX_SAFE_INTEGER } }
        : { scopeId, statementIndex }
    }));
  };

  const placementRefByStatementIndex = buildPlacementRefsByStatementIndex(statements, printLayoutIdsByStatementIndex);

  statements.forEach((statement, statementIndex) => {
    if (includeStatement && !includeStatement(statement, statementIndex)) return;
    if (statement.kind === "element" || statement.kind === "group") {
      const element = byId.get(elementIdByStatementIndex.get(statementIndex) ?? "");
      const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
      if (!element || !logical) return;
      for (const definition of getParameterDefinitions(element)) {
        if (definition.kind !== "number" || (element.type === "conditionalGroup" && definition.key === "condition")) continue;
        const value = getParameterValue(element, definition.key) as NumericValue | undefined;
        const valueSpan = resolveParameterValueSpan(logical.logicalText, element, definition.key);
        // Geometry properties are evaluated after this element's local
        // variables have been computed, so every local is visible here -
        // Number.MAX_SAFE_INTEGER always includes the element's full local range.
        pushCandidate(
          propertyBindingOccurrenceKey(statementIndex, definition.key),
          statement, statementIndex, definition.key, value, logical.logicalText, valueSpan, element.id
        );
      }
      return;
    }

    if (statement.kind === "printLayout") {
      const layoutId = printLayoutIdsByStatementIndex?.get(statementIndex);
      const layout = layoutId ? printLayoutById.get(layoutId) : undefined;
      const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
      if (!layout || !logical) return;
      const numericFieldByAttr: Record<string, NumericValue | undefined> = {
        [printLayoutWidthAttrKey]: layout.svgCanvasWidthMm,
        [printLayoutHeightAttrKey]: layout.svgCanvasHeightMm,
        [printLayoutColumnsAttrKey]: layout.columns,
        [printLayoutRowsAttrKey]: layout.rows,
        [printLayoutOverlapAttrKey]: layout.overlapMm,
        [printLayoutScaleAttrKey]: layout.scale
      };
      for (const attrKey of printLayoutNumericAttrKeys) {
        pushCandidate(
          propertyBindingOccurrenceKey(statementIndex, attrKey),
          statement, statementIndex, attrKey, numericFieldByAttr[attrKey], logical.logicalText, attributeValueSpan(statement, attrKey)
        );
      }
      for (const attrKey of printLayoutCoordinateAttrKeys) {
        const outer = attributeValueSpan(statement, attrKey);
        (["x", "y"] as const).forEach((component) => {
          const componentSpan = outer ? coordinateComponent(logical.logicalText, outer, component) : null;
          const value = attrKey === printLayoutCanvasAttrKey
            ? (component === "x" ? layout.svgCanvasWidthMm : layout.svgCanvasHeightMm)
            : undefined;
          const parameterKey = `${attrKey}:${component}`;
          pushCandidate(
            propertyBindingOccurrenceKey(statementIndex, parameterKey),
            statement, statementIndex, parameterKey, value, logical.logicalText, componentSpan
          );
        });
      }
      return;
    }

    if (statement.kind === "place") {
      const ref = placementRefByStatementIndex.get(statementIndex);
      const layout = ref ? printLayoutById.get(ref.layoutId) : undefined;
      const placement = layout?.placements[ref!.placementIndex];
      const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
      if (!ref || !layout || !placement || !logical) return;
      for (const attrKey of placeNumericAttrKeys) {
        const value = attrKey === placeAngleAttrKey
          ? placement.angleDeg
          : attrKey === placeXAttrKey
            ? placement.x
            : attrKey === placeYAttrKey
              ? placement.y
              : undefined;
        pushCandidate(
          propertyBindingOccurrenceKey(statementIndex, attrKey),
          statement, statementIndex, attrKey, value, logical.logicalText, attributeValueSpan(statement, attrKey)
        );
      }
      for (const attrKey of placeCoordinateAttrKeys) {
        const outer = attributeValueSpan(statement, attrKey);
        (["x", "y"] as const).forEach((component) => {
          const componentSpan = outer ? coordinateComponent(logical.logicalText, outer, component) : null;
          const value = attrKey === placeAtAttrKey ? (component === "x" ? placement.x : placement.y) : undefined;
          const parameterKey = `${attrKey}:${component}`;
          pushCandidate(
            propertyBindingOccurrenceKey(statementIndex, parameterKey),
            statement, statementIndex, parameterKey, value, logical.logicalText, componentSpan
          );
        });
      }
      return;
    }
  });

  const elementLocalRangeIndex = buildElementLocalRangeIndexFromElements(elements);
  const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests, elementLocalRangeIndex);
  const sourcesByOccurrenceKey = new Map<string, CompiledNumericBinding>();
  const diagnostics: DslDiagnostic[] = [];
  for (const candidate of candidates) {
    // Element-local numeric variables remain owned by the legacy evaluator at
    // runtime, but their numeric type still participates in the shared
    // compile-time checker below. Other scalar references, including
    // iteration bindings, use that checker whenever its AST can represent the
    // expression.
    const staysInLegacyEvaluator = candidate.references.length > 0 && candidate.references.every((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      return resolution?.kind === "resolvedLocal";
    });

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
    const typedResolutions = candidate.references.map((_, index) => resolutions.get(candidate.key + ":" + index));
    const scalarTypecheckReferences: (BindingResolution | ScalarExpressionResolvedReference)[] = typedResolutions.map((resolution) =>
      resolution?.kind === "resolvedLocal"
        ? { kind: "resolvedType", bindingId: null, type: { kind: "number" } }
        : resolution!
    );
    const canTypecheckScalarReferences = scalarTypecheckReferences.every((resolution) =>
      resolution.kind === "resolved" || resolution.kind === "resolvedType"
    );
    if (canTypecheckScalarReferences) {
      // Typecheck the original DSL spelling. The normalized numeric spelling
      // intentionally removes `@` from geometry measurements (for example
      // `@AB.length` becomes `AB.length`) for the legacy numeric evaluator,
      // but that representation is not valid input for the shared scalar
      // parser. Geometry properties themselves are already typed as number;
      // typed and element-local binding occurrences use the supplied
      // resolutions; geometry properties remain intrinsic numeric nodes.
      const typedParsed = parseScalarExpression(candidate.source, { start: 0, end: candidate.source.length });
      if (!typedParsed.ast) {
        const issue = typedParsed.diagnostics[0];
        // Legacy measurement/function syntax remains owned by the numeric
        // evaluator when no typed binding is involved. A typed reference,
        // however, must not silently fall through an unrepresentable AST.
        if (issue && typedRefs.length > 0) diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          { start: candidate.valueSpan.start + issue.span.start, end: candidate.valueSpan.start + issue.span.end },
          issue.code,
          issue.message
        ));
        if (typedRefs.length > 0) continue;
      } else {
        const typedChecked = typecheckScalarExpression(typedParsed.ast, {
          expectedType: { kind: "number" },
          references: scalarTypecheckReferences
        });
        if (typedChecked.diagnostics.length > 0 || typedChecked.type === null) {
          for (const issue of typedChecked.diagnostics) diagnostics.push(diagnosticAt(
            spans,
            candidate.statement,
            { start: candidate.valueSpan.start + issue.span.start, end: candidate.valueSpan.start + issue.span.end },
            issue.code,
            issue.message
          ));
          continue;
        }
      }
    }
    if (staysInLegacyEvaluator) continue;
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
          ...(candidate.elementId ? { elementLocal: { ownerId: candidate.elementId, order: Number.MAX_SAFE_INTEGER } } : {})
        } });
    }
    if (!rejected && references.length) sourcesByOccurrenceKey.set(candidate.key, { parameterKey: candidate.parameterKey, expression: candidate.expression, references });
  }
  return { sourcesByOccurrenceKey, diagnostics };
};
