import { existsSync } from "node:fs";
import type { EvaluationPayload } from "../../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import {
  evaluatePreparedRust,
  prepareRustEvaluation,
  type RustEvaluationTransport
} from "../../src/geometry/rustEvaluationRunner";
import { isLastGoodDslDocument } from "../../src/document/canonicalDocument";
import {
  resolveRustEvaluationBinaryPath,
  RustEvaluationProcess,
  RustEvaluationProcessOwner,
  type RustEvaluationProcessDependencies
} from "../../src/node/rustEvaluationProcess";
import type { ComputedGeometry, DependencyError, ElementId, EvaluationWarning } from "../../src/types/geometry";
import {
  loadFreshNuiDocumentSnapshot,
  type FreshNuiDocumentSnapshot
} from "./documentSnapshot";

export type DocumentEvaluationOptions = {
  requestedElementIds?: readonly string[];
  includeEvaluatedElementIds?: boolean;
};

export type DocumentEvaluationStatus =
  | "evaluated"
  | "source-unavailable"
  | "ineligible"
  | "process-unavailable"
  | "failed"
  | "stale";

export type DocumentEvaluationDto = {
  path: string;
  sourceIdentity: FreshNuiDocumentSnapshot["sourceIdentity"];
  compileStatus: FreshNuiDocumentSnapshot["compileStatus"];
  status: DocumentEvaluationStatus;
  rustEligible: boolean | null;
  message?: string;
  evaluation?: {
    errors: DependencyError[];
    warnings: EvaluationWarning[];
    computedGeometry?: ComputedGeometry[];
    evaluatedElementIds?: ElementId[];
  };
};

type DocumentEvaluationDependencies = {
  transport: RustEvaluationTransport;
  transportAvailable?: () => boolean;
  loadSnapshot?: typeof loadFreshNuiDocumentSnapshot;
  prepareEvaluation?: typeof prepareRustEvaluation;
  evaluatePrepared?: typeof evaluatePreparedRust;
};

const sameSourceIdentity = (
  left: FreshNuiDocumentSnapshot["sourceIdentity"],
  right: FreshNuiDocumentSnapshot["sourceIdentity"]
): boolean => left.algorithm === right.algorithm &&
  left.hash === right.hash &&
  left.byteLength === right.byteLength &&
  left.normalizedLength === right.normalizedLength;

const baseResult = (
  snapshot: FreshNuiDocumentSnapshot,
  status: DocumentEvaluationStatus,
  rustEligible: boolean | null,
  message?: string
): DocumentEvaluationDto => ({
  path: snapshot.path,
  sourceIdentity: snapshot.sourceIdentity,
  compileStatus: snapshot.compileStatus,
  status,
  rustEligible,
  ...(message ? { message } : {})
});

export const evaluateNuiDocument = async (
  requestedPath: string,
  options: DocumentEvaluationOptions,
  dependencies: DocumentEvaluationDependencies
): Promise<DocumentEvaluationDto> => {
  const loadSnapshot = dependencies.loadSnapshot ?? loadFreshNuiDocumentSnapshot;
  const prepareEvaluation = dependencies.prepareEvaluation ?? prepareRustEvaluation;
  const runPrepared = dependencies.evaluatePrepared ?? evaluatePreparedRust;
  const snapshot = await loadSnapshot(requestedPath, "document_evaluate");
  const compiled = snapshot.currentCompiled;

  if (!snapshot.currentSemanticsAvailable || !isLastGoodDslDocument(compiled)) {
    return baseResult(
      snapshot,
      "source-unavailable",
      null,
      "Current source does not have an exact-current compiled document."
    );
  }

  const evaluationOptions = buildEvaluationOptions({
    compiledDocument: compiled,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  });
  const prepared = prepareEvaluation(compiled.document.elements, evaluationOptions);
  if (!prepared.rustEligible) {
    return baseResult(snapshot, "ineligible", false, "Current document is not eligible for production Rust evaluation.");
  }
  if (dependencies.transportAvailable && !dependencies.transportAvailable()) {
    return baseResult(snapshot, "process-unavailable", true, "evaluation_stdio is not available.");
  }

  let evaluation;
  try {
    evaluation = await runPrepared(prepared, dependencies.transport);
  } catch (error) {
    return baseResult(
      snapshot,
      "failed",
      true,
      error instanceof Error ? error.message : String(error)
    );
  }

  let currentSnapshot: FreshNuiDocumentSnapshot;
  try {
    currentSnapshot = await loadSnapshot(snapshot.path, "document_evaluate");
  } catch {
    return baseResult(snapshot, "stale", true, "Source identity could not be revalidated after Rust evaluation.");
  }
  if (currentSnapshot.path !== snapshot.path || !sameSourceIdentity(currentSnapshot.sourceIdentity, snapshot.sourceIdentity)) {
    return baseResult(snapshot, "stale", true, "Source changed while Rust evaluation was running.");
  }

  const requestedGeometry = options.requestedElementIds
    ? options.requestedElementIds.flatMap((id) => {
        const geometry = evaluation.computedGeometry.get(id as ElementId);
        return geometry ? [geometry] : [];
      })
    : undefined;

  return {
    ...baseResult(snapshot, "evaluated", true),
    evaluation: {
      errors: evaluation.errors,
      warnings: evaluation.warnings,
      ...(requestedGeometry ? { computedGeometry: requestedGeometry } : {}),
      ...(options.includeEvaluatedElementIds
        ? { evaluatedElementIds: Array.from(evaluation.evaluatedElementIds ?? []) }
        : {})
    }
  };
};

export type DocumentEvaluationRuntime = {
  evaluate: (requestedPath: string, options: DocumentEvaluationOptions) => Promise<DocumentEvaluationDto>;
  dispose: () => void;
};

export type DocumentEvaluationRuntimeDependencies = {
  binaryPath?: string;
  fileExists?: (path: string) => boolean;
  processDependencies?: Omit<RustEvaluationProcessDependencies, "onTerminated">;
};

export const createDocumentEvaluationRuntime = (
  repositoryRoot: string,
  dependencies: DocumentEvaluationRuntimeDependencies = {}
): DocumentEvaluationRuntime => {
  const binaryPath = dependencies.binaryPath ?? resolveRustEvaluationBinaryPath(repositoryRoot);
  const fileExists = dependencies.fileExists ?? existsSync;
  const owner = new RustEvaluationProcessOwner((onTerminated) => new RustEvaluationProcess(binaryPath, {
    ...dependencies.processDependencies,
    onTerminated
  }));
  const transport: RustEvaluationTransport = async (input) =>
    await owner.get().request(input) as EvaluationPayload;

  return {
    evaluate: (requestedPath, options) => evaluateNuiDocument(requestedPath, options, {
      transport,
      transportAvailable: () => fileExists(binaryPath)
    }),
    dispose: () => owner.dispose()
  };
};
