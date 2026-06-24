import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { NumericValue, PointAnchor } from "../types/geometry";
import {
  ChoiceParameterEditor,
  LineReferenceEditor,
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import type { CommonEditorProps } from "./parameterEditorShared";

export const VariableElementFields = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  if (element.type !== "variable") return null;

  const commonEditorProps = { element, elements, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const pointAnchorEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    anchor: PointAnchor;
  }) => <PointAnchorParameterEditor {...commonEditorProps} {...props} allowCoordinate={false} />;
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} />;

  return (
    <>
      <ChoiceParameterEditor
        {...elementEditorProps}
        parameterKey="scope"
        label="スコープ"
        value={element.scope}
        options={["global", "group"]}
        optionLabels={{ global: "グローバル", group: "同一グループ" }}
        ariaLabel="変数スコープ"
      />
      <ChoiceParameterEditor
        {...elementEditorProps}
        parameterKey="valueMode"
        label="値の種類"
        value={element.valueMode}
        options={["expression", "pointDistance", "pointAngle", "pointLineDistance"]}
        optionLabels={{
          expression: "式",
          pointDistance: "点点距離",
          pointAngle: "点点角度",
          pointLineDistance: "点線距離"
        }}
        ariaLabel="変数の値の種類"
      />
      {element.valueMode === "expression" ? (
        numericInput({
          parameterKey: "expression",
          label: "式",
          value: element.expression,
          ariaLabel: "変数式"
        })
      ) : null}
      {element.valueMode === "pointDistance" || element.valueMode === "pointAngle" ? (
        <>
          {pointAnchorEditor({ parameterKey: "point1", label: "点1", anchor: element.point1 })}
          {pointAnchorEditor({ parameterKey: "point2", label: "点2", anchor: element.point2 })}
        </>
      ) : null}
      {element.valueMode === "pointLineDistance" ? (
        <>
          {pointAnchorEditor({ parameterKey: "point", label: "点", anchor: element.point })}
          <LineReferenceEditor
            {...commonEditorProps}
            parameterKey="lineId"
            label="直線"
            lineId={element.lineId}
          />
        </>
      ) : null}
    </>
  );
};
