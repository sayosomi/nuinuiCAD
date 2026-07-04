import { isNumericExpression } from "../geometry/numericExpressions";
import { tokenize, type Token } from "../geometry/numericExpressionParser";
import { selectedIndexes } from "../model/documentSelection";
import { getDirectParentIds } from "../model/dependencies";
import { createCadElementId } from "../model/cadIds";
import { remapElementReferences } from "../model/elementDuplication";
import { fallbackElementName, makeUniqueElementName } from "../model/elementNames";
import { isGroupElement, subtreeIdsForElement } from "../model/groups";
import { isLineLikeElement, isPointLikeElement } from "../commands/commandRuntime";
import type {
  CadElement,
  ElementId,
  NumericValue,
  PointAnchor
} from "../types/geometry";

export type GroupTemplateInput =
  | {
      id: string;
      kind: "numeric";
      label: string;
      variableElementId: ElementId;
      defaultValue: NumericValue;
    }
  | {
      id: string;
      kind: "point";
      label: string;
      sourceElementId: ElementId;
    }
  | {
      id: string;
      kind: "line";
      label: string;
      sourceElementId: ElementId;
    };

export type GroupTemplate = {
  id: string;
  name: string;
  rootGroupId: ElementId;
  elements: CadElement[];
  inputs: GroupTemplateInput[];
  createdAt: string;
  updatedAt: string;
};

export type GroupTemplateLibrary = {
  version: 1;
  templates: GroupTemplate[];
};

export type TemplateInstantiationInputValues = Record<
  string,
  NumericValue | ElementId | PointAnchor | null | undefined
>;

export type TemplateInstantiationChange = {
  elements: CadElement[];
  selectedElementId: ElementId | null;
  selectedElementIds: ElementId[];
  selectionAnchorElementId: ElementId | null;
  insertionIndex: number;
  insertedCount: number;
};

const unique = <T,>(values: T[]) => Array.from(new Set(values));

export const templateInputId = () => `template-input-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createGroupTemplateId = () =>
  `group-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const expressionTokenText = (
  token: Token,
  idMap: Map<ElementId, ElementId>
) => {
  switch (token.type) {
    case "number":
      return `${token.value}`;
    case "reference":
      return `${idMap.get(token.elementId) ?? token.elementId}.${token.property}`;
    case "element":
      return idMap.get(token.elementId) ?? token.elementId;
    case "localVariable":
      return `@${idMap.get(token.variableId) ?? token.variableId}`;
    case "function":
      return token.name;
    case "operator":
    case "comparisonOperator":
    case "logicalOperator":
      return ` ${token.value} `;
    case "comma":
      return ", ";
    case "leftParen":
      return "(";
    case "rightParen":
      return ")";
  }
};

const remapNumericInputValue = (
  value: NumericValue,
  idMap: Map<ElementId, ElementId>
): NumericValue => {
  if (!isNumericExpression(value)) return value;
  try {
    return {
      ...value,
      expression: tokenize(value.expression)
        .map((token) => expressionTokenText(token, idMap))
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    };
  } catch {
    return value;
  }
};

const pointInputAnchorReplacement = (
  value: unknown,
  replacements: Map<ElementId, PointAnchor>
): unknown => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => pointInputAnchorReplacement(item, replacements));
  }

  const record = value as Record<string, unknown>;
  if (record.mode === "reference" && typeof record.pointId === "string") {
    return replacements.get(record.pointId) ?? value;
  }
  if (record.mode === "derived" && typeof record.elementId === "string") {
    return replacements.get(record.elementId) ?? value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === "fromPointId" && typeof item === "string" && replacements.has(item)) {
      const anchor = replacements.get(item);
      if (anchor?.mode === "reference") next[key] = anchor.pointId;
      continue;
    }
    next[key] = pointInputAnchorReplacement(item, replacements);
  }
  return next;
};

const applyPointInputAnchorReplacements = (
  element: CadElement,
  replacements: Map<ElementId, PointAnchor>
): CadElement =>
  replacements.size === 0
    ? element
    : pointInputAnchorReplacement(element, replacements) as CadElement;

const externalReferenceInputs = (
  elements: CadElement[],
  templateElements: CadElement[],
  templateIds: Set<ElementId>
): GroupTemplateInput[] => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  return unique(
    templateElements.flatMap((element) => getDirectParentIds(element))
      .filter((id) => !templateIds.has(id))
  ).flatMap((id): GroupTemplateInput[] => {
    const element = elementsById.get(id);
    if (!element) return [];
    if (isPointLikeElement(element)) {
      return [{
        id: `point:${id}`,
        kind: "point" as const,
        label: element.name || id,
        sourceElementId: id
      }];
    }
    if (isLineLikeElement(element)) {
      return [{
        id: `line:${id}`,
        kind: "line" as const,
        label: element.name || id,
        sourceElementId: id
      }];
    }
    return [];
  });
};

export const candidateNumericTemplateInputs = (templateElements: CadElement[]) =>
  templateElements
    .filter((element) => element.type === "variable")
    .map((element) => ({
      id: `numeric:${element.id}`,
      kind: "numeric" as const,
      label: element.name || element.id,
      variableElementId: element.id,
      defaultValue: element.expression
    }));

export const createTemplateFromGroup = ({
  elements,
  groupId,
  name,
  numericVariableElementIds = []
}: {
  elements: CadElement[];
  groupId: ElementId;
  name?: string;
  numericVariableElementIds?: ElementId[];
}): GroupTemplate => {
  const root = elements.find((element) => element.id === groupId);
  if (!root || !isGroupElement(root)) {
    throw new Error("テンプレート化するグループを選択してください。");
  }
  const ids = subtreeIdsForElement(elements, groupId);
  const idSet = new Set(ids);
  const templateElements = elements.filter((element) => idSet.has(element.id));
  const image = templateElements.find((element) => element.type === "image");
  if (image) {
    throw new Error("画像を含むグループはテンプレート化できません。");
  }
  const now = new Date().toISOString();
  const numericInputs = candidateNumericTemplateInputs(templateElements)
    .filter((input) => numericVariableElementIds.includes(input.variableElementId));
  return {
    id: createGroupTemplateId(),
    name: name?.trim() || root.name || "グループテンプレート",
    rootGroupId: groupId,
    elements: structuredClone(templateElements) as CadElement[],
    inputs: [...externalReferenceInputs(elements, templateElements, idSet), ...numericInputs],
    createdAt: now,
    updatedAt: now
  };
};

export const instantiateGroupTemplate = ({
  elements,
  template,
  inputValues,
  insertionIndex
}: {
  elements: CadElement[];
  template: GroupTemplate;
  inputValues: TemplateInstantiationInputValues;
  insertionIndex?: number;
}): TemplateInstantiationChange => {
  const targetIndex = Math.min(Math.max(insertionIndex ?? elements.length, 0), elements.length);
  const idMap = new Map<ElementId, ElementId>();
  const pointInputReplacements = new Map<ElementId, PointAnchor>();
  for (const element of template.elements) {
    idMap.set(element.id, createCadElementId(element.type));
  }
  for (const input of template.inputs) {
    if (input.kind === "line") {
      const value = inputValues[input.id];
      if (typeof value !== "string") {
        throw new Error(`${input.label} を指定してください。`);
      }
      idMap.set(input.sourceElementId, value);
    }
    if (input.kind === "point") {
      const value = inputValues[input.id];
      if (typeof value === "string" && value.length > 0) {
        idMap.set(input.sourceElementId, value);
      } else if (value && typeof value === "object" && "mode" in value) {
        pointInputReplacements.set(input.sourceElementId, value as PointAnchor);
      } else {
        throw new Error(`${input.label} を指定してください。`);
      }
    }
  }

  const variableInputs = new Map(
    template.inputs
      .filter((input): input is Extract<GroupTemplateInput, { kind: "numeric" }> => input.kind === "numeric")
      .map((input) => [input.variableElementId, input])
  );

  const inserted: CadElement[] = [];
  for (const original of template.elements) {
    const copiedId = idMap.get(original.id);
    if (!copiedId) continue;
    const baseName = original.name.trim() || fallbackElementName(original.type);
    let copied = {
      ...structuredClone(original),
      id: copiedId,
      name: makeUniqueElementName({
        elements: [...elements, ...inserted],
        elementId: copiedId,
        requestedName: baseName,
        fallbackBaseName: fallbackElementName(original.type)
      }),
      parentGroupId: original.parentGroupId ? idMap.get(original.parentGroupId) : undefined
    } as CadElement;
    copied = applyPointInputAnchorReplacements(copied, pointInputReplacements);
    copied = remapElementReferences(copied, idMap);

    const variableInput = variableInputs.get(original.id);
    if (variableInput && copied.type === "variable") {
      const value = inputValues[variableInput.id] ?? variableInput.defaultValue;
      copied = {
        ...copied,
        valueMode: "expression",
        expression: remapNumericInputValue(value as NumericValue, idMap)
      };
    }
    inserted.push(copied);
  }

  const insertedIds = inserted.map((element) => element.id);
  return {
    elements: [
      ...elements.slice(0, targetIndex),
      ...inserted,
      ...elements.slice(targetIndex)
    ],
    selectedElementId: idMap.get(template.rootGroupId) ?? insertedIds[0] ?? null,
    selectedElementIds: insertedIds,
    selectionAnchorElementId: idMap.get(template.rootGroupId) ?? insertedIds[0] ?? null,
    insertionIndex: targetIndex,
    insertedCount: inserted.length
  };
};

export const insertionIndexAfterSelection = (elements: CadElement[], selectedIds: ElementId[]) => {
  const ids = selectedIds.flatMap((id) => subtreeIdsForElement(elements, id));
  const indexes = selectedIndexes(elements, ids);
  return (indexes.at(-1) ?? elements.length - 1) + 1;
};
