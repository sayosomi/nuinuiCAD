import type { CadElement, PointAnchor } from "../types/geometry";
import { pointAnchorOptions } from "../model/pointAnchors";

export type ParameterValueKind = "text" | "boolean" | "number" | "reference";

export type ParameterKey = string;

export type ParameterDefinition = {
  key: ParameterKey;
  directKey: string;
  label: string;
  kind: ParameterValueKind;
  stepLevels?: readonly number[];
};

export const defaultNumericParameterStep = 1;
export const defaultNumericParameterStepLevels = [0.1, 1, 10, 100] as const;
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
  label
}: {
  anchor: PointAnchor;
  key: string;
  directKey: string;
  label: string;
}): ParameterDefinition[] => [
  { key, directKey, label, kind: "reference" },
  ...(anchor.mode === "coordinate"
    ? [
        { key: `${key}:x`, directKey: "x", label: `${label} x`, kind: "number" as const },
        { key: `${key}:y`, directKey: "y", label: `${label} y`, kind: "number" as const }
      ]
    : [])
];

export const getParameterDefinitions = (element: CadElement): ParameterDefinition[] => {
  switch (element.type) {
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
        { key: "fromPoint", directKey: "b", label: "基準点", kind: "reference" },
        { key: "dx", directKey: "x", label: "dx", kind: "number" },
        { key: "dy", directKey: "y", label: "dy", kind: "number" }
      ];
    case "polarOffsetPoint":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        { key: "fromPoint", directKey: "b", label: "基準点", kind: "reference" },
        {
          key: "angleDeg",
          directKey: "r",
          label: "角度",
          kind: "number",
          stepLevels: angleNumericParameterStepLevels
        },
        { key: "distance", directKey: "f", label: "距離", kind: "number" }
      ];
    case "line":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          directKey: "s",
          label: "始点"
        }),
        ...pointAnchorParameters({
          anchor: element.endPoint,
          key: "endPoint",
          directKey: "t",
          label: "終点"
        })
      ];
    case "bezierCurve":
      return [
        ...commonParameters,
        ...numericVariableParameters(element),
        ...pointAnchorParameters({
          anchor: element.startPoint,
          key: "startPoint",
          directKey: "s",
          label: "始点"
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
            label: `中間点${index + 1}`
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
          label: "終点"
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
