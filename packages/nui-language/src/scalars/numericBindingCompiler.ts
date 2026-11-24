// Compiles numeric inputs with canonical binding and geometry operand
// identities. Typed construction expressions share scalar evaluation;
// remaining legacy expressions retain their source-splice binding sidecars.
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
import { namespaceResolutionDiagnostic, unresolvedReferenceMessage } from "./typedDeclarationAnalysis";
import { parseScalarExpression } from "./expressionParser";
import { collectScalarExpressionReferences } from "./expressionReferenceCollector";
import { typecheckScalarExpression } from "./expressionTypecheck";
import { resolveGeometryPropertyMetadata } from "./typedGeometryPropertyResolution";
import { createElementNameContext } from "../model/elementNames";
import type { ScalarExpressionAst } from "./expressionAst";
import type { ScalarExpressionResolvedGeometryTarget, ScalarExpressionResolvedReference, TypedScalarExpression } from "./typedExpressionAst";
import type { TransformationOperation, TransformationRecipe, TransformationStageSelection } from "../dsl/transformationRecipes";
import { prepareRecordScalarExpressionFromCatalog } from "./recordScalarLowering";
import { scalarTypeOfDslValueType } from "../dsl/dslValueTypes";
import { hasGeometryBuiltinCall, resolveBuiltinGeometryArguments, type ResolveBuiltinGeometryArgumentsInput } from "./builtinGeometryArgumentResolution";
import { resolveSourceLexicalPath, type SourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import { isGeometryDeclarationCategory } from "../dsl/dslConstructions";

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

/** Scalar numeric input owned by one compiled transformation recipe. The
 * recipe id and operation path form the identity; expression equality is
 * retained only as the runtime materializer's integrity check. */
export type CompiledTransformationNumericBinding = {
  recipeId: string;
  parameterPath: string;
  binding: CompiledNumericBinding;
};

export type NumericBindingConsumerReference = {
  occurrenceKey: string;
  reference: CompiledNumericBindingReference;
};

export type NumericBindingCompilation = {
  sourcesByOccurrenceKey: ReadonlyMap<string, CompiledNumericBinding>;
  transformationBindings: readonly CompiledTransformationNumericBinding[];
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
  /** Shared with the later typed-expression path so each candidate is parsed once. */
  scalarParseResult: ReturnType<typeof parseScalarExpression>;
  /** Absent for layout/output/place occurrences. */
  elementId?: ElementId;
  transformationIdentity?: { recipeId: string; parameterPath: string };
};

export const transformationNumericBindingOccurrenceKey = (recipeId: string, parameterPath: string) =>
  JSON.stringify([recipeId, parameterPath]);

export const transformationNumericInputs = (operation: TransformationOperation): readonly {
  parameterPath: string;
  parameterKey: string;
  value: NumericValue;
  argumentKey: string;
}[] => {
  const coordinateInputs = (parameterPath: string, anchor: import("../types/geometry").PointAnchor, argumentKey: string) =>
    anchor.mode === "coordinate"
      ? (["x", "y"] as const).map((axis) => ({
          parameterPath: `${parameterPath}.${axis}`,
          parameterKey: `${parameterPath}:${axis}`,
          value: anchor[axis],
          argumentKey
        }))
      : [];
  switch (operation.kind) {
    case "edge":
      return [{ parameterPath: "intersectionIndex", parameterKey: "intersectionIndex", value: operation.intersectionIndex, argumentKey: "index" }];
    case "extend":
      return coordinateInputs("point", operation.point, "to");
    case "move":
      return [
        ...coordinateInputs("startPoint", operation.startPoint, "from"),
        ...coordinateInputs("endPoint", operation.endPoint, "to"),
        { parameterPath: "scale", parameterKey: "scale", value: operation.scale, argumentKey: "scale" },
        { parameterPath: "angleDeg", parameterKey: "angleDeg", value: operation.angleDeg, argumentKey: "angleDeg" }
      ];
    case "mirrorMove":
      return [
        ...coordinateInputs("axisPoint1", operation.axisPoint1, "axis1"),
        ...coordinateInputs("axisPoint2", operation.axisPoint2, "axis2")
      ];
    case "reverse":
      return [];
  }
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

// Binding occurrences come from the already-parsed scalar AST. The surface
// token scanner cannot distinguish a value reference from a call head, label,
// string, or choice literal, and its legacy binding form also assumes `@`.
// Keep collection order aligned with recordScalarLowering's AST walk so each
// occurrence receives its canonical resolution exactly once.
const referencesIn = (ast: ScalarExpressionAst | null, source: string, outer: DslSpan): CandidateReference[] => {
  if (!ast) return [];
  return collectScalarExpressionReferences(ast, { includeLocalBindings: true })
    .filter((reference) => reference.localBindingName === undefined)
    .map((reference) => {
      // The shared collector's legacy collection-index span included the `@`
      // plus one following character. In this source contract the binding
      // token is the bare path itself; trim that `[` from the old sidecar range.
      const spanEnd = source.slice(reference.span.start, reference.span.end).endsWith("[")
        ? reference.span.end - 1
        : reference.span.end;
      const span = { start: outer.start + reference.span.start, end: outer.start + spanEnd };
      return { name: reference.name, span, nameSpan: span };
    });
};

const sourceNameSpanInExpression = (
  source: string,
  expression: string,
  sourceNameSpan: DslSpan
): DslSpan | null => {
  const name = source.slice(sourceNameSpan.start, sourceNameSpan.end);
  if (!name) return null;
  if (expression.slice(sourceNameSpan.start, sourceNameSpan.end) === name) return sourceNameSpan;

  // Numeric normalization can replace a geometry token before this binding
  // with a stable element id. Use the already-parsed source span plus its
  // unchanged local context to project the AST occurrence into that IR.
  for (let width = 0; width <= 24; width += 1) {
    const before = source.slice(Math.max(0, sourceNameSpan.start - width), sourceNameSpan.start);
    const after = source.slice(sourceNameSpan.end, sourceNameSpan.end + width);
    const context = `${before}${name}${after}`;
    const matches: number[] = [];
    let from = 0;
    while (from <= expression.length - context.length) {
      const found = expression.indexOf(context, from);
      if (found < 0) break;
      matches.push(found + before.length);
      from = found + 1;
    }
    if (matches.length === 1) return { start: matches[0]!, end: matches[0]! + name.length };
  }
  return null;
};

/** Binding references in lazy controller positions are still dependencies of
 * the numeric occurrence, but their declared type is checked by the shared
 * scalar expression typechecker rather than by the numeric value-position
 * guard below. */
const controllerReferenceSpansIn = (ast: ScalarExpressionAst | null): ReadonlySet<string> => {
  const spans = new Set<string>();
  const collect = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "reference":
        spans.add(`${node.span.start}:${node.span.end}`);
        return;
      case "geometryProperty":
        if (node.occurrenceIndex) collect(node.occurrenceIndex);
        return;
      case "recordFieldCollectionIndex":
        if (node.receiver.occurrenceIndex) collect(node.receiver.occurrenceIndex);
        collect(node.index);
        return;
      case "unary":
        collect(node.operand);
        return;
      case "binary":
        collect(node.left);
        collect(node.right);
        return;
      case "group":
        collect(node.expression);
        return;
      case "valueIf":
        collect(node.condition);
        collect(node.thenBranch);
        if (node.elseBranch) collect(node.elseBranch);
        return;
      case "valueMatch":
        collect(node.scrutinee);
        node.arms.forEach((arm) => collect(arm.expression));
        return;
      case "collectionIndex":
        collect(node.index);
        return;
      case "call":
        node.args.forEach((argument) => collect(argument.expression));
        return;
      default:
        return;
    }
  };
  const visitControllerOperand = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "valueIf":
        collect(node.condition);
        visit(node.thenBranch);
        if (node.elseBranch) visit(node.elseBranch);
        return;
      case "valueMatch":
        collect(node.scrutinee);
        node.arms.forEach((arm) => visit(arm.expression));
        return;
      case "binary":
        if (node.operator === "??") {
          visitControllerOperand(node.left);
          visit(node.right);
          return;
        }
        collect(node);
        return;
      default:
        collect(node);
        return;
    }
  };
  const visit = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "valueIf":
        collect(node.condition);
        visit(node.thenBranch);
        if (node.elseBranch) visit(node.elseBranch);
        return;
      case "valueMatch":
        collect(node.scrutinee);
        node.arms.forEach((arm) => visit(arm.expression));
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        if (node.operator === "??") {
          visitControllerOperand(node.left);
          visit(node.right);
          return;
        }
        visit(node.left);
        visit(node.right);
        return;
      case "group":
        visit(node.expression);
        return;
      case "collectionIndex":
        visit(node.index);
        return;
      case "recordFieldCollectionIndex":
        if (node.receiver.occurrenceIndex) visit(node.receiver.occurrenceIndex);
        visit(node.index);
        return;
      case "call":
        node.args.forEach((argument) => visit(argument.expression));
        return;
      default:
        return;
    }
  };
  if (ast) visit(ast);
  return spans;
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
  layouts, layoutIdsByStatementIndex, includeStatement, additionalGeometryPropertyResolver,
  resolveGeometryStageSelection, transformationRecipes, materializedNumericBindings, sourceNamespace, additionalGeometryResolver
}: {
  statements: readonly DslStatement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
  bindingAnalysis: BindingAnalysis;
  sourceNamespace?: SourceLexicalNamespaceIndex;
  additionalGeometryResolver?: (input: Parameters<NonNullable<ResolveBuiltinGeometryArgumentsInput["additionalGeometryResolver"]>>[0] & {
    statementIndex: number;
  }) => ReturnType<NonNullable<ResolveBuiltinGeometryArgumentsInput["additionalGeometryResolver"]>>;
  spans: DiagnosticSpanContext;
  /** Source layouts are the only output-time numeric model in SAY-63. */
  layouts?: readonly Layout[];
  layoutIdsByStatementIndex?: ReadonlyMap<number, string>;
  includeStatement?: DslStatementInclusion;
  additionalGeometryPropertyResolver?: (input: {
    statementIndex: number;
    node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>;
  }) => import("./typedExpressionAst").ScalarExpressionResolvedGeometryProperty | null;
  resolveGeometryStageSelection?: (input: { elementId: ElementId; useStatementIndex: number; members: readonly string[] }) => TransformationStageSelection;
  /** Root recipes are supplied after transformation lowering has established
   * stable ids and operation paths. Module recipes use per-instance semantic
   * targets from the Module scalar runtime. */
  transformationRecipes?: readonly TransformationRecipe[];
  /** Already lowered by the canonical Module/source semantic owner. */
  materializedNumericBindings?: readonly { elementId: ElementId; binding: CompiledNumericBinding }[];
}): NumericBindingCompilation => {
  const materializedKeys = new Set((materializedNumericBindings ?? [])
    .filter(entry => entry.binding.typedExpression)
    .map(entry => JSON.stringify([entry.elementId, entry.binding.parameterKey])));
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sourceOrderByElementId = new Map<ElementId, number>();
  for (const [sourceOrder, elementId] of elementIdByStatementIndex) sourceOrderByElementId.set(elementId, sourceOrder);
  const nameContext = createElementNameContext([...elements]);
  const layoutById = new Map((layouts ?? []).map((layout) => [layout.id, layout]));
  const candidates: Candidate[] = [];
  const requests: SiteReferenceRequest[] = [];
  const recipeByStatementIndex = new Map((transformationRecipes ?? []).map((recipe) => [recipe.sourceStatementIndex, recipe] as const));

  const pushCandidate = (
    key: string,
    statement: DslStatement,
    statementIndex: number,
    parameterKey: string,
    value: NumericValue | undefined,
    logicalText: string,
    valueSpan: DslSpan | null,
    elementId?: ElementId,
    transformationIdentity?: { recipeId: string; parameterPath: string }
  ) => {
    if (!value || !isNumericExpression(value) || !valueSpan) return;
    const source = logicalText.slice(valueSpan.start, valueSpan.end);
    const scalarParseResult = parseScalarExpression(source, { start: 0, end: source.length });
    const refs = referencesIn(scalarParseResult.ast, source, valueSpan);
    candidates.push({
      key,
      statement,
      statementIndex,
      parameterKey,
      expression: value.expression,
      source: logicalText.slice(valueSpan.start, valueSpan.end),
      valueSpan,
      references: refs,
      scalarParseResult,
      elementId,
      transformationIdentity
    });
    const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
    refs.forEach((reference, index) => requests.push({
      key: `${key}:${index}`,
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
        if (materializedKeys.has(JSON.stringify([element.id, definition.key]))) continue;
        const value = getParameterValue(element, definition.key) as NumericValue | undefined;
        const valueSpan = resolveParameterValueSpan(logical.logicalText, element, definition.key, {
          committedLineText: logical.logicalText
        });
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

    if (statement.kind === "transformation") {
      const recipe = recipeByStatementIndex.get(statementIndex);
      const logical = spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
      if (!recipe || !logical) return;
      for (const input of transformationNumericInputs(recipe.operation)) {
        const argumentSpan = attributeValueSpan(statement, input.argumentKey);
        if (!argumentSpan) continue;
        const axis = input.parameterPath.endsWith(".x") ? "x" : input.parameterPath.endsWith(".y") ? "y" : undefined;
        const valueSpan = axis ? coordinateComponent(logical.logicalText, argumentSpan, axis) : argumentSpan;
        if (!valueSpan) continue;
        const key = transformationNumericBindingOccurrenceKey(recipe.id, input.parameterPath);
        pushCandidate(
          key,
          statement,
          statementIndex,
          input.parameterKey,
          input.value,
          logical.logicalText,
          valueSpan,
          undefined,
          { recipeId: recipe.id, parameterPath: input.parameterPath }
        );
      }
    }
  });

  const resolutions = resolveReferencesAtSites(bindingAnalysis.catalog, requests);
  const sourcesByOccurrenceKey = new Map<string, CompiledNumericBinding>();
  const transformationBindings: CompiledTransformationNumericBinding[] = [];
  const diagnostics: DslDiagnostic[] = [];
  const sourceDeclarationsByStatementId = new Map(sourceNamespace?.allDeclarations.map(declaration => [declaration.statementId, declaration]));
  const runtimeGeometryTarget = (target: ScalarExpressionResolvedGeometryTarget | null): ScalarExpressionResolvedGeometryTarget | null => {
    if (!target || (target.kind !== undefined && target.kind !== "drawable") || byId.has(target.statementId)) return target;
    const declaration = sourceDeclarationsByStatementId.get(target.statementId);
    const elementId = declaration ? elementIdByStatementIndex.get(declaration.statementIndex) : undefined;
    return elementId ? { ...target, statementId: elementId } : target;
  };
  for (const candidate of candidates) {
    // Only construction numeric sites gain direct geometry calls. Resolve
    // their operands through the same typed owner as scalar declarations;
    // retain its identities instead of sending source names to the legacy parser.
    const geometryResolution = candidate.elementId && candidate.statement.kind === "element" &&
      isGeometryDeclarationCategory(candidate.statement.category) &&
      candidate.statement.category !== "text" && candidate.statement.category !== "image" &&
      hasGeometryBuiltinCall(candidate.source) && candidate.scalarParseResult.ast
      ? resolveBuiltinGeometryArguments({
          ast: candidate.scalarParseResult.ast,
          statementIndex: candidate.statementIndex,
          scalarReferenceResolutions: candidate.references.map((_, index) => resolutions.get(`${candidate.key}:${index}`)!),
          sourceDeclarationsByStatementId,
          additionalGeometryResolver: additionalGeometryResolver
            ? input => additionalGeometryResolver({ ...input, statementIndex: candidate.statementIndex })
            : undefined,
          resolveSourceGeometryPath: sourceNamespace
            ? name => resolveSourceLexicalPath(sourceNamespace, candidate.statementIndex, parseDslReferenceToken(name))
            : undefined,
          resolveGeometryStageSelection: ({ statementId, members }) => {
            const declaration = sourceDeclarationsByStatementId.get(statementId);
            const elementId = declaration ? elementIdByStatementIndex.get(declaration.statementIndex) : undefined;
            return elementId && resolveGeometryStageSelection
              ? resolveGeometryStageSelection({ elementId, members, useStatementIndex: candidate.statementIndex })
              : { stagePath: ["final"], propertyPath: members };
          }
        })
      : undefined;
    if (geometryResolution?.issues.length) {
      diagnostics.push(...geometryResolution.issues.map(issue => diagnosticAt(spans, candidate.statement, {
        start: candidate.valueSpan.start + issue.span.start,
        end: candidate.valueSpan.start + issue.span.end
      }, issue.code, issue.message, issue.presentation)));
      continue;
    }
    // Numeric iteration bindings use the same canonical typed path as other
    // scalar bindings. Non-numeric geometry positions are rejected by the
    // declared-type check below rather than falling through to ordinal lookup.
    const hasLegacyOwnedReference = candidate.references.some((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      return resolution?.kind === "resolved" && resolution.binding.kind !== "typed" &&
        !(resolution.binding.kind === "iteration" && scalarTypeOfDslValueType(resolution.binding.declaredType)?.kind === "number");
    });
    const hasNumericIterationReference = candidate.references.some((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      return resolution?.kind === "resolved" && resolution.binding.kind === "iteration" &&
        scalarTypeOfDslValueType(resolution.binding.declaredType)?.kind === "number";
    });
    const hasOtherCanonicalReference = candidate.references.some((_, index) => {
      const resolution = resolutions.get(`${candidate.key}:${index}`);
      return resolution?.kind === "resolved" && !(
        resolution.binding.kind === "iteration" &&
        scalarTypeOfDslValueType(resolution.binding.declaredType)?.kind === "number"
      );
    });

    let rejected = false;
    const controllerReferenceSpans = controllerReferenceSpansIn(candidate.scalarParseResult.ast);
    const typedRefs: { reference: CandidateReference; bindingId: BindingId }[] = [];
    candidate.references.forEach((reference, index) => {
      if (geometryResolution?.claimedReferenceOccurrenceIndexes.has(index)) return;
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
        if (resolution.kind === "namespace" && resolution.declarationKind === "moduleInstance" && reference.name.includes("::")) {
          const issue = namespaceResolutionDiagnostic(reference.name, resolution);
          if (issue) diagnostics.push(diagnosticAt(
            spans,
            candidate.statement,
            reference.span,
            issue.code,
            issue.message
          ));
        }
        // Binding analysis already emits the duplicate/self invalidation
        // diagnostic. Namespace results use the same diagnostic mapping as
        // typed declarations because numeric occurrences are not initializer
        // references in BindingAnalysis.
        rejected = true;
        return;
      }
      const binding = resolution.binding;
      if (binding.kind === "typed") {
        const entry = bindingAnalysis.entriesById.get(binding.id);
        if (entry?.status.kind === "invalid") { rejected = true; return; } // binding diagnostics already own this cause.
      }
      const declaredType = scalarTypeOfDslValueType(binding.declaredType);
      const isControllerReference = controllerReferenceSpans.has(`${reference.span.start - candidate.valueSpan.start}:${reference.span.end - candidate.valueSpan.start}`);
      if (declaredType?.kind !== "number" && !isControllerReference) {
        diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          reference.span,
          NUMERIC_BINDING_TYPE_MISMATCH_CODE,
          `型が一致しません(期待: number, 実際: ${declaredType?.kind ?? "unknown"})。`,
          {
            key: "diagnostic.numeric-binding-type-mismatch",
            parameters: { expected: "number", actual: declaredType?.kind ?? "unknown" }
          }
        ));
        rejected = true;
        return;
      }
      typedRefs.push({ reference, bindingId: binding.id });
    });
    if (rejected) {
      // Malformed calls may leave extra geometry operands outside the
      // resolver's recovered signature. Preserve the shared typechecker's
      // arity/calling-style diagnostics instead of silently dropping the call.
      if (geometryResolution && candidate.scalarParseResult.ast) {
        const checked = typecheckScalarExpression(candidate.scalarParseResult.ast, {
          expectedType: { kind: "number" },
          references: geometryResolution.references,
          geometryBuiltinArguments: geometryResolution.geometryPropertyTargets,
          geometryEndpointArguments: geometryResolution.geometryEndpointTargets
        });
        diagnostics.push(...checked.diagnostics.filter(issue => issue.code.startsWith("function-")).map(issue =>
          diagnosticAt(spans, candidate.statement, {
            start: candidate.valueSpan.start + issue.span.start,
            end: candidate.valueSpan.start + issue.span.end
          }, issue.code, issue.message, issue.presentation)));
      }
      continue;
    }
    const typedResolutions = geometryResolution?.references.map(reference => reference.kind === "resolvedGeometry"
      ? { ...reference, target: runtimeGeometryTarget(reference.target) } : reference) ??
      candidate.references.map((_, index) => resolutions.get(candidate.key + ":" + index));
    const scalarTypecheckReferences: (BindingResolution | ScalarExpressionResolvedReference)[] = typedResolutions.map((resolution) => resolution!);
    const canTypecheckScalarReferences = scalarTypecheckReferences.every((resolution) =>
      resolution.kind === "resolved" || resolution.kind === "resolvedType" || resolution.kind === "resolvedGeometry"
    );
    let typedExpression: TypedScalarExpression | undefined;
    let typedReferenceSpans: { name: string; span: { start: number; end: number } }[] = [];
    if (canTypecheckScalarReferences) {
      // Typecheck the authored DSL spelling. Numeric normalization may replace
      // geometry path names with stable ids, which can shift later offsets;
      // source AST ranges remain authoritative for diagnostics and identities.
      const typedParsed = candidate.scalarParseResult;
      if (!typedParsed.ast) {
        const issue = typedParsed.diagnostics[0];
        // Legacy measurement/function syntax remains owned by the numeric
        // evaluator when no standalone typed route is possible.
        if (issue && typedRefs.length > 0) diagnostics.push(diagnosticAt(
          spans,
          candidate.statement,
          { start: candidate.valueSpan.start + issue.span.start, end: candidate.valueSpan.start + issue.span.end },
          issue.code,
          issue.message
        ));
        if (typedRefs.length === 0 || !hasLegacyOwnedReference) continue;
      } else {
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
            currentSourceOrder: candidate.statementIndex,
            skipPropertySpanStarts: new Set([
              ...(geometryResolution?.geometryPropertyTargets.keys() ?? []),
              ...(geometryResolution?.geometryEndpointTargets.keys() ?? [])
            ]),
            additionalGeometryPropertyResolver: additionalGeometryPropertyResolver
              ? ({ node }) => additionalGeometryPropertyResolver({ statementIndex: candidate.statementIndex, node })
              : undefined,
            resolveStageSelection: resolveGeometryStageSelection
          }
        );
        const hasGeometryProperty = geometryPropertyResolution.geometryPropertyReferences.size > 0;
        // Preserve the established source-splice route for mixed scalar
        // expressions: adding a canonical iteration occurrence must not move
        // existing fallback references into the typed evaluator.
        const hasMixedIterationExpression = hasNumericIterationReference && hasOtherCanonicalReference;
        const typedChecked = typecheckScalarExpression(prepared.ast, {
          expectedType: { kind: "number" },
          references: prepared.references,
          geometryBuiltinArguments: geometryResolution && new Map([...geometryResolution.geometryPropertyTargets]
            .map(([span, target]) => [span, runtimeGeometryTarget(target)])),
          geometryEndpointArguments: geometryResolution && new Map([...geometryResolution.geometryEndpointTargets]
            .map(([span, endpoint]) => [span, { ...endpoint, target: runtimeGeometryTarget(endpoint.target) }])),
          geometryPropertyReferences: geometryPropertyResolution.geometryPropertyReferences
        });
        if (typedChecked.diagnostics.length > 0 || typedChecked.type === null) {
          const hasInvalidChoiceLiteral = typedChecked.diagnostics.some((issue) => issue.code === "invalid-choice-literal");
          if (geometryResolution || hasLegacyOwnedReference || hasGeometryProperty || hasInvalidChoiceLiteral) {
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
                nameSpan: span,
                exposeSemanticOccurrence: false
              },
              bindingId: dependency.bindingId
            });
          }
          typedRefs.sort((left, right) => left.reference.span.start - right.reference.span.start);
        }
        if (
          (hasGeometryProperty || !hasLegacyOwnedReference) &&
          !hasMixedIterationExpression &&
          geometryPropertyResolution.issues.length === 0 &&
          typedChecked.type?.kind === "number"
        ) {
          typedExpression = typedChecked.typed;
        }
      }
    }
    if (candidate.scalarParseResult.ast && typedRefs.length > 0) {
      typedReferenceSpans = typedRefs.flatMap(({ reference }) => {
        const sourceNameSpan = {
          start: reference.nameSpan.start - candidate.valueSpan.start,
          end: reference.nameSpan.end - candidate.valueSpan.start
        };
        if (candidate.source.slice(sourceNameSpan.start, sourceNameSpan.end) !== reference.name) return [];
        const expressionSpan = sourceNameSpanInExpression(candidate.source, candidate.expression, sourceNameSpan);
        if (!expressionSpan) return [];
        return [{ name: reference.name, span: expressionSpan }];
      }).sort((left, right) => left.span.start - right.span.start);
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
      const expressionToken = expressionStart === undefined || expressionEnd === undefined
        ? undefined
        : candidate.expression.slice(expressionStart, expressionEnd);
      if (expressionStart === undefined || expressionEnd === undefined ||
          expressionToken !== reference.name) {
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
      if (candidate.transformationIdentity && references.length === 0) continue;
      const binding: CompiledNumericBinding = {
        parameterKey: candidate.parameterKey,
        expression: candidate.expression,
        references,
        ...(typedExpression ? { typedExpression } : {})
      };
      if (candidate.transformationIdentity) {
        transformationBindings.push({ ...candidate.transformationIdentity, binding });
      } else {
        sourcesByOccurrenceKey.set(candidate.key, binding);
      }
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
  return { sourcesByOccurrenceKey, transformationBindings, consumerReferencesByBindingId, diagnostics };
};
