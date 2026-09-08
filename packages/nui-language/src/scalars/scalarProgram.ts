// Task 19 lowering only. Parsing, name resolution, graph analysis, &&
// typechecking happen once in typedDeclarationAnalysis before this boundary.
import { selectCompiledProgramBindings } from "./bindingAnalysis";
import { scalarTypeOfDslValueType } from "../dsl/dslValueTypes";
import type { BindingId } from "./bindingCatalog";
import type { TypedDeclarationAnalysis } from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarType, ScalarValue } from "./types";

export type ScalarProgramCollectionMember =
  | { kind: "literal"; type: ScalarType; value: ScalarValue }
  | { kind: "binding"; type: ScalarType; bindingId: BindingId };

export type ScalarProgramCollection =
  | { valueId: string; kind: "literal"; members: readonly ScalarProgramCollectionMember[] }
  | { valueId: string; kind: "alias"; targetValueId: string };

export type ScalarProgramDeclaration = {
  bindingKind: "const" | "let";
  declaredType: ScalarType;
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
  /** Statement-stream position of stop, not an elements-array index. */
  evaluationLimitSourceOrder?: number;
  /** Reserved for future output-time scalar evaluation; SAY-63 has no local bindings. */
  postStopBindingIds?: readonly BindingId[];
};

export type ScalarProgramPositionMap = {
  sourceOrderByElementIndex: readonly number[];
  evaluationLimit?: { elementIndex: number; sourceOrder: number };
};

export const lowerScalarProgram = ({
  bindingAnalysis,
  typedInitializerByBindingId,
  positionMap,
  sourceOrderByBindingId,
  evaluationLimitSourceOrder,
  collectionValues
}: TypedDeclarationAnalysis & {
  sourceOrderByBindingId?: ReadonlyMap<BindingId, number>;
  evaluationLimitSourceOrder?: number;
  collectionValues?: readonly ScalarProgramCollection[];
}): ScalarProgram => {
  const statements: ScalarProgramStatement[] = [];
  for (const bindingId of selectCompiledProgramBindings(bindingAnalysis).bindingIds) {
    const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
    // Program eligibility has one shared owner (Task 13R). This type filter
    // keeps only scalar typed declarations in the scalar program.
    if (!binding || binding.kind !== "typed") continue;
    const declaredType = scalarTypeOfDslValueType(binding.declaredType);
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
        bindingKind: binding.mutability as "const" | "let",
        declaredType,
        initializer
      }
    });
  }
  return {
    statements,
    ...(collectionValues?.length ? { collectionValues } : {}),
    ...(evaluationLimitSourceOrder !== undefined
      ? { evaluationLimitSourceOrder }
      : positionMap.evaluationLimit
        ? { evaluationLimitSourceOrder: positionMap.evaluationLimit.sourceOrder }
        : {})
  };
};
