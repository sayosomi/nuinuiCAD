import type { DslDiagnostic, DslStatement } from "./dslTypes";
import type { ModuleBodyStatementSemantic } from "./moduleSemanticTypes";

const mutationWriteParameterKeys: ReadonlyMap<string, readonly string[]> = new Map([
  ["edge", ["endpoint1", "endpoint2"]],
  ["extend", ["endpoint"]],
  ["move", ["baseLineIds"]],
  ["mirrorMove", ["baseLineIds"]],
  ["reverse", ["targetLineId"]]
]);

export const mutationWriteParameterKeysFor = (statement: DslStatement): readonly string[] =>
  statement.kind === "element" && statement.category === "mutation"
    ? mutationWriteParameterKeys.get(statement.construction) ?? []
    : [];

/**
 * Module geometry parameters are aliases owned by the caller. Only the
 * mutation write slots are guarded; point/line inputs used to construct a new
 * module-owned element remain valid read-only inputs.
 */
export const moduleMutationOwnershipDiagnostics = (
  statement: DslStatement,
  body: ModuleBodyStatementSemantic
): DslDiagnostic[] => {
  const writeKeys = new Set(mutationWriteParameterKeysFor(statement));
  if (writeKeys.size === 0) return [];
  return body.geometryReferences.flatMap((site) => {
    if (!writeKeys.has(site.parameterKey ?? "") || site.reference.target?.kind !== "parameter") return [];
    return [{
      severity: "error" as const,
      line: statement.line,
      column: site.span.start + 1,
      code: "module-geometry-parameter-mutation",
      message: `module geometry parameter「${site.reference.source.trim()}」はmutationの書き込み対象にできません。`,
      presentation: { key: "diagnostic.module-geometry-parameter-mutation" }
    }];
  });
};
