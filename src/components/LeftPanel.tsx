import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, RefObject } from "react";
import { dispatchCommand } from "../commands/commands";
import { getDependencyJumpTargets, getDependencySummary } from "../model/dependencies";
import {
  formatNumericExpressionForDisplay,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import { numericDragStepsForDelta } from "./numericDrag";
import {
  defaultNumericParameterStep,
  getNumericParameterStep,
  getParameterDefinitions
} from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadStore } from "../state/useCadStore";
import type {
  CadElement,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedPoint,
  ElementId,
  EvaluationResult,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import { elementTypeLabels } from "../types/geometry";

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

const isComputedPoint = (geometry: ComputedGeometry | undefined): geometry is ComputedPoint =>
  geometry?.kind === "point";

const isComputedLine = (geometry: ComputedGeometry | undefined): geometry is ComputedLine =>
  geometry?.kind === "line";

const isComputedBezierCurve = (
  geometry: ComputedGeometry | undefined
): geometry is ComputedBezierCurve => geometry?.kind === "bezierCurve";

const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.?0+$/, "");

const formatMillimeters = (value: number) => `${formatNumber(value)} mm`;

const formatCoordinate = (point: ComputedPoint) => `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;

const formatDependencyCount = (count: number) => (count > 99 ? "99+" : `${count}`);

const normalizeDegrees = (degrees: number) => (degrees + 360) % 360;

const formatAngleDeg = (degrees: number | null) =>
  degrees === null ? "未定義" : `${formatNumber(normalizeDegrees(degrees))}°`;

const pointCoordinateRows = (point: ComputedPoint) => [
  { label: "座標", value: formatCoordinate(point) }
];

const lineInfoRows = (line: ComputedLine) => {
  return [
    { label: "始点", value: formatCoordinate(line.start) },
    { label: "終点", value: formatCoordinate(line.end) },
    { label: "始角度", value: formatAngleDeg(line.startAngleDeg) },
    { label: "終角度", value: formatAngleDeg(line.endAngleDeg) },
    { label: "長さ", value: formatMillimeters(line.length) }
  ];
};

const bezierCurveInfoRows = (curve: ComputedBezierCurve) => [
  { label: "区間数", value: `${curve.segments.length}` },
  { label: "長さ", value: formatMillimeters(curve.length) }
];

const isPointElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint";

const referenceAnchor = (pointId: ElementId): PointAnchor => ({ mode: "reference", pointId });

const coordinateAnchor = (x: NumericValue = 0, y: NumericValue = 0): PointAnchor => ({
  mode: "coordinate",
  x,
  y
});

const anchorPointId = (anchor: PointAnchor) => (anchor.mode === "reference" ? anchor.pointId : "");

const pointName = (elements: CadElement[], pointId: ElementId) =>
  elements.find((element) => element.id === pointId)?.name ?? pointId;

const supportsNumericVariables = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint" ||
  element.type === "line" ||
  element.type === "bezierCurve";

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

const ParameterName = ({
  element,
  parameterKey,
  label
}: {
  element: CadElement;
  parameterKey: ParameterKey;
  label: string;
}) => {
  const definition = getParameterDefinitions(element).find((parameter) => parameter.key === parameterKey);
  return (
    <span className="parameter-name">
      <kbd>{definition?.directKey}</kbd>
      {label}
    </span>
  );
};

type NumericDragState = {
  parameterKey: ParameterKey;
  pointerId: number;
  previousClientX: number;
  remainderX: number;
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
  const numericDragRef = useRef<NumericDragState | null>(null);
  const updateElement = useCadStore((state) => state.updateElement);
  const renameElement = useCadStore((state) => state.renameElement);
  const selectedParameterKey = useCadStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadStore((state) => state.setSelectedParameterKey);
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);

  const commitName = (name: string) => renameElement(element.id, name);
  const updateVisible = (visible: boolean) => updateElement(element.id, { visible });
  const updateEnabled = (enabled: boolean) => updateElement(element.id, { enabled });
  const parseIntermediateParameterKey = (key: string) => {
    const [, intermediatePointId, field] = key.split(":");
    if (!key.startsWith("intermediate:") || !intermediatePointId || !field) return null;
    return { intermediatePointId, field };
  };
  const parseVariableParameterKey = (key: string) => {
    const [, variableId, field] = key.split(":");
    if (!key.startsWith("variable:") || !variableId || field !== "value") return null;
    return { variableId };
  };
  const parseAnchorCoordinateParameterKey = (key: string) => {
    const parts = key.split(":");
    const axis = parts.at(-1);
    if (axis !== "x" && axis !== "y") return null;
    const anchorKey = parts.slice(0, -1).join(":");
    if (!anchorKey) return null;
    return { anchorKey, axis };
  };
  const getPointAnchor = (key: string): PointAnchor | null => {
    const parsed = parseIntermediateParameterKey(key);
    if (parsed && element.type === "bezierCurve" && parsed.field === "point") {
      return element.intermediatePoints.find((point) => point.id === parsed.intermediatePointId)?.point ?? null;
    }
    if ((key === "startPoint" || key === "endPoint") && (element.type === "line" || element.type === "bezierCurve")) {
      return element[key];
    }
    if (key === "fromPointId" && (element.type === "offsetPoint" || element.type === "polarOffsetPoint")) {
      return referenceAnchor(element.fromPointId);
    }
    return null;
  };
  const updateParameterValue = (field: ParameterKey, value: unknown) => {
    const anchorCoordinate = parseAnchorCoordinateParameterKey(field);
    if (anchorCoordinate) {
      const anchor = getPointAnchor(anchorCoordinate.anchorKey);
      if (!anchor || anchor.mode !== "coordinate") return;
      updateParameterValue(anchorCoordinate.anchorKey, {
        ...anchor,
        [anchorCoordinate.axis]: value as NumericValue
      });
      return;
    }
    const anchor = getPointAnchor(field);
    if (anchor) {
      const nextAnchor = typeof value === "string" ? referenceAnchor(value) : value as PointAnchor;
      const parsed = parseIntermediateParameterKey(field);
      if (parsed && element.type === "bezierCurve" && parsed.field === "point") {
        updateElement(element.id, {
          intermediatePoints: element.intermediatePoints.map((point) =>
            point.id === parsed.intermediatePointId ? { ...point, point: nextAnchor } : point
          )
        } as Partial<CadElement>);
        return;
      }
      if (field === "startPoint" && (element.type === "line" || element.type === "bezierCurve")) {
        updateElement(element.id, { startPoint: nextAnchor } as Partial<CadElement>);
        return;
      }
      if (field === "endPoint" && (element.type === "line" || element.type === "bezierCurve")) {
        updateElement(element.id, { endPoint: nextAnchor } as Partial<CadElement>);
        return;
      }
      if (field === "fromPointId" && nextAnchor.mode === "reference") {
        updateElement(element.id, { fromPointId: nextAnchor.pointId } as Partial<CadElement>);
        return;
      }
    }
    const variable = parseVariableParameterKey(field);
    if (variable) {
      updateElement(element.id, {
        numericVariables: (element.numericVariables ?? []).map((item) =>
          item.id === variable.variableId ? { ...item, value: value as NumericValue } : item
        )
      } as Partial<CadElement>);
      return;
    }
    const parsed = parseIntermediateParameterKey(field);
    if (parsed && element.type === "bezierCurve") {
      updateElement(element.id, {
        intermediatePoints: element.intermediatePoints.map((point) =>
          point.id === parsed.intermediatePointId ? { ...point, [parsed.field]: value } : point
        )
      } as Partial<CadElement>);
      return;
    }
    updateElement(element.id, { [field]: value } as Partial<CadElement>);
  };
  const updateField = (field: ParameterKey, value: string) => {
    updateParameterValue(
      field,
      makeNumericExpression(
        normalizeNumericExpressionInput(
          value,
          elements,
          element.numericVariables ?? []
        )
      )
    );
  };
  const updateStep = (field: ParameterKey, value: string) => {
    const nextStep = Number(value);
    updateElement(element.id, {
      numericParameterSteps: {
        ...element.numericParameterSteps,
        [field]: Number.isFinite(nextStep) && nextStep > 0 ? nextStep : defaultNumericParameterStep
      }
    } as Partial<CadElement>);
  };
  const parameterFieldClass = (key: ParameterKey) =>
    `parameter-field ${
      isParameterEditMode && selectedParameterKey === key ? "selected-parameter" : ""
    }`;
  const controlProps = (key: ParameterKey) => ({
    ref: (node: HTMLElement | null) => registerParameterControl(key, node),
    onFocus: () => setSelectedParameterKey(key),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.currentTarget.blur();
      }
    }
  });
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);
  const numericInput = ({
    parameterKey,
    label,
    value,
    ariaLabel
  }: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
  }) => (
    <label className={parameterFieldClass(parameterKey)} onClick={() => selectParameter(parameterKey)}>
      <ParameterName element={element} parameterKey={parameterKey} label={label} />
      <input
        {...controlProps(parameterKey)}
        {...numericDragProps(parameterKey)}
        aria-label={ariaLabel}
        type="text"
        inputMode="decimal"
        step="1"
        data-numeric-parameter-key={parameterKey}
        value={formatNumericExpressionForDisplay(
          value,
          elements,
          element.numericVariables ?? []
        )}
        onChange={(event) => updateField(parameterKey, event.target.value)}
      />
      <span className="parameter-step">
        増減単位
        <input
          type="number"
          min="0.1"
          step="0.1"
          value={formatNumber(getNumericParameterStep(element, parameterKey))}
          onFocus={() => selectParameter(parameterKey)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
          }}
          onChange={(event) => updateStep(parameterKey, event.target.value)}
        />
      </span>
    </label>
  );
  const pointAnchorEditor = ({
    parameterKey,
    label,
    anchor,
    allowCoordinate = true
  }: {
    parameterKey: ParameterKey;
    label: string;
    anchor: PointAnchor;
    allowCoordinate?: boolean;
  }) => {
    const isPickingThisPoint =
      activePointPickTarget?.elementId === element.id &&
      activePointPickTarget.parameterKey === parameterKey;

    return (
    <div className={`point-anchor-editor ${isPickingThisPoint ? "is-picking-point" : ""}`}>
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <div className="point-anchor-actions">
          <div className="point-anchor-mode" role="group" aria-label={`${label}の指定方法`}>
            <button
              type="button"
              className={anchor.mode === "reference" ? "active-toggle" : ""}
              onClick={() => {
                const fallbackPointId = anchorPointId(anchor) || elements.find(isPointElement)?.id || "";
                updateParameterValue(parameterKey, referenceAnchor(fallbackPointId));
                selectParameter(parameterKey);
              }}
            >
              既存点
            </button>
            {allowCoordinate ? (
              <button
                type="button"
                className={anchor.mode === "coordinate" ? "active-toggle" : ""}
                onClick={() => {
                  updateParameterValue(parameterKey, coordinateAnchor());
                  selectParameter(`${parameterKey}:x`);
                }}
              >
                座標
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={`point-pick-button ${isPickingThisPoint ? "active" : ""}`}
            onClick={() => {
              selectParameter(parameterKey);
              if (isPickingThisPoint) {
                dispatchCommand("cancelPointPick");
                return;
              }
              dispatchCommand("startPointPick");
            }}
          >
            {isPickingThisPoint ? "点選択中" : "点を選択"}
          </button>
        </div>
      </div>
      {isPickingThisPoint ? (
        <p className="point-pick-hint">canvas または構成リストから点を選択します。</p>
      ) : null}
      {anchor.mode === "reference" ? (
        <button
          type="button"
          className={`${parameterFieldClass(parameterKey)} point-anchor-reference`}
          onClick={() => selectParameter(parameterKey)}
        >
          <span className="reference-label">参照点</span>
          <span className="reference-value">{pointName(elements, anchor.pointId)}</span>
        </button>
      ) : (
        <div className="point-anchor-coordinate-grid">
          {numericInput({
            parameterKey: `${parameterKey}:x`,
            label: `${label} x`,
            value: anchor.x,
            ariaLabel: `${label} x`
          })}
          {numericInput({
            parameterKey: `${parameterKey}:y`,
            label: `${label} y`,
            value: anchor.y,
            ariaLabel: `${label} y`
          })}
        </div>
      )}
    </div>
    );
  };
  const finishNumericDrag = (event: PointerEvent<HTMLInputElement>) => {
    const drag = numericDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    numericDragRef.current = null;
  };
  const numericDragProps = (key: ParameterKey) => ({
    onPointerDown: (event: PointerEvent<HTMLInputElement>) => {
      if (event.button !== 1) return;

      event.preventDefault();
      event.stopPropagation();
      selectParameter(key);
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      numericDragRef.current = {
        parameterKey: key,
        pointerId: event.pointerId,
        previousClientX: event.clientX,
        remainderX: 0
      };
    },
    onPointerMove: (event: PointerEvent<HTMLInputElement>) => {
      const drag = numericDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaX = drag.remainderX + event.clientX - drag.previousClientX;
      const { steps, remainderX } = numericDragStepsForDelta(deltaX);
      drag.previousClientX = event.clientX;
      drag.remainderX = remainderX;

      if (steps === 0) return;

      setSelectedParameterKey(drag.parameterKey);
      const commandId = steps > 0 ? "incrementSelectedParameter" : "decrementSelectedParameter";
      for (let index = 0; index < Math.abs(steps); index += 1) {
        dispatchCommand(commandId);
      }
    },
    onPointerUp: finishNumericDrag,
    onPointerCancel: finishNumericDrag,
    onLostPointerCapture: (event: PointerEvent<HTMLInputElement>) => {
      if (numericDragRef.current?.pointerId !== event.pointerId) return;
      numericDragRef.current = null;
    },
    onAuxClick: (event: MouseEvent<HTMLInputElement>) => {
      if (event.button === 1) event.preventDefault();
    }
  });

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
        <label
          className={`checkbox-line ${parameterFieldClass("visible")}`}
          onClick={() => selectParameter("visible")}
        >
          <input
            {...controlProps("visible")}
            type="checkbox"
            checked={element.visible}
            onChange={(event) => updateVisible(event.target.checked)}
          />
          <ParameterName element={element} parameterKey="visible" label="表示する" />
        </label>
        <label
          className={`checkbox-line ${parameterFieldClass("enabled")}`}
          onClick={() => selectParameter("enabled")}
        >
          <input
            {...controlProps("enabled")}
            type="checkbox"
            checked={element.enabled}
            onChange={(event) => updateEnabled(event.target.checked)}
          />
          <ParameterName element={element} parameterKey="enabled" label="評価する" />
        </label>

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
            <label className={parameterFieldClass("x")} onClick={() => selectParameter("x")}>
              <ParameterName element={element} parameterKey="x" label="x" />
              <input
                {...controlProps("x")}
                {...numericDragProps("x")}
                aria-label="x 値"
                type="text"
                inputMode="decimal"
                step="1"
                data-numeric-parameter-key="x"
                value={formatNumericExpressionForDisplay(element.x, elements, element.numericVariables ?? [])}
                onChange={(event) => updateField("x", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formatNumber(getNumericParameterStep(element, "x"))}
                  onFocus={() => selectParameter("x")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("x", event.target.value)}
                />
              </span>
            </label>
            <label className={parameterFieldClass("y")} onClick={() => selectParameter("y")}>
              <ParameterName element={element} parameterKey="y" label="y" />
              <input
                {...controlProps("y")}
                {...numericDragProps("y")}
                aria-label="y 値"
                type="text"
                inputMode="decimal"
                step="1"
                data-numeric-parameter-key="y"
                value={formatNumericExpressionForDisplay(element.y, elements, element.numericVariables ?? [])}
                onChange={(event) => updateField("y", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formatNumber(getNumericParameterStep(element, "y"))}
                  onFocus={() => selectParameter("y")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("y", event.target.value)}
                />
              </span>
            </label>
          </>
        )}

        {element.type === "offsetPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "fromPointId",
              label: "基準点",
              anchor: referenceAnchor(element.fromPointId),
              allowCoordinate: false
            })}
            <label className={parameterFieldClass("dx")} onClick={() => selectParameter("dx")}>
              <ParameterName element={element} parameterKey="dx" label="dx" />
              <input
                {...controlProps("dx")}
                {...numericDragProps("dx")}
                aria-label="dx 値"
                type="text"
                inputMode="decimal"
                step="1"
                data-numeric-parameter-key="dx"
                value={formatNumericExpressionForDisplay(element.dx, elements, element.numericVariables ?? [])}
                onChange={(event) => updateField("dx", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formatNumber(getNumericParameterStep(element, "dx"))}
                  onFocus={() => selectParameter("dx")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("dx", event.target.value)}
                />
              </span>
            </label>
            <label className={parameterFieldClass("dy")} onClick={() => selectParameter("dy")}>
              <ParameterName element={element} parameterKey="dy" label="dy" />
              <input
                {...controlProps("dy")}
                {...numericDragProps("dy")}
                aria-label="dy 値"
                type="text"
                inputMode="decimal"
                step="1"
                data-numeric-parameter-key="dy"
                value={formatNumericExpressionForDisplay(element.dy, elements, element.numericVariables ?? [])}
                onChange={(event) => updateField("dy", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formatNumber(getNumericParameterStep(element, "dy"))}
                  onFocus={() => selectParameter("dy")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("dy", event.target.value)}
                />
              </span>
            </label>
          </>
        )}

        {element.type === "polarOffsetPoint" && (
          <>
            {pointAnchorEditor({
              parameterKey: "fromPointId",
              label: "基準点",
              anchor: referenceAnchor(element.fromPointId),
              allowCoordinate: false
            })}
            <label className={parameterFieldClass("angleDeg")} onClick={() => selectParameter("angleDeg")}>
              <ParameterName element={element} parameterKey="angleDeg" label="角度" />
              <input
                {...controlProps("angleDeg")}
                {...numericDragProps("angleDeg")}
                aria-label="角度"
                type="text"
                inputMode="decimal"
                step="1"
                data-numeric-parameter-key="angleDeg"
                value={formatNumericExpressionForDisplay(
                  element.angleDeg,
                  elements,
                  element.numericVariables ?? []
                )}
                onChange={(event) => updateField("angleDeg", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formatNumber(getNumericParameterStep(element, "angleDeg"))}
                  onFocus={() => selectParameter("angleDeg")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("angleDeg", event.target.value)}
                />
              </span>
            </label>
            <label className={parameterFieldClass("distance")} onClick={() => selectParameter("distance")}>
              <ParameterName element={element} parameterKey="distance" label="距離" />
              <input
                {...controlProps("distance")}
                {...numericDragProps("distance")}
                aria-label="距離"
                type="text"
                inputMode="decimal"
                step="1"
                data-numeric-parameter-key="distance"
                value={formatNumericExpressionForDisplay(
                  element.distance,
                  elements,
                  element.numericVariables ?? []
                )}
                onChange={(event) => updateField("distance", event.target.value)}
              />
              <span className="parameter-step">
                増減単位
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formatNumber(getNumericParameterStep(element, "distance"))}
                  onFocus={() => selectParameter("distance")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") event.currentTarget.blur();
                  }}
                  onChange={(event) => updateStep("distance", event.target.value)}
                />
              </span>
            </label>
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
        : isComputedBezierCurve(geometry)
          ? bezierCurveInfoRows(geometry)
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
  const [draggedElementIds, setDraggedElementIds] = useState<ElementId[]>([]);
  const [dropTarget, setDropTarget] = useState<ElementDropTarget | null>(null);
  const errorElementIds = new Set(evaluation.errors.map((error) => error.elementId));
  const selectedElementIdSet = new Set(selectedElementIds);
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
    if (activePointPickTarget) {
      const element = elements.find((item) => item.id === elementId);
      if (element && isPointElement(element)) {
        dispatchCommand("applyPickedPoint", { pickedPointId: element.id });
      }
      return;
    }
    dispatchCommand("selectElement", {
      elementId,
      selectionMode: event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace"
    });
  };

  return (
    <aside className="left-panel">
      <header className="app-title">
        <h1>nuinuiCAD</h1>
      </header>

      <section className="panel-section">
        <div className="section-header">
          <div>
            <h2>構成リスト</h2>
            <p className={`section-subtitle ${activePointPickTarget ? "point-pick-list-subtitle" : ""}`}>
              {activePointPickTarget
                ? "点選択中: 点の行だけ選択できます"
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
          {elements.map((element, index) => (
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
                activePointPickTarget && isPointElement(element) ? "is-point-pick-candidate" : ""
              } ${
                activePointPickTarget && !isPointElement(element) ? "is-not-point-pick-candidate" : ""
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
            </div>
          ))}
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
