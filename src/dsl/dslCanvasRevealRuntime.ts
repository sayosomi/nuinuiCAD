import type { CompiledDslDocument } from "./dslDocument";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import type { ModuleGeometrySourceTarget, ModuleGeometryPropertySourceTarget } from "./moduleSemanticTypes";
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
};

type RuntimeCandidate = ElementId | null;

type RevealableSet = {
  ids: readonly ElementId[];
  omittedCount: number;
  causes: readonly DslCanvasRevealRuntimeOmissionCause[];
};

const sameInstancePath = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((identity, index) => identity === right[index]);

const uniquePaths = (paths: readonly (readonly string[])[]) => {
  const seen = new Set<string>();
  const result: readonly string[][] = paths.reduce<string[][]>((acc, path) => {
    const key = JSON.stringify(path);
    if (seen.has(key)) return acc;
    seen.add(key);
    acc.push([...path]);
    return acc;
  }, []);
  return result;
};

const semanticInstancePaths = (
  compiled: DslCanvasRevealRuntimeInput["compiled"],
  sourceStatementIndex: number
): readonly (readonly string[])[] => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  const definition = analysis?.definitions.find((candidate) =>
    candidate.bodyStatements.some((body) => body.statementIndex === sourceStatementIndex)
  );
  if (!definition) return [[]];

  const paths = compiled.moduleMaterialization?.executionStatements
    .filter((entry) =>
      entry.type === "moduleInstance" &&
      entry.origin?.moduleDefinitionStatementId === definition.statementId
    )
    .map((entry) => entry.instancePath) ?? [];
  return uniquePaths(paths);
};

const runtimeElementIdForSourceGeometry = (
  compiled: DslCanvasRevealRuntimeInput["compiled"],
  statementIndex: number,
  instancePath: readonly string[]
): ElementId | null => {
  if (instancePath.length === 0) {
    return compiled.moduleMaterialization?.elementIdBySourceStatementIndex.get(statementIndex) ??
      compiled.statementMap?.elementIdByStatementIndex.get(statementIndex) ??
      null;
  }
  return compiled.moduleMaterialization?.executionStatements.find((entry) =>
    entry.sourceStatementIndex === statementIndex &&
    sameInstancePath(entry.instancePath, instancePath)
  )?.runtimeElementId ?? null;
};

const directGeometryTargetId = (
  compiled: DslCanvasRevealRuntimeInput["compiled"],
  target: ModuleGeometrySourceTarget,
  instancePath: readonly string[]
): ElementId | null =>
  target.kind === "sourceGeometry"
    ? runtimeElementIdForSourceGeometry(compiled, target.statementIndex, instancePath)
    : null;

const directPropertyTargetId = (
  compiled: DslCanvasRevealRuntimeInput["compiled"],
  target: ModuleGeometryPropertySourceTarget,
  instancePath: readonly string[]
): ElementId | null =>
  target.kind === "sourceGeometryProperty"
    ? runtimeElementIdForSourceGeometry(compiled, target.statementIndex, instancePath)
    : null;

const semanticCandidates = ({
  semantic,
  compiled,
  moduleGeometryRuntime,
  elements
}: {
  semantic: DslCanvasRevealSemanticTarget;
  compiled: DslCanvasRevealRuntimeInput["compiled"];
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  elements: readonly CadElement[];
}): readonly RuntimeCandidate[] => {
  const paths = semanticInstancePaths(compiled, semantic.sourceStatementIndex);
  if (paths.length === 0) return [null];
  const elementsById = new Map(elements.map((element) => [element.id, element]));

  if (semantic.kind === "geometry-reference") {
    const target = semantic.reference.target;
    if (!target || !["resolved", "deferred"].includes(semantic.reference.resolution)) return [null];
    return paths.map((instancePath) => {
      const direct = directGeometryTargetId(compiled, target, instancePath);
      if (direct) return direct;
      return moduleGeometryRuntime?.resolveBuiltinTarget(
        target,
        instancePath,
        semantic.reference.expectedGeometryKind
      )?.elementId ?? null;
    });
  }

  const target = semantic.reference.target;
  if (!target || !["resolved", "deferred"].includes(semantic.reference.resolution)) return [null];
  return paths.map((instancePath) => {
    const direct = directPropertyTargetId(compiled, target, instancePath);
    if (direct) return direct;
    const runtime = moduleGeometryRuntime?.resolvePropertyTarget(target, instancePath, elementsById);
    return runtime?.kind === "runtime" ? runtime.elementId : null;
  });
};

const ownerCandidates = (
  compiled: DslCanvasRevealRuntimeInput["compiled"],
  sourceStatementIndex: number
): readonly RuntimeCandidate[] => {
  const materialized = compiled.moduleMaterialization?.executionStatements
    .filter((entry) => entry.sourceStatementIndex === sourceStatementIndex)
    .map((entry) => entry.runtimeElementId) ?? [];
  if (materialized.length > 0) return materialized;
  const direct = compiled.statementMap?.elementIdByStatementIndex.get(sourceStatementIndex);
  return direct ? [direct] : [];
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
  profileVisibleElementIds
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
  input
}: {
  semantic: DslCanvasRevealSemanticTarget;
  cause: DslCanvasRevealOwnerFallbackCause;
  ownerSourceStatementIndex: number | null;
  input: DslCanvasRevealRuntimeInput;
}): DslCanvasRevealResult => {
  if (ownerSourceStatementIndex === null) return { status: "failed", reason: "no-revealable-runtime-target" };
  const ownerSet = filterRevealable({
    candidates: ownerCandidates(input.compiled, ownerSourceStatementIndex),
    elements: input.elements,
    effectiveVisibleElementIds: input.effectiveVisibleElementIds,
    effectiveEnabledElementIds: input.effectiveEnabledElementIds,
    profileVisibleElementIds: input.profileVisibleElementIds
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
  if (input.target.kind === "statement-owner") {
    const ownerSet = filterRevealable({
      candidates: ownerCandidates(input.compiled, input.target.sourceStatementIndex),
      elements: input.elements,
      effectiveVisibleElementIds: input.effectiveVisibleElementIds,
      effectiveEnabledElementIds: input.effectiveEnabledElementIds,
      profileVisibleElementIds: input.profileVisibleElementIds
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
      input
    });
  }

  const semanticSet = filterRevealable({
    candidates: semanticCandidates({
      semantic,
      compiled: input.compiled,
      moduleGeometryRuntime: input.moduleGeometryRuntime,
      elements: input.elements
    }),
    elements: input.elements,
    effectiveVisibleElementIds: input.effectiveVisibleElementIds,
    effectiveEnabledElementIds: input.effectiveEnabledElementIds,
    profileVisibleElementIds: input.profileVisibleElementIds
  });
  if (semanticSet.ids.length > 0) {
    const partial = partialDegradation(semanticSet);
    return resolvedResult(semanticSet, partial ? [partial] : []);
  }

  return ownerFallback({
    semantic,
    cause: semanticSet.causes[0] ?? "runtime-target-unavailable",
    ownerSourceStatementIndex: input.target.ownerSourceStatementIndex,
    input
  });
};
