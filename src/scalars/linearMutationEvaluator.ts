// Incremental Task 31/33 mutation evaluator. It consumes Task 30's completed
// graph && runtime Task 25 branch results only; source parsing/resolution &&
// branch-expression evaluation remain outside this module.
import type { BindingId } from "@nuinuicad/nui-language";
import type {
  BindingControlOwner,
  BindingReadPosition,
  BindingVersion,
  BindingVersionGraph,
  BindingVersionId,
  ImmutableForGroupPlan
} from "@nuinuicad/nui-language";
import { evaluateTypedExpression, type GeometryBuiltinTargetLookupResult } from "./expressionEvaluator";
import { createScalarProgramCollectionResolver } from "./declarationEvaluator";
import {
  createForGroupExecutionEnvironment,
  type ForGroupExecutionFrame,
  type ForGroupExecutionRunOutcome,
  type ForGroupIterationContext
} from "@nuinuicad/nui-language";
import { scalarValueMatchesType, type ScalarEvaluation, type ScalarExpressionType } from "@nuinuicad/nui-language";
import { isScalarExpressionTypeAssignable } from "@nuinuicad/nui-language";
import type { ScalarProgramCollection } from "@nuinuicad/nui-language";
import type {
  ScalarExpressionResolvedGeometryTarget,
  TypedScalarGeometryPropertyReferenceNode
} from "@nuinuicad/nui-language";

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
    plan: ForGroupExecutionExecutionPlan,
    executeStatement: (statement: ForGroupExecutionStatement, context: ForGroupExecutionExecutionContext) => ForGroupExecutionRunOutcome
  ) => ForGroupExecutionRunOutcome;
};

/** Statements are supplied from the compiler's existing element map only. */
export type ForGroupExecutionStatement = {
  sourceOrder: number;
  kind: "element" | "exit";
  templateElementId?: string;
};
export type ForGroupExecutionExecutionPlan = {
  ownerStatementId: string;
  loopScopeId: string;
  iterationBindingId: BindingId;
  iterationValues: readonly number[];
  iterationValueOverrides?: readonly ScalarEvaluation[];
  iterationRecordFieldOverrides?: readonly ReadonlyMap<BindingId, ScalarEvaluation>[];
  statements: readonly ForGroupExecutionStatement[];
  /** Called after the loop body's immutable carry snapshot has been committed. */
  onIterationComplete?: (
    frame: ForGroupExecutionFrame<ScalarEvaluation>,
    context: Omit<ForGroupExecutionExecutionContext, "statement">
  ) => ForGroupExecutionRunOutcome | void;
};
export type ForGroupExecutionExecutionContext = {
  iterationIndex: number;
  iterationValue: number;
};

const unavailable = (bindingId: BindingId): ScalarEvaluation => ({
  status: "error", type: { kind: "number" }, issueCode: "evaluation-binding-unavailable", bindingId
});

const poisoned = (version: BindingVersion): ScalarEvaluation => ({
  status: "error", type: version.declaredType, issueCode: "poisoned-binding", bindingId: version.bindingId
});

const resultForDeclaredType = (evaluation: ScalarEvaluation, declaredType: ScalarExpressionType): ScalarEvaluation => {
  if (evaluation.status === "error") return { ...evaluation, type: declaredType };
  if (isScalarExpressionTypeAssignable(evaluation.type, declaredType) && scalarValueMatchesType(declaredType, evaluation.value)) {
    return { ...evaluation, type: declaredType };
  }
  return { status: "error", type: declaredType, issueCode: "evaluation-runtime-value-type-mismatch" };
};

const isBeforeOrAt = (version: BindingVersion, position: BindingReadPosition): boolean =>
  position.kind === "beforeStatement" ? version.sourceOrder < position.sourceOrder : version.sourceOrder <= position.sourceOrder;

const statementIdFor = (version: BindingVersion): string => version.id;

/**
 * Task 35 supports forGroup owners, but the caller must separately prove its
 * compiled element-owner metadata is canonical before it sends the graph to
 * Rust. This helper deliberately says nothing about that payload join.
 */
export const isRustLinearMutationEligible = (graph: BindingVersionGraph): boolean =>
  graph.requiresExecutionOrdering === true &&
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
 * One monotonic cursor, active slots only, && explicit branch frames. Frames
 * are retired from Task 30's recorded lexical exits, never inferred by
 * replaying source structure || scanning document text.
 */
export const createIncrementalLinearMutationEvaluator = (
  graph: BindingVersionGraph,
  resolveGeometryProperty?: (reference: TypedScalarGeometryPropertyReferenceNode, sourceOrder: number) => ScalarEvaluation,
  resolveGeometryTarget?: (target: ScalarExpressionResolvedGeometryTarget, sourceOrder: number) => GeometryBuiltinTargetLookupResult | undefined,
  collectionValues?: readonly ScalarProgramCollection[],
  resolveCollectionLength?: (collectionValueId: string, sourceOrder: number) => number | undefined
): IncrementalLinearMutationEvaluator => {
  const currentByBindingId = new Map<BindingId, ScalarEvaluation>();
  const historyByVersionId = new Map<BindingVersionId, BindingVersionRuntimeHistory>();
  const conditionalResultByOwnerId = new Map<string, "then" | "else" | null>();
  // A conditional inside a forGroup is evaluated once per iteration. Keeping
  // those results in a stack prevents an outer iteration from leaking its
  // branch decision into the next iteration || a sibling nested loop.
  const loopConditionalResults: Map<string, "then" | "else" | null>[] = [];
  const frames: ScopeFrame[] = [];
  const ownersById = conditionalOwners(graph);
  const finalBindingIds = new Set(graph.versions.filter((version) =>
    version.kind === "declare" && version.control.ownerChain.length === 0
  ).map((version) => version.bindingId));
  const declarationBindingOrder = graph.versions.filter((version) =>
    version.kind === "declare" && finalBindingIds.has(version.bindingId)
  ).map((version) => version.bindingId);
  const carryBindingOrder = [...(graph.immutableForGroups?.values() ?? [])].flatMap((plan) =>
    plan.carries.map((carry) => carry.bindingId)
  );
  const finalBindingOrder = [...new Set([...declarationBindingOrder, ...carryBindingOrder])];
  let nextVersionIndex = 0;
  let activeLoopEnvironment: ReturnType<typeof createForGroupExecutionEnvironment<ScalarEvaluation>> | undefined;
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

  const collectionResolver = createScalarProgramCollectionResolver(
    { collectionValues },
    resolveCurrent,
    resolveGeometryProperty,
    resolveGeometryTarget,
    resolveCollectionLength
  );

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

  const isWithinEvaluationLimit = (version: BindingVersion) =>
    graph.evaluationLimitSourceOrder === undefined ||
    version.sourceOrder < graph.evaluationLimitSourceOrder ||
    graph.postStopBindingIds?.has(version.bindingId) === true;

  const execute = (version: BindingVersion) => {
    const control = activeControl(version);
    if (control !== "active") {
      historyByVersionId.set(version.id, {
        versionId: version.id, statementId: statementIdFor(version), bindingId: version.bindingId,
        status: control === "inactive" ? "inactive-control" : "skipped-control"
      });
      return;
    }
    const evaluation = version.initialState.kind === "poisoned" || !version.initializer
      ? poisoned(version)
      : resultForDeclaredType(evaluateTypedExpression(version.initializer, {
        lookupBinding: resolveCurrent,
        ...(collectionResolver ? collectionResolver.environmentFor(version.sourceOrder) : {}),
        ...(resolveCollectionLength ? {
          lookupCollectionLength: (collectionValueId: string) =>
            resolveCollectionLength(collectionValueId, version.sourceOrder) ??
            collectionResolver?.environmentFor(version.sourceOrder).lookupCollectionLength?.(collectionValueId)
        } : {}),
        ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, version.sourceOrder) } : {}),
        ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, version.sourceOrder) } : {})
      }), version.declaredType);
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
    const immutableCarryBindingIds = new Set(
      [...(graph.immutableForGroups?.values() ?? [])].flatMap((plan) => [
        ...plan.carries.flatMap((carry) => [carry.bindingId, ...(carry.nextBindingId ? [carry.nextBindingId] : [])]),
        ...(plan.geometryCarries?.map((carry) => carry.bindingId) ?? [])
      ])
    );
    if (immutableCarryBindingIds.has(version.bindingId)) return false;
    const owners = version.control.ownerChain;
    const index = owners.findIndex((owner) => owner.kind === "forGroup" && owner.ownerStatementId === ownerStatementId);
    return index >= 0 && !owners.slice(index + 1).some((owner) => owner.kind === "forGroup");
  });

  const executeLoopVersion = (version: BindingVersion, frame: ForGroupExecutionFrame<ScalarEvaluation>) => {
    const control = activeControl(version, true);
    if (control !== "active") {
      historyByVersionId.set(version.id, {
        versionId: version.id, statementId: statementIdFor(version), bindingId: version.bindingId,
        status: control === "inactive" ? "inactive-control" : "skipped-control"
      });
      return;
    }
    const evaluation = version.initialState.kind === "poisoned" || !version.initializer
      ? poisoned(version)
      : resultForDeclaredType(evaluateTypedExpression(version.initializer, {
        lookupBinding: resolveCurrent,
        ...(collectionResolver ? collectionResolver.environmentFor(version.sourceOrder) : {}),
        ...(resolveCollectionLength ? {
          lookupCollectionLength: (collectionValueId: string) =>
            resolveCollectionLength(collectionValueId, version.sourceOrder) ??
            collectionResolver?.environmentFor(version.sourceOrder).lookupCollectionLength?.(collectionValueId)
        } : {}),
        ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, version.sourceOrder) } : {}),
        ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, version.sourceOrder) } : {})
      }), version.declaredType);
    const isLoopLocal = version.control.ownerChain.length > 0;
    if (isLoopLocal) frame.declareLocal(version.bindingId, evaluation);
    else frame.commit(version.bindingId, evaluation);
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
      if (isWithinEvaluationLimit(version)) execute(version);
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
    // A conditional without an explicit else branch has no frame to open for
    // the else result. The branch is still recorded so its guarded versions
    // remain inactive; only the then frame needs lexical lifetime metadata.
    if (!owner) return;
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
    const environment = outerEnvironment ?? createForGroupExecutionEnvironment(currentByBindingId);
    const immutableCarryPlan: ImmutableForGroupPlan | undefined = graph.immutableForGroups?.get(plan.ownerStatementId);
    if (immutableCarryPlan) {
      // Carry declarations are lexical immutable bindings, not per-iteration
      // declarations. Materialize each initializer once into the loop's
      // surrounding slot map before the first iteration (also covering the
      // zero-iteration case).
      for (const carry of immutableCarryPlan.carries) {
        const lookupBinding = (bindingId: BindingId): ScalarEvaluation => {
          const local = environment.read(bindingId);
          if (typeof local === "number") {
            return { status: "ok", type: { kind: "number" }, value: { kind: "number", value: local } };
          }
          return local ?? resolveCurrent(bindingId);
        };
        const evaluation = evaluateTypedExpression(carry.initializer, {
          ...(collectionResolver ? collectionResolver.environmentFor(carry.nextSourceOrder) : {}),
          ...(resolveCollectionLength ? {
            lookupCollectionLength: (collectionValueId: string) =>
              resolveCollectionLength(collectionValueId, carry.nextSourceOrder) ??
              collectionResolver?.environmentFor(carry.nextSourceOrder).lookupCollectionLength?.(collectionValueId)
          } : {}),
          ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, carry.nextSourceOrder) } : {}),
          ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, carry.nextSourceOrder) } : {}),
          lookupBinding
        });
        environment.seed(carry.bindingId, resultForDeclaredType(evaluation, carry.declaredType));
      }
    }
    let versionIndex = 0;
    let activeIterationIndex = -1;
    const iterationConditionalResults = new Map<string, "then" | "else" | null>();
    const runVersionsBefore = (sourceOrder: number, frame: ForGroupExecutionFrame<ScalarEvaluation>) => {
      while (versionIndex < loopVersions.length && loopVersions[versionIndex].sourceOrder < sourceOrder) {
        const version = loopVersions[versionIndex];
        versionIndex += 1;
        if (isWithinEvaluationLimit(version)) {
          executeLoopVersion(version, frame);
        }
      }
    };
    // The regular cursor must never traverse this static body range. This is
    // deliberately index-only: execution && history stay owned by the loop
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
      const outcome = environment.run<ForGroupExecutionStatement>({
        loopScopeId: plan.loopScopeId,
        iterationBindingId: plan.iterationBindingId,
        iterationValues: plan.iterationValues,
        ...(plan.iterationValueOverrides ? { iterationValueOverrides: plan.iterationValueOverrides } : {}),
        ...(plan.iterationRecordFieldOverrides ? { iterationRecordFieldOverrides: plan.iterationRecordFieldOverrides } : {}),
        generatedStatements: plan.statements,
        ...(immutableCarryPlan || plan.onIterationComplete ? {
          onIterationComplete: (frame, context) => {
            if (immutableCarryPlan) {
            const snapshot = new Map<BindingId, ScalarEvaluation>();
            for (const carry of immutableCarryPlan.carries) {
              const value = frame.read(carry.bindingId);
              snapshot.set(carry.bindingId, typeof value === "number"
                ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value } }
                : value ?? unavailable(carry.bindingId));
            }
            const nextValues = new Map<BindingId, ScalarEvaluation>();
            for (const carry of immutableCarryPlan.carries) {
              const evaluation = evaluateTypedExpression(carry.nextExpression, {
                ...(collectionResolver ? collectionResolver.environmentFor(carry.nextSourceOrder) : {}),
                ...(resolveCollectionLength ? {
                  lookupCollectionLength: (collectionValueId: string) =>
                    resolveCollectionLength(collectionValueId, carry.nextSourceOrder) ??
                    collectionResolver?.environmentFor(carry.nextSourceOrder).lookupCollectionLength?.(collectionValueId)
                } : {}),
                ...(resolveGeometryProperty ? { lookupGeometryProperty: (reference) => resolveGeometryProperty(reference, carry.nextSourceOrder) } : {}),
                ...(resolveGeometryTarget ? { lookupGeometryTarget: (target) => resolveGeometryTarget(target, carry.nextSourceOrder) } : {}),
                lookupBinding: (bindingId) => {
                  return snapshot.get(bindingId) ?? (() => {
                  const value = environment.read(bindingId) ?? frame.read(bindingId);
                  return typeof value === "number"
                    ? { status: "ok", type: { kind: "number" }, value: { kind: "number", value } }
                    : value ?? unavailable(bindingId);
                  })();
                }
              });
              nextValues.set(carry.bindingId, resultForDeclaredType(evaluation, carry.declaredType));
            }
            for (const [bindingId, value] of nextValues) frame.commit(bindingId, value);
            }
            return plan.onIterationComplete?.(frame, context) ?? "completed";
          }
        } : {})
      }, (_frame: ForGroupExecutionFrame<ScalarEvaluation>, context: ForGroupIterationContext<ForGroupExecutionStatement>) => {
        // Each iteration replays only its own source-ordered loop body. No
        // generated payload carries an environment; the core frame is shared.
        if (activeIterationIndex !== context.iterationIndex) {
          activeIterationIndex = context.iterationIndex;
          versionIndex = 0;
          iterationConditionalResults.clear();
        }
        runVersionsBefore(context.statement.sourceOrder, _frame);
        return executeStatement(context.statement, context);
      });
      if (!outerEnvironment) {
        for (const [bindingId, value] of environment.finalValues()) currentByBindingId.set(bindingId, value);
      }
      return outcome;
    } finally {
      loopConditionalResults.pop();
      activeLoopEnvironment = outerEnvironment;
    }
  };

  return { advanceTo, registerConditionalResult, resolveCurrent, finalize, runForGroup };
};
