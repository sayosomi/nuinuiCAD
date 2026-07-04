import { useCallback, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { dispatchCommand } from "../commands/commands";
import {
  formatNumericExpressionForDisplay,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import {
  findParameterDefinition,
  getEmptyNumericInputDefaultValue,
  getNumericParameterStep
} from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement, NumericValue } from "../types/geometry";
import { formatNumber } from "./geometryDisplay";
import { numericDragStepsForDelta } from "./numericDrag";
import { ExpressionInsertTray } from "./ExpressionInsertTray";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import {
  NumericVariableSuggestPopover
} from "./NumericVariableSuggestPopover";
import {
  filteredNumericVariableSuggestions,
  numericVariableSuggestionMatch,
  replaceNumericVariableSuggestionToken
} from "./numericVariableSuggestion";
import { ParameterName } from "./ParameterName";
import type { CommonEditorProps } from "./parameterEditorShared";
import { useParameterEditor } from "./parameterEditorShared";
import { availableNumericVariableReferenceOptions } from "../geometry/variableReferenceOptions";
import { selectTextInputValue } from "./textInputSelection";

type NumericDragState = {
  parameterKey: ParameterKey;
  pointerId: number;
  previousClientX: number;
  remainderX: number;
};

type NumericInputDraft = {
  value: string;
  baseValue: NumericValue;
};

type StepInputDraft = {
  parameterKey: ParameterKey;
  value: string;
};

const deferredNumericInputValues = new Set(["", "+", "-", ".", "+.", "-."]);

const isDeferredNumericInput = (input: string) =>
  deferredNumericInputValues.has(input.trim());

const numericValuesEqual = (left: NumericValue, right: NumericValue) => {
  if (typeof left === "number" || typeof right === "number") return left === right;
  return left.expression === right.expression;
};

export const NumericParameterEditor = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  value,
  ariaLabel,
  compact = false,
  enableExpressionInsert = false,
  showStepControl = true
}: CommonEditorProps & {
  parameterKey: ParameterKey;
  label: string;
  value: NumericValue;
  ariaLabel: string;
  compact?: boolean;
  enableExpressionInsert?: boolean;
  showStepControl?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [inputSelection, setInputSelection] = useState<{ start: number; end: number } | null>(null);
  const [numericDrag, setNumericDrag] = useState<NumericDragState | null>(null);
  const [stepDrag, setStepDrag] = useState<NumericDragState | null>(null);
  const [stepDraft, setStepDraft] = useState<StepInputDraft | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const activeNumericReferencePickTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const activeExpressionInsertTarget = useCadUiStore((state) => state.activeExpressionInsertTarget);
  const {
    controlProps,
    parameterFieldClass,
    selectParameter,
    updateElement,
    updateParameterValue
  } = useParameterEditor({ element, isParameterEditMode, registerParameterControl });
  const isPickingThisNumericReference =
    activeNumericReferencePickTarget?.elementId === element.id &&
    activeNumericReferencePickTarget.parameterKey === parameterKey &&
    activeNumericReferencePickTarget.mode === "replace";
  const isExpressionInsertOpen =
    activeExpressionInsertTarget?.elementId === element.id &&
    activeExpressionInsertTarget.parameterKey === parameterKey;
  const parameterDefinition = findParameterDefinition(element, parameterKey);
  const emptyInputDefaultValue = getEmptyNumericInputDefaultValue(parameterDefinition);
  const displayValue = formatNumericExpressionForDisplay(
    value,
    elements,
    element.numericVariables ?? []
  );
  const [draft, setDraft] = useState<NumericInputDraft | null>(null);
  const numericValueFromInput = useCallback(
    (nextValue: string) =>
      makeNumericExpression(
        normalizeNumericExpressionInput(nextValue, elements, element.numericVariables ?? [])
      ),
    [element.numericVariables, elements]
  );

  const shouldUseDraftValue =
    draft !== null &&
    (isDeferredNumericInput(draft.value)
      ? numericValuesEqual(draft.baseValue, value)
      : numericValuesEqual(numericValueFromInput(draft.value), value));
  const inputValue = shouldUseDraftValue ? draft.value : displayValue;
  const variableOptions = useMemo(
    () =>
      availableNumericVariableReferenceOptions({
        element,
        elements,
        parameterKey,
        computedVariables: evaluation?.computedVariables.size
          ? evaluation.computedVariables
          : undefined
      }),
    [element, elements, evaluation, parameterKey]
  );
  const suggestionMatch = numericVariableSuggestionMatch(
    inputValue,
    inputSelection?.start ?? null,
    inputSelection?.end ?? null
  );
  const visibleSuggestions = suggestionMatch
    ? filteredNumericVariableSuggestions(variableOptions, suggestionMatch.query)
    : [];
  const selectedSuggestionIndex =
    visibleSuggestions.length === 0
      ? 0
      : Math.min(activeSuggestionIndex, visibleSuggestions.length - 1);

  const updateField = (field: ParameterKey, nextValue: string) => {
    setDraft({ value: nextValue, baseValue: value });
    if (isDeferredNumericInput(nextValue)) return;
    updateParameterValue(field, numericValueFromInput(nextValue));
  };
  const finishEditingField = () => {
    if (draft === null) return;
    if (draft.value.trim().length === 0) {
      setDraft(null);
      inputSelectionRef.current = null;
      setInputSelection(null);
      return;
    }
    setDraft(null);
    inputSelectionRef.current = null;
    setInputSelection(null);
  };
  const updateStep = (field: ParameterKey, nextValue: string) => {
    setStepDraft({ parameterKey: field, value: nextValue });
    const nextStep = Number(nextValue);
    if (!Number.isFinite(nextStep) || nextStep <= 0) return;

    updateElement(element.id, {
      numericParameterSteps: {
        ...element.numericParameterSteps,
        [field]: nextStep
      }
    } as Partial<CadElement>);
  };
  const finishEditingStep = () => {
    setStepDraft(null);
  };
  const finishStepDrag = (event: PointerEvent<HTMLInputElement>) => {
    const drag = stepDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setStepDrag(null);
  };
  const dispatchStepChange = (key: ParameterKey, direction: 1 | -1) => {
    setStepDraft(null);
    selectParameter(key);
    dispatchCommand(direction > 0 ? "increaseSelectedParameterStep" : "decreaseSelectedParameterStep");
  };
  const stepDragProps = (key: ParameterKey) => ({
    onPointerDown: (event: PointerEvent<HTMLInputElement>) => {
      if (event.button !== 1) return;

      event.preventDefault();
      event.stopPropagation();
      setStepDraft(null);
      selectParameter(key);
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setStepDrag({
        parameterKey: key,
        pointerId: event.pointerId,
        previousClientX: event.clientX,
        remainderX: 0
      });
    },
    onPointerMove: (event: PointerEvent<HTMLInputElement>) => {
      const drag = stepDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();
      const deltaX = drag.remainderX + event.clientX - drag.previousClientX;
      const { steps, remainderX } = numericDragStepsForDelta(deltaX);
      setStepDrag({
        ...drag,
        previousClientX: event.clientX,
        remainderX
      });

      if (steps === 0) return;

      selectParameter(drag.parameterKey);
      const commandId = steps > 0 ? "increaseSelectedParameterStep" : "decreaseSelectedParameterStep";
      for (let index = 0; index < Math.abs(steps); index += 1) {
        dispatchCommand(commandId);
      }
    },
    onPointerUp: finishStepDrag,
    onPointerCancel: finishStepDrag,
    onLostPointerCapture: (event: PointerEvent<HTMLInputElement>) => {
      if (stepDrag?.pointerId !== event.pointerId) return;
      setStepDrag(null);
    },
    onAuxClick: (event: MouseEvent<HTMLInputElement>) => {
      if (event.button === 1) event.preventDefault();
    }
  });
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
  const rememberInputSelection = () => {
    const inputElement = inputRef.current;
    if (!inputElement || document.activeElement !== inputElement) return;
    const nextSelection = {
      start: inputElement.selectionStart ?? inputElement.value.length,
      end: inputElement.selectionEnd ?? inputElement.selectionStart ?? inputElement.value.length
    };
    inputSelectionRef.current = nextSelection;
    setInputSelection(nextSelection);
  };
  const applyVariableSuggestion = (option = visibleSuggestions[selectedSuggestionIndex]) => {
    if (!suggestionMatch || !option) return;
    const nextValue = replaceNumericVariableSuggestionToken(
      inputValue,
      suggestionMatch,
      option.expression
    );
    const nextSelection = suggestionMatch.tokenStart + option.expression.length;
    const nextInputSelection = { start: nextSelection, end: nextSelection };
    inputSelectionRef.current = nextInputSelection;
    setInputSelection(nextInputSelection);
    updateField(parameterKey, nextValue);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextSelection, nextSelection);
    });
  };
  const input = (
    <input
      {...controlProps(parameterKey)}
      ref={(node) => {
        inputRef.current = node;
        registerParameterControl(parameterKey, node);
      }}
      {...numericDragProps(parameterKey)}
      aria-label={ariaLabel}
      type="text"
      inputMode="decimal"
      step="1"
      data-numeric-parameter-key={parameterKey}
      data-numeric-element-id={element.id}
      value={inputValue}
      aria-autocomplete={visibleSuggestions.length > 0 ? "list" : undefined}
      aria-expanded={visibleSuggestions.length > 0 ? true : undefined}
      onChange={(event) => {
        const nextInputSelection = {
          start: event.target.selectionStart ?? event.target.value.length,
          end: event.target.selectionEnd ?? event.target.selectionStart ?? event.target.value.length
        };
        inputSelectionRef.current = nextInputSelection;
        setInputSelection(nextInputSelection);
        setActiveSuggestionIndex(0);
        updateField(parameterKey, event.target.value);
      }}
      onSelect={rememberInputSelection}
      onKeyUp={rememberInputSelection}
      onMouseUp={rememberInputSelection}
      onFocus={() => {
        selectParameter(parameterKey);
        selectTextInputValue(inputRef.current, (nextSelection) => {
          inputSelectionRef.current = nextSelection;
          setInputSelection(nextSelection);
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && isImeComposingKeyEvent(event)) return;
        if (visibleSuggestions.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveSuggestionIndex((index) => (index + 1) % visibleSuggestions.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveSuggestionIndex(
              (index) => (index - 1 + visibleSuggestions.length) % visibleSuggestions.length
            );
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            applyVariableSuggestion();
            return;
          }
        }
        if (event.key === "Enter" && draft?.value.trim().length === 0) {
          event.preventDefault();
          updateParameterValue(parameterKey, emptyInputDefaultValue);
          setDraft(null);
          inputSelectionRef.current = null;
          setInputSelection(null);
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(null);
          inputSelectionRef.current = null;
          setInputSelection(null);
          event.currentTarget.blur();
        }
      }}
      onBlur={finishEditingField}
    />
  );
  const variableSuggestPopover = visibleSuggestions.length > 0 ? (
    <NumericVariableSuggestPopover
      options={visibleSuggestions}
      activeIndex={selectedSuggestionIndex}
      onHover={setActiveSuggestionIndex}
      onApply={applyVariableSuggestion}
    />
  ) : null;
  const stepControl = (
    <span className="parameter-step">
      増減単位
      <input
        {...stepDragProps(parameterKey)}
        type="text"
        inputMode="decimal"
        aria-label={`${label} 増減単位`}
        value={
          stepDraft?.parameterKey === parameterKey
            ? stepDraft.value
            : formatNumber(getNumericParameterStep(element, parameterKey))
        }
        onFocus={(event) => {
          selectParameter(parameterKey);
          selectTextInputValue(event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            dispatchStepChange(parameterKey, 1);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            dispatchStepChange(parameterKey, -1);
            return;
          }
          if (event.key === "Enter" || event.key === "Escape") {
            setStepDraft(null);
            event.currentTarget.blur();
          }
        }}
        onBlur={finishEditingStep}
        onChange={(event) => updateStep(parameterKey, event.target.value)}
      />
    </span>
  );

  if (compact) {
    return (
      <label className={parameterFieldClass(parameterKey)} onClick={() => selectParameter(parameterKey)}>
        <ParameterName element={element} parameterKey={parameterKey} label={label} />
        {input}
        {variableSuggestPopover}
        {showStepControl ? stepControl : null}
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
        <div className="numeric-parameter-actions">
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
          {enableExpressionInsert ? (
            <button
              type="button"
              className={`expression-insert-toggle ${isExpressionInsertOpen ? "active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectParameter(parameterKey);
                dispatchCommand("toggleExpressionInsertTray", {
                  elementId: element.id,
                  parameterKey
                });
              }}
            >
              参照を挿入
            </button>
          ) : null}
        </div>
      </div>
      {input}
      {variableSuggestPopover}
      {enableExpressionInsert && isExpressionInsertOpen ? (
        <ExpressionInsertTray
          element={element}
          elements={elements}
          parameterKey={parameterKey}
          focusInput={() => inputRef.current?.focus()}
          getInputTarget={() => ({
            displayedExpression: inputRef.current?.value ?? "",
            selectionStart: inputSelectionRef.current?.start ?? null,
            selectionEnd: inputSelectionRef.current?.end ?? null
          })}
        />
      ) : null}
      <div className="numeric-parameter-footer">
        {showStepControl ? stepControl : null}
        {isPickingThisNumericReference ? (
          <p className="numeric-reference-pick-hint">canvas または構成リストから選択</p>
        ) : null}
      </div>
    </div>
  );
};
