import { numericValueExpression } from "../geometry/numericExpressions";
import { elementQualifiedName } from "../model/elementNames";
import { derivedPointLabel } from "../model/pointAnchors";
import { isEditingCommandLineStep, type CommandLineSession } from "../commands/commandLineSession";
import type { CreationArgumentValue, CreationStep } from "../commands/creationRecipes";
import type { CadElement, ElementId, LineEndpointReference, NumericValue, PointAnchor } from "../types/geometry";

export type CompletedCommandLineStep = {
  stepIndex: number;
  key: string;
  label: string;
  value: string;
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const elementName = (elementId: ElementId, elements: CadElement[]) => {
  const element = elements.find((item) => item.id === elementId);
  return element ? elementQualifiedName(element, elements) : elementId;
};

export const pointAnchorName = (anchor: PointAnchor, elements: CadElement[]) => {
  if (anchor.mode === "reference") return elementName(anchor.pointId, elements);
  if (anchor.mode === "derived") return derivedPointLabel(anchor.elementId, anchor.pointKey, elements);
  return `(${numericValueExpression(anchor.x)}, ${numericValueExpression(anchor.y)})`;
};

const endpointName = (endpoint: LineEndpointReference, elements: CadElement[]) =>
  `${elementName(endpoint.lineId, elements)}・${endpoint.endpointKey === "start" ? "始点" : "終点"}`;

const valueForStep = (step: CreationStep, value: CreationArgumentValue | string, elements: CadElement[]) => {
  if (step.kind === "name") return String(value);
  if (step.kind === "number") return numericValueExpression(value as NumericValue);
  if (step.kind === "point") return pointAnchorName(value as PointAnchor, elements);
  if (step.kind === "endpoint") return endpointName(value as LineEndpointReference, elements);
  if (step.kind === "line") return elementName(value as ElementId, elements);
  if (step.kind === "pointList") return (value as PointAnchor[]).map((anchor) => pointAnchorName(anchor, elements)).join(", ");
  return (value as ElementId[]).map((elementId) => elementName(elementId, elements)).join(", ");
};

const labelForStep = (step: CreationStep) => step.kind === "name" ? "名前" : step.prompt;

/** Converts completed creation arguments into recipe-ordered, human-readable progress rows. */
export const completedCommandLineSteps = (
  session: CommandLineSession,
  elements: CadElement[]
): CompletedCommandLineStep[] => session.recipe.steps.flatMap((step, stepIndex) => {
  const key = step.kind === "name" ? "name" : step.key;
  if (!hasOwn(session.args, key)) return [];
  const value = session.args[key as keyof typeof session.args];
  if (value === undefined) return [];
  return [{ stepIndex, key, label: labelForStep(step), value: valueForStep(step, value, elements) }];
});

export const commandLineStepLabel = (step: CreationStep | null) =>
  !step ? "入力完了" : labelForStep(step);

/** Supplies editable text only for the input kinds that accept direct typing. */
export const commandLineEditingInputValue = (
  session: CommandLineSession,
  step: CreationStep | null
) => {
  if (!step || !isEditingCommandLineStep(session)) return "";
  if (step.kind === "name") return session.editingDraft === null ? "" : String(session.editingDraft);
  return step.kind === "number" && session.editingDraft !== null
    ? numericValueExpression(session.editingDraft as NumericValue)
    : "";
};
