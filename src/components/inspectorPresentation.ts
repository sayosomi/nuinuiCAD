import { numericValueExpression } from "../geometry/numericExpressions";
import type { DependencySummary } from "../model/dependencies";
import { getParameterValue } from "../parameters/parameterAccess";
import { getParameterDefinitions, type ParameterDefinition } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId, EvaluationResult, LineEndpointReference, PointAnchor } from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";

export type InspectorIssue = { severity: "error" | "warning"; message: string };

export type InspectorParameterRow = {
  key: string;
  parameterKey: string;
  label: string;
  value: string;
};

export type InspectorDependencyRow = {
  key: string;
  elementId: ElementId;
  label: string;
  detail: string;
  relatedCount: number;
  issues: readonly InspectorIssue[];
};

export type InspectorUnresolvedDependencyRow = {
  key: string;
  id: ElementId;
  relatedCount: number;
  issues: readonly InspectorIssue[];
};

export const displayInspectorValue = (value: unknown): string => {
  if (typeof value === "number" || (typeof value === "object" && value !== null && "kind" in value)) {
    return numericValueExpression(value as Parameters<typeof numericValueExpression>[0]);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value || "（空）";
  if (value === null || value === undefined) return "未設定";
  if (typeof value === "object" && "mode" in value) {
    const anchor = value as { mode: string; pointId?: string; x?: unknown; y?: unknown };
    return anchor.mode === "coordinate"
      ? `(${displayInspectorValue(anchor.x)}, ${displayInspectorValue(anchor.y)})`
      : anchor.pointId ?? "未設定";
  }
  return String(value);
};

const unresolvedReferenceLabel = "未解決";

const resolvedElementName = (elementId: ElementId, elementNameById: ReadonlyMap<ElementId, string>) =>
  elementNameById.get(elementId) ?? unresolvedReferenceLabel;

const displayDerivedAnchor = (
  anchor: Extract<PointAnchor, { mode: "derived" }>,
  elementNameById: ReadonlyMap<ElementId, string>,
) => {
  const elementName = elementNameById.get(anchor.elementId);
  if (!elementName) return unresolvedReferenceLabel;
  if (anchor.pointKey === "start" || anchor.pointKey === "end" || anchor.pointKey === "center") {
    return `${elementName}.${anchor.pointKey}`;
  }
  return elementName;
};

const displayReferenceInspectorValue = (
  value: unknown,
  definition: ParameterDefinition,
  elementNameById: ReadonlyMap<ElementId, string>,
) => {
  switch (definition.kind) {
    case "reference": {
      if (!value || typeof value !== "object" || !("mode" in value)) return displayInspectorValue(value);
      const anchor = value as PointAnchor;
      if (anchor.mode === "coordinate") return displayInspectorValue(anchor);
      if (anchor.mode === "reference") return resolvedElementName(anchor.pointId, elementNameById);
      return displayDerivedAnchor(anchor, elementNameById);
    }
    case "lineEndpointReference": {
      if (!value || typeof value !== "object" || !("lineId" in value) || !("endpointKey" in value)) {
        return displayInspectorValue(value);
      }
      const endpoint = value as LineEndpointReference;
      const lineName = elementNameById.get(endpoint.lineId);
      return lineName ? `${lineName}.${endpoint.endpointKey}` : unresolvedReferenceLabel;
    }
    case "lineReference":
      return typeof value === "string"
        ? resolvedElementName(value, elementNameById)
        : displayInspectorValue(value);
    case "lineReferenceList":
      return Array.isArray(value)
        ? value.map((item) => typeof item === "string" ? resolvedElementName(item, elementNameById) : unresolvedReferenceLabel).join(", ")
        : displayInspectorValue(value);
    default:
      return displayInspectorValue(value);
  }
};

export const evaluationIssuesForElement = (elementId: ElementId, evaluation: EvaluationResult): InspectorIssue[] => [
  ...evaluation.errors
    .filter((item) => item.elementId === elementId)
    .map((item) => ({ severity: "error" as const, message: item.message })),
  ...evaluation.warnings
    .filter((item) => item.elementId === elementId)
    .map((item) => ({ severity: "warning" as const, message: item.message }))
];

export const parameterInspectorRows = (
  element: CadElement,
  elementNameById: ReadonlyMap<ElementId, string>,
): InspectorParameterRow[] =>
  getParameterDefinitions(element).map((definition) => ({
    key: `parameter:${definition.key}`,
    parameterKey: definition.key,
    label: definition.label,
    value: displayReferenceInspectorValue(
      getParameterValue(element, definition.key),
      definition,
      elementNameById,
    )
  }));

const issuesForParent = (element: CadElement, parentId: ElementId, evaluation: EvaluationResult): InspectorIssue[] =>
  evaluation.errors
    .filter((issue) => issue.elementId === element.id && issue.missingDependencyId === parentId)
    .map((issue) => ({ severity: "error" as const, message: issue.message }));

/**
 * Dependency rows are deduplicated by relation and target. The evaluator treats repeated
 * references to the same element as one navigation target, so the Inspector does too.
 */
export const dependencyInspectorPresentation = (
  element: CadElement,
  summary: DependencySummary,
  evaluation: EvaluationResult
) => {
  const parentById = new Map(summary.parents.map((parent) => [parent.id, parent]));
  const parentRows: InspectorDependencyRow[] = [];
  const unresolvedParentRows: InspectorUnresolvedDependencyRow[] = [];
  for (const parent of parentById.values()) {
    const issues = issuesForParent(element, parent.id, evaluation);
    if (!parent.element) {
      unresolvedParentRows.push({
        key: `unresolved-parent:${parent.id}`,
        id: parent.id,
        relatedCount: parent.ancestorCount,
        issues
      });
      continue;
    }
    parentRows.push({
      key: `dependency:parent:${parent.element.id}`,
      elementId: parent.element.id,
      label: parent.element.name,
      detail: `親・${elementTypeLabels[parent.element.type]}`,
      relatedCount: parent.ancestorCount,
      issues
    });
  }
  const childRows = summary.children.map((child) => ({
    key: `dependency:child:${child.element.id}`,
    elementId: child.element.id,
    label: child.element.name,
    detail: `子・${elementTypeLabels[child.element.type]}`,
    relatedCount: child.descendantCount,
    issues: evaluationIssuesForElement(child.element.id, evaluation)
  }));
  const parentIds = new Set(summary.parents.map((parent) => parent.id));
  const ownIssues = evaluationIssuesForElement(element.id, evaluation).filter((issue) =>
    issue.severity === "warning" ||
    !evaluation.errors.some((error) => error.elementId === element.id && error.message === issue.message && parentIds.has(error.missingDependencyId))
  );
  return {
    parentRows,
    childRows,
    unresolvedParentRows,
    rows: [...parentRows, ...childRows],
    ownIssues
  };
};
