// Task 19 lowering only. Parsing, name resolution, graph analysis, and
// typechecking happen once in typedDeclarationAnalysis before this boundary.
import { selectCompiledProgramBindings } from "./bindingAnalysis";
import type { BindingId } from "./bindingCatalog";
import type { TypedDeclarationAnalysis } from "./typedDeclarationAnalysis";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarType } from "./types";

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
  /** Statement-stream position of @stop, not an elements-array index. */
  evaluationLimitSourceOrder?: number;
};

export type ScalarProgramPositionMap = {
  sourceOrderByElementIndex: readonly number[];
  evaluationLimit?: { elementIndex: number; sourceOrder: number };
};

export const lowerScalarProgram = ({
  bindingAnalysis,
  typedInitializerByBindingId,
  positionMap
}: TypedDeclarationAnalysis): ScalarProgram => {
  const statements: ScalarProgramStatement[] = [];
  for (const bindingId of selectCompiledProgramBindings(bindingAnalysis).bindingIds) {
    const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
    // Program eligibility has one shared owner (Task 13R). This type filter
    // only separates legacy/iteration bindings from typed declarations.
    if (!binding || binding.kind !== "typed") continue;
    if (binding.declaredType === null) {
      throw new Error(`scalarProgram: eligible typed binding ${bindingId} has no declared type`);
    }
    const initializer = typedInitializerByBindingId.get(bindingId);
    if (!initializer) throw new Error(`scalarProgram: eligible binding ${bindingId} lacks a typed initializer`);
    statements.push({
      kind: "declare",
      bindingId,
      scopeId: binding.effectiveScopeId,
      sourceOrder: binding.statementIndex,
      declaration: {
        bindingKind: binding.mutability as "const" | "let",
        declaredType: binding.declaredType,
        initializer
      }
    });
  }
  return {
    statements,
    ...(positionMap.evaluationLimit ? { evaluationLimitSourceOrder: positionMap.evaluationLimit.sourceOrder } : {})
  };
};
