import { numericValueExpression } from "../geometry/numericExpressions";
import type { DependencySummary } from "../model/dependencies";
import { getParameterValue } from "../parameters/parameterAccess";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
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

export const evaluationIssuesForElement = (elementId: ElementId, evaluation: EvaluationResult): InspectorIssue[] => [
  ...evaluation.errors
    .filter((item) => item.elementId === elementId)
    .map((item) => ({ severity: "error" as const, message: item.message })),
  ...evaluation.warnings
    .filter((item) => item.elementId === elementId)
    .map((item) => ({ severity: "warning" as const, message: item.message }))
];

export const parameterInspectorRows = (element: CadElement): InspectorParameterRow[] =>
  getParameterDefinitions(element).map((definition) => ({
    key: `parameter:${definition.key}`,
    parameterKey: definition.key,
    label: definition.label,
    value: displayInspectorValue(getParameterValue(element, definition.key))
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
