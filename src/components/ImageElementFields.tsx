import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { NumericValue, PointAnchor } from "../types/geometry";
import {
  BooleanParameterEditor,
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import type { CommonEditorProps } from "./parameterEditorShared";

export const ImageElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  if (element.type !== "image") return null;

  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} />;
  const pointAnchorEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    anchor: PointAnchor;
  }) => <PointAnchorParameterEditor {...commonEditorProps} {...props} />;

  return (
    <>
      <div className="parameter-row">
        <span className="parameter-label">画像</span>
        <span className="parameter-readonly-value">{element.sourcePath || "未設定"}</span>
      </div>
      <div className="parameter-row">
        <span className="parameter-label">読み込み</span>
        <span className="parameter-readonly-value">
          {element.sourceDpi.toFixed(2)} dpi / {element.targetPixelsPerMm.toFixed(3)} px/mm
        </span>
      </div>
      {pointAnchorEditor({
        parameterKey: "originPoint",
        label: "基準点",
        anchor: element.originPoint
      })}
      {numericInput({
        parameterKey: "scale",
        label: "倍率",
        value: element.scale,
        ariaLabel: "画像倍率"
      })}
      {numericInput({
        parameterKey: "angleDeg",
        label: "角度",
        value: element.angleDeg,
        ariaLabel: "画像角度"
      })}
      <BooleanParameterEditor
        {...elementEditorProps}
        parameterKey="mirrorX"
        label="左右反転"
        checked={element.mirrorX}
      />
    </>
  );
};
