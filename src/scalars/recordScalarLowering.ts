import { encodeIdentityTuple } from "../document/identityTuple";
import type {
  RecordFieldIdentity,
  RecordSemanticAnalysis,
  RecordValueIdentity,
  RecordValueSemantic
} from "../dsl/recordSemanticAnalysis";
import {
  resolveSourceLexicalDeclaration,
  type SourceLexicalNamespaceIndex
} from "../dsl/sourceLexicalNamespaceIndex";
import type { DslSpan } from "../dsl/dslTypes";
import type { BindingId, BindingSeed } from "./bindingCatalog";
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
