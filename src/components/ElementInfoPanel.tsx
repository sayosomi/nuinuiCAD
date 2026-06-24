import { dispatchCommand } from "../commands/commands";
import { getDependencyJumpTargets, getDependencySummary } from "../model/dependencies";
import { useCadUiStore } from "../state/cadUiStore";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId,
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

export const ElementInfoPanel = ({
  element,
  elements,
  evaluation,
  isDependencyJumpMode,
  selectedDependencyJumpIndex,
  setSelectedElementId
}: {
  element: CadElement | null;
  elements: CadElement[];
  evaluation: EvaluationResult;
  isDependencyJumpMode: boolean;
  selectedDependencyJumpIndex: number;
  setSelectedElementId: (id: ElementId | null) => void;
}) => {
  const showElementInfoPanel = useCadUiStore((state) => state.showElementInfoPanel);
  const geometry = element ? evaluation.computedGeometry.get(element.id) : undefined;
  const variable = element ? evaluation.computedVariables.get(element.id) : undefined;
  const dependencySummary = element ? getDependencySummary(element, elements) : null;
  const jumpTargets = getDependencyJumpTargets(element, elements);
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
  const dependencyNameWithCount = (name: string, count: number) => (
    <span className="dependency-primary">
      <span className="dependency-name">{name}</span>
      <span className="dependency-count-badge" aria-label={`関連要素 ${count} 件`}>
        {formatDependencyCount(count)}
      </span>
    </span>
  );

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
        <button type="button" onClick={() => dispatchCommand("toggleElementInfoPanel")}>
          i
        </button>
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

          <div className="dependency-group">
            <h3 className="shortcut-group-title">親要素</h3>
            {dependencySummary && dependencySummary.parents.length > 0 ? (
              <div className="dependency-list">
                {dependencySummary.parents.map((parent, index) =>
                  parent.element ? (
                    <button
                      key={`${parent.id}-${index}`}
                      type="button"
                      className={dependencyButtonClass(parent.element.id)}
                      onClick={() => selectDependency(parent.element!.id)}
                    >
                      {dependencyNameWithCount(parent.element.name, parent.ancestorCount)}
                      <small>{elementTypeLabels[parent.element.type]}</small>
                    </button>
                  ) : (
                    <div key={`${parent.id}-${index}`} className="dependency-row unresolved">
                      {dependencyNameWithCount(parent.id, parent.ancestorCount)}
                      <small>未解決</small>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="empty-state">親要素はありません。</p>
            )}
          </div>

          <div className="dependency-group">
            <h3 className="shortcut-group-title">子要素</h3>
            {dependencySummary && dependencySummary.children.length > 0 ? (
              <div className="dependency-list">
                {dependencySummary.children.map((child) => (
                  <button
                    key={child.element.id}
                    type="button"
                    className={dependencyButtonClass(child.element.id)}
                    onClick={() => selectDependency(child.element.id)}
                  >
                    {dependencyNameWithCount(child.element.name, child.descendantCount)}
                    <small>{elementTypeLabels[child.element.type]}</small>
                  </button>
                ))}
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
