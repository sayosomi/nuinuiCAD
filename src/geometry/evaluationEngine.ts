import type { CadElement, EvaluationResult, PointAnchor } from "../types/geometry";
import { anchorReferenceElementId, pointAnchorForElement } from "../model/pointAnchors";
import { getDirectParentIds } from "../model/dependencies";
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

export type EvaluationEngineMode = "reference" | "parity" | "shadow" | "rust";

const configuredEvaluationEngineMode = (
  value: string | undefined
): EvaluationEngineMode | null => {
  if (value === "reference" || value === "parity" || value === "shadow" || value === "rust") {
    return value;
  }
  return null;
};

export const resolveEvaluationEngineMode = ({
  configuredMode,
  tauriRuntime
}: {
  configuredMode?: string;
  tauriRuntime: boolean;
  dev: boolean;
}): EvaluationEngineMode => {
  const configured = configuredEvaluationEngineMode(configuredMode);
  if (configured) return configured;
  if (!tauriRuntime) return "reference";
  return "rust";
};

export const isParityEvaluationEngineMode = (mode: EvaluationEngineMode) =>
  mode === "parity" || mode === "shadow";

export const getEvaluationEngineMode = (): EvaluationEngineMode =>
  resolveEvaluationEngineMode({
    configuredMode: import.meta.env.VITE_EVALUATION_ENGINE,
    tauriRuntime: isTauriRuntime(),
    dev: import.meta.env.DEV
  });

const rustSupportedElementTypes = new Set<CadElement["type"]>([
  "group",
  "conditionalGroup",
  "forGroup",
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

const rustSupportedPointReferenceTypes = new Set<CadElement["type"]>([
  "freePoint",
  "offsetPoint",
  "polarOffsetPoint",
  "divisionPoint",
  "lineDivisionPoint",
  "lineTangentOffsetPoint",
  "intersectionPoint"
]);

const rustSupportedDerivedPointSourceTypes = new Set<CadElement["type"]>([
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

const referencesRustSupportedPointAnchor = (
  anchor: PointAnchor,
  elementsById: Map<string, CadElement>
) => {
  if (anchor.mode === "coordinate") return true;
  const referencedElement = elementsById.get(anchorReferenceElementId(anchor) ?? "");
  if (!referencedElement) return false;
  return anchor.mode === "reference"
    ? rustSupportedPointReferenceTypes.has(referencedElement.type)
    : rustSupportedDerivedPointSourceTypes.has(referencedElement.type);
};

const pointAnchorsForElement = (element: CadElement): PointAnchor[] => {
  switch (element.type) {
    case "variable":
      return [
        ...(element.valueMode === "pointDistance" || element.valueMode === "pointAngle"
          ? [element.point1, element.point2]
          : []),
        ...(element.valueMode === "pointLineDistance" ? [element.point] : [])
      ];
    case "offsetPoint":
    case "polarOffsetPoint": {
      const fromPoint = pointAnchorForElement(element);
      return fromPoint ? [fromPoint] : [];
    }
    case "divisionPoint":
      return [element.startPoint, element.endPoint];
    case "lineTangentOffsetPoint":
      return [element.basePoint];
    case "line":
      return [element.startPoint, element.endPoint];
    case "arcLine":
      return [element.centerPoint];
    case "threePointArcLine":
      return [element.point1, element.point2, element.point3];
    case "extendTrim":
      return [element.point];
    case "bezierCurve":
      return [
        element.startPoint,
        ...element.intermediatePoints.map((point) => point.point),
        element.endPoint
      ];
    case "splitLine":
      return [element.splitPoint];
    case "copyLine":
    case "move":
      return [element.startPoint, element.endPoint];
    case "symmetricCopyLine":
    case "symmetricMove":
      return [element.axisPoint1, element.axisPoint2];
    default:
      return [];
  }
};

const canUseRustEvaluationForElement = (
  element: CadElement,
  elementsById: Map<string, CadElement>
) => {
  if (!rustSupportedElementTypes.has(element.type)) return false;
  if (
    pointAnchorsForElement(element).some(
      (anchor) => !referencesRustSupportedPointAnchor(anchor, elementsById)
    )
  ) {
    return false;
  }
  if (
    getDirectParentIds(element).some((parentId) => {
      const parent = elementsById.get(parentId);
      return parent ? !rustSupportedElementTypes.has(parent.type) : false;
    })
  ) {
    return false;
  }
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

const normalizeEvaluationPayloadForComparison = (value: unknown): unknown => {
  if (typeof value === "number") {
    const normalized = Math.round(value * 1e7) / 1e7;
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeEvaluationPayloadForComparison);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeEvaluationPayloadForComparison(nested)])
    );
  }
  return value;
};

const payloadForComparison = (result: EvaluationResult) =>
  JSON.stringify(normalizeEvaluationPayloadForComparison(evaluationResultToPayload(result)));

export const evaluationResultsMatch = (
  left: EvaluationResult,
  right: EvaluationResult
) => payloadForComparison(left) === payloadForComparison(right);
