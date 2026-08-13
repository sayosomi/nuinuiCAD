// Static Task 33 control metadata. It joins only completed compiler products:
// Task 30 owner chains && the reconciler's statement identities. It never
// parses source, resolves a name, || decides a branch.
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingVersionGraph } from "./bindingVersions";

export type ConditionalMutationOwner = {
  ownerStatementId: string;
  elementId: ElementId;
};

type StatementInfo = { statementIndex: number };

/**
 * Finds the conditionalGroup element for every conditional owner carried by
 * Task 30's graph. The stable statement identity is the sole join key;
 * element array order && source text are deliberately not fallback inputs.
 */
export const buildConditionalMutationOwners = (
  graph: BindingVersionGraph,
  elements: readonly CadElement[],
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  statementIdByStatementIndex: ReadonlyMap<number, string> | undefined,
  prejoinedOwnerStatementIds: ReadonlySet<string> = new Set()
): readonly ConditionalMutationOwner[] => {
  const ownerIds = new Set<string>();
  for (const version of graph.versions) {
    for (const owner of version.control.ownerChain) {
      if (owner.kind === "conditionalBranch" && !prejoinedOwnerStatementIds.has(owner.ownerStatementId)) ownerIds.add(owner.ownerStatementId);
    }
  }
  if (!ownerIds.size) return [];
  if (!statementInfoByElementId || !statementIdByStatementIndex) {
    throw new Error("conditional mutation requires compiled conditional owner statement identities");
  }

  const owners: ConditionalMutationOwner[] = [];
  for (const element of elements) {
    if (element.type !== "conditionalGroup") continue;
    const statement = statementInfoByElementId.get(element.id);
    const statementId = statement && statementIdByStatementIndex.get(statement.statementIndex);
    if (!statementId || !ownerIds.delete(statementId)) continue;
    owners.push({ ownerStatementId: statementId, elementId: element.id });
  }
  if (ownerIds.size) {
    throw new Error(`conditional mutation owner has no matching conditionalGroup element: ${[...ownerIds].join(", ")}`);
  }
  return owners;
};

export const conditionalOwnerIdByElementId = (
  owners: readonly ConditionalMutationOwner[]
): ReadonlyMap<ElementId, string> => new Map(owners.map((owner) => [owner.elementId, owner.ownerStatementId]));
