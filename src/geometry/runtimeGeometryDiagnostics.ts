import type { CompiledDslDocument } from "../dsl/dslDocument";
import { sourceOwnerForRuntimeElementId } from "../dsl/sourceOwnership";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { DependencyError, ElementId } from "../types/geometry";

export type RuntimeGeometryDiagnostic = DslDiagnostic & {
  origin: "runtime";
  elementId: ElementId;
};

/**
 * Project current geometry-evaluation failures onto their authored source
 * statements so host adapters can present them through the same runtime
 * diagnostic layer as scalar evaluation failures.
 *
 * Runtime elements without a current authored owner fail closed: a diagnostic
 * with a guessed or stale source location is worse than omitting that row.
 */
export const runtimeGeometryDiagnostics = (input: {
  errors?: readonly DependencyError[];
  compiledDocument: CompiledDslDocument;
}): readonly RuntimeGeometryDiagnostic[] => {
  const statementMap = input.compiledDocument.statementMap;
  if (!statementMap) return [];

  return (input.errors ?? []).flatMap((error) => {
    const owner = sourceOwnerForRuntimeElementId(
      {
        statementMap,
        moduleMaterialization: input.compiledDocument.moduleMaterialization
      },
      error.elementId
    );
    if (!owner) return [];

    const sourceElementId = statementMap.elementIdByStatementIndex.get(owner.sourceStatementIndex);
    return [{
      severity: "error" as const,
      line: owner.statement.line,
      column: 1,
      message: error.message,
      sourceRevision: owner.statement.sourceRevision,
      origin: "runtime" as const,
      elementId: error.elementId,
      statementIndex: owner.sourceStatementIndex,
      ...(sourceElementId
        ? { navigationTarget: { kind: "element" as const, elementId: sourceElementId } }
        : {})
    }];
  });
};
