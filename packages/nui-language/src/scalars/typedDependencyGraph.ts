// Static typed dependency projection for Task 36. This consumes compiler
// records only: it deliberately never parses DSL source || resolves names.
import type { DslSpan } from "../dsl/dslTypes";
import { effectiveElementActivityById } from "../model/elementActivity";
import type { CadElement, DrawingModifierDefinition, ElementId } from "../types/geometry";
import type { BindingAnalysis, BindingIssue } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import type { BindingVersionGraph } from "./bindingVersions";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import type { TextTemplateAst } from "./textTemplate";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarProgram } from "./scalarProgram";

export type TypedDependencyReason = "missing" | "invalid" | "disabled";
export type TypedDependencyKind = "initializer" | "geometry" | "geometry-property" | "property-binding" | "numeric-expression" | "template-hole";

export type TypedDependencyEndpoint =
  | { kind: "binding"; id: BindingId; name: string; statementIndex: number; span: DslSpan | null }
  | { kind: "version"; id: string; bindingId: BindingId; statementIndex: number }
  | { kind: "element"; id: ElementId; name: string; statementIndex: number }
  | { kind: "missing"; id: string; name: string; statementIndex: number };

export type TypedDependencyEdge = {
  kind: TypedDependencyKind;
  from: TypedDependencyEndpoint;
  to: TypedDependencyEndpoint;
  span: DslSpan | null;
  reason?: TypedDependencyReason;
};

export type TypedDependencyGraph = {
  edges: readonly TypedDependencyEdge[];
  directByEndpointId: ReadonlyMap<string, readonly TypedDependencyEdge[]>;
  reverseByEndpointId: ReadonlyMap<string, readonly TypedDependencyEdge[]>;
  /** Stable dependency-first order for drawable/runtime element evaluation. */
  evaluationOrder: readonly ElementId[];
  /** Explicit strongly connected components, retained for diagnostics and tooling. */
  cycles: readonly TypedDependencyCycle[];
};

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
  geometryInputTargets?: ReadonlyMap<ElementId, ReadonlyMap<string, unknown>>;
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
type TypedDependencyReferenceNode = Extract<TypedScalarExpression, { kind: "reference" }> & { readonly lazy?: boolean };
type TypedDependencyGeometryPropertyNode = Extract<TypedScalarExpression, { kind: "geometryProperty" }> & { readonly lazy?: boolean };

export const referencesIn = (expression: TypedScalarExpression): readonly TypedDependencyReferenceNode[] => {
  const result: TypedDependencyReferenceNode[] = [];
  const visit = (node: TypedScalarExpression, lazy = false): void => {
    if (node.kind === "reference") result.push(lazy ? { ...node, lazy: true } : node);
    else if (node.kind === "unary") visit(node.operand, lazy);
    else if (node.kind === "binary") { visit(node.left); visit(node.right, node.operator === "??" ? true : lazy); }
    else if (node.kind === "group") visit(node.expression, lazy);
    else if (node.kind === "valueIf") { visit(node.condition, lazy); visit(node.thenBranch, true); visit(node.elseBranch, true); }
    else if (node.kind === "valueMatch") { visit(node.scrutinee, lazy); node.arms.forEach((arm) => visit(arm.expression, true)); }
    else if (node.kind === "collectionIndex") visit(node.index, lazy);
    else if (node.kind === "geometryProperty" && node.forGroupOccurrenceIndex) visit(node.forGroupOccurrenceIndex);
    else if (node.kind === "call") node.args.forEach((argument) => {
      if (argument.kind === "scalar") visit(argument.expression, lazy);
    });
  };
  visit(expression);
  return result;
};

export const geometryPropertiesIn = (expression: TypedScalarExpression): readonly TypedDependencyGeometryPropertyNode[] => {
  const result: TypedDependencyGeometryPropertyNode[] = [];
  const visit = (node: TypedScalarExpression, lazy = false): void => {
    if (node.kind === "geometryProperty") {
      result.push(lazy ? { ...node, lazy: true } : node);
      if (node.forGroupOccurrenceIndex) visit(node.forGroupOccurrenceIndex, lazy);
    }
    else if (node.kind === "unary") visit(node.operand, lazy);
    else if (node.kind === "binary") { visit(node.left, lazy); visit(node.right, node.operator === "??" ? true : lazy); }
    else if (node.kind === "group") visit(node.expression, lazy);
    else if (node.kind === "valueIf") { visit(node.condition, lazy); visit(node.thenBranch, true); visit(node.elseBranch, true); }
    else if (node.kind === "valueMatch") { visit(node.scrutinee, lazy); node.arms.forEach((arm) => visit(arm.expression, true)); }
    else if (node.kind === "collectionIndex") visit(node.index, lazy);
    else if (node.kind === "call") node.args.forEach((argument) => {
      if (argument.kind === "scalar") visit(argument.expression, lazy);
    });
  };
  visit(expression);
  return result;
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
  geometryInputTargets
}: TypedDependencyGraphInput): TypedDependencyGraph | undefined => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const disabledBindingIds = bindingAnalysis
    ? staticDisabledBindingIds(bindingAnalysis, elements, drawingModifiers)
    : new Set<BindingId>();
  const edges: TypedDependencyEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: TypedDependencyEdge) => {
    const key = `${endpointId(edge.from)}|${edge.kind}|${endpointId(edge.to)}`;
    if (seen.has(key)) return;
    seen.add(key);
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
      add({ kind: "initializer", from, to: bindingEndpoint(bindingAnalysis, edge.toBindingId), span: edge.reference.span, reason: reasonFor(edge.toBindingId) });
    }
  }
  if (bindingAnalysis) for (const statement of scalarProgram?.statements ?? []) {
    const from = bindingEndpoint(bindingAnalysis, statement.bindingId);
    for (const reference of geometryPropertiesIn(statement.declaration.initializer)) {
      if (reference.lazy) continue;
      if (!reference.elementId || reference.targetSourceOrder === null) continue;
      add({ kind: "geometry-property", from, to: elementEndpoint(elementsById, reference.elementId, reference.targetSourceOrder), span: reference.span });
    }
  }
  if (bindingAnalysis) for (const issue of bindingAnalysis.issues) {
    if (issue.origin.kind !== "reference") continue;
    if (issue.origin.reference.lazy) continue;
    const reference = issue.origin.reference;
    const from = bindingEndpoint(bindingAnalysis, issue.bindingId);
    const target = issue.code === "undefined-binding" || issue.code === "forward-binding-reference"
      ? { kind: "missing" as const, id: `${issue.code}:${issue.bindingId}:${reference.occurrenceIndex}`, name: reference.name, statementIndex: from.statementIndex }
      : bindingEndpoint(bindingAnalysis, issue.relatedBindingIds[0] ?? issue.bindingId);
    add({ kind: "initializer", from, to: target, span: issue.span, reason: issueReason(issue) });
  }

  // Persist every resolved drawable dependency in the same graph. Element
  // fields are already compiler-resolved IDs; walking only strings that are
  // known element IDs avoids parsing or name resolution here while covering
  // anchors, line/path inputs, parent containers, and generated occurrences.
  const knownElementIds = new Set(elementsById.keys());
  const elementStatementIndex = new Map<ElementId, number>();
  for (const [statementIndex, elementId] of elementIdByStatementIndex) elementStatementIndex.set(elementId, statementIndex);
  const collectElementIds = (value: unknown, ownerId: ElementId, result: Set<ElementId>): void => {
    if (typeof value === "string") {
      for (const candidate of knownElementIds) {
        if (candidate === ownerId) continue;
        const trimmed = value.trim();
        if (
          trimmed === candidate ||
          trimmed.startsWith(`${candidate}.`) ||
          trimmed.includes(`@${candidate}.`)
        ) {
          result.add(candidate);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectElementIds(item, ownerId, result);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "id" && item === ownerId) continue;
      collectElementIds(item, ownerId, result);
    }
  };
  for (const element of elements) {
    const dependencies = new Set<ElementId>();
    collectElementIds(element, element.id, dependencies);
    const targetMap = geometryInputTargets?.get(element.id);
    if (targetMap) collectElementIds(targetMap, element.id, dependencies);
    const from = elementEndpoint(elementsById, element.id, elementStatementIndex.get(element.id) ?? 0);
    for (const dependencyId of dependencies) {
      add({
        kind: "geometry",
        from,
        to: elementEndpoint(elementsById, dependencyId, elementStatementIndex.get(dependencyId) ?? 0),
        span: null
      });
    }
  }

  if (bindingAnalysis) for (const [key, source] of propertyBindings ?? []) {
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    const references = source.kind === "binding"
      ? [{ bindingId: source.bindingId, span: source.span }]
      : source.kind === "expression"
        ? referencesIn(source.expression).flatMap((reference) => !reference.lazy && reference.bindingId ? [{ bindingId: reference.bindingId, span: reference.span }] : [])
        : [];
    for (const reference of references) {
      add({
        kind: "property-binding",
        from: elementEndpoint(elementsById, elementId, statementIndex),
        to: bindingEndpoint(bindingAnalysis, reference.bindingId),
        span: reference.span,
        reason: reasonFor(reference.bindingId)
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
        reason: reasonFor(reference.bindingId)
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
  for (const edge of edges) {
    const direct = directByEndpointId.get(endpointId(edge.from)) ?? [];
    direct.push(edge); directByEndpointId.set(endpointId(edge.from), direct);
    const reverse = reverseByEndpointId.get(endpointId(edge.to)) ?? [];
    reverse.push(edge); reverseByEndpointId.set(endpointId(edge.to), reverse);
  }
  const endpointById = new Map<string, TypedDependencyEndpoint>();
  for (const element of elements) {
    const endpoint = elementEndpoint(elementsById, element.id, elementStatementIndex.get(element.id) ?? 0);
    endpointById.set(endpointId(endpoint), endpoint);
  }
  for (const binding of bindingAnalysis?.catalog.bindings ?? []) {
    const endpoint = bindingEndpoint(bindingAnalysis!, binding.id);
    endpointById.set(endpointId(endpoint), endpoint);
  }
  for (const edge of edges) {
    endpointById.set(endpointId(edge.from), edge.from);
    endpointById.set(endpointId(edge.to), edge.to);
  }
  const dependenciesByNode = new Map<string, string[]>();
  for (const edge of edges) {
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
        const cycleEndpoints = cycleIds.map((id) => endpointById.get(id)).filter((endpoint): endpoint is TypedDependencyEndpoint => Boolean(endpoint));
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
  for (const endpointIdValue of endpointById.keys()) visit(endpointIdValue);
  const evaluationOrder = orderedEndpoints
    .map((id) => endpointById.get(id))
    .filter((endpoint): endpoint is Extract<TypedDependencyEndpoint, { kind: "element" }> => endpoint?.kind === "element")
    .map((endpoint) => endpoint.id);
  return { edges, directByEndpointId, reverseByEndpointId, evaluationOrder, cycles };
};

export const typedDependencyEndpointId = endpointId;
