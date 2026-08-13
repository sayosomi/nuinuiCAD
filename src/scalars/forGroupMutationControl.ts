// Static Task 35 join between Task 30 forGroup owners && compiled elements.
// It never reconstructs source order || stable identities from element order.
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
  statementIdByStatementIndex: ReadonlyMap<number, string> | undefined,
  prejoinedOwnerStatementIds: ReadonlySet<string> = new Set()
): readonly ForGroupMutationOwner[] => {
  const owners = new Map<string, Extract<BindingControlOwner, { kind: "forGroup" }>>();
  for (const version of graph.versions) for (const owner of version.control.ownerChain) {
    if (owner.kind !== "forGroup" || prejoinedOwnerStatementIds.has(owner.ownerStatementId)) continue;
    const previous = owners.get(owner.ownerStatementId);
    if (previous && (previous.scopeId !== owner.scopeId || previous.exitSourceOrder !== owner.exitSourceOrder || previous.iterationBindingId !== owner.iterationBindingId)) {
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
 * || inconsistent compiled join keeps the document on the TS reference path.
 */
export const hasCanonicalForGroupMutationOwners = (
  graph: BindingVersionGraph,
  elements: readonly CadElement[],
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  statementIdByStatementIndex: ReadonlyMap<number, string> | undefined,
  ownersByElementId: ReadonlyMap<ElementId, ForGroupMutationOwner> | undefined,
  prejoinedOwnerStatementIds: ReadonlySet<string> = new Set()
): boolean => {
  if (!ownersByElementId) return false;
  try {
    const expected = buildForGroupMutationOwners(
      graph, elements, statementInfoByElementId, statementIdByStatementIndex, prejoinedOwnerStatementIds
    );
    const ordinaryActual = [...ownersByElementId.values()].filter((owner) =>
      !prejoinedOwnerStatementIds.has(owner.ownerStatementId)
    );
    if (expected.length !== ordinaryActual.length || !expected.every((owner) => {
      const actual = ownersByElementId.get(owner.elementId);
      return actual?.ownerStatementId === owner.ownerStatementId &&
        actual.scopeId === owner.scopeId && actual.exitSourceOrder === owner.exitSourceOrder &&
        actual.iterationBindingId === owner.iterationBindingId;
    })) return false;

    const prejoinedByOwnerId = new Map<string, Extract<BindingControlOwner, { kind: "forGroup" }>>();
    for (const version of graph.versions) for (const owner of version.control.ownerChain) {
      if (owner.kind !== "forGroup" || !prejoinedOwnerStatementIds.has(owner.ownerStatementId)) continue;
      const previous = prejoinedByOwnerId.get(owner.ownerStatementId);
      if (previous && (previous.scopeId !== owner.scopeId || previous.exitSourceOrder !== owner.exitSourceOrder || previous.iterationBindingId !== owner.iterationBindingId)) return false;
      prejoinedByOwnerId.set(owner.ownerStatementId, owner);
    }
    const prejoinedActual = [...ownersByElementId.values()].filter((owner) =>
      prejoinedOwnerStatementIds.has(owner.ownerStatementId)
    );
    return prejoinedActual.length === prejoinedByOwnerId.size && [...prejoinedByOwnerId].every(([ownerStatementId, owner]) => {
      const actual = prejoinedActual.find((candidate) => candidate.ownerStatementId === ownerStatementId);
      return actual?.scopeId === owner.scopeId && actual.exitSourceOrder === owner.exitSourceOrder &&
        actual.iterationBindingId === owner.iterationBindingId;
    });
  } catch {
    return false;
  }
};
