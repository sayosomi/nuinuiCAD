import type { ComponentType } from "react";
import { Folder, Globe, MoveDiagonal, Ruler, Sigma, TriangleRight } from "lucide-react";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { NumericValue, PointAnchor } from "../types/geometry";
import {
  LineReferenceEditor,
  NumericParameterEditor,
  PointAnchorParameterEditor
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
      <VariableChoiceCards
        {...elementEditorProps}
        parameterKey="valueMode"
        label="計算方法"
        value={element.valueMode}
        options={[
          { value: "expression", label: "式", detail: "数式・測定関数", Icon: Sigma },
          { value: "pointDistance", label: "2点距離", detail: "点から点まで", Icon: Ruler },
          { value: "pointAngle", label: "2点角度", detail: "点同士の角度", Icon: TriangleRight },
          { value: "pointLineDistance", label: "点と線の距離", detail: "垂直距離", Icon: MoveDiagonal }
        ]}
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
