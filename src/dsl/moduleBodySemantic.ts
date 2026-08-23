import type { DslStatement } from "./dslTypes";
import * as core from "./moduleBodySemanticCore";

export type { ModuleBodyDefinition, ModuleBodySemanticResult } from "./moduleBodySemanticCore";

/**
 * Record-valued declarations are source-semantic only in SAY-114. Keep them
 * out of the existing Module scalar body analysis so they cannot become
 * localScalars, scalar-expression sites, or runtime pass-through values.
 * Record type/value validation remains owned by recordSemanticAnalysis.
 */
export const analyzeModuleBody = (
  input: Parameters<typeof core.analyzeModuleBody>[0]
): ReturnType<typeof core.analyzeModuleBody> => {
  const bodyStatementIndexes = input.definition.bodyStatementIndexes.filter((statementIndex) => {
    const statement: DslStatement | undefined = input.statements[statementIndex];
    return !(statement?.kind === "typedDeclaration" && statement.recordTypeReference);
  });

  return core.analyzeModuleBody({
    ...input,
    definition: {
      ...input.definition,
      bodyStatementIndexes
    }
  });
};
