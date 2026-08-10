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
import {
  createForGroupMutationEnvironment,
  type ForGroupMutationFrame,
  type ForGroupMutationRunOutcome
} from "./forGroupMutationCore";
import type { ScalarEvaluation } from "./types";
import type { TypedScalarGeometryPropertyReferenceNode } from "./typedExpressionAst";

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
  runForGroup: (
    plan: ForGroupMutationExecutionPlan,
    executeStatement: (statement: ForGroupMutationStatement, context: ForGroupMutationExecutionContext) => ForGroupMutationRunOutcome
  ) => ForGroupMutationRunOutcome;
};

/** Statements are supplied from the compiler's existing element map only. */
export type ForGroupMutationStatement = {
  sourceOrder: number;
  kind: "element" | "exit";
  templateElementId?: string;
};
export type ForGroupMutationExecutionPlan = {
  ownerStatementId: string;
  loopScopeId: string;
  iterationBindingId: BindingId;
  iterationValues: readonly number[];
  statements: readonly ForGroupMutationStatement[];
};
export type ForGroupMutationExecutionContext = {
  iterationIndex: number;
  iterationValue: number;
};

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

/**
 * Task 35 supports forGroup owners, but the caller must separately prove its
 * compiled element-owner metadata is canonical before it sends the graph to
 * Rust. This helper deliberately says nothing about that payload join.
 */
export const isRustLinearMutationEligible = (graph: BindingVersionGraph): boolean =>
  (hasSetVersions(graph) || graph.requiresExecutionOrdering === true) &&
  graph.versions.every((version) => version.control.ownerChain.every((owner) =>
    owner.kind === "conditionalBranch" || owner.kind === "forGroup"
  ));

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
  resolveGeometryProperty?: (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number) => ScalarEvaluation
): IncrementalLinearMutationEvaluator => {
  const currentByBindingId = new Map<BindingId, ScalarEvaluation>();
  const historyByVersionId = new Map<BindingVersionId, BindingVersionRuntimeHistory>();
  const conditionalResultByOwnerId = new Map<string, "then" | "else" | null>();
  // A conditional inside a forGroup is evaluated once per iteration. Keeping
  // those results in a stack prevents an outer iteration from leaking its
  // branch decision into the next iteration or a sibling nested loop.
  const loopConditionalResults: Map<string, "then" | "else" | null>[] = [];
  const frames: ScopeFrame[] = [];
  const ownersById = conditionalOwners(graph);
  const finalBindingIds = new Set(graph.versions.filter((version) =>
    version.kind === "declare" && version.control.ownerChain.length === 0
  ).map((version) => version.bindingId));
  const finalBindingOrder = graph.versions.filter((version) =>
    version.kind === "declare" && finalBindingIds.has(version.bindingId)
  ).map((version) => version.bindingId);
  let nextVersionIndex = 0;
  let activeLoopEnvironment: ReturnType<typeof createForGroupMutationEnvironment<ScalarEvaluation>> | undefined;

  const conditionalResultFor = (ownerStatementId: string) => {
    for (let index = loopConditionalResults.length - 1; index >= 0; index -= 1) {
      const result = loopConditionalResults[index].get(ownerStatementId);
      if (result !== undefined) return result;
    }
    return conditionalResultByOwnerId.get(ownerStatementId);
  };

  const resolveCurrent = (bindingId: BindingId): ScalarEvaluation => {
    const loopValue = activeLoopEnvironment?.read(bindingId);
    if (typeof loopValue === "number") {
      return { status: "ok", type: { kind: "number" }, value: { kind: "number", value: loopValue } };
    }
    if (loopValue) return loopValue;
    const current = currentByBindingId.get(bindingId);
    return current ?? unavailable(bindingId);
  };

  const retireFramesBefore = (sourceOrder: number) => {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      if (frame.exitSourceOrder >= sourceOrder) continue;
      for (const bindingId of frame.localBindingIds) currentByBindingId.delete(bindingId);
      frames.splice(index, 1);
    }
  };

  const activeControl = (version: BindingVersion, insideLoop = false): "active" | "inactive" | "unsupported" => {
    for (const owner of version.control.ownerChain) {
      if (owner.kind === "forGroup") {
        if (!insideLoop) return "unsupported";
        continue;
      }
      const result = conditionalResultFor(owner.ownerStatementId);
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
      : evaluateTypedExpression(version.kind === "declare" ? version.initializer! : version.expression, {
        lookupBinding: resolveCurrent,
        ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, version.sourceOrder) } : {})
      });
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

  const loopVersionsFor = (ownerStatementId: string): readonly BindingVersion[] => graph.versions.filter((version) => {
    const owners = version.control.ownerChain;
    const index = owners.findIndex((owner) => owner.kind === "forGroup" && owner.ownerStatementId === ownerStatementId);
    return index >= 0 && !owners.slice(index + 1).some((owner) => owner.kind === "forGroup");
  });

  const executeLoopVersion = (version: BindingVersion, frame: ForGroupMutationFrame<ScalarEvaluation>) => {
    const control = activeControl(version, true);
    if (control !== "active") {
      historyByVersionId.set(version.id, {
        versionId: version.id, statementId: statementIdFor(version), bindingId: version.bindingId,
        status: control === "inactive" ? "inactive-control" : "skipped-control"
      });
      return;
    }
    const evaluation = version.initialState.kind === "poisoned" || (version.kind === "declare" && !version.initializer)
      ? poisoned(version)
      : evaluateTypedExpression(version.kind === "declare" ? version.initializer! : version.expression, {
        lookupBinding: resolveCurrent,
        ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, version.sourceOrder) } : {})
      });
    const isLoopLocal = version.kind === "declare" && version.control.ownerChain.length > 0;
    if (isLoopLocal) frame.declareLocal(version.bindingId, evaluation);
    else frame.set(version.bindingId, evaluation);
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
    const loopResults = loopConditionalResults.at(-1);
    if (loopResults) {
      if (loopResults.has(ownerStatementId)) {
        throw new Error(`conditional mutation owner ${ownerStatementId} was evaluated twice in one forGroup iteration`);
      }
      loopResults.set(ownerStatementId, branch);
      return;
    }
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

  const runForGroup: IncrementalLinearMutationEvaluator["runForGroup"] = (plan, executeStatement) => {
    const loopVersions = loopVersionsFor(plan.ownerStatementId);
    const outerEnvironment = activeLoopEnvironment;
    const environment = outerEnvironment ?? createForGroupMutationEnvironment(currentByBindingId);
    let versionIndex = 0;
    let activeIterationIndex = -1;
    const iterationConditionalResults = new Map<string, "then" | "else" | null>();
    const runVersionsBefore = (sourceOrder: number, frame: ForGroupMutationFrame<ScalarEvaluation>) => {
      while (versionIndex < loopVersions.length && loopVersions[versionIndex].sourceOrder < sourceOrder) {
        const version = loopVersions[versionIndex];
        versionIndex += 1;
        if (graph.evaluationLimitSourceOrder === undefined || version.sourceOrder < graph.evaluationLimitSourceOrder) {
          executeLoopVersion(version, frame);
        }
      }
    };
    // The regular cursor must never traverse this static body range. This is
    // deliberately index-only: execution and history stay owned by the loop
    // scheduler (or remain absent when the scheduler does not run).
    if (!outerEnvironment) {
      const exit = plan.statements.find((statement) => statement.kind === "exit")?.sourceOrder;
      if (exit !== undefined) {
        while (nextVersionIndex < graph.versions.length && graph.versions[nextVersionIndex].sourceOrder < exit) {
          nextVersionIndex += 1;
        }
      }
    }
    activeLoopEnvironment = environment;
    loopConditionalResults.push(iterationConditionalResults);
    try {
      const outcome = environment.run({
        loopScopeId: plan.loopScopeId,
        iterationBindingId: plan.iterationBindingId,
        iterationValues: plan.iterationValues,
        generatedStatements: plan.statements
      }, (frame, context) => {
        // Each iteration replays only its own source-ordered loop body. No
        // generated payload carries an environment; the core frame is shared.
        if (activeIterationIndex !== context.iterationIndex) {
          activeIterationIndex = context.iterationIndex;
          versionIndex = 0;
          iterationConditionalResults.clear();
        }
        runVersionsBefore(context.statement.sourceOrder, frame);
        return executeStatement(context.statement, context);
      });
      if (!outerEnvironment) {
        for (const [bindingId, value] of environment.finalSlots()) currentByBindingId.set(bindingId, value);
      }
      return outcome;
    } finally {
      loopConditionalResults.pop();
      activeLoopEnvironment = outerEnvironment;
    }
  };

  return { advanceTo, registerConditionalResult, resolveCurrent, finalize, runForGroup };
};
