import type { DslModuleParameter, DslStatement, ParseDslResult } from "./dslTypes";
import { parseDslDeclaredValueType, type DslTypeDiagnostic } from "./dslTypeParser";
import type { GeometryArrayType } from "./geometryArrayTypes";

const declarationTypes = new WeakMap<object, GeometryArrayType>();
const moduleParameterTypes = new WeakMap<object, GeometryArrayType>();

export const geometryArrayTypeOfTypedDeclaration = (
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>
): GeometryArrayType | null => declarationTypes.get(statement) ?? null;

export const geometryArrayTypeOfModuleParameter = (
  parameter: DslModuleParameter
): GeometryArrayType | null => moduleParameterTypes.get(parameter) ?? null;

/**
 * Attach source-only geometry-array types to parser-owned object identity.
 * This mirrors the record source-type recovery without widening ScalarType,
 * DslModuleParameterType, serialized AST shapes, or runtime value unions.
 */
export const annotateGeometryArraySourceTypes = (parse: ParseDslResult) => {
  for (const statement of parse.statements) {
    const logical = parse.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!logical) continue;

    if (statement.kind === "typedDeclaration") {
      const typeSpan = statement.payloadSpans.type;
      if (!typeSpan) continue;
      const diagnostics: DslTypeDiagnostic[] = [];
      const type = parseDslDeclaredValueType(logical.logicalText, typeSpan, diagnostics).geometryArrayType;
      if (type) declarationTypes.set(statement, type);
      continue;
    }

    if (statement.kind !== "moduleDefinition") continue;
    for (const parameter of statement.parameters) {
      if (!parameter.typeSpan) continue;
      const diagnostics: DslTypeDiagnostic[] = [];
      const type = parseDslDeclaredValueType(logical.logicalText, parameter.typeSpan, diagnostics).geometryArrayType;
      if (type) moduleParameterTypes.set(parameter, type);
    }
  }
};
