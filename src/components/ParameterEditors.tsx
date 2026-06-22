import { useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  formatNumericExpressionForDisplay,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import { lineEndpointReferenceLabel, pointAnchorLabel } from "../model/pointAnchors";
import {
  defaultNumericParameterStep,
  getNumericParameterStep,
  getParameterDefinitions
} from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import { useCadStore } from "../state/useCadStore";
import type { CadElement, ElementId, LineEndpointReference, NumericValue, PointAnchor } from "../types/geometry";
import { formatNumber } from "./geometryDisplay";
import { numericDragStepsForDelta } from "./numericDrag";

type RegisterParameterControl = (key: string, element: HTMLElement | null) => void;

type CommonEditorProps = {
  element: CadElement;
  elements: CadElement[];
  isParameterEditMode: boolean;
  registerParameterControl: RegisterParameterControl;
};

type NumericDragState = {
  parameterKey: ParameterKey;
  pointerId: number;
  previousClientX: number;
  remainderX: number;
};

export const ParameterName = ({
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

const useParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl
}: Pick<CommonEditorProps, "element" | "isParameterEditMode" | "registerParameterControl">) => {
  const updateElement = useCadStore((state) => state.updateElement);
  const selectedParameterKey = useCadStore((state) => state.selectedParameterKey);
  const setSelectedParameterKey = useCadStore((state) => state.setSelectedParameterKey);
  const selectParameter = (key: ParameterKey) => setSelectedParameterKey(key);
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
  const updateParameterValue = (field: ParameterKey, value: unknown) => {
    updateElement(element.id, setParameterValue(element, field, value) as Partial<CadElement>);
  };
  return {
    controlProps,
    parameterFieldClass,
    selectParameter,
    selectedParameterKey,
    updateElement,
    updateParameterValue
  };
};

export const NumericParameterEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  value,
  ariaLabel,
  compact = false
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  value: NumericValue;
  ariaLabel: string;
  compact?: boolean;
}) => {
  const [numericDrag, setNumericDrag] = useState<NumericDragState | null>(null);
  const activeNumericReferencePickTarget = useCadStore((state) => state.activeNumericReferencePickTarget);
  const {
    controlProps,
    parameterFieldClass,
    selectParameter,
    updateElement,
    updateParameterValue
  } = useParameterEditor({ element, isParameterEditMode, registerParameterControl });
  const isPickingThisNumericReference =
    activeNumericReferencePickTarget?.elementId === element.id &&
    activeNumericReferencePickTarget.parameterKey === parameterKey;
  const updateField = (field: ParameterKey, nextValue: string) => {
    updateParameterValue(
      field,
      makeNumericExpression(
        normalizeNumericExpressionInput(nextValue, elements, element.numericVariables ?? [])
      )
    );
  };
  const updateStep = (field: ParameterKey, nextValue: string) => {
    const nextStep = Number(nextValue);
    updateElement(element.id, {
      numericParameterSteps: {
        ...element.numericParameterSteps,
        [field]: Number.isFinite(nextStep) && nextStep > 0 ? nextStep : defaultNumericParameterStep
      }
    } as Partial<CadElement>);
  };
  const finishNumericDrag = (event: PointerEvent<HTMLInputElement>) => {
    const drag = numericDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setNumericDrag(null);
  };
  const numericDragProps = (key: ParameterKey) => ({
    onPointerDown: (event: PointerEvent<HTMLInputElement>) => {
      if (event.button !== 1) return;

      event.preventDefault();
      event.stopPropagation();
      selectParameter(key);
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setNumericDrag({
        parameterKey: key,
        pointerId: event.pointerId,
        previousClientX: event.clientX,
        remainderX: 0
      });
    },
    onPointerMove: (event: PointerEvent<HTMLInputElement>) => {
      const drag = numericDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaX = drag.remainderX + event.clientX - drag.previousClientX;
      const { steps, remainderX } = numericDragStepsForDelta(deltaX);
      setNumericDrag({
        ...drag,
        previousClientX: event.clientX,
        remainderX
      });

      if (steps === 0) return;

      selectParameter(drag.parameterKey);
      const commandId = steps > 0 ? "incrementSelectedParameter" : "decrementSelectedParameter";
      for (let index = 0; index < Math.abs(steps); index += 1) {
        dispatchCommand(commandId);
      }
    },
    onPointerUp: finishNumericDrag,
    onPointerCancel: finishNumericDrag,
    onLostPointerCapture: (event: PointerEvent<HTMLInputElement>) => {
      if (numericDrag?.pointerId !== event.pointerId) return;
      setNumericDrag(null);
    },
    onAuxClick: (event: MouseEvent<HTMLInputElement>) => {
      if (event.button === 1) event.preventDefault();
    }
  });
  const input = (
    <input
      {...controlProps(parameterKey)}
      {...numericDragProps(parameterKey)}
      aria-label={ariaLabel}
      type="text"
      inputMode="decimal"
      step="1"
      data-numeric-parameter-key={parameterKey}
      value={formatNumericExpressionForDisplay(value, elements, element.numericVariables ?? [])}
      onChange={(event) => updateField(parameterKey, event.target.value)}
    />
  );
  const stepControl = (
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
  );

  if (compact) {
    return (
      <label className={parameterFieldClass(parameterKey)} onClick={() => selectParameter(parameterKey)}>
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        {input}
        {stepControl}
      </label>
    );
  }

  return (
    <div
      className={`${parameterFieldClass(parameterKey)} numeric-parameter-editor ${
        isPickingThisNumericReference ? "is-picking-numeric-reference" : ""
      }`}
      onClick={() => selectParameter(parameterKey)}
    >
      <div className="numeric-parameter-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <button
          type="button"
          className={`numeric-reference-pick-button ${isPickingThisNumericReference ? "active" : ""}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectParameter(parameterKey);
            if (isPickingThisNumericReference) {
              dispatchCommand("cancelNumericReferencePick");
              return;
            }
            dispatchCommand("startNumericReferencePick");
          }}
        >
          {isPickingThisNumericReference ? "数値選択中" : "数値選択"}
        </button>
      </div>
      {input}
      <div className="numeric-parameter-footer">
        {stepControl}
        {isPickingThisNumericReference ? (
          <p className="numeric-reference-pick-hint">canvas または構成リストから選択</p>
        ) : null}
      </div>
    </div>
  );
};

export const PointAnchorParameterEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  anchor,
  allowCoordinate = true
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  anchor: PointAnchor;
  allowCoordinate?: boolean;
}) => {
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const { parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisPoint =
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey;
  const numericProps = { element, elements, isParameterEditMode, registerParameterControl };
  const definition = getParameterDefinitions(element).find((parameter) => parameter.key === parameterKey);
  const canUseCoordinate = definition?.allowCoordinate ?? allowCoordinate;
  const commandContext = { elementId: element.id, parameterKey };

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
                selectParameter(parameterKey);
                dispatchCommand("setSelectedPointAnchorReferenceMode", commandContext);
              }}
            >
              既存点
            </button>
            {canUseCoordinate ? (
              <button
                type="button"
                className={anchor.mode === "coordinate" ? "active-toggle" : ""}
                onClick={() => {
                  selectParameter(parameterKey);
                  dispatchCommand("setSelectedPointAnchorCoordinateMode", commandContext);
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
      ) : isParameterEditMode ? (
        <p className="point-pick-hint">
          Enterで点選択{canUseCoordinate ? " / Spaceで座標切替" : ""}
        </p>
      ) : null}
      {anchor.mode !== "coordinate" ? (
        <button
          type="button"
          className={`${parameterFieldClass(parameterKey)} point-anchor-reference`}
          onClick={() => selectParameter(parameterKey)}
        >
          <span className="reference-label">参照点</span>
          <span className="reference-value">{pointAnchorLabel(anchor, elements)}</span>
        </button>
      ) : (
        <div className="point-anchor-coordinate-grid">
          <NumericParameterEditor
            {...numericProps}
            parameterKey={`${parameterKey}:x`}
            label={`${label} x`}
            value={anchor.x}
            ariaLabel={`${label} x`}
            compact
          />
          <NumericParameterEditor
            {...numericProps}
            parameterKey={`${parameterKey}:y`}
            label={`${label} y`}
            value={anchor.y}
            ariaLabel={`${label} y`}
            compact
          />
        </div>
      )}
    </div>
  );
};

export const LineEndpointReferenceEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  endpoint
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  endpoint: LineEndpointReference;
}) => {
  const activePointPickTarget = useCadStore((state) => state.activePointPickTarget);
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisEndpoint =
    activePointPickTarget?.elementId === element.id &&
    activePointPickTarget.parameterKey === parameterKey;

  return (
    <div className={`point-anchor-editor ${isPickingThisEndpoint ? "is-picking-point" : ""}`}>
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <button
          type="button"
          className={`point-pick-button ${isPickingThisEndpoint ? "active" : ""}`}
          onClick={() => {
            selectParameter(parameterKey);
            if (isPickingThisEndpoint) {
              dispatchCommand("cancelPointPick");
              return;
            }
            dispatchCommand("startPointPick");
          }}
        >
          {isPickingThisEndpoint ? "端点選択中" : "端点を選択"}
        </button>
      </div>
      {isPickingThisEndpoint ? (
        <p className="point-pick-hint">canvas または構成リストから線の始点/終点を選択します。</p>
      ) : null}
      <button
        {...controlProps(parameterKey)}
        type="button"
        className={`${parameterFieldClass(parameterKey)} point-anchor-reference`}
        onClick={() => selectParameter(parameterKey)}
      >
        <span className="reference-label">参照端点</span>
        <span className="reference-value">{lineEndpointReferenceLabel(endpoint, elements)}</span>
      </button>
    </div>
  );
};

export const ChoiceParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  value,
  options,
  optionLabels,
  ariaLabel
}: Omit<CommonEditorProps, "elements"> & {
  parameterKey: ParameterKey;
  label: string;
  value: string;
  options: readonly string[];
  optionLabels: Record<string, string>;
  ariaLabel: string;
}) => {
  const { parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  return (
    <div className={parameterFieldClass(parameterKey)} onClick={() => selectParameter(parameterKey)}>
      <ParameterName element={element} parameterKey={parameterKey} label={label} />
      <div className="point-anchor-mode" role="group" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? "active-toggle" : ""}
            onClick={() => {
              updateParameterValue(parameterKey, option);
              selectParameter(parameterKey);
            }}
          >
            {optionLabels[option] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
};

export const BooleanParameterEditor = ({
  element,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  checked
}: Omit<CommonEditorProps, "elements"> & {
  parameterKey: ParameterKey;
  label: string;
  checked: boolean;
}) => {
  const { controlProps, parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  return (
    <label
      className={`checkbox-line ${parameterFieldClass(parameterKey)}`}
      onClick={() => selectParameter(parameterKey)}
    >
      <input
        {...controlProps(parameterKey)}
        type="checkbox"
        checked={checked}
        onChange={(event) => updateParameterValue(parameterKey, event.target.checked)}
      />
      <ParameterName element={element} parameterKey={parameterKey} label={label} />
    </label>
  );
};

export const LineReferenceListEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  lineIds,
  emptyLabel
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  lineIds: ElementId[];
  emptyLabel: string;
}) => {
  const activeLinePickTarget = useCadStore((state) => state.activeLinePickTarget);
  const { parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisLine =
    activeLinePickTarget?.elementId === element.id &&
    activeLinePickTarget.parameterKey === parameterKey;
  const updateLineIds = (nextLineIds: ElementId[]) => {
    updateParameterValue(parameterKey, nextLineIds);
    selectParameter(parameterKey);
  };
  const moveLineId = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= lineIds.length) return;
    const next = [...lineIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateLineIds(next);
  };

  return (
    <div
      className={`line-anchor-editor ${parameterFieldClass(parameterKey)} ${
        isPickingThisLine ? "is-picking-line" : ""
      }`}
      onClick={() => selectParameter(parameterKey)}
    >
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <button
          type="button"
          className={`line-pick-button ${isPickingThisLine ? "active" : ""}`}
          onClick={() => {
            selectParameter(parameterKey);
            if (isPickingThisLine) {
              dispatchCommand("cancelLinePick");
              return;
            }
            dispatchCommand("startLinePick");
          }}
        >
          {isPickingThisLine ? "線選択中" : "線を選択"}
        </button>
      </div>
      {isPickingThisLine ? (
        <p className="line-pick-hint">canvas または構成リストから線を選択します。</p>
      ) : null}
      {lineIds.length === 0 ? (
        <p className="empty-state">{emptyLabel}</p>
      ) : (
        lineIds.map((lineId, index) => {
          const line = elements.find((item) => item.id === lineId);
          return (
            <div className="curve-point-group" key={`${lineId}-${index}`}>
              <div className="curve-point-header">
                <span>{line?.name ?? lineId}</span>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => moveLineId(index, -1)}
                    disabled={index === 0}
                  >
                    上
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLineId(index, 1)}
                    disabled={index === lineIds.length - 1}
                  >
                    下
                  </button>
                  <button
                    type="button"
                    onClick={() => updateLineIds(lineIds.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export const LineReferenceEditor = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  lineId
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  lineId: ElementId;
}) => {
  const activeLinePickTarget = useCadStore((state) => state.activeLinePickTarget);
  const { controlProps, parameterFieldClass, selectParameter } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });
  const isPickingThisLine =
    activeLinePickTarget?.elementId === element.id &&
    activeLinePickTarget.parameterKey === parameterKey;
  const line = elements.find((item) => item.id === lineId);

  return (
    <div
      className={`line-anchor-editor ${parameterFieldClass(parameterKey)} ${
        isPickingThisLine ? "is-picking-line" : ""
      }`}
      onClick={() => selectParameter(parameterKey)}
    >
      <div className="point-anchor-header">
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        <button
          type="button"
          className={`line-pick-button ${isPickingThisLine ? "active" : ""}`}
          onClick={() => {
            selectParameter(parameterKey);
            if (isPickingThisLine) {
              dispatchCommand("cancelLinePick");
              return;
            }
            dispatchCommand("startLinePick");
          }}
        >
          {isPickingThisLine ? "線選択中" : "線を選択"}
        </button>
      </div>
      {isPickingThisLine ? (
        <p className="line-pick-hint">canvas または構成リストから線を選択します。</p>
      ) : null}
      <button
        {...controlProps(parameterKey)}
        type="button"
        className={`${parameterFieldClass(parameterKey)} point-anchor-reference`}
        onClick={() => selectParameter(parameterKey)}
      >
        <span className="reference-label">参照線</span>
        <span className="reference-value">{line?.name ?? lineId}</span>
      </button>
    </div>
  );
};
