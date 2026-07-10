import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { NumericValue } from "../types/geometry";
import {
  BooleanParameterEditor,
  NumericParameterEditor
} from "./ParameterEditors";
import { ParameterName } from "./ParameterName";
import type { CommonEditorProps } from "./parameterEditorShared";
import { useParameterEditor } from "./parameterEditorShared";
import { useCadUiStore } from "../state/cadUiStore";
import { isGroupExpanded } from "../model/groups";

export const ForGroupElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const { controlProps, parameterFieldClass, selectParameter, updateParameterValue } =
    useParameterEditor(elementEditorProps);
  const groupFoldById = useCadUiStore((state) => state.groupFoldById);
  const toggleGroupExpanded = useCadUiStore((state) => state.toggleGroupExpanded);

  if (element.type !== "forGroup") return null;

  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} enableExpressionInsert />;

  return (
    <>
      <label
        className={parameterFieldClass("variableName")}
        onClick={() => selectParameter("variableName")}
      >
        <ParameterName element={element} parameterKey="variableName" label="変数名" />
        <input
          {...controlProps("variableName")}
          type="text"
          aria-label={`${element.name} の変数名`}
          value={element.variableName}
          onChange={(event) => updateParameterValue("variableName", event.target.value)}
        />
      </label>
      {numericInput({
        parameterKey: "start",
        label: "開始",
        value: element.start,
        ariaLabel: "開始"
      })}
      {numericInput({
        parameterKey: "count",
        label: "回数",
        value: element.count,
        ariaLabel: "回数"
      })}
      {numericInput({
        parameterKey: "step",
        label: "ステップ",
        value: element.step,
        ariaLabel: "ステップ"
      })}
      <label className="parameter-field">
        <span>展開する</span>
        <input type="checkbox" checked={isGroupExpanded(element.id, groupFoldById)} onChange={() => toggleGroupExpanded(element.id)} />
      </label>
      <BooleanParameterEditor
        {...elementEditorProps}
        parameterKey="showGenerated"
        label="生成結果を表示"
        checked={element.showGenerated}
      />
    </>
  );
};
