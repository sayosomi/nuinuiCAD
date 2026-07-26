// Static Task 35 join between Task 30 forGroup owners and compiled elements.
// It never reconstructs source order or stable identities from element order.
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingControlOwner, BindingVersionGraph } from "./bindingVersions";

export type ForGroupMutationOwner = Extract<BindingControlOwner, { kind: "forGroup" }> & {
  elementId: ElementId;
};

type StatementInfo = { statementIndex: number };

export const buildForGroupMutationOwners = (
  graph: BindingVersionGraph,
  elements: readonly CadElement[],
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  statementIdByStatementIndex: ReadonlyMap<number, string> | undefined
): readonly ForGroupMutationOwner[] => {
  const owners = new Map<string, Extract<BindingControlOwner, { kind: "forGroup" }>>();
  for (const version of graph.versions) for (const owner of version.control.ownerChain) {
    if (owner.kind !== "forGroup") continue;
    const previous = owners.get(owner.ownerStatementId);
    if (previous && (previous.scopeId !== owner.scopeId || previous.exitSourceOrder !== owner.exitSourceOrder)) {
      throw new Error(`forGroup mutation owner ${owner.ownerStatementId} has inconsistent control metadata`);
    }
    owners.set(owner.ownerStatementId, owner);
  }
  if (!owners.size) return [];
  if (!statementInfoByElementId || !statementIdByStatementIndex) {
    throw new Error("forGroup mutation requires compiled forGroup statement identities");
  }
  const result: ForGroupMutationOwner[] = [];
  for (const element of elements) {
    if (element.type !== "forGroup") continue;
    const statement = statementInfoByElementId.get(element.id);
    const statementId = statement && statementIdByStatementIndex.get(statement.statementIndex);
    const owner = statementId ? owners.get(statementId) : undefined;
    if (!owner) continue;
    owners.delete(statementId!);
    result.push({ ...owner, elementId: element.id });
  }
  if (owners.size) throw new Error(`forGroup mutation owner has no matching forGroup element: ${[...owners.keys()].join(", ")}`);
  return result;
};

export const forGroupMutationOwnerByElementId = (
  owners: readonly ForGroupMutationOwner[]
): ReadonlyMap<ElementId, ForGroupMutationOwner> => new Map(owners.map((owner) => [owner.elementId, owner]));

/**
 * Eligibility must not infer an owner from element order. A missing, stale,
 * or inconsistent compiled join keeps the document on the TS reference path.
 */
export const hasCanonicalForGroupMutationOwners = (
  graph: BindingVersionGraph,
  elements: readonly CadElement[],
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  statementIdByStatementIndex: ReadonlyMap<number, string> | undefined,
  ownersByElementId: ReadonlyMap<ElementId, ForGroupMutationOwner> | undefined
): boolean => {
  if (!ownersByElementId) return false;
  try {
    const expected = buildForGroupMutationOwners(
      graph, elements, statementInfoByElementId, statementIdByStatementIndex
    );
    return expected.length === ownersByElementId.size && expected.every((owner) => {
      const actual = ownersByElementId.get(owner.elementId);
      return actual?.ownerStatementId === owner.ownerStatementId &&
        actual.scopeId === owner.scopeId && actual.exitSourceOrder === owner.exitSourceOrder;
    });
  } catch {
    return false;
  }
};
