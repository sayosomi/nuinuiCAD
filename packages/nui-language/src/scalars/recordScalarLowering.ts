import { encodeIdentityTuple } from "../document/identityTuple";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import type {
  RecordDefinitionSemantic,
  RecordFieldSemantic,
  RecordFieldIdentity,
  RecordSemanticAnalysis,
  RecordTypeIdentity,
  RecordValueExpressionSemantic,
  RecordValueIdentity,
  RecordValueSemantic
} from "../dsl/recordSemanticAnalysis";
import {
  resolveSourceLexicalDeclaration,
  resolveSourceLexicalPath,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import { parseRecordConstructorFields } from "../dsl/recordSemanticAnalysis";
import type { DslDiagnosticPresentation, DslSpan } from "../dsl/dslTypes";
import type {
  BindingCatalog,
  BindingId,
  BindingSeed,
  SourceNamespaceBindingResolver
} from "./bindingCatalog";
import type { BindingResolution } from "./bindingResolution";
import type { ScalarExpressionAst } from "./expressionAst";
import { parseScalarExpression } from "./expressionParser";
import type { ScalarExpressionResolvedReference } from "./typedExpressionAst";
import type { ScalarExpressionType } from "./types";
import { isDslOptionalValueType, isDslRecordValueType, scalarExpressionTypeOfDslValueType } from "../dsl/dslValueTypes";

export type RecordScalarFieldInitializer = {
  bindingId: BindingId;
  recordValueStatementId: RecordValueIdentity;
  field: RecordFieldIdentity;
  fieldPath?: readonly RecordFieldIdentity[];
  fieldName: string;
  statementIndex: number;
  sourceOrder: number;
  raw: string;
  span: DslSpan;
  expectedType: ScalarExpressionType;
  /** Projected scalar AST for a record-valued control-flow initializer. */
  ast?: ScalarExpressionAst;
  /** Compiler-only metadata for suppressing repeated diagnostics from the
   * shared authored record control-flow shell. */
  recordControlFlowProjection?: RecordScalarControlFlowProjection;
};

export type RecordScalarControlFlowShell =
  | {
      kind: "if";
      span: DslSpan;
      conditionSpan: DslSpan;
    }
  | {
      kind: "match";
      span: DslSpan;
      scrutineeSpan: DslSpan;
      caseLabelSpans: readonly DslSpan[];
    };

export type RecordScalarControlFlowProjection = {
  recordValueStatementId: RecordValueIdentity;
  diagnosticOwner: boolean;
  shells: readonly RecordScalarControlFlowShell[];
};

export type RecordScalarLoweringPlan = {
  /** Constructor-owned field slots only. Alias values intentionally add no storage. */
  bindingSeeds: readonly BindingSeed[];
  /** Exact authored constructor field expressions, in record declaration order. */
  initializers: readonly RecordScalarFieldInitializer[];
  /** Every lowerable record value, including aliases, mapped to its backing scalar slots. */
  fieldBindingIdsByValueStatementId: ReadonlyMap<RecordValueIdentity, ReadonlyMap<number, BindingId>>;
  /** Scalar backing for nested record member paths. */
  fieldBindingIdsByAccessPathByValueStatementId: ReadonlyMap<RecordValueIdentity, ReadonlyMap<string, BindingId>>;
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
  presentation?: DslDiagnosticPresentation;
};

/** Source-side semantic identity retained independently of the scalar runtime slot. */
export type RecordScalarFieldAccess = {
  recordValueStatementId: RecordValueIdentity;
  field: RecordFieldIdentity;
  fieldPath?: readonly RecordFieldIdentity[];
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

export const recordScalarBindingIdForPath = (
  recordValueStatementId: RecordValueIdentity,
  path: readonly RecordFieldIdentity[]
): BindingId => path.length === 1
  ? recordScalarBindingIdFor(recordValueStatementId, path[0]!)
  : `record-field-binding-path:${encodeIdentityTuple([
      recordValueStatementId,
      ...path.flatMap((field) => [field.recordStatementId, String(field.fieldIndex)])
    ])}`;

/** Stable collection-runtime identity for a whole nominal record value. */
export const recordValueCollectionIdFor = (path: readonly string[], statementId: string): string =>
  `record-value:${JSON.stringify([path, statementId])}`;

/** Stable collection-runtime identity for a scalar field projected from a
 * whole nominal record value. */
export const recordFieldCollectionValueIdFor = (
  collectionValueId: string,
  field: Pick<RecordFieldIdentity, "recordStatementId" | "fieldIndex">,
  fieldPath: readonly RecordFieldIdentity[] = [field]
) => fieldPath.length === 1
  ? `record-field-collection:${JSON.stringify([collectionValueId, field.recordStatementId, field.fieldIndex])}`
  : `record-field-collection:${JSON.stringify([
      collectionValueId,
      "path",
      fieldPath.map((candidate) => [candidate.recordStatementId, candidate.fieldIndex])
    ])}`;

const recordFieldPathKey = (path: readonly RecordFieldIdentity[]) => JSON.stringify(
  path.map((field) => [field.recordStatementId, field.fieldIndex])
);

type ScalarRecordMemberResolution =
  | { kind: "resolved"; field: RecordFieldIdentity; fieldName: string; fieldPath: readonly RecordFieldIdentity[]; type: ScalarExpressionType }
  | { kind: "unknown" }
  | { kind: "invalidTraversal" }
  | { kind: "nonScalar" };

const scalarRecordMemberFor = (
  analysis: RecordSemanticAnalysis,
  typeIdentity: RecordTypeIdentity,
  property: string
): ScalarRecordMemberResolution => {
  const parts = property.split(".").map((part) => /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(part));
  if (!parts.length || parts.some((part) => !part)) return { kind: "unknown" };
  let type: import("../dsl/dslValueTypes").DslValueType = { kind: "record", name: "", identity: typeIdentity };
  const fieldPath: RecordFieldIdentity[] = [];
  let field: RecordFieldSemantic | null = null;
  for (const part of parts) {
    if (type.kind === "record") {
      const definition: RecordDefinitionSemantic | null = analysis.definitionsByStatementId.get(type.identity ?? "") ?? null;
      field = definition?.fields.find((candidate) => candidate.name === part![1]) ?? null;
      if (!field) return { kind: "unknown" };
      fieldPath.push(field.identity);
      type = field.type;
      if (part![2] !== undefined) {
        if (type.kind !== "array") return { kind: "unknown" };
        type = type.elementType;
      }
      continue;
    }
    // Geometry properties and collection length belong to their existing
    // semantic owners; the scalar record adapter must not steal them. A
    // scalar followed by another member is instead an invalid record
    // traversal and must remain owned by the record diagnostic path.
    return scalarExpressionTypeOfDslValueType(type) ? { kind: "invalidTraversal" } : { kind: "nonScalar" };
  }
  const scalar = scalarExpressionTypeOfDslValueType(type);
  return scalar && field ? { kind: "resolved", field: field.identity, fieldName: field.name, fieldPath, type: scalar } : { kind: "nonScalar" };
};

export const recordScalarDeclarationVersionIdFor = (
  recordValueStatementId: RecordValueIdentity,
  field: RecordFieldIdentity
) => `record-field-declaration:${encodeIdentityTuple([
  recordValueStatementId,
  ...fieldIdentityTuple(field)
])}`;

const syntheticRecordField = (
  reference: { name: string; span: DslSpan },
  fieldName: string
): Extract<ScalarExpressionAst, { kind: "geometryProperty" }> => ({
  kind: "geometryProperty",
  span: reference.span,
  elementNameSpan: reference.span,
  propertySpan: reference.span,
  elementName: reference.name,
  property: fieldName
});

const recordCollectionFieldIndexNameFor = (
  baseName: string,
  field: { identity?: RecordFieldIdentity; fieldIndex: number }
) => `__nui_record_field__${JSON.stringify([baseName, field.identity?.recordStatementId ?? null, field.fieldIndex])}`;

/** Projects one nominal-record control-flow tree into the scalar expression
 * owned by a particular field. Whole-record leaves deliberately use the
 * existing record-property adapter with the authored leaf span; the dotted
 * name exists only inside the compiler and cannot become a source occurrence. */
const projectRecordFieldExpression = (
  expression: RecordValueExpressionSemantic,
  field: { fieldIndex: number; name: string }
): ScalarExpressionAst | null => {
  if (expression.kind === "constructor") {
    const constructorField = expression.constructor.fields.find((candidate) => candidate.field.fieldIndex === field.fieldIndex);
    if (!constructorField) return null;
    return parseScalarExpression(
      `${" ".repeat(constructorField.valueSpan.start)}${constructorField.value}`,
      constructorField.valueSpan
    ).ast;
  }
  if (expression.kind === "reference") return syntheticRecordField(expression.reference, field.name);
  if (expression.kind === "collectionIndex") {
    return {
      ...expression.expression,
      name: recordCollectionFieldIndexNameFor(expression.expression.name, field)
    };
  }
  if (expression.kind === "if") {
    const thenBranch = expression.thenBranch ? projectRecordFieldExpression(expression.thenBranch, field) : null;
    const elseBranch = expression.elseBranch ? projectRecordFieldExpression(expression.elseBranch, field) : null;
    return thenBranch && elseBranch
      ? {
          kind: "valueIf",
          span: expression.span,
          condition: expression.condition,
          thenBranch,
          elseBranch
        }
      : null;
  }
  if (expression.kind === "none" || expression.kind === "coalesce") return null;
  const scrutinee = expression.scrutinee;
  const arms = expression.arms.map((arm) => ({
    label: arm.label,
    labelSpan: arm.labelSpan,
    expression: arm.expression ? projectRecordFieldExpression(arm.expression, field) : null
  }));
  return arms.every((arm) => arm.expression)
    ? {
        kind: "valueMatch",
        span: expression.span,
        scrutinee,
        arms: arms as { label: string; labelSpan: DslSpan; expression: ScalarExpressionAst }[]
      }
    : null;
};

const recordControlFlowShellsFor = (
  expression: RecordValueExpressionSemantic
): readonly RecordScalarControlFlowShell[] => {
  if (expression.kind === "if") {
    return [
      { kind: "if", span: expression.span, conditionSpan: expression.condition.span },
      ...(expression.thenBranch ? recordControlFlowShellsFor(expression.thenBranch) : []),
      ...(expression.elseBranch ? recordControlFlowShellsFor(expression.elseBranch) : [])
    ];
  }
  if (expression.kind === "match") {
    return [
      {
        kind: "match",
        span: expression.span,
        scrutineeSpan: expression.scrutinee.span,
        caseLabelSpans: expression.arms.map((arm) => arm.labelSpan)
      },
      ...expression.arms.flatMap((arm) => arm.expression ? recordControlFlowShellsFor(arm.expression) : [])
    ];
  }
  return [];
};

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
  const fieldBindingIdsByAccessPathByValueStatementId = new Map<RecordValueIdentity, ReadonlyMap<string, BindingId>>();
  const unresolvedValueStatementIds: RecordValueIdentity[] = [];

  const values = [...analysis.valuesByStatementId.values()]
    .filter(includeValue)
    .sort((left, right) => left.statementIndex - right.statementIndex);

  const scalarFieldPathsFor = (
    definition: NonNullable<ReturnType<RecordSemanticAnalysis["definitionsByStatementId"]["get"]>>,
    prefix: readonly RecordFieldIdentity[] = []
  ): { field: Extract<typeof definition.fields[number], { type: unknown }>; path: readonly RecordFieldIdentity[]; type: ScalarExpressionType }[] => definition.fields.flatMap((field) => {
    const path = [...prefix, field.identity];
    const scalar = scalarExpressionTypeOfDslValueType(field.type);
    if (scalar) return [{ field, path, type: scalar }];
    if (!isDslRecordValueType(field.type)) return [];
    const nested = analysis.definitionsByStatementId.get(field.type.identity ?? "");
    return nested ? scalarFieldPathsFor(nested, path) : [];
  });

  const constructorFieldAtPath = (
    constructorFields: readonly { field: RecordFieldIdentity; value: string; valueSpan: DslSpan; expectedType: import("../dsl/dslValueTypes").DslValueType }[],
    path: readonly RecordFieldIdentity[]
  ): { field: { field: RecordFieldIdentity; value: string; valueSpan: DslSpan; expectedType: import("../dsl/dslValueTypes").DslValueType }; path: readonly RecordFieldIdentity[] } | null => {
    let fields = constructorFields;
    let current: { field: RecordFieldIdentity; value: string; valueSpan: DslSpan; expectedType: import("../dsl/dslValueTypes").DslValueType } | null = null;
    for (const [index, wanted] of path.entries()) {
      current = fields.find((candidate) => candidate.field.fieldIndex === wanted.fieldIndex) ?? null;
      if (!current) return null;
      if (index === path.length - 1) return { field: current, path };
      const definition = current.expectedType.kind === "record"
        ? analysis.definitionsByStatementId.get(current.expectedType.identity ?? "")
        : null;
      if (!definition) return null;
      const nested = parseRecordConstructorFields({ initializer: current.value, initializerSpan: current.valueSpan, definition });
      if (!nested) return null;
      fields = nested.fields;
    }
    return current ? { field: current, path } : null;
  };

  for (const value of values) {
    const scopeId = sourceNamespace.scopeIndex.scopeOfStatement.get(value.statementIndex);
    if (!scopeId || !value.typeIdentity) {
      unresolvedValueStatementIds.push(value.statementId);
      continue;
    }

    // A generic optional/`??` record is represented by the shared record
    // collection runtime. It has no scalar field backing until a selected
    // record member is projected, so do not seed field bindings that cannot
    // have scalar declarations (and would otherwise poison bindingVersions).
    if (value.valueExpression?.kind === "none" || value.valueExpression?.kind === "coalesce" || isDslOptionalValueType(value.valueExpression?.valueType)) {
      continue;
    }

    if (value.valueExpression) {
      const definition = analysis.definitionsByStatementId.get(value.typeIdentity);
      if (!definition) {
        unresolvedValueStatementIds.push(value.statementId);
        continue;
      }
      const fieldBindings = new Map<number, BindingId>();
      const pathBindings = new Map<string, BindingId>();
      let complete = true;
      let diagnosticOwnerAssigned = false;
      let seedOrder = 0;
      for (const { field, path, type: expectedType } of scalarFieldPathsFor(definition)) {
        const bindingId = recordScalarBindingIdForPath(value.statementId, path);
        if (path.length === 1) fieldBindings.set(field.fieldIndex, bindingId);
        pathBindings.set(recordFieldPathKey(path), bindingId);
        bindingSeeds.push({
          id: bindingId,
          kind: "typed",
          name: `${value.name}.${path.map((candidate) => analysis.definitionsByStatementId.get(candidate.recordStatementId)?.fields.find((field) => field.identity.fieldIndex === candidate.fieldIndex)?.name ?? "").join(".")}`,
          nameSpan: null,
          statementIndex: value.statementIndex,
          sourceOrder: seedOrder++,
          effectiveScopeId: scopeId,
          visibility: { kind: "typed", scopeId },
          mutability: "const",
          declaredType: expectedType,
          declarationVersionId: recordScalarDeclarationVersionIdFor(value.statementId, field.identity),
          resolutionMode: "preResolvedOnly",
          catalogOrder: "source"
        });
        const ast = path.length === 1 ? projectRecordFieldExpression(value.valueExpression, field) : null;
        if (!ast) {
          complete = false;
          continue;
        }
        const diagnosticOwner = !diagnosticOwnerAssigned;
        diagnosticOwnerAssigned = true;
        initializers.push({
          bindingId,
          recordValueStatementId: value.statementId,
          field: field.identity,
          fieldPath: path,
          fieldName: field.name,
          statementIndex: value.statementIndex,
          sourceOrder: field.fieldIndex,
          raw: "",
          span: value.valueExpression.span,
          expectedType,
          ast,
          recordControlFlowProjection: {
            recordValueStatementId: value.statementId,
            diagnosticOwner,
            shells: recordControlFlowShellsFor(value.valueExpression)
          }
        });
      }
      if (complete) fieldBindingIdsByValueStatementId.set(value.statementId, fieldBindings);
      if (complete) fieldBindingIdsByAccessPathByValueStatementId.set(value.statementId, pathBindings);
      else unresolvedValueStatementIds.push(value.statementId);
      continue;
    }

    if (value.constructor?.targetTypeIdentity === value.typeIdentity) {
      const fieldBindings = new Map<number, BindingId>();
      const pathBindings = new Map<string, BindingId>();
      const fields = scalarFieldPathsFor(analysis.definitionsByStatementId.get(value.typeIdentity)!);
      let complete = true;
      let seedOrder = 0;
      for (const { field, path, type: expectedType } of fields) {
        const constructorField = constructorFieldAtPath(value.constructor.fields, path);
        if (!constructorField) {
          complete = false;
          continue;
        }
        const bindingId = recordScalarBindingIdForPath(value.statementId, path);
        if (path.length === 1) fieldBindings.set(field.fieldIndex, bindingId);
        pathBindings.set(recordFieldPathKey(path), bindingId);
        bindingSeeds.push({
          id: bindingId,
          kind: "typed",
          name: `${value.name}.${path.map((candidate) => analysis.definitionsByStatementId.get(candidate.recordStatementId)?.fields.find((field) => field.identity.fieldIndex === candidate.fieldIndex)?.name ?? "").join(".")}`,
          nameSpan: null,
          statementIndex: value.statementIndex,
          sourceOrder: seedOrder++,
          effectiveScopeId: scopeId,
          visibility: { kind: "typed", scopeId },
          mutability: "const",
          declaredType: expectedType,
          declarationVersionId: recordScalarDeclarationVersionIdFor(value.statementId, path[path.length - 1]!),
          resolutionMode: "preResolvedOnly",
          catalogOrder: "source"
        });
        initializers.push({
          bindingId,
          recordValueStatementId: value.statementId,
          field: field.identity,
          fieldPath: path,
          fieldName: field.name,
          statementIndex: value.statementIndex,
          sourceOrder: field.fieldIndex,
          raw: constructorField.field.value,
          span: constructorField.field.valueSpan,
          expectedType
        });
      }
      if (complete) {
        fieldBindingIdsByValueStatementId.set(value.statementId, fieldBindings);
        fieldBindingIdsByAccessPathByValueStatementId.set(value.statementId, pathBindings);
      } else {
        unresolvedValueStatementIds.push(value.statementId);
      }
      continue;
    }

    if (value.reference?.targetTypeIdentity === value.typeIdentity) {
      const lookup = resolveSourceLexicalDeclaration(sourceNamespace, value.statementIndex, value.reference.name);
      if (lookup.kind === "resolved" && lookup.declaration.kind === "recordValue") {
        const target = analysis.valuesByStatementIndex.get(lookup.declaration.statementIndex);
        const targetBindings = target ? fieldBindingIdsByValueStatementId.get(target.statementId) : undefined;
        if (target?.typeIdentity === value.typeIdentity && targetBindings) {
          fieldBindingIdsByValueStatementId.set(value.statementId, targetBindings);
          const targetPathBindings = fieldBindingIdsByAccessPathByValueStatementId.get(target.statementId);
          if (targetPathBindings) fieldBindingIdsByAccessPathByValueStatementId.set(value.statementId, targetPathBindings);
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
    fieldBindingIdsByAccessPathByValueStatementId,
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
  const member = value?.typeIdentity ? scalarRecordMemberFor(analysis, value.typeIdentity, property) : { kind: "unknown" as const };
  if (!value || !definition || member.kind === "unknown") {
    return {
      kind: "blocked",
      reason: "incompatible",
      declarationKind: "recordValue",
      statementId: lookup.declaration.statementId
    };
  }
  if (member.kind === "invalidTraversal") {
    return {
      kind: "blocked",
      reason: "invalidTraversal",
      declarationKind: "recordValue",
      statementId: lookup.declaration.statementId
    };
  }
  if (member.kind === "nonScalar") return null;
  const bindingId = plan.fieldBindingIdsByAccessPathByValueStatementId.get(value.statementId)?.get(recordFieldPathKey(member.fieldPath))
    ?? (member.fieldPath.length === 1 ? plan.fieldBindingIdsByValueStatementId.get(value.statementId)?.get(member.field.fieldIndex) : undefined);
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
        message: `record 値「${node.elementName}」はこの位置より後で宣言されているため、まだ参照できません。`,
        presentation: { key: "diagnostic.record-value-forward-reference", parameters: { name: node.elementName } }
      });
      return;
    }
    if (lookup.kind === "ambiguous" && lookup.declarations.some((item) => item.kind === "recordValue")) {
      claimInvalid(node, {
        code: "record-value-ambiguous",
        span: node.elementNameSpan,
        message: `record 値「${node.elementName}」は複数の宣言と一致するため一意に解決できません。`,
        presentation: { key: "diagnostic.record-value-ambiguous", parameters: { name: node.elementName } }
      });
      return;
    }
    if (lookup.kind === "invalidTraversal" && lookup.declaration.kind === "recordValue") {
      claimInvalid(node, {
        code: "record-field-invalid-traversal",
        span: node.elementNameSpan,
        message: `record 値「${lookup.declaration.name}」を namespace として traversal できません。`,
        presentation: { key: "diagnostic.record-field-invalid-traversal", parameters: { target: lookup.declaration.name } }
      });
      return;
    }
    if (lookup.kind !== "resolved" || lookup.declaration.kind !== "recordValue") return;

    const value = analysis.valuesByStatementId.get(lookup.declaration.statementId);
    const definition = value?.typeIdentity
      ? analysis.definitionsByStatementId.get(value.typeIdentity)
      : undefined;
    const member = value?.typeIdentity ? scalarRecordMemberFor(analysis, value.typeIdentity, node.property) : { kind: "unknown" as const };
    if (!value || !definition || member.kind === "unknown") {
      claimInvalid(node, {
        code: "record-field-unknown",
        span: node.propertySpan,
        message: `record「${definition?.name ?? value?.typeReference.sourceName ?? lookup.declaration.name}」に field「${node.property}」はありません。`,
        presentation: {
          key: "diagnostic.record-field-unknown",
          parameters: { record: definition?.name ?? value?.typeReference.sourceName ?? lookup.declaration.name, field: node.property }
        }
      });
      return;
    }
    if (member.kind === "invalidTraversal") {
      claimInvalid(node, {
        code: "record-field-invalid-traversal",
        span: node.propertySpan,
        message: `record field「${node.elementName}.${node.property}」の traversal は無効です。`,
        presentation: { key: "diagnostic.record-field-invalid-traversal", parameters: { target: `${node.elementName}.${node.property}` } }
      });
      return;
    }
    if (member.kind === "nonScalar") return;
    const expectedType = member.type;

    // A coalesced whole-record value is present by construction, but its
    // scalar fields do not have independent backing bindings. Project the
    // field through the existing record collection runtime so the selected
    // branch remains lazy and no optional record is implicitly unwrapped.
    if (value.valueExpression?.kind === "coalesce") {
      referencesBySpanStart.set(node.span.start, {
        kind: "resolvedCollectionIndex",
        collectionValueId: recordFieldCollectionValueIdFor(
          recordValueCollectionIdFor([], value.statementId),
          member.field,
          member.fieldPath
        ),
        collectionLength: 1,
        targetSourceOrder: value.statementIndex,
        type: expectedType
      });
      return;
    }

    const bindingId = plan.fieldBindingIdsByAccessPathByValueStatementId.get(value.statementId)?.get(recordFieldPathKey(member.fieldPath))
      ?? (member.fieldPath.length === 1 ? plan.fieldBindingIdsByValueStatementId.get(value.statementId)?.get(member.field.fieldIndex) : undefined);
    if (!bindingId) {
      claimInvalid(node, {
        code: "record-field-unavailable",
        span: node.span,
        message: `record field「${node.elementName}.${node.property}」はこの実行コンテキストでは利用できません。`,
        presentation: { key: "diagnostic.record-field-unavailable", parameters: { target: `${node.elementName}.${node.property}` } }
      });
      return;
    }

    const access: RecordScalarFieldAccess = {
      recordValueStatementId: value.statementId,
      field: member.field,
      ...(member.fieldPath.length > 1 ? { fieldPath: member.fieldPath } : {}),
      fieldName: member.fieldName,
      bindingId,
      span: node.span,
      baseSpan: node.elementNameSpan,
      propertySpan: node.propertySpan
    };
    referencesBySpanStart.set(node.span.start, {
      kind: "resolvedType",
      bindingId,
      type: expectedType
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
      case "valueIf":
        visit(node.condition);
        visit(node.thenBranch);
        if (node.elseBranch) visit(node.elseBranch);
        return;
      case "valueMatch":
        visit(node.scrutinee);
        node.arms.forEach((arm) => visit(arm.expression));
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
      message: `record 値「${node.elementName}」はこの位置より後で宣言されているため、まだ参照できません。`,
      presentation: { key: "diagnostic.record-value-forward-reference", parameters: { name: node.elementName } }
    };
  }
  if (reason === "ambiguous") {
    return {
      code: "record-value-ambiguous",
      span: node.elementNameSpan,
      message: `record 値「${node.elementName}」は複数の宣言と一致するため一意に解決できません。`,
      presentation: { key: "diagnostic.record-value-ambiguous", parameters: { name: node.elementName } }
    };
  }
  if (reason === "invalidTraversal") {
    return {
      code: "record-field-invalid-traversal",
      span: node.span,
      message: `record field「${node.elementName}.${node.property}」の chained / namespace traversal は v1 では使用できません。`,
      presentation: { key: "diagnostic.record-field-invalid-traversal", parameters: { target: `${node.elementName}.${node.property}` } }
    };
  }
  return {
    code: "record-field-unknown",
    span: node.propertySpan,
    message: `record 値「${node.elementName}」に利用可能な field「${node.property}」はありません。`,
    presentation: {
      key: "diagnostic.record-field-unknown",
      parameters: { record: node.elementName, field: node.property }
    }
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
          message: `record field「${node.elementName}.${node.property}」の scalar binding を取得できません。`,
          presentation: { key: "diagnostic.record-field-unavailable", parameters: { target: `${node.elementName}.${node.property}` } }
        });
        return;
      }
      referencesBySpanStart.set(node.span.start, {
        kind: "resolvedType",
        bindingId: binding.id,
        type: scalarExpressionTypeOfDslValueType(binding.declaredType)
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
      case "geometryProperty":
        visitProperty(node);
        if (node.occurrenceIndex) classify(node.occurrenceIndex);
        return;
      case "unary": classify(node.operand); return;
      case "binary": classify(node.left); classify(node.right); return;
      case "group": classify(node.expression); return;
      case "valueIf": classify(node.condition); classify(node.thenBranch); if (node.elseBranch) classify(node.elseBranch); return;
      case "valueMatch": classify(node.scrutinee); node.arms.forEach((arm) => classify(arm.expression)); return;
      case "collectionIndex": classify(node.index); return;
      case "call": node.args.forEach((argument) => classify(argument.expression)); return;
      default: return;
    }
  };
  classify(ast);

  const references: (BindingResolution | ScalarExpressionResolvedReference)[] = [];
  let referenceCursor = 0;
  const rewrite = (node: ScalarExpressionAst, boundNames: ReadonlySet<string> = new Set()): ScalarExpressionAst => {
    switch (node.kind) {
      case "reference": {
        if (boundNames.has(node.name)) return node;
        const resolution = referenceResolutions[referenceCursor];
        if (!resolution) throw new Error(`recordScalarLowering: no resolution supplied for @${node.name} at ${node.span.start}`);
        referenceCursor += 1;
        references.push(resolution);
        return node;
      }
      case "geometryProperty": {
        const resolution = referencesBySpanStart.get(node.span.start);
        if (!resolution || resolution.kind !== "resolvedType") {
          return node.occurrenceIndex ? { ...node, occurrenceIndex: rewrite(node.occurrenceIndex) } : node;
        }
        references.push(resolution);
        return {
          kind: "reference",
          span: node.span,
          nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
          name: `${node.elementName}.${node.property}`
        };
      }
      case "collectionIndex": {
        const resolution = referenceResolutions[referenceCursor];
        if (!resolution) throw new Error(`recordScalarLowering: no resolution supplied for collection index at ${node.span.start}`);
        referenceCursor += 1;
        references.push(resolution);
        return { ...node, index: rewrite(node.index) };
      }
      case "unary": return { ...node, operand: rewrite(node.operand) };
      case "binary": return { ...node, left: rewrite(node.left), right: rewrite(node.right) };
      case "group": return { ...node, expression: rewrite(node.expression) };
      case "valueIf": return {
        ...node,
        condition: rewrite(node.condition),
        thenBranch: rewrite(node.thenBranch),
        elseBranch: node.elseBranch ? rewrite(node.elseBranch) : null
      };
      case "valueMatch": return {
        ...node,
        scrutinee: rewrite(node.scrutinee),
        arms: node.arms.map((arm) => ({ ...arm, expression: rewrite(arm.expression) }))
      };
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

  const rewrite = (node: ScalarExpressionAst, boundNames: ReadonlySet<string> = new Set()): ScalarExpressionAst => {
    switch (node.kind) {
      case "reference": {
        if (boundNames.has(node.name)) return node;
        const resolution = referenceResolutions[referenceCursor];
        if (!resolution) {
          throw new Error(`recordScalarLowering: no resolution supplied for @${node.name} at ${node.span.start}`);
        }
        referenceCursor += 1;
        references.push(resolution);
        return node;
      }
      case "geometryProperty": {
        const additional = resolveAdditionalProperty(node);
        const resolution = additional?.resolution ?? propertyResolution.referencesBySpanStart.get(node.span.start);
        if (resolution?.kind === "resolvedCollectionIndex") {
          references.push(resolution);
          return {
            kind: "collectionIndex",
            span: node.span,
            nameSpan: { start: node.elementNameSpan.start, end: node.propertySpan.end },
            name: node.elementName,
            index: node.occurrenceIndex
              ? rewrite(node.occurrenceIndex)
              : { kind: "numberLiteral", span: node.span, value: 0 }
          };
        }
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
        return { ...node, operand: rewrite(node.operand, boundNames) };
      case "binary":
        return { ...node, left: rewrite(node.left, boundNames), right: rewrite(node.right, boundNames) };
      case "group":
        return { ...node, expression: rewrite(node.expression, boundNames) };
      case "valueIf":
        return {
          ...node,
          condition: rewrite(node.condition, boundNames),
          thenBranch: rewrite(node.thenBranch, boundNames),
          elseBranch: node.elseBranch ? rewrite(node.elseBranch, boundNames) : null
        };
      case "valueMatch":
        return {
          ...node,
          scrutinee: rewrite(node.scrutinee, boundNames),
          arms: node.arms.map((arm) => ({
            ...arm,
            expression: rewrite(arm.expression, arm.binder ? new Set([...boundNames, arm.binder]) : boundNames)
          }))
        };
      case "collectionIndex": {
        if (boundNames.has(node.name)) return { ...node, index: rewrite(node.index, boundNames) };
        const resolution = referenceResolutions[referenceCursor];
        if (!resolution) throw new Error(`recordScalarLowering: no resolution supplied for collection index at ${node.span.start}`);
        referenceCursor += 1;
        references.push(resolution);
        return { ...node, index: rewrite(node.index, boundNames) };
      }
      case "call":
        return {
          ...node,
          args: node.args.map((argument) => ({ ...argument, expression: rewrite(argument.expression, boundNames) }))
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
