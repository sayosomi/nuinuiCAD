import type { ComponentType } from "react";
import { Folder, Globe } from "lucide-react";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { NumericValue } from "../types/geometry";
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

export const VariableElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  if (element.type !== "variable") return null;

  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} enableExpressionInsert />;

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
    </>
  );
};
