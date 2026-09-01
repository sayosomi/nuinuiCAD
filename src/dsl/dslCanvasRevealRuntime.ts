import type { CompiledDslDocument } from "./dslDocument";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import { projectDslRevealRuntimeTarget } from "./dslRevealRuntimeProjection";
import type { ElementId, CadElement } from "../types/geometry";
import type {
  DslCanvasRevealDegradation,
  DslCanvasRevealOwnerFallbackCause,
  DslCanvasRevealResult,
  DslCanvasRevealRuntimeOmissionCause,
  DslCanvasRevealSemanticTarget,
  DslCanvasRevealSourceTarget
} from "./dslCanvasRevealQuery";

export type DslCanvasRevealRuntimeInput = {
  target: DslCanvasRevealSourceTarget;
  compiled: Pick<
    CompiledDslDocument,
    "statementMap" | "moduleSemanticAnalysis" | "sourceSemanticAnalysis" | "moduleMaterialization" | "diagnostics"
  >;
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  elements: readonly CadElement[];
  effectiveVisibleElementIds: ReadonlySet<ElementId>;
  effectiveEnabledElementIds: ReadonlySet<ElementId>;
  profileVisibleElementIds: ReadonlySet<ElementId>;
  selectionEligibleElementIds: ReadonlySet<ElementId>;
};

type RuntimeCandidate = ElementId | null;

type RevealableSet = {
  ids: readonly ElementId[];
  omittedCount: number;
  causes: readonly DslCanvasRevealRuntimeOmissionCause[];
};

const uniqueCauses = (
  causes: readonly DslCanvasRevealRuntimeOmissionCause[]
): readonly DslCanvasRevealRuntimeOmissionCause[] => {
  const seen = new Set<DslCanvasRevealRuntimeOmissionCause>();
  return causes.filter((cause) => {
    if (seen.has(cause)) return false;
    seen.add(cause);
    return true;
  });
};

const filterRevealable = ({
  candidates,
  elements,
  effectiveVisibleElementIds,
  effectiveEnabledElementIds,
  profileVisibleElementIds,
  selectionEligibleElementIds
}: Omit<DslCanvasRevealRuntimeInput, "target" | "compiled" | "moduleGeometryRuntime"> & {
  candidates: readonly RuntimeCandidate[];
}): RevealableSet => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const ids: ElementId[] = [];
  const seenIds = new Set<ElementId>();
  const causes: DslCanvasRevealRuntimeOmissionCause[] = [];
  let omittedCount = 0;

  for (const candidate of candidates) {
    let cause: DslCanvasRevealRuntimeOmissionCause | null = null;
    if (!candidate || !elementsById.has(candidate)) cause = "runtime-target-unavailable";
    else if (!effectiveEnabledElementIds.has(candidate)) cause = "disabled";
    else if (!effectiveVisibleElementIds.has(candidate)) cause = "hidden";
    else if (!profileVisibleElementIds.has(candidate)) cause = "profile-excluded";
    else if (!selectionEligibleElementIds.has(candidate)) cause = "runtime-target-unavailable";

    if (cause) {
      omittedCount += 1;
      causes.push(cause);
      continue;
    }
    if (seenIds.has(candidate!)) continue;
    seenIds.add(candidate!);
    ids.push(candidate!);
  }

  return { ids, omittedCount, causes: uniqueCauses(causes) };
};

const partialDegradation = (set: RevealableSet): DslCanvasRevealDegradation | null =>
  set.omittedCount > 0
    ? { kind: "partial-targets", omittedCount: set.omittedCount, causes: set.causes }
    : null;

const resolvedResult = (
  set: RevealableSet,
  degradations: readonly DslCanvasRevealDegradation[] = []
): DslCanvasRevealResult => {
  const primaryRuntimeElementId = set.ids[0];
  return primaryRuntimeElementId
    ? {
        status: "resolved",
        runtimeElementIds: set.ids,
        primaryRuntimeElementId,
        degradations
      }
    : { status: "failed", reason: "no-revealable-runtime-target" };
};

const semanticResolutionCause = (
  semantic: DslCanvasRevealSemanticTarget,
  compiled: DslCanvasRevealRuntimeInput["compiled"]
): DslCanvasRevealOwnerFallbackCause => {
  const ambiguous = compiled.diagnostics.some((diagnostic) =>
    diagnostic.statementIndex === semantic.sourceStatementIndex &&
    diagnostic.code?.includes("ambiguous")
  );
  return ambiguous ? "ambiguous" : "unresolved";
};

const ownerFallback = ({
  semantic,
  cause,
  ownerSourceStatementIndex,
  ownerCandidates,
  input
}: {
  semantic: DslCanvasRevealSemanticTarget;
  cause: DslCanvasRevealOwnerFallbackCause;
  ownerSourceStatementIndex: number | null;
  ownerCandidates: readonly RuntimeCandidate[];
  input: DslCanvasRevealRuntimeInput;
}): DslCanvasRevealResult => {
  if (ownerSourceStatementIndex === null) return { status: "failed", reason: "no-revealable-runtime-target" };
  const ownerSet = filterRevealable({
    candidates: ownerCandidates,
    elements: input.elements,
    effectiveVisibleElementIds: input.effectiveVisibleElementIds,
    effectiveEnabledElementIds: input.effectiveEnabledElementIds,
    profileVisibleElementIds: input.profileVisibleElementIds,
    selectionEligibleElementIds: input.selectionEligibleElementIds
  });
  if (ownerSet.ids.length === 0) return { status: "failed", reason: "no-revealable-runtime-target" };

  const degradations: DslCanvasRevealDegradation[] = [{
    kind: "owner-fallback",
    cause,
    referenceText: semantic.referenceText
  }];
  const partial = partialDegradation(ownerSet);
  if (partial) degradations.push(partial);
  return resolvedResult(ownerSet, degradations);
};

/**
 * Expands one Reveal source target into the current materialized runtime set.
 * Ordering is source/materialization order; duplicate runtime IDs are removed
 * after revealability filtering while preserving the first occurrence.
 */
export const queryDslCanvasRevealRuntimeTarget = (
  input: DslCanvasRevealRuntimeInput
): DslCanvasRevealResult => {
  const projection = projectDslRevealRuntimeTarget(input);
  if (input.target.kind === "statement-owner") {
    const ownerSet = filterRevealable({
      candidates: projection.candidates,
      elements: input.elements,
      effectiveVisibleElementIds: input.effectiveVisibleElementIds,
      effectiveEnabledElementIds: input.effectiveEnabledElementIds,
      profileVisibleElementIds: input.profileVisibleElementIds,
      selectionEligibleElementIds: input.selectionEligibleElementIds
    });
    if (ownerSet.ids.length === 0) return { status: "failed", reason: "no-revealable-runtime-target" };
    const partial = partialDegradation(ownerSet);
    return resolvedResult(ownerSet, partial ? [partial] : []);
  }

  const semantic = input.target.semantic;
  const reference = semantic.reference;
  if (!reference.target || !["resolved", "deferred"].includes(reference.resolution)) {
    return ownerFallback({
      semantic,
      cause: semanticResolutionCause(semantic, input.compiled),
      ownerSourceStatementIndex: input.target.ownerSourceStatementIndex,
      ownerCandidates: projection.ownerCandidates,
      input
    });
  }

  const semanticSet = filterRevealable({
    candidates: projection.candidates,
    elements: input.elements,
    effectiveVisibleElementIds: input.effectiveVisibleElementIds,
    effectiveEnabledElementIds: input.effectiveEnabledElementIds,
    profileVisibleElementIds: input.profileVisibleElementIds,
    selectionEligibleElementIds: input.selectionEligibleElementIds
  });
  if (semanticSet.ids.length > 0) {
    const partial = partialDegradation(semanticSet);
    return resolvedResult(semanticSet, partial ? [partial] : []);
  }

  return ownerFallback({
    semantic,
    cause: semanticSet.causes[0] ?? "runtime-target-unavailable",
    ownerSourceStatementIndex: input.target.ownerSourceStatementIndex,
    ownerCandidates: projection.ownerCandidates,
    input
  });
};
