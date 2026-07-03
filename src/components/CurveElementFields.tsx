import { dispatchCommand } from "../commands/commands";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { NumericValue, PointAnchor } from "../types/geometry";
import {
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import type { CommonEditorProps } from "./parameterEditorShared";

export const CurveElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
  const numericInput = (props: {
    parameterKey: ParameterKey;
    label: string;
    value: NumericValue;
    ariaLabel: string;
    compact?: boolean;
  }) => <NumericParameterEditor {...commonEditorProps} {...props} />;
  const pointAnchorEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    anchor: PointAnchor;
    allowCoordinate?: boolean;
  }) => <PointAnchorParameterEditor {...commonEditorProps} {...props} />;

  if (element.type !== "bezierCurve") {
    return null;
  }

  return (
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
          <button type="button" onClick={() => dispatchCommand("addBezierIntermediatePoint")}>
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
  );
};
