import type { CadElement, EvaluationResult } from "../types/geometry";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import {
  evaluationPayloadToResult,
  evaluationResultToPayload,
  type EvaluationPayload
} from "./evaluationPayload";

type EvaluateDocumentInput = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
};

const rustSupportedElementTypes = new Set<CadElement["type"]>([
  "group",
  "variable",
  "freePoint",
  "offsetPoint",
  "polarOffsetPoint",
  "divisionPoint",
  "line",
  "arcLine"
]);

export const canUseRustEvaluationForElements = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
) => {
  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  return elements
    .slice(0, evaluationLimitIndex)
    .every((element) => rustSupportedElementTypes.has(element.type));
};

export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const evaluateElementsReference = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
) => evaluateElements(elements, options);

export const evaluateElementsReferencePayload = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationPayload => evaluationResultToPayload(evaluateElementsReference(elements, options));

export const evaluateElementsWithRust = async (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): Promise<EvaluationResult> => {
  const { invoke } = await import("@tauri-apps/api/core");
  const payload = await invoke<EvaluationPayload>("evaluate_document", {
    input: {
      elements,
      evaluationLimitIndex: options.evaluationLimitIndex
    } satisfies EvaluateDocumentInput
  });
  return evaluationPayloadToResult(payload);
};

const payloadForComparison = (result: EvaluationResult) =>
  JSON.stringify(evaluationResultToPayload(result));

export const evaluationResultsMatch = (
  left: EvaluationResult,
  right: EvaluationResult
) => payloadForComparison(left) === payloadForComparison(right);
