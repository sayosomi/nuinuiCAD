import { resolveElementName } from "../model/elementNames";
import type { CadElement, ElementId, EvaluationResult } from "../types/geometry";
import {
  computedPathsForGeometry,
  formatValue,
  numericReferenceValueForPath,
  parameterPathsForElement
} from "./numericReferencePaths";

/**
 * Own type for element-parameter (`ElementName.parameterKey`) candidates, kept
 * independent of NumericVariableReferenceOption (the @variable-specific type):
 * this pure layer must not depend on, or grow, the @variable type. UI attach
 * points (CommandLineBar, PrintLayoutView) convert to the popover's expected
 * shape locally; the CM glue (cmAutocomplete.ts) maps this directly to CM's
 * own Completion shape.
 */
export type ElementParameterReferenceOption = {
  path: string;
  label: string;
  detail: string;
  elementId: ElementId;
};

type ReferenceablePath = { path: string; valueLabel: string };

/**
 * Is `elementId` currently a valid reference target at all, independent of
 * which path is being asked about? Reuses the evaluator's own bookkeeping
 * (effectiveEnabledElementIds already folds together: forward reference,
 * disabled (self/ancestor group), conditional-group-inactive branch, and
 * post-@stop exclusion; errors carries per-element evaluation failures) so
 * this feature never reimplements eligibility rules. A missing
 * effectiveEnabledElementIds (older/partial EvaluationResult shapes) is
 * treated as "cannot confirm eligibility" -> excluded, never guessed.
 */
const elementIsCurrentlyReferenceable = (
  elementId: ElementId,
  evaluation: Pick<EvaluationResult, "effectiveEnabledElementIds" | "errors">
) =>
  (evaluation.effectiveEnabledElementIds?.has(elementId) ?? false) &&
  !evaluation.errors.some((error) => error.elementId === elementId);

/**
 * Enumerates the paths for `element` that the evaluator's own
 * numericReferenceValueForPath currently accepts and can resolve to a value.
 * Guards params.* the same way as geometry-derived paths: a disabled or
 * invalid (evaluation error) element never contributes a candidate, even for
 * a params.* path whose raw saved value would otherwise evaluate fine on its
 * own (numericReferenceValueForPath's params.* branch reads the saved value
 * directly and does not itself check the owning element's enabled/error
 * state - see elementIsCurrentlyReferenceable above).
 */
export const referenceablePathsForElement = (
  element: CadElement,
  elements: readonly CadElement[],
  evaluation: Pick<EvaluationResult, "computedGeometry" | "effectiveEnabledElementIds" | "errors">
): ReferenceablePath[] => {
  if (!elementIsCurrentlyReferenceable(element.id, evaluation)) return [];

  const context = {
    elements: elements as CadElement[],
    evaluation: evaluation as EvaluationResult
  };
  const candidatePaths = [
    ...computedPathsForGeometry(evaluation.computedGeometry.get(element.id)),
    ...parameterPathsForElement(element)
  ];

  return candidatePaths.flatMap((path) => {
    const value = numericReferenceValueForPath(element, path, context);
    return value === undefined ? [] : [{ path, valueLabel: formatValue(value, path) }];
  });
};

export type ElementParameterReferencePosition = {
  /** Elements visible from this position, already sliced to it (document order). */
  referenceElements: readonly CadElement[];
  /** The "ElementName" text typed immediately before the dot. */
  elementToken: string;
  currentElement?: Pick<CadElement, "parentGroupId">;
  evaluation: Pick<EvaluationResult, "computedGeometry" | "effectiveEnabledElementIds" | "errors">;
};

/**
 * Position-only primitive: resolves `elementToken` against `referenceElements`
 * using the same name-resolution/namespace/ambiguity rules the evaluator
 * itself uses (resolveElementName), then lists that element's currently
 * referenceable parameter paths. Returns [] (never guesses) when the token is
 * missing or ambiguous.
 */
export const elementParameterReferenceOptionsForPosition = ({
  referenceElements,
  elementToken,
  currentElement,
  evaluation
}: ElementParameterReferencePosition): ElementParameterReferenceOption[] => {
  const resolution = resolveElementName({
    token: elementToken,
    elements: referenceElements as CadElement[],
    currentElement
  });
  if (resolution.status !== "resolved") return [];

  return referenceablePathsForElement(resolution.element, referenceElements, evaluation).map(({ path, valueLabel }) => ({
    path,
    label: path,
    detail: `${resolution.element.name} · ${valueLabel}`,
    elementId: resolution.element.id
  }));
};

/**
 * Element-property completion's candidate result, made explicit so a caller
 * can never conflate "evaluation hasn't confirmed this position's eligibility
 * yet" with "confirmed: no candidates". Tauri's Rust-first evaluation
 * (useEvaluationEngine.ts) is asynchronous, so a freshly compiled element
 * (e.g. a `line` just finished on an earlier statement) can be present in
 * `referenceElements` (the compiled/parsed document already has it - see
 * compileCanonicalText.ts's last-good fallback) well before Rust's next
 * evaluation round-trip resolves and folds it into `evaluation`. The `@`
 * typed-binding completion path has no equivalent gap (it only depends on
 * the synchronous compile-time `bindingAnalysis`, never on evaluation).
 *
 * There is deliberately no synchronous TS-reference-evaluation fallback here:
 * `evaluation` must always be the same Rust result (or reference-engine
 * result, in non-Tauri/parity modes) the rest of the app renders from - a
 * completion-only shadow evaluation, computed without the document's actual
 * scalarProgram/bindingVersions/property-binding/conditional-group/forGroup
 * runtime options, could silently disagree with Rust for typed conditional
 * groups, property/numeric bindings, or forGroup-generated elements, and can
 * only ever be triggered by a keystroke, not any other rate limit like real
 * canvas rendering already has. The caller is responsible for evaluating
 * currency (evaluationStateIsCurrentFor) and reporting "pending" instead of
 * calling this at all until it is current.
 */
export type ElementParameterCandidateState =
  | { status: "pending" }
  | { status: "ready"; options: ElementParameterReferenceOption[] };

/**
 * elementParameterReferenceOptionsForPosition, gated by whether `evaluation`
 * is actually current for the live document. Callers determine currency via
 * the shared evaluationStateIsCurrentFor (useEvaluationEngine.ts) against
 * their own up-to-date compiledDocumentRevision - this function never infers
 * it from the shape of `evaluation` itself.
 */
export const elementParameterCandidateState = (
  position: ElementParameterReferencePosition,
  evaluationIsCurrent: boolean
): ElementParameterCandidateState =>
  evaluationIsCurrent
    ? { status: "ready", options: elementParameterReferenceOptionsForPosition(position) }
    : { status: "pending" };
