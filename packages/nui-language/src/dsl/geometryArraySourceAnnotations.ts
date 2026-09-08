import type { DslModuleParameter, DslStatement, ParseDslResult } from "./dslTypes";
import { parseDslDeclaredValueType, type DslTypeDiagnostic } from "./dslTypeParser";
import { geometryArrayTypeOfDslValueType, type GeometryArrayType } from "./geometryArrayTypes";
import { isDslArrayValueType, type DslArrayValueType } from "./dslValueTypes";

const moduleParameterTypes = new WeakMap<object, GeometryArrayType>();

export const geometryArrayTypeOfTypedDeclaration = (
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>
): GeometryArrayType | null => geometryArrayTypeOfDslValueType(statement.valueType);

export const geometryArrayTypeOfModuleParameter = (
  parameter: DslModuleParameter
): GeometryArrayType | null => geometryArrayTypeOfDslValueType(parameter.valueType) ?? moduleParameterTypes.get(parameter) ?? null;

/** Canonical source-level collection type for a Module parameter. */
export const arrayValueTypeOfModuleParameter = (
  parameter: DslModuleParameter
): DslArrayValueType | null => isDslArrayValueType(parameter.valueType) ? parameter.valueType : null;

/**
 * Attach source-only geometry-array types to Module parameter object identity.
 * Typed declarations already carry their canonical valueType directly and do
 * not need a source reparse or object annotation.
 */
export const annotateGeometryArraySourceTypes = (parse: ParseDslResult) => {
  for (const statement of parse.statements) {
    if (statement.kind !== "moduleDefinition") continue;
    const logical = parse.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (!logical) continue;
    for (const parameter of statement.parameters) {
      if (!parameter.typeSpan) continue;
      const diagnostics: DslTypeDiagnostic[] = [];
      const type = geometryArrayTypeOfDslValueType(parseDslDeclaredValueType(logical.logicalText, parameter.typeSpan, diagnostics).valueType);
      if (type) moduleParameterTypes.set(parameter, type);
    }
  }
};
