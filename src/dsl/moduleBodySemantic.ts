import type { DslDiagnosticPresentation, DslSpan, DslStatement } from "./dslTypes";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import {
  geometryArrayTypeOfModuleParameter,
  geometryArrayTypeOfTypedDeclaration
} from "./geometryArraySourceAnnotations";
import { resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import { moduleParameterPresenceKey, type ModuleScalarLocalDiagnostic } from "./moduleScalarExpression";
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

type GeometryArrayWholeReference =
  | {
      kind: "parameter";
      definitionStatementId: string;
      definitionStatementIndex: number;
      parameterIndex: number;
      parameterName: string;
      parameterNameSpan: DslSpan | null;
      optional: boolean;
    }
  | { kind: "value" };

type ModuleBodyLocalDiagnostic = ModuleScalarLocalDiagnostic & {
  relatedSources?: readonly {
    statementIndex: number;
    span: DslSpan;
    message: string;
    presentation?: DslDiagnosticPresentation;
  }[];
};

const geometryArrayWholeReference = (
  input: Parameters<typeof core.analyzeModuleBody>[0],
  statementIndex: number,
  source: string
): GeometryArrayWholeReference | null => {
  const parsed = parseDslSourceReference(source.trim());
  if (parsed.kind !== "valid" || parsed.reference.property) return null;
  const path = parseDslReferenceToken(parsed.reference.pathText);
  if (path.segments.length === 0) return null;

  if (path.segments.length === 1 && !path.absolute) {
    const ownerIndex = moduleOwnerIndexOf(input.statements, statementIndex);
    const owner = ownerIndex === null ? null : input.statements[ownerIndex];
    if (ownerIndex !== null && owner?.kind === "moduleDefinition") {
      const parameterIndex = owner.parameters.findIndex((candidate) => candidate.name === path.segments[0]);
      const parameter = parameterIndex >= 0 ? owner.parameters[parameterIndex] : undefined;
      if (parameter && geometryArrayTypeOfModuleParameter(parameter)) {
        return {
          kind: "parameter",
          definitionStatementId: input.definition.statementId,
          definitionStatementIndex: ownerIndex,
          parameterIndex,
          parameterName: parameter.name,
          parameterNameSpan: parameter.nameSpan,
          optional: parameter.optional
        };
      }
    }
  }

  const lookup = resolveSourceLexicalPath(input.input.sourceNamespace, statementIndex, path);
  if (lookup.kind !== "resolved") return null;
  return input.input.sourceNamespace.geometryArraySemanticAnalysis?.valuesByStatementIndex.has(lookup.declaration.statementIndex) === true
    ? { kind: "value" }
    : null;
};

type ArrayListSite = { statementIndex: number; spans: readonly DslSpan[] };

const diagnosticIsInsideSite = (
  diagnostic: { statementIndex: number; diagnostic: ModuleScalarLocalDiagnostic },
  site: ArrayListSite
) => diagnostic.statementIndex === site.statementIndex && site.spans.some((span) =>
  diagnostic.diagnostic.span.start >= span.start &&
  diagnostic.diagnostic.span.end <= span.end
);

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
  const originalResolveBodyHasValue = input.resolveBodyHasValue;
  const originalResolveGeometry = input.resolveGeometry;

  const result = core.analyzeModuleBody({
    ...input,
    addLocal: (statementIndex, diagnostic) => capturedDiagnostics.push({ statementIndex, diagnostic }),
    resolveGeometry: (statementIndex, ownerIndex, rawValue, span, expected, options) => {
      if (
        expected === "line" &&
        options?.role === "lineReferenceList" &&
        geometryArrayWholeReference(input, statementIndex, rawValue)
      ) {
        const parsed = parseDslSourceReference(rawValue.trim());
        const nameSpan = parsed.kind === "valid"
          ? {
              start: span.start + parsed.reference.pathRange.start,
              end: span.start + parsed.reference.pathRange.end
            }
          : undefined;
        return {
          source: rawValue,
          span,
          ...(nameSpan ? { nameSpan } : {}),
          expectedGeometryKind: "line",
          role: "lineReferenceList",
          target: null,
          coordinate: null,
          resolution: "resolved"
        };
      }
      return originalResolveGeometry(statementIndex, ownerIndex, rawValue, span, expected, options);
    },
    resolveBodyHasValue: (statementIndex, reference) => {
      const existing = originalResolveBodyHasValue(statementIndex, reference);
      if (!existing.diagnostic) return existing;
      const ownerIndex = moduleOwnerIndexOf(input.statements, statementIndex);
      const owner = ownerIndex === null ? null : input.statements[ownerIndex];
      if (owner?.kind !== "moduleDefinition") return existing;
      const parameterIndex = owner.parameters.findIndex((parameter) => parameter.name === reference.name);
      const parameter = parameterIndex >= 0 ? owner.parameters[parameterIndex] : undefined;
      if (!parameter?.optional || !geometryArrayTypeOfModuleParameter(parameter)) return existing;
      return {
        target: {
          kind: "parameter" as const,
          definitionStatementId: input.definition.statementId,
          parameterIndex
        },
        type: null,
        resolution: "resolved" as const
      };
    },
    definition: {
      ...input.definition,
      bodyStatementIndexes
    }
  });

  const arrayListSites: ArrayListSite[] = [];
  const arrayDiagnostics: { statementIndex: number; diagnostic: ModuleBodyLocalDiagnostic }[] = [];
  const bodyStatements = result.bodyStatements.map((body) => {
    const geometryReferences = body.geometryReferences.filter((site) => {
      if (site.reference.role !== "lineReferenceList") return true;
      const arrayReference = geometryArrayWholeReference(input, body.statementIndex, site.reference.source);
      if (!arrayReference) return true;
      arrayListSites.push({
        statementIndex: body.statementIndex,
        spans: [
          site.reference.span,
          ...(site.reference.nameSpan ? [site.reference.nameSpan] : [])
        ]
      });
      if (
        arrayReference.kind === "parameter" &&
        arrayReference.optional &&
        !body.presenceParameterKeys.includes(moduleParameterPresenceKey(arrayReference.definitionStatementId, arrayReference.parameterIndex))
      ) {
        arrayDiagnostics.push({
          statementIndex: body.statementIndex,
          diagnostic: {
            code: "module-optional-value-required",
            span: site.reference.nameSpan ?? site.reference.span,
            message: `optional module parameter「${arrayReference.parameterName}」は hasValue(@${arrayReference.parameterName}) で存在を確認してから参照してください。`,
            relatedSources: arrayReference.parameterNameSpan
              ? [{
                  statementIndex: arrayReference.definitionStatementIndex,
                  span: arrayReference.parameterNameSpan,
                  message: "Related parameter declaration",
                  presentation: { key: "diagnostic.related.parameter-declaration" }
                }]
              : []
          }
        });
      }
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
  for (const arrayDiagnostic of arrayDiagnostics) input.addLocal(arrayDiagnostic.statementIndex, arrayDiagnostic.diagnostic);

  return { ...result, bodyStatements };
};
