import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Folder, Globe } from "lucide-react";
import {
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "../geometry/numericExpressions";
import { isLineLikeElement, isPointElement } from "../model/pointAnchors";
import { setParameterValue } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement, ElementId, NumericValue } from "../types/geometry";
import {
  NumericParameterEditor
} from "./ParameterEditors";
import { ParameterName } from "./ParameterName";
import type { CommonEditorProps } from "./parameterEditorShared";
import { useParameterEditor } from "./parameterEditorShared";

type VariableChoiceOption = {
  value: string;
  label: string;
  detail: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const VariableChoiceCards = ({
  element,
  isParameterEditMode,
  registerParameterControl,
  parameterKey,
  label,
  value,
  options,
  ariaLabel
}: Omit<CommonEditorProps, "elements"> & {
  parameterKey: ParameterKey;
  label: string;
  value: string;
  options: VariableChoiceOption[];
  ariaLabel: string;
}) => {
  const { parameterFieldClass, selectParameter, updateParameterValue } = useParameterEditor({
    element,
    isParameterEditMode,
    registerParameterControl
  });

  return (
    <div
      className={`variable-choice-field ${parameterFieldClass(parameterKey)}`}
      onClick={() => selectParameter(parameterKey)}
    >
      <ParameterName element={element} parameterKey={parameterKey} label={label} />
      <div className="variable-choice-grid" role="group" aria-label={ariaLabel}>
        {options.map(({ value: optionValue, label: optionLabel, detail, Icon }) => (
          <button
            key={optionValue}
            type="button"
            className={`variable-choice-card ${value === optionValue ? "active-toggle" : ""}`}
            onClick={() => {
              updateParameterValue(parameterKey, optionValue);
              selectParameter(parameterKey);
            }}
          >
            <Icon size={16} strokeWidth={2} />
            <span>
              <strong>{optionLabel}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

type MeasurementInsertMode = "distance" | "angle" | "lineDistance";

const measurementModes: {
  mode: MeasurementInsertMode;
  label: string;
  functionName: string;
  description: string;
}[] = [
  { mode: "distance", label: "2点距離", functionName: "距離", description: "点から点まで" },
  { mode: "angle", label: "2点角度", functionName: "角度", description: "点同士の角度" },
  { mode: "lineDistance", label: "点と線の距離", functionName: "点線距離", description: "垂直距離" }
];

const selectedElementName = (elements: CadElement[], elementId: ElementId) =>
  elements.find((element) => element.id === elementId)?.name ?? elementId;

const insertAtInputSelection = (
  input: HTMLInputElement | null,
  insertion: string
) => {
  const currentValue = input?.value ?? "";
  const hasFocusedInput = input && document.activeElement === input;
  if (!hasFocusedInput && currentValue.trim() === "0") return insertion;
  if (!hasFocusedInput && currentValue.trim().length > 0) return `${currentValue} + ${insertion}`;
  const start = hasFocusedInput ? input.selectionStart ?? currentValue.length : currentValue.length;
  const end = hasFocusedInput ? input.selectionEnd ?? start : start;
  return `${currentValue.slice(0, start)}${insertion}${currentValue.slice(end)}`;
};

const VariableMeasurementInsertPanel = ({
  element,
  elements
}: {
  element: CadElement;
  elements: CadElement[];
}) => {
  const updateElement = useCadDocumentStore((state) => state.updateElement);
  const [mode, setMode] = useState<MeasurementInsertMode>("distance");
  const pointOptions = useMemo(() => elements.filter(isPointElement), [elements]);
  const lineOptions = useMemo(
    () => elements.filter((item) => isLineLikeElement(item) && item.id !== element.id),
    [element.id, elements]
  );
  const [point1Id, setPoint1Id] = useState<ElementId>(pointOptions[0]?.id ?? "");
  const [point2Id, setPoint2Id] = useState<ElementId>(pointOptions[1]?.id ?? pointOptions[0]?.id ?? "");
  const [lineId, setLineId] = useState<ElementId>(lineOptions[0]?.id ?? "");
  const selectedMode = measurementModes.find((item) => item.mode === mode) ?? measurementModes[0];
  const canInsert =
    mode === "lineDistance"
      ? Boolean(point1Id && lineId)
      : Boolean(point1Id && point2Id);
  const preview =
    mode === "lineDistance"
      ? `${selectedMode.functionName}(${selectedElementName(elements, point1Id)}, ${selectedElementName(elements, lineId)})`
      : `${selectedMode.functionName}(${selectedElementName(elements, point1Id)}, ${selectedElementName(elements, point2Id)})`;

  const insertMeasurement = () => {
    if (!canInsert) return;
    const input = document.querySelector<HTMLInputElement>(
      `input[data-numeric-element-id="${element.id}"][data-numeric-parameter-key="expression"]`
    );
    const nextExpression = insertAtInputSelection(input, preview);
    updateElement(element.id, {
      ...setParameterValue(
      element,
      "expression",
      makeNumericExpression(normalizeNumericExpressionInput(nextExpression, elements, element.numericVariables ?? []))
      ),
      valueMode: "expression"
    } as Partial<CadElement>);
    requestAnimationFrame(() => input?.focus());
  };

  return (
    <div className="measurement-insert-panel">
      <div className="measurement-insert-header">
        <span>測定を挿入</span>
        <code>{preview}</code>
      </div>
      <div className="measurement-mode-grid" role="group" aria-label="挿入する測定">
        {measurementModes.map((item) => (
          <button
            key={item.mode}
            type="button"
            className={mode === item.mode ? "active-toggle" : ""}
            onClick={() => setMode(item.mode)}
          >
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </button>
        ))}
      </div>
      <div className="measurement-insert-grid">
        <label>
          {mode === "lineDistance" ? "点" : "点1"}
          <select value={point1Id} onChange={(event) => setPoint1Id(event.target.value)}>
            {pointOptions.map((point) => (
              <option key={point.id} value={point.id}>{point.name}</option>
            ))}
          </select>
        </label>
        {mode === "lineDistance" ? (
          <label>
            線
            <select value={lineId} onChange={(event) => setLineId(event.target.value)}>
              {lineOptions.map((line) => (
                <option key={line.id} value={line.id}>{line.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            点2
            <select value={point2Id} onChange={(event) => setPoint2Id(event.target.value)}>
              {pointOptions.map((point) => (
                <option key={point.id} value={point.id}>{point.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        className="measurement-insert-button"
        onClick={insertMeasurement}
        disabled={!canInsert}
      >
        式に挿入
      </button>
    </div>
  );
};

export const VariableElementFields = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  if (element.type !== "variable") return null;

  const commonEditorProps = { element, elements, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} />;

  return (
    <>
      <VariableChoiceCards
        {...elementEditorProps}
        parameterKey="scope"
        label="使える範囲"
        value={element.scope}
        options={[
          { value: "global", label: "全体", detail: "後続要素から参照", Icon: Globe },
          { value: "group", label: "グループ内", detail: "同じ階層に限定", Icon: Folder }
        ]}
        ariaLabel="変数スコープ"
      />
      {numericInput({
        parameterKey: "expression",
        label: "式",
        value: element.expression,
        ariaLabel: "変数式"
      })}
      <VariableMeasurementInsertPanel element={element} elements={elements} />
    </>
  );
};
