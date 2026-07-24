// Task 32's Rust mutation boundary. It serializes Task 30's completed graph
// verbatim enough for Rust to validate/evaluate it, but never reparses source,
// resolves names, or synthesizes any identity.
import type { CadElement, ElementId } from "../types/geometry";
import type { BindingVersion, BindingVersionGraph } from "../scalars/bindingVersions";

export type BindingMutationElementSourceOrder = {
  elementId: ElementId;
  sourceOrder: number;
};

export type RustBindingMutationPayload = {
  versions: readonly Record<string, unknown>[];
  elementSourceOrders: readonly BindingMutationElementSourceOrder[];
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
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined
): RustBindingMutationPayload => {
  if (!statementInfoByElementId) {
    throw new Error("buildRustBindingMutationPayload: missing compiled element statement positions");
  }
  const elementSourceOrders = elements.map((element) => {
    const statement = statementInfoByElementId.get(element.id);
    if (!statement) {
      throw new Error(`buildRustBindingMutationPayload: no compiled statement position for ${element.id}`);
    }
    return { elementId: element.id, sourceOrder: statement.statementIndex };
  });
  return {
    versions: graph.versions.map(versionPayload),
    elementSourceOrders,
    ...(graph.evaluationLimitSourceOrder === undefined
      ? {}
      : { evaluationLimitSourceOrder: graph.evaluationLimitSourceOrder })
  };
};
