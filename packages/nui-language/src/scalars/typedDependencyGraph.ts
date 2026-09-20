// Static typed dependency projection for Task 36. This consumes compiler
// records only: it deliberately never parses DSL source || resolves names.
import type { DslSpan } from "../dsl/dslTypes";
import { effectiveElementActivityById } from "../model/elementActivity";
import type {
  CadElement,
  DrawingModifierDefinition,
  ElementId,
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

export type TypedDependencyReason = "missing" | "invalid" | "disabled";
export type TypedDependencyKind = "initializer" | "geometry" | "geometry-property" | "property-binding" | "numeric-expression" | "template-hole";
export type TypedDependencyRequiredness = "required" | "conditional";
export type TypedDependencyActivationGuard = {
  controllerId: string;
  branch: string;
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
  geometryInputTargets?: ReadonlyMap<ElementId, ReadonlyMap<string, unknown>>;
  transformationRecipes?: readonly TransformationRecipe[];
  moduleMaterialization?: Pick<ModuleMaterialization, "instanceBaseGeometrySnapshots">;
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
  expression: TypedScalarExpression;
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
    expression: TypedScalarExpression;
    branches: Set<string>;
    prerequisites: Set<string>;
  }>();
  for (const edge of graph.edges) {
    const guards = edge.activation?.guards ?? [];
    guards.forEach((guard, guardIndex) => {
      if (!guard.controllerExpression) return;
      const prefix = guards.slice(0, guardIndex);
      if (!activationPathIsActive(prefix, branchSelections)) return;
      const candidate = candidates.get(guard.controllerId) ?? {
        expression: guard.controllerExpression,
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
    expression: candidate.expression,
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
): { evaluationOrder: readonly ElementId[]; cycles: readonly TypedDependencyCycle[] } => {
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
  return { evaluationOrder, cycles };
};

export const resolveTypedDependencyGraphRuntime = (
  graph: TypedDependencyGraph,
  branchSelections: TypedDependencyBranchSelection
): { evaluationOrder: readonly ElementId[]; cycles: readonly TypedDependencyCycle[] } => {
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
  transformationRecipes,
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
  }> = [];
  const seen = new Map<string, number>();
  const add = (edge: TypedDependencyEdge) => {
    const activationKey = edge.activation
      ? `|${edge.activation.guards.map((guard) => `${guard.controllerId}:${guard.branch}:${guard.staticSelection ?? "dynamic"}`).join(">")}`
      : "";
    const key = `${endpointId(edge.from)}|${edge.kind}|${endpointId(edge.to)}${activationKey}`;
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      // A required path dominates a conditional path when both compiler
      // products describe the same dependency.
      if (edge.requiredness === "required" && edges[existingIndex]?.requiredness === "conditional") {
        edges[existingIndex] = { ...edges[existingIndex], requiredness: "required" };
      }
      return;
    }
    seen.set(key, edges.length);
    edges.push(edge);
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
      });
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
        ...(reference.activation ? { activation: reference.activation } : {})
      });
    }
  }

  // Persist every resolved drawable dependency in the same graph. This uses
  // the structured compiler products rather than searching arbitrary strings
  // against every element id (which made graph construction quadratic).
  const elementStatementIndex = new Map<ElementId, number>();
  for (const [statementIndex, elementId] of elementIdByStatementIndex) elementStatementIndex.set(elementId, statementIndex);
  for (const element of elements) {
    const dependencies = new Map<ElementId, TypedDependencyRequiredness>((getDirectParentIds(element, {
      textTemplatesByElementId: new Map(
        [...(textTemplates ?? [])].map(([key, template]) => [elementIdByStatementIndex.get(Number(key.slice(0, key.indexOf(":")))), template] as const)
          .filter((entry): entry is readonly [ElementId, TextTemplateAst] => Boolean(entry[0]))
      )
    }) ?? []).map((dependencyId) => [dependencyId, "required"] as const));
    const targetMap = geometryInputTargets?.get(element.id);
    if (targetMap) {
      const structuredDependencies: StructuredGeometryDependency[] = [];
      collectStructuredGeometryDependencies(targetMap, structuredDependencies);
      for (const dependency of structuredDependencies) {
        const existing = dependencies.get(dependency.id);
        dependencies.set(dependency.id, existing === "required" ? existing : dependency.requiredness);
      }
    }
    const from = elementEndpoint(elementsById, element.id, elementStatementIndex.get(element.id) ?? 0);
    for (const [dependencyId, requiredness] of dependencies) {
      if (dependencyId === element.id || !elementsById.has(dependencyId)) continue;
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
      });
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
        ...(reference.activation ? { activation: reference.activation } : {})
      });
    }
  }
  if (bindingAnalysis) for (const [key, source] of numericBindings ?? []) {
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    for (const reference of source.references) {
      add({
        kind: "numeric-expression",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        to: bindingEndpoint(bindingAnalysis, reference.bindingId),
        span: reference.span,
        reason: reasonFor(reference.bindingId),
        requiredness: "required"
      });
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
        ...(reference.activation ? { activation: reference.activation } : {})
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
  for (const deferred of deferredStageEdges) {
    add({
      kind: deferred.kind,
      from: deferred.from,
      to: stageEndpoint({ ownerId: deferred.ownerId, stagePath: deferred.stagePath }),
      span: deferred.span,
      requiredness: deferred.requiredness,
      ...(deferred.activation ? { activation: deferred.activation } : {})
    });
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
  const { evaluationOrder, cycles } = resolveTypedDependencyGraphOrder(edges, endpointById);
  return { edges, directByEndpointId, reverseByEndpointId, evaluationOrder, cycles, transformationPlans };
};

export const typedDependencyEndpointId = endpointId;
