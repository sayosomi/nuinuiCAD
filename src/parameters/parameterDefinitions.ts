import type { CadElement, PointAnchor } from "../types/geometry";
import { pointAnchorOptions } from "../model/pointAnchors";

export type ParameterValueKind =
  | "text"
  | "boolean"
  | "number"
  | "reference"
  | "lineEndpointReference"
  | "lineReference"
  | "lineReferenceList"
  | "choice";

export type ParameterKey = string;

export type ParameterDefinition = {
  key: ParameterKey;
  directKey: string;
  label: string;
  kind: ParameterValueKind;
  allowCoordinate?: boolean;
  stepLevels?: readonly number[];
  choiceOptions?: readonly string[];
};

export const defaultNumericParameterStep = 1;
export const defaultNumericParameterStepLevels = [0.1, 1, 10, 100] as const;
export const ratioNumericParameterStepLevels = [0.01, 0.1, 1, 10] as const;
export const angleNumericParameterStepLevels = [0.1, 1, 15, 60, 90] as const;

const commonParameters: ParameterDefinition[] = [
  { key: "name", directKey: "n", label: "名前", kind: "text" },
  { key: "visible", directKey: "v", label: "表示", kind: "boolean" },
  { key: "enabled", directKey: "a", label: "評価", kind: "boolean" }
];

const numericVariableParameters = (element: CadElement): ParameterDefinition[] =>
  (element.numericVariables ?? []).map((variable) => ({
    key: `variable:${variable.id}:value`,
    directKey: "q",
    label: `変数 ${variable.name}`,
    kind: "number" as const
  }));

const pointAnchorParameters = ({
  anchor,
  key,
  directKey,
  label,
  allowCoordinate
}: {
  anchor: PointAnchor;
  key: string;
  directKey: string;
  label: string;
  allowCoordinate: boolean;
}): ParameterDefinition[] => [
  { key, directKey, label, kind: "reference", allowCoordinate },
  ...(anchor.mode === "coordinate"
    ? [
        { key: `${key}:x`, directKey: "x", label: `${label} x`, kind: "number" as const },
        { key: `${key}:y`, directKey: "y", label: `${label} y`, kind: "number" as const }
      ]
    : [])
];

export const getParameterDefinitions = (element: CadElement): ParameterDefinition[] => {
  switch (element.type) {
    case "group":
      return [
        ...commonParameters,
        { key: "expanded", directKey: "x", label: "展開", kind: "boolean" }
      ];
    case "freePoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "x", directKey: "x", label: "x", kind: "number" },
        { key: "y", directKey: "y", label: "y", kind: "number" }
      ];
    case "offsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "fromPoint", directKey: "b", label: "基準点", kind: "reference", allowCoordinate: false },
        { key: "dx", directKey: "x", label: "dx", kind: "number" },
        { key: "dy", directKey: "y", label: "dy", kind: "number" }
      ];
    case "polarOffsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "fromPoint", directKey: "b", label: "基準点", kind: "reference", allowCoordinate: false },
        {
          key: "angleDeg",
          directKey: "r",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        { key: "distance", directKey: "f", label: "距離", kind: "number" }
      ];
    case "divisionPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          directKey: "s",
          label: "始点",
          allowCoordinate: false
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          directKey: "t",
          label: "終点",
          allowCoordinate: false
        }),
        {
          key: "placementMode",
          directKey: "m",
          label: "方式",
          kind: "choice",
          choiceOptions: ["distance", "ratio"]
        },
        { key: "distance", directKey: "d", label: "距離", kind: "number" },
        {
          key: "ratio",
          directKey: "r",
          label: "割合",
          kind: "number",
          stepLevels: ratioNumericParameterStepLevels
        }
      ];
    case "lineDivisionPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint", directKey: "b", label: "端点", kind: "lineEndpointReference" },
        {
          key: "placementMode",
          directKey: "m",
          label: "方式",
          kind: "choice",
          choiceOptions: ["distance", "ratio"]
        },
        { key: "distance", directKey: "d", label: "距離", kind: "number" },
        {
          key: "ratio",
          directKey: "r",
          label: "割合",
          kind: "number",
          stepLevels: ratioNumericParameterStepLevels
        }
      ];
    case "intersectionPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "line1Id", directKey: "1", label: "線1", kind: "lineReference" },
        { key: "line2Id", directKey: "2", label: "線2", kind: "lineReference" },
        { key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" },
        { key: "useExtensions", directKey: "x", label: "延長", kind: "boolean" }
      ];
    case "lineTangentOffsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineId", directKey: "b", label: "基準線", kind: "lineReference" },
        { key: "basePoint", directKey: "p", label: "基準点", kind: "reference", allowCoordinate: false },
        {
          key: "tangentAngleDeg",
          directKey: "r",
          label: "接線角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        { key: "distance", directKey: "d", label: "距離", kind: "number" }
      ];
    case "splitLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineId", directKey: "b", label: "基準線", kind: "lineReference" },
        { key: "splitPoint", directKey: "p", label: "点", kind: "reference", allowCoordinate: false }
      ];
    case "line":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          directKey: "s",
          label: "始点",
          allowCoordinate: true
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          directKey: "t",
          label: "終点",
          allowCoordinate: true
        })
      ];
    case "arcLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.centerPoint,
          key: "centerPoint",
          directKey: "c",
          label: "中心点",
          allowCoordinate: true
        }),
        { key: "radius", directKey: "d", label: "半径", kind: "number" },
        {
          key: "startAngleDeg",
          directKey: "s",
          label: "始角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        {
          key: "endAngleDeg",
          directKey: "t",
          label: "終角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        }
      ];
    case "threePointArcLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.point1,
          key: "point1",
          directKey: "1",
          label: "点1",
          allowCoordinate: true
        }),
        ...pointAnchorParameters({
          anchor: element.point2,
          key: "point2",
          directKey: "2",
          label: "点2",
          allowCoordinate: true
        }),
        ...pointAnchorParameters({
          anchor: element.point3,
          key: "point3",
          directKey: "3",
          label: "点3",
          allowCoordinate: true
        }),
        {
          key: "startAngleDeg",
          directKey: "s",
          label: "始角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        {
          key: "endAngleDeg",
          directKey: "t",
          label: "終角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        }
      ];
    case "cornerRadiusArcLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint1", directKey: "1", label: "端点1", kind: "lineEndpointReference" },
        { key: "endpoint2", directKey: "2", label: "端点2", kind: "lineEndpointReference" },
        { key: "radius", directKey: "r", label: "半径", kind: "number" },
        { key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" }
      ];
    case "edge":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint1", directKey: "1", label: "端点1", kind: "lineEndpointReference" },
        { key: "endpoint2", directKey: "2", label: "端点2", kind: "lineEndpointReference" },
        { key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" }
      ];
    case "extendTrim":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint", directKey: "e", label: "端点", kind: "lineEndpointReference" },
        { key: "point", directKey: "p", label: "点", kind: "reference", allowCoordinate: false }
      ];
    case "bezierCurve":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          directKey: "s",
          label: "始点",
          allowCoordinate: true
        }),
        {
          key: "startHandleAngleDeg",
          directKey: "r",
          label: "始点角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        { key: "startHandleLength", directKey: "h", label: "始点ハンドル長", kind: "number" },
        ...element.intermediatePoints.flatMap((point, index) => [
          ...pointAnchorParameters({
            anchor: point.point,
            key: `intermediate:${point.id}:point`,
            directKey: "m",
            label: `中間点${index + 1}`,
            allowCoordinate: true
          }),
          {
            key: `intermediate:${point.id}:handleAngleDeg`,
            directKey: "u",
            label: `中間点${index + 1}角度`,
            kind: "number" as const,
            stepLevels: angleNumericParameterStepLevels
          },
          {
            key: `intermediate:${point.id}:incomingHandleLength`,
            directKey: "i",
            label: `中間点${index + 1}前長さ`,
            kind: "number" as const
          },
          {
            key: `intermediate:${point.id}:outgoingHandleLength`,
            directKey: "o",
            label: `中間点${index + 1}後長さ`,
            kind: "number" as const
          }
        ]),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          directKey: "t",
          label: "終点",
          allowCoordinate: true
        }),
        {
          key: "endHandleAngleDeg",
          directKey: "e",
          label: "終点角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        { key: "endHandleLength", directKey: "g", label: "終点ハンドル長", kind: "number" }
      ];
    case "offsetLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineIds", directKey: "b", label: "基準線", kind: "lineReferenceList" },
        { key: "offset", directKey: "d", label: "オフセット量", kind: "number" },
        {
          key: "side",
          directKey: "s",
          label: "位置",
          kind: "choice",
          choiceOptions: ["right", "left"]
        },
        { key: "closed", directKey: "c", label: "閉じる", kind: "boolean" }
      ];
    case "copyLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          directKey: "s",
          label: "始点",
          allowCoordinate: false
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          directKey: "t",
          label: "終点",
          allowCoordinate: false
        }),
        {
          key: "angleDeg",
          directKey: "r",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        { key: "mirrorX", directKey: "m", label: "左右反転", kind: "boolean" },
        { key: "baseLineIds", directKey: "b", label: "基準線", kind: "lineReferenceList" }
      ];
    case "symmetricCopyLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.axisPoint1,
          key: "axisPoint1",
          directKey: "1",
          label: "対称点1",
          allowCoordinate: false
        }),
        ...pointAnchorParameters({
          anchor: element.axisPoint2,
          key: "axisPoint2",
          directKey: "2",
          label: "対称点2",
          allowCoordinate: false
        }),
        { key: "baseLineIds", directKey: "b", label: "基準線", kind: "lineReferenceList" }
      ];
  }
};

export const getFirstParameterKey = (element: CadElement) => getParameterDefinitions(element)[0].key;

export const findParameterDefinition = (element: CadElement, key: string | null) =>
  getParameterDefinitions(element).find((definition) => definition.key === key);

export const normalizeParameterKey = (element: CadElement, key: string | null) =>
  findParameterDefinition(element, key)?.key ?? getFirstParameterKey(element);

export const findParameterByDirectKey = (element: CadElement, directKey: string) =>
  getParameterDefinitions(element).find(
    (definition) => definition.directKey === directKey.toLowerCase()
  );

export const pointAnchorReferenceOptions = pointAnchorOptions;

export const getNumericParameterStep = (element: CadElement, key: ParameterKey) =>
  element.numericParameterSteps?.[key] ?? defaultNumericParameterStep;

export const getNumericParameterStepLevels = (definition: ParameterDefinition) =>
  definition.stepLevels ?? defaultNumericParameterStepLevels;
