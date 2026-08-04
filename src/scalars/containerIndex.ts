import type { DslStatement } from "../dsl/dslTypes";
import type { CadElement, ElementId } from "../types/geometry";
import type { LexicalScopeIndex, ScopeId } from "./lexicalScopeIndex";

export type CadContainerKind = "group" | "conditionalGroup" | "forGroup";

export type ReconciledCadContainerInput = {
  elementIdByStatementIndex: ReadonlyMap<number, ElementId>;
  elements: readonly CadElement[];
};

export type CadContainerIndex = {
  ownerContainerIdByStatementIndex: ReadonlyMap<number, ElementId | null>;
  containerIdByScopeId: ReadonlyMap<ScopeId, ElementId>;
  containerKindById: ReadonlyMap<ElementId, CadContainerKind>;
  parentContainerIdById: ReadonlyMap<ElementId, ElementId | null>;
  effectiveScopeIdByContainerId: ReadonlyMap<ElementId, ScopeId>;
};

const containerKind = (element: CadElement): CadContainerKind | null => {
  if (element.type === "group" || element.type === "conditionalGroup" || element.type === "forGroup") {
    return element.type;
  }
  return null;
};

export const buildCadContainerIndex = ({
  statements,
  scopeIndex,
  reconciled
}: {
  statements: readonly DslStatement[];
  scopeIndex: LexicalScopeIndex;
  reconciled: ReconciledCadContainerInput;
}): CadContainerIndex => {
  const elementsById = new Map(reconciled.elements.map((element) => [element.id, element]));
  const containerKindById = new Map<ElementId, CadContainerKind>();
  const parentContainerIdById = new Map<ElementId, ElementId | null>();
  for (const element of reconciled.elements) {
    const kind = containerKind(element);
    if (!kind) continue;
    containerKindById.set(element.id, kind);
    parentContainerIdById.set(element.id, element.parentGroupId ?? null);
  }

  const containerIdByScopeId = new Map<ScopeId, ElementId>();
  const effectiveScopeIdByContainerId = new Map<ElementId, ScopeId>();
  for (const [scopeId, scope] of scopeIndex.scopes) {
    if (scope.openingStatementIndex === null) continue;
    const containerId = reconciled.elementIdByStatementIndex.get(scope.openingStatementIndex);
    if (!containerId) {
      throw new Error(`containerIndex: no reconciled container id for scope ${scopeId}`);
    }
    const kind = containerKindById.get(containerId);
    if (!kind) throw new Error(`containerIndex: scope ${scopeId} owner ${containerId} is not a CAD container`);
    containerIdByScopeId.set(scopeId, containerId);
    if (scope.kind === "group" || scope.kind === "forGroup") {
      effectiveScopeIdByContainerId.set(containerId, scopeId);
    } else if (scope.kind === "then" || scope.kind === "else") {
      effectiveScopeIdByContainerId.set(containerId, `container:${containerId}`);
    }
  }

  const ownerContainerIdByStatementIndex = new Map<number, ElementId | null>();
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const elementId = reconciled.elementIdByStatementIndex.get(statementIndex);
    if (elementId) {
      const element = elementsById.get(elementId);
      if (!element) throw new Error(`containerIndex: missing reconciled element ${elementId}`);
      ownerContainerIdByStatementIndex.set(statementIndex, element.parentGroupId ?? null);
      continue;
    }
    const scopeId = scopeIndex.scopeOfStatement.get(statementIndex) ?? scopeIndex.rootScopeId;
    ownerContainerIdByStatementIndex.set(statementIndex, containerIdByScopeId.get(scopeId) ?? null);
  }

  return {
    ownerContainerIdByStatementIndex,
    containerIdByScopeId,
    containerKindById,
    parentContainerIdById,
    effectiveScopeIdByContainerId
  };
};
