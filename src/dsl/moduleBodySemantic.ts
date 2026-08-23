import type { DslStatement } from "./dslTypes";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import {
  geometryArrayTypeOfModuleParameter,
  geometryArrayTypeOfTypedDeclaration
} from "./geometryArraySourceAnnotations";
import { resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import type { ModuleScalarLocalDiagnostic } from "./moduleScalarExpression";
import * as core from "./moduleBodySemanticCore";

export type { ModuleBodyDefinition, ModuleBodySemanticResult } from "./moduleBodySemanticCore";

const moduleOwnerIndexOf = (statements: readonly DslStatement[], statementIndex: number): number | null => {
  const visited = new Set<number>();
  let enclosing = statements[statementIndex]?.enclosing ?? null;
  while (enclosing && !visited.has(enclosing.statementIndex)) {
    visited.add(enclosing.statementIndex);
    const owner = statements[enclosing.statementIndex];
    if (owner?.kind === "moduleDefinition") return enclosing.statementIndex;
    enclosing = owner?.enclosing ?? null;
  }
  return null;
};

const isSourceOnlyTypedDeclaration = (
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>
) => Boolean(statement.recordTypeReference || geometryArrayTypeOfTypedDeclaration(statement));

const isGeometryArrayWholeReference = (
  input: Parameters<typeof core.analyzeModuleBody>[0],
  statementIndex: number,
  source: string
): boolean => {
  const parsed = parseDslSourceReference(source.trim());
  if (parsed.kind !== "valid" || parsed.reference.property) return false;
  const path = parseDslReferenceToken(parsed.reference.pathText);
  if (path.segments.length === 0) return false;

  if (path.segments.length === 1 && !path.absolute) {
    const ownerIndex = moduleOwnerIndexOf(input.statements, statementIndex);
    const owner = ownerIndex === null ? null : input.statements[ownerIndex];
    if (owner?.kind === "moduleDefinition") {
      const parameter = owner.parameters.find((candidate) => candidate.name === path.segments[0]);
      if (parameter && geometryArrayTypeOfModuleParameter(parameter)) return true;
    }
  }

  const lookup = resolveSourceLexicalPath(input.input.sourceNamespace, statementIndex, path);
  if (lookup.kind !== "resolved") return false;
  return input.input.sourceNamespace.geometryArraySemanticAnalysis?.valuesByStatementIndex.has(lookup.declaration.statementIndex) === true;
};

type ArrayListSite = { statementIndex: number; start: number; end: number };

const diagnosticIsInsideSite = (
  diagnostic: { statementIndex: number; diagnostic: ModuleScalarLocalDiagnostic },
  site: ArrayListSite
) => diagnostic.statementIndex === site.statementIndex &&
  diagnostic.diagnostic.span.start >= site.start &&
  diagnostic.diagnostic.span.end <= site.end;

/**
 * Record-valued declarations and immutable geometry arrays are source-semantic
 * only. Keep both out of the existing Module scalar body analysis so they
 * cannot become localScalars, scalar-expression sites, or runtime pass-through
 * scalar values. Geometry-array references used at an existing broad list
 * consumer are likewise owned by the array semantic/lowering path rather than
 * being misclassified as one singular line reference here.
 */
export const analyzeModuleBody = (
  input: Parameters<typeof core.analyzeModuleBody>[0]
): ReturnType<typeof core.analyzeModuleBody> => {
  const bodyStatementIndexes = input.definition.bodyStatementIndexes.filter((statementIndex) => {
    const statement: DslStatement | undefined = input.statements[statementIndex];
    return !(statement?.kind === "typedDeclaration" && isSourceOnlyTypedDeclaration(statement));
  });
  const capturedDiagnostics: { statementIndex: number; diagnostic: ModuleScalarLocalDiagnostic }[] = [];

  const result = core.analyzeModuleBody({
    ...input,
    addLocal: (statementIndex, diagnostic) => capturedDiagnostics.push({ statementIndex, diagnostic }),
    definition: {
      ...input.definition,
      bodyStatementIndexes
    }
  });

  const arrayListSites: ArrayListSite[] = [];
  const bodyStatements = result.bodyStatements.map((body) => {
    const geometryReferences = body.geometryReferences.filter((site) => {
      if (
        site.reference.role !== "lineReferenceList" ||
        !isGeometryArrayWholeReference(input, body.statementIndex, site.reference.source)
      ) return true;
      arrayListSites.push({
        statementIndex: body.statementIndex,
        start: site.reference.span.start,
        end: site.reference.span.end
      });
      return false;
    });
    return geometryReferences.length === body.geometryReferences.length ? body : { ...body, geometryReferences };
  });

  for (const captured of capturedDiagnostics) {
    if (
      captured.diagnostic.code === "module-geometry-type-mismatch" &&
      arrayListSites.some((site) => diagnosticIsInsideSite(captured, site))
    ) continue;
    input.addLocal(captured.statementIndex, captured.diagnostic);
  }

  return { ...result, bodyStatements };
};
