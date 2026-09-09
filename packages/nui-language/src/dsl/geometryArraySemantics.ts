import type { DslDiagnosticPresentation, DslSpan } from "./dslTypes";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type { GeometryArrayExpression, GeometryArrayLiteralMember } from "./geometryArrayExpression";
import {
  geometryArrayTypeName,
  isDslNonArrayValueTypeAssignable,
  isGeometryArrayTypeAssignable,
  type GeometryArrayType
} from "./geometryArrayTypes";
import type { DslArrayValueType, DslNonArrayValueType } from "./dslValueTypes";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import type { ScalarType } from "../scalars/types";

export type GeometryArraySemanticDiagnostic = {
  code: string;
  message: string;
  span: DslSpan;
  presentation?: DslDiagnosticPresentation;
};

/** Opaque definition-backed geometry handle supplied by the existing resolver. */
export type GeometryArrayResolvedMember<TTarget> = {
  interfaceType: ModuleGeometryInterfaceType;
  target: TTarget;
};

/** Ordered source member retaining the exact authored occurrence span. */
export type GeometryArrayMemberSemantic<TTarget> = {
  sourceText: string;
  sourceSpan: DslSpan;
  interfaceType: ModuleGeometryInterfaceType;
  target: TTarget;
};

export type GeometryArrayLiteralValue<TTarget> = {
  kind: "literal";
  type: GeometryArrayType;
  members: readonly GeometryArrayMemberSemantic<TTarget>[];
};

/**
 * Whole-array aliases retain the target value identity instead of copying its
 * members. Materialization/list consumers may dereference it when concrete
 * runtime geometry references are required.
 */
export type GeometryArrayAliasValue = {
  kind: "alias";
  type: GeometryArrayType;
  targetValueId: string;
  sourceSpan: DslSpan;
};

export type GeometryArraySemanticValue<TTarget> = GeometryArrayLiteralValue<TTarget> | GeometryArrayAliasValue;

/** Generalized one-dimensional collection semantic value. Kept beside the
 * historical geometry projection so all collection resolution still has one
 * owner while existing geometry consumers retain their stable shape. */
export type DslArrayMemberSemantic<TTarget> = {
  sourceText: string;
  sourceSpan: DslSpan;
  elementType: DslNonArrayValueType;
  target: TTarget;
};

export type DslArrayLiteralValue<TTarget> = {
  kind: "literal";
  valueType: DslArrayValueType;
  members: readonly DslArrayMemberSemantic<TTarget>[];
};

export type DslArrayAliasValue = {
  kind: "alias";
  valueType: DslArrayValueType;
  targetValueId: string;
  sourceSpan: DslSpan;
};

export type DslArrayMappedValue = {
  kind: "map";
  valueType: DslArrayValueType;
  sourceValueId: string;
  sourceElementType: ScalarType;
  resultElementType: ScalarType;
  binderId: string;
  binder: string;
  binderSpan: DslSpan;
  sourceSpan: DslSpan;
  body: TypedScalarExpression;
  sourceOrder: number;
};

export type DslArraySemanticValue<TTarget> = DslArrayLiteralValue<TTarget> | DslArrayAliasValue | DslArrayMappedValue;

export type GeometryArrayMemberResolution<TTarget> =
  | { kind: "resolved"; value: GeometryArrayResolvedMember<TTarget> }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type GeometryArrayReferenceResolution =
  | { kind: "resolved"; targetValueId: string; type: GeometryArrayType }
  /**
   * Module instance export namespaces are owned by the Module semantic pass,
   * which runs after the ordinary source namespace. Preserve only the
   * definition-backed identity here; that later owner validates the actual
   * export type before runtime lowering.
   */
  | { kind: "deferred"; targetValueId: string }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type ResolveGeometryArrayExpressionInput<TTarget> = {
  expectedType: GeometryArrayType;
  expression: GeometryArrayExpression;
  resolveMember: (member: GeometryArrayLiteralMember) => GeometryArrayMemberResolution<TTarget>;
  resolveArrayReference: (sourceText: string, sourceSpan: DslSpan) => GeometryArrayReferenceResolution;
};

export type ResolveGeometryArrayExpressionResult<TTarget> = {
  value: GeometryArraySemanticValue<TTarget> | null;
  diagnostics: readonly GeometryArraySemanticDiagnostic[];
};

export type DslArrayMemberResolution<TTarget> =
  | { kind: "resolved"; value: { elementType: DslNonArrayValueType; target: TTarget } }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type DslArrayReferenceResolution =
  | { kind: "resolved"; targetValueId: string; valueType: DslArrayValueType }
  | { kind: "deferred"; targetValueId: string }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type ResolveDslArrayExpressionInput<TTarget> = {
  expectedType: DslArrayValueType;
  expression: GeometryArrayExpression;
  resolveMember: (member: GeometryArrayLiteralMember) => DslArrayMemberResolution<TTarget>;
  resolveArrayReference: (sourceText: string, sourceSpan: DslSpan) => DslArrayReferenceResolution;
  resolveValueFor?: (expression: Extract<GeometryArrayExpression, { kind: "valueFor" }>) =>
    | { kind: "resolved"; value: DslArrayMappedValue }
    | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };
};

export type ResolveDslArrayExpressionResult<TTarget> = {
  value: DslArraySemanticValue<TTarget> | null;
  diagnostics: readonly GeometryArraySemanticDiagnostic[];
};

const dslArrayTypeName = (type: DslArrayValueType) => {
  const element = type.elementType;
  return `${element.kind === "record" ? element.name : element.kind}[]`;
};

const dslArrayMemberTypeMismatch = (
  expectedType: DslArrayValueType,
  member: GeometryArrayLiteralMember,
  actualType: DslNonArrayValueType
): GeometryArraySemanticDiagnostic => ({
  code: "array-member-type-mismatch",
  message: `array member の型が一致しません: ${dslArrayTypeName(expectedType)} には ${dslArrayTypeName({ kind: "array", elementType: actualType })} の要素が渡されています。`,
  span: member.span,
  presentation: {
    key: "diagnostic.array-member-type-mismatch",
    parameters: { member: member.text, expected: dslArrayTypeName(expectedType), actual: actualType.kind }
  }
});

/** Resolve literals and whole-value references for every supported T[]. */
export const resolveDslArrayExpression = <TTarget>(
  input: ResolveDslArrayExpressionInput<TTarget>
): ResolveDslArrayExpressionResult<TTarget> => {
  if (input.expression.kind === "valueFor") {
    const resolution = input.resolveValueFor?.(input.expression);
    if (!resolution) {
      return {
        value: null,
        diagnostics: [{ code: "array-value-for-unsupported", message: "この collection では value-for を使用できません。", span: input.expression.span }]
      };
    }
    return resolution.kind === "resolved"
      ? { value: resolution.value, diagnostics: [] }
      : { value: null, diagnostics: [resolution.diagnostic] };
  }
  if (input.expression.kind === "reference") {
    const resolution = input.resolveArrayReference(input.expression.text, input.expression.span);
    if (resolution.kind === "invalid") return { value: null, diagnostics: [resolution.diagnostic] };
    if (resolution.kind === "resolved" && !isDslNonArrayValueTypeAssignable(resolution.valueType.elementType, input.expectedType.elementType)) {
      return {
        value: null,
        diagnostics: [{
          code: "array-assignability-mismatch",
          message: `array の型が一致しません: ${dslArrayTypeName(resolution.valueType)} は ${dslArrayTypeName(input.expectedType)} に代入できません。`,
          span: input.expression.span,
          presentation: {
            key: "diagnostic.array-assignability-mismatch",
            parameters: { actual: dslArrayTypeName(resolution.valueType), expected: dslArrayTypeName(input.expectedType) }
          }
        }]
      };
    }
    return {
      value: {
        kind: "alias",
        valueType: input.expectedType,
        targetValueId: resolution.targetValueId,
        sourceSpan: input.expression.span
      },
      diagnostics: []
    };
  }

  const diagnostics: GeometryArraySemanticDiagnostic[] = [];
  const members: DslArrayMemberSemantic<TTarget>[] = [];
  for (const member of input.expression.members) {
    const resolution = input.resolveMember(member);
    if (resolution.kind === "invalid") {
      diagnostics.push(resolution.diagnostic);
      continue;
    }
    if (!isDslNonArrayValueTypeAssignable(resolution.value.elementType, input.expectedType.elementType)) {
      diagnostics.push(dslArrayMemberTypeMismatch(input.expectedType, member, resolution.value.elementType));
      continue;
    }
    members.push({
      sourceText: member.text,
      sourceSpan: member.span,
      elementType: resolution.value.elementType,
      target: resolution.value.target
    });
  }
  return {
    value: diagnostics.length === 0 ? { kind: "literal", valueType: input.expectedType, members } : null,
    diagnostics
  };
};

const memberTypeMismatch = (
  expectedType: GeometryArrayType,
  member: GeometryArrayLiteralMember,
  actualType: ModuleGeometryInterfaceType
): GeometryArraySemanticDiagnostic => ({
  code: "geometry-array-member-type-mismatch",
  message: `geometry array member の型が一致しません: ${geometryArrayTypeName(expectedType)} には ${expectedType.elementType} が必要ですが ${actualType} が渡されています。`,
  span: member.span,
  presentation: {
    key: "diagnostic.geometry-array-member-type-mismatch",
    parameters: { member: member.text, expected: geometryArrayTypeName(expectedType), actual: actualType }
  }
});

/**
 * Shared typed-value owner after source/name resolution. It preserves literal
 * order/duplicates and keeps whole-array references as definition-backed
 * aliases. No scalar/runtime array value is produced here.
 */
export const resolveGeometryArrayExpression = <TTarget>(
  input: ResolveGeometryArrayExpressionInput<TTarget>
): ResolveGeometryArrayExpressionResult<TTarget> => {
  const diagnostics: GeometryArraySemanticDiagnostic[] = [];
  if (input.expression.kind === "valueFor") {
    return {
      value: null,
      diagnostics: [{ code: "geometry-array-value-for-unsupported", message: "geometry array では scalar value-for を使用できません。", span: input.expression.span }]
    };
  }
  if (input.expression.kind === "reference") {
    const resolution = input.resolveArrayReference(input.expression.text, input.expression.span);
    if (resolution.kind === "invalid") return { value: null, diagnostics: [resolution.diagnostic] };
    if (resolution.kind === "resolved" && !isGeometryArrayTypeAssignable(resolution.type, input.expectedType)) {
      return {
        value: null,
        diagnostics: [{
          code: "geometry-array-assignability-mismatch",
          message: `geometry array の型が一致しません: ${geometryArrayTypeName(resolution.type)} は ${geometryArrayTypeName(input.expectedType)} に代入できません。`,
          span: input.expression.span,
          presentation: {
            key: "diagnostic.geometry-array-assignability-mismatch",
            parameters: { actual: geometryArrayTypeName(resolution.type), expected: geometryArrayTypeName(input.expectedType) }
          }
        }]
      };
    }
    return {
      value: {
        kind: "alias",
        type: input.expectedType,
        targetValueId: resolution.targetValueId,
        sourceSpan: input.expression.span
      },
      diagnostics
    };
  }

  const members: GeometryArrayMemberSemantic<TTarget>[] = [];
  for (const member of input.expression.members) {
    const resolution = input.resolveMember(member);
    if (resolution.kind === "invalid") {
      diagnostics.push(resolution.diagnostic);
      continue;
    }
    const memberType: GeometryArrayType = { kind: "geometryArray", elementType: resolution.value.interfaceType };
    if (!isGeometryArrayTypeAssignable(memberType, input.expectedType)) {
      diagnostics.push(memberTypeMismatch(input.expectedType, member, resolution.value.interfaceType));
      continue;
    }
    members.push({
      sourceText: member.text,
      sourceSpan: member.span,
      interfaceType: resolution.value.interfaceType,
      target: resolution.value.target
    });
  }

  return {
    value: diagnostics.length === 0 ? { kind: "literal", type: input.expectedType, members } : null,
    diagnostics
  };
};
