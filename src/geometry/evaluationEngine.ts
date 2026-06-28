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
  "lineDivisionPoint",
  "line",
  "arcLine"
]);

const rustSupportedLineDivisionBaseTypes = new Set<CadElement["type"]>([
  "line",
  "arcLine"
]);

const canUseRustEvaluationForElement = (
  element: CadElement,
  elementsById: Map<string, CadElement>
) => {
  if (!rustSupportedElementTypes.has(element.type)) return false;
  if (element.type !== "lineDivisionPoint") return true;

  const referencedLine = elementsById.get(element.endpoint.lineId);
  return referencedLine
    ? rustSupportedLineDivisionBaseTypes.has(referencedLine.type)
    : false;
};

export const canUseRustEvaluationForElements = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
) => {
  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  return elements
    .slice(0, evaluationLimitIndex)
    .every((element) => canUseRustEvaluationForElement(element, elementsById));
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
