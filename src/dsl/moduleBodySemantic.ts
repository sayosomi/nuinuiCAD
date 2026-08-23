import type { DslStatement } from "./dslTypes";
import { parseDslDeclaredValueType } from "./dslTypeParser";
import * as core from "./moduleBodySemanticCore";

export type { ModuleBodyDefinition, ModuleBodySemanticResult } from "./moduleBodySemanticCore";

const isSourceOnlyTypedDeclaration = (
  input: Parameters<typeof core.analyzeModuleBody>[0],
  statementIndex: number,
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>
) => {
  if (statement.recordTypeReference) return true;
  const typeSpan = statement.payloadSpans.type;
  const logicalText = input.logicalTextByStatementIndex?.get(statementIndex);
  if (!typeSpan || !logicalText) return false;
  const diagnostics: { message: string; span: { start: number; end: number }; code?: string }[] = [];
  return parseDslDeclaredValueType(logicalText, typeSpan, diagnostics).geometryArrayType !== null;
};

/**
 * Record-valued declarations and immutable geometry arrays are source-semantic
 * only. Keep both out of the existing Module scalar body analysis so they
 * cannot become localScalars, scalar-expression sites, or runtime pass-through
 * scalar values. Their validation/lowering stays with their dedicated source
 * semantic owners.
 */
export const analyzeModuleBody = (
  input: Parameters<typeof core.analyzeModuleBody>[0]
): ReturnType<typeof core.analyzeModuleBody> => {
  const bodyStatementIndexes = input.definition.bodyStatementIndexes.filter((statementIndex) => {
    const statement: DslStatement | undefined = input.statements[statementIndex];
    return !(statement?.kind === "typedDeclaration" && isSourceOnlyTypedDeclaration(input, statementIndex, statement));
  });

  return core.analyzeModuleBody({
    ...input,
    definition: {
      ...input.definition,
      bodyStatementIndexes
    }
  });
};
