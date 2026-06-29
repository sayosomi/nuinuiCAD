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

export type EvaluationEngineMode = "reference" | "shadow" | "rust";

const configuredEvaluationEngineMode = (
  value: string | undefined
): EvaluationEngineMode | null => {
  if (value === "reference" || value === "shadow" || value === "rust") {
    return value;
  }
  return null;
};

export const resolveEvaluationEngineMode = ({
  configuredMode,
  tauriRuntime,
  dev
}: {
  configuredMode?: string;
  tauriRuntime: boolean;
  dev: boolean;
}): EvaluationEngineMode => {
  const configured = configuredEvaluationEngineMode(configuredMode);
  if (configured) return configured;
  if (!tauriRuntime) return "reference";
  return dev ? "shadow" : "rust";
};

export const getEvaluationEngineMode = (): EvaluationEngineMode =>
  resolveEvaluationEngineMode({
    configuredMode: import.meta.env.VITE_EVALUATION_ENGINE,
    tauriRuntime: isTauriRuntime(),
    dev: import.meta.env.DEV
  });

const rustSupportedElementTypes = new Set<CadElement["type"]>([
  "group",
  "variable",
  "freePoint",
  "offsetPoint",
  "polarOffsetPoint",
  "divisionPoint",
  "lineDivisionPoint",
  "lineTangentOffsetPoint",
  "intersectionPoint",
  "line",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "offsetLine",
  "splitLine",
  "edge",
  "extendTrim",
  "copyLine",
  "symmetricCopyLine",
  "move",
  "symmetricMove"
]);

const rustSupportedLineReferenceTypes = new Set<CadElement["type"]>([
  "line",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "offsetLine",
  "splitLine",
  "copyLine",
  "symmetricCopyLine"
]);

const referencesRustSupportedLine = (
  lineId: string,
  elementsById: Map<string, CadElement>
) => {
  const referencedLine = elementsById.get(lineId);
  return referencedLine
    ? rustSupportedLineReferenceTypes.has(referencedLine.type)
    : false;
};

const canUseRustEvaluationForElement = (
  element: CadElement,
  elementsById: Map<string, CadElement>
) => {
  if (!rustSupportedElementTypes.has(element.type)) return false;
  if (element.type === "lineDivisionPoint") {
    return referencesRustSupportedLine(element.endpoint.lineId, elementsById);
  }
  if (element.type === "lineTangentOffsetPoint") {
    return referencesRustSupportedLine(element.baseLineId, elementsById);
  }
  if (element.type === "intersectionPoint") {
    return (
      referencesRustSupportedLine(element.line1Id, elementsById) &&
      referencesRustSupportedLine(element.line2Id, elementsById)
    );
  }
  if (element.type === "offsetLine") {
    return element.baseLineIds.every((baseLineId) =>
      referencesRustSupportedLine(baseLineId, elementsById)
    );
  }
  if (element.type === "splitLine") {
    return referencesRustSupportedLine(element.baseLineId, elementsById);
  }
  if (element.type === "edge") {
    return (
      referencesRustSupportedLine(element.endpoint1.lineId, elementsById) &&
      referencesRustSupportedLine(element.endpoint2.lineId, elementsById)
    );
  }
  if (element.type === "extendTrim") {
    return referencesRustSupportedLine(element.endpoint.lineId, elementsById);
  }
  if (element.type === "cornerRadiusArcLine") {
    return (
      referencesRustSupportedLine(element.endpoint1.lineId, elementsById) &&
      referencesRustSupportedLine(element.endpoint2.lineId, elementsById)
    );
  }
  if (
    element.type === "copyLine" ||
    element.type === "symmetricCopyLine" ||
    element.type === "move" ||
    element.type === "symmetricMove"
  ) {
    return element.baseLineIds.every((baseLineId) =>
      referencesRustSupportedLine(baseLineId, elementsById)
    );
  }
  return true;
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

export const emptyEvaluationResult = (
  elements: CadElement[],
  options: EvaluateElementsOptions = {}
): EvaluationResult => {
  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  return {
    computedGeometry: new Map(),
    computedVariables: new Map(),
    errors: [],
    warnings: [],
    evaluatedElementIds: new Set(),
    evaluationLimitIndex,
    effectiveVisibleElementIds: new Set(),
    effectiveEnabledElementIds: new Set()
  };
};

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
