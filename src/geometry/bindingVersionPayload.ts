// Host-neutral Rust execution boundary. It serializes compiler-owned binding
// and control metadata without reparsing source or resolving names.
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingVersion, BindingVersionGraph } from "@nuinuicad/nui-language";
import type { ScalarProgramCollection } from "@nuinuicad/nui-language";
import { buildConditionalMutationOwners } from "../scalars/conditionalMutationControl";
import { buildForGroupExecutionOwners } from "../scalars/forGroupMutationControl";

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
    moduleExecutionOwner?: true;
  }[];
  collectionValues?: readonly ScalarProgramCollection[];
  immutableForGroups?: readonly {
    ownerStatementId: string;
    carries: readonly {
      bindingId: string;
      nextBindingId?: string;
      initializer: unknown;
      declaredType: unknown;
      nextExpression: unknown;
      nextSourceOrder: number;
    }[];
    geometryCarries?: readonly {
      bindingId: string;
      declaredType: unknown;
      initializerTarget: unknown;
      nextTarget: unknown;
      nextSourceOrder: number;
    }[];
    collectionCarries?: readonly {
      bindingId: string;
      collectionValueId: string;
      initializerValueId: string;
      nextValueId: string;
      declaredType: unknown;
      nextSourceOrder: number;
    }[];
    geometryCollectionCarries?: readonly {
      bindingId: string;
      collectionValueId: string;
      initializer: unknown;
      next: unknown;
      declaredType: unknown;
      nextSourceOrder: number;
    }[];
  }[];
};

type StatementInfo = { statementIndex: number };

const versionPayload = (version: BindingVersion): Record<string, unknown> => ({
  versionId: version.id,
  statementId: version.id,
  kind: version.kind,
  bindingId: version.bindingId,
  bindingKind: version.bindingKind,
  declaredType: version.declaredType,
  sourceOrder: version.sourceOrder,
  scopeId: version.scopeId,
  scopeExitSourceOrder: version.scopeExitSourceOrder,
  control: version.control,
  ...(version.predecessorId === undefined ? {} : { predecessorId: version.predecessorId }),
  initialState: version.initialState,
  ...(version.initializer ? { initializer: version.initializer } : {})
});

/**
 * Keeps geometry evaluation && mutation advancement on the compiler's own
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
  moduleForGroupOwners?: ReadonlyMap<ElementId, Extract<import("@nuinuicad/nui-language").BindingControlOwner, { kind: "forGroup" }> & { elementId: ElementId }>,
  collectionValues?: readonly ScalarProgramCollection[]
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
      ...buildForGroupExecutionOwners(
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
            iterationBindingId: owner.iterationBindingId ?? `binding:iteration:${owner.ownerStatementId}`,
            moduleExecutionOwner: true as const
          }))
        : [])
    ],
    elementSourceOrders,
    ...(elementSourceExecutionUnits ? { elementSourceExecutionUnits } : {}),
    ...(collectionValues?.length ? { collectionValues } : {})
    ,...(graph.immutableForGroups?.size
      ? {
          immutableForGroups: [...graph.immutableForGroups.values()].map((plan) => ({
            ownerStatementId: plan.ownerStatementId,
            carries: plan.carries.map((carry) => ({
              bindingId: carry.bindingId,
              ...(carry.nextBindingId ? { nextBindingId: carry.nextBindingId } : {}),
              initializer: carry.initializer,
              declaredType: carry.declaredType,
              nextExpression: carry.nextExpression,
              nextSourceOrder: carry.nextSourceOrder
            })),
            ...(plan.geometryCarries?.length ? {
              geometryCarries: plan.geometryCarries.map((carry) => ({
                bindingId: carry.bindingId,
                declaredType: carry.declaredType,
                initializerTarget: carry.initializerTarget,
                nextTarget: carry.nextTarget,
                nextSourceOrder: carry.nextSourceOrder
              }))
            } : {}),
            ...(plan.collectionCarries?.length ? {
              collectionCarries: plan.collectionCarries.map((carry) => ({
                bindingId: carry.bindingId,
                collectionValueId: carry.collectionValueId,
                initializerValueId: carry.initializerValueId,
                nextValueId: carry.nextValueId,
                declaredType: carry.declaredType,
                nextSourceOrder: carry.nextSourceOrder
              }))
            } : {}),
            ...(plan.geometryCollectionCarries?.length ? {
              geometryCollectionCarries: plan.geometryCollectionCarries.map((carry) => ({
                bindingId: carry.bindingId,
                collectionValueId: carry.collectionValueId,
                initializer: carry.initializer,
                next: carry.next,
                declaredType: carry.declaredType,
                nextSourceOrder: carry.nextSourceOrder
              }))
            } : {})
          }))
        }
      : {})
  };
};
