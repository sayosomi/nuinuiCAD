import { encodeIdentityTuple } from "../document/identityTuple";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import type {
  RecordFieldIdentity,
  RecordSemanticAnalysis,
  RecordValueIdentity,
  RecordValueSemantic
} from "../dsl/recordSemanticAnalysis";
import {
  resolveSourceLexicalDeclaration,
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import type { DslSpan } from "../dsl/dslTypes";
import type { BindingId, BindingSeed } from "./bindingCatalog";
import type { ScalarExpressionAst } from "./expressionAst";
import type { ScalarExpressionResolvedReference } from "./typedExpressionAst";
import type { ScalarType } from "./types";

export type RecordScalarFieldInitializer = {
  bindingId: BindingId;
  recordValueStatementId: RecordValueIdentity;
  field: RecordFieldIdentity;
  fieldName: string;
  statementIndex: number;
  sourceOrder: number;
  raw: string;
  span: DslSpan;
  expectedType: ScalarType;
};

export type RecordScalarLoweringPlan = {
  /** Constructor-owned field slots only. Alias values intentionally add no storage. */
  bindingSeeds: readonly BindingSeed[];
  /** Exact authored constructor field expressions, in record declaration order. */
  initializers: readonly RecordScalarFieldInitializer[];
  /** Every lowerable record value, including aliases, mapped to its backing scalar slots. */
  fieldBindingIdsByValueStatementId: ReadonlyMap<RecordValueIdentity, ReadonlyMap<number, BindingId>>;
  /** Values that are semantically present but cannot be lowered by this leaf. */
  unresolvedValueStatementIds: readonly RecordValueIdentity[];
};

export type RecordScalarPropertyIssue = {
  code:
    | "record-field-unknown"
    | "record-field-unavailable"
    | "record-value-forward-reference"
    | "record-value-ambiguous"
    | "record-field-invalid-traversal";
  span: DslSpan;
  message: string;
};

/** Source-side semantic identity retained independently of the scalar runtime slot. */
export type RecordScalarFieldAccess = {
  recordValueStatementId: RecordValueIdentity;
  field: RecordFieldIdentity;
  fieldName: string;
  bindingId: BindingId;
  span: DslSpan;
  baseSpan: DslSpan;
  propertySpan: DslSpan;
};

export type RecordScalarPropertyResolution = {
  /** Raw geometryProperty-node start -> ordinary scalar reference supplied to the shared typechecker. */
  referencesBySpanStart: ReadonlyMap<number, ScalarExpressionResolvedReference>;
  /** Resolved backing-slot dependencies in source traversal order. */
  dependencies: readonly {
    bindingId: BindingId;
    name: string;
    span: DslSpan;
    access: RecordScalarFieldAccess;
  }[];
  accesses: readonly RecordScalarFieldAccess[];
  issues: readonly RecordScalarPropertyIssue[];
};

const fieldIdentityTuple = (field: RecordFieldIdentity) => [
  field.recordStatementId,
  String(field.fieldIndex)
] as const;

export const recordScalarBindingIdFor = (
  recordValueStatementId: RecordValueIdentity,
  field: RecordFieldIdentity
): BindingId => `record-field-binding:${encodeIdentityTuple([
  recordValueStatementId,
  ...fieldIdentityTuple(field)
])}`;

export const recordScalarDeclarationVersionIdFor = (
  recordValueStatementId: RecordValueIdentity,
  field: RecordFieldIdentity
) => `record-field-declaration:${encodeIdentityTuple([
  recordValueStatementId,
  ...fieldIdentityTuple(field)
])}`;

export const planRecordScalarLowering = ({
  analysis,
  sourceNamespace,
  includeValue = () => true
}: {
  analysis: RecordSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  includeValue?: (value: RecordValueSemantic) => boolean;
}): RecordScalarLoweringPlan => {
  const bindingSeeds: BindingSeed[] = [];
  const initializers: RecordScalarFieldInitializer[] = [];
  const fieldBindingIdsByValueStatementId = new Map<RecordValueIdentity, ReadonlyMap<number, BindingId>>();
  const unresolvedValueStatementIds: RecordValueIdentity[] = [];

  const values = [...analysis.valuesByStatementId.values()]
    .filter(includeValue)
    .sort((left, right) => left.statementIndex - right.statementIndex);

  for (const value of values) {
    const scopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(value.statementIndex);
    if (!scopeId || !value.typeIdentity) {
      unresolvedValueStatementIds.push(value.statementId);
      continue;
    }

    if (value.constructor?.targetTypeIdentity === value.typeIdentity) {
      const fieldBindings = new Map<number, BindingId>();
      const fields = [...value.constructor.fields].sort((left, right) => left.field.fieldIndex - right.field.fieldIndex);
      for (const field of fields) {
        if (field.field.recordStatementId !== value.typeIdentity) continue;
        const bindingId = recordScalarBindingIdFor(value.statementId, field.field);
        fieldBindings.set(field.field.fieldIndex, bindingId);
        bindingSeeds.push({
          id: bindingId,
          kind: "typed",
          name: `${value.name}.${field.fieldName}`,
          nameSpan: null,
          statementIndex: value.statementIndex,
          sourceOrder: field.field.fieldIndex,
          effectiveScopeId: scopeId,
          visibility: { kind: "typed", scopeId },
          mutability: "const",
          declaredType: field.expectedType,
          declarationVersionId: recordScalarDeclarationVersionIdFor(value.statementId, field.field),
          resolutionMode: "preResolvedOnly"
        });
        initializers.push({
          bindingId,
          recordValueStatementId: value.statementId,
          field: field.field,
          fieldName: field.fieldName,
          statementIndex: value.statementIndex,
          sourceOrder: field.field.fieldIndex,
          raw: field.value,
          span: field.valueSpan,
          expectedType: field.expectedType
        });
      }
      fieldBindingIdsByValueStatementId.set(value.statementId, fieldBindings);
      continue;
    }

    if (value.reference?.targetTypeIdentity === value.typeIdentity) {
      const lookup = resolveSourceLexicalDeclaration(sourceNamespace, value.statementIndex, value.reference.name);
      if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
        const target = analysis.valuesByStatementIndex.get(lookup.declaration.statementIndex);
        const targetBindings = target ? fieldBindingIdsByValueStatementId.get(target.statementId) : undefined;
        if (target?.typeIdentity === value.typeIdentity && targetBindings) {
          fieldBindingIdsByValueStatementId.set(value.statementId, targetBindings);
          continue;
        }
      }
    }

    unresolvedValueStatementIds.push(value.statementId);
  }

  return {
    bindingSeeds,
    initializers,
    fieldBindingIdsByValueStatementId,
    unresolvedValueStatementIds
  };
};

/**
 * Classifies source-level dotted property nodes that are actually record fields.
 * Non-record bases are intentionally left unclaimed so the existing geometry-property
 * resolver keeps byte-for-byte ownership of those references.
 */
export const resolveRecordScalarProperties = ({
  ast,
  statementIndex,
  analysis,
  sourceNamespace,
  plan,
  skipPropertySpanStarts = new Set<number>()
}: {
  ast: ScalarExpressionAst;
  statementIndex: number;
  analysis: RecordSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  plan: RecordScalarLoweringPlan;
  /** Geometry-builtin operands already claimed by the existing geometry owner. */
  skipPropertySpanStarts?: ReadonlySet<number>;
}): RecordScalarPropertyResolution => {
  const referencesBySpanStart = new Map<number, ScalarExpressionResolvedReference>();
  const dependencies: {
    bindingId: BindingId;
    name: string;
    span: DslSpan;
    access: RecordScalarFieldAccess;
  }[] = [];
  const accesses: RecordScalarFieldAccess[] = [];
  const issues: RecordScalarPropertyIssue[] = [];

  const claimInvalid = (
    node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>,
    issue: RecordScalarPropertyIssue
  ) => {
    referencesBySpanStart.set(node.span.start, { kind: "resolvedType", bindingId: null, type: null });
    issues.push(issue);
  };

  const resolveProperty = (node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>) => {
    if (skipPropertySpanStarts.has(node.span.start)) return;
    const lookup = resolveSourceLexicalPath(
      sourceNamespace,
      statementIndex,
      parseDslReferenceToken(node.elementName)
    );

    if (lookup.kind === "forward" && lookup.declarations.some((item) => item.kind === "recordValue")) {
      claimInvalid(node, {
        code: "record-value-forward-reference",
        span: node.elementNameSpan,
        message: `record 値「${node.elementName}」はこの位置より後で宣言されているため、まだ参照できません。`
      });
      return;
    }
    if (lookup.kind === "ambiguous" && lookup.declarations.some((item) => item.kind === "recordValue")) {
      claimInvalid(node, {
        code: "record-value-ambiguous",
        span: node.elementNameSpan,
        message: `record 値「${node.elementName}」は複数の宣言と一致するため一意に解決できません。`
      });
      return;
    }
    if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "recordValue") {
      claimInvalid(node, {
        code: "record-field-invalid-traversal",
        span: node.elementNameSpan,
        message: `record 値「${lookup.declaration.name}」を namespace として traversal できません。`
      });
      return;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "recordValue") return;

    const value = analysis.valuesByStatementId.get(lookup.declaration.statementId);
    const definition = value?.typeIdentity
      ? analysis.definitionsByStatementId.get(value.typeIdentity)
      : undefined;
    const field = definition?.fields.find((item) => item.name === node.property);
    if (!value || !definition || !field) {
      claimInvalid(node, {
        code: "record-field-unknown",
        span: node.propertySpan,
        message: `record「${definition?.name ?? value?.typeReference.sourceName ?? lookup.declaration.name}」に field「${node.property}」はありません。`
      });
      return;
    }

    const bindingId = plan.fieldBindingIdsByValueStatementId.get(value.statementId)?.get(field.fieldIndex);
    if (!bindingId) {
      claimInvalid(node, {
        code: "record-field-unavailable",
        span: node.span,
        message: `record field「${node.elementName}.${node.property}」はこの実行コンテキストでは利用できません。`
      });
      return;
    }

    const access: RecordScalarFieldAccess = {
      recordValueStatementId: value.statementId,
      field: field.identity,
      fieldName: field.name,
      bindingId,
      span: node.span,
      baseSpan: node.elementNameSpan,
      propertySpan: node.propertySpan
    };
    referencesBySpanStart.set(node.span.start, {
      kind: "resolvedType",
      bindingId,
      type: field.type
    });
    accesses.push(access);
    dependencies.push({
      bindingId,
      name: `${node.elementName}.${node.property}`,
      span: node.span,
      access
    });
  };

  const visit = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "geometryProperty":
        resolveProperty(node);
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "group":
        visit(node.expression);
        return;
      case "call":
        node.args.forEach((argument) => visit(argument.expression));
        return;
      default:
        return;
    }
  };

  visit(ast);
  return { referencesBySpanStart, dependencies, accesses, issues };
};
