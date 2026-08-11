import type { ModuleMaterialization, ModuleOrigin } from "../dsl/moduleMaterialization";
import type { ModuleSemanticAnalysis } from "../dsl/moduleSemanticTypes";
import { elementDisplayName } from "./elementNames";
import type { CadElement, ElementId } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";

export type ModuleHierarchyNodeKind = "ordinary" | "moduleInstance" | "materializedChild";
export type ModuleMemberVisibility = "private" | "exported";

export type ModuleHierarchyNode = {
  id: ElementId;
  element: CadElement;
  displayName: string;
  typeLabel: string;
  kind: ModuleHierarchyNodeKind;
  moduleDefinitionName?: string;
  memberVisibility?: ModuleMemberVisibility;
  children: ModuleHierarchyNode[];
};

type ModuleHierarchyInput = {
  elements: readonly CadElement[];
  moduleMaterialization?: ModuleMaterialization;
  moduleSemanticAnalysis?: ModuleSemanticAnalysis;
};

const originFor = (
  moduleMaterialization: ModuleMaterialization | undefined,
  elementId: ElementId
): ModuleOrigin | undefined => moduleMaterialization?.originByRuntimeElementId.get(elementId);

const definitionForOrigin = (
  moduleSemanticAnalysis: ModuleSemanticAnalysis | undefined,
  origin: ModuleOrigin | undefined
) => origin
  ? moduleSemanticAnalysis?.definitionsByStatementId.get(origin.moduleDefinitionStatementId)
  : undefined;

const memberVisibilityFor = (
  moduleSemanticAnalysis: ModuleSemanticAnalysis | undefined,
  origin: ModuleOrigin | undefined
): ModuleMemberVisibility | undefined => {
  if (!origin || origin.kind !== "moduleBody") return undefined;
  const definition = definitionForOrigin(moduleSemanticAnalysis, origin);
  return definition?.exports.some((entry) => entry.exportedStatementId === origin.sourceStatementId)
    ? "exported"
    : "private";
};

const nodeKindFor = (element: CadElement, origin: ModuleOrigin | undefined): ModuleHierarchyNodeKind => {
  if (element.type === "moduleInstance" || origin?.kind === "moduleInstance") return "moduleInstance";
  return origin?.kind === "moduleBody" ? "materializedChild" : "ordinary";
};

const nodeMatchesSelf = (node: ModuleHierarchyNode, query: string): boolean => {
  if (!query) return true;
  const haystack = [
    node.displayName,
    node.typeLabel,
    node.moduleDefinitionName ?? "",
    node.memberVisibility ?? ""
  ].join(" ").toLocaleLowerCase();
  return haystack.includes(query);
};

const nodeMatches = (node: ModuleHierarchyNode, query: string): boolean =>
  nodeMatchesSelf(node, query) || node.children.some((child) => nodeMatches(child, query));

/** Build the runtime composition tree without copying module source into it.
 * Parentage comes from materialized runtime elements; module display metadata
 * comes from stable origin and semantic analysis only. */
export const buildModuleHierarchy = ({
  elements,
  moduleMaterialization,
  moduleSemanticAnalysis
}: ModuleHierarchyInput): ModuleHierarchyNode[] => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const childrenByParentId = new Map<ElementId, CadElement[]>();
  for (const element of elements) {
    if (!element.parentGroupId || !byId.has(element.parentGroupId)) continue;
    const children = childrenByParentId.get(element.parentGroupId) ?? [];
    children.push(element);
    childrenByParentId.set(element.parentGroupId, children);
  }

  const build = (element: CadElement, visiting: ReadonlySet<ElementId>): ModuleHierarchyNode => {
    const origin = originFor(moduleMaterialization, element.id);
    const definition = definitionForOrigin(moduleSemanticAnalysis, origin);
    const nextVisiting = new Set(visiting).add(element.id);
    const children = (childrenByParentId.get(element.id) ?? [])
      .filter((child) => !nextVisiting.has(child.id))
      .map((child) => build(child, nextVisiting));
    return {
      id: element.id,
      element,
      displayName: elementDisplayName(element),
      typeLabel: elementTypeLabels[element.type],
      kind: nodeKindFor(element, origin),
      ...(definition ? { moduleDefinitionName: definition.name } : {}),
      ...(memberVisibilityFor(moduleSemanticAnalysis, origin)
        ? { memberVisibility: memberVisibilityFor(moduleSemanticAnalysis, origin) }
        : {}),
      children
    };
  };

  const roots = elements.filter((element) => !element.parentGroupId || !byId.has(element.parentGroupId));
  const rootIds = new Set(roots.map((element) => element.id));
  const result = roots.map((element) => build(element, new Set()));
  // A malformed parent cycle should not make the structural presentation
  // disappear. Keep the cycle member visible as a detached root.
  for (const element of elements) {
    if (!rootIds.has(element.id) && !result.some((node) => containsNode(node, element.id))) {
      result.push(build(element, new Set()));
    }
  }
  return result;
};

const containsNode = (node: ModuleHierarchyNode, id: ElementId): boolean =>
  node.id === id || node.children.some((child) => containsNode(child, id));

export const moduleHierarchyNodeMatches = nodeMatches;

export const moduleHierarchyMatchCount = (
  nodes: readonly ModuleHierarchyNode[],
  query: string
): number => nodes.reduce(
  (count, node) => count + (nodeMatchesSelf(node, query) ? 1 : 0) + moduleHierarchyMatchCount(node.children, query),
  0
);
