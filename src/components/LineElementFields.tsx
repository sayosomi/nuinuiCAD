import type { ParameterKey } from "../parameters/parameterDefinitions";
import type {
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import {
  BooleanParameterEditor,
  ChoiceParameterEditor,
  LineEndpointReferenceEditor,
  LineReferenceEditor,
  LineReferenceListEditor,
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import type { CommonEditorProps } from "./parameterEditorShared";

export const LineElementFields = ({
  element,
  elements,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const commonEditorProps = { element, elements, isParameterEditMode, registerParameterControl };
  const elementEditorProps = { element, isParameterEditMode, registerParameterControl };
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
  const lineEndpointEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    endpoint: LineEndpointReference;
  }) => <LineEndpointReferenceEditor {...commonEditorProps} {...props} />;

  switch (element.type) {
    case "line":
      return (
        <>
          {pointAnchorEditor({
            parameterKey: "startPoint",
            label: "始点",
            anchor: element.startPoint
          })}
          {pointAnchorEditor({
            parameterKey: "endPoint",
            label: "終点",
            anchor: element.endPoint
          })}
        </>
      );

    case "arcLine":
      return (
        <>
          {pointAnchorEditor({
            parameterKey: "centerPoint",
            label: "中心点",
            anchor: element.centerPoint
          })}
          {numericInput({
            parameterKey: "radius",
            label: "半径",
            value: element.radius,
            ariaLabel: "半径"
          })}
          {numericInput({
            parameterKey: "startAngleDeg",
            label: "始角度",
            value: element.startAngleDeg,
            ariaLabel: "始角度"
          })}
          {numericInput({
            parameterKey: "endAngleDeg",
            label: "終角度",
            value: element.endAngleDeg,
            ariaLabel: "終角度"
          })}
        </>
      );

    case "threePointArcLine":
      return (
        <>
          {pointAnchorEditor({
            parameterKey: "point1",
            label: "点1",
            anchor: element.point1
          })}
          {pointAnchorEditor({
            parameterKey: "point2",
            label: "点2",
            anchor: element.point2
          })}
          {pointAnchorEditor({
            parameterKey: "point3",
            label: "点3",
            anchor: element.point3
          })}
          {numericInput({
            parameterKey: "startAngleDeg",
            label: "始角度",
            value: element.startAngleDeg,
            ariaLabel: "始角度"
          })}
          {numericInput({
            parameterKey: "endAngleDeg",
            label: "終角度",
            value: element.endAngleDeg,
            ariaLabel: "終角度"
          })}
        </>
      );

    case "cornerRadiusArcLine":
      return (
        <>
          {lineEndpointEditor({
            parameterKey: "endpoint1",
            label: "端点1",
            endpoint: element.endpoint1
          })}
          {lineEndpointEditor({
            parameterKey: "endpoint2",
            label: "端点2",
            endpoint: element.endpoint2
          })}
          {numericInput({
            parameterKey: "radius",
            label: "半径",
            value: element.radius,
            ariaLabel: "半径"
          })}
          {numericInput({
            parameterKey: "intersectionIndex",
            label: "番号",
            value: element.intersectionIndex,
            ariaLabel: "交点番号"
          })}
        </>
      );

    case "offsetLine":
      return (
        <>
          <LineReferenceListEditor
            {...commonEditorProps}
            parameterKey="baseLineIds"
            label="基準線"
            lineIds={element.baseLineIds}
            emptyLabel="基準線はありません。"
          />
          {numericInput({
            parameterKey: "offset",
            label: "オフセット量",
            value: element.offset,
            ariaLabel: "オフセット量"
          })}
          <ChoiceParameterEditor
            {...elementEditorProps}
            parameterKey="side"
            label="位置"
            value={element.side}
            options={["right", "left"]}
            optionLabels={{ right: "右", left: "左" }}
            ariaLabel="オフセット位置"
          />
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="closed"
            label="閉じる"
            checked={element.closed}
          />
        </>
      );

    case "splitLine":
      return (
        <>
          <LineReferenceEditor
            {...commonEditorProps}
            parameterKey="baseLineId"
            label="基準線"
            lineId={element.baseLineId}
          />
          {pointAnchorEditor({
            parameterKey: "splitPoint",
            label: "点",
            anchor: element.splitPoint,
            allowCoordinate: false
          })}
        </>
      );

    case "copyLine":
      return (
        <>
          {pointAnchorEditor({
            parameterKey: "startPoint",
            label: "始点",
            anchor: element.startPoint,
            allowCoordinate: false
          })}
          {pointAnchorEditor({
            parameterKey: "endPoint",
            label: "終点",
            anchor: element.endPoint,
            allowCoordinate: false
          })}
          {numericInput({
            parameterKey: "angleDeg",
            label: "角度",
            value: element.angleDeg,
            ariaLabel: "コピー角度"
          })}
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="mirrorX"
            label="左右反転"
            checked={element.mirrorX}
          />
          <LineReferenceListEditor
            {...commonEditorProps}
            parameterKey="baseLineIds"
            label="基準線"
            lineIds={element.baseLineIds}
            emptyLabel="基準線はありません。"
          />
        </>
      );

    default:
      return null;
  }
};
