import { evaluateElements } from "../geometry/evaluate";
import {
  applyCreationPlacement,
  creationPlacementForEvaluationLimit
} from "../model/elementCreationPlacement";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import type { GroupFoldById } from "../model/groups";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { emitCreationRecipe } from "./creationRecipes";
import type { CommandLineSession } from "./commandLineSession";

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const isReferenceStep = (kind: CommandLineSession["recipe"]["steps"][number]["kind"]) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

/**
 * Produces a render-only insertion candidate when its explicitly supplied
 * session inputs are sufficient. This intentionally does not promote unnamed
 * references: promotion belongs exclusively to the final 4e commit path.
 */
export const commandLineGhostPreview = ({
  session,
  elements,
  evaluationLimitIndex,
  groupFoldById
}: {
  session: CommandLineSession;
  elements: CadElement[];
  evaluationLimitIndex: number;
  groupFoldById: GroupFoldById;
}) => {
  const placement = creationPlacementForEvaluationLimit(
    elements,
    session.insertionIndex,
    groupFoldById
  );
  const emitted = applyCreationPlacement(
    emitCreationRecipe(session.recipe, session.args, {
      elements,
      referenceElements: placement.referenceElements
    }),
    placement
  );

  const hasMissingRequiredInput = session.recipe.steps.some((step) => {
    if (step.kind === "name") return false;
    if (hasOwn(session.args, step.key)) return false;
    // A recipe default becomes usable only after skipCurrentStep writes it to
    // args. Never substitute the factory's default for an unanswered prompt.
    if (step.kind === "number") return step.default !== undefined;
    if (!isReferenceStep(step.kind)) return false;
    // Allow omission only when the element's actual parameter definition says
    // it is optional; absent/unknown definitions are deliberately required.
    return findParameterDefinition(emitted, step.key)?.allowNone !== true;
  });
  if (hasMissingRequiredInput) return null;

  const previewElements = [
    ...elements.slice(0, session.insertionIndex),
    emitted,
    ...elements.slice(session.insertionIndex)
  ];
  const previewEvaluationLimitIndex = adjustEvaluationLimitForInsertion({
    elements,
    evaluationLimitIndex,
    insertionIndex: session.insertionIndex,
    insertedCount: 1
  });
  const evaluation = evaluateElements(previewElements, {
    evaluationLimitIndex: previewEvaluationLimitIndex
  });
  if (
    !evaluation.evaluatedElementIds?.has(emitted.id) ||
    evaluation.errors.some((error) => error.elementId === emitted.id)
  ) {
    return null;
  }

  return { elements: previewElements, evaluationLimitIndex: previewEvaluationLimitIndex };
};

/** Refreshes or clears the single established document-preview channel. */
export const syncCommandLineGhostPreview = (session: CommandLineSession) => {
  const document = useCadDocumentStore.getState();
  const preview = commandLineGhostPreview({
    session,
    elements: document.elements,
    evaluationLimitIndex: document.evaluationLimitIndex,
    groupFoldById: useCadUiStore.getState().groupFoldById
  });
  if (!preview) {
    document.clearPreviewDocumentChange();
    return false;
  }
  return document.previewDocumentChange(preview).status === "applied";
};

export const clearCommandLineGhostPreview = () =>
  useCadDocumentStore.getState().clearPreviewDocumentChange();
