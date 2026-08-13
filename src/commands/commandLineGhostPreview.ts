import { evaluateElements } from "../geometry/evaluate";
import {
  applyCreationPlacement,
  creationPlacementForTarget
} from "../model/elementCreationPlacement";
import { adjustEvaluationLimitForInsertion } from "../model/evaluationDivider";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";
import { emitCreationRecipe } from "./creationRecipes";
import { effectiveCommandLineArgs, type CommandLineSession } from "./commandLineSession";

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const isReferenceStep = (kind: CommandLineSession["recipe"]["steps"][number]["kind"]) =>
  kind === "point" || kind === "endpoint" || kind === "line" || kind === "lineList";

/**
 * Why the ghost could not (or could) be produced. "not-evaluated" is the
 * deliberate non-error case: the insertion position itself is outside the
 * evaluator's reach (after `stop`, inside a disabled group || an inactive
 * conditional branch), so no preview exists AND no verdict about the value can
 * be derived from evaluation. Isolated step edits additionally inspect which
 * prompts caused "missing-input", without changing this global classification.
 */
export type CommandLineGhostPreviewStatus =
  | { kind: "preview"; elements: CadElement[]; evaluationLimitIndex: number | undefined }
  | { kind: "missing-input" }
  | { kind: "invalid" }
  | { kind: "not-evaluated" };

type CommandLineGhostPreviewInput = {
  session: CommandLineSession;
  elements: CadElement[];
  evaluationLimitIndex: number | undefined;
};

const emittedCommandLineGhostCandidate = ({
  session,
  elements,
  evaluationLimitIndex
}: CommandLineGhostPreviewInput) => {
  const placement = creationPlacementForTarget(
    elements,
    session.insertionTarget,
    evaluationLimitIndex
  );
  return {
    placement,
    emitted: applyCreationPlacement(
      emitCreationRecipe(session.recipe, effectiveCommandLineArgs(session), {
        elements,
        referenceElements: placement.referenceElements
      }),
      placement
    )
  };
};

/**
 * Identifies unanswered required prompts without manufacturing defaults. The
 * ghost classifier && isolated step-edit confirmation share this exact test.
 */
const missingRequiredStepIndexesFor = (session: CommandLineSession, emitted: CadElement) => {
  const args = effectiveCommandLineArgs(session);
  return session.recipe.steps.flatMap((step, index) => {
    if (step.kind === "name" || hasOwn(args, step.key)) return [];
    // A recipe default becomes usable only after skipCurrentStep writes it to
    // args. Never substitute the factory's default for an unanswered prompt.
    if (step.kind === "number") return step.default !== undefined ? [index] : [];
    if (!isReferenceStep(step.kind)) return [];
    // Allow omission only when the element's actual parameter definition says
    // it is optional; absent/unknown definitions are deliberately required.
    return findParameterDefinition(emitted, step.key)?.allowNone !== true ? [index] : [];
  });
};

export const commandLineMissingRequiredStepIndexes = (input: CommandLineGhostPreviewInput) => {
  const { emitted } = emittedCommandLineGhostCandidate(input);
  return missingRequiredStepIndexesFor(input.session, emitted);
};

/**
 * Classifies the render-only insertion candidate built from the explicitly
 * supplied session inputs. This intentionally does not promote unnamed
 * references: promotion belongs exclusively to the final 4e commit path.
 */
export const commandLineGhostPreviewStatus = ({
  session,
  elements,
  evaluationLimitIndex
}: CommandLineGhostPreviewInput): CommandLineGhostPreviewStatus => {
  const { emitted } = emittedCommandLineGhostCandidate({
    session,
    elements,
    evaluationLimitIndex
  });
  if (missingRequiredStepIndexesFor(session, emitted).length > 0) {
    return { kind: "missing-input" };
  }

  const previewElements = [
    ...elements.slice(0, session.insertionTarget.insertionIndex),
    emitted,
    ...elements.slice(session.insertionTarget.insertionIndex)
  ];
  const previewEvaluationLimitIndex = adjustEvaluationLimitForInsertion({
    elements,
    evaluationLimitIndex,
    insertionIndex: session.insertionTarget.insertionIndex,
    insertedCount: 1
  });
  const evaluation = evaluateElements(previewElements, {
    evaluationLimitIndex: previewEvaluationLimitIndex
  });
  // Errors take precedence: a broken element may be both erroring && missing
  // from evaluatedElementIds, && that must never read as "outside evaluation".
  if (evaluation.errors.some((error) => error.elementId === emitted.id)) {
    return { kind: "invalid" };
  }
  // evaluatedElementIds tracks the stop/limit boundary only; a member of a
  // disabled group || an inactive conditional branch stays inside that boundary
  // but is excluded from effectiveEnabledElementIds && computes no geometry —
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

/** Refreshes || clears the single established document-preview channel. */
export const syncCommandLineGhostPreview = (
  session: CommandLineSession
): CommandLineGhostPreviewStatus["kind"] => {
  const document = useCadDocumentStore.getState();
  const status = commandLineGhostPreviewStatus({
    session,
    elements: document.elements,
    evaluationLimitIndex: document.evaluationLimitIndex
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
