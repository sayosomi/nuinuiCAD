import { useEffect, useMemo, useState } from "react";
import type { CadElement, EvaluationResult } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import type { RustEvaluationTransport } from "./rustEvaluationRunner";
import {
  emptyEvaluationResult,
  type EvaluationEngineMode,
  evaluateElementsReference
} from "./evaluationEngine";
import { evaluateRoutedRust, evaluationEngineRoutingFor } from "./evaluationEngineRouting";

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
 * renders an empty placeholder while pending or after a fatal Rust failure.
 * Neither is usable content. Reference/parity results and evaluated fallback
 * geometry remain current even while Rust is pending or has failed.
 */
export const evaluationStateIsCurrentFor = (
  state: EvaluationEngineState | undefined,
  compiledDocumentRevision: number
): boolean => {
  if (!state) return true;
  if (state.isStale || state.evaluationRevision !== compiledDocumentRevision) return false;
  if (state.status === "failed" && state.source === "rust") return false;
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

const allocateRequestRevision = () => {
  const revision = nextEvaluationRequestRevision;
  nextEvaluationRequestRevision += 1;
  return revision;
};

export const useEvaluationEngine = (
  elements: CadElement[],
  options: EvaluateElementsOptions,
  evaluationRevision = 0,
  rustTransport?: RustEvaluationTransport
): EvaluationEngineState => {
  const evaluationLimitIndex = options.evaluationLimitIndex;
  const typedDependencyGraph = options.typedDependencyGraph;
  const evaluationOrder = options.evaluationOrder;
  const transformationRecipes = options.transformationRecipes;
  const transformationDependencyPlans = options.transformationDependencyPlans;
  const transformationNumericBindingEntries = options.transformationNumericBindingEntries;
  const allowDisabledElementIds = options.allowDisabledElementIds;
  const drawingModifiers = options.drawingModifiers;
  const scalarProgram = options.scalarProgram;
  const bindingVersions = options.bindingVersions;
  const statementInfoByElementId = options.statementInfoByElementId;
  const sourceExecutionPositionByElementId = options.sourceExecutionPositionByElementId;
  const scalarExecutionPositionByElementId = options.scalarExecutionPositionByElementId;
  const statementIdByStatementIndex = options.statementIdByStatementIndex;
  const conditionalOwnerStatementIdByElementId = options.conditionalOwnerStatementIdByElementId;
  const forGroupMutationOwnerByElementId = options.forGroupMutationOwnerByElementId;
  const moduleConditionalOwnerStatementIdByElementId = options.moduleConditionalOwnerStatementIdByElementId;
  const moduleForGroupExecutionOwnerByElementId = options.moduleForGroupExecutionOwnerByElementId;
  const moduleMaterialization = options.moduleMaterialization;
  const geometryValueProgram = options.geometryValueProgram;
  const geometryInputTargetsByElementId = options.geometryInputTargetsByElementId;
  const geometryCollectionNodesByValueId = options.geometryCollectionNodesByValueId;
  const propertyBindingEntries = options.propertyBindingEntries;
  const numericBindingEntries = options.numericBindingEntries;
  const controlBooleanEntries = options.controlBooleanEntries;
  const conditionalGroupConditionsByElementId = options.conditionalGroupConditionsByElementId;
  const textTemplateEntriesByElementId = options.textTemplateEntriesByElementId;
  const textPropertyBindingEntries = options.textPropertyBindingEntries;
  const evaluationOptions = useMemo(
    () => ({
      evaluationLimitIndex,
      ...(typedDependencyGraph ? { typedDependencyGraph } : {}),
      ...(evaluationOrder ? { evaluationOrder } : {}),
      ...(transformationRecipes?.length ? { transformationRecipes } : {}),
      ...(transformationDependencyPlans?.length ? { transformationDependencyPlans } : {}),
      ...(transformationNumericBindingEntries?.length ? { transformationNumericBindingEntries } : {}),
      ...(allowDisabledElementIds?.size ? { allowDisabledElementIds } : {}),
      ...(drawingModifiers?.length ? { drawingModifiers } : {}),
      ...(scalarProgram ? { scalarProgram } : {}),
      ...(statementInfoByElementId ? { statementInfoByElementId } : {}),
      ...(bindingVersions ? {
        bindingVersions, sourceExecutionPositionByElementId, scalarExecutionPositionByElementId, statementIdByStatementIndex,
        conditionalOwnerStatementIdByElementId, forGroupMutationOwnerByElementId,
        moduleConditionalOwnerStatementIdByElementId, moduleForGroupExecutionOwnerByElementId
      } : {}),
      ...(moduleMaterialization ? { moduleMaterialization } : {}),
      ...(sourceExecutionPositionByElementId ? { sourceExecutionPositionByElementId } : {}),
      ...(scalarExecutionPositionByElementId ? { scalarExecutionPositionByElementId } : {}),
      ...(geometryValueProgram?.length ? { geometryValueProgram } : {}),
      ...(geometryInputTargetsByElementId?.size ? { geometryInputTargetsByElementId } : {}),
      ...(geometryCollectionNodesByValueId?.size ? { geometryCollectionNodesByValueId } : {}),
      ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
      ...(numericBindingEntries?.length ? { numericBindingEntries } : {}),
      ...(controlBooleanEntries?.length ? { controlBooleanEntries } : {}),
      ...(conditionalGroupConditionsByElementId?.size ? { conditionalGroupConditionsByElementId } : {}),
      ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
      ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
    }),
    [
      evaluationLimitIndex,
      typedDependencyGraph,
      evaluationOrder,
      transformationRecipes,
      transformationDependencyPlans,
      transformationNumericBindingEntries,
      allowDisabledElementIds,
      drawingModifiers,
      scalarProgram,
      bindingVersions,
      statementInfoByElementId,
      sourceExecutionPositionByElementId,
      scalarExecutionPositionByElementId,
      statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId,
      forGroupMutationOwnerByElementId,
      moduleConditionalOwnerStatementIdByElementId,
      moduleForGroupExecutionOwnerByElementId,
      moduleMaterialization,
      geometryValueProgram,
      geometryInputTargetsByElementId,
      geometryCollectionNodesByValueId,
      propertyBindingEntries,
      numericBindingEntries,
      controlBooleanEntries,
      conditionalGroupConditionsByElementId,
      textTemplateEntriesByElementId,
      textPropertyBindingEntries
    ]
  );
  const rustTransportAvailable = rustTransport !== undefined;
  const { mode: engineMode, rustEligible, parityMode, deferScalarReferenceEvaluation, needsReferenceEvaluation } =
    evaluationEngineRoutingFor(elements, evaluationOptions, rustTransportAvailable);
  const requestKey = useMemo(
    () => JSON.stringify({
      elements,
      evaluationLimitIndex,
      typedDependencyGraph,
      evaluationOrder,
      transformationRecipes,
      transformationDependencyPlans,
      transformationNumericBindingEntries,
      allowDisabledElementIds: allowDisabledElementIds ? Array.from(allowDisabledElementIds) : undefined,
      drawingModifiers,
      scalarProgram,
      bindingVersions,
      sourceExecutionPositionByElementId: sourceExecutionPositionByElementId
        ? Array.from(sourceExecutionPositionByElementId)
        : undefined,
      scalarExecutionPositionByElementId: scalarExecutionPositionByElementId
        ? Array.from(scalarExecutionPositionByElementId)
        : undefined,
      geometryValueProgram,
      geometryInputTargetsByElementId: geometryInputTargetsByElementId
        ? Array.from(geometryInputTargetsByElementId)
        : undefined,
      geometryCollectionNodesByValueId: geometryCollectionNodesByValueId
        ? Array.from(geometryCollectionNodesByValueId)
        : undefined,
      statementIdByStatementIndex: statementIdByStatementIndex ? Array.from(statementIdByStatementIndex) : undefined,
      conditionalOwnerStatementIdByElementId: conditionalOwnerStatementIdByElementId
        ? Array.from(conditionalOwnerStatementIdByElementId) : undefined,
      forGroupMutationOwnerByElementId: forGroupMutationOwnerByElementId
        ? Array.from(forGroupMutationOwnerByElementId) : undefined,
      moduleConditionalOwnerStatementIdByElementId: moduleConditionalOwnerStatementIdByElementId
        ? Array.from(moduleConditionalOwnerStatementIdByElementId) : undefined,
      moduleForGroupExecutionOwnerByElementId: moduleForGroupExecutionOwnerByElementId
        ? Array.from(moduleForGroupExecutionOwnerByElementId) : undefined,
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
      typedDependencyGraph,
      evaluationOrder,
      transformationRecipes,
      transformationDependencyPlans,
      transformationNumericBindingEntries,
      allowDisabledElementIds,
      drawingModifiers,
      scalarProgram,
      bindingVersions,
      sourceExecutionPositionByElementId,
      scalarExecutionPositionByElementId,
      geometryValueProgram,
      geometryInputTargetsByElementId,
      geometryCollectionNodesByValueId,
      statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId,
      forGroupMutationOwnerByElementId,
      moduleConditionalOwnerStatementIdByElementId,
      moduleForGroupExecutionOwnerByElementId,
      propertyBindingEntries,
      numericBindingEntries,
      controlBooleanEntries,
      conditionalGroupConditionsByElementId,
      textTemplateEntriesByElementId,
      textPropertyBindingEntries
    ]
  );
  // Match the evaluation effect's inputs, including a new host transport or
  // mode. Restoring an earlier input key starts a new request, not a cache hit.
  const { revision: evaluationRequestRevision } = useMemo(
    () => ({
      elements,
      evaluationOptions,
      evaluationRevision,
      requestKey,
      engineMode,
      rustEligible,
      rustTransport,
      revision: allocateRequestRevision()
    }),
    [elements, evaluationOptions, evaluationRevision, requestKey, engineMode, rustEligible, rustTransport]
  );
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
    void evaluateRoutedRust({
      elements,
      options: evaluationOptions,
      transport: rustTransport,
      routing: { mode: engineMode, rustEligible, parityMode, deferScalarReferenceEvaluation, needsReferenceEvaluation },
      referenceEvaluation,
      emptyEvaluation,
      isCanceled: () => cancelled
    }).then((result) => {
      if (!result || cancelled) return;
      setAsyncEvaluation({ requestKey, evaluationRevision, evaluationRequestRevision, ...result });
    });

    return () => {
      cancelled = true;
    };
  }, [
    elements,
    emptyEvaluation,
    needsReferenceEvaluation,
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

  const isCurrentAsyncEvaluation = asyncEvaluation !== null &&
    asyncEvaluation.requestKey === requestKey &&
    asyncEvaluation.evaluationRevision === evaluationRevision &&
    asyncEvaluation.evaluationRequestRevision === evaluationRequestRevision;

  if (parityMode) {
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
