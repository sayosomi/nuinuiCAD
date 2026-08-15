import type { CadElement, PointAnchor } from "../types/geometry";
import type { ScalarType } from "../scalars/types";

export type ParameterValueKind =
  | "text"
  | "boolean"
  | "number"
  | "reference"
  | "lineEndpointReference"
  | "lineReference"
  | "lineReferenceList"
  | "color"
  | "choice";

export type ParameterKey = string;

export type ParameterDefinition = {
  key: ParameterKey;
  label: string;
  kind: ParameterValueKind;
  allowCoordinate?: boolean;
  allowNone?: boolean;
  emptyInputDefaultValue?: number;
  stepLevels?: readonly number[];
  choiceOptions?: readonly string[];
};

/**
 * The scalar type of a parameter is part of the parameter schema itself.
 * Consumers that compile typed values must use this helper as the single
 * schema-to-scalar-type mapping.
 */
export const scalarTypeForParameterDefinition = (
  definition: ParameterDefinition | undefined
): ScalarType | null => {
  if (!definition) return null;
  switch (definition.kind) {
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "text":
      return { kind: "string" };
    case "choice":
      return { kind: "choice", options: definition.choiceOptions ?? [] };
    default:
      return null;
  }
};

export const defaultNumericParameterStep = 1;
export const defaultNumericParameterStepLevels = [0.1, 1, 10, 100] as const;
export const ratioNumericParameterStepLevels = [0.01, 0.1, 1, 10] as const;
export const angleNumericParameterStepLevels = [0.1, 1, 15, 60, 90] as const;

const commonParameters: ParameterDefinition[] = [
  { key: "name", label: "名前", kind: "text" },
  { key: "colorId", label: "表示色", kind: "color" },
];

const numericVariableParameters = (
  element: CadElement,
): ParameterDefinition[] =>
  (element.numericVariables ?? []).map((variable) => ({
    key: `variable:${variable.id}:value`,
    label: `変数 ${variable.name}`,
    kind: "number" as const,
  }));

const pointAnchorParameters = ({
  anchor,
  key,
  label,
  allowCoordinate,
  allowNone = false,
}: {
  anchor: PointAnchor | null;
  key: string;
  label: string;
  allowCoordinate: boolean;
  allowNone?: boolean;
}): ParameterDefinition[] => [
  { key, label, kind: "reference", allowCoordinate, allowNone },
  ...(anchor?.mode === "coordinate"
    ? [
        { key: `${key}:x`, label: `${label} x`, kind: "number" as const },
        { key: `${key}:y`, label: `${label} y`, kind: "number" as const },
      ]
    : []),
];

const parameterDefinitionsForElement = (
  element: CadElement,
): ParameterDefinition[] => {
  switch (element.type) {
    case "group":
      return [
        ...commonParameters,
        { key: "printEnabled", label: "印刷", kind: "boolean" },
        ...pointAnchorParameters({
          anchor: element.printAnchor ?? { mode: "coordinate", x: 0, y: 0 },
          key: "printAnchor",
          label: "印刷基準点",
          allowCoordinate: true,
        }),
      ];
    case "conditionalGroup":
      return [
        ...commonParameters,
        {
          key: "condition",
          label: "条件",
          kind: "number",
          emptyInputDefaultValue: 1,
        },
      ];
    case "forGroup":
      return [
        ...commonParameters,
        { key: "variableName", label: "変数名", kind: "text" },
        { key: "start", label: "開始", kind: "number" },
        { key: "count", label: "回数", kind: "number" },
        {
          key: "step",
          label: "ステップ",
          kind: "number",
          emptyInputDefaultValue: 1,
        },
        { key: "showGenerated", label: "生成結果を表示", kind: "boolean" },
      ];
    case "moduleInstance":
      return [];
    case "text":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "text", label: "テキスト", kind: "text" },
        ...pointAnchorParameters({
          anchor: element.anchor,
          key: "anchor",
          label: "基準点",
          allowCoordinate: true,
          allowNone: true,
        }),
        { key: "fontSize", label: "文字サイズ", kind: "number" },
      ];
    case "freePoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "x", label: "x", kind: "number" },
        { key: "y", label: "y", kind: "number" },
      ];
    case "offsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        {
          key: "fromPoint",
          label: "基準点",
          kind: "reference",
          allowCoordinate: false,
        },
        { key: "dx", label: "dx", kind: "number" },
        { key: "dy", label: "dy", kind: "number" },
      ];
    case "polarOffsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        {
          key: "fromPoint",
          label: "基準点",
          kind: "reference",
          allowCoordinate: false,
        },
        {
          key: "angleDeg",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        { key: "distance", label: "距離", kind: "number" },
      ];
    case "divisionPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          label: "始点",
          allowCoordinate: false,
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          label: "終点",
          allowCoordinate: false,
        }),
        {
          key: "placementMode",
          label: "方式",
          kind: "choice",
          choiceOptions: ["distance", "ratio"],
        },
        { key: "distance", label: "距離", kind: "number" },
        {
          key: "ratio",
          label: "割合",
          kind: "number",
          emptyInputDefaultValue: 1,
          stepLevels: ratioNumericParameterStepLevels,
        },
      ];
    case "lineDivisionPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint", label: "端点", kind: "lineEndpointReference" },
        {
          key: "placementMode",
          label: "方式",
          kind: "choice",
          choiceOptions: ["distance", "ratio"],
        },
        { key: "distance", label: "距離", kind: "number" },
        {
          key: "ratio",
          label: "割合",
          kind: "number",
          emptyInputDefaultValue: 1,
          stepLevels: ratioNumericParameterStepLevels,
        },
      ];
    case "intersectionPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "line1Id", label: "線1", kind: "lineReference" },
        { key: "line2Id", label: "線2", kind: "lineReference" },
        { key: "intersectionIndex", label: "番号", kind: "number" },
        { key: "useExtensions", label: "延長", kind: "boolean" },
      ];
    case "lineTangentOffsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineId", label: "基準線", kind: "lineReference" },
        {
          key: "basePoint",
          label: "基準点",
          kind: "reference",
          allowCoordinate: false,
        },
        {
          key: "tangentAngleDeg",
          label: "接線角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        {
          key: "curveSide",
          label: "曲率側",
          kind: "choice",
          choiceOptions: ["convex", "concave"],
        },
        { key: "distance", label: "距離", kind: "number" },
      ];
    case "bezierExtremePoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineId", label: "ベジェ線", kind: "lineReference" },
        { key: "segmentIndex", label: "区間番号", kind: "number" },
        {
          key: "directionDeg",
          label: "方向",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
      ];
    case "bezierBulgePoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineId", label: "ベジェ線", kind: "lineReference" },
        { key: "segmentIndex", label: "区間番号", kind: "number" },
      ];
    case "splitLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineId", label: "基準線", kind: "lineReference" },
        {
          key: "splitPoint",
          label: "点",
          kind: "reference",
          allowCoordinate: false,
        },
      ];
    case "line":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          label: "始点",
          allowCoordinate: true,
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          label: "終点",
          allowCoordinate: true,
        }),
      ];
    case "angleLengthLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          label: "始点",
          allowCoordinate: true,
        }),
        {
          key: "angleDeg",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        { key: "length", label: "長さ", kind: "number" },
      ];
    case "arcLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.centerPoint,
          key: "centerPoint",
          label: "中心点",
          allowCoordinate: true,
        }),
        { key: "radius", label: "半径", kind: "number" },
        {
          key: "startAngleDeg",
          label: "始角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        {
          key: "endAngleDeg",
          label: "終角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
      ];
    case "threePointArcLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.point1,
          key: "point1",
          label: "点1",
          allowCoordinate: true,
        }),
        ...pointAnchorParameters({
          anchor: element.point2,
          key: "point2",
          label: "点2",
          allowCoordinate: true,
        }),
        ...pointAnchorParameters({
          anchor: element.point3,
          key: "point3",
          label: "点3",
          allowCoordinate: true,
        }),
        {
          key: "startAngleDeg",
          label: "始角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        {
          key: "endAngleDeg",
          label: "終角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
      ];
    case "cornerRadiusArcLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint1", label: "端点1", kind: "lineEndpointReference" },
        { key: "endpoint2", label: "端点2", kind: "lineEndpointReference" },
        { key: "radius", label: "半径", kind: "number" },
        { key: "intersectionIndex", label: "番号", kind: "number" },
      ];
    case "edge":
      return [
        ...numericVariableParameters(element),
        { key: "endpoint1", label: "端点1", kind: "lineEndpointReference" },
        { key: "endpoint2", label: "端点2", kind: "lineEndpointReference" },
        { key: "intersectionIndex", label: "番号", kind: "number" },
      ];
    case "extendTrim":
      return [
        ...numericVariableParameters(element),
        { key: "endpoint", label: "端点", kind: "lineEndpointReference" },
        {
          key: "point",
          label: "点",
          kind: "reference",
          allowCoordinate: false,
        },
      ];
    case "pathReverse":
      return [
        { key: "targetLineId", label: "対象線", kind: "lineReference" },
      ];
    case "bezierCurve":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          label: "始点",
          allowCoordinate: true,
        }),
        {
          key: "startHandleAngleDeg",
          label: "始点角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        { key: "startHandleLength", label: "始点ハンドル長", kind: "number" },
        ...element.intermediatePoints.flatMap((point, index) => [
          ...pointAnchorParameters({
            anchor: point.point,
            key: `intermediate:${point.id}:point`,
            label: `中間点${index + 1}`,
            allowCoordinate: true,
          }),
          {
            key: `intermediate:${point.id}:handleAngleDeg`,
            label: `中間点${index + 1}角度`,
            kind: "number" as const,
            stepLevels: angleNumericParameterStepLevels,
          },
          {
            key: `intermediate:${point.id}:incomingHandleLength`,
            label: `中間点${index + 1}前長さ`,
            kind: "number" as const,
          },
          {
            key: `intermediate:${point.id}:outgoingHandleLength`,
            label: `中間点${index + 1}後長さ`,
            kind: "number" as const,
          },
        ]),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          label: "終点",
          allowCoordinate: true,
        }),
        {
          key: "endHandleAngleDeg",
          label: "終点角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        { key: "endHandleLength", label: "終点ハンドル長", kind: "number" },
      ];
    case "offsetLine":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "baseLineIds", label: "基準線", kind: "lineReferenceList" },
        { key: "offset", label: "オフセット量", kind: "number" },
        {
          key: "side",
          label: "位置",
          kind: "choice",
          choiceOptions: ["right", "left"],
        },
        { key: "closed", label: "閉じる", kind: "boolean" },
        {
          key: "suppressTrimWarnings",
          label: "トリム警告を表示しない",
          kind: "boolean",
        },
      ];
    case "copyLine":
    case "move":
      return [
        ...(element.type === "move" ? [] : commonParameters),
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          label: "始点",
          allowCoordinate: false,
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          label: "終点",
          allowCoordinate: false,
        }),
        {
          key: "scale",
          label: "倍率",
          kind: "number",
          emptyInputDefaultValue: 1,
          stepLevels: ratioNumericParameterStepLevels,
        },
        {
          key: "angleDeg",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        { key: "mirrorX", label: "左右反転", kind: "boolean" },
        {
          key: "baseLineIds",
          label: element.type === "move" ? "対象線" : "基準線",
          kind: "lineReferenceList",
        },
      ];
    case "symmetricCopyLine":
    case "symmetricMove":
      return [
        ...(element.type === "symmetricMove" ? [] : commonParameters),
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.axisPoint1,
          key: "axisPoint1",
          label: "対称点1",
          allowCoordinate: false,
        }),
        ...pointAnchorParameters({
          anchor: element.axisPoint2,
          key: "axisPoint2",
          label: "対称点2",
          allowCoordinate: false,
        }),
        {
          key: "baseLineIds",
          label: element.type === "symmetricMove" ? "対象線" : "基準線",
          kind: "lineReferenceList",
        },
      ];
    case "image":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "sourcePath", label: "画像ファイル", kind: "text" },
        ...pointAnchorParameters({
          anchor: element.originPoint,
          key: "originPoint",
          label: "基準点",
          allowCoordinate: true,
        }),
        { key: "naturalWidthPx", label: "元画像幅", kind: "number" },
        { key: "naturalHeightPx", label: "元画像高", kind: "number" },
        { key: "sourceDpi", label: "元画像DPI", kind: "number" },
        { key: "targetPixelsPerMm", label: "目標 pixels/mm", kind: "number" },
        {
          key: "scale",
          label: "倍率",
          kind: "number",
          emptyInputDefaultValue: 1,
          stepLevels: ratioNumericParameterStepLevels,
        },
        {
          key: "angleDeg",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels,
        },
        { key: "mirrorX", label: "左右反転", kind: "boolean" },
      ];
  }
};

export const getParameterDefinitions = (
  element: CadElement,
): ParameterDefinition[] =>
  parameterDefinitionsForElement(element);

export const findParameterDefinition = (
  element: CadElement,
  key: string | null,
) =>
  getParameterDefinitions(element).find((definition) => definition.key === key);

export const getNumericParameterStep = (
  element: CadElement,
  key: ParameterKey,
) => element.numericParameterSteps?.[key] ?? defaultNumericParameterStep;

export const getNumericParameterStepLevels = (
  definition: ParameterDefinition,
) => definition.stepLevels ?? defaultNumericParameterStepLevels;

export const getEmptyNumericInputDefaultValue = (
  definition?: ParameterDefinition,
) => definition?.emptyInputDefaultValue ?? 0;
