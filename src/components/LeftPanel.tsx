import { useState } from "react";
import type { DragEvent, MouseEvent, RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { getDependencyJumpTargets, getDependencySummary } from "../model/dependencies";
import {
  isPointElement,
  lineEndpointReferenceForAnchor,
  pointAnchorForElement,
  referenceAnchor,
  selectablePointsForElement
} from "../model/pointAnchors";
import { lineMeasurementLabel } from "../geometry/numericExpressions";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { getParameterValue, supportsNumericVariables } from "../parameters/parameterAccess";
import { useCadStore } from "../state/useCadStore";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ElementId,
  EvaluationResult,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";
import {
  arcLineInfoRows,
  bezierCurveInfoRows,
  lineInfoRows,
  numericReferenceExpression,
  numericReferenceProperties,
  numericReferenceValue,
  offsetLineInfoRows,
  pointCoordinateRows
} from "./geometryDisplay";
import {
  BooleanParameterEditor,
  ChoiceParameterEditor,
  LineEndpointReferenceEditor,
  LineReferenceListEditor,
  NumericParameterEditor,
  ParameterName,
  PointAnchorParameterEditor
} from "./ParameterEditors";

type LeftPanelProps = {
  evaluation: EvaluationResult;
  elementListFocusRef: RefObject<HTMLDivElement | null>;
};

type RightPanelProps = {
  evaluation: EvaluationResult;
  isParameterEditMode: boolean;
  isDependencyJumpMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
};

type NumericReferenceGeometry = ComputedLine | ComputedArcLine | ComputedBezierCurve | ComputedOffsetLine;

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

const isLineLikeElement = (element: CadElement) =>
  element.type === "line" ||
  element.type === "arcLine" ||
  element.type === "threePointArcLine" ||
  element.type === "bezierCurve" ||
  element.type === "offsetLine";

const formatDependencyCount = (count: number) => (count > 99 ? "99+" : `${count}`);

type ElementStatusIconKind = "visible" | "hidden" | "enabled" | "disabled";

const ElementStatusIcon = ({ kind }: { kind: ElementStatusIconKind }) => {
  return (
    <svg
      className={`element-status-icon element-status-icon-${kind}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "visible" ? (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.7" />
        </>
      ) : kind === "hidden" ? (
        <>
          <path d="M3.5 3.5l17 17" />
          <path d="M10.7 6.2A10.1 10.1 0 0 1 12 6c6 0 9.5 6 9.5 6a15.1 15.1 0 0 1-2.3 2.9" />
          <path d="M14.1 14.1A2.7 2.7 0 0 1 9.9 9.9" />
          <path d="M6.4 6.9C3.9 8.6 2.5 12 2.5 12s3.5 6 9.5 6a9.9 9.9 0 0 0 4.1-.9" />
        </>
      ) : kind === "enabled" ? (
        <path d="M5 12.5l4.2 4.2L19 6.8" />
      ) : (
        <>
          <path d="M9 6v12" />
          <path d="M15 6v12" />
        </>
      )}
    </svg>
  );
};

type ElementDropTarget = {
  elementId: ElementId;
  insertionIndex: number;
};

const ElementEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: {
  element: CadElement;
  elements: CadElement[];
  isParameterEditMode: boolean;
  registerParameterControl: (key: string, element: HTMLElement | null) => void;
}) => {
  const updateElement = useCadStore((state) => state.updateElement);
  const renameElement = useCadStore((state) => state.renameElement);
  const selectedParameterKey = useCadStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadStore((state) => state.setSelectedParameterKey);

  const commitName = (name: string) => renameElement(element.id, name);
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);
  const commonEditorProps = { element, elements, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
    compact?: boolean;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} />;
  const pointAnchorEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    anchor: PointAnchor;
    allowCoordinate?: boolean;
  }) => <PointAnchorParameterEditor {...commonEditorProps} {...props} />;
  const lineEndpointEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    endpoint: LineEndpointReference;
  }) => <LineEndpointReferenceEditor {...commonEditorProps} {...props} />;

  return (
    <section className="panel-section">
      <div className="section-header">
        <div>
          <h2>要素設定</h2>
          <p className="section-subtitle">
            {element.name} ・ {elementTypeLabels[element.type]}
          </p>
        </div>
        <span className={`mode-pill ${isParameterEditMode ? "active" : ""}`}>
          {isParameterEditMode ? "要素設定中" : "eで要素設定"}
        </span>
      </div>
      <div className="editor-grid">
        <label className={parameterFieldClass("name")} onClick={() => selectParameter("name")}>
          <ParameterName element={element} parameterKey="name" label="名前" />
          <input
            key={`${element.id}-${element.name}`}
            ref={(node) => registerParameterControl("name", node)}
            defaultValue={element.name}
            onFocus={() => setSelectedParameterKey("name")}
            onBlur={(event) => commitName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitName(event.currentTarget.value);
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.currentTarget.value = element.name;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <BooleanParameterEditor
          {...elementEditorProps}
          parameterKey="visible"
          label="表示する"
          checked={element.visible}
        />
        <BooleanParameterEditor
          {...elementEditorProps}
          parameterKey="enabled"
          label="評価する"
          checked={element.enabled}
        />

        {supportsNumericVariables(element) && (
          <div className="curve-point-editor">
            <div className="curve-point-header">
              <span>共通変数</span>
              <button
                type="button"
                onClick={() => dispatchCommand("addNumericVariable")}
              >
                追加
              </button>
            </div>
            {(element.numericVariables ?? []).length === 0 ? (
              <p className="empty-state">共通変数はありません。</p>
            ) : (
              (element.numericVariables ?? []).map((variable, index) => (
                <div className="curve-point-group" key={variable.id}>
                  <div className="curve-point-header">
                    <span>変数{index + 1}</span>
                    <button
                      type="button"
                      onClick={() =>
                        dispatchCommand("deleteNumericVariable", {
                          variableId: variable.id
                        })
                      }
                    >
                      削除
                    </button>
                  </div>
                  <label className="parameter-field">
                    <span className="parameter-name">名前 (@名前で参照)</span>
                    <input
                      type="text"
                      aria-label="共通変数名"
                      value={variable.name}
                      onChange={(event) =>
                        updateElement(element.id, {
                          numericVariables: (element.numericVariables ?? []).map((item) =>
                            item.id === variable.id ? { ...item, name: event.target.value } : item
                          )
                        } as Partial<CadElement>)
                      }
                    />
                  </label>
                  {numericInput({
                    parameterKey: `variable:${variable.id}:value`,
                    label: variable.name,
                    value: variable.value,
                    ariaLabel: `共通変数 ${variable.name}`
                  })}
                </div>
              ))
            )}
          </div>
        )}

        {element.type === "freePoint" && (
          <>
            {numericInput({
              parameterKey: "x",
              label: "x",
              value: element.x,
              ariaLabel: "x 値"
            })}
            {numericInput({
              parameterKey: "y",
              label: "y",
              value: element.y,
              ariaLabel: "y 値"
            })}
          </>
        )}

        {element.type === "offsetPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "fromPoint",
              label: "基準点",
              anchor: pointAnchorForElement(element) ?? referenceAnchor(""),
              allowCoordinate: false
            })}
            {numericInput({
              parameterKey: "dx",
              label: "dx",
              value: element.dx,
              ariaLabel: "dx 値"
            })}
            {numericInput({
              parameterKey: "dy",
              label: "dy",
              value: element.dy,
              ariaLabel: "dy 値"
            })}
          </>
        )}

        {element.type === "polarOffsetPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "fromPoint",
              label: "基準点",
              anchor: pointAnchorForElement(element) ?? referenceAnchor(""),
              allowCoordinate: false
            })}
            {numericInput({
              parameterKey: "angleDeg",
              label: "角度",
              value: element.angleDeg,
              ariaLabel: "角度"
            })}
            {numericInput({
              parameterKey: "distance",
              label: "距離",
              value: element.distance,
              ariaLabel: "距離"
            })}
          </>
        )}

        {element.type === "divisionPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "startPoint",
              label: "始点",
              anchor: element.startPoint,
              allowCoordinate: false
            })}
            {pointAnchorEditor({
              parameterKey: "endPoint",
              label: "終点",
              anchor: element.endPoint,
              allowCoordinate: false
            })}
            <ChoiceParameterEditor
              {...elementEditorProps}
              parameterKey="placementMode"
              label="方式"
              value={element.placementMode}
              options={["distance", "ratio"]}
              optionLabels={{ distance: "距離", ratio: "割合" }}
              ariaLabel="分点方式"
            />
            {element.placementMode === "distance"
              ? numericInput({
                  parameterKey: "distance",
                  label: "距離",
                  value: element.distance,
                  ariaLabel: "距離"
                })
              : numericInput({
                  parameterKey: "ratio",
                  label: "割合",
                  value: element.ratio,
                  ariaLabel: "割合"
                })}
          </>
        )}

        {element.type === "lineDivisionPoint" && (
          <>
            {lineEndpointEditor({
              parameterKey: "endpoint",
              label: "端点",
              endpoint: element.endpoint
            })}
            <ChoiceParameterEditor
              {...elementEditorProps}
              parameterKey="placementMode"
              label="方式"
              value={element.placementMode}
              options={["distance", "ratio"]}
              optionLabels={{ distance: "距離", ratio: "割合" }}
              ariaLabel="線上分点方式"
            />
            {element.placementMode === "distance"
              ? numericInput({
                  parameterKey: "distance",
                  label: "距離",
                  value: element.distance,
                  ariaLabel: "距離"
                })
              : numericInput({
                  parameterKey: "ratio",
                  label: "割合",
                  value: element.ratio,
                  ariaLabel: "割合"
                })}
          </>
        )}

        {element.type === "line" && (
          <>
            {pointAnchorEditor({
              parameterKey: "startPoint",
              label: "始点",
              anchor: element.startPoint
            })}
            {pointAnchorEditor({
              parameterKey: "endPoint",
              label: "終点",
              anchor: element.endPoint
            })}
          </>
        )}

        {element.type === "arcLine" && (
          <>
            {pointAnchorEditor({
              parameterKey: "centerPoint",
              label: "中心点",
              anchor: element.centerPoint
            })}
            {numericInput({
              parameterKey: "radius",
              label: "半径",
              value: element.radius,
              ariaLabel: "半径"
            })}
            {numericInput({
              parameterKey: "startAngleDeg",
              label: "始角度",
              value: element.startAngleDeg,
              ariaLabel: "始角度"
            })}
            {numericInput({
              parameterKey: "endAngleDeg",
              label: "終角度",
              value: element.endAngleDeg,
              ariaLabel: "終角度"
            })}
          </>
        )}

        {element.type === "threePointArcLine" && (
          <>
            {pointAnchorEditor({
              parameterKey: "point1",
              label: "点1",
              anchor: element.point1
            })}
            {pointAnchorEditor({
              parameterKey: "point2",
              label: "点2",
              anchor: element.point2
            })}
            {pointAnchorEditor({
              parameterKey: "point3",
              label: "点3",
              anchor: element.point3
            })}
            {numericInput({
              parameterKey: "startAngleDeg",
              label: "始角度",
              value: element.startAngleDeg,
              ariaLabel: "始角度"
            })}
            {numericInput({
              parameterKey: "endAngleDeg",
              label: "終角度",
              value: element.endAngleDeg,
              ariaLabel: "終角度"
            })}
          </>
        )}

        {element.type === "bezierCurve" && (
          <>
            {pointAnchorEditor({
              parameterKey: "startPoint",
              label: "始点",
              anchor: element.startPoint
            })}
            {numericInput({
              parameterKey: "startHandleAngleDeg",
              label: "始点角度",
              value: element.startHandleAngleDeg,
              ariaLabel: "始点角度"
            })}
            {numericInput({
              parameterKey: "startHandleLength",
              label: "始点ハンドル長",
              value: element.startHandleLength,
              ariaLabel: "始点ハンドル長"
            })}

            <div className="curve-point-editor">
              <div className="curve-point-header">
                <span>中間点</span>
                <button
                  type="button"
                  onClick={() => dispatchCommand("addBezierIntermediatePoint")}
                >
                  追加
                </button>
              </div>
              {element.intermediatePoints.length === 0 ? (
                <p className="empty-state">中間点はありません。</p>
              ) : (
                element.intermediatePoints.map((point, index) => (
                  <div className="curve-point-group" key={point.id}>
                    <div className="curve-point-header">
                      <span>中間点{index + 1}</span>
                      <button
                        type="button"
                        onClick={() =>
                          dispatchCommand("deleteBezierIntermediatePoint", {
                            intermediatePointId: point.id
                          })
                        }
                      >
                        削除
                      </button>
                    </div>
                    {pointAnchorEditor({
                      parameterKey: `intermediate:${point.id}:point`,
                      label: "点",
                      anchor: point.point
                    })}
                    {numericInput({
                      parameterKey: `intermediate:${point.id}:handleAngleDeg`,
                      label: "角度",
                      value: point.handleAngleDeg,
                      ariaLabel: `中間点${index + 1}角度`
                    })}
                    {numericInput({
                      parameterKey: `intermediate:${point.id}:incomingHandleLength`,
                      label: "前長さ",
                      value: point.incomingHandleLength,
                      ariaLabel: `中間点${index + 1}前長さ`
                    })}
                    {numericInput({
                      parameterKey: `intermediate:${point.id}:outgoingHandleLength`,
                      label: "後長さ",
                      value: point.outgoingHandleLength,
                      ariaLabel: `中間点${index + 1}後長さ`
                    })}
                  </div>
                ))
              )}
            </div>

            {pointAnchorEditor({
              parameterKey: "endPoint",
              label: "終点",
              anchor: element.endPoint
            })}
            {numericInput({
              parameterKey: "endHandleAngleDeg",
              label: "終点角度",
              value: element.endHandleAngleDeg,
              ariaLabel: "終点角度"
            })}
            {numericInput({
              parameterKey: "endHandleLength",
              label: "終点ハンドル長",
              value: element.endHandleLength,
              ariaLabel: "終点ハンドル長"
            })}
          </>
        )}

        {element.type === "offsetLine" && (
          <>
            <LineReferenceListEditor
              {...commonEditorProps}
              parameterKey="baseLineIds"
              label="基準線"
              lineIds={element.baseLineIds}
              emptyLabel="基準線はありません。"
            />
            {numericInput({
              parameterKey: "offset",
              label: "オフセット量",
              value: element.offset,
              ariaLabel: "オフセット量"
            })}
            <ChoiceParameterEditor
              {...elementEditorProps}
              parameterKey="side"
              label="位置"
              value={element.side}
              options={["right", "left"]}
              optionLabels={{ right: "右", left: "左" }}
              ariaLabel="オフセット位置"
            />
            <BooleanParameterEditor
              {...elementEditorProps}
              parameterKey="closed"
              label="閉じる"
              checked={element.closed}
            />
          </>
        )}
      </div>
    </section>
  );
};

const ElementInfoPanel = ({
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
  const showElementInfoPanel = useCadStore((state) => state.showElementInfoPanel);
  const geometry = element ? evaluation.computedGeometry.get(element.id) : undefined;
  const dependencySummary = element ? getDependencySummary(element, elements) : null;
  const jumpTargets = getDependencyJumpTargets(element, elements);
  const jumpTargetIndexes = new Map(jumpTargets.map((target, index) => [target.id, index]));
  const infoRows =
    isComputedPoint(geometry)
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

export const LeftPanel = ({
  evaluation,
  elementListFocusRef
}: LeftPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedElementIds = useCadStore((state) => state.selectedElementIds);
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const activeNumericReferencePickTarget = useCadStore((state) => state.activeNumericReferencePickTarget);
  const activeLinePickTarget = useCadStore((state) => state.activeLinePickTarget);
  const [draggedElementIds, setDraggedElementIds] = useState<ElementId[]>([]);
  const [dropTarget, setDropTarget] = useState<ElementDropTarget | null>(null);
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));
  const selectedElementIdSet = new Set(selectedElementIds);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const activePointPickTargetElement = activePointPickTarget
    ? elements.find((element) => element.id === activePointPickTarget.elementId)
    : null;
  const activePointPickTargetDefinition = activePointPickTargetElement && activePointPickTarget
    ? getParameterDefinitions(activePointPickTargetElement).find(
        (definition) => definition.key === activePointPickTarget.parameterKey
      )
    : null;
  const isLineEndpointPointPick =
    activePointPickTargetDefinition?.kind === "lineEndpointReference";
  const activeLinePickTargetElement = activeLinePickTarget
    ? elements.find((element) => element.id === activeLinePickTarget.elementId)
    : null;
  const activeLinePickParameterValue =
    activeLinePickTargetElement && activeLinePickTarget
      ? getParameterValue(activeLinePickTargetElement, activeLinePickTarget.parameterKey)
      : null;
  const activeLinePickSelectedLineIds = new Set<ElementId>(
    Array.isArray(activeLinePickParameterValue)
      ? (activeLinePickParameterValue as unknown[]).filter(
          (id): id is ElementId => typeof id === "string"
        )
      : []
  );
  const clearElementDrag = () => {
    setDraggedElementIds([]);
    setDropTarget(null);
  };
  const isNoopDrop = (elementIds: ElementId[], insertionIndex: number) => {
    const indexes = elements
      .map((element, index) => (elementIds.includes(element.id) ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length === 0) return true;
    const minIndex = indexes[0];
    const maxIndex = indexes[indexes.length - 1];
    return insertionIndex >= minIndex && insertionIndex <= maxIndex + 1;
  };
  const dragElementIds = (event: DragEvent<HTMLElement>) => {
    if (draggedElementIds.length > 0) return draggedElementIds;
    const ids = event.dataTransfer.getData("application/x-nuinui-element-ids");
    if (ids) return ids.split(",").filter(Boolean);
    const id = event.dataTransfer.getData("application/x-nuinui-element-id");
    return id ? [id] : [];
  };
  const rowInsertionIndex = (event: DragEvent<HTMLElement>, rowIndex: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const isAfter = event.clientY >= rect.top + rect.height / 2;
    return rowIndex + (isAfter ? 1 : 0);
  };
  const updateDropTarget = (event: DragEvent<HTMLElement>, element: CadElement, rowIndex: number) => {
    const elementIds = dragElementIds(event);
    if (elementIds.length === 0 || elementIds.includes(element.id)) {
      setDropTarget(null);
      return;
    }

    const insertionIndex = rowInsertionIndex(event, rowIndex);
    if (isNoopDrop(elementIds, insertionIndex)) {
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ elementId: element.id, insertionIndex });
  };
  const dropMarkerClass = (elementId: ElementId, insertionIndex: number, position: "before" | "after") =>
    dropTarget?.elementId === elementId && dropTarget.insertionIndex === insertionIndex
      ? ` drop-${position}`
      : "";
  const selectElement = (elementId: ElementId, event: MouseEvent<HTMLElement>) => {
    if (activeLinePickTarget) {
      const element = elements.find((item) => item.id === elementId);
      if (
        element &&
        isLineLikeElement(element) &&
        element.id !== activeLinePickTarget.elementId &&
        !activeLinePickSelectedLineIds.has(element.id)
      ) {
        dispatchCommand("applyPickedLine", { pickedLineId: element.id });
      }
      return;
    }
    if (activePointPickTarget) {
      const element = elements.find((item) => item.id === elementId);
      if (!isLineEndpointPointPick && element && isPointElement(element)) {
        dispatchCommand("applyPickedPoint", { pickedPointAnchor: referenceAnchor(element.id) });
      }
      return;
    }
    if (activeNumericReferencePickTarget) {
      return;
    }
    dispatchCommand("selectElement", {
      elementId,
      selectionMode: event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    });
  };
  const numericReferenceGeometry = (elementId: ElementId) => {
    const geometry = evaluation.computedGeometry.get(elementId);
    return isComputedLine(geometry) ||
      isComputedArcLine(geometry) ||
      isComputedBezierCurve(geometry) ||
      isComputedOffsetLine(geometry)
      ? geometry
      : null;
  };
  const applyNumericReference = (
    geometry: NumericReferenceGeometry,
    property: ReturnType<typeof numericReferenceProperties>[number]
  ) => {
    dispatchCommand("applyPickedNumericReference", {
      numericReferenceExpression: numericReferenceExpression(geometry, property)
    });
  };

  return (
    <aside className="left-panel">
      <header className="app-title">
        <h1>nuinuiCAD</h1>
      </header>

      <section className="panel-section element-list-section">
        <div className="section-header">
          <div>
            <h2>構成リスト</h2>
            <p className={`section-subtitle ${
              activePointPickTarget || activeNumericReferencePickTarget || activeLinePickTarget
                ? "point-pick-list-subtitle"
                : ""
            }`}>
              {activePointPickTarget
                ? "点選択中: 点の行だけ選択できます"
                : activeNumericReferencePickTarget
                  ? "数値選択中: 線と曲線の行だけ選択できます"
                  : activeLinePickTarget
                    ? "線選択中: 線と曲線の行だけ選択できます"
                : "gで戻る / Enterで要素設定"}
            </p>
          </div>
        </div>

        <div
          className="element-list"
          ref={elementListFocusRef}
          tabIndex={-1}
          data-element-list="true"
          aria-label="要素リスト"
        >
          {elements.map((element, index) => {
            const rawSelectablePoints = selectablePointsForElement(
              element,
              evaluation.computedGeometry,
              elementsById
            );
            const selectablePoints = isLineEndpointPointPick
              ? rawSelectablePoints.filter((point) =>
                  lineEndpointReferenceForAnchor(point.anchor, elements)
                )
              : rawSelectablePoints;
            const isPointPickCandidate =
              activePointPickTarget &&
              ((!isLineEndpointPointPick && isPointElement(element)) || selectablePoints.length > 0);
            const referenceGeometry = numericReferenceGeometry(element.id);
            const isNumericReferenceCandidate =
              Boolean(activeNumericReferencePickTarget) && referenceGeometry !== null;
            const isLinePickCandidate =
              Boolean(activeLinePickTarget) &&
              isLineLikeElement(element) &&
              element.id !== activeLinePickTarget?.elementId &&
              !activeLinePickSelectedLineIds.has(element.id);
            return (
            <div
              key={element.id}
              tabIndex={0}
              data-element-list-row="true"
              className={`element-row ${selectedElementIdSet.has(element.id) ? "selected" : ""} ${
                element.id === selectedElementId ? "primary-selected" : ""
              } ${!element.visible ? "is-hidden" : ""} ${
                !element.enabled ? "is-disabled" : ""
              } ${
                errorElementIds.has(element.id) ? "has-error" : ""
              } ${activePointPickTarget ? "is-point-pick-mode" : ""} ${
                isPointPickCandidate ? "is-point-pick-candidate" : ""
              } ${
                activePointPickTarget && !isPointPickCandidate ? "is-not-point-pick-candidate" : ""
              } ${activeNumericReferencePickTarget ? "is-numeric-reference-pick-mode" : ""} ${
                isNumericReferenceCandidate ? "is-numeric-reference-pick-candidate" : ""
              } ${
                activeNumericReferencePickTarget && !isNumericReferenceCandidate
                  ? "is-not-numeric-reference-pick-candidate"
                  : ""
              } ${activeLinePickTarget ? "is-line-pick-mode" : ""} ${
                isLinePickCandidate ? "is-line-pick-candidate" : ""
              } ${
                activeLinePickTarget && !isLinePickCandidate
                  ? "is-not-line-pick-candidate"
                  : ""
              } ${
                draggedElementIds.includes(element.id) ? "dragging" : ""}${dropMarkerClass(
                element.id,
                index,
                "before"
              )}${dropMarkerClass(element.id, index + 1, "after")}`}
              aria-label={`${index + 1}. ${element.name}, ${elementTypeLabels[element.type]}, ${
                element.visible ? "表示" : "非表示"
              }, ${element.enabled ? "評価する" : "評価しない"}`}
              onClick={(event) => selectElement(element.id, event)}
              onDragOver={(event) => updateDropTarget(event, element, index)}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTarget(null);
                }
              }}
              onDrop={(event) => {
                const elementIds = dragElementIds(event);
                const insertionIndex =
                  dropTarget?.elementId === element.id
                    ? dropTarget.insertionIndex
                    : rowInsertionIndex(event, index);
                event.preventDefault();
                if (elementIds.length > 0 && !isNoopDrop(elementIds, insertionIndex)) {
                  dispatchCommand("moveElementToInsertionIndex", {
                    elementId: elementIds[0],
                    insertionIndex
                  });
                }
                clearElementDrag();
              }}
            >
              <span className="element-index">{index + 1}</span>
              <span
                className="element-status-icons"
                data-visible-state={element.visible ? "visible" : "hidden"}
                data-evaluation-state={element.enabled ? "enabled" : "disabled"}
              >
                <button
                  type="button"
                  className="element-status-button"
                  aria-label={`${element.name}を${element.visible ? "非表示" : "表示"}にする`}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand("toggleElementVisibility", { elementId: element.id });
                  }}
                >
                  <ElementStatusIcon kind={element.visible ? "visible" : "hidden"} />
                </button>
                <button
                  type="button"
                  className="element-status-button"
                  aria-label={`${element.name}を${element.enabled ? "評価しない" : "評価する"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatchCommand("toggleElementEnabled", { elementId: element.id });
                  }}
                >
                  <ElementStatusIcon kind={element.enabled ? "enabled" : "disabled"} />
                </button>
              </span>
              <span className="element-name">
                {errorElementIds.has(element.id) ? "⚠ " : ""}
                {element.name}
              </span>
              <span className="element-type">{elementTypeLabels[element.type]}</span>
              <button
                type="button"
                className="element-drag-handle"
                draggable
                aria-label={`${element.name}を並び替え`}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchCommand("selectElement", { elementId: element.id });
                }}
                onDragStart={(event) => {
                  const movingIds = selectedElementIdSet.has(element.id) ? selectedElementIds : [element.id];
                  if (!selectedElementIdSet.has(element.id)) {
                    dispatchCommand("selectElement", { elementId: element.id });
                  }
                  setDraggedElementIds(movingIds);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-nuinui-element-id", element.id);
                  event.dataTransfer.setData("application/x-nuinui-element-ids", movingIds.join(","));
                  event.dataTransfer.setData("text/plain", element.name);
                }}
                onDragEnd={clearElementDrag}
              >
                <span aria-hidden="true">::</span>
              </button>
              {activePointPickTarget && selectablePoints.length > 0 ? (
                <div className="element-point-pick-actions">
                  {selectablePoints.map((point) => (
                    <button
                      key={`${point.anchor.mode}-${point.label}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatchCommand("applyPickedPoint", {
                          pickedPointAnchor: point.anchor
                        });
                      }}
                    >
                      {point.label.includes(".") ? point.label.split(".").at(-1) : "点"}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeNumericReferencePickTarget && referenceGeometry ? (
                <div className="element-numeric-reference-actions">
                  {numericReferenceProperties(referenceGeometry).map((property) => (
                    <button
                      key={property}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        applyNumericReference(referenceGeometry, property);
                      }}
                    >
                      <span>{lineMeasurementLabel(property)}</span>
                      <small>{numericReferenceValue(referenceGeometry, property)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
          })}
        </div>

        <div className="button-row reorder-row">
          <button type="button" onClick={() => dispatchCommand("moveSelectedElementUp")}>
            上へ
          </button>
          <button type="button" onClick={() => dispatchCommand("moveSelectedElementDown")}>
            下へ
          </button>
          <button type="button" onClick={() => dispatchCommand("toggleSelectedElementVisibility")}>
            表示切替
          </button>
          <button type="button" onClick={() => dispatchCommand("toggleSelectedElementEnabled")}>
            評価切替
          </button>
          <button type="button" onClick={() => dispatchCommand("deleteSelectedElement")}>
            削除
          </button>
        </div>
      </section>
    </aside>
  );
};

export const RightPanel = ({
  evaluation,
  isParameterEditMode,
  isDependencyJumpMode,
  registerParameterControl
}: RightPanelProps) => {
  const elements = useCadStore((state) => state.elements);
  const selectedElementId = useCadStore((state) => state.selectedElementId);
  const selectedDependencyJumpIndex = useCadStore((state) => state.selectedDependencyJumpIndex);
  const setSelectedElementId = useCadStore((state) => state.setSelectedElementId);
  const selectedElement = elements.find((element) => element.id === selectedElementId) ?? null;
  const shortcutHint = isParameterEditMode || isDependencyJumpMode
    ? "Esc で終了 / ? でショートカット"
    : "? でショートカット";

  return (
    <aside className="right-panel">
      {selectedElement ? (
        <ElementEditor
          element={selectedElement}
          elements={elements}
          isParameterEditMode={isParameterEditMode}
          registerParameterControl={registerParameterControl}
        />
      ) : (
        <section className="panel-section">
          <div className="section-header">
            <h2>要素設定</h2>
          </div>
          <p className="empty-state">要素を選択してください。</p>
        </section>
      )}

      <ElementInfoPanel
        element={selectedElement}
        elements={elements}
        evaluation={evaluation}
        isDependencyJumpMode={isDependencyJumpMode}
        selectedDependencyJumpIndex={selectedDependencyJumpIndex}
        setSelectedElementId={setSelectedElementId}
      />

      <section className="panel-section">
        <div className="section-header">
          <h2>バリデーション</h2>
        </div>
        {evaluation.errors.length === 0 ? (
          <p className="empty-state">エラーはありません。</p>
        ) : (
          <ul className="error-list">
            {evaluation.errors.map((error) => (
              <li key={`${error.elementId}-${error.missingDependencyId}`}>
                <strong>{error.elementName}</strong>
                <span>{error.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <div className="section-header">
          <h2>ショートカット</h2>
          <button
            type="button"
            aria-label="ショートカット一覧を表示"
            onClick={() => dispatchCommand("toggleShortcutHelp")}
          >
            ?
          </button>
        </div>
        <p className="empty-state">{shortcutHint}</p>
      </section>

    </aside>
  );
};
