// Task 32's Rust mutation boundary. It serializes Task 30's completed graph
// verbatim enough for Rust to validate/evaluate it, but never reparses source,
// resolves names, or synthesizes any identity.
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingVersion, BindingVersionGraph } from "../scalars/bindingVersions";
import { buildConditionalMutationOwners } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners } from "../scalars/forGroupMutationControl";

export type BindingMutationElementSourceOrder = {
  elementId: ElementId;
  sourceOrder: number;
};

export type BindingMutationElementSourceExecutionUnit = {
  elementId: ElementId;
  executionUnit: number;
};

export type RustBindingMutationPayload = {
  versions: readonly Record<string, unknown>[];
  elementSourceOrders: readonly BindingMutationElementSourceOrder[];
  /** Present when materialized runtime elements share a source execution unit. */
  elementSourceExecutionUnits?: readonly BindingMutationElementSourceExecutionUnit[];
  conditionalOwners: readonly { ownerStatementId: string; elementId: ElementId }[];
  forGroupOwners: readonly {
    ownerStatementId: string; elementId: ElementId; scopeId: string;
    exitSourceOrder: number; iterationBindingId: string;
  }[];
  evaluationLimitSourceOrder?: number;
};

type StatementInfo = { statementIndex: number };

const versionPayload = (version: BindingVersion): Record<string, unknown> => ({
  versionId: version.id,
  statementId: version.kind === "set" ? version.setStatementId : version.id,
  kind: version.kind,
  bindingId: version.bindingId,
  ...(version.kind === "set" ? { targetBindingId: version.bindingId } : {}),
  bindingKind: version.bindingKind,
  declaredType: version.declaredType,
  sourceOrder: version.sourceOrder,
  scopeId: version.scopeId,
  scopeExitSourceOrder: version.scopeExitSourceOrder,
  control: version.control,
  ...(version.predecessorId === undefined ? {} : { predecessorId: version.predecessorId }),
  initialState: version.initialState,
  ...(version.kind === "declare" ? { initializer: version.initializer } : { expression: version.expression })
});

/**
 * Keeps geometry evaluation and mutation advancement on the compiler's own
 * statement positions. Missing positions are a caller-contract violation;
 * silently using array order would change set semantics.
 */
export const buildRustBindingMutationPayload = (
  graph: BindingVersionGraph,
  elements: readonly CadElement[],
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  statementIdByStatementIndex: ReadonlyMap<number, string> | undefined,
  sourceExecutionPositionByElementId?: ReadonlyMap<ElementId, number>,
  scalarExecutionPositionByElementId?: ReadonlyMap<ElementId, number>,
  moduleConditionalOwners?: ReadonlyMap<ElementId, string>,
  moduleForGroupOwners?: ReadonlyMap<ElementId, Extract<import("../scalars/bindingVersions").BindingControlOwner, { kind: "forGroup" }> & { elementId: ElementId }>
): RustBindingMutationPayload => {
  if (!statementInfoByElementId && !sourceExecutionPositionByElementId && !scalarExecutionPositionByElementId) {
    throw new Error("buildRustBindingMutationPayload: missing compiled source execution positions");
  }
  const elementSourceOrders = elements.map((element) => {
    const sourceExecutionPosition = scalarExecutionPositionByElementId?.get(element.id) ??
      statementInfoByElementId?.get(element.id)?.statementIndex ?? sourceExecutionPositionByElementId?.get(element.id);
    const statement = statementInfoByElementId?.get(element.id);
    const sourceOrder = sourceExecutionPosition ?? statement?.statementIndex;
    if (sourceOrder === undefined) {
      throw new Error(`buildRustBindingMutationPayload: no compiled source execution position for ${element.id}`);
    }
    return { elementId: element.id, sourceOrder };
  });
  const elementSourceExecutionUnits = sourceExecutionPositionByElementId
    ? elements.map((element) => {
        const executionUnit = sourceExecutionPositionByElementId.get(element.id) ?? statementInfoByElementId?.get(element.id)?.statementIndex;
        if (executionUnit === undefined) {
          throw new Error(`buildRustBindingMutationPayload: no compiled execution unit for ${element.id}`);
        }
        return { elementId: element.id, executionUnit };
      })
    : undefined;
  return {
    versions: graph.versions.map(versionPayload),
    conditionalOwners: [
      ...buildConditionalMutationOwners(
        graph,
        elements,
        statementInfoByElementId,
        statementIdByStatementIndex,
        new Set(moduleConditionalOwners?.values() ?? [])
      ),
      ...(moduleConditionalOwners
        ? [...moduleConditionalOwners].map(([elementId, ownerStatementId]) => ({ elementId, ownerStatementId }))
        : [])
    ],
    forGroupOwners: [
      ...buildForGroupMutationOwners(
        graph,
        elements,
        statementInfoByElementId,
        statementIdByStatementIndex,
        new Set(moduleForGroupOwners ? [...moduleForGroupOwners.values()].map((owner) => owner.ownerStatementId) : [])
      ).map((owner) => ({
        ownerStatementId: owner.ownerStatementId,
        elementId: owner.elementId,
        scopeId: owner.scopeId,
        exitSourceOrder: owner.exitSourceOrder,
        iterationBindingId: owner.iterationBindingId ?? `binding:iteration:${owner.ownerStatementId}`
      })),
      ...(moduleForGroupOwners
        ? [...moduleForGroupOwners.values()].map((owner) => ({
            ownerStatementId: owner.ownerStatementId,
            elementId: owner.elementId,
            scopeId: owner.scopeId,
            exitSourceOrder: owner.exitSourceOrder,
            iterationBindingId: owner.iterationBindingId ?? `binding:iteration:${owner.ownerStatementId}`
          }))
        : [])
    ],
    elementSourceOrders,
    ...(elementSourceExecutionUnits ? { elementSourceExecutionUnits } : {}),
    ...(graph.evaluationLimitSourceOrder === undefined
      ? {}
      : { evaluationLimitSourceOrder: graph.evaluationLimitSourceOrder })
  };
};
