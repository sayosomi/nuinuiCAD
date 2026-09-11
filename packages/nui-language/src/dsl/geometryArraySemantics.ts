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
import type { ModuleGeometryValueExpressionSemantic } from "./moduleSemanticTypes";
import type { ModuleScalarExpressionSemantic } from "./moduleSemanticTypes";
import type { RecordFieldIdentity } from "./recordSemanticAnalysis";
import type { DslRecordTypeReference } from "./dslValueTypes";

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

/** A geometry-valued value-for keeps the resolved source collection identity
 * and the binder/source spans in the geometry owner. Its body is populated by
 * the Module semantic pass after the existing geometry-value parser has
 * resolved the body; it is deliberately not represented as a scalar map. */
export type GeometryArrayMappedValue = {
  kind: "map";
  type: GeometryArrayType;
  sourceValueId: string;
  sourceElementType: ModuleGeometryInterfaceType;
  resultElementType: ModuleGeometryInterfaceType;
  binderId: string;
  binder: string;
  binderSpan: DslSpan;
  sourceSpan: DslSpan;
  bodySpan: DslSpan;
  body?: ModuleGeometryValueExpressionSemantic;
  sourceOrder: number;
};

export type GeometryArrayConditionalValue<TTarget> =
  | {
      kind: "if";
      span: DslSpan;
      type: GeometryArrayType;
      conditionText: string;
      conditionSpan: DslSpan;
      condition?: ModuleScalarExpressionSemantic;
      thenValue: GeometryArraySemanticValue<TTarget>;
      elseValue: GeometryArraySemanticValue<TTarget>;
    }
  | {
      kind: "match";
      span: DslSpan;
      type: GeometryArrayType;
      scrutineeText: string;
      scrutineeSpan: DslSpan;
      scrutinee?: ModuleScalarExpressionSemantic;
      arms: readonly { label: string; labelSpan: DslSpan; value: GeometryArraySemanticValue<TTarget> }[];
    };

export type GeometryArraySemanticValue<TTarget> = GeometryArrayLiteralValue<TTarget> | GeometryArrayAliasValue | GeometryArrayMappedValue | GeometryArrayConditionalValue<TTarget>;

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
  sourceElementType: ScalarType | DslRecordTypeReference;
  resultElementType: ScalarType | DslRecordTypeReference;
  binderId: string;
  binder: string;
  binderSpan: DslSpan;
  sourceSpan: DslSpan;
  bodySpan: DslSpan;
  /** Root documents fill this through typedDeclarationAnalysis. Module
   * definitions fill the parallel Module semantic body through
   * moduleScalarExpression; the collection pass itself only owns shape. */
  body?: TypedScalarExpression;
  /** Nominal-record maps retain one scalar body per result field. The
   * Module semantic owner populates these after the collection pass has
   * established the source/result record identities. */
  recordFields?: readonly {
    field: RecordFieldIdentity;
    fieldName: string;
    type: ScalarType;
    body?: ModuleScalarExpressionSemantic;
  }[];
  sourceOrder: number;
};

export type DslArrayConditionalValue<TTarget> =
  | {
      kind: "if";
      span: DslSpan;
      valueType: DslArrayValueType;
      conditionText: string;
      conditionSpan: DslSpan;
      condition?: ModuleScalarExpressionSemantic;
      thenValue: DslArraySemanticValue<TTarget>;
      elseValue: DslArraySemanticValue<TTarget>;
    }
  | {
      kind: "match";
      span: DslSpan;
      valueType: DslArrayValueType;
      scrutineeText: string;
      scrutineeSpan: DslSpan;
      scrutinee?: ModuleScalarExpressionSemantic;
      arms: readonly { label: string; labelSpan: DslSpan; value: DslArraySemanticValue<TTarget> }[];
    };

export type DslArraySemanticValue<TTarget> = DslArrayLiteralValue<TTarget> | DslArrayAliasValue | DslArrayMappedValue | DslArrayConditionalValue<TTarget>;

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
  resolveValueFor?: (expression: Extract<GeometryArrayExpression, { kind: "valueFor" }>) =>
    | { kind: "resolved"; value: GeometryArrayMappedValue }
    | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };
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
  if (input.expression.kind === "if") {
    const thenResult = resolveDslArrayExpression({ ...input, expression: input.expression.thenBranch });
    const elseResult = resolveDslArrayExpression({ ...input, expression: input.expression.elseBranch });
    const diagnostics = [...thenResult.diagnostics, ...elseResult.diagnostics];
    return thenResult.value && elseResult.value
      ? {
          value: {
            kind: "if",
            span: input.expression.span,
            valueType: input.expectedType,
            conditionText: input.expression.conditionText,
            conditionSpan: input.expression.conditionSpan,
            thenValue: thenResult.value,
            elseValue: elseResult.value
          },
          diagnostics
        }
      : { value: null, diagnostics };
  }
  if (input.expression.kind === "match") {
    const values: { label: string; labelSpan: DslSpan; value: DslArraySemanticValue<TTarget> }[] = [];
    const diagnostics: GeometryArraySemanticDiagnostic[] = [];
    for (const arm of input.expression.arms) {
      const result = resolveDslArrayExpression({ ...input, expression: arm.expression });
      diagnostics.push(...result.diagnostics);
      if (result.value) values.push({ label: arm.label, labelSpan: arm.labelSpan, value: result.value });
    }
    return values.length === input.expression.arms.length && diagnostics.length === 0
      ? { value: { kind: "match", span: input.expression.span, valueType: input.expectedType, scrutineeText: input.expression.scrutineeText, scrutineeSpan: input.expression.scrutineeSpan, arms: values }, diagnostics }
      : { value: null, diagnostics };
  }
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
  if (input.expression.kind === "if") {
    const thenResult = resolveGeometryArrayExpression({ ...input, expression: input.expression.thenBranch });
    const elseResult = resolveGeometryArrayExpression({ ...input, expression: input.expression.elseBranch });
    const branchDiagnostics = [...thenResult.diagnostics, ...elseResult.diagnostics];
    return thenResult.value && elseResult.value
      ? {
          value: {
            kind: "if",
            span: input.expression.span,
            type: input.expectedType,
            conditionText: input.expression.conditionText,
            conditionSpan: input.expression.conditionSpan,
            thenValue: thenResult.value,
            elseValue: elseResult.value
          },
          diagnostics: branchDiagnostics
        }
      : { value: null, diagnostics: branchDiagnostics };
  }
  if (input.expression.kind === "match") {
    const values: { label: string; labelSpan: DslSpan; value: GeometryArraySemanticValue<TTarget> }[] = [];
    for (const arm of input.expression.arms) {
      const result = resolveGeometryArrayExpression({ ...input, expression: arm.expression });
      diagnostics.push(...result.diagnostics);
      if (result.value) values.push({ label: arm.label, labelSpan: arm.labelSpan, value: result.value });
    }
    return values.length === input.expression.arms.length && diagnostics.length === 0
      ? { value: { kind: "match", span: input.expression.span, type: input.expectedType, scrutineeText: input.expression.scrutineeText, scrutineeSpan: input.expression.scrutineeSpan, arms: values }, diagnostics }
      : { value: null, diagnostics };
  }
  if (input.expression.kind === "valueFor") {
    const resolution = input.resolveValueFor?.(input.expression);
    if (!resolution) {
      return {
        value: null,
        diagnostics: [{ code: "geometry-array-value-for-unsupported", message: "geometry array value-for を使用できません。", span: input.expression.span }]
      };
    }
    return resolution.kind === "resolved"
      ? { value: resolution.value, diagnostics: [] }
      : { value: null, diagnostics: [resolution.diagnostic] };
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
