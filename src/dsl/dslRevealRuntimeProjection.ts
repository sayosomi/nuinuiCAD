import type { ElementId, CadElement } from "../types/geometry";
import type { CompiledDslDocument } from "./dslDocument";
import type { ModuleGeometryRuntimeCompilation } from "./moduleGeometryRuntime";
import type { ModuleGeometryPropertySourceTarget, ModuleGeometrySourceTarget } from "./moduleSemanticTypes";
import type {
  DslCanvasRevealSemanticTarget,
  DslCanvasRevealSourceTarget
} from "./dslCanvasRevealQuery";

export type DslRevealRuntimeProjectionInput = {
  target: DslCanvasRevealSourceTarget;
  compiled: Pick<
    CompiledDslDocument,
    "statementMap" | "moduleSemanticAnalysis" | "sourceSemanticAnalysis" | "moduleMaterialization"
  >;
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  elements: readonly CadElement[];
};

export type DslRevealRuntimeProjection = {
  /** Raw semantic/runtime candidates, before any host presentation filtering. */
  candidates: readonly (ElementId | null)[];
  /** The authored statement-owner candidates used by Reveal fallback. */
  ownerCandidates: readonly (ElementId | null)[];
};

const sameInstancePath = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((identity, index) => identity === right[index]);

const uniquePaths = (paths: readonly (readonly string[])[]) => {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const path of paths) {
    const key = JSON.stringify(path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([...path]);
  }
  return result;
};

const semanticInstancePaths = (
  compiled: DslRevealRuntimeProjectionInput["compiled"],
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
  compiled: DslRevealRuntimeProjectionInput["compiled"],
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
  compiled: DslRevealRuntimeProjectionInput["compiled"],
  target: ModuleGeometrySourceTarget,
  instancePath: readonly string[]
): ElementId | null => target.kind === "sourceGeometry"
  ? runtimeElementIdForSourceGeometry(compiled, target.statementIndex, instancePath)
  : null;

const directPropertyTargetId = (
  compiled: DslRevealRuntimeProjectionInput["compiled"],
  target: ModuleGeometryPropertySourceTarget,
  instancePath: readonly string[]
): ElementId | null => target.kind === "sourceGeometryProperty"
  ? runtimeElementIdForSourceGeometry(compiled, target.statementIndex, instancePath)
  : null;

const semanticCandidates = ({
  semantic,
  compiled,
  moduleGeometryRuntime,
  elements
}: {
  semantic: DslCanvasRevealSemanticTarget;
  compiled: DslRevealRuntimeProjectionInput["compiled"];
  moduleGeometryRuntime?: ModuleGeometryRuntimeCompilation;
  elements: readonly CadElement[];
}): readonly (ElementId | null)[] => {
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
  compiled: DslRevealRuntimeProjectionInput["compiled"],
  sourceStatementIndex: number | null
): readonly (ElementId | null)[] => {
  if (sourceStatementIndex === null) return [];
  const materialized = compiled.moduleMaterialization?.executionStatements
    .filter((entry) => entry.sourceStatementIndex === sourceStatementIndex)
    .map((entry) => entry.runtimeElementId) ?? [];
  if (materialized.length > 0) return materialized;
  const direct = compiled.statementMap?.elementIdByStatementIndex.get(sourceStatementIndex);
  return direct ? [direct] : [];
};

/**
 * Expands a Canvas-compatible Reveal source target into raw current runtime
 * identities. Hosts decide separately how those identities are presented.
 */
export const projectDslRevealRuntimeTarget = (
  input: DslRevealRuntimeProjectionInput
): DslRevealRuntimeProjection => {
  if (input.target.kind === "statement-owner") {
    const candidates = ownerCandidates(input.compiled, input.target.sourceStatementIndex);
    return { candidates, ownerCandidates: candidates };
  }

  return {
    candidates: semanticCandidates({
      semantic: input.target.semantic,
      compiled: input.compiled,
      moduleGeometryRuntime: input.moduleGeometryRuntime,
      elements: input.elements
    }),
    ownerCandidates: ownerCandidates(input.compiled, input.target.ownerSourceStatementIndex)
  };
};
