import type { GroupTemplate, GroupTemplateInput, TemplateInstantiationInputValues } from "./groupTemplate";
import type { ConditionalBranch, ElementId, NumericValue, PointAnchor } from "../types/geometry";

export const TEMPLATE_INSERTION_PICK_TARGET_ID = "__template-insertion__";
export const TEMPLATE_INSERTION_NUMERIC_TARGET_ID = "__template-insertion-numeric__";

export type ActiveTemplateInsertion = {
  template: GroupTemplate;
  inputValues: TemplateInstantiationInputValues;
  currentInputId: string | null;
  insertionIndex: number;
  parentGroupId?: ElementId;
  conditionalBranch?: ConditionalBranch;
  error: string | null;
};

export const defaultTemplateInputValue = (input: GroupTemplateInput): NumericValue | string =>
  input.kind === "numeric" ? input.defaultValue : "";

export const defaultTemplateInputValues = (template: GroupTemplate): TemplateInstantiationInputValues =>
  Object.fromEntries(template.inputs.map((input) => [input.id, defaultTemplateInputValue(input)]));

export const templateInputValueIsFilled = (
  input: GroupTemplateInput,
  value: NumericValue | ElementId | PointAnchor | null | undefined
) => {
  if (input.kind === "numeric") return value !== null && value !== undefined;
  if (input.kind === "point") {
    return typeof value === "string" && value.length > 0
      ? true
      : typeof value === "object" && value !== null && "mode" in value;
  }
  return typeof value === "string" && value.length > 0;
};

export const currentTemplateInput = (insertion: ActiveTemplateInsertion | null) =>
  insertion?.template.inputs.find((input) => input.id === insertion.currentInputId) ?? null;

export const firstIncompleteTemplateInput = (insertion: ActiveTemplateInsertion) =>
  insertion.template.inputs.find((input) =>
    !templateInputValueIsFilled(input, insertion.inputValues[input.id])
  ) ?? null;

export const templateInputProgress = (insertion: ActiveTemplateInsertion) => {
  const total = insertion.template.inputs.length;
  const completed = insertion.template.inputs.filter((input) =>
    templateInputValueIsFilled(input, insertion.inputValues[input.id])
  ).length;
  return { completed, total };
};

export const templateInsertionCanConfirm = (insertion: ActiveTemplateInsertion) =>
  insertion.template.inputs.every((input) =>
    templateInputValueIsFilled(input, insertion.inputValues[input.id])
  );

export const nextTemplateInputId = (
  insertion: ActiveTemplateInsertion,
  offset: number
) => {
  const { inputs } = insertion.template;
  if (inputs.length === 0) return null;
  const currentIndex = insertion.currentInputId
    ? inputs.findIndex((input) => input.id === insertion.currentInputId)
    : -1;
  const nextIndex =
    currentIndex < 0
      ? offset >= 0 ? 0 : inputs.length - 1
      : (currentIndex + offset + inputs.length) % inputs.length;
  return inputs[nextIndex].id;
};

export const templateInputLabel = (input: GroupTemplateInput | null) => {
  if (!input) return "入力なし";
  if (input.kind === "numeric") return `${input.label}（数値/式）`;
  if (input.kind === "point") return `${input.label}（点）`;
  return `${input.label}（線）`;
};
