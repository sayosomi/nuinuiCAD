import { useMemo } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  createDependencyIndex,
  getDependencyJumpTargets,
  getDependencySummary
} from "../model/dependencies";
import { useCadUiStore } from "../state/cadUiStore";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  DependencyError,
  ElementId,
  EvaluationWarning,
  EvaluationResult
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import {
  arcLineInfoRows,
  bezierCurveInfoRows,
  lineInfoRows,
  offsetLineInfoRows,
  pointCoordinateRows,
  variableInfoRows
} from "./geometryDisplay";

const isComputedPoint = (geometry: ComputedGeometry | undefined): geometry is ComputedPoint =>
  geometry?.kind === "point";

const isComputedLine = (geometry: ComputedGeometry | undefined): geometry is ComputedLine =>
  geometry?.kind === "line";

const isComputedArcLine = (geometry: ComputedGeometry | undefined): geometry is ComputedArcLine =>
  geometry?.kind === "arcLine";

const isComputedBezierCurve = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedBezierCurve => geometry?.kind === "bezierCurve";

const isComputedOffsetLine = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedOffsetLine => geometry?.kind === "offsetLine";

const formatDependencyCount = (count: number) => (count > 99 ? "99+" : `${count}`);

type DependencyIssue = {
  kind: "error" | "warning";
  key: string;
  message: string;
};

const errorIssue = (error: DependencyError, index: number): DependencyIssue => ({
  kind: "error",
  key: `error-${error.elementId}-${error.missingDependencyId}-${index}`,
  message: error.message
});

const warningIssue = (warning: EvaluationWarning, index: number): DependencyIssue => ({
  kind: "warning",
  key: `warning-${warning.elementId}-${index}`,
  message: warning.message
});

export const ElementInfoPanel = ({
  element,
  elements,
  evaluation,
  evaluationEngineLabel,
  isEvaluationFallback = false,
  isEvaluationStale = false,
  isDependencyJumpMode,
  selectedDependencyJumpIndex,
  setSelectedElementId
}: {
  element: CadElement | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  evaluationEngineLabel?: string | null;
  isEvaluationFallback?: boolean;
  isEvaluationStale?: boolean;
  isDependencyJumpMode: boolean;
  selectedDependencyJumpIndex: number;
  setSelectedElementId: (id: ElementId | null) => void;
}) => {
  const showElementInfoPanel = useCadUiStore((state) => state.showElementInfoPanel);
  const dependencyIndex = useMemo(() => createDependencyIndex(elements), [elements]);
  const geometry = element ? evaluation.computedGeometry.get(element.id) : undefined;
  const variable = element ? evaluation.computedVariables.get(element.id) : undefined;
  const dependencySummary = element ? getDependencySummary(element, elements, dependencyIndex) : null;
  const parentIds = new Set(dependencySummary?.parents.map((parent) => parent.id) ?? []);
  const selectedElementIssues = element
    ? [
        ...evaluation.errors
          .map((error, index) => ({ error, index }))
          .filter(({ error }) => error.elementId === element.id)
          .map(({ error, index }) => errorIssue(error, index)),
        ...evaluation.warnings
          .map((warning, index) => ({ warning, index }))
          .filter(({ warning }) => warning.elementId === element.id)
          .map(({ warning, index }) => warningIssue(warning, index))
      ]
    : [];
  const unassignedSelectedIssues = element
    ? [
        ...evaluation.errors
          .map((error, index) => ({ error, index }))
          .filter(
            ({ error }) =>
              error.elementId === element.id && !parentIds.has(error.missingDependencyId)
          )
          .map(({ error, index }) => errorIssue(error, index)),
        ...evaluation.warnings
          .map((warning, index) => ({ warning, index }))
          .filter(({ warning }) => warning.elementId === element.id)
          .map(({ warning, index }) => warningIssue(warning, index))
      ]
    : [];
  const jumpTargets = getDependencyJumpTargets(element, elements, dependencyIndex);
  const jumpTargetIndexes = new Map(jumpTargets.map((target, index) => [target.id, index]));
  const infoRows =
    variable
      ? variableInfoRows(variable)
      : isComputedPoint(geometry)
      ? pointCoordinateRows(geometry)
      : isComputedLine(geometry)
        ? lineInfoRows(geometry)
        : isComputedArcLine(geometry)
          ? arcLineInfoRows(geometry)
          : isComputedBezierCurve(geometry)
            ? bezierCurveInfoRows(geometry)
            : isComputedOffsetLine(geometry)
              ? offsetLineInfoRows(geometry)
              : [];
  const selectDependency = (id: ElementId) => setSelectedElementId(id);
  const dependencyButtonClass = (id: ElementId) => {
    const jumpIndex = jumpTargetIndexes.get(id);
    return `dependency-row ${
      isDependencyJumpMode && jumpIndex === selectedDependencyJumpIndex ? "selected-dependency" : ""
    }`;
  };
  const parentIssues = (parentId: ElementId) =>
    element
      ? evaluation.errors
          .map((error, index) => ({ error, index }))
          .filter(
            ({ error }) =>
              error.elementId === element.id && error.missingDependencyId === parentId
          )
          .map(({ error, index }) => errorIssue(error, index))
      : [];
  const childIssues = (childId: ElementId) => [
    ...evaluation.errors
      .map((error, index) => ({ error, index }))
      .filter(({ error }) => error.elementId === childId)
      .map(({ error, index }) => errorIssue(error, index)),
    ...evaluation.warnings
      .map((warning, index) => ({ warning, index }))
      .filter(({ warning }) => warning.elementId === childId)
      .map(({ warning, index }) => warningIssue(warning, index))
  ];
  const dependencyNameWithCount = (name: string, count: number) => (
    <span className="dependency-primary">
      <span className="dependency-name">{name}</span>
      <span className="dependency-count-badge" aria-label={`関連要素 ${count} 件`}>
        {formatDependencyCount(count)}
      </span>
    </span>
  );
  const issueList = (issues: DependencyIssue[]) =>
    issues.length > 0 ? (
      <span className="dependency-issue-list">
        {issues.map((issue) => (
          <span key={issue.key} className={`dependency-issue ${issue.kind}`}>
            {issue.message}
          </span>
        ))}
      </span>
    ) : null;
  const issueClass = (issues: DependencyIssue[]) =>
    issues.some((issue) => issue.kind === "error")
      ? " has-error"
      : issues.some((issue) => issue.kind === "warning")
        ? " has-warning"
        : "";

  return (
    <section className="panel-section">
      <div className="section-header">
        <div>
          <h2>要素詳細</h2>
          {element ? (
            <p className="section-subtitle">
              {isDependencyJumpMode ? "親子要素ジャンプ中" : "iで折り畳み / jで親子ジャンプ"}
            </p>
          ) : null}
        </div>
        <div className="section-header-actions">
          {evaluationEngineLabel ? (
            <small
              className={`evaluation-engine-status ${isEvaluationStale ? "stale" : ""} ${
                isEvaluationFallback ? "fallback" : ""
              }`}
            >
              {evaluationEngineLabel}
            </small>
          ) : null}
          <button type="button" onClick={() => dispatchCommand("toggleElementInfoPanel")}>
            i
          </button>
        </div>
      </div>

      {!showElementInfoPanel ? (
        <p className="empty-state">折り畳み中です。</p>
      ) : !element ? (
        <p className="empty-state">要素を選択してください。</p>
      ) : (
        <>
          {infoRows.length > 0 ? (
            <dl className="element-info-grid">
              {infoRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="empty-state">未評価です。</p>
          )}

          {unassignedSelectedIssues.length > 0 ? (
            <div className="dependency-group">
              <h3 className="shortcut-group-title">この要素の問題</h3>
              <div className="dependency-list">
                <div className={`dependency-row dependency-row-with-issues${issueClass(unassignedSelectedIssues)}`}>
                  <span className="dependency-row-main">
                    {dependencyNameWithCount(element.name, selectedElementIssues.length)}
                    <small>{elementTypeLabels[element.type]}</small>
                  </span>
                  {issueList(unassignedSelectedIssues)}
                </div>
              </div>
            </div>
          ) : null}

          <div className="dependency-group">
            <h3 className="shortcut-group-title">親要素</h3>
            {dependencySummary && dependencySummary.parents.length > 0 ? (
              <div className="dependency-list">
                {dependencySummary.parents.map((parent, index) => {
                  const issues = parentIssues(parent.id);
                  return parent.element ? (
                    <button
                      key={`${parent.id}-${index}`}
                      type="button"
                      className={`${dependencyButtonClass(parent.element.id)}${
                        issues.length > 0 ? " dependency-row-with-issues" : ""
                      }${issueClass(issues)}`}
                      onClick={() => selectDependency(parent.element!.id)}
                    >
                      <span className="dependency-row-main">
                        {dependencyNameWithCount(parent.element.name, parent.ancestorCount)}
                        <small>{elementTypeLabels[parent.element.type]}</small>
                      </span>
                      {issueList(issues)}
                    </button>
                  ) : (
                    <div
                      key={`${parent.id}-${index}`}
                      className={`dependency-row unresolved${
                        issues.length > 0 ? " dependency-row-with-issues" : ""
                      }${issueClass(issues)}`}
                    >
                      <span className="dependency-row-main">
                        {dependencyNameWithCount(parent.id, parent.ancestorCount)}
                        <small>未解決</small>
                      </span>
                      {issueList(issues)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">親要素はありません。</p>
            )}
          </div>

          <div className="dependency-group">
            <h3 className="shortcut-group-title">子要素</h3>
            {dependencySummary && dependencySummary.children.length > 0 ? (
              <div className="dependency-list">
                {dependencySummary.children.map((child) => {
                  const issues = childIssues(child.element.id);
                  return (
                    <button
                      key={child.element.id}
                      type="button"
                      className={`${dependencyButtonClass(child.element.id)}${
                        issues.length > 0 ? " dependency-row-with-issues" : ""
                      }${issueClass(issues)}`}
                      onClick={() => selectDependency(child.element.id)}
                    >
                      <span className="dependency-row-main">
                        {dependencyNameWithCount(child.element.name, child.descendantCount)}
                        <small>{elementTypeLabels[child.element.type]}</small>
                      </span>
                      {issueList(issues)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="empty-state">子要素はありません。</p>
            )}
          </div>
        </>
      )}
    </section>
  );
};
