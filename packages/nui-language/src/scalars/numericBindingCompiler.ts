// Compiles typed references embedded in the numeric-expression language.
// Geometry measurements && runtime iteration bindings remain in that
// language; only a resolved typed `@name` occurrence is replaced by
// its stable BindingId at runtime.
import type { CadElement, ElementId, Layout, NumericValue } from "../types/geometry";
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
  placeScaleAttrKey,
  layoutNumericAttrKeys,
  printNumericAttrKeys,
  svgNumericAttrKeys
} from "../dsl/dslPrintLayoutAttributes";
import { buildPlacementRefsByStatementIndex } from "../dsl/dslPrintLayoutPlacementIndex";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { getParameterValue } from "../parameters/parameterAccess";
import { isNumericExpression, makeNumericExpression } from "../geometry/numericExpressions";
import { tokenize } from "../geometry/numericExpressionParser";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { resolveReferencesAtSites, type BindingResolution, type SiteReferenceRequest } from "./bindingResolution";
import type { BindingReferenceSite } from "./bindingResolution";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { unresolvedReferenceMessage } from "./typedDeclarationAnalysis";
import { scanExpressionReferences } from "../dsl/expressionReferenceToken";
import { parseScalarExpression } from "./expressionParser";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { getBuiltinFunctionDefinition, isScalarBuiltinParameterType, type BuiltinParameterType } from "./builtinFunctions";
import { resolveGeometryPropertyMetadata } from "./typedGeometryPropertyResolution";
import { createElementNameContext } from "../model/elementNames";
import type { ScalarCallArgumentNode, ScalarExpressionAst } from "./expressionAst";
import type { ScalarExpressionResolvedReference, TypedScalarExpression } from "./typedExpressionAst";
import { prepareRecordScalarExpressionFromCatalog } from "./recordScalarLowering";

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
  typedExpression?: TypedScalarExpression;
};

export type NumericBindingConsumerReference = {
  occurrenceKey: string;
  reference: CompiledNumericBindingReference;
};

export type NumericBindingCompilation = {
  sourcesByOccurrenceKey: ReadonlyMap<string, CompiledNumericBinding>;
  /** Numeric consumer references grouped once by binding id so runtime
   * diagnostics can project an evaluation failure to the exact `@name` value
   * span without rescanning every numeric occurrence. */
  consumerReferencesByBindingId: ReadonlyMap<BindingId, readonly NumericBindingConsumerReference[]>;
  diagnostics: readonly DslDiagnostic[];
};

export const NUMERIC_BINDING_UNRESOLVED_CODE = "numeric-binding-unresolved";
export const NUMERIC_BINDING_TYPE_MISMATCH_CODE = "numeric-binding-type-mismatch";
export const NUMERIC_BINDING_MAPPING_CODE = "numeric-binding-mapping";
export const NUMERIC_BINDING_ITERATION_REFERENCE_CODE = "numeric-binding-iteration-reference";

type CandidateReference = {
  name: string;
  span: DslSpan;
  nameSpan: DslSpan;
  /** Hidden record-field slots are runtime-only in SAY-128; editor providers remain out of scope. */
  exposeSemanticOccurrence?: boolean;
};
type BareCandidateReference = {
  name: string;
  span: DslSpan;
};
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
  /** Bare scalar value tokens are checked only for in-scope iteration bindings. */
  bareReferences: readonly BareCandidateReference[];
  /** Shared with the later typed-expression path so each candidate is parsed once. */
  scalarParseResult: ReturnType<typeof parseScalarExpression>;
  /** Absent for layout/output/place occurrences. */
  elementId?: ElementId;
};

const diagnosticAt = (
  spans: DiagnosticSpanContext,
  statement: DslStatement,
  span: DslSpan,
  code: string,
  message: string,
  presentation?: DslDiagnostic["presentation"]
): DslDiagnostic => {
  const physicalSpan = exactPhysicalSpan(spans, statement, span);
  return {
    severity: "error", line: statement.line, column: span.start + 1, code, message, exactSpanOnly: true,
    presentation: presentation ?? { key: `diagnostic.${code}` },
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

const LEGACY_GEOMETRY_FUNCTION_NAMES = new Set([
  "distance", "距離", "angle", "角度", "lineDistance", "点線距離", "lineAngle"
]);

const isNumericBuiltinParameterType = (type: BuiltinParameterType | undefined): boolean =>
  type !== undefined && isScalarBuiltinParameterType(type) && type.kind === "number";

/**
 * Returns whether each call argument is a numeric value position. Builtin
 * callees, geometry arguments, and choice arguments remain grammar-owned bare
 * tokens; only numeric scalar positions are candidates for an iteration
 * binding lookup.
 */
const numericCallArgumentPositions = (
  name: string,
  args: readonly ScalarCallArgumentNode[]
): readonly boolean[] => {
  if (LEGACY_GEOMETRY_FUNCTION_NAMES.has(name)) return args.map(() => false);
  const definition = getBuiltinFunctionDefinition(name);
  if (!definition) return args.map(() => true);

  const allNamed = args.every((argument) => argument.kind === "named");
  const allPositional = args.every((argument) => argument.kind === "positional");
  if (allNamed) {
    const signature = definition.signatures.find((candidate) => candidate.callingStyle === "named");
    return args.map((argument) => {
      if (!signature || argument.kind !== "named") return false;
      return isNumericBuiltinParameterType(signature.parameters.find((parameter) => parameter.name === argument.name)?.type);
    });
  }
  if (allPositional) {
    const signature = definition.signatures.find((candidate) => candidate.callingStyle === "positional" && candidate.parameters.length === args.length);
    return args.map((_argument, index) => isNumericBuiltinParameterType(signature?.parameters[index]?.type));
  }
  return args.map(() => false);
};

/**
 * Finds bare scalar value tokens without treating builtin callees, named
 * argument names, geometry references, or choice arguments as bindings. The
 * scalar parser supplies the exact source span; name resolution is deliberately
 * deferred to the shared binding-resolution batch below.
 */
const bareReferencesIn = (ast: ScalarExpressionAst | null, outer: DslSpan): BareCandidateReference[] => {
  if (!ast) return [];
  const references: BareCandidateReference[] = [];
  const visit = (node: ScalarExpressionAst, numericValuePosition: boolean): void => {
    switch (node.kind) {
      case "unresolvedChoiceLiteral":
        if (numericValuePosition) {
          references.push({ name: node.raw, span: { start: outer.start + node.span.start, end: outer.start + node.span.end } });
        }
        return;
      case "unary":
        visit(node.operand, numericValuePosition);
        return;
      case "binary":
        visit(node.left, true);
        visit(node.right, true);
        return;
      case "group":
        visit(node.expression, numericValuePosition);
        return;
      case "call": {
        const argumentPositions = numericCallArgumentPositions(node.name, node.args);
        node.args.forEach((argument, index) => visit(argument.expression, argumentPositions[index] ?? false));
        return;
      }
      default:
        return;
    }
  };
  visit(ast, true);
  return references;
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
  layouts, layoutIdsByStatementIndex, includeStatement
}: {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  spans: DiagnosticSpanContext;
  /** Source layouts are the only output-time numeric model in SAY-63. */
  layouts?: readonly Layout[];
  layoutIdsByStatementIndex?: ReadonlyMap<number, string>;
  includeStatement?: DslStatementInclusion;
}): NumericBindingCompilation => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sourceOrderByElementId = new Map<ElementId, number>();
  for (const [sourceOrder, elementId] of elementIdByStatementIndex) sourceOrderByElementId.set(elementId, sourceOrder);
  const nameContext = createElementNameContext([...elements]);
  const layoutById = new Map((layouts ?? []).map((layout) => [layout.id, layout]));
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
    const source = logicalText.slice(valueSpan.start, valueSpan.end);
    const scannedReferences = scanExpressionReferences(source);
    const refs = referencesIn(source, valueSpan);
    const hasGeometryProperty = scannedReferences.some((match) => match.kind === "elementProperty" && match.sigil);
    // Qualified frontend references are not typed scalar bindings. They stay
    // on their existing owner; unlike a genuinely ref-free expression, they
    // must not be offered to the typed checker without a resolution entry.
    if (!elementId && scannedReferences.length > 0 && !refs.length && !hasGeometryProperty) return;
    const scalarParseResult = parseScalarExpression(source, { start: 0, end: source.length });
    const bareReferences = bareReferencesIn(scalarParseResult.ast, valueSpan);
    candidates.push({
      key,
      statement,
      statementIndex,
      parameterKey,
      expression: value.expression,
      source: logicalText.slice(valueSpan.start, valueSpan.end),
      valueSpan,
      references: refs,
      bareReferences,
      scalarParseResult,
      elementId
    });
    const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
    refs.forEach((reference, index) => requests.push({
      key: `${key}:${index}`,
      name: reference.name,
      site: { scopeId, statementIndex }
    }));
    bareReferences.forEach((reference, index) => requests.push({
      key: `${key}:bare:${index}`,
      name: reference.name,
      site: { scopeId, statementIndex }
    }));
  };

  const placementRefByStatementIndex = buildPlacementRefsByStatementIndex(statements, layoutIdsByStatementIndex);

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

    if (statement.kind === "layout" || statement.kind === "print" || statement.kind === "svg") {
      const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
      if (!logical) return;
      const keys = statement.kind === "layout" ? layoutNumericAttrKeys : statement.kind === "print" ? printNumericAttrKeys : svgNumericAttrKeys;
      for (const attrKey of keys) {
        const source = attributeValueSpan(statement, attrKey);
        if (!source) continue;
        pushCandidate(
          propertyBindingOccurrenceKey(statementIndex, attrKey),
          statement, statementIndex, attrKey, makeNumericExpression(logical.logicalText.slice(source.start, source.end)), logical.logicalText, source
        );
      }
      return;
    }

    if (statement.kind === "place") {
      const ref = placementRefByStatementIndex.get(statementIndex);
      const layout = ref ? layoutById.get(ref.layoutId) : undefined;
      const placement = layout?.placements[ref!.placementIndex];
      const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
      if (!ref || !layout || !placement || !logical) return;
      for (const attrKey of placeNumericAttrKeys) {
        const value = attrKey === placeAngleAttrKey
          ? placement.angleDeg
          : attrKey === placeScaleAttrKey
            ? placement.scale
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
          const value = attrKey === placeAtAttrKey ? (component === "x" ? placement.at.x : placement.at.y) : undefined;
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

  const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests);
  const sourcesByOccurrenceKey = new Map<string, CompiledNumericBinding>();
  const diagnostics: DslDiagnostic[] = [];
  for (const candidate of candidates) {
    const bareIterationReferences = candidate.bareReferences.filter((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:bare:${index}`);
      return resolution?.kind === "resolved" && resolution.binding.kind === "iteration";
    });
    if (bareIterationReferences.length > 0) {
      for (const reference of bareIterationReferences) {
        diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          reference.span,
          NUMERIC_BINDING_ITERATION_REFERENCE_CODE,
          `for の反復変数「${reference.name}」は数値式で裸の名前として参照できません。「@${reference.name}」を使用してください。`,
          { key: "diagnostic.numeric-binding-iteration-reference", parameters: { name: reference.name } }
        ));
      }
      continue;
    }
    // Runtime iteration bindings remain owned by the numeric evaluator, while
    // typed bindings use the shared compile-time checker below.
    const hasLegacyOwnedReference = candidate.references.some((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      return resolution?.kind === "resolved" && resolution.binding.kind !== "typed";
    });

    let rejected = false;
    const typedRefs: { reference: CandidateReference; bindingId: BindingId }[] = [];
    candidate.references.forEach((reference, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      if (!resolution || resolution.kind === "undefined" || resolution.kind === "forward") {
        diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          reference.span,
          NUMERIC_BINDING_UNRESOLVED_CODE,
          unresolvedReferenceMessage(reference.name, resolution),
          { key: "diagnostic.numeric-binding-unresolved", parameters: { name: reference.name } }
        ));
        rejected = true;
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
        // Runtime iteration references keep the existing numeric evaluator path
        // even when another occurrence in this same expression is a
        // compiled typed slot.
        return;
      }
      const entry = bindingAnalysis.entriesById.get(binding.id);
      if (entry?.status.kind === "invalid") { rejected = true; return; } // binding diagnostics already own this cause.
      if (binding.declaredType?.kind !== "number") {
        diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          reference.span,
          NUMERIC_BINDING_TYPE_MISMATCH_CODE,
          `型が一致しません(期待: number, 実際: ${binding.declaredType?.kind ?? "unknown"})。`,
          {
            key: "diagnostic.numeric-binding-type-mismatch",
            parameters: { expected: "number", actual: binding.declaredType?.kind ?? "unknown" }
          }
        ));
        rejected = true;
        return;
      }
      typedRefs.push({ reference, bindingId: binding.id });
    });
    if (rejected) continue;
    const typedResolutions = candidate.references.map((_, index) => resolutions.get(candidate.key + ":" + index));
    const scalarTypecheckReferences: (BindingResolution | ScalarExpressionResolvedReference)[] = typedResolutions.map((resolution) => resolution!);
    const canTypecheckScalarReferences = scalarTypecheckReferences.every((resolution) =>
      resolution.kind === "resolved" || resolution.kind === "resolvedType"
    );
    let typedExpression: TypedScalarExpression | undefined;
    let typedReferenceSpans: { name: string; span: { start: number; end: number } }[] = [];
    if (canTypecheckScalarReferences) {
      // Typecheck the original DSL spelling. The normalized numeric spelling
      // intentionally removes `@` from geometry measurements (for example
      // `@AB.length` becomes `AB.length`) for the legacy numeric evaluator,
      // but that representation is not valid input for the shared scalar
      // parser. Typed binding occurrences and geometry-property occurrences
      // receive their resolved metadata through closed compiler sidecars.
      const typedParsed = candidate.scalarParseResult;
      if (!typedParsed.ast) {
        const issue = typedParsed.diagnostics[0];
        // Legacy measurement/function syntax remains owned by the numeric
        // evaluator when no standalone typed route is possible. Mixed
        // typed/iteration expressions retain their existing source-splice path.
        if (issue && typedRefs.length > 0) diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          { start: candidate.valueSpan.start + issue.span.start, end: candidate.valueSpan.start + issue.span.end },
          issue.code,
          issue.message
        ));
        if (typedRefs.length === 0 || !hasLegacyOwnedReference) continue;
      } else {
        // Map references in the normalized legacy expression, not the source
        // AST: geometry-property normalization removes an `@` and can shift
        // every later binding's offset. Record properties remain sigil form
        // here and join the same source-splice path when an iteration/local
        // binding keeps the expression on the legacy numeric runtime.
        typedReferenceSpans = scanExpressionReferences(candidate.expression).flatMap((match) => {
          if (match.kind === "binding") {
            return [{ name: match.query, span: { start: match.from, end: match.to } }];
          }
          if (match.kind === "elementProperty" && match.sigil) {
            return [{
              name: `${match.elementToken}.${match.query}`,
              span: { start: match.tokenStart, end: match.tokenEnd }
            }];
          }
          return [];
        });
        const prepared = prepareRecordScalarExpressionFromCatalog({
          ast: typedParsed.ast,
          statementIndex: candidate.statementIndex,
          catalog: bindingAnalysis.catalog,
          referenceResolutions: scalarTypecheckReferences
        });
        if (prepared.issues.length > 0) {
          diagnostics.push(...prepared.issues.map((issue) => diagnosticAt(
            spans,
            candidate.statement,
            { start: candidate.valueSpan.start + issue.span.start, end: candidate.valueSpan.start + issue.span.end },
            NUMERIC_BINDING_UNRESOLVED_CODE,
            issue.message,
            issue.presentation
          )));
          continue;
        }
        const geometryPropertyResolution = resolveGeometryPropertyMetadata(
          prepared.ast,
          elements,
          sourceOrderByElementId,
          {
            currentElement: candidate.elementId ? byId.get(candidate.elementId) : undefined,
            nameContext,
            currentSourceOrder: candidate.statementIndex
          }
        );
        const hasGeometryProperty = geometryPropertyResolution.geometryPropertyReferences.size > 0;
        const typedChecked = typecheckScalarExpression(prepared.ast, {
          expectedType: { kind: "number" },
          references: prepared.references,
          geometryPropertyReferences: geometryPropertyResolution.geometryPropertyReferences
        });
        if (typedChecked.diagnostics.length > 0 || typedChecked.type === null) {
          if (hasLegacyOwnedReference || hasGeometryProperty) {
            for (const issue of typedChecked.diagnostics) diagnostics.push(diagnosticAt(
              spans,
              candidate.statement,
              { start: candidate.valueSpan.start + issue.span.start, end: candidate.valueSpan.start + issue.span.end },
              issue.code,
              issue.message,
              issue.presentation
            ));
          }
          if (typedRefs.length === 0 || !hasLegacyOwnedReference) continue;
        }
        if (typedChecked.diagnostics.length === 0 && typedChecked.type?.kind === "number") {
          for (const dependency of prepared.dependencies) {
            const span = {
              start: candidate.valueSpan.start + dependency.span.start,
              end: candidate.valueSpan.start + dependency.span.end
            };
            typedRefs.push({
              reference: {
                name: dependency.name,
                span,
                nameSpan: { start: span.start + 1, end: span.end },
                exposeSemanticOccurrence: false
              },
              bindingId: dependency.bindingId
            });
          }
          typedRefs.sort((left, right) => left.reference.span.start - right.reference.span.start);
        }
        if (!hasLegacyOwnedReference && geometryPropertyResolution.issues.length === 0 && typedChecked.type?.kind === "number") {
          typedExpression = typedChecked.typed;
        }
      }
    }
    if (!typedExpression && typedReferenceSpans.length === 0 && candidate.references.length === 0) continue;
    let tokens: ReturnType<typeof tokenize>;
    if (typedExpression || typedReferenceSpans.length > 0) {
      tokens = [];
    } else {
      try {
        tokens = tokenize(candidate.expression);
      } catch {
        diagnostics.push(diagnosticAt(
          spans, candidate.statement, candidate.references[0].span, NUMERIC_BINDING_MAPPING_CODE,
          "numeric 式の型付き参照を正準の評価対象へ対応付けられません。"
        ));
        continue;
      }
    }
    const references: CompiledNumericBindingReference[] = [];
    for (const { reference, bindingId } of typedRefs) {
      const typedReference = typedReferenceSpans.find((candidateReference) =>
        candidateReference.name === reference.name &&
        !references.some((used) => used.expressionStart === candidateReference.span.start)
      );
      const expressionStart = typedReference?.span.start ?? tokens.find((item) =>
        item.type === "localVariable" && item.variableId === reference.name &&
        !references.some((used) => used.expressionStart === item.start)
      )?.start;
      const expressionEnd = typedReference?.span.end ?? tokens.find((item) =>
        item.type === "localVariable" && item.variableId === reference.name &&
        !references.some((used) => used.expressionStart === item.start)
      )?.end;
      if (expressionStart === undefined || expressionEnd === undefined ||
          candidate.expression.slice(expressionStart, expressionEnd) !== `@${reference.name}`) {
        diagnostics.push(diagnosticAt(
          spans, candidate.statement, reference.span, NUMERIC_BINDING_MAPPING_CODE,
          "numeric 式の型付き参照を正準の評価対象へ対応付けられません。"
        ));
        rejected = true;
        break;
      }
      references.push({ bindingId, name: reference.name, span: reference.span, nameSpan: reference.nameSpan,
        physicalNameSpan: reference.exposeSemanticOccurrence === false
          ? null
          : exactPhysicalSpan(spans, candidate.statement, reference.nameSpan),
        expressionStart, expressionEnd,
        site: {
          scopeId: bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(candidate.statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId,
          statementIndex: candidate.statementIndex,
        } });
    }
    if (!rejected && (references.length || typedExpression)) {
      sourcesByOccurrenceKey.set(candidate.key, {
        parameterKey: candidate.parameterKey,
        expression: candidate.expression,
        references,
        ...(typedExpression ? { typedExpression } : {})
      });
    }
  }
  const consumerReferencesByBindingId = new Map<BindingId, NumericBindingConsumerReference[]>();
  for (const [occurrenceKey, source] of sourcesByOccurrenceKey) {
    for (const reference of source.references) {
      const existing = consumerReferencesByBindingId.get(reference.bindingId);
      const consumer = { occurrenceKey, reference };
      if (existing) existing.push(consumer);
      else consumerReferencesByBindingId.set(reference.bindingId, [consumer]);
    }
  }
  return { sourcesByOccurrenceKey, consumerReferencesByBindingId, diagnostics };
};
