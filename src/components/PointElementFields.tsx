import { pointAnchorForElement, referenceAnchor } from "../model/pointAnchors";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type {
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";
import {
  BooleanParameterEditor,
  ChoiceParameterEditor,
  LineEndpointReferenceEditor,
  LineReferenceEditor,
  NumericParameterEditor,
  PointAnchorParameterEditor
} from "./ParameterEditors";
import type { CommonEditorProps } from "./parameterEditorShared";

export const PointElementFields = ({
  element,
  elements,
  evaluation,
  isParameterEditMode,
  registerParameterControl
}: CommonEditorProps) => {
  const commonEditorProps = { element, elements, evaluation, isParameterEditMode, registerParameterControl };
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
  const lineReferenceEditor = (props: {
    parameterKey: ParameterKey;
    label: string;
    lineId: ElementId;
  }) => <LineReferenceEditor {...commonEditorProps} {...props} />;

  switch (element.type) {
    case "freePoint":
      return (
        <>
          {numericInput({
            parameterKey: "x",
            label: "x",
            value: element.x,
            ariaLabel: "x 値"
          })}
          {numericInput({
            parameterKey: "y",
            label: "y",
            value: element.y,
            ariaLabel: "y 値"
          })}
        </>
      );

    case "offsetPoint":
      return (
        <>
          {pointAnchorEditor({
            parameterKey: "fromPoint",
            label: "基準点",
            anchor: pointAnchorForElement(element) ?? referenceAnchor(""),
            allowCoordinate: false
          })}
          {numericInput({
            parameterKey: "dx",
            label: "dx",
            value: element.dx,
            ariaLabel: "dx 値"
          })}
          {numericInput({
            parameterKey: "dy",
            label: "dy",
            value: element.dy,
            ariaLabel: "dy 値"
          })}
        </>
      );

    case "polarOffsetPoint":
      return (
        <>
          {pointAnchorEditor({
            parameterKey: "fromPoint",
            label: "基準点",
            anchor: pointAnchorForElement(element) ?? referenceAnchor(""),
            allowCoordinate: false
          })}
          {numericInput({
            parameterKey: "angleDeg",
            label: "角度",
            value: element.angleDeg,
            ariaLabel: "角度"
          })}
          {numericInput({
            parameterKey: "distance",
            label: "距離",
            value: element.distance,
            ariaLabel: "距離"
          })}
        </>
      );

    case "divisionPoint":
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
          <ChoiceParameterEditor
            {...elementEditorProps}
            parameterKey="placementMode"
            label="方式"
            value={element.placementMode}
            options={["distance", "ratio"]}
            optionLabels={{ distance: "距離", ratio: "割合" }}
            ariaLabel="分点方式"
          />
          {element.placementMode === "distance"
            ? numericInput({
                parameterKey: "distance",
                label: "距離",
                value: element.distance,
                ariaLabel: "距離"
              })
            : numericInput({
                parameterKey: "ratio",
                label: "割合",
                value: element.ratio,
                ariaLabel: "割合"
              })}
        </>
      );

    case "lineDivisionPoint":
      return (
        <>
          {lineEndpointEditor({
            parameterKey: "endpoint",
            label: "端点",
            endpoint: element.endpoint
          })}
          <ChoiceParameterEditor
            {...elementEditorProps}
            parameterKey="placementMode"
            label="方式"
            value={element.placementMode}
            options={["distance", "ratio"]}
            optionLabels={{ distance: "距離", ratio: "割合" }}
            ariaLabel="線上分点方式"
          />
          {element.placementMode === "distance"
            ? numericInput({
                parameterKey: "distance",
                label: "距離",
                value: element.distance,
                ariaLabel: "距離"
              })
            : numericInput({
                parameterKey: "ratio",
                label: "割合",
                value: element.ratio,
                ariaLabel: "割合"
              })}
        </>
      );

    case "intersectionPoint":
      return (
        <>
          {lineReferenceEditor({
            parameterKey: "line1Id",
            label: "線1",
            lineId: element.line1Id
          })}
          {lineReferenceEditor({
            parameterKey: "line2Id",
            label: "線2",
            lineId: element.line2Id
          })}
          {numericInput({
            parameterKey: "intersectionIndex",
            label: "番号",
            value: element.intersectionIndex,
            ariaLabel: "交点番号"
          })}
          <BooleanParameterEditor
            {...elementEditorProps}
            parameterKey="useExtensions"
            label="延長線上の交点を使う"
            checked={element.useExtensions}
          />
        </>
      );

    case "lineTangentOffsetPoint":
      return (
        <>
          {lineReferenceEditor({
            parameterKey: "baseLineId",
            label: "基準線",
            lineId: element.baseLineId
          })}
          {pointAnchorEditor({
            parameterKey: "basePoint",
            label: "基準点",
            anchor: element.basePoint,
            allowCoordinate: false
          })}
          {numericInput({
            parameterKey: "tangentAngleDeg",
            label: "接線角度",
            value: element.tangentAngleDeg,
            ariaLabel: "接線角度"
          })}
          {numericInput({
            parameterKey: "distance",
            label: "距離",
            value: element.distance,
            ariaLabel: "距離"
          })}
        </>
      );

    default:
      return null;
  }
};
