import type { CadElement, ElementId } from "../types/geometry";

export type ParameterValueKind = "text" | "boolean" | "number" | "reference";

export type ParameterKey =
  | "name"
  | "visible"
  | "enabled"
  | "x"
  | "y"
  | "fromPointId"
  | "dx"
  | "dy"
  | "angleDeg"
  | "distance"
  | "startPointId"
  | "endPointId";

export type ParameterDefinition = {
  key: ParameterKey;
  directKey: string;
  label: string;
  kind: ParameterValueKind;
};

export const defaultNumericParameterStep = 1;

const commonParameters: ParameterDefinition[] = [
  { key: "name", directKey: "n", label: "名前", kind: "text" },
  { key: "visible", directKey: "v", label: "表示", kind: "boolean" },
  { key: "enabled", directKey: "a", label: "評価", kind: "boolean" }
];

export const getParameterDefinitions = (element: CadElement): ParameterDefinition[] => {
  switch (element.type) {
    case "freePoint":
      return [
        ...commonParameters,
        { key: "x", directKey: "x", label: "x", kind: "number" },
        { key: "y", directKey: "y", label: "y", kind: "number" }
      ];
    case "offsetPoint":
      return [
        ...commonParameters,
        { key: "fromPointId", directKey: "b", label: "基準点", kind: "reference" },
        { key: "dx", directKey: "x", label: "dx", kind: "number" },
        { key: "dy", directKey: "y", label: "dy", kind: "number" }
      ];
    case "polarOffsetPoint":
      return [
        ...commonParameters,
        { key: "fromPointId", directKey: "b", label: "基準点", kind: "reference" },
        { key: "angleDeg", directKey: "r", label: "角度", kind: "number" },
        { key: "distance", directKey: "f", label: "距離", kind: "number" }
      ];
    case "line":
      return [
        ...commonParameters,
        { key: "startPointId", directKey: "s", label: "始点", kind: "reference" },
        { key: "endPointId", directKey: "t", label: "終点", kind: "reference" }
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

export const isPointElement = (element: CadElement) =>
  element.type === "freePoint" ||
  element.type === "offsetPoint" ||
  element.type === "polarOffsetPoint";

export const pointReferenceOptions = (elements: CadElement[]): ElementId[] =>
  elements.filter(isPointElement).map((element) => element.id);

export const getNumericParameterStep = (element: CadElement, key: ParameterKey) =>
  element.numericParameterSteps?.[key] ?? defaultNumericParameterStep;
