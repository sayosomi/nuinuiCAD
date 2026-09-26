// Static typed dependency projection for Task 36. This consumes compiler
// records only: it deliberately never parses DSL source || resolves names.
import type { DslSpan } from "../dsl/dslTypes";
import { effectiveElementActivityById } from "../model/elementActivity";
import type {
  CadElement,
  DrawingModifierDefinition,
  ElementId,
  GeometryInputCollectionNode,
  GeometryInputTarget,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { getDirectParentIds } from "../model/dependencies";
import type { BindingAnalysis, BindingIssue } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import type { BindingVersionGraph } from "./bindingVersions";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import type { TextTemplateAst } from "./textTemplate";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarProgram } from "./scalarProgram";
import type { TransformationOperation, TransformationRecipe, TransformationTargetSelector } from "../dsl/transformationRecipes";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { GeometryValueProgramEntry, GeometryValueProgramNode, GeometryValueProgramPoint, GeometryValueProgramPath, GeometryValueProgramTarget } from "../dsl/moduleGeometryValueProgram";
import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";
import type { GeometryValueOccurrence } from "../model/cadDocumentTypes";

export type TypedDependencyReason = "missing" | "invalid" | "disabled";
export type TypedDependencyKind = "initializer" | "geometry" | "geometry-property" | "property-binding" | "numeric-expression" | "template-hole";
export type TypedDependencyRequiredness = "required" | "conditional";
export type TypedDependencyActivationGuard = {
  controllerId: string;
  branch: string;
  /** Geometry-value coalesce selects its fallback after the left expression
   * has been evaluated. Other guarded edges use the typed scalar controller. */
  controllerKind?: "scalar" | "geometry-value-coalesce";
  /** Literal control-flow facts are compiler-owned. Dynamic controls remain
   * conditional until the typed evaluator reaches the controller. */
  staticSelection?: "selected" | "unselected";
  /** The compiler-owned controller AST for dynamic runtime activation. */
  controllerExpression?: TypedScalarExpression;
};

export type TypedDependencyActivation = {
  /** Guards are ordered from the outermost lazy expression to the innermost. */
  guards: readonly TypedDependencyActivationGuard[];
};

export type TypedDependencyEndpoint =
  | { kind: "binding"; id: BindingId; name: string; statementIndex: number; span: DslSpan | null }
  | { kind: "version"; id: string; bindingId: BindingId; statementIndex: number }
  | { kind: "element"; id: ElementId; name: string; statementIndex: number }
  | {
      kind: "geometry-stage";
      id: string;
      ownerId: ElementId;
      name: string;
      stagePath: readonly string[];
      occurrenceIndex?: string;
      statementIndex: number;
    }
  | {
      kind: "transformation-recipe";
      id: string;
      name: string;
      ownerId: ElementId;
      branchKey: string;
      statementIndex: number;
    }
  | { kind: "module-occurrence"; id: string; name: string; statementIndex: number }
  | { kind: "geometry-value"; id: string; name: string; statementIndex: number }
  | { kind: "missing"; id: string; name: string; statementIndex: number };

export type TypedDependencyEdge = {
  kind: TypedDependencyKind;
  from: TypedDependencyEndpoint;
  to: TypedDependencyEndpoint;
  span: DslSpan | null;
  reason?: TypedDependencyReason;
  /** Conditional edges remain in the canonical graph but are activated only
   * after the controlling value/scrutinee selects their branch. */
  requiredness?: TypedDependencyRequiredness;
  activation?: TypedDependencyActivation;
};

export type TypedTransformationDependency = {
  ownerId: ElementId;
  stagePath: readonly string[];
  occurrenceIndex?: string;
};

/** Compiler-owned runtime facts for one transformation recipe. Evaluators
 * consume this plan; they do not rediscover operation argument dependencies
 * or same-branch predecessor ordering from recipe payloads. */
export type TypedTransformationDependencyPlan = {
  recipeId: string;
  recipeIndex: number;
  branchKey: string;
  branchKeys?: readonly string[];
  statementIndex: number;
  ownerIds: readonly ElementId[];
  prerequisites: readonly TypedTransformationDependency[];
  argumentDependencies: readonly TypedTransformationDependency[];
  predecessorRecipeIndices: readonly number[];
  outputStages: readonly TypedTransformationDependency[];
};

export type TypedDependencyGraph = {
  edges: readonly TypedDependencyEdge[];
  directByEndpointId: ReadonlyMap<string, readonly TypedDependencyEdge[]>;
  reverseByEndpointId: ReadonlyMap<string, readonly TypedDependencyEdge[]>;
  /** Stable dependency-first order for drawable/runtime element evaluation. */
  evaluationOrder: readonly ElementId[];
  /** Explicit strongly connected components, retained for diagnostics and tooling. */
  cycles: readonly TypedDependencyCycle[];
  /** Recipe/stage plan consumed by both reference and Rust evaluators. */
  transformationPlans: readonly TypedTransformationDependencyPlan[];
  /** Compiler-owned baseline endpoint rank for each immutable geometry value.
   * Runtime conditional activation projects the selected rank from this graph. */
  geometryValueExecutionPositionByOccurrence: ReadonlyMap<string, number>;
};

export type TypedDependencyBranchSelection = ReadonlyMap<string, string>;

export type TypedDependencyCycle = {
  endpointIds: readonly string[];
  names: readonly string[];
  statementIndices: readonly number[];
};

export type TypedDependencyGraphInput = {
  elements: readonly CadElement[];
  drawingModifiers?: readonly DrawingModifierDefinition[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  bindingAnalysis?: BindingAnalysis;
  bindingVersions?: BindingVersionGraph;
  propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  numericBindings?: ReadonlyMap<string, CompiledNumericBinding>;
  textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  scalarProgram?: ScalarProgram;
  conditionalGroupConditions?: ReadonlyMap<string, TypedScalarExpression>;
  geometryInputTargets?: ReadonlyMap<ElementId, ReadonlyMap<string, GeometryInputTarget | readonly GeometryInputTarget[]>>;
  /** Construction-input aliases may legitimately lower to a consumer's own
   * original input expression. Keep that self edge in the canonical graph so
   * alias cycles use the ordinary SCC diagnosis; ordinary geometry self reads
   * retain their established semantic handling. */
  constructionInputConsumerElementIds?: ReadonlySet<ElementId>;
  transformationRecipes?: readonly TransformationRecipe[];
  geometryValueProgram?: readonly GeometryValueProgramEntry[];
  /** Language Core's resolved export facts for Module-owned immutable values. */
  moduleExportedGeometryValueStatementIds?: ReadonlySet<string>;
  moduleMaterialization?: Pick<ModuleMaterialization, "instanceBaseGeometrySnapshots" | "executionStatements">;
};

const endpointId = (endpoint: TypedDependencyEndpoint) => `${endpoint.kind}:${endpoint.id}`;

const bindingEndpoint = (analysis: BindingAnalysis, bindingId: BindingId): TypedDependencyEndpoint => {
  const binding = analysis.catalog.bindingsById.get(bindingId);
  if (!binding) throw new Error(`typedDependencyGraph: missing catalog binding ${bindingId}`);
  return { kind: "binding", id: binding.id, name: binding.name, statementIndex: binding.statementIndex, span: binding.nameSpan };
};

const elementEndpoint = (
  elementsById: ReadonlyMap<ElementId, CadElement>,
  elementId: ElementId,
  statementIndex: number
): TypedDependencyEndpoint => {
  const element = elementsById.get(elementId);
  return { kind: "element", id: elementId, name: element?.name ?? elementId, statementIndex };
};

const issueReason = (issue: BindingIssue): TypedDependencyReason => {
  if (issue.code === "undefined-binding") return "missing";
  return "invalid";
};

const staticDisabledBindingIds = (
  analysis: BindingAnalysis,
  elements: readonly CadElement[],
  drawingModifiers: readonly DrawingModifierDefinition[] = []
): ReadonlySet<BindingId> => {
  const activities = effectiveElementActivityById(elements, drawingModifiers);
  const disabled = new Set<BindingId>();
  for (const binding of analysis.catalog.bindings) {
    const ownerId = analysis.catalog.containerIndex.ownerContainerIdByStatementIndex.get(binding.statementIndex);
    if (ownerId && activities.get(ownerId)?.activity === "disabled") disabled.add(binding.id);
  }
  return disabled;
};

/** Shared with Task 37's rename occurrence gathering (src/scalars/typedRenameOccurrences.ts) - the sole reference-node walker for a typed AST, never forked. */
type TypedDependencyReferenceNode = Extract<TypedScalarExpression, { kind: "reference" }> & { readonly lazy?: boolean; readonly activation?: TypedDependencyActivation };
type TypedDependencyGeometryPropertyNode = Extract<TypedScalarExpression, { kind: "geometryProperty" }> & { readonly lazy?: boolean; readonly activation?: TypedDependencyActivation };

const appendActivationGuard = (
  activation: TypedDependencyActivation | undefined,
  guard: TypedDependencyActivationGuard
): TypedDependencyActivation => ({
  guards: [...(activation?.guards ?? []), guard]
});

const scopeActivationToSource = (
  activation: TypedDependencyActivation | undefined,
  source: TypedDependencyEndpoint,
  occurrenceNamespace?: string
): TypedDependencyActivation | undefined => activation
  ? {
      guards: activation.guards.map((guard) => ({
        ...guard,
        controllerId: `${endpointId(source)}${occurrenceNamespace !== undefined ? `\u0000${occurrenceNamespace}` : ""}\u0000${guard.controllerId}`
      }))
    }
  : undefined;

export const referencesIn = (expression: TypedScalarExpression): readonly TypedDependencyReferenceNode[] => {
  const result: TypedDependencyReferenceNode[] = [];
  const visit = (node: TypedScalarExpression, lazy = false, activation?: TypedDependencyActivation): void => {
    if (node.kind === "reference") result.push({ ...node, ...(lazy ? { lazy: true } : {}), ...(activation ? { activation } : {}) });
    else if (node.kind === "unary") visit(node.operand, lazy, activation);
    else if (node.kind === "binary") {
      visit(node.left, lazy, activation);
      if (node.operator === "??") {
        const rightSelection = node.left.kind === "noneLiteral" ? "selected" :
          node.left.kind === "numberLiteral" || node.left.kind === "stringLiteral" || node.left.kind === "booleanLiteral" || node.left.kind === "choiceLiteral" ? "unselected" : undefined;
        visit(node.right, true, appendActivationGuard(activation, {
          controllerId: `scalar:${node.span.start}`,
          branch: "right",
          ...(rightSelection ? { staticSelection: rightSelection } : { controllerExpression: node.left })
        }));
      } else visit(node.right, lazy, activation);
    }
    else if (node.kind === "group") visit(node.expression, lazy, activation);
    else if (node.kind === "valueIf") {
      visit(node.condition, lazy, activation);
      const selection = node.condition.kind === "booleanLiteral" ? node.condition.value : undefined;
      visit(node.thenBranch, true, appendActivationGuard(activation, {
        controllerId: `scalar:${node.span.start}`,
        branch: "then",
        ...(selection === undefined ? { controllerExpression: node.condition } : { staticSelection: selection ? "selected" : "unselected" })
      }));
      visit(node.elseBranch, true, appendActivationGuard(activation, {
        controllerId: `scalar:${node.span.start}`,
        branch: "else",
        ...(selection === undefined ? { controllerExpression: node.condition } : { staticSelection: selection ? "unselected" : "selected" })
      }));
    }
    else if (node.kind === "valueMatch") {
      visit(node.scrutinee, lazy, activation);
      const selectedLabel = node.scrutinee.kind === "choiceLiteral" ? node.scrutinee.value : undefined;
      node.arms.forEach((arm) => visit(arm.expression, true, appendActivationGuard(activation, {
        controllerId: `scalar:${node.span.start}`,
        branch: `match:${arm.label}`,
        ...(selectedLabel === undefined
          ? { controllerExpression: node.scrutinee }
          : { staticSelection: arm.label === selectedLabel ? "selected" : "unselected" })
      })));
    }
    else if (node.kind === "collectionIndex") visit(node.index, lazy, activation);
    else if (node.kind === "geometryProperty" && node.forGroupOccurrenceIndex) visit(node.forGroupOccurrenceIndex, lazy, activation);
    else if (node.kind === "call") node.args.forEach((argument) => {
      if (argument.kind === "scalar") visit(argument.expression, lazy, activation);
    });
  };
  visit(expression);
  return result;
};

export const geometryPropertiesIn = (expression: TypedScalarExpression): readonly TypedDependencyGeometryPropertyNode[] => {
  const result: TypedDependencyGeometryPropertyNode[] = [];
  const visit = (node: TypedScalarExpression, lazy = false, activation?: TypedDependencyActivation): void => {
    if (node.kind === "geometryProperty") {
      result.push({ ...node, ...(lazy ? { lazy: true } : {}), ...(activation ? { activation } : {}) });
      if (node.forGroupOccurrenceIndex) visit(node.forGroupOccurrenceIndex, lazy, activation);
    }
    else if (node.kind === "unary") visit(node.operand, lazy, activation);
    else if (node.kind === "binary") {
      visit(node.left, lazy, activation);
      if (node.operator === "??") {
        const rightSelection = node.left.kind === "noneLiteral" ? "selected" :
          node.left.kind === "numberLiteral" || node.left.kind === "stringLiteral" || node.left.kind === "booleanLiteral" || node.left.kind === "choiceLiteral" ? "unselected" : undefined;
        visit(node.right, true, appendActivationGuard(activation, {
          controllerId: `scalar:${node.span.start}`,
          branch: "right",
          ...(rightSelection ? { staticSelection: rightSelection } : { controllerExpression: node.left })
        }));
      } else visit(node.right, lazy, activation);
    }
    else if (node.kind === "group") visit(node.expression, lazy, activation);
    else if (node.kind === "valueIf") {
      visit(node.condition, lazy, activation);
      const selection = node.condition.kind === "booleanLiteral" ? node.condition.value : undefined;
      visit(node.thenBranch, true, appendActivationGuard(activation, {
        controllerId: `scalar:${node.span.start}`,
        branch: "then",
        ...(selection === undefined ? { controllerExpression: node.condition } : { staticSelection: selection ? "selected" : "unselected" })
      }));
      visit(node.elseBranch, true, appendActivationGuard(activation, {
        controllerId: `scalar:${node.span.start}`,
        branch: "else",
        ...(selection === undefined ? { controllerExpression: node.condition } : { staticSelection: selection ? "unselected" : "selected" })
      }));
    }
    else if (node.kind === "valueMatch") {
      visit(node.scrutinee, lazy, activation);
      const selectedLabel = node.scrutinee.kind === "choiceLiteral" ? node.scrutinee.value : undefined;
      node.arms.forEach((arm) => visit(arm.expression, true, appendActivationGuard(activation, {
        controllerId: `scalar:${node.span.start}`,
        branch: `match:${arm.label}`,
        ...(selectedLabel === undefined
          ? { controllerExpression: node.scrutinee }
          : { staticSelection: arm.label === selectedLabel ? "selected" : "unselected" })
      })));
    }
    else if (node.kind === "collectionIndex") visit(node.index, lazy, activation);
    else if (node.kind === "call") node.args.forEach((argument) => {
      if (argument.kind === "scalar") visit(argument.expression, lazy, activation);
    });
  };
  visit(expression);
  return result;
};

type GeometryValueProgramDependency = {
  kind: "target";
  target: GeometryValueProgramTarget;
  guards: readonly TypedDependencyActivationGuard[];
} | {
  kind: "scalar";
  expression: TypedScalarExpression;
  guards: readonly TypedDependencyActivationGuard[];
};

/** Walk the compiler-owned geometry-value AST by its declared node shapes.
 * This preserves control-flow activation instead of treating branch payloads
 * as an unconditional structural object graph. */
const geometryValueProgramDependencies = (
  entry: GeometryValueProgramEntry
): readonly GeometryValueProgramDependency[] => {
  const dependencies: GeometryValueProgramDependency[] = [];
  const scalar = (expression: TypedScalarExpression, guards: readonly TypedDependencyActivationGuard[]) => {
    dependencies.push({ kind: "scalar", expression, guards });
  };
  const target = (
    value: GeometryValueProgramPoint | GeometryValueProgramPath,
    guards: readonly TypedDependencyActivationGuard[]
  ) => {
    if (value.kind === "target") dependencies.push({ kind: "target", target: value.target, guards });
    else {
      scalar(value.x, guards);
      scalar(value.y, guards);
    }
  };
  const pathTarget = (value: GeometryValueProgramPath, guards: readonly TypedDependencyActivationGuard[]) => {
    dependencies.push({ kind: "target", target: value.target, guards });
  };
  const point = (value: GeometryValueProgramPoint, guards: readonly TypedDependencyActivationGuard[]) => target(value, guards);
  const points = (values: readonly GeometryValueProgramPoint[], guards: readonly TypedDependencyActivationGuard[]) => values.forEach((value) => point(value, guards));
  const paths = (values: readonly GeometryValueProgramPath[], guards: readonly TypedDependencyActivationGuard[]) => values.forEach((value) => pathTarget(value, guards));
  const construction = (
    node: GeometryValueProgramNode,
    guards: readonly TypedDependencyActivationGuard[],
    path: readonly string[] = []
  ): void => {
    if (node.kind === "none") return;
    if (node.kind === "reference") {
      dependencies.push({ kind: "target", target: node.target, guards });
      return;
    }
    if (node.kind === "if") {
      scalar(node.condition, guards);
      const selection = node.condition.kind === "booleanLiteral" ? node.condition.value : undefined;
      const controllerId = `geometry-value:${geometryValueOccurrenceKey(entry.occurrence)}:if:${node.condition.span.start}`;
      construction(node.thenBranch, [...guards, {
        controllerId,
        branch: "then",
        ...(selection === undefined
          ? { controllerExpression: node.condition }
          : { staticSelection: selection ? "selected" as const : "unselected" as const })
      }], [...path, "then"]);
      construction(node.elseBranch, [...guards, {
        controllerId,
        branch: "else",
        ...(selection === undefined
          ? { controllerExpression: node.condition }
          : { staticSelection: selection ? "unselected" as const : "selected" as const })
      }], [...path, "else"]);
      return;
    }
    if (node.kind === "match") {
      scalar(node.scrutinee, guards);
      const selected = node.scrutinee.kind === "choiceLiteral" ? node.scrutinee.value : undefined;
      const controllerId = `geometry-value:${geometryValueOccurrenceKey(entry.occurrence)}:match:${node.scrutinee.span.start}`;
      for (const arm of node.arms) construction(arm.expression, [...guards, {
        controllerId,
        branch: `match:${arm.label}`,
        ...(selected === undefined
          ? { controllerExpression: node.scrutinee }
          : { staticSelection: arm.label === selected ? "selected" as const : "unselected" as const })
      }], [...path, `match:${arm.label}`]);
      return;
    }
    if (node.kind === "coalesce") {
      construction(node.left, guards, [...path, "left"]);
      const controllerId = `geometry-value:${geometryValueOccurrenceKey(entry.occurrence)}:coalesce:${JSON.stringify(path)}`;
      construction(node.right, [...guards, {
        controllerId,
        controllerKind: "geometry-value-coalesce",
        branch: "right"
      }], [...path, "right"]);
      return;
    }
    switch (node.kind) {
      case "coordinate": scalar(node.x, guards); scalar(node.y, guards); return;
      case "offsetPoint": point(node.from, guards); scalar(node.dx, guards); scalar(node.dy, guards); return;
      case "polarPoint": point(node.from, guards); scalar(node.angleDeg, guards); scalar(node.distance, guards); return;
      case "between": point(node.start, guards); point(node.end, guards); scalar(node.placement.value, guards); return;
      case "onLine": pathTarget(node.line, guards); scalar(node.placement.value, guards); return;
      case "intersection": pathTarget(node.line1, guards); pathTarget(node.line2, guards); scalar(node.index, guards); scalar(node.extensions, guards); return;
      case "commonTangent": pathTarget(node.first, guards); pathTarget(node.second, guards); scalar(node.tangentKind, guards); scalar(node.side, guards); return;
      case "tangentOffset": pathTarget(node.line, guards); point(node.base, guards); if (node.angleDeg) scalar(node.angleDeg, guards); if (node.curveSide) scalar(node.curveSide, guards); scalar(node.distance, guards); return;
      case "bezierExtremePoint": pathTarget(node.source, guards); scalar(node.segmentIndex, guards); scalar(node.direction, guards); return;
      case "bezierBulgePoint": pathTarget(node.source, guards); scalar(node.segmentIndex, guards); return;
      case "segment": point(node.start, guards); point(node.end, guards); return;
      case "polarLine": point(node.start, guards); scalar(node.angleDeg, guards); scalar(node.length, guards); return;
      case "arc": point(node.center, guards); scalar(node.radius, guards); scalar(node.startAngleDeg, guards); scalar(node.endAngleDeg, guards); scalar(node.direction, guards); return;
      case "through": point(node.point1, guards); point(node.point2, guards); point(node.point3, guards); scalar(node.startAngleDeg, guards); scalar(node.endAngleDeg, guards); return;
      case "bezier":
        point(node.start, guards); point(node.end, guards); scalar(node.startAngleDeg, guards); scalar(node.startLength, guards); scalar(node.endAngleDeg, guards); scalar(node.endLength, guards);
        for (const intermediate of node.intermediates) { point(intermediate.point, guards); scalar(intermediate.angleDeg, guards); scalar(intermediate.incomingLength, guards); scalar(intermediate.outgoingLength, guards); }
        return;
      case "polyline": points(node.points, guards); scalar(node.closed, guards); return;
      case "offsetPath": paths(node.sources, guards); scalar(node.distance, guards); scalar(node.side, guards); scalar(node.closed, guards); scalar(node.suppressTrimWarnings, guards); return;
      case "joinedPath": paths(node.paths, guards); scalar(node.closed, guards); return;
      case "transformCopy": point(node.startPoint, guards); point(node.endPoint, guards); scalar(node.scale, guards); scalar(node.angleDeg, guards); scalar(node.mirrorX, guards); paths(node.baseLines, guards); return;
      case "mirrorCopy": point(node.axis1, guards); point(node.axis2, guards); paths(node.baseLines, guards); return;
    }
  };
  construction(entry.construction, []);
  return dependencies;
};

type TypedNumericBindingReference = {
  typed: TypedDependencyReferenceNode;
  source: CompiledNumericBinding["references"][number];
};

/**
 * Joins the typed scalar reference semantics to the compiler's authored
 * numeric occurrence metadata. The typed walker owns lazy activation, while
 * the compiled occurrence owns the statement-relative diagnostic span.
 *
 * A BindingId may occur more than once in one expression, so matching only by
 * BindingId would be ambiguous. The compiler emits both external lists in
 * source order; consume one source occurrence per typed occurrence and fail
 * closed if that invariant is ever broken. Local iteration bindings can also
 * appear in the typed AST, but are intentionally absent from the compiled
 * external occurrence list and remain owned by the legacy numeric runtime.
 */
const typedNumericBindingReferences = (
  source: CompiledNumericBinding
): readonly TypedNumericBindingReference[] => {
  if (!source.typedExpression) return [];
  const sourceReferencesByBindingId = new Map<BindingId, CompiledNumericBinding["references"][number][]>();
  for (const reference of source.references) {
    const references = sourceReferencesByBindingId.get(reference.bindingId);
    if (references) references.push(reference);
    else sourceReferencesByBindingId.set(reference.bindingId, [reference]);
  }
  const typedReferences = referencesIn(source.typedExpression)
    .filter((reference): reference is TypedDependencyReferenceNode =>
      reference.bindingId !== null && sourceReferencesByBindingId.has(reference.bindingId)
    );
  const result: TypedNumericBindingReference[] = [];
  for (const typed of typedReferences) {
    const references = sourceReferencesByBindingId.get(typed.bindingId!);
    const sourceReference = references?.shift();
    if (!sourceReference) {
      throw new Error(
        `typedDependencyGraph: numeric binding reference mapping mismatch for ${typed.bindingId}`
      );
    }
    result.push({ typed, source: sourceReference });
  }
  if ([...sourceReferencesByBindingId.values()].some((references) => references.length > 0)) {
    throw new Error("typedDependencyGraph: numeric binding reference mapping has unmatched source occurrences");
  }
  return result;
};

const stageEndpointId = (ownerId: ElementId, occurrenceIndex: string | undefined, stagePath: readonly string[]) =>
  `${ownerId}\u0000${occurrenceIndex ?? "*"}\u0000${stagePath.join(".") || "base"}`;

const recipeBranchKeys = (recipe: TransformationRecipe): readonly string[] => recipe.targets.map((target) =>
  `${target.ownerId}\u0000${target.occurrenceIndex ?? "*"}\u0000${target.stagePath.join(".")}`
);

const recipeBranchKey = (recipe: TransformationRecipe) => recipeBranchKeys(recipe).join("|");

const numericReferenceDependencies = (value: NumericValue): readonly TypedTransformationDependency[] => {
  if (typeof value === "object" && value !== null && value.kind === "expression" && value.resolvedReferences) {
    return value.resolvedReferences.map((reference) => ({
      ownerId: reference.elementId,
      stagePath: reference.stagePath
    }));
  }
  // Transformation recipes are compiled through dslCompiler, which attaches
  // the resolved reference sidecar while source names and stage symbols are
  // available. A graph must never recover semantic stage identity by parsing
  // the legacy expression string after that compiler boundary.
  return [];
};

const anchorDependencies = (anchor: PointAnchor): readonly TypedTransformationDependency[] => {
  if (anchor.mode === "reference") return [{ ownerId: anchor.pointId, stagePath: anchor.stagePath ?? ["final"] }];
  if (anchor.mode === "derived") {
    if (anchor.stagePath) return [{ ownerId: anchor.elementId, stagePath: anchor.stagePath }];
    const path = anchor.stagePath ?? anchor.pointKey.split(".");
    const property = path.pop();
    return property ? [{ ownerId: anchor.elementId, stagePath: path.length ? path : ["final"] }] : [];
  }
  if (anchor.mode === "coordinate") return [...numericReferenceDependencies(anchor.x), ...numericReferenceDependencies(anchor.y)];
  return [];
};

const operationDependencies = (operation: TransformationOperation): readonly TypedTransformationDependency[] => {
  switch (operation.kind) {
    case "edge": return [...numericReferenceDependencies(operation.intersectionIndex)];
    case "extend": return [...anchorDependencies(operation.point)];
    case "move": return [
      ...anchorDependencies(operation.startPoint),
      ...anchorDependencies(operation.endPoint),
      ...numericReferenceDependencies(operation.scale),
      ...numericReferenceDependencies(operation.angleDeg)
    ];
    case "mirrorMove": return [...anchorDependencies(operation.axisPoint1), ...anchorDependencies(operation.axisPoint2)];
    case "reverse": return [];
  }
};

const dedupe = <T>(values: readonly T[], key: (value: T) => string): T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
};

const targetDependency = (target: TransformationTargetSelector): TypedTransformationDependency => ({
  ownerId: target.ownerId,
  occurrenceIndex: target.occurrenceIndex,
  stagePath: target.stagePath
});

type StructuredGeometryDependency = { id: ElementId; requiredness: TypedDependencyRequiredness };

type GeometryValueInputDependency = {
  occurrence: GeometryValueOccurrence;
  guards: readonly TypedDependencyActivationGuard[];
};

const geometryValueOccurrencesInInput = (
  input: GeometryInputTarget | readonly GeometryInputTarget[]
): readonly GeometryValueInputDependency[] => {
  const dependencies: GeometryValueInputDependency[] = [];
  const visitCollection = (node: GeometryInputCollectionNode, guards: readonly TypedDependencyActivationGuard[]): void => {
    if (node.kind === "leaf") node.targets.forEach((target) => visitTarget(target, guards));
    else if (node.kind === "if") {
      const selection = node.condition.kind === "booleanLiteral" ? node.condition.value : undefined;
      const controllerId = `geometry-input:if:${node.condition.span.start}`;
      visitCollection(node.thenBranch, [...guards, {
        controllerId,
        branch: "then",
        ...(selection === undefined
          ? { controllerExpression: node.condition }
          : { staticSelection: selection ? "selected" as const : "unselected" as const })
      }]);
      visitCollection(node.elseBranch, [...guards, {
        controllerId,
        branch: "else",
        ...(selection === undefined
          ? { controllerExpression: node.condition }
          : { staticSelection: selection ? "unselected" as const : "selected" as const })
      }]);
    } else if (node.kind === "match") {
      const selected = node.scrutinee.kind === "choiceLiteral" ? node.scrutinee.value : undefined;
      const controllerId = `geometry-input:match:${node.scrutinee.span.start}`;
      node.arms.forEach((arm) => visitCollection(arm.value, [...guards, {
        controllerId,
        branch: `match:${arm.label}`,
        ...(selected === undefined
          ? { controllerExpression: node.scrutinee }
          : { staticSelection: arm.label === selected ? "selected" as const : "unselected" as const })
      }]));
    } else if (node.kind === "coalesce") {
      visitCollection(node.leftBranch, guards);
      visitCollection(node.rightBranch, guards);
    }
  };
  const visitTarget = (target: GeometryInputTarget, guards: readonly TypedDependencyActivationGuard[]): void => {
    if (target.kind === "geometryValue") dependencies.push({ occurrence: target.occurrence, guards });
    else if (target.kind === "geometryValueMap") {
      visitTarget(target.source as GeometryInputTarget, guards);
    } else if (target.kind === "collectionValue") visitCollection(target.value, guards);
    else if (target.kind === "collectionIndex") {
      target.members.forEach((member) => visitTarget(member, guards));
      if (target.value) visitCollection(target.value, guards);
    }
  };
  if (Array.isArray(input)) input.forEach((target) => visitTarget(target, []));
  else visitTarget(input as GeometryInputTarget, []);
  return dependencies;
};

const collectStructuredGeometryDependencies = (
  value: unknown,
  result: StructuredGeometryDependency[],
  requiredness: TypedDependencyRequiredness = "required"
): void => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectStructuredGeometryDependencies(item, result, requiredness));
    return;
  }
  const target = value as {
    kind?: string;
    elementId?: unknown;
    templateElementId?: unknown;
    source?: unknown;
    value?: unknown;
    members?: unknown;
    thenBranch?: unknown;
    elseBranch?: unknown;
    arms?: unknown;
    leftBranch?: unknown;
    rightBranch?: unknown;
  };
  if (typeof target.elementId === "string") result.push({ id: target.elementId, requiredness });
  if (typeof target.templateElementId === "string") result.push({ id: target.templateElementId, requiredness });
  if (target.kind === "geometryValueMap" && target.source) collectStructuredGeometryDependencies(target.source, result, requiredness);
  if (target.kind === "collectionValue" || target.kind === "collectionIndex") collectStructuredGeometryDependencies(target.value, result, requiredness);
  if (target.members) collectStructuredGeometryDependencies(target.members, result, requiredness);
  if (target.kind === "if") {
    collectStructuredGeometryDependencies(target.thenBranch, result, "conditional");
    collectStructuredGeometryDependencies(target.elseBranch, result, "conditional");
  }
  if (target.kind === "match") collectStructuredGeometryDependencies(target.arms, result, "conditional");
  if (target.kind === "coalesce") {
    collectStructuredGeometryDependencies(target.leftBranch, result, requiredness);
    collectStructuredGeometryDependencies(target.rightBranch, result, "conditional");
  }
};

const typedDependencyEdgeIsActive = (
  edge: TypedDependencyEdge,
  branchSelections: TypedDependencyBranchSelection
): boolean => {
  if (edge.requiredness !== "conditional") return true;
  // Some structured geometry products are conditional without exposing a
  // scalar controller AST at this owner boundary. Preserve their established
  // readiness behavior; only compiler-resolved activation facts are filtered.
  if (!edge.activation) return true;
  return edge.activation.guards.every((guard) => {
    if (guard.staticSelection === "selected") return true;
    if (guard.staticSelection === "unselected") return false;
    return branchSelections.get(guard.controllerId) === guard.branch;
  });
};

const activationPathMatches = (
  guards: readonly TypedDependencyActivationGuard[],
  prefix: readonly TypedDependencyActivationGuard[]
): boolean => guards.length === prefix.length && guards.every((guard, index) =>
  guard.controllerId === prefix[index]?.controllerId &&
  guard.branch === prefix[index]?.branch &&
  guard.controllerKind === prefix[index]?.controllerKind &&
  guard.staticSelection === prefix[index]?.staticSelection
);

const activationPathIsActive = (
  guards: readonly TypedDependencyActivationGuard[],
  branchSelections: TypedDependencyBranchSelection
): boolean => guards.every((guard) => {
  if (guard.staticSelection === "selected") return true;
  if (guard.staticSelection === "unselected") return false;
  return branchSelections.get(guard.controllerId) === guard.branch;
});

export type TypedDependencyControllerCandidate = {
  controllerId: string;
  sourceEndpointId: string;
  kind: "scalar" | "geometry-value-coalesce";
  expression?: TypedScalarExpression;
  branches: readonly string[];
  prerequisiteEndpointIds: readonly string[];
};

/**
 * Returns only controllers whose enclosing guard path is active. Required
 * prerequisites are taken from the same compiler-owned edge source at the
 * path prefix preceding that controller, so a controller is not probed until
 * its scalar/geometry inputs are ready.
 */
export const typedDependencyControllerCandidates = (
  graph: TypedDependencyGraph,
  branchSelections: TypedDependencyBranchSelection
): readonly TypedDependencyControllerCandidate[] => {
  const candidates = new Map<string, {
    sourceEndpointId: string;
    kind: "scalar" | "geometry-value-coalesce";
    expression?: TypedScalarExpression;
    branches: Set<string>;
    prerequisites: Set<string>;
  }>();
  for (const edge of graph.edges) {
    const guards = edge.activation?.guards ?? [];
    guards.forEach((guard, guardIndex) => {
      const kind = guard.controllerKind ?? "scalar";
      if (!guard.controllerExpression && kind !== "geometry-value-coalesce") return;
      const prefix = guards.slice(0, guardIndex);
      if (!activationPathIsActive(prefix, branchSelections)) return;
      const candidate = candidates.get(guard.controllerId) ?? {
        sourceEndpointId: endpointId(edge.from),
        kind,
        ...(guard.controllerExpression ? { expression: guard.controllerExpression } : {}),
        branches: new Set<string>(),
        prerequisites: new Set<string>()
      };
      candidate.branches.add(guard.branch);
      for (const prerequisite of graph.edges) {
        if (endpointId(prerequisite.from) !== endpointId(edge.from)) continue;
        const prerequisiteGuards = prerequisite.activation?.guards ?? [];
        if (!activationPathMatches(prerequisiteGuards, prefix)) continue;
        if (!typedDependencyEdgeIsActive(prerequisite, branchSelections)) continue;
        candidate.prerequisites.add(endpointId(prerequisite.to));
      }
      candidates.set(guard.controllerId, candidate);
    });
  }
  return [...candidates.entries()].map(([controllerId, candidate]) => ({
    controllerId,
    sourceEndpointId: candidate.sourceEndpointId,
    kind: candidate.kind,
    ...(candidate.expression ? { expression: candidate.expression } : {}),
    branches: [...candidate.branches],
    prerequisiteEndpointIds: [...candidate.prerequisites]
  }));
};

/** Resolves the compiler-owned graph for one runtime branch selection. The
 * edge set remains the canonical graph; this only projects its already
 * resolved activation facts into readiness/cycle behavior. */
export const resolveTypedDependencyGraphOrder = (
  edges: readonly TypedDependencyEdge[],
  endpointById: ReadonlyMap<string, TypedDependencyEndpoint>,
  branchSelections: TypedDependencyBranchSelection = new Map()
): { evaluationOrder: readonly ElementId[]; dependencyOrder: readonly string[]; cycles: readonly TypedDependencyCycle[] } => {
  const dependenciesByNode = new Map<string, string[]>();
  for (const edge of edges) {
    if (!typedDependencyEdgeIsActive(edge, branchSelections)) continue;
    const dependencies = dependenciesByNode.get(endpointId(edge.from)) ?? [];
    if (!dependencies.includes(endpointId(edge.to))) dependencies.push(endpointId(edge.to));
    dependenciesByNode.set(endpointId(edge.from), dependencies);
  }
  const visitState = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const orderedEndpoints: string[] = [];
  const cycles: TypedDependencyCycle[] = [];
  const cycleKeys = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visitState.get(nodeId) === "visited") return;
    if (visitState.get(nodeId) === "visiting") {
      const start = stack.indexOf(nodeId);
      const cycleIds = [...stack.slice(Math.max(0, start)), nodeId];
      const key = cycleIds.join("|");
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        const cycleEndpoints = cycleIds
          .map((id) => endpointById.get(id))
          .filter((endpoint): endpoint is TypedDependencyEndpoint => Boolean(endpoint));
        cycles.push({
          endpointIds: cycleIds,
          names: cycleEndpoints.map((endpoint) => endpoint.kind === "version" ? endpoint.id : endpoint.name),
          statementIndices: cycleEndpoints.map((endpoint) => endpoint.statementIndex)
        });
      }
      return;
    }
    visitState.set(nodeId, "visiting");
    stack.push(nodeId);
    for (const dependencyId of dependenciesByNode.get(nodeId) ?? []) visit(dependencyId);
    stack.pop();
    visitState.set(nodeId, "visited");
    orderedEndpoints.push(nodeId);
  };
  for (const nodeId of endpointById.keys()) visit(nodeId);
  const evaluationOrder = orderedEndpoints
    .map((id) => endpointById.get(id))
    .filter((endpoint): endpoint is Extract<TypedDependencyEndpoint, { kind: "element" }> => endpoint?.kind === "element")
    .map((endpoint) => endpoint.id);
  return { evaluationOrder, dependencyOrder: orderedEndpoints, cycles };
};

export const resolveTypedDependencyGraphRuntime = (
  graph: TypedDependencyGraph,
  branchSelections: TypedDependencyBranchSelection
): { evaluationOrder: readonly ElementId[]; dependencyOrder: readonly string[]; cycles: readonly TypedDependencyCycle[] } => {
  const endpointById = new Map<string, TypedDependencyEndpoint>();
  for (const edge of graph.edges) {
    endpointById.set(endpointId(edge.from), edge.from);
    endpointById.set(endpointId(edge.to), edge.to);
  }
  return resolveTypedDependencyGraphOrder(graph.edges, endpointById, branchSelections);
};

/** Builds once during compilation; query consumers only read its adjacency maps. */
export const buildTypedDependencyGraph = ({
  elements,
  drawingModifiers,
  elementIdByStatementIndex,
  bindingAnalysis,
  propertyBindings,
  numericBindings,
  textTemplates,
  scalarProgram,
  geometryInputTargets,
  constructionInputConsumerElementIds,
  transformationRecipes,
  geometryValueProgram,
  moduleExportedGeometryValueStatementIds,
  moduleMaterialization,
  conditionalGroupConditions
}: TypedDependencyGraphInput): TypedDependencyGraph | undefined => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const disabledBindingIds = bindingAnalysis
    ? staticDisabledBindingIds(bindingAnalysis, elements, drawingModifiers)
    : new Set<BindingId>();
  const edges: TypedDependencyEdge[] = [];
  const deferredStageEdges: Array<{
    kind: TypedDependencyKind;
    from: TypedDependencyEndpoint;
    ownerId: ElementId;
    stagePath: readonly string[];
    span: DslSpan | null;
    requiredness: TypedDependencyRequiredness;
    activation?: TypedDependencyActivation;
    occurrenceNamespace?: string;
  }> = [];
  const deferredGeometryValueEdges: Array<{
    from: TypedDependencyEndpoint;
    occurrence: GeometryValueOccurrence;
    span: DslSpan | null;
    requiredness: TypedDependencyRequiredness;
    activation?: TypedDependencyActivation;
    occurrenceNamespace?: string;
  }> = [];
  const seen = new Map<string, number>();
  const add = (edge: TypedDependencyEdge, occurrenceNamespace?: string) => {
    const scopedEdge = edge.activation
      ? { ...edge, activation: scopeActivationToSource(edge.activation, edge.from, occurrenceNamespace) }
      : edge;
    const activationKey = scopedEdge.activation
      ? `|${scopedEdge.activation.guards.map((guard) => `${guard.controllerId}:${guard.controllerKind ?? "scalar"}:${guard.branch}:${guard.staticSelection ?? "dynamic"}`).join(">")}`
      : "";
    const key = `${endpointId(scopedEdge.from)}|${scopedEdge.kind}|${endpointId(scopedEdge.to)}${activationKey}`;
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      // A required path dominates a conditional path when both compiler
      // products describe the same dependency.
      if (scopedEdge.requiredness === "required" && edges[existingIndex]?.requiredness === "conditional") {
        edges[existingIndex] = { ...edges[existingIndex], requiredness: "required" };
      }
      return;
    }
    seen.set(key, edges.length);
    edges.push(scopedEdge);
  };
  const reasonFor = (bindingId: BindingId): TypedDependencyReason | undefined => {
    if (!bindingAnalysis) return undefined;
    const entry = bindingAnalysis.entriesById.get(bindingId);
    if (entry?.status.kind === "invalid" || entry?.programEligibility.kind === "ineligible") return "invalid";
    return disabledBindingIds.has(bindingId) ? "disabled" : undefined;
  };

  if (bindingAnalysis) for (const binding of bindingAnalysis.catalog.bindings) {
    if (binding.kind !== "typed") continue;
    const from = bindingEndpoint(bindingAnalysis, binding.id);
    for (const edge of bindingAnalysis.graph.edgesByFromBindingId.get(binding.id) ?? []) {
      add({ kind: "initializer", from, to: bindingEndpoint(bindingAnalysis, edge.toBindingId), span: edge.reference.span, reason: reasonFor(edge.toBindingId), requiredness: "required" });
    }
  }
  if (bindingAnalysis) for (const statement of scalarProgram?.statements ?? []) {
    const from = bindingEndpoint(bindingAnalysis, statement.bindingId);
    for (const reference of geometryPropertiesIn(statement.declaration.initializer)) {
      if (!reference.elementId || reference.targetSourceOrder === null) continue;
      deferredStageEdges.push({ kind: "geometry-property", from, ownerId: reference.elementId, stagePath: reference.stagePath ?? ["final"], span: reference.span, requiredness: reference.lazy ? "conditional" : "required", ...(reference.activation ? { activation: reference.activation } : {}) });
    }
    // Binding-analysis intentionally keeps the unconditional graph small. The
    // canonical graph also retains conditional value-branch references so the
    // selected branch can be scheduled later by either evaluator.
    for (const reference of referencesIn(statement.declaration.initializer)) {
      if (!reference.bindingId || !bindingAnalysis.catalog.bindingsById.has(reference.bindingId)) continue;
      add({ kind: "initializer", from, to: bindingEndpoint(bindingAnalysis, reference.bindingId), span: reference.span, reason: reasonFor(reference.bindingId), requiredness: reference.lazy ? "conditional" : "required", ...(reference.activation ? { activation: reference.activation } : {}) });
    }
  }
  if (bindingAnalysis) for (const issue of bindingAnalysis.issues) {
    if (issue.origin.kind !== "reference") continue;
    const reference = issue.origin.reference;
    const from = bindingEndpoint(bindingAnalysis, issue.bindingId);
    const target = issue.code === "undefined-binding" || issue.code === "forward-binding-reference"
      ? { kind: "missing" as const, id: `${issue.code}:${issue.bindingId}:${reference.occurrenceIndex}`, name: reference.name, statementIndex: from.statementIndex }
      : bindingEndpoint(bindingAnalysis, issue.relatedBindingIds[0] ?? issue.bindingId);
    add({ kind: "initializer", from, to: target, span: issue.span, reason: issueReason(issue), requiredness: reference.lazy ? "conditional" : "required" });
  }

  if (bindingAnalysis) for (const [key, expression] of conditionalGroupConditions ?? []) {
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    const from = elementEndpoint(elementsById, elementId, statementIndex);
    for (const reference of referencesIn(expression)) {
      if (!reference.bindingId || !bindingAnalysis.catalog.bindingsById.has(reference.bindingId)) continue;
      add({
        kind: "property-binding",
        from,
        to: bindingEndpoint(bindingAnalysis, reference.bindingId),
        span: reference.span,
        reason: reasonFor(reference.bindingId),
        requiredness: reference.lazy ? "conditional" : "required",
        ...(reference.activation ? { activation: reference.activation } : {})
      }, key);
    }
    for (const reference of geometryPropertiesIn(expression)) {
      if (!reference.elementId) continue;
      deferredStageEdges.push({
        kind: "geometry-property",
        from,
        ownerId: reference.elementId,
        stagePath: reference.stagePath ?? ["final"],
        span: reference.span,
        requiredness: reference.lazy ? "conditional" : "required",
        ...(reference.activation ? { activation: reference.activation } : {}),
        occurrenceNamespace: key
      });
    }
  }

  // Persist every resolved drawable dependency in the same graph. This uses
  // the structured compiler products rather than searching arbitrary strings
  // against every element id (which made graph construction quadratic).
  const elementStatementIndex = new Map<ElementId, number>();
  for (const [statementIndex, elementId] of elementIdByStatementIndex) elementStatementIndex.set(elementId, statementIndex);
  const scalarOwnedParameterKeysByElementId = new Map<ElementId, ReadonlySet<string>>();
  const typedScalarGeometryDependencyIdsByElementId = new Map<ElementId, Set<ElementId>>();
  const addTypedScalarGeometryDependencies = (key: string, expression: TypedScalarExpression | undefined) => {
    if (!expression) return;
    const separator = key.indexOf(":");
    if (separator < 0) return;
    const statementIndex = Number(key.slice(0, separator));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) return;
    const dependencyIds = typedScalarGeometryDependencyIdsByElementId.get(elementId) ?? new Set<ElementId>();
    for (const reference of geometryPropertiesIn(expression)) {
      if (reference.elementId) dependencyIds.add(reference.elementId);
    }
    if (dependencyIds.size > 0) {
      const parameterKey = key.slice(separator + 1);
      const owned = new Set(scalarOwnedParameterKeysByElementId.get(elementId) ?? []);
      owned.add(parameterKey);
      scalarOwnedParameterKeysByElementId.set(elementId, owned);
    }
    typedScalarGeometryDependencyIdsByElementId.set(elementId, dependencyIds);
  };
  for (const [key, source] of propertyBindings ?? []) {
    if (source.kind === "expression") addTypedScalarGeometryDependencies(key, source.expression);
  }
  for (const [key, source] of numericBindings ?? []) {
    addTypedScalarGeometryDependencies(key, source.typedExpression);
  }
  for (const [key, expression] of conditionalGroupConditions ?? []) {
    addTypedScalarGeometryDependencies(key, expression);
  }
  for (const element of elements) {
    const from = elementEndpoint(elementsById, element.id, elementStatementIndex.get(element.id) ?? 0);
    const typedScalarGeometryDependencyIds = typedScalarGeometryDependencyIdsByElementId.get(element.id) ?? new Set<ElementId>();
    const dependencies = new Map<ElementId, TypedDependencyRequiredness>((getDirectParentIds(element, {
      textTemplatesByElementId: new Map(
        [...(textTemplates ?? [])].map(([key, template]) => [elementIdByStatementIndex.get(Number(key.slice(0, key.indexOf(":")))), template] as const)
          .filter((entry): entry is readonly [ElementId, TextTemplateAst] => Boolean(entry[0]))
      )
    }) ?? []).filter((dependencyId) => !typedScalarGeometryDependencyIds.has(dependencyId)).map((dependencyId) => [dependencyId, "required"] as const));
    const targetMap = geometryInputTargets?.get(element.id);
    if (targetMap) {
      const scalarOwnedParameterKeys = scalarOwnedParameterKeysByElementId.get(element.id) ?? new Set<string>();
      const structuredDependencies: StructuredGeometryDependency[] = [];
      for (const [parameterKey, target] of targetMap) {
        if (scalarOwnedParameterKeys.has(parameterKey)) continue;
        collectStructuredGeometryDependencies(target, structuredDependencies);
        for (const dependency of geometryValueOccurrencesInInput(target)) {
          deferredGeometryValueEdges.push({
            from,
            occurrence: dependency.occurrence,
            span: null,
            requiredness: dependency.guards.length ? "conditional" : "required",
            ...(dependency.guards.length ? { activation: { guards: dependency.guards } } : {}),
            occurrenceNamespace: `${element.id}:${parameterKey}`
          });
        }
      }
      for (const dependency of structuredDependencies) {
        const existing = dependencies.get(dependency.id);
        dependencies.set(dependency.id, existing === "required" ? existing : dependency.requiredness);
      }
    }
    for (const [dependencyId, requiredness] of dependencies) {
      if (!elementsById.has(dependencyId) ||
          (dependencyId === element.id && !constructionInputConsumerElementIds?.has(element.id))) continue;
      deferredStageEdges.push({
        kind: "geometry",
        from,
        ownerId: dependencyId,
        stagePath: ["final"],
        span: null,
        requiredness
      });
    }
  }

  for (const snapshot of moduleMaterialization?.instanceBaseGeometrySnapshots ?? []) {
    const occurrence: TypedDependencyEndpoint = {
      kind: "module-occurrence",
      id: `module-occurrence:${snapshot.instanceId}`,
      name: snapshot.instanceId,
      statementIndex: elementStatementIndex.get(snapshot.instanceId) ?? 0
    };
    for (const descendantId of snapshot.descendantIds) {
      if (!elementsById.has(descendantId)) continue;
      add({
        kind: "geometry",
        from: occurrence,
        to: elementEndpoint(elementsById, descendantId, elementStatementIndex.get(descendantId) ?? 0),
        span: null,
        requiredness: "required"
      });
    }
  }

  if (bindingAnalysis) for (const [key, source] of propertyBindings ?? []) {
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    const references = source.kind === "binding"
      ? [{ bindingId: source.bindingId, span: source.span, requiredness: "required" as const }]
      : source.kind === "expression"
        ? referencesIn(source.expression).flatMap((reference) => reference.bindingId ? [{
            bindingId: reference.bindingId,
            span: reference.span,
            requiredness: reference.lazy ? "conditional" as const : "required" as const,
            ...(reference.activation ? { activation: reference.activation } : {})
          }] : [])
        : [];
    for (const reference of references) {
      add({
        kind: "property-binding",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        to: bindingEndpoint(bindingAnalysis, reference.bindingId),
        span: reference.span,
        reason: reasonFor(reference.bindingId),
        requiredness: reference.requiredness ?? "required",
        ...(reference.activation ? { activation: reference.activation } : {})
      }, key);
    }
    if (source.kind === "expression") for (const reference of geometryPropertiesIn(source.expression)) {
      if (!reference.elementId) continue;
      deferredStageEdges.push({
        kind: "geometry-property",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        ownerId: reference.elementId,
        stagePath: reference.stagePath ?? ["final"],
        span: reference.span,
        requiredness: reference.lazy ? "conditional" : "required",
        ...(reference.activation ? { activation: reference.activation } : {}),
        occurrenceNamespace: key
      });
    }
  }
  if (bindingAnalysis) for (const [key, source] of numericBindings ?? []) {
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    const references = source.typedExpression
      ? typedNumericBindingReferences(source)
      : source.references.map((reference) => ({ typed: undefined, source: reference }));
    for (const reference of references) {
      const typed = reference.typed;
      const sourceReference = reference.source;
      add({
        kind: "numeric-expression",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        to: bindingEndpoint(bindingAnalysis, sourceReference.bindingId),
        span: sourceReference.span,
        reason: reasonFor(sourceReference.bindingId),
        requiredness: typed?.lazy ? "conditional" : "required",
        ...(typed?.activation ? { activation: typed.activation } : {})
      }, key);
    }
    if (source.typedExpression) for (const reference of geometryPropertiesIn(source.typedExpression)) {
      if (!reference.elementId) continue;
      deferredStageEdges.push({
        kind: "geometry-property",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        ownerId: reference.elementId,
        stagePath: reference.stagePath ?? ["final"],
        span: reference.span,
        requiredness: reference.lazy ? "conditional" : "required",
        ...(reference.activation ? { activation: reference.activation } : {}),
        occurrenceNamespace: key
      });
    }
  }
  if (bindingAnalysis) for (const [key, template] of textTemplates ?? []) {
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    for (const dependency of template.dependencies) {
      add({
        kind: "template-hole",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        to: bindingEndpoint(bindingAnalysis, dependency.bindingId),
        span: dependency.span,
        reason: reasonFor(dependency.bindingId)
      });
    }
  }
  const directByEndpointId = new Map<string, TypedDependencyEdge[]>();
  const reverseByEndpointId = new Map<string, TypedDependencyEdge[]>();
  const endpointById = new Map<string, TypedDependencyEndpoint>();
  for (const element of elements) {
    const endpoint = elementEndpoint(elementsById, element.id, elementStatementIndex.get(element.id) ?? 0);
    endpointById.set(endpointId(endpoint), endpoint);
  }
  for (const binding of bindingAnalysis?.catalog.bindings ?? []) {
    const endpoint = bindingEndpoint(bindingAnalysis!, binding.id);
    endpointById.set(endpointId(endpoint), endpoint);
  }

  const geometryValueEndpointsByOccurrence = new Map<string, TypedDependencyEndpoint>();
  for (const entry of geometryValueProgram ?? []) {
    const key = geometryValueOccurrenceKey(entry.occurrence);
    const endpoint: TypedDependencyEndpoint = {
      kind: "geometry-value",
      id: key,
      name: entry.sourceStatementId,
      statementIndex: entry.sourceStatementIndex
    };
    geometryValueEndpointsByOccurrence.set(key, endpoint);
    endpointById.set(endpointId(endpoint), endpoint);
  }

  const transformationPlans: TypedTransformationDependencyPlan[] = [];
  const stageEndpoints = new Map<string, TypedDependencyEndpoint>();
  const recipeEndpoints = new Map<number, TypedDependencyEndpoint>();
  const recipes = transformationRecipes ?? [];
  const stageEndpoint = (dependency: TypedTransformationDependency): TypedDependencyEndpoint => {
    const id = stageEndpointId(dependency.ownerId, dependency.occurrenceIndex, dependency.stagePath);
    const existing = stageEndpoints.get(id);
    if (existing) return existing;
    const owner = elementsById.get(dependency.ownerId);
    const path = dependency.stagePath.length === 0 ? ["base"] : dependency.stagePath;
    const endpoint: TypedDependencyEndpoint = {
      kind: "geometry-stage",
      id,
      ownerId: dependency.ownerId,
      name: `${owner?.name ?? dependency.ownerId}.${path.join(".")}`,
      stagePath: path,
      ...(dependency.occurrenceIndex !== undefined ? { occurrenceIndex: dependency.occurrenceIndex } : {}),
      statementIndex: elementStatementIndex.get(dependency.ownerId) ?? 0
    };
    stageEndpoints.set(id, endpoint);
    endpointById.set(endpointId(endpoint), endpoint);
    return endpoint;
  };
  const addStageDependency = (from: TypedDependencyEndpoint, dependency: TypedTransformationDependency, kind: TypedDependencyKind = "geometry") => {
    add({ kind, from, to: stageEndpoint(dependency), span: null, requiredness: "required" });
  };
  const addGeometryValueDependency = (
    from: TypedDependencyEndpoint,
    occurrence: GeometryValueOccurrence,
    span: DslSpan | null,
    guards: readonly TypedDependencyActivationGuard[],
    occurrenceNamespace?: string
  ) => {
    const target = geometryValueEndpointsByOccurrence.get(geometryValueOccurrenceKey(occurrence));
    if (!target) return;
    add({
      kind: "geometry",
      from,
      to: target,
      span,
      requiredness: guards.length ? "conditional" : "required",
      ...(guards.length ? { activation: { guards } } : {})
    }, occurrenceNamespace);
  };
  const addScalarProgramDependencies = (
    from: TypedDependencyEndpoint,
    expression: TypedScalarExpression,
    guards: readonly TypedDependencyActivationGuard[],
    occurrenceNamespace?: string
  ) => {
    for (const reference of referencesIn(expression)) {
      if (!reference.bindingId || !bindingAnalysis?.catalog.bindingsById.has(reference.bindingId)) continue;
      const mergedGuards = [...guards, ...(reference.activation?.guards ?? [])];
      add({
        kind: "initializer",
        from,
        to: bindingEndpoint(bindingAnalysis, reference.bindingId),
        span: reference.span,
        reason: reasonFor(reference.bindingId),
        requiredness: mergedGuards.length || reference.lazy ? "conditional" : "required",
        ...(mergedGuards.length ? { activation: { guards: mergedGuards } } : {})
      }, occurrenceNamespace);
    }
    for (const reference of geometryPropertiesIn(expression)) {
      const mergedGuards = [...guards, ...(reference.activation?.guards ?? [])];
      const requiredness = mergedGuards.length || reference.lazy ? "conditional" : "required";
      if (reference.elementId) {
        deferredStageEdges.push({
          kind: "geometry-property",
          from,
          ownerId: reference.elementId,
          stagePath: reference.stagePath ?? ["final"],
          span: reference.span,
          requiredness,
          ...(mergedGuards.length ? { activation: { guards: mergedGuards } } : {}),
          occurrenceNamespace
        });
      } else if (reference.geometryValueOccurrence) {
        addGeometryValueDependency(from, reference.geometryValueOccurrence, reference.span, mergedGuards, occurrenceNamespace);
      } else {
        const bindingId = reference.geometryCarryBindingId ?? reference.geometryValueBinderId;
        if (bindingId && bindingAnalysis?.catalog.bindingsById.has(bindingId)) {
          add({
            kind: "geometry-property",
            from,
            to: bindingEndpoint(bindingAnalysis, bindingId),
            span: reference.span,
            requiredness,
            ...(mergedGuards.length ? { activation: { guards: mergedGuards } } : {})
          }, occurrenceNamespace);
        } else if (reference.forGroupOccurrenceTemplateElementId) {
          deferredStageEdges.push({
            kind: "geometry-property",
            from,
            ownerId: reference.forGroupOccurrenceTemplateElementId,
            stagePath: reference.stagePath ?? ["final"],
            span: reference.span,
            requiredness,
            ...(mergedGuards.length ? { activation: { guards: mergedGuards } } : {}),
            occurrenceNamespace
          });
        }
      }
      if (reference.forGroupOccurrenceIndex) addScalarProgramDependencies(from, reference.forGroupOccurrenceIndex, mergedGuards, occurrenceNamespace);
    }
  };
  const addProgramTargetDependency = (
    from: TypedDependencyEndpoint,
    target: GeometryValueProgramTarget,
    guards: readonly TypedDependencyActivationGuard[],
    occurrenceNamespace?: string
  ) => {
    if (target.kind === "geometryInputTarget") {
      addScalarProgramDependencies(from, target.target.index, guards, occurrenceNamespace);
      const input = target.target;
      for (const dependency of geometryValueOccurrencesInInput(input)) {
        const mergedGuards = [...guards, ...dependency.guards];
        addGeometryValueDependency(from, dependency.occurrence, null, mergedGuards, occurrenceNamespace);
      }
      const structured: StructuredGeometryDependency[] = [];
      collectStructuredGeometryDependencies(input, structured);
      for (const dependency of structured) {
        deferredStageEdges.push({
          kind: "geometry",
          from,
          ownerId: dependency.id,
          stagePath: ["final"],
          span: null,
          requiredness: guards.length || dependency.requiredness === "conditional" ? "conditional" : "required",
          ...(guards.length ? { activation: { guards } } : {}),
          occurrenceNamespace
        });
      }
      return;
    }
    if (target.kind === "geometryValue") {
      addGeometryValueDependency(from, target.occurrence, null, guards, occurrenceNamespace);
    } else if (target.kind === "geometryCarry" || target.kind === "geometryValueForBinder") {
      const bindingId = target.kind === "geometryCarry" ? target.bindingId : target.binderId;
      if (bindingAnalysis?.catalog.bindingsById.has(bindingId)) add({
        kind: "geometry",
        from,
        to: bindingEndpoint(bindingAnalysis, bindingId),
        span: null,
        requiredness: guards.length ? "conditional" : "required",
        ...(guards.length ? { activation: { guards } } : {})
      }, occurrenceNamespace);
    } else if (target.kind === "forGroupOccurrence") {
      deferredStageEdges.push({
        kind: "geometry",
        from,
        ownerId: target.templateElementId,
        stagePath: target.stagePath ?? ["final"],
        span: null,
        requiredness: guards.length ? "conditional" : "required",
        ...(guards.length ? { activation: { guards } } : {}),
        occurrenceNamespace
      });
      if (target.index) addScalarProgramDependencies(from, target.index, guards, occurrenceNamespace);
    } else {
      deferredStageEdges.push({
        kind: "geometry",
        from,
        ownerId: target.statementId,
        stagePath: target.stagePath ?? ["final"],
        span: null,
        requiredness: guards.length ? "conditional" : "required",
        ...(guards.length ? { activation: { guards } } : {}),
        occurrenceNamespace
      });
    }
  };
  for (const entry of geometryValueProgram ?? []) {
    const from = geometryValueEndpointsByOccurrence.get(geometryValueOccurrenceKey(entry.occurrence));
    if (!from) continue;
    const occurrenceNamespace = geometryValueOccurrenceKey(entry.occurrence);
    for (const dependency of geometryValueProgramDependencies(entry)) {
      if (dependency.kind === "scalar") addScalarProgramDependencies(from, dependency.expression, dependency.guards, occurrenceNamespace);
      else addProgramTargetDependency(from, dependency.target, dependency.guards, occurrenceNamespace);
    }
    if (entry.occurrence.instancePath.length > 0 &&
        moduleExportedGeometryValueStatementIds?.has(entry.sourceStatementId)) {
      const moduleInstance = moduleMaterialization?.executionStatements.find((candidate) =>
        candidate.type === "moduleInstance" &&
        JSON.stringify(candidate.instancePath) === JSON.stringify(entry.occurrence.instancePath)
      );
      if (moduleInstance) {
        add({
          kind: "geometry",
          from: elementEndpoint(elementsById, moduleInstance.runtimeElementId, moduleInstance.sourceStatementIndex),
          to: from,
          span: null,
          requiredness: "required"
        });
      }
    }
  }
  for (const deferred of deferredGeometryValueEdges) {
    const to = geometryValueEndpointsByOccurrence.get(geometryValueOccurrenceKey(deferred.occurrence));
    if (!to) continue;
    add({
      kind: "geometry",
      from: deferred.from,
      to,
      span: deferred.span,
      requiredness: deferred.requiredness,
      ...(deferred.activation ? { activation: deferred.activation } : {})
    }, deferred.occurrenceNamespace);
  }
  for (const deferred of deferredStageEdges) {
    add({
      kind: deferred.kind,
      from: deferred.from,
      to: stageEndpoint({ ownerId: deferred.ownerId, stagePath: deferred.stagePath }),
      span: deferred.span,
      requiredness: deferred.requiredness,
      ...(deferred.activation ? { activation: deferred.activation } : {})
    }, deferred.occurrenceNamespace);
  }
  for (const [recipeIndex, recipe] of recipes.entries()) {
    const target = recipe.targets[0];
    if (!target) continue;
    const recipeEndpoint: TypedDependencyEndpoint = {
      kind: "transformation-recipe",
      id: `recipe:${recipe.id}`,
      name: recipe.construction,
      ownerId: target.ownerId,
      branchKey: recipeBranchKey(recipe),
      statementIndex: recipe.sourceStatementIndex
    };
    recipeEndpoints.set(recipeIndex, recipeEndpoint);
    endpointById.set(endpointId(recipeEndpoint), recipeEndpoint);
    const branchKeys = recipeBranchKeys(recipe);
    const predecessors = recipes
      .slice(0, recipeIndex)
      .map((prior, priorIndex) => ({ prior, priorIndex }))
      .filter(({ prior }) => recipeBranchKeys(prior).some((branchKey) => branchKeys.includes(branchKey)))
      .map(({ priorIndex }) => priorIndex);
    const prerequisites = recipe.targets.map((target) => {
      if (target.stagePath.length > 0) return targetDependency(target);
      return {
        ownerId: target.ownerId,
        occurrenceIndex: target.occurrenceIndex,
        // Bare target syntax is ownership, not a value read. The predecessor
        // list carries same-branch local ordering for later root recipes;
        // every root target's construction prerequisite remains Base.
        stagePath: ["base"]
      };
    });
    const argumentDependencies = dedupe(operationDependencies(recipe.operation),
      (dependency) => `${dependency.ownerId}|${dependency.stagePath.join(".")}`);
    const outputStages = recipe.targets.flatMap((target) => {
      const stagePath = recipe.stageName
        ? [...target.stagePath, recipe.stageName]
        : [...target.stagePath, "final"];
      const output = { ownerId: target.ownerId, occurrenceIndex: target.occurrenceIndex, stagePath };
      return recipe.stageName
        ? [
            output,
            { ...output, stagePath: [...stagePath, "final"] },
            ...(target.stagePath.length === 0 ? [{ ...output, stagePath: ["final"] }] : [])
          ]
        : [output];
    });
    const plan = {
      recipeId: recipe.id,
      recipeIndex,
      branchKey: recipeBranchKey(recipe),
      branchKeys,
      statementIndex: recipe.sourceStatementIndex,
      ownerIds: dedupe(recipe.targets.map((target) => target.ownerId), (value) => value),
      prerequisites,
      argumentDependencies,
      predecessorRecipeIndices: predecessors,
      outputStages
    } satisfies TypedTransformationDependencyPlan;
    transformationPlans.push(plan);
    for (const prerequisite of prerequisites) addStageDependency(recipeEndpoint, prerequisite);
    for (const dependency of argumentDependencies) addStageDependency(recipeEndpoint, dependency);
    for (const priorIndex of predecessors) {
      const priorEndpoint = recipeEndpoints.get(priorIndex);
      if (priorEndpoint) add({ kind: "geometry", from: recipeEndpoint, to: priorEndpoint, span: null, requiredness: "required" });
    }
    for (const output of outputStages) {
      add({ kind: "geometry", from: stageEndpoint(output), to: recipeEndpoint, span: null, requiredness: "required" });
    }
  }
  const rootOwners = new Set<ElementId>();
  for (const recipe of recipes) {
    for (const target of recipe.targets) if (target.stagePath.length === 0) rootOwners.add(target.ownerId);
  }
  for (const ownerId of rootOwners) {
    const final = { ownerId, stagePath: ["final"] };
    const finalEndpoint = stageEndpoint(final);
    const ownerRecipes = recipes.filter((recipe) => recipe.targets.some((target) =>
      target.ownerId === ownerId && target.stagePath.length === 0
    ));
    const last = ownerRecipes.at(-1);
    const lastIndex = last ? recipes.indexOf(last) : -1;
    const lastPlan = lastIndex >= 0 ? transformationPlans.find((plan) => plan.recipeIndex === lastIndex) : undefined;
    const lastOutput = lastPlan?.outputStages.find((output) =>
      output.ownerId === ownerId && output.stagePath.length === 1 && output.stagePath[0] === "final"
    );
    const finalOutput = lastOutput ?? { ownerId, stagePath: ["base"] };
    if (stageEndpointId(finalOutput.ownerId, finalOutput.occurrenceIndex, finalOutput.stagePath) !==
        stageEndpointId(final.ownerId, undefined, final.stagePath)) {
      addStageDependency(finalEndpoint, finalOutput);
    }
  }
  const ownersWithRootRecipe = new Set(
    recipes
      .flatMap((recipe) => recipe.targets.filter((target) => target.stagePath.length === 0).map((target) => target.ownerId))
  );
  for (const element of elements) {
    const construction = elementEndpoint(elementsById, element.id, elementStatementIndex.get(element.id) ?? 0);
    const base = { ownerId: element.id, stagePath: ["base"] };
    add({ kind: "geometry", from: stageEndpoint(base), to: construction, span: null, requiredness: "required" });
    if (!ownersWithRootRecipe.has(element.id)) {
      addStageDependency(stageEndpoint({ ownerId: element.id, stagePath: ["final"] }), base, "geometry");
    }
  }
  directByEndpointId.clear();
  reverseByEndpointId.clear();
  for (const edge of edges) {
    const direct = directByEndpointId.get(endpointId(edge.from)) ?? [];
    direct.push(edge); directByEndpointId.set(endpointId(edge.from), direct);
    const reverse = reverseByEndpointId.get(endpointId(edge.to)) ?? [];
    reverse.push(edge); reverseByEndpointId.set(endpointId(edge.to), reverse);
  }
  for (const edge of edges) {
    endpointById.set(endpointId(edge.from), edge.from);
    endpointById.set(endpointId(edge.to), edge.to);
  }
  const { evaluationOrder, dependencyOrder, cycles } = resolveTypedDependencyGraphOrder(edges, endpointById);
  const dependencyPositionByEndpointId = new Map(dependencyOrder.map((id, index) => [id, index] as const));
  const geometryValueExecutionPositionByOccurrence = new Map<string, number>();
  for (const [occurrenceKey, endpoint] of geometryValueEndpointsByOccurrence) {
    const position = dependencyPositionByEndpointId.get(endpointId(endpoint));
    if (position !== undefined) geometryValueExecutionPositionByOccurrence.set(occurrenceKey, position);
  }
  return {
    edges,
    directByEndpointId,
    reverseByEndpointId,
    evaluationOrder,
    cycles,
    transformationPlans,
    geometryValueExecutionPositionByOccurrence
  };
};

export const typedDependencyEndpointId = endpointId;
