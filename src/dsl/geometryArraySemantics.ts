import type { DslSpan } from "./dslTypes";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type { GeometryArrayExpression, GeometryArrayLiteralMember } from "./geometryArrayExpression";
import {
  geometryArrayTypeName,
  isGeometryArrayTypeAssignable,
  type GeometryArrayType
} from "./geometryArrayTypes";

export type GeometryArraySemanticDiagnostic = {
  code: string;
  message: string;
  span: DslSpan;
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

const memberTypeMismatch = (
  expectedType: GeometryArrayType,
  member: GeometryArrayLiteralMember,
  actualType: ModuleGeometryInterfaceType
): GeometryArraySemanticDiagnostic => ({
  code: "geometry-array-member-type-mismatch",
  message: `geometry array member の型が一致しません: ${geometryArrayTypeName(expectedType)} には ${expectedType.elementType} が必要ですが ${actualType} が渡されています。`,
  span: member.span
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
  if (input.expression.kind === "reference") {
    const resolution = input.resolveArrayReference(input.expression.text, input.expression.span);
    if (resolution.kind === "invalid") return { value: null, diagnostics: [resolution.diagnostic] };
    if (resolution.kind === "resolved" && !isGeometryArrayTypeAssignable(resolution.type, input.expectedType)) {
      return {
        value: null,
        diagnostics: [{
          code: "geometry-array-assignability-mismatch",
          message: `geometry array の型が一致しません: ${geometryArrayTypeName(resolution.type)} は ${geometryArrayTypeName(input.expectedType)} に代入できません。`,
          span: input.expression.span
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
