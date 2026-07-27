// Static typed dependency projection for Task 36. This consumes compiler
// records only: it deliberately never parses DSL source or resolves names.
import type { DslSpan } from "../dsl/dslTypes";
import { effectiveElementActivityById } from "../model/elementActivity";
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingAnalysis, BindingIssue } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import { beforeStatement, readBindingVersionAtPosition, type BindingVersionGraph } from "./bindingVersions";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import type { SetStatementAnalysis } from "./setStatementCompiler";
import type { TextTemplateAst } from "./textTemplate";
import type { TypedScalarExpression } from "./typedExpressionAst";

export type TypedDependencyReason = "missing" | "invalid" | "late" | "disabled";
export type TypedDependencyKind = "initializer" | "set-rhs" | "property-binding" | "template-hole";

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
};

export type TypedDependencyGraphInput = {
  elements: readonly CadElement[];
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  bindingAnalysis?: BindingAnalysis;
  bindingVersions?: BindingVersionGraph;
  propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  setStatements?: ReadonlyMap<number, SetStatementAnalysis>;
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
  if (issue.code === "forward-binding-reference") return "late";
  return "invalid";
};

const staticDisabledBindingIds = (analysis: BindingAnalysis, elements: readonly CadElement[]): ReadonlySet<BindingId> => {
  const activities = effectiveElementActivityById(elements);
  const disabled = new Set<BindingId>();
  for (const binding of analysis.catalog.bindings) {
    const ownerId = analysis.catalog.containerIndex.ownerContainerIdByStatementIndex.get(binding.statementIndex);
    if (ownerId && activities.get(ownerId)?.activity === "disabled") disabled.add(binding.id);
  }
  return disabled;
};

/** Shared with Task 37's rename occurrence gathering (src/scalars/typedRenameOccurrences.ts) - the sole reference-node walker for a typed AST, never forked. */
export const referencesIn = (expression: TypedScalarExpression): readonly Extract<TypedScalarExpression, { kind: "reference" }>[] => {
  const result: Extract<TypedScalarExpression, { kind: "reference" }>[] = [];
  const visit = (node: TypedScalarExpression): void => {
    if (node.kind === "reference") result.push(node);
    else if (node.kind === "unary") visit(node.operand);
    else if (node.kind === "binary") { visit(node.left); visit(node.right); }
    else if (node.kind === "group") visit(node.expression);
  };
  visit(expression);
  return result;
};

/** Builds once during compilation; query consumers only read its adjacency maps. */
export const buildTypedDependencyGraph = ({
  elements,
  elementIdByStatementIndex,
  bindingAnalysis,
  bindingVersions,
  propertyBindings,
  textTemplates,
  setStatements
}: TypedDependencyGraphInput): TypedDependencyGraph | undefined => {
  if (!bindingAnalysis) return undefined;
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const disabledBindingIds = staticDisabledBindingIds(bindingAnalysis, elements);
  const edges: TypedDependencyEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: TypedDependencyEdge) => {
    const key = `${endpointId(edge.from)}|${edge.kind}|${endpointId(edge.to)}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };
  const reasonFor = (bindingId: BindingId): TypedDependencyReason | undefined => {
    const entry = bindingAnalysis.entriesById.get(bindingId);
    if (entry?.status.kind === "invalid" || entry?.programEligibility.kind === "ineligible") return "invalid";
    return disabledBindingIds.has(bindingId) ? "disabled" : undefined;
  };

  for (const binding of bindingAnalysis.catalog.bindings) {
    if (binding.kind !== "typed") continue;
    const from = bindingEndpoint(bindingAnalysis, binding.id);
    for (const edge of bindingAnalysis.graph.edgesByFromBindingId.get(binding.id) ?? []) {
      add({ kind: "initializer", from, to: bindingEndpoint(bindingAnalysis, edge.toBindingId), span: edge.reference.span, reason: reasonFor(edge.toBindingId) });
    }
  }
  for (const issue of bindingAnalysis.issues) {
    if (issue.origin.kind !== "reference") continue;
    const reference = issue.origin.reference;
    const from = bindingEndpoint(bindingAnalysis, issue.bindingId);
    const target = issue.code === "undefined-binding" || issue.code === "forward-binding-reference"
      ? { kind: "missing" as const, id: `${issue.code}:${issue.bindingId}:${reference.occurrenceIndex}`, name: reference.name, statementIndex: from.statementIndex }
      : bindingEndpoint(bindingAnalysis, issue.relatedBindingIds[0] ?? issue.bindingId);
    add({ kind: "initializer", from, to: target, span: issue.span, reason: issueReason(issue) });
  }

  for (const [key, source] of propertyBindings ?? []) {
    if (source.kind !== "binding") continue;
    const statementIndex = Number(key.slice(0, key.indexOf(":")));
    const elementId = elementIdByStatementIndex.get(statementIndex);
    if (!elementId) continue;
    add({
      kind: "property-binding",
      from: elementEndpoint(elementsById, elementId, statementIndex),
      to: bindingEndpoint(bindingAnalysis, source.bindingId),
      span: source.span,
      reason: reasonFor(source.bindingId)
    });
  }
  for (const [key, template] of textTemplates ?? []) {
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
  if (bindingVersions) for (const set of setStatements?.values() ?? []) {
    const version = bindingVersions.versionsById.get(set.statementId);
    if (!version) continue;
    const from: TypedDependencyEndpoint = { kind: "version", id: version.id, bindingId: version.bindingId, statementIndex: set.sourceOrder };
    for (const reference of referencesIn(set.expression)) {
      if (!reference.bindingId) continue;
      const current = readBindingVersionAtPosition(bindingVersions, reference.bindingId, beforeStatement(set.sourceOrder));
      const to = current
        ? { kind: "version" as const, id: current.id, bindingId: current.bindingId, statementIndex: current.sourceOrder }
        : bindingEndpoint(bindingAnalysis, reference.bindingId);
      add({ kind: "set-rhs", from, to, span: reference.span, reason: reasonFor(reference.bindingId) });
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
  return { edges, directByEndpointId, reverseByEndpointId };
};

export const typedDependencyEndpointId = endpointId;
