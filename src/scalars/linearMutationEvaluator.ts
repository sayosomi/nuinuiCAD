// Incremental Task 31/33 mutation evaluator. It consumes Task 30's completed
// graph and runtime Task 25 branch results only; source parsing/resolution and
// branch-expression evaluation remain outside this module.
import type { BindingId } from "./bindingCatalog";
import type {
  BindingControlOwner,
  BindingReadPosition,
  BindingVersion,
  BindingVersionGraph,
  BindingVersionId
} from "./bindingVersions";
import { evaluateTypedExpression } from "./expressionEvaluator";
import type { ScalarEvaluation } from "./types";

export type BindingVersionRuntimeHistory = {
  versionId: BindingVersionId;
  statementId: string;
  bindingId: BindingId;
  status: "executed" | "poisoned" | "inactive-control" | "skipped-control";
  evaluation?: ScalarEvaluation;
};

export type LinearMutationEvaluation = {
  resultsByBindingId: ReadonlyMap<BindingId, ScalarEvaluation>;
  historyByVersionId: ReadonlyMap<BindingVersionId, BindingVersionRuntimeHistory>;
};

export type IncrementalLinearMutationEvaluator = {
  advanceTo: (position: BindingReadPosition) => void;
  /** Records Task 25's already-evaluated result exactly once for this owner. */
  registerConditionalResult: (ownerStatementId: string, branch: "then" | "else" | null) => void;
  resolveCurrent: (bindingId: BindingId) => ScalarEvaluation;
  finalize: (position: BindingReadPosition) => LinearMutationEvaluation;
};

export type ResolveExternalScalarBinding = (bindingId: BindingId) => ScalarEvaluation;

const unavailable = (bindingId: BindingId): ScalarEvaluation => ({
  status: "error", type: { kind: "number" }, issueCode: "evaluation-binding-version-unavailable", bindingId
});

const poisoned = (version: BindingVersion): ScalarEvaluation => ({
  status: "error", type: version.declaredType, issueCode: "poisoned-binding", bindingId: version.bindingId
});

const isBeforeOrAt = (version: BindingVersion, position: BindingReadPosition): boolean =>
  position.kind === "beforeStatement" ? version.sourceOrder < position.sourceOrder : version.sourceOrder <= position.sourceOrder;

const statementIdFor = (version: BindingVersion): string => version.kind === "set" ? version.setStatementId : version.id;

export const hasLinearSetVersions = (graph: BindingVersionGraph): boolean =>
  graph.versions.some((version) => version.kind === "set" && version.control.kind === "linear");

export const hasSetVersions = (graph: BindingVersionGraph): boolean => graph.versions.some((version) => version.kind === "set");

const hasForGroupOwner = (graph: BindingVersionGraph): boolean => graph.versions.some((version) =>
  version.control.ownerChain.some((owner) => owner.kind === "forGroup")
);

/** Task 33 permits canonical conditional owners; forGroup stays Task 34-only. */
export const isRustLinearMutationEligible = (graph: BindingVersionGraph): boolean => hasSetVersions(graph) && !hasForGroupOwner(graph);

type ScopeFrame = { scopeId: string; exitSourceOrder: number; localBindingIds: Set<BindingId> };

const conditionalOwners = (graph: BindingVersionGraph): ReadonlyMap<string, readonly Extract<BindingControlOwner, { kind: "conditionalBranch" }>[]> => {
  const byId = new Map<string, Extract<BindingControlOwner, { kind: "conditionalBranch" }>[]>() ;
  for (const version of graph.versions) for (const owner of version.control.ownerChain) {
    if (owner.kind !== "conditionalBranch") continue;
    const entries = byId.get(owner.ownerStatementId) ?? [];
    if (!entries.some((entry) => entry.branch === owner.branch && entry.scopeId === owner.scopeId)) entries.push(owner);
    byId.set(owner.ownerStatementId, entries);
  }
  return byId;
};

/**
 * One monotonic cursor, active slots only, and explicit branch frames. Frames
 * are retired from Task 30's recorded lexical exits, never inferred by
 * replaying source structure or scanning document text.
 */
export const createIncrementalLinearMutationEvaluator = (
  graph: BindingVersionGraph,
  resolveExternalBinding: ResolveExternalScalarBinding
): IncrementalLinearMutationEvaluator => {
  const currentByBindingId = new Map<BindingId, ScalarEvaluation>();
  const historyByVersionId = new Map<BindingVersionId, BindingVersionRuntimeHistory>();
  const conditionalResultByOwnerId = new Map<string, "then" | "else" | null>();
  const frames: ScopeFrame[] = [];
  const ownersById = conditionalOwners(graph);
  const finalBindingIds = new Set(graph.versions.filter((version) =>
    version.kind === "declare" && version.control.ownerChain.length === 0
  ).map((version) => version.bindingId));
  const finalBindingOrder = graph.versions.filter((version) =>
    version.kind === "declare" && finalBindingIds.has(version.bindingId)
  ).map((version) => version.bindingId);
  let nextVersionIndex = 0;

  const resolveCurrent = (bindingId: BindingId): ScalarEvaluation => {
    const current = currentByBindingId.get(bindingId);
    return current ?? (graph.versionIdsByBindingId.has(bindingId) ? unavailable(bindingId) : resolveExternalBinding(bindingId));
  };

  const retireFramesBefore = (sourceOrder: number) => {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (frame.exitSourceOrder >= sourceOrder) continue;
      for (const bindingId of frame.localBindingIds) currentByBindingId.delete(bindingId);
      frames.splice(index, 1);
    }
  };

  const activeControl = (version: BindingVersion): "active" | "inactive" | "unsupported" => {
    for (const owner of version.control.ownerChain) {
      if (owner.kind === "forGroup") return "unsupported";
      const result = conditionalResultByOwnerId.get(owner.ownerStatementId);
      if (result !== owner.branch) return "inactive";
    }
    return "active";
  };

  const execute = (version: BindingVersion) => {
    const control = activeControl(version);
    if (control !== "active") {
      historyByVersionId.set(version.id, {
        versionId: version.id, statementId: statementIdFor(version), bindingId: version.bindingId,
        status: control === "inactive" ? "inactive-control" : "skipped-control"
      });
      return;
    }
    const evaluation = version.initialState.kind === "poisoned" || (version.kind === "declare" && !version.initializer)
      ? poisoned(version)
      : evaluateTypedExpression(version.kind === "declare" ? version.initializer! : version.expression, { lookupBinding: resolveCurrent });
    currentByBindingId.set(version.bindingId, evaluation);
    if (version.kind === "declare" && version.control.ownerChain.length) {
      const scopeId = version.control.ownerChain.at(-1)!.scopeId;
      let frame: ScopeFrame | undefined;
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        if (frames[index].scopeId === scopeId) { frame = frames[index]; break; }
      }
      if (!frame) throw new Error(`conditional mutation local declaration has no active frame for ${scopeId}`);
      frame.localBindingIds.add(version.bindingId);
    }
    historyByVersionId.set(version.id, {
      versionId: version.id, statementId: statementIdFor(version), bindingId: version.bindingId,
      status: evaluation.status === "error" ? "poisoned" : "executed", evaluation
    });
  };

  const advanceTo = (position: BindingReadPosition): void => {
    while (nextVersionIndex < graph.versions.length) {
      const version = graph.versions[nextVersionIndex];
      if (!isBeforeOrAt(version, position)) break;
      retireFramesBefore(version.sourceOrder);
      nextVersionIndex += 1;
      if (graph.evaluationLimitSourceOrder === undefined || version.sourceOrder < graph.evaluationLimitSourceOrder) execute(version);
    }
    retireFramesBefore(position.sourceOrder);
  };

  const registerConditionalResult = (ownerStatementId: string, branch: "then" | "else" | null): void => {
    if (conditionalResultByOwnerId.has(ownerStatementId)) throw new Error(`conditional mutation owner ${ownerStatementId} was evaluated twice`);
    const owners = ownersById.get(ownerStatementId);
    if (!owners) throw new Error(`conditional mutation received an unknown owner ${ownerStatementId}`);
    conditionalResultByOwnerId.set(ownerStatementId, branch);
    if (branch === null) return;
    const owner = owners.find((candidate) => candidate.branch === branch);
    if (!owner) throw new Error(`conditional mutation owner ${ownerStatementId} has no ${branch} branch metadata`);
    frames.push({ scopeId: owner.scopeId, exitSourceOrder: owner.exitSourceOrder, localBindingIds: new Set() });
  };

  const finalize = (position: BindingReadPosition): LinearMutationEvaluation => {
    advanceTo(position);
    return {
      resultsByBindingId: new Map(finalBindingOrder.flatMap((bindingId) => {
        const result = currentByBindingId.get(bindingId);
        return result ? [[bindingId, result] as const] : [];
      })),
      historyByVersionId: new Map(historyByVersionId)
    };
  };

  return { advanceTo, registerConditionalResult, resolveCurrent, finalize };
};
