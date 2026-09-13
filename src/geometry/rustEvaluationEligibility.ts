import type { CadElement, ElementId, GeometryInputTarget, PointAnchor } from "../types/geometry";
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
  "joinedPath",
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
  "joinedPath",
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
  "joinedPath",
  "polyline",
  "splitLine",
  "copyLine",
  "symmetricCopyLine"
]);

const referencesRustSupportedLine = (
  lineId: string,
  elementsById: ReadonlyMap<string, CadElement>
) => {
  const referencedLine = elementsById.get(lineId);
  return referencedLine
    ? rustSupportedLineReferenceTypes.has(referencedLine.type)
    : false;
};

const referencesRustSupportedLineTargetValue = (
  target: GeometryInputTarget,
  elementsById: ReadonlyMap<ElementId, CadElement>
): boolean => {
  if (target.kind === "geometryValue") {
    return target.geometryType === "line" || target.geometryType === "path";
  }
  if (target.kind === "geometryValueMap") {
    return (target.geometryType === "line" || target.geometryType === "path") &&
      referencesRustSupportedLineTargetValue(target.source, elementsById);
  }
  if (target.kind === "drawable") {
    return (target.geometryType === "line" || target.geometryType === "path") &&
      referencesRustSupportedLine(target.elementId, elementsById);
  }
  if (target.kind === "collectionIndex") {
    return target.value
      ? referencesRustSupportedLineCollectionNode(target.value, elementsById)
      : target.members.every((member) => referencesRustSupportedLineTargetValue(member, elementsById));
  }
  if (target.kind === "collectionValue") {
    return referencesRustSupportedLineCollectionNode(target.value, elementsById);
  }
  return false;
};

const referencesRustSupportedLineCollectionNode = (
  node: import("../types/geometry").GeometryInputCollectionNode,
  elementsById: ReadonlyMap<ElementId, CadElement>
): boolean => node.kind === "none"
  ? true
  : node.kind === "leaf"
    ? node.targets.every((target) => referencesRustSupportedLineTargetValue(target, elementsById))
    : node.kind === "if"
      ? referencesRustSupportedLineCollectionNode(node.thenBranch, elementsById) && referencesRustSupportedLineCollectionNode(node.elseBranch, elementsById)
      : node.kind === "coalesce"
        ? referencesRustSupportedLineCollectionNode(node.leftBranch, elementsById) && referencesRustSupportedLineCollectionNode(node.rightBranch, elementsById)
        : node.arms.every((arm) => referencesRustSupportedLineCollectionNode(arm.value, elementsById));

const referencesRustSupportedLineTarget = (
  fallbackId: string,
  element: CadElement,
  parameterKey: string,
  options: EvaluateElementsOptions,
  elementsById: ReadonlyMap<ElementId, CadElement>
) => {
  const target = options.geometryInputTargetsByElementId?.get(element.id)?.get(parameterKey);
  const candidates = target && Array.isArray(target) ? target : target ? [target] : [];
  if (candidates.length > 0) return candidates.every((candidate) =>
    referencesRustSupportedLineTargetValue(candidate, elementsById)
  );
  return referencesRustSupportedLine(fallbackId, elementsById);
};

const referencesRustSupportedPointAnchor = (
  anchor: PointAnchor,
  elementsById: ReadonlyMap<string, CadElement>
) => {
  if (anchor.mode === "coordinate" || anchor.mode === "geometryValue") return true;
  const referencedElement = elementsById.get(anchorReferenceElementId(anchor) ?? "");
  if (!referencedElement) return false;
  return anchor.mode === "reference"
    ? rustSupportedPointReferenceTypes.has(referencedElement.type)
    : rustSupportedDerivedPointSourceTypes.has(referencedElement.type);
};

const referencesRustSupportedPointTargetValue = (
  target: GeometryInputTarget,
  elementsById: ReadonlyMap<ElementId, CadElement>
): boolean => {
  if (target.kind === "coordinate") return true;
  if (target.kind === "geometryValue") return target.geometryType === "point";
  if (target.kind === "geometryValueMap") {
    return target.geometryType === "point" &&
      referencesRustSupportedPointTargetValue(target.source, elementsById);
  }
  if (target.kind === "drawable") {
    if (target.geometryType !== "point") return false;
    return referencesRustSupportedPointAnchor(
      target.pointKey
        ? { mode: "derived", elementId: target.elementId, pointKey: target.pointKey }
        : { mode: "reference", pointId: target.elementId },
      elementsById
    );
  }
  if (target.kind === "collectionIndex") {
    return target.value
      ? referencesRustSupportedPointCollectionNode(target.value, elementsById)
      : target.members.every((member) => referencesRustSupportedPointTargetValue(member, elementsById));
  }
  if (target.kind === "collectionValue") {
    return referencesRustSupportedPointCollectionNode(target.value, elementsById);
  }
  return false;
};

const referencesRustSupportedPointCollectionNode = (
  node: import("../types/geometry").GeometryInputCollectionNode,
  elementsById: ReadonlyMap<ElementId, CadElement>
): boolean => node.kind === "none"
  ? true
  : node.kind === "leaf"
    ? node.targets.every((target) => referencesRustSupportedPointTargetValue(target, elementsById))
    : node.kind === "if"
      ? referencesRustSupportedPointCollectionNode(node.thenBranch, elementsById) && referencesRustSupportedPointCollectionNode(node.elseBranch, elementsById)
      : node.kind === "coalesce"
        ? referencesRustSupportedPointCollectionNode(node.leftBranch, elementsById) && referencesRustSupportedPointCollectionNode(node.rightBranch, elementsById)
        : node.arms.every((arm) => referencesRustSupportedPointCollectionNode(arm.value, elementsById));

const hasRustSupportedDeferredPointTarget = (
  element: CadElement,
  options: EvaluateElementsOptions,
  elementsById: ReadonlyMap<ElementId, CadElement>
) => {
  const targets = options.geometryInputTargetsByElementId?.get(element.id)?.values() ?? [];
  return [...targets].some((target) => {
    const candidates = Array.isArray(target) ? target : [target];
    return candidates.some((candidate) =>
      (candidate.kind === "collectionIndex" || candidate.kind === "collectionValue" || candidate.kind === "geometryValueMap") &&
      referencesRustSupportedPointTargetValue(candidate, elementsById)
    );
  });
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
    ) && !hasRustSupportedDeferredPointTarget(element, options, elementsById)
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
    return referencesRustSupportedLineTarget(element.endpoint.lineId, element, "endpoint", options, elementsById);
  }
  if (element.type === "lineTangentOffsetPoint") {
    return referencesRustSupportedLineTarget(element.baseLineId, element, "baseLineId", options, elementsById);
  }
  if (element.type === "bezierExtremePoint") {
    return referencesRustSupportedLineTarget(element.baseLineId, element, "baseLineId", options, elementsById);
  }
  if (element.type === "bezierBulgePoint") {
    return referencesRustSupportedLineTarget(element.baseLineId, element, "baseLineId", options, elementsById);
  }
  if (element.type === "commonTangentLine") {
    return (
      referencesRustSupportedLineTarget(element.firstLineId, element, "firstLineId", options, elementsById) &&
      referencesRustSupportedLineTarget(element.secondLineId, element, "secondLineId", options, elementsById)
    );
  }
  if (element.type === "intersectionPoint") {
    return (
      referencesRustSupportedLineTarget(element.line1Id, element, "line1Id", options, elementsById) &&
      referencesRustSupportedLineTarget(element.line2Id, element, "line2Id", options, elementsById)
    );
  }
  if (element.type === "offsetLine") {
    const target = options.geometryInputTargetsByElementId?.get(element.id)?.get("baseLineIds");
    if (target) {
      const candidates = Array.isArray(target) ? target : [target];
      return candidates.every((candidate) => referencesRustSupportedLineTargetValue(candidate, elementsById));
    }
    return element.baseLineIds.every((baseLineId) => referencesRustSupportedLine(baseLineId, elementsById));
  }
  if (element.type === "joinedPath") {
    return element.pathIds.every((pathId) => referencesRustSupportedLine(pathId, elementsById));
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
    element.type === "symmetricCopyLine"
  ) {
    const target = options.geometryInputTargetsByElementId?.get(element.id)?.get("baseLineIds");
    if (target) {
      const candidates = Array.isArray(target) ? target : [target];
      return candidates.every((candidate) => referencesRustSupportedLineTargetValue(candidate, elementsById));
    }
    return element.baseLineIds.every((baseLineId) => referencesRustSupportedLine(baseLineId, elementsById));
  }
  if (element.type === "move" || element.type === "symmetricMove") {
    return element.baseLineIds.every((baseLineId) => referencesRustSupportedLine(baseLineId, elementsById));
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
