import { parseVariableParameterKey } from "../parameters/parameterAccess";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElement } from "../types/geometry";

export type NumericReferenceOption = {
  expression: string;
  displayExpression: string;
  label: string;
  detail: string;
  source: "local" | "typed" | "iteration";
  variableId?: string;
};

/** Candidates from the current element's independent local numeric namespace. */
export const localNumericReferenceOptions = ({
  element,
  localVariableLimit
}: {
  element: Pick<CadElement, "name" | "numericVariables">;
  localVariableLimit: number;
}): NumericReferenceOption[] => {
  const visible = (element.numericVariables ?? []).slice(0, Math.max(0, localVariableLimit));
  const nameCounts = new Map<string, number>();
  for (const variable of visible) nameCounts.set(variable.name, (nameCounts.get(variable.name) ?? 0) + 1);
  return visible.map((variable) => {
    const displayExpression = (nameCounts.get(variable.name) ?? 0) > 1
      ? `@${variable.id}`
      : `@${element.name}.${variable.name}`;
    return {
      expression: `@${variable.id}`,
      displayExpression,
      label: displayExpression,
      detail: "要素内変数",
      source: "local" as const,
      variableId: variable.id
    };
  });
};

export const localNumericReferenceOptionsForParameter = ({
  element,
  parameterKey
}: {
  element: CadElement;
  parameterKey: ParameterKey;
}): NumericReferenceOption[] => {
  const localVariables = element.numericVariables ?? [];
  const target = parseVariableParameterKey(parameterKey);
  const localVariableLimit = target
    ? localVariables.findIndex((variable) => variable.id === target.variableId)
    : localVariables.length;
  return localNumericReferenceOptions({ element, localVariableLimit });
};

export const numericReferenceOptionsForPool = (
  variables: readonly { id: string; name: string }[],
  detail: string
): NumericReferenceOption[] => variables.map((variable) => ({
  expression: `@${variable.id}`,
  displayExpression: `@${variable.name}`,
  label: `@${variable.name}`,
  detail,
  source: "local",
  variableId: variable.id
}));
