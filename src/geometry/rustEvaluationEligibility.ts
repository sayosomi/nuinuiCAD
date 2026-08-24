import type { CadElement, ElementId, PointAnchor } from "../types/geometry";
import { anchorReferenceElementId, pointAnchorForElement } from "../model/pointAnchors";
import { getDirectParentIds } from "../model/dependencies";
import type { EvaluateElementsOptions } from "./evaluate";
import { hasSetVersions, isRustLinearMutationEligible } from "../scalars/linearMutationEvaluator";
import { hasCanonicalForGroupMutationOwners } from "../scalars/forGroupMutationControl";
import { referencesIn } from "../scalars/typedDependencyGraph";

const rustSupportedElementTypes = new Set<CadElement["type"]>([
  "group",
  "conditionalGroup",
  "forGroup",
  "moduleInstance",
  "freePoint",
  "offsetPoint",
  "polarOffsetPoint",
  "divisionPoint",
  "lineDivisionPoint",
  "lineTangentOffsetPoint",
  "intersectionPoint",
  "line",
  "polyline",
  "angleLengthLine",
  "commonTangentLine",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "bezierBulgePoint",
  "bezierExtremePoint",
  "offsetLine",
  "splitLine",
  "edge",
  "extendTrim",
  "copyLine",
  "symmetricCopyLine",
  "move",
  "symmetricMove",
  "pathReverse",
  "image",
  "text"
]);

const rustSupportedLineReferenceTypes = new Set<CadElement["type"]>([
  "line",
  "angleLengthLine",
  "commonTangentLine",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "offsetLine",
  "polyline",
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
  "intersectionPoint",
  "bezierBulgePoint",
  "bezierExtremePoint"
]);

const rustSupportedDerivedPointSourceTypes = new Set<CadElement["type"]>([
  "line",
  "angleLengthLine",
  "commonTangentLine",
  "arcLine",
  "threePointArcLine",
  "cornerRadiusArcLine",
  "bezierCurve",
  "offsetLine",
  "polyline",
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
    case "offsetPoint":
    case "polarOffsetPoint": {
      const fromPoint = pointAnchorForElement(element);
      return fromPoint ? [fromPoint] : [];
    }
    case "divisionPoint":
      return [element.startPoint, element.endPoint];
    case "lineTangentOffsetPoint":
      return [element.basePoint];
    case "angleLengthLine":
      return [element.startPoint];
    case "line":
      return [element.startPoint, element.endPoint];
    case "polyline":
      return element.points;
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
    case "image":
      return [element.originPoint];
    case "text":
      return element.anchor ? [element.anchor] : [];
    default:
      return [];
  }
};

const textElementHasRequiredCompiledData = (
  element: CadElement,
  textTemplateEntriesByElementId: EvaluateElementsOptions["textTemplateEntriesByElementId"],
  textPropertyBoundElementIds: ReadonlySet<ElementId> | undefined
): boolean =>
  (textTemplateEntriesByElementId?.has(element.id) ?? false) ||
  (textPropertyBoundElementIds?.has(element.id) ?? false);

/**
 * Rust eligibility must include compiled payload references, not merely the
 * element types that happen to own them. Rust validates these at its command
 * boundary; this earlier check prevents a production route from claiming
 * eligibility for a document whose compiled joins cannot be resolved.
 */
const hasRustSupportedCompiledReferences = (
  elementsById: ReadonlyMap<ElementId, CadElement>,
  options: EvaluateElementsOptions
): boolean => {
  const usesMutationPayload = options.bindingVersions && isRustLinearMutationEligible(options.bindingVersions);
  // Eligibility must never decode || reject a malformed scalar payload. The
  // Rust command owns validation && its typed-input failure must stay on the
  // existing fail-closed path rather than becoming a TypeScript exception.
  const scalarStatements = options.scalarProgram?.statements;
  const availableBindingIds = new Set(
    usesMutationPayload
      ? options.bindingVersions!.versionIdsByBindingId.keys()
      : Array.isArray(scalarStatements) ? scalarStatements.map((statement) => statement.bindingId) : []
  );
  const hasBinding = (bindingId: string) => availableBindingIds.has(bindingId);
  const propertyEntries = [
    ...(options.propertyBindingEntries ?? []),
    ...(options.controlBooleanEntries ?? []),
    ...(options.textPropertyBindingEntries ?? [])
  ];
  if (propertyEntries.some((entry) =>
    !elementsById.has(entry.elementId) ||
    (entry.bindingId ? !hasBinding(entry.bindingId) :
      entry.expression ? referencesIn(entry.expression).some((reference) => reference.bindingId === null || !hasBinding(reference.bindingId)) : true)
  )) return false;
  if (options.numericBindingEntries?.some((entry) =>
    !elementsById.has(entry.elementId) || entry.references.some((reference) => !hasBinding(reference.bindingId))
  )) return false;
  if (options.textPropertyBindingEntries?.some((entry) => elementsById.get(entry.elementId)?.type !== "text")) return false;
  if (options.conditionalGroupConditionsByElementId && Array.from(options.conditionalGroupConditionsByElementId).some(
    ([elementId, expression]) => elementsById.get(elementId)?.type !== "conditionalGroup" ||
      referencesIn(expression).some((reference) => reference.bindingId === null || !hasBinding(reference.bindingId))
  )) return false;
  if (options.textTemplateEntriesByElementId && Array.from(options.textTemplateEntriesByElementId).some(
    ([elementId, template]) => elementsById.get(elementId)?.type !== "text" ||
      template.dependencies.some((dependency) => !hasBinding(dependency.bindingId))
  )) return false;
  return true;
};

const canUseRustEvaluationForElement = (
  element: CadElement,
  elementsById: Map<string, CadElement>,
  options: EvaluateElementsOptions,
  textPropertyBoundElementIds: ReadonlySet<ElementId> | undefined
) => {
  if (!rustSupportedElementTypes.has(element.type)) return false;
  if (element.type === "text" && !textElementHasRequiredCompiledData(
    element,
    options.textTemplateEntriesByElementId,
    textPropertyBoundElementIds
  )) return false;
  if (
    pointAnchorsForElement(element).some(
      (anchor) => !referencesRustSupportedPointAnchor(anchor, elementsById)
    )
  ) {
    return false;
  }
  if (
    getDirectParentIds(element, {
      textTemplatesByElementId: options.textTemplateEntriesByElementId
    }).some((parentId) => {
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
  if (element.type === "bezierExtremePoint") {
    return referencesRustSupportedLine(element.baseLineId, elementsById);
  }
  if (element.type === "bezierBulgePoint") {
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
  if (element.type === "pathReverse") {
    return referencesRustSupportedLine(element.targetLineId, elementsById);
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
  if (options.bindingVersions && hasSetVersions(options.bindingVersions) &&
    !isRustLinearMutationEligible(options.bindingVersions)) return false;
  if (options.bindingVersions?.versions.some((version) => version.control.ownerChain.some((owner) => owner.kind === "conditionalBranch")) &&
    (!options.statementIdByStatementIndex || !options.conditionalOwnerStatementIdByElementId)) return false;
  if (options.bindingVersions?.versions.some((version) => version.control.ownerChain.some((owner) => owner.kind === "forGroup")) &&
    !hasCanonicalForGroupMutationOwners(
      options.bindingVersions,
      elements,
      options.statementInfoByElementId,
      options.statementIdByStatementIndex,
      options.forGroupMutationOwnerByElementId,
      new Set(options.moduleForGroupMutationOwnerByElementId ? [...options.moduleForGroupMutationOwnerByElementId.values()].map((owner) => owner.ownerStatementId) : [])
    )) return false;
  const evaluationLimitIndex = Math.min(
    Math.max(options.evaluationLimitIndex ?? elements.length, 0),
    elements.length
  );
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  if (!hasRustSupportedCompiledReferences(elementsById, options)) return false;
  const textPropertyBoundElementIds = options.textPropertyBindingEntries?.length
    ? new Set(options.textPropertyBindingEntries.map((entry) => entry.elementId))
    : undefined;
  return elements
    .slice(0, evaluationLimitIndex)
    .every((element) =>
      canUseRustEvaluationForElement(element, elementsById, options, textPropertyBoundElementIds)
    );
};
