import type { CadElement, CadElementType, PointAnchor } from "../types/geometry";
import type { PropertyBindingCapability } from "../scalars/scalarAssignability";

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
  // Declares that a typed scalar binding may be assigned to this parameter
  // (see docs/typed-variables/tasks/08-scalar-type-contracts.md). Optional
  // and unused by existing consumers until a later task opts a property in.
  propertyCapability?: PropertyBindingCapability;
};

// Task 22 opt-in registry (docs/typed-variables/plan.md "property対応" / D10):
// the *only* place a property is declared eligible for a typed scalar
// binding. `getParameterDefinitions` below applies this generically as a
// post-map, so `parameterDefinitions.ts` stays the sole source of property
// type info and no compiler elsewhere needs its own list of property names.
const propertyBindingCapabilities: Partial<Record<CadElementType, Record<string, PropertyBindingCapability>>> = {
  text: {
    text: { propertyType: { kind: "string" } }
  },
  offsetLine: {
    side: { propertyType: { kind: "choice", options: ["right", "left"] } },
    closed: { propertyType: { kind: "boolean" } },
    suppressTrimWarnings: { propertyType: { kind: "boolean" } }
  },
  intersectionPoint: {
    useExtensions: { propertyType: { kind: "boolean" } }
  },
  copyLine: {
    mirrorX: { propertyType: { kind: "boolean" } }
  },
  move: {
    mirrorX: { propertyType: { kind: "boolean" } }
  },
  image: {
    mirrorX: { propertyType: { kind: "boolean" } }
  },
  group: {
    printEnabled: { propertyType: { kind: "boolean" } }
  },
  forGroup: {
    showGenerated: { propertyType: { kind: "boolean" } }
  }
};

const withPropertyBindingCapabilities = (
  type: CadElementType,
  definitions: ParameterDefinition[]
): ParameterDefinition[] => {
  const capabilities = propertyBindingCapabilities[type];
  if (!capabilities) return definitions;
  return definitions.map((definition) => {
    const capability = capabilities[definition.key];
    return capability ? { ...definition, propertyCapability: capability } : definition;
  });
};

export const defaultNumericParameterStep = 1;
export const defaultNumericParameterStepLevels = [0.1, 1, 10, 100] as const;
export const ratioNumericParameterStepLevels = [0.01, 0.1, 1, 10] as const;
export const angleNumericParameterStepLevels = [0.1, 1, 15, 60, 90] as const;

const commonParameters: ParameterDefinition[] = [
  { key: "name", label: "名前", kind: "text" },
  { key: "colorId", label: "表示色", kind: "color" },
];

const nonColorCommonParameters: ParameterDefinition[] = [
  { key: "name", label: "名前", kind: "text" },
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
        { key: "distance", label: "距離", kind: "number" },
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
        ...nonColorCommonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint1", label: "端点1", kind: "lineEndpointReference" },
        { key: "endpoint2", label: "端点2", kind: "lineEndpointReference" },
        { key: "intersectionIndex", label: "番号", kind: "number" },
      ];
    case "extendTrim":
      return [
        ...nonColorCommonParameters,
        ...numericVariableParameters(element),
        { key: "endpoint", label: "端点", kind: "lineEndpointReference" },
        {
          key: "point",
          label: "点",
          kind: "reference",
          allowCoordinate: false,
        },
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
        ...(element.type === "move"
          ? nonColorCommonParameters
          : commonParameters),
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
        ...(element.type === "symmetricMove"
          ? nonColorCommonParameters
          : commonParameters),
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
  withPropertyBindingCapabilities(element.type, parameterDefinitionsForElement(element));

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
