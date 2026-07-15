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
import { effectiveCommandLineArgs, type CommandLineSession } from "./commandLineSession";

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const isReferenceStep = (kind: CommandLineSession["recipe"]["steps"][number]["kind"]) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

/**
 * Why the ghost could not (or could) be produced. "not-evaluated" is the
 * deliberate non-error case: the insertion position itself is outside the
 * evaluator's reach (after `@stop`, inside a disabled group or an inactive
 * conditional branch), so no preview exists AND no verdict about the value can
 * be derived from evaluation. Step-edit confirmation treats only "invalid" and
 * "missing-input" as rejections.
 */
export type CommandLineGhostPreviewStatus =
  | { kind: "preview"; elements: CadElement[]; evaluationLimitIndex: number }
  | { kind: "missing-input" }
  | { kind: "invalid" }
  | { kind: "not-evaluated" };

/**
 * Classifies the render-only insertion candidate built from the explicitly
 * supplied session inputs. This intentionally does not promote unnamed
 * references: promotion belongs exclusively to the final 4e commit path.
 */
export const commandLineGhostPreviewStatus = ({
  session,
  elements,
  evaluationLimitIndex,
  groupFoldById
}: {
  session: CommandLineSession;
  elements: CadElement[];
  evaluationLimitIndex: number;
  groupFoldById: GroupFoldById;
}): CommandLineGhostPreviewStatus => {
  const placement = creationPlacementForEvaluationLimit(
    elements,
    session.insertionIndex,
    groupFoldById
  );
  const emitted = applyCreationPlacement(
    emitCreationRecipe(session.recipe, effectiveCommandLineArgs(session), {
      elements,
      referenceElements: placement.referenceElements
    }),
    placement
  );

  const hasMissingRequiredInput = session.recipe.steps.some((step) => {
    if (step.kind === "name") return false;
    if (hasOwn(effectiveCommandLineArgs(session), step.key)) return false;
    // A recipe default becomes usable only after skipCurrentStep writes it to
    // args. Never substitute the factory's default for an unanswered prompt.
    if (step.kind === "number") return step.default !== undefined;
    if (!isReferenceStep(step.kind)) return false;
    // Allow omission only when the element's actual parameter definition says
    // it is optional; absent/unknown definitions are deliberately required.
    return findParameterDefinition(emitted, step.key)?.allowNone !== true;
  });
  if (hasMissingRequiredInput) return { kind: "missing-input" };

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
  // Errors take precedence: a broken element may be both erroring and missing
  // from evaluatedElementIds, and that must never read as "outside evaluation".
  if (evaluation.errors.some((error) => error.elementId === emitted.id)) {
    return { kind: "invalid" };
  }
  // evaluatedElementIds tracks the @stop/limit boundary only; a member of a
  // disabled group or an inactive conditional branch stays inside that boundary
  // but is excluded from effectiveEnabledElementIds and computes no geometry —
  // both are "the evaluator cannot see this position", not a value verdict.
  if (
    !evaluation.evaluatedElementIds?.has(emitted.id) ||
    !evaluation.effectiveEnabledElementIds?.has(emitted.id)
  ) {
    return { kind: "not-evaluated" };
  }

  return { kind: "preview", elements: previewElements, evaluationLimitIndex: previewEvaluationLimitIndex };
};

/** Preview payload when one is producible, otherwise null (rendering-side view of the status). */
export const commandLineGhostPreview = (
  input: Parameters<typeof commandLineGhostPreviewStatus>[0]
) => {
  const status = commandLineGhostPreviewStatus(input);
  return status.kind === "preview"
    ? { elements: status.elements, evaluationLimitIndex: status.evaluationLimitIndex }
    : null;
};

/** Refreshes or clears the single established document-preview channel. */
export const syncCommandLineGhostPreview = (
  session: CommandLineSession
): CommandLineGhostPreviewStatus["kind"] => {
  const document = useCadDocumentStore.getState();
  const status = commandLineGhostPreviewStatus({
    session,
    elements: document.elements,
    evaluationLimitIndex: document.evaluationLimitIndex,
    groupFoldById: useCadUiStore.getState().groupFoldById
  });
  if (status.kind !== "preview") {
    document.clearPreviewDocumentChange();
    return status.kind;
  }
  const previewed = document.previewDocumentChange({
    elements: status.elements,
    evaluationLimitIndex: status.evaluationLimitIndex
  }).status === "applied";
  // A guarded preview channel (e.g. composition) is not a value problem, but it
  // also is not a confirmed preview; report it as invalid so edit confirmation
  // stays conservative.
  return previewed ? "preview" : "invalid";
};

export const clearCommandLineGhostPreview = () =>
  useCadDocumentStore.getState().clearPreviewDocumentChange();
