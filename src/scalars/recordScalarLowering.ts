import { encodeIdentityTuple } from "../document/identityTuple";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import type {
  RecordFieldIdentity,
  RecordSemanticAnalysis,
  RecordTypeIdentity,
  RecordValueIdentity,
  RecordValueSemantic
} from "../dsl/recordSemanticAnalysis";
import {
  resolveSourceLexicalDeclaration,
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import type { DslSpan } from "../dsl/dslTypes";
import type {
  BindingCatalog,
  BindingId,
  BindingSeed,
  SourceNamespaceBindingResolver
} from "./bindingCatalog";
import type { BindingResolution } from "./bindingResolution";
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

/** Compiler-owned scalar backing for a whole-record alias resolved outside the
 * source-only record namespace. The caller proves the nominal type and
 * supplies existing field bindings; this planner never creates storage for it. */
export type ExternalRecordScalarAlias = {
  typeIdentity: RecordTypeIdentity;
  fieldBindingIdsByFieldIndex: ReadonlyMap<number, BindingId>;
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
    access?: RecordScalarFieldAccess;
  }[];
  accesses: readonly RecordScalarFieldAccess[];
  issues: readonly RecordScalarPropertyIssue[];
};

export type PreparedRecordScalarExpression = RecordScalarPropertyResolution & {
  ast: ScalarExpressionAst;
  /** One entry per transformed/reference AST node, in the AST's source traversal order. */
  references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
};

export type AdditionalRecordScalarPropertyResolution = {
  resolution: ScalarExpressionResolvedReference;
  dependency?: {
    bindingId: BindingId;
    name: string;
    span: DslSpan;
  };
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
  includeValue = () => true,
  additionalRecordValueResolver
}: {
  analysis: RecordSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  includeValue?: (value: RecordValueSemantic) => boolean;
  additionalRecordValueResolver?: (value: RecordValueSemantic) => ExternalRecordScalarAlias | null;
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
          resolutionMode: "preResolvedOnly",
          catalogOrder: "source"
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

    const externalAlias = additionalRecordValueResolver?.(value) ?? null;
    const definition = analysis.definitionsByStatementId.get(value.typeIdentity);
    if (
      externalAlias?.typeIdentity === value.typeIdentity &&
      definition &&
      externalAlias.fieldBindingIdsByFieldIndex.size === definition.fields.length &&
      definition.fields.every((field) => externalAlias.fieldBindingIdsByFieldIndex.get(field.fieldIndex) !== undefined)
    ) {
      fieldBindingIdsByValueStatementId.set(value.statementId, externalAlias.fieldBindingIdsByFieldIndex);
      continue;
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
 * Record-aware branch for the existing source namespace -> scalar catalog
 * adapter. The caller composes this before ordinary scalar source lookup.
 * Dotted names that do not resolve to record values are deliberately ignored.
 */
export const recordScalarSourceBindingResolverFor = ({
  analysis,
  sourceNamespace,
  plan
}: {
  analysis: RecordSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  plan: RecordScalarLoweringPlan;
}): SourceNamespaceBindingResolver => (name, statementIndex) => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const baseName = name.slice(0, dot);
  const property = name.slice(dot + 1);
  // A second property separator means chained record access, which v1 does
  // not support. Claim it only if the first base is itself a record value.
  const firstDot = baseName.indexOf(".");
  if (firstDot >= 0) {
    const firstBase = baseName.slice(0, firstDot);
    const firstLookup = resolveSourceLexicalPath(
      sourceNamespace,
      statementIndex,
      parseDslReferenceToken(firstBase)
    );
    if (firstLookup.kind === "resolved" && firstLookup.declaration.kind === "recordValue") {
      return {
        kind: "blocked",
        reason: "invalidTraversal",
        declarationKind: "recordValue",
        statementId: firstLookup.declaration.statementId
      };
    }
    return null;
  }

  const lookup = resolveSourceLexicalPath(
    sourceNamespace,
    statementIndex,
    parseDslReferenceToken(baseName)
  );
  if (lookup.kind === "forward") {
    const declaration = lookup.declarations.find((item) => item.kind === "recordValue");
    return declaration
      ? {
          kind: "blocked",
          reason: "forward",
          declarationKind: "recordValue",
          statementId: declaration.statementId
        }
      : null;
  }
  if (lookup.kind === "ambiguous") {
    const declaration = lookup.declarations.find((item) => item.kind === "recordValue");
    return declaration
      ? {
          kind: "blocked",
          reason: "ambiguous",
          declarationKind: "recordValue",
          statementId: declaration.statementId
        }
      : null;
  }
  if (lookup.kind === "invalidTraversal") {
    return lookup.declaration.kind === "recordValue"
      ? {
          kind: "blocked",
          reason: "invalidTraversal",
          declarationKind: "recordValue",
          statementId: lookup.declaration.statementId
        }
      : null;
  }
  if (lookup.kind !== "resolved" || lookup.declaration.kind !== "recordValue") return null;

  const value = analysis.valuesByStatementId.get(lookup.declaration.statementId);
  const definition = value?.typeIdentity
    ? analysis.definitionsByStatementId.get(value.typeIdentity)
    : undefined;
  const field = definition?.fields.find((item) => item.name === property);
  if (!value || !definition || !field) {
    return {
      kind: "blocked",
      reason: "incompatible",
      declarationKind: "recordValue",
      statementId: lookup.declaration.statementId
    };
  }
  const bindingId = plan.fieldBindingIdsByValueStatementId.get(value.statementId)?.get(field.fieldIndex);
  return bindingId
    ? { kind: "resolved", bindingId }
    : {
        kind: "blocked",
        reason: "incompatible",
        declarationKind: "recordValue",
        statementId: lookup.declaration.statementId
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
    access?: RecordScalarFieldAccess;
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

const blockedRecordPropertyIssue = (
  node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>,
  reason: "forward" | "ambiguous" | "incompatible" | "invalidTraversal" | "private"
): RecordScalarPropertyIssue => {
  if (reason === "forward") {
    return {
      code: "record-value-forward-reference",
      span: node.elementNameSpan,
      message: `record 値「${node.elementName}」はこの位置より後で宣言されているため、まだ参照できません。`
    };
  }
  if (reason === "ambiguous") {
    return {
      code: "record-value-ambiguous",
      span: node.elementNameSpan,
      message: `record 値「${node.elementName}」は複数の宣言と一致するため一意に解決できません。`
    };
  }
  if (reason === "invalidTraversal") {
    return {
      code: "record-field-invalid-traversal",
      span: node.span,
      message: `record field「${node.elementName}.${node.property}」の chained / namespace traversal は v1 では使用できません。`
    };
  }
  return {
    code: "record-field-unknown",
    span: node.propertySpan,
    message: `record 値「${node.elementName}」に利用可能な field「${node.property}」はありません。`
  };
};

/**
 * Consumer-side variant that needs no record semantic object. The catalog's
 * source namespace adapter already closes over the exact current record model
 * and lowering plan, and Module scalar runtime preserves that adapter when it
 * rebuilds the combined catalog. This keeps every scalar consumer on one
 * record-property rule without threading record objects through dslDocument.
 */
export const prepareRecordScalarExpressionFromCatalog = ({
  ast,
  statementIndex,
  catalog,
  referenceResolutions,
  skipPropertySpanStarts = new Set<number>()
}: {
  ast: ScalarExpressionAst;
  statementIndex: number;
  catalog: BindingCatalog;
  referenceResolutions: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  skipPropertySpanStarts?: ReadonlySet<number>;
}): PreparedRecordScalarExpression => {
  const referencesBySpanStart = new Map<number, ScalarExpressionResolvedReference>();
  const dependencies: { bindingId: BindingId; name: string; span: DslSpan }[] = [];
  const issues: RecordScalarPropertyIssue[] = [];
  const scopeId = catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? catalog.scopeIndex.rootScopeId;

  const visitProperty = (node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>) => {
    if (skipPropertySpanStarts.has(node.span.start)) return;
    const lookup = catalog.sourceNamespaceBindingResolver?.(
      `${node.elementName}.${node.property}`,
      statementIndex,
      scopeId
    );
    if (lookup?.kind === "resolved") {
      const binding = catalog.bindingsById.get(lookup.bindingId);
      if (!binding || binding.kind !== "typed") {
        referencesBySpanStart.set(node.span.start, { kind: "resolvedType", bindingId: null, type: null });
        issues.push({
          code: "record-field-unavailable",
          span: node.span,
          message: `record field「${node.elementName}.${node.property}」の scalar binding を取得できません。`
        });
        return;
      }
      referencesBySpanStart.set(node.span.start, {
        kind: "resolvedType",
        bindingId: binding.id,
        type: binding.declaredType
      });
      dependencies.push({ bindingId: binding.id, name: `${node.elementName}.${node.property}`, span: node.span });
      return;
    }
    if (lookup?.kind === "blocked" && lookup.declarationKind === "recordValue") {
      referencesBySpanStart.set(node.span.start, { kind: "resolvedType", bindingId: null, type: null });
      issues.push(blockedRecordPropertyIssue(node, lookup.reason));
    }
  };

  const classify = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "geometryProperty": visitProperty(node); return;
      case "unary": classify(node.operand); return;
      case "binary": classify(node.left); classify(node.right); return;
      case "group": classify(node.expression); return;
      case "call": node.args.forEach((argument) => classify(argument.expression)); return;
      default: return;
    }
  };
  classify(ast);

  const references: (BindingResolution | ScalarExpressionResolvedReference)[] = [];
  let referenceCursor = 0;
  const rewrite = (node: ScalarExpressionAst): ScalarExpressionAst => {
    switch (node.kind) {
      case "reference": {
        const resolution = referenceResolutions[referenceCursor];
        if (!resolution) throw new Error(`recordScalarLowering: no resolution supplied for @${node.name} at ${node.span.start}`);
        referenceCursor += 1;
        references.push(resolution);
        return node;
      }
      case "geometryProperty": {
        const resolution = referencesBySpanStart.get(node.span.start);
        if (!resolution || resolution.kind !== "resolvedType") return node;
        references.push(resolution);
        return {
          kind: "reference",
          span: node.span,
          nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
          name: `${node.elementName}.${node.property}`
        };
      }
      case "unary": return { ...node, operand: rewrite(node.operand) };
      case "binary": return { ...node, left: rewrite(node.left), right: rewrite(node.right) };
      case "group": return { ...node, expression: rewrite(node.expression) };
      case "call": return { ...node, args: node.args.map((argument) => ({ ...argument, expression: rewrite(argument.expression) })) };
      default: return node;
    }
  };
  const rewritten = rewrite(ast);
  if (referenceCursor !== referenceResolutions.length) {
    throw new Error(`recordScalarLowering: ${referenceResolutions.length - referenceCursor} unconsumed scalar reference resolution(s)`);
  }
  return {
    ast: rewritten,
    references,
    referencesBySpanStart,
    dependencies,
    accesses: [],
    issues
  };
};

/**
 * Rewrites only record-owned dotted property syntax to the ordinary scalar
 * reference AST shape. Existing geometry properties remain unchanged.
 * `referenceResolutions` corresponds only to the source AST's original
 * `reference` nodes; record-property resolutions are inserted into the
 * rewritten traversal at their source position.
 */
export const prepareRecordScalarExpression = ({
  ast,
  statementIndex,
  analysis,
  sourceNamespace,
  plan,
  referenceResolutions,
  skipPropertySpanStarts,
  additionalPropertyResolver
}: {
  ast: ScalarExpressionAst;
  statementIndex: number;
  analysis: RecordSemanticAnalysis;
  sourceNamespace: SourceLexicalNamespaceIndex;
  plan: RecordScalarLoweringPlan;
  referenceResolutions: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  skipPropertySpanStarts?: ReadonlySet<number>;
  additionalPropertyResolver?: (node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>) => AdditionalRecordScalarPropertyResolution | null;
}): PreparedRecordScalarExpression => {
  const propertyResolution = resolveRecordScalarProperties({
    ast,
    statementIndex,
    analysis,
    sourceNamespace,
    plan,
    ...(skipPropertySpanStarts ? { skipPropertySpanStarts } : {})
  });
  const additionalPropertiesBySpanStart = new Map<number, AdditionalRecordScalarPropertyResolution>();
  const resolveAdditionalProperty = (node: Extract<ScalarExpressionAst, { kind: "geometryProperty" }>) => {
    const existing = additionalPropertiesBySpanStart.get(node.span.start);
    if (existing) return existing;
    const resolved = additionalPropertyResolver?.(node) ?? null;
    if (resolved) additionalPropertiesBySpanStart.set(node.span.start, resolved);
    return resolved;
  };
  const references: (BindingResolution | ScalarExpressionResolvedReference)[] = [];
  let referenceCursor = 0;

  const rewrite = (node: ScalarExpressionAst): ScalarExpressionAst => {
    switch (node.kind) {
      case "reference": {
        const resolution = referenceResolutions[referenceCursor];
        if (!resolution) {
          throw new Error(`recordScalarLowering: no resolution supplied for @${node.name} at ${node.span.start}`);
        }
        referenceCursor += 1;
        references.push(resolution);
        return node;
      }
      case "geometryProperty": {
        const additional = propertyResolution.referencesBySpanStart.has(node.span.start) ? null : resolveAdditionalProperty(node);
        const resolution = propertyResolution.referencesBySpanStart.get(node.span.start) ?? additional?.resolution;
        if (!resolution || resolution.kind !== "resolvedType") return node;
        references.push(resolution);
        return {
          kind: "reference",
          span: node.span,
          nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
          name: `${node.elementName}.${node.property}`
        };
      }
      case "unary":
        return { ...node, operand: rewrite(node.operand) };
      case "binary":
        return { ...node, left: rewrite(node.left), right: rewrite(node.right) };
      case "group":
        return { ...node, expression: rewrite(node.expression) };
      case "call":
        return {
          ...node,
          args: node.args.map((argument) => ({ ...argument, expression: rewrite(argument.expression) }))
        };
      default:
        return node;
    }
  };

  const rewritten = rewrite(ast);
  if (referenceCursor !== referenceResolutions.length) {
    throw new Error(
      `recordScalarLowering: ${referenceResolutions.length - referenceCursor} unconsumed scalar reference resolution(s)`
    );
  }
  return {
    ...propertyResolution,
    ast: rewritten,
    references,
    dependencies: [
      ...propertyResolution.dependencies,
      ...[...additionalPropertiesBySpanStart.values()].flatMap((property) => property.dependency ? [property.dependency] : [])
    ]
  };
};
