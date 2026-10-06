// Task 19 lowering only. Parsing, name resolution, graph analysis, &&
// typechecking happen once in typedDeclarationAnalysis before this boundary.
import { selectCompiledProgramBindings } from "./bindingAnalysis";
import { scalarExpressionTypeOfDslValueType } from "../dsl/dslValueTypes";
import type { BindingCatalog, BindingId } from "./bindingCatalog";
import type { TypedDeclarationAnalysis } from "./typedDeclarationAnalysis";
import type {
  ScalarExpressionResolvedGeometryProperty,
  ScalarExpressionResolvedGeometryTarget,
  TypedScalarExpression
} from "./typedExpressionAst";
import type { ScalarExpressionType, ScalarType, ScalarValue } from "./types";
import type { RecordFieldIdentity } from "../dsl/recordSemanticAnalysis";

export type ScalarProgramRecordField = {
  recordStatementId: string;
  fieldIndex: number;
  type: ScalarExpressionType;
  bindingId: BindingId;
  /** Full path for a scalar leaf nested inside nominal record fields. */
  fieldPath?: readonly RecordFieldIdentity[];
};

export type ScalarProgramCollectionMember =
  | { kind: "literal"; type: ScalarExpressionType; value: ScalarValue }
  | { kind: "binding"; type: ScalarExpressionType; bindingId: BindingId }
  | { kind: "record"; typeIdentity: string; fields: readonly ScalarProgramRecordField[] };

export type ScalarProgramCollection =
  | { valueId: string; kind: "none" }
  | { valueId: string; kind: "literal"; members: readonly ScalarProgramCollectionMember[] }
  | { valueId: string; kind: "alias"; targetValueId: string }
  | {
      valueId: string;
      kind: "map";
      sourceValueId: string;
      sourceElementType: ScalarType;
      resultElementType: ScalarType;
      binderId: BindingId;
      body: TypedScalarExpression;
      sourceOrder: number;
    }
  | {
      valueId: string;
      kind: "recordMap";
      sourceValueId: string;
      sourceTypeIdentity: string;
      resultTypeIdentity: string;
      binderId: BindingId;
      binderFields: readonly ScalarProgramRecordField[];
      fields: readonly {
        recordStatementId: string;
        fieldIndex: number;
        type: ScalarExpressionType;
        body: TypedScalarExpression;
        fieldPath?: readonly RecordFieldIdentity[];
      }[];
      sourceOrder: number;
    }
  | {
      valueId: string;
      kind: "recordField";
      sourceValueId: string;
      field: { recordStatementId: string; fieldIndex: number; type: ScalarExpressionType; fieldPath?: readonly RecordFieldIdentity[] };
      sourceOrder: number;
    }
  | {
      valueId: string;
      kind: "if";
      condition: TypedScalarExpression;
      thenValueId: string;
      elseValueId: string;
      sourceOrder: number;
    }
  | {
      valueId: string;
      kind: "match";
      scrutinee: TypedScalarExpression;
      arms: readonly {
        label: string;
        valueId: string;
        binderId?: BindingId;
        binderType?: ScalarType;
        /** Optional-match binders whose values stay in the collection graph. */
        collectionBinderId?: BindingId;
      }[];
      sourceOrder: number;
    }
  | {
      valueId: string;
      kind: "coalesce";
      leftValueId: string;
      rightValueId: string;
      sourceOrder: number;
    };

export type ScalarProgramDeclaration = {
  bindingKind: "const";
  declaredType: ScalarExpressionType;
  initializer: TypedScalarExpression;
};

export type ScalarProgramStatement = {
  kind: "declare";
  bindingId: BindingId;
  scopeId: string;
  sourceOrder: number;
  declaration: ScalarProgramDeclaration;
};

export type ScalarProgram = {
  statements: readonly ScalarProgramStatement[];
  /** Source-owned scalar/choice collection values used by collectionIndex nodes. */
  collectionValues?: readonly ScalarProgramCollection[];
};

export type ScalarProgramPositionMap = {
  sourceOrderByElementIndex: readonly number[];
  evaluationLimit?: { elementIndex: number; sourceOrder: number };
};

export type RootScalarExecutionOrder = {
  /** Event positions for catalog bindings, ordered within each source statement by canonical rank. */
  sourceOrderByBindingId: ReadonlyMap<BindingId, number>;
  /** Discrete source-statement anchor positions in the same event domain. */
  sourceOrderByStatementIndex: ReadonlyMap<number, number>;
};

/**
 * Builds the root document's discrete scalar execution domain from authored
 * statement positions and the canonical binding catalog. Each statement gets
 * one source anchor followed by its catalog-ordered binding events.
 */
export const buildRootScalarExecutionOrder = (
  catalog: BindingCatalog,
  statementCount: number
): RootScalarExecutionOrder => {
  if (!Number.isInteger(statementCount) || statementCount < 0) {
    throw new Error("scalarProgram: statementCount must be a non-negative integer");
  }
  const bindingsByStatementIndex = new Map<number, typeof catalog.bindings[number][]>();
  for (const binding of catalog.bindings) {
    const bindings = bindingsByStatementIndex.get(binding.statementIndex) ?? [];
    bindings.push(binding);
    bindingsByStatementIndex.set(binding.statementIndex, bindings);
  }
  for (const bindings of bindingsByStatementIndex.values()) {
    bindings.sort((left, right) => left.rank - right.rank);
  }

  const sourceOrderByBindingId = new Map<BindingId, number>();
  const sourceOrderByStatementIndex = new Map<number, number>();
  let sourceOrder = 0;
  for (let statementIndex = 0; statementIndex <= statementCount; statementIndex += 1) {
    sourceOrderByStatementIndex.set(statementIndex, sourceOrder++);
    for (const binding of bindingsByStatementIndex.get(statementIndex) ?? []) {
      sourceOrderByBindingId.set(binding.id, sourceOrder++);
    }
  }
  if (sourceOrderByBindingId.size !== catalog.bindings.length) {
    throw new Error("scalarProgram: binding catalog contains a binding outside the source statement range");
  }
  return { sourceOrderByBindingId, sourceOrderByStatementIndex };
};

export const remapTypedExpressionSourceOrders = (
  expression: TypedScalarExpression,
  sourceOrderFor: (sourceOrder: number) => number
): TypedScalarExpression => {
  const remapGeometryTarget = (target: ScalarExpressionResolvedGeometryTarget | null): ScalarExpressionResolvedGeometryTarget | null => {
    if (!target) return target;
    if (target.kind === "forGroupOccurrence") {
      return {
        ...target,
        targetSourceOrder: target.targetSourceOrder >= 0 ? sourceOrderFor(target.targetSourceOrder) : target.targetSourceOrder,
        index: target.index ? remapTypedExpressionSourceOrders(target.index, sourceOrderFor) : null
      };
    }
    return { ...target, statementIndex: target.statementIndex >= 0 ? sourceOrderFor(target.statementIndex) : target.statementIndex };
  };
  switch (expression.kind) {
    case "collectionIndex":
      return {
        ...expression,
        targetSourceOrder: expression.targetSourceOrder !== null && expression.targetSourceOrder >= 0
          ? sourceOrderFor(expression.targetSourceOrder)
          : expression.targetSourceOrder,
        index: remapTypedExpressionSourceOrders(expression.index, sourceOrderFor)
      };
    case "geometryProperty":
      return {
        ...expression,
        targetSourceOrder: expression.targetSourceOrder !== null && expression.targetSourceOrder >= 0
          ? sourceOrderFor(expression.targetSourceOrder)
          : expression.targetSourceOrder,
        ...(expression.forGroupOccurrenceIndex
          ? { forGroupOccurrenceIndex: remapTypedExpressionSourceOrders(expression.forGroupOccurrenceIndex, sourceOrderFor) }
          : {})
      };
    case "optionalMember": {
      const target = expression.target;
      const remapReference = (reference: ScalarExpressionResolvedGeometryProperty): ScalarExpressionResolvedGeometryProperty => ({
        ...reference,
        targetSourceOrder: reference.targetSourceOrder >= 0 ? sourceOrderFor(reference.targetSourceOrder) : reference.targetSourceOrder
      });
      const receiverTarget = target?.kind === "geometryProperty" && target.receiver.kind === "geometryValue"
        ? target.receiver.target
        : null;
      return {
        ...expression,
        target: target?.kind === "collectionLength"
          ? { ...target, targetSourceOrder: target.targetSourceOrder >= 0 ? sourceOrderFor(target.targetSourceOrder) : target.targetSourceOrder }
          : target?.kind === "recordField"
            ? { ...target, targetSourceOrder: target.targetSourceOrder >= 0 ? sourceOrderFor(target.targetSourceOrder) : target.targetSourceOrder }
            : target?.kind === "geometryProperty"
              ? {
                  ...target,
                  reference: remapReference(target.reference),
                  receiver: target.receiver.kind === "collection"
                    ? { ...target.receiver, targetSourceOrder: target.receiver.targetSourceOrder >= 0 ? sourceOrderFor(target.receiver.targetSourceOrder) : target.receiver.targetSourceOrder }
                    : {
                        ...target.receiver,
                        target: receiverTarget?.kind === "forGroupOccurrence"
                          ? {
                              ...receiverTarget,
                              targetSourceOrder: receiverTarget.targetSourceOrder >= 0 ? sourceOrderFor(receiverTarget.targetSourceOrder) : receiverTarget.targetSourceOrder,
                              statementIndex: receiverTarget.statementIndex >= 0 ? sourceOrderFor(receiverTarget.statementIndex) : receiverTarget.statementIndex
                            }
                          : receiverTarget ?? target.receiver.target
                      }
                }
              : target
      };
    }
    case "unary": return { ...expression, operand: remapTypedExpressionSourceOrders(expression.operand, sourceOrderFor) };
    case "binary": return {
      ...expression,
      left: remapTypedExpressionSourceOrders(expression.left, sourceOrderFor),
      right: remapTypedExpressionSourceOrders(expression.right, sourceOrderFor)
    };
    case "group": return { ...expression, expression: remapTypedExpressionSourceOrders(expression.expression, sourceOrderFor) };
    case "valueIf": return {
      ...expression,
      condition: remapTypedExpressionSourceOrders(expression.condition, sourceOrderFor),
      thenBranch: remapTypedExpressionSourceOrders(expression.thenBranch, sourceOrderFor),
      elseBranch: remapTypedExpressionSourceOrders(expression.elseBranch, sourceOrderFor)
    };
    case "valueMatch": return {
      ...expression,
      scrutinee: remapTypedExpressionSourceOrders(expression.scrutinee, sourceOrderFor),
      arms: expression.arms.map((arm) => ({ ...arm, expression: remapTypedExpressionSourceOrders(arm.expression, sourceOrderFor) }))
    };
    case "call": return {
      ...expression,
      args: expression.args.map((argument) => argument.kind === "scalar"
        ? { ...argument, expression: remapTypedExpressionSourceOrders(argument.expression, sourceOrderFor) }
        : { ...argument, target: remapGeometryTarget(argument.target) })
    };
    default: return expression;
  }
};

const sourceOrderForCollection = (
  collection: ScalarProgramCollection,
  sourceOrderFor: (sourceOrder: number) => number
): ScalarProgramCollection => {
  switch (collection.kind) {
    case "map": return {
      ...collection,
      body: remapTypedExpressionSourceOrders(collection.body, sourceOrderFor),
      sourceOrder: sourceOrderFor(collection.sourceOrder)
    };
    case "recordMap": return {
      ...collection,
      fields: collection.fields.map((field) => ({
        ...field,
        body: remapTypedExpressionSourceOrders(field.body, sourceOrderFor)
      })),
      sourceOrder: sourceOrderFor(collection.sourceOrder)
    };
    case "recordField":
    case "if":
    case "match":
    case "coalesce": return {
      ...collection,
      ...(collection.kind === "if" ? { condition: remapTypedExpressionSourceOrders(collection.condition, sourceOrderFor) } : {}),
      ...(collection.kind === "match" ? { scrutinee: remapTypedExpressionSourceOrders(collection.scrutinee, sourceOrderFor) } : {}),
      sourceOrder: sourceOrderFor(collection.sourceOrder)
    };
    default: return collection;
  }
};

export const lowerScalarProgram = ({
  bindingAnalysis,
  typedInitializerByBindingId,
  sourceOrderByBindingId,
  sourceOrderByStatementIndex,
  collectionValues
}: TypedDeclarationAnalysis & {
  sourceOrderByBindingId?: ReadonlyMap<BindingId, number>;
  sourceOrderByStatementIndex?: ReadonlyMap<number, number>;
  collectionValues?: readonly ScalarProgramCollection[];
}): ScalarProgram => {
  const statements: ScalarProgramStatement[] = [];
  for (const bindingId of selectCompiledProgramBindings(bindingAnalysis).bindingIds) {
    const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
    // Program eligibility has one shared owner (Task 13R). This type filter
    // keeps only scalar typed declarations in the scalar program.
    if (!binding || binding.kind !== "typed") continue;
    const declaredType = scalarExpressionTypeOfDslValueType(binding.declaredType);
    if (declaredType === null) continue;
    if (binding.resolutionMode === "preResolvedOnly" && !typedInitializerByBindingId.has(bindingId)) continue;
    const initializer = typedInitializerByBindingId.get(bindingId);
    if (!initializer) throw new Error(`scalarProgram: eligible binding ${bindingId} lacks a typed initializer`);
    statements.push({
      kind: "declare",
      bindingId,
      scopeId: binding.effectiveScopeId,
      sourceOrder: sourceOrderByBindingId?.get(bindingId) ?? binding.statementIndex,
      declaration: {
        bindingKind: "const",
        declaredType,
        initializer: sourceOrderByStatementIndex
          ? remapTypedExpressionSourceOrders(initializer, (sourceOrder) => sourceOrderByStatementIndex.get(sourceOrder) ?? sourceOrder)
          : initializer
      }
    });
  }
  return {
    statements,
    ...(collectionValues?.length ? {
      collectionValues: sourceOrderByStatementIndex
        ? collectionValues.map((collection) => sourceOrderForCollection(
            collection,
            (sourceOrder) => sourceOrderByStatementIndex.get(sourceOrder) ?? sourceOrder
          ))
        : collectionValues
    } : {})
  };
};
