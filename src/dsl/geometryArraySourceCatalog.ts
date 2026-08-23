import type { StatementIdentity } from "../document/statementIdentity";
import type { DslDiagnostic, DslStatement, ParseDslResult } from "./dslTypes";
import { parseDslDeclaredValueType } from "./dslTypeParser";
import type { GeometryArrayType } from "./geometryArrayTypes";

export type GeometryArraySourceDeclaration = {
  statementId: StatementIdentity;
  statementIndex: number;
  name: string;
  type: GeometryArrayType;
  bindingKind: "const" | "let";
  initializer: string;
  initializerSpan: NonNullable<Extract<DslStatement, { kind: "typedDeclaration" }>["payloadSpans"][string]>;
  exported: boolean;
  ownerModuleDefinitionStatementIndex: number | null;
};

export type GeometryArrayModuleParameter = {
  definitionStatementId: StatementIdentity;
  definitionStatementIndex: number;
  parameterIndex: number;
  name: string;
  type: GeometryArrayType;
  optional: boolean;
};

export type GeometryArraySourceCatalog = {
  declarations: readonly GeometryArraySourceDeclaration[];
  declarationsByStatementId: ReadonlyMap<StatementIdentity, GeometryArraySourceDeclaration>;
  declarationsByStatementIndex: ReadonlyMap<number, GeometryArraySourceDeclaration>;
  moduleParameters: readonly GeometryArrayModuleParameter[];
  moduleParametersBySlot: ReadonlyMap<string, GeometryArrayModuleParameter>;
  diagnostics: readonly DslDiagnostic[];
};

export type BuildGeometryArraySourceCatalogInput = {
  parse: ParseDslResult;
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
};

const statementIdAt = (
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>,
  statementIndex: number,
  owner: string
): StatementIdentity => {
  const statementId = stableStatementIdByIndex.get(statementIndex);
  if (statementId === undefined) throw new Error(`geometryArraySourceCatalog: no stable statement identity for ${owner} at index ${statementIndex}`);
  return statementId;
};

const logicalTextFor = (parse: ParseDslResult, statement: DslStatement): string | null =>
  parse.logicalStatementByRangeFrom.get(statement.documentRange.from)?.logicalText ?? null;

const geometryArrayTypeAt = (
  parse: ParseDslResult,
  statement: DslStatement,
  typeSpan: { start: number; end: number } | null | undefined
): GeometryArrayType | null => {
  if (!typeSpan) return null;
  const logicalText = logicalTextFor(parse, statement);
  if (!logicalText) return null;
  const diagnostics: { message: string; span: { start: number; end: number }; code?: string }[] = [];
  return parseDslDeclaredValueType(logicalText, typeSpan, diagnostics).geometryArrayType;
};

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

const moduleParameterSlotKey = (definitionStatementId: StatementIdentity, parameterIndex: number) =>
  `${definitionStatementId}:${parameterIndex}`;

export const buildGeometryArraySourceCatalog = (
  input: BuildGeometryArraySourceCatalogInput
): GeometryArraySourceCatalog => {
  const { parse, stableStatementIdByIndex } = input;
  const declarations: GeometryArraySourceDeclaration[] = [];
  const declarationsByStatementId = new Map<StatementIdentity, GeometryArraySourceDeclaration>();
  const declarationsByStatementIndex = new Map<number, GeometryArraySourceDeclaration>();
  const moduleParameters: GeometryArrayModuleParameter[] = [];
  const moduleParametersBySlot = new Map<string, GeometryArrayModuleParameter>();
  const diagnostics: DslDiagnostic[] = [];

  for (const [statementIndex, statement] of parse.statements.entries()) {
    if (statement.kind === "typedDeclaration") {
      const initializerSpan = statement.payloadSpans.initializer;
      const type = geometryArrayTypeAt(parse, statement, statement.payloadSpans.type);
      if (!type || !initializerSpan) continue;
      const statementId = statementIdAt(stableStatementIdByIndex, statementIndex, "geometry-array declaration");
      const declaration: GeometryArraySourceDeclaration = {
        statementId,
        statementIndex,
        name: statement.name,
        type,
        bindingKind: statement.bindingKind,
        initializer: statement.initializer,
        initializerSpan,
        exported: statement.exported,
        ownerModuleDefinitionStatementIndex: moduleOwnerIndexOf(parse.statements, statementIndex)
      };
      declarations.push(declaration);
      declarationsByStatementId.set(statementId, declaration);
      declarationsByStatementIndex.set(statementIndex, declaration);
      continue;
    }

    if (statement.kind !== "moduleDefinition") continue;
    const definitionStatementId = statementIdAt(stableStatementIdByIndex, statementIndex, "module definition");
    statement.parameters.forEach((parameter, parameterIndex) => {
      const type = geometryArrayTypeAt(parse, statement, parameter.typeSpan);
      if (!type) return;
      const semantic: GeometryArrayModuleParameter = {
        definitionStatementId,
        definitionStatementIndex: statementIndex,
        parameterIndex,
        name: parameter.name,
        type,
        optional: parameter.optional
      };
      moduleParameters.push(semantic);
      moduleParametersBySlot.set(moduleParameterSlotKey(definitionStatementId, parameterIndex), semantic);
      if (parameter.defaultValue !== null) {
        diagnostics.push({
          severity: "error",
          line: statement.line,
          column: (parameter.defaultSpan?.start ?? parameter.typeSpan?.start ?? statement.keywordSpan.start) + 1,
          code: "geometry-array-parameter-default",
          message: "geometry array 型 Module parameter に default は指定できません。",
          exactSpanOnly: true,
          ...(parameter.defaultPhysicalSpan ? { physicalSpan: parameter.defaultPhysicalSpan } : {})
        });
      }
    });
  }

  return {
    declarations,
    declarationsByStatementId,
    declarationsByStatementIndex,
    moduleParameters,
    moduleParametersBySlot,
    diagnostics
  };
};

export const geometryArrayModuleParameterSlotKey = moduleParameterSlotKey;
