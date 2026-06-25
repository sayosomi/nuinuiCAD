import { useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  formatNumericExpressionForDisplay,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import {
  defaultNumericParameterStep,
  getNumericParameterStep
} from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, NumericValue } from "../types/geometry";
import { formatNumber } from "./geometryDisplay";
import { numericDragStepsForDelta } from "./numericDrag";
import { ParameterName } from "./ParameterName";
import type { CommonEditorProps } from "./parameterEditorShared";
import { useParameterEditor } from "./parameterEditorShared";

type NumericDragState = {
  parameterKey: ParameterKey;
  pointerId: number;
  previousClientX: number;
  remainderX: number;
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
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
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
      data-numeric-element-id={element.id}
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
