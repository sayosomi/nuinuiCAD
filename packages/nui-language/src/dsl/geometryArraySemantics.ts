import type { DslDiagnosticPresentation, DslSpan } from "./dslTypes";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type { GeometryArrayExpression, GeometryArrayLiteralMember } from "./geometryArrayExpression";
import {
  geometryArrayTypeName,
  isDslNonArrayValueTypeAssignable,
  isGeometryArrayTypeAssignable,
  type GeometryArrayType
} from "./geometryArrayTypes";
import {
  dslCoalesceResultType,
  dslRequiredValueTypeOf,
  isDslOptionalValueType,
  isDslValueTypeAssignable,
  type DslArrayValueType,
  type DslNonArrayValueType,
  type DslValueType
} from "./dslValueTypes";
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
export type GeometryArrayNoneValue = { kind: "none"; type: GeometryArrayType };

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
      arms: readonly { label: string; labelSpan: DslSpan; binder?: string; binderSpan?: DslSpan; value: GeometryArraySemanticValue<TTarget> }[];
    };

export type GeometryArrayCoalesceValue<TTarget> = {
  kind: "coalesce";
  type: GeometryArrayType;
  left: GeometryArraySemanticValue<TTarget>;
  right: GeometryArraySemanticValue<TTarget>;
};

export type GeometryArraySemanticValue<TTarget> = GeometryArrayLiteralValue<TTarget> | GeometryArrayNoneValue | GeometryArrayAliasValue | GeometryArrayMappedValue | GeometryArrayConditionalValue<TTarget> | GeometryArrayCoalesceValue<TTarget>;

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
export type DslArrayNoneValue = { kind: "none"; valueType: DslArrayValueType };

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
      arms: readonly { label: string; labelSpan: DslSpan; binder?: string; binderSpan?: DslSpan; value: DslArraySemanticValue<TTarget> }[];
    };

export type DslArrayCoalesceValue<TTarget> = {
  kind: "coalesce";
  valueType: DslArrayValueType;
  left: DslArraySemanticValue<TTarget>;
  right: DslArraySemanticValue<TTarget>;
};

export type DslArraySemanticValue<TTarget> = DslArrayLiteralValue<TTarget> | DslArrayNoneValue | DslArrayAliasValue | DslArrayMappedValue | DslArrayConditionalValue<TTarget> | DslArrayCoalesceValue<TTarget>;

export type GeometryArrayMemberResolution<TTarget> =
  | { kind: "resolved"; value: GeometryArrayResolvedMember<TTarget> }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type GeometryArrayReferenceResolution =
  | { kind: "resolved"; targetValueId: string; type: GeometryArrayType; valueType?: DslValueType }
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
  expectedValueType?: DslValueType;
  requireOptional?: boolean;
  expression: GeometryArrayExpression;
  resolveMember: (member: GeometryArrayLiteralMember) => GeometryArrayMemberResolution<TTarget>;
  resolveArrayReference: (sourceText: string, sourceSpan: DslSpan) => GeometryArrayReferenceResolution;
  resolveValueFor?: (expression: Extract<GeometryArrayExpression, { kind: "valueFor" }>) =>
    | { kind: "resolved"; value: GeometryArrayMappedValue }
    | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };
};

export type ResolveGeometryArrayExpressionResult<TTarget> = {
  value: GeometryArraySemanticValue<TTarget> | null;
  valueType: DslValueType | null;
  diagnostics: readonly GeometryArraySemanticDiagnostic[];
};

export type DslArrayMemberResolution<TTarget> =
  | { kind: "resolved"; value: { elementType: DslNonArrayValueType; target: TTarget } }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type DslArrayReferenceResolution =
  | { kind: "resolved"; targetValueId: string; valueType: DslValueType }
  | { kind: "deferred"; targetValueId: string }
  | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };

export type ResolveDslArrayExpressionInput<TTarget> = {
  expectedType: DslArrayValueType;
  expectedValueType?: DslValueType;
  requireOptional?: boolean;
  expression: GeometryArrayExpression;
  resolveMember: (member: GeometryArrayLiteralMember) => DslArrayMemberResolution<TTarget>;
  resolveArrayReference: (sourceText: string, sourceSpan: DslSpan) => DslArrayReferenceResolution;
  resolveValueFor?: (expression: Extract<GeometryArrayExpression, { kind: "valueFor" }>) =>
    | { kind: "resolved"; value: DslArrayMappedValue }
    | { kind: "invalid"; diagnostic: GeometryArraySemanticDiagnostic };
};

export type ResolveDslArrayExpressionResult<TTarget> = {
  value: DslArraySemanticValue<TTarget> | null;
  valueType: DslValueType | null;
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
  const expectedValueType = input.expectedValueType ?? input.expectedType;
  if (input.expression.kind === "none") {
    if (!isDslOptionalValueType(expectedValueType)) {
      return { value: null, valueType: null, diagnostics: [{ code: "optional-value-required", message: "none は optional collection 値にのみ指定できます。", span: input.expression.span }] };
    }
    return { value: { kind: "none", valueType: input.expectedType }, valueType: expectedValueType, diagnostics: [] };
  }
  if (input.expression.kind === "coalesce") {
    const leftResult = resolveDslArrayExpression({
      ...input,
      expression: input.expression.left,
      expectedValueType: { kind: "optional", valueType: input.expectedType },
      requireOptional: true
    });
    const rightResult = resolveDslArrayExpression({
      ...input,
      expression: input.expression.right,
      expectedValueType: input.expectedType,
      requireOptional: false
    });
    const diagnostics = [...leftResult.diagnostics, ...rightResult.diagnostics];
    const resultType = dslCoalesceResultType(leftResult.valueType, rightResult.valueType);
    return leftResult.value && rightResult.value && resultType?.kind === "array"
      ? { value: { kind: "coalesce", valueType: input.expectedType, left: leftResult.value, right: rightResult.value }, valueType: input.expectedType, diagnostics }
      : { value: null, valueType: null, diagnostics };
  }
  if (input.expression.kind === "if") {
    const thenResult = resolveDslArrayExpression({ ...input, expression: input.expression.thenBranch });
    const elseResult = input.expression.elseBranch
      ? resolveDslArrayExpression({ ...input, expression: input.expression.elseBranch })
      : isDslOptionalValueType(expectedValueType)
        ? { value: { kind: "none", valueType: input.expectedType } as DslArrayNoneValue, valueType: expectedValueType, diagnostics: [] }
        : { value: null, valueType: null, diagnostics: [{ code: "value-if-missing-else", message: "else を省略できる value-if の結果型は optional collection である必要があります。", span: input.expression.span }] };
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
          valueType: input.expectedType,
          diagnostics
        }
      : { value: null, valueType: null, diagnostics };
  }
  if (input.expression.kind === "match") {
    const values: { label: string; labelSpan: DslSpan; binder?: string; binderSpan?: DslSpan; value: DslArraySemanticValue<TTarget> }[] = [];
    const diagnostics: GeometryArraySemanticDiagnostic[] = [];
    for (const arm of input.expression.arms) {
      const result = resolveDslArrayExpression({ ...input, expression: arm.expression });
      diagnostics.push(...result.diagnostics);
      if (result.value) values.push({ label: arm.label, labelSpan: arm.labelSpan, ...(arm.binder ? { binder: arm.binder, binderSpan: arm.binderSpan } : {}), value: result.value });
    }
    return values.length === input.expression.arms.length && diagnostics.length === 0
      ? { value: { kind: "match", span: input.expression.span, valueType: input.expectedType, scrutineeText: input.expression.scrutineeText, scrutineeSpan: input.expression.scrutineeSpan, arms: values }, valueType: input.expectedType, diagnostics }
      : { value: null, valueType: null, diagnostics };
  }
  if (input.expression.kind === "valueFor") {
    const resolution = input.resolveValueFor?.(input.expression);
    if (!resolution) {
      return {
        value: null,
        valueType: null,
        diagnostics: [{ code: "array-value-for-unsupported", message: "この collection では value-for を使用できません。", span: input.expression.span }]
      };
    }
    return resolution.kind === "resolved"
      ? { value: resolution.value, valueType: resolution.value.valueType, diagnostics: [] }
      : { value: null, valueType: null, diagnostics: [resolution.diagnostic] };
  }
  if (input.expression.kind === "reference") {
    const resolution = input.resolveArrayReference(input.expression.text, input.expression.span);
    if (resolution.kind === "invalid") return { value: null, valueType: null, diagnostics: [resolution.diagnostic] };
    const requiredValueType = dslRequiredValueTypeOf(resolution.kind === "resolved" ? resolution.valueType : null);
    if (resolution.kind === "resolved" && input.requireOptional && !isDslOptionalValueType(resolution.valueType)) {
      return {
        value: null,
        valueType: null,
        diagnostics: [{ code: "coalesce-left-not-optional", message: "?? の左辺は optional collection 値である必要があります。", span: input.expression.span }]
      };
    }
    const assignabilityActual = input.requireOptional ? requiredValueType : resolution.kind === "resolved" ? resolution.valueType : null;
    if (resolution.kind === "resolved" && (!requiredValueType || requiredValueType.kind !== "array" || !assignabilityActual || !isDslValueTypeAssignable(assignabilityActual, expectedValueType))) {
      return {
        value: null,
        valueType: null,
        diagnostics: [{
          code: "array-assignability-mismatch",
          message: `array の型が一致しません: ${dslArrayTypeName(requiredValueType && requiredValueType.kind === "array" ? requiredValueType : input.expectedType)} は ${dslArrayTypeName(input.expectedType)} に代入できません。`,
          span: input.expression.span,
          presentation: {
            key: "diagnostic.array-assignability-mismatch",
            parameters: { actual: dslArrayTypeName(requiredValueType && requiredValueType.kind === "array" ? requiredValueType : input.expectedType), expected: dslArrayTypeName(input.expectedType) }
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
      valueType: resolution.kind === "resolved" ? resolution.valueType : expectedValueType,
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
    valueType: diagnostics.length === 0 ? input.expectedType : null,
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
  const fallbackValueType: DslArrayValueType = { kind: "array", elementType: { kind: input.expectedType.elementType } };
  const expectedValueType = input.expectedValueType ?? fallbackValueType;
  const expectedRequiredValueType = dslRequiredValueTypeOf(expectedValueType);
  if (!expectedRequiredValueType || expectedRequiredValueType.kind !== "array") {
    return {
      value: null,
      valueType: null,
      diagnostics: [{ code: "geometry-array-expected-array", message: "geometry array の期待型が不正です。", span: input.expression.span }]
    };
  }
  if (input.expression.kind === "none") {
    if (!isDslOptionalValueType(expectedValueType)) {
      return { value: null, valueType: null, diagnostics: [{ code: "optional-value-required", message: "none は optional geometry array 値にのみ指定できます。", span: input.expression.span }] };
    }
    return { value: { kind: "none", type: input.expectedType }, valueType: expectedValueType, diagnostics: [] };
  }
  if (input.expression.kind === "coalesce") {
    const leftResult = resolveGeometryArrayExpression({
      ...input,
      expression: input.expression.left,
      expectedValueType: { kind: "optional", valueType: expectedRequiredValueType },
      requireOptional: true
    });
    const rightResult = resolveGeometryArrayExpression({
      ...input,
      expression: input.expression.right,
      expectedValueType: expectedRequiredValueType,
      requireOptional: false
    });
    const branchDiagnostics = [...leftResult.diagnostics, ...rightResult.diagnostics];
    const resultType = dslCoalesceResultType(leftResult.valueType, rightResult.valueType);
    return leftResult.value && rightResult.value && resultType?.kind === "array"
      ? { value: { kind: "coalesce", type: input.expectedType, left: leftResult.value, right: rightResult.value }, valueType: expectedRequiredValueType, diagnostics: branchDiagnostics }
      : { value: null, valueType: null, diagnostics: branchDiagnostics };
  }
  if (input.expression.kind === "if") {
    const thenResult = resolveGeometryArrayExpression({ ...input, expression: input.expression.thenBranch });
    const elseResult = input.expression.elseBranch
      ? resolveGeometryArrayExpression({ ...input, expression: input.expression.elseBranch })
      : isDslOptionalValueType(expectedValueType)
        ? { value: { kind: "none", type: input.expectedType } as GeometryArrayNoneValue, valueType: expectedValueType, diagnostics: [] }
        : { value: null, valueType: null, diagnostics: [{ code: "value-if-missing-else", message: "else を省略できる value-if の結果型は optional geometry array である必要があります。", span: input.expression.span }] };
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
          valueType: expectedValueType,
          diagnostics: branchDiagnostics
        }
      : { value: null, valueType: null, diagnostics: branchDiagnostics };
  }
  if (input.expression.kind === "match") {
    const values: { label: string; labelSpan: DslSpan; binder?: string; binderSpan?: DslSpan; value: GeometryArraySemanticValue<TTarget> }[] = [];
    for (const arm of input.expression.arms) {
      const result = resolveGeometryArrayExpression({ ...input, expression: arm.expression });
      diagnostics.push(...result.diagnostics);
      if (result.value) values.push({ label: arm.label, labelSpan: arm.labelSpan, ...(arm.binder ? { binder: arm.binder, binderSpan: arm.binderSpan } : {}), value: result.value });
    }
    return values.length === input.expression.arms.length && diagnostics.length === 0
      ? { value: { kind: "match", span: input.expression.span, type: input.expectedType, scrutineeText: input.expression.scrutineeText, scrutineeSpan: input.expression.scrutineeSpan, arms: values }, valueType: expectedValueType, diagnostics }
      : { value: null, valueType: null, diagnostics };
  }
  if (input.expression.kind === "valueFor") {
    const resolution = input.resolveValueFor?.(input.expression);
    if (!resolution) {
      return {
        value: null,
        valueType: null,
        diagnostics: [{ code: "geometry-array-value-for-unsupported", message: "geometry array value-for を使用できません。", span: input.expression.span }]
      };
    }
    return resolution.kind === "resolved"
      ? { value: resolution.value, valueType: expectedValueType, diagnostics: [] }
      : { value: null, valueType: null, diagnostics: [resolution.diagnostic] };
  }
  if (input.expression.kind === "reference") {
    const resolution = input.resolveArrayReference(input.expression.text, input.expression.span);
    if (resolution.kind === "invalid") return { value: null, valueType: null, diagnostics: [resolution.diagnostic] };
    const actualValueType = resolution.kind === "resolved"
      ? resolution.valueType ?? { kind: "array", elementType: { kind: resolution.type.elementType } } satisfies DslArrayValueType
      : null;
    const requiredValueType = dslRequiredValueTypeOf(actualValueType);
    if (resolution.kind === "resolved" && input.requireOptional && !isDslOptionalValueType(actualValueType)) {
      return {
        value: null,
        valueType: null,
        diagnostics: [{ code: "coalesce-left-not-optional", message: "?? の左辺は optional geometry array 値である必要があります。", span: input.expression.span }]
      };
    }
    const assignabilityActual = input.requireOptional ? requiredValueType : actualValueType;
    if (resolution.kind === "resolved" && (!actualValueType || !requiredValueType || requiredValueType.kind !== "array" || !assignabilityActual || !isDslValueTypeAssignable(assignabilityActual, expectedValueType))) {
      return {
        value: null,
        valueType: null,
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
      valueType: actualValueType,
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
    valueType: diagnostics.length === 0 ? expectedValueType : null,
    diagnostics
  };
};
