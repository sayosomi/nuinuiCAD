// Task 31's incremental TS reference evaluator. It consumes Task 30's graph
// directly: no source parsing, name resolution, or version reconstruction.
import type { BindingId } from "./bindingCatalog";
import {
  type BindingReadPosition,
  type BindingVersion,
  type BindingVersionGraph,
  type BindingVersionId
} from "./bindingVersions";
import { evaluateTypedExpression } from "./expressionEvaluator";
import type { ScalarEvaluation } from "./types";

export type BindingVersionRuntimeHistory = {
  versionId: BindingVersionId;
  statementId: string;
  bindingId: BindingId;
  status: "executed" | "poisoned" | "skipped-control";
  evaluation?: ScalarEvaluation;
};

export type LinearMutationEvaluation = {
  resultsByBindingId: ReadonlyMap<BindingId, ScalarEvaluation>;
  historyByVersionId: ReadonlyMap<BindingVersionId, BindingVersionRuntimeHistory>;
};

export type IncrementalLinearMutationEvaluator = {
  advanceTo: (position: BindingReadPosition) => void;
  resolveCurrent: (bindingId: BindingId) => ScalarEvaluation;
  finalize: (position: BindingReadPosition) => LinearMutationEvaluation;
};

export type ResolveExternalScalarBinding = (bindingId: BindingId) => ScalarEvaluation;

const unavailable = (bindingId: BindingId): ScalarEvaluation => ({
  status: "error",
  type: { kind: "number" },
  issueCode: "evaluation-binding-version-unavailable",
  bindingId
});

const poisoned = (version: BindingVersion): ScalarEvaluation => ({
  status: "error",
  type: version.declaredType,
  issueCode: "poisoned-binding",
  bindingId: version.bindingId
});

const isBeforeOrAt = (version: BindingVersion, position: BindingReadPosition): boolean =>
  position.kind === "beforeStatement"
    ? version.sourceOrder < position.sourceOrder
    : version.sourceOrder <= position.sourceOrder;

const statementIdFor = (version: BindingVersion): string =>
  version.kind === "set" ? version.setStatementId : version.id;

export const hasLinearSetVersions = (graph: BindingVersionGraph): boolean =>
  graph.versions.some((version) => version.kind === "set" && version.control.kind === "linear");

/**
 * Rust Task 32 may run only a wholly linear mutation graph. A version owned
 * by a conditional branch or forGroup must remain on the TS reference path
 * until those control semantics have their own Rust implementation.
 */
export const hasSetVersions = (graph: BindingVersionGraph): boolean =>
  graph.versions.some((version) => version.kind === "set");

export const hasOnlyLinearBindingVersions = (graph: BindingVersionGraph): boolean =>
  graph.versions.every((version) => version.control.kind === "linear");

export const isRustLinearMutationEligible = (graph: BindingVersionGraph): boolean =>
  hasSetVersions(graph) && hasOnlyLinearBindingVersions(graph);

/**
 * Advances a single set of current binding slots monotonically. Every version
 * is touched at most once; slots are updated in place rather than cloning an
 * environment for each set.
 */
export const createIncrementalLinearMutationEvaluator = (
  graph: BindingVersionGraph,
  resolveExternalBinding: ResolveExternalScalarBinding
): IncrementalLinearMutationEvaluator => {
  const currentByBindingId = new Map<BindingId, ScalarEvaluation>();
  const historyByVersionId = new Map<BindingVersionId, BindingVersionRuntimeHistory>();
  let nextVersionIndex = 0;

  const resolveCurrent = (bindingId: BindingId): ScalarEvaluation => {
    const current = currentByBindingId.get(bindingId);
    if (current) return current;
    return graph.versionIdsByBindingId.has(bindingId)
      ? unavailable(bindingId)
      : resolveExternalBinding(bindingId);
  };

  const execute = (version: BindingVersion) => {
    if (version.control.kind !== "linear") {
      historyByVersionId.set(version.id, {
        versionId: version.id,
        statementId: statementIdFor(version),
        bindingId: version.bindingId,
        status: "skipped-control"
      });
      return;
    }
    const evaluation = version.initialState.kind === "poisoned" ||
      (version.kind === "declare" && !version.initializer)
      ? poisoned(version)
      : evaluateTypedExpression(
          version.kind === "declare" ? version.initializer! : version.expression,
          { lookupBinding: resolveCurrent }
        );
    currentByBindingId.set(version.bindingId, evaluation);
    historyByVersionId.set(version.id, {
      versionId: version.id,
      statementId: statementIdFor(version),
      bindingId: version.bindingId,
      status: evaluation.status === "error" ? "poisoned" : "executed",
      evaluation
    });
  };

  const advanceTo = (position: BindingReadPosition): void => {
    while (nextVersionIndex < graph.versions.length) {
      const version = graph.versions[nextVersionIndex];
      if (!isBeforeOrAt(version, position)) return;
      nextVersionIndex += 1;
      if (graph.evaluationLimitSourceOrder !== undefined && version.sourceOrder >= graph.evaluationLimitSourceOrder) {
        continue;
      }
      execute(version);
    }
  };

  const finalize = (position: BindingReadPosition): LinearMutationEvaluation => {
    advanceTo(position);
    return { resultsByBindingId: new Map(currentByBindingId), historyByVersionId: new Map(historyByVersionId) };
  };

  return { advanceTo, resolveCurrent, finalize };
};
