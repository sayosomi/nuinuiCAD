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
  source: "local" | "global" | "group" | "typed";
  elementId?: ElementId;
  variableId?: string;
};

export type NumericVariableReferencePosition = {
  /** Elements visible from this position, already sliced to it (document order). */
  referenceElements: readonly CadElement[];
  parentGroupId?: ElementId;
  /** When supplied, a variable not yet reached by evaluation (e.g. past @stop) is excluded. */
  computedVariables?: Map<ElementId, ComputedVariable>;
};

/**
 * Position-only primitive: top-level `variable` element candidates visible from a
 * document position, with no consuming CadElement required (used both by
 * availableNumericVariableReferenceOptions below and by callers that only know a
 * planned insertion position, not yet a real element). Insertion text prefers the
 * human-readable `@name`, falling back to `@id` only on a name collision among the
 * candidates themselves.
 */
export const numericVariableReferenceOptionsForPosition = ({
  referenceElements,
  parentGroupId,
  computedVariables
}: NumericVariableReferencePosition): NumericVariableReferenceOption[] => {
  const elementsById = new Map(referenceElements.map((item) => [item.id, item]));
  const consumer: Pick<CadElement, "parentGroupId"> = { parentGroupId };
  const candidates = referenceElements.filter(
    (candidate): candidate is VariableElement => candidate.type === "variable"
  );
  const nameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
  }

  const options: NumericVariableReferenceOption[] = [];
  for (const candidate of candidates) {
    if (computedVariables && !computedVariables.has(candidate.id)) continue;
    if (!variableIsInScope({ variable: candidate, consumer, elementsById })) continue;
    const expression = (nameCounts.get(candidate.name) ?? 0) > 1 ? `@${candidate.id}` : `@${candidate.name}`;
    options.push({
      expression,
      displayExpression: `@${candidate.name}`,
      label: `@${candidate.name}`,
      detail: candidate.scope === "global" ? "全体変数" : "グループ変数",
      source: candidate.scope,
      elementId: candidate.id
    });
  }
  return options;
};

/**
 * Position-only primitive for an element's own local numericVariables: candidates
 * are always the ones before `localVariableLimit` in that element's own list
 * (self-reference within the same element only — never other elements, matching
 * evaluateLocalVariables's per-element evaluation). Always inserts `@id` (never
 * `@name`) since local variable names have no uniqueness guarantee within an
 * element the way top-level variable names are expected to.
 */
export const localNumericVariableReferenceOptions = ({
  element,
  localVariableLimit
}: {
  element: Pick<CadElement, "name" | "numericVariables">;
  localVariableLimit: number;
}): NumericVariableReferenceOption[] => {
  const localVariables = element.numericVariables ?? [];
  const visibleLocalVariables = localVariables.slice(0, Math.max(0, localVariableLimit));
  const nameCounts = new Map<string, number>();
  for (const variable of visibleLocalVariables) {
    nameCounts.set(variable.name, (nameCounts.get(variable.name) ?? 0) + 1);
  }
  return visibleLocalVariables.map((variable) => {
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
  const localVariable = parseVariableParameterKey(parameterKey);
  const localVariables = element.numericVariables ?? [];
  const localVariableLimit = localVariable
    ? localVariables.findIndex((variable) => variable.id === localVariable.variableId)
    : localVariables.length;
  const options = localNumericVariableReferenceOptions({ element, localVariableLimit });

  if (targetIndex < 0) return options;

  return [
    ...options,
    ...numericVariableReferenceOptionsForPosition({
      referenceElements: elements.slice(0, targetIndex),
      parentGroupId: element.parentGroupId,
      computedVariables
    })
  ];
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
