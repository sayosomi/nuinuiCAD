import { parseVariableParameterKey } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type {
  CadElement,
  ComputedVariable,
  ElementId,
  VariableElement
} from "../types/geometry";
import { variableIsInScope } from "./variableScope";

export type NumericVariableReferenceOption = {
  expression: string;
  displayExpression: string;
  label: string;
  detail: string;
  source: "local" | "global" | "group";
  elementId?: ElementId;
  variableId?: string;
};

export const availableNumericVariableReferenceOptions = ({
  element,
  elements,
  parameterKey,
  computedVariables
}: {
  element: CadElement;
  elements: CadElement[];
  parameterKey: ParameterKey;
  computedVariables?: Map<ElementId, ComputedVariable>;
}): NumericVariableReferenceOption[] => {
  const targetIndex = elements.findIndex((item) => item.id === element.id);
  const elementsById = new Map(elements.map((item) => [item.id, item]));
  const options: NumericVariableReferenceOption[] = [];

  const localVariable = parseVariableParameterKey(parameterKey);
  const localVariables = element.numericVariables ?? [];
  const localVariableLimit = localVariable
    ? localVariables.findIndex((variable) => variable.id === localVariable.variableId)
    : localVariables.length;
  const visibleLocalVariables = localVariables.slice(0, Math.max(0, localVariableLimit));
  const localVariableNameCounts = new Map<string, number>();
  for (const variable of visibleLocalVariables) {
    localVariableNameCounts.set(variable.name, (localVariableNameCounts.get(variable.name) ?? 0) + 1);
  }
  for (const variable of visibleLocalVariables) {
    const displayExpression = (localVariableNameCounts.get(variable.name) ?? 0) > 1
      ? `@${variable.id}`
      : `@${element.name}.${variable.name}`;
    options.push({
      expression: `@${variable.id}`,
      displayExpression,
      label: displayExpression,
      detail: "要素内変数",
      source: "local",
      variableId: variable.id
    });
  }

  if (targetIndex < 0) return options;

  for (let index = 0; index < targetIndex; index += 1) {
    const candidate = elements[index];
    if (candidate.type !== "variable") continue;
    if (!variableIsInScope({ variable: candidate, consumer: element, elementsById })) continue;
    if (computedVariables && !computedVariables.has(candidate.id)) continue;

    options.push({
      expression: `@${candidate.id}`,
      displayExpression: `@${candidate.name}`,
      label: `@${candidate.name}`,
      detail: candidate.scope === "global" ? "全体変数" : "グループ変数",
      source: candidate.scope,
      elementId: candidate.id
    });
  }

  return options;
};

export const isVariableReferenceCandidate = (
  candidate: CadElement,
  consumer: CadElement,
  elements: CadElement[],
  computedVariables?: Map<ElementId, ComputedVariable>
): candidate is VariableElement => {
  if (candidate.type !== "variable") return false;
  const candidateIndex = elements.findIndex((element) => element.id === candidate.id);
  const consumerIndex = elements.findIndex((element) => element.id === consumer.id);
  if (candidateIndex < 0 || consumerIndex < 0 || candidateIndex >= consumerIndex) return false;
  if (computedVariables && !computedVariables.has(candidate.id)) return false;
  return variableIsInScope({
    variable: candidate,
    consumer,
    elementsById: new Map(elements.map((element) => [element.id, element]))
  });
};
