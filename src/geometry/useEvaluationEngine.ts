import { useEffect, useMemo, useState } from "react";
import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import type { RustEvaluationTransport } from "./rustEvaluationRunner";
import {
  emptyEvaluationResult,
  type EvaluationEngineMode,
  evaluateElementsReference,
  evaluateElementsWithRust,
  evaluationResultsMatch,
  getEvaluationEngineMode,
  isParityEvaluationEngineMode
} from "./evaluationEngine";
import { ScalarOutputDecodeError } from "./evaluationPayload";

export type EvaluationSource = "reference" | "rust" | "fallback";
export type EvaluationStatus = "idle" | "evaluating" | "ready" | "failed";

export type EvaluationEngineState = {
  evaluation: EvaluationResult;
  /** Revision of the compiled document used to start this evaluation request. */
  evaluationRevision: number;
  /** Monotonic request identity; distinguishes retries/results for the same document. */
  evaluationRequestRevision: number;
  mode: EvaluationEngineMode;
  source: EvaluationSource;
  status: EvaluationStatus;
  rustEligible: boolean;
  isStale: boolean;
  error: unknown | null;
};

/**
 * Whether the rendered evaluation corresponds to the given compiled document
 * revision, i.e. hit testing that render is safe.  A first Rust evaluation
 * renders an empty placeholder under the current revision while the request is
 * in flight, so "evaluating" only counts as current when a fresh reference
 * evaluation is on screen (parity shadow mode).
 */
export const evaluationStateIsCurrentFor = (
  state: EvaluationEngineState | undefined,
  compiledDocumentRevision: number
): boolean => {
  if (!state) return true;
  if (state.isStale || state.evaluationRevision !== compiledDocumentRevision) return false;
  return state.status !== "evaluating" || state.source === "reference";
};

type AsyncEvaluationState = {
  requestKey: string;
  evaluationRevision: number;
  evaluationRequestRevision: number;
  evaluation: EvaluationResult;
  source: Exclude<EvaluationSource, "reference">;
  status: Extract<EvaluationStatus, "ready" | "failed">;
  error: unknown | null;
  /** Created only after Rust has validated a scalar program in shadow/parity mode. */
  shadowReferenceEvaluation?: EvaluationResult;
};

let nextEvaluationRequestRevision = 1;
const evaluationRequestRevisionByKey = new Map<string, number>();
const MAX_REQUEST_IDENTITIES = 256;

const mustFailClosedAfterRustError = (scalarProgram: EvaluateElementsOptions["scalarProgram"], error: unknown): boolean =>
  scalarProgram !== undefined || error instanceof ScalarOutputDecodeError;

const requestRevisionFor = (key: string) => {
  const existing = evaluationRequestRevisionByKey.get(key);
  if (existing !== undefined) return existing;
  const revision = nextEvaluationRequestRevision;
  nextEvaluationRequestRevision += 1;
  evaluationRequestRevisionByKey.set(key, revision);
  if (evaluationRequestRevisionByKey.size > MAX_REQUEST_IDENTITIES) {
    const oldest = evaluationRequestRevisionByKey.keys().next().value;
    if (oldest !== undefined) evaluationRequestRevisionByKey.delete(oldest);
  }
  return revision;
};

export const useEvaluationEngine = (
  elements: CadElement[],
  options: EvaluateElementsOptions,
  evaluationRevision = 0,
  rustTransport?: RustEvaluationTransport
): EvaluationEngineState => {
  const evaluationLimitIndex = options.evaluationLimitIndex;
  const allowDisabledElementIds = options.allowDisabledElementIds;
  const drawingModifiers = options.drawingModifiers;
  const selectedDrawingProfileId = options.selectedDrawingProfileId;
  const scalarProgram = options.scalarProgram;
  const bindingVersions = options.bindingVersions;
  const statementInfoByElementId = options.statementInfoByElementId;
  const sourceExecutionPositionByElementId = options.sourceExecutionPositionByElementId;
  const scalarExecutionPositionByElementId = options.scalarExecutionPositionByElementId;
  const statementIdByStatementIndex = options.statementIdByStatementIndex;
  const conditionalOwnerStatementIdByElementId = options.conditionalOwnerStatementIdByElementId;
  const forGroupMutationOwnerByElementId = options.forGroupMutationOwnerByElementId;
  const moduleConditionalOwnerStatementIdByElementId = options.moduleConditionalOwnerStatementIdByElementId;
  const moduleForGroupMutationOwnerByElementId = options.moduleForGroupMutationOwnerByElementId;
  const moduleMaterialization = options.moduleMaterialization;
  const propertyBindingEntries = options.propertyBindingEntries;
  const numericBindingEntries = options.numericBindingEntries;
  const controlBooleanEntries = options.controlBooleanEntries;
  const conditionalGroupConditionsByElementId = options.conditionalGroupConditionsByElementId;
  const textTemplateEntriesByElementId = options.textTemplateEntriesByElementId;
  const textPropertyBindingEntries = options.textPropertyBindingEntries;
  const evaluationOptions = useMemo(
    () => ({
      evaluationLimitIndex,
      ...(allowDisabledElementIds?.size ? { allowDisabledElementIds } : {}),
      ...(drawingModifiers?.length ? { drawingModifiers } : {}),
      ...(selectedDrawingProfileId ? { selectedDrawingProfileId } : {}),
      ...(scalarProgram ? { scalarProgram } : {}),
      ...(bindingVersions ? {
        bindingVersions, statementInfoByElementId, sourceExecutionPositionByElementId, scalarExecutionPositionByElementId, statementIdByStatementIndex,
        conditionalOwnerStatementIdByElementId, forGroupMutationOwnerByElementId,
        moduleConditionalOwnerStatementIdByElementId, moduleForGroupMutationOwnerByElementId
      } : {}),
      ...(moduleMaterialization ? { moduleMaterialization } : {}),
      ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
      ...(numericBindingEntries?.length ? { numericBindingEntries } : {}),
      ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
      ...(conditionalGroupConditionsByElementId?.size ? { conditionalGroupConditionsByElementId } : {}),
      ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
      ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
    }),
    [
      evaluationLimitIndex,
      allowDisabledElementIds,
      drawingModifiers,
      selectedDrawingProfileId,
      scalarProgram,
      bindingVersions,
      statementInfoByElementId,
      sourceExecutionPositionByElementId,
      scalarExecutionPositionByElementId,
      statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId,
      forGroupMutationOwnerByElementId,
      moduleConditionalOwnerStatementIdByElementId,
      moduleForGroupMutationOwnerByElementId,
      moduleMaterialization,
      propertyBindingEntries,
      numericBindingEntries,
      controlBooleanEntries,
      conditionalGroupConditionsByElementId,
      textTemplateEntriesByElementId,
      textPropertyBindingEntries
    ]
  );
  const rustTransportAvailable = rustTransport !== undefined;
  const engineMode = getEvaluationEngineMode(rustTransportAvailable);
  const rustEligible = canUseRustEvaluationForElements(elements, evaluationOptions);
  const parityMode = isParityEvaluationEngineMode(engineMode);
  const deferScalarReferenceEvaluation = parityMode && scalarProgram !== undefined && rustTransportAvailable && rustEligible;
  const requestKey = useMemo(
    () => JSON.stringify({
      elements,
      evaluationLimitIndex,
      allowDisabledElementIds: allowDisabledElementIds ? Array.from(allowDisabledElementIds) : undefined,
      drawingModifiers,
      selectedDrawingProfileId,
      scalarProgram,
      bindingVersions,
      statementIdByStatementIndex: statementIdByStatementIndex ? Array.from(statementIdByStatementIndex) : undefined,
      conditionalOwnerStatementIdByElementId: conditionalOwnerStatementIdByElementId
        ? Array.from(conditionalOwnerStatementIdByElementId) : undefined,
      forGroupMutationOwnerByElementId: forGroupMutationOwnerByElementId
        ? Array.from(forGroupMutationOwnerByElementId) : undefined,
      moduleConditionalOwnerStatementIdByElementId: moduleConditionalOwnerStatementIdByElementId
        ? Array.from(moduleConditionalOwnerStatementIdByElementId) : undefined,
      moduleForGroupMutationOwnerByElementId: moduleForGroupMutationOwnerByElementId
        ? Array.from(moduleForGroupMutationOwnerByElementId) : undefined,
      propertyBindingEntries,
      numericBindingEntries,
      controlBooleanEntries,
      conditionalGroupConditionsByElementId: conditionalGroupConditionsByElementId
        ? Array.from(conditionalGroupConditionsByElementId)
        : undefined,
      textTemplateEntriesByElementId: textTemplateEntriesByElementId
        ? Array.from(textTemplateEntriesByElementId)
        : undefined,
      textPropertyBindingEntries
    }),
    [
      elements,
      evaluationLimitIndex,
      allowDisabledElementIds,
      drawingModifiers,
      selectedDrawingProfileId,
      scalarProgram,
      bindingVersions,
      statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId,
      forGroupMutationOwnerByElementId,
      moduleConditionalOwnerStatementIdByElementId,
      moduleForGroupMutationOwnerByElementId,
      propertyBindingEntries,
      numericBindingEntries,
      controlBooleanEntries,
      conditionalGroupConditionsByElementId,
      textTemplateEntriesByElementId,
      textPropertyBindingEntries
    ]
  );
  const evaluationRequestRevision = useMemo(
    () => requestRevisionFor(`${evaluationRevision}:${requestKey}`),
    [evaluationRevision, requestKey]
  );
  const needsReferenceEvaluation =
    (!rustTransportAvailable || engineMode !== "rust" || !rustEligible) && !deferScalarReferenceEvaluation;
  const referenceEvaluation = useMemo(
    () => (needsReferenceEvaluation ? evaluateElementsReference(elements, evaluationOptions) : null),
    [elements, evaluationOptions, needsReferenceEvaluation]
  );
  const [asyncEvaluation, setAsyncEvaluation] = useState<AsyncEvaluationState | null>(null);
  const emptyEvaluation = useMemo(() => emptyEvaluationResult(elements, evaluationOptions), [elements, evaluationOptions]);

  useEffect(() => {
    if (!rustTransport || engineMode === "reference" || !rustEligible) {
      return;
    }

    let cancelled = false;
    evaluateElementsWithRust(elements, evaluationOptions, rustTransport)
      .then((nextEvaluation) => {
        if (cancelled) return;
        const shadowReferenceEvaluation = deferScalarReferenceEvaluation
          ? evaluateElementsReference(elements, evaluationOptions)
          : undefined;
        const comparisonReferenceEvaluation = shadowReferenceEvaluation ?? referenceEvaluation;
        setAsyncEvaluation({
          requestKey,
          evaluationRevision,
          evaluationRequestRevision,
          evaluation: nextEvaluation,
          source: "rust",
          status: "ready",
          error: null,
          shadowReferenceEvaluation
        });
        if (
          parityMode &&
          comparisonReferenceEvaluation &&
          !evaluationResultsMatch(comparisonReferenceEvaluation, nextEvaluation)
        ) {
          console.warn("Rust evaluation differs from the TypeScript reference evaluation.", {
            referenceEvaluation: comparisonReferenceEvaluation,
            rustEvaluation: nextEvaluation
          });
        }
      })
      .catch((error: unknown) => {
        const failClosed = mustFailClosedAfterRustError(scalarProgram, error);
        if (!cancelled) {
          if (failClosed) {
            console.error("Rust scalar evaluation failed; preserving the command failure.", error);
            setAsyncEvaluation({
              requestKey,
              evaluationRevision,
              evaluationRequestRevision,
              evaluation: emptyEvaluation,
              source: "rust",
              status: "failed",
              error
            });
            return;
          }
          console.error("Rust evaluation failed; using the TypeScript reference evaluation.", error);
          setAsyncEvaluation(
            engineMode === "rust"
              ? {
                  requestKey,
                  evaluationRevision,
                  evaluationRequestRevision,
                  evaluation: evaluateElementsReference(elements, evaluationOptions),
                  source: "fallback",
                  status: "failed",
                  error
                }
              : {
                  requestKey,
                  evaluationRevision,
                  evaluationRequestRevision,
                  evaluation: referenceEvaluation ?? evaluateElementsReference(elements, evaluationOptions),
                  source: "fallback",
                  status: "failed",
                  error
                }
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    elements,
    emptyEvaluation,
    engineMode,
    evaluationOptions,
    evaluationRevision,
    evaluationRequestRevision,
    parityMode,
    deferScalarReferenceEvaluation,
    referenceEvaluation,
    requestKey,
    rustEligible,
    rustTransport,
    scalarProgram
  ]);

  if (engineMode === "reference" || !rustEligible || !rustTransportAvailable) {
    return {
      evaluation: referenceEvaluation ?? emptyEvaluation,
      evaluationRevision,
      evaluationRequestRevision,
      mode: engineMode,
      source: "reference",
      status: "idle",
      rustEligible,
      isStale: false,
      error: null
    };
  }

  if (parityMode) {
    const isCurrentAsyncEvaluation = asyncEvaluation?.requestKey === requestKey;
    if (deferScalarReferenceEvaluation) {
      if (isCurrentAsyncEvaluation && asyncEvaluation.status === "failed") {
        return {
          evaluation: emptyEvaluation,
          evaluationRevision: asyncEvaluation.evaluationRevision,
          evaluationRequestRevision: asyncEvaluation.evaluationRequestRevision,
          mode: engineMode,
          source: "rust",
          status: "failed",
          rustEligible,
          isStale: false,
          error: asyncEvaluation.error
        };
      }
      if (isCurrentAsyncEvaluation && asyncEvaluation.shadowReferenceEvaluation) {
        return {
          evaluation: asyncEvaluation.shadowReferenceEvaluation,
          evaluationRevision: asyncEvaluation.evaluationRevision,
          evaluationRequestRevision: asyncEvaluation.evaluationRequestRevision,
          mode: engineMode,
          source: "reference",
          status: "ready",
          rustEligible,
          isStale: false,
          error: null
        };
      }
      return {
        evaluation: emptyEvaluation,
        evaluationRevision,
        evaluationRequestRevision,
        mode: engineMode,
        source: "rust",
        status: "evaluating",
        rustEligible,
        isStale: false,
        error: null
      };
    }
    return {
      evaluation: referenceEvaluation ?? emptyEvaluation,
      evaluationRevision,
      evaluationRequestRevision,
      mode: engineMode,
      source: "reference",
      status: isCurrentAsyncEvaluation ? asyncEvaluation.status : "evaluating",
      rustEligible,
      isStale: false,
      error: isCurrentAsyncEvaluation ? asyncEvaluation.error : null
    };
  }

  if (asyncEvaluation) {
    const isCurrentAsyncEvaluation = asyncEvaluation.requestKey === requestKey;
    return {
      evaluation: asyncEvaluation.evaluation,
      evaluationRevision: asyncEvaluation.evaluationRevision,
      evaluationRequestRevision: asyncEvaluation.evaluationRequestRevision,
      mode: engineMode,
      source: asyncEvaluation.source,
      status: isCurrentAsyncEvaluation ? asyncEvaluation.status : "evaluating",
      rustEligible,
      isStale: !isCurrentAsyncEvaluation,
      error: isCurrentAsyncEvaluation ? asyncEvaluation.error : null
    };
  }

  return {
    evaluation: emptyEvaluation,
    evaluationRevision,
    evaluationRequestRevision,
    mode: engineMode,
    source: "rust",
    status: "evaluating",
    rustEligible,
    isStale: false,
    error: null
  };
};
