import { isInUnloweredModuleSubtree } from "./dslCompilationGuard";
import { isElementDslStatement } from "./dslParser";
import { encodeIdentityTuple } from "../document/identityTuple";
import type { DslStatement } from "./dslTypes";
import type {
  ModuleInstanceSemantic,
  ModuleSemanticAnalysis
} from "./moduleSemanticTypes";
import type { StatementIdentity } from "../document/statementIdentity";
import type { CadElementType, ConditionalBranch, ElementId } from "../types/geometry";

/** Runtime identity carried by a lowered module element. */
export type MaterializedRuntimeIdentity = {
  kind: "moduleInstance" | "moduleBody";
  /** Call-site identities, followed by the body statement identity for a body element. */
  path: readonly StatementIdentity[];
  key: string;
};

/** Source provenance kept separate from runtime identity for later editor tasks. */
export type ModuleOrigin = {
  kind: "moduleInstance" | "moduleBody";
  sourceStatementId: StatementIdentity;
  sourceStatementIndex: number;
  moduleDefinitionStatementId: StatementIdentity;
  callerModuleDefinitionStatementId: StatementIdentity | null;
  instancePath: readonly StatementIdentity[];
};

export type MaterializedExecutionStatement = {
  statement: DslStatement;
  sourceStatementId: StatementIdentity;
  sourceStatementIndex: number;
  runtimeElementId: ElementId;
  type: CadElementType;
  parentGroupId?: ElementId;
  conditionalBranch?: ConditionalBranch;
  /** True when the parent came from a source group/conditional/for block. */
  sourceBlockChild: boolean;
  /** Root source statement whose runtime subtree is one stop atomic unit. */
  executionUnitStatementIndex: number;
  instancePath: readonly StatementIdentity[];
  runtimeIdentity?: MaterializedRuntimeIdentity;
  origin?: ModuleOrigin;
};

export type SourceExecutionUnit = {
  sourceStatementIndex: number;
  runtimeStart: number;
  runtimeEnd: number;
};

export type ModuleMaterialization = {
  executionStatements: readonly MaterializedExecutionStatement[];
  sourceExecutionUnits: readonly SourceExecutionUnit[];
  /** Root source statements only: ordinary source elements; module containers use origin mapping. */
  elementIdBySourceStatementIndex: ReadonlyMap<number, ElementId>;
  /** Runtime element ID -> the source execution unit that evaluates it. */
  sourceExecutionPositionByRuntimeElementId: ReadonlyMap<ElementId, number>;
  originByRuntimeElementId: ReadonlyMap<ElementId, ModuleOrigin>;
  runtimeIdentityByElementId: ReadonlyMap<ElementId, MaterializedRuntimeIdentity>;
  /** Scalar execution order is separate from the outer atomic call unit. */
  scalarExecutionPositionByRuntimeElementId?: ReadonlyMap<ElementId, number>;
  evaluationLimitIndex: number | undefined;
};

type MaterializationInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  assignedElementIds: ReadonlyMap<number, ElementId>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
};

type ParentRuntime = {
  id?: ElementId;
  branch?: ConditionalBranch;
  sourceBlockChild: boolean;
};

const runtimeElementTypeOf = (statement: DslStatement): CadElementType | null => {
  if (statement.kind === "group") return "group";
  if (statement.kind === "element") return statement.type;
  return null;
};

const requireStatementIdentity = (
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>,
  statementIndex: number
) => {
  const identity = stableStatementIdByIndex.get(statementIndex);
  if (identity === undefined) {
    throw new Error(`moduleMaterialization: no stable statement identity for index ${statementIndex}`);
  }
  return identity;
};

export const materializedRuntimeIdentityKey = (
  kind: MaterializedRuntimeIdentity["kind"],
  path: readonly StatementIdentity[]
) => encodeIdentityTuple([kind, ...path]);

export const materializedRuntimeElementId = (
  kind: MaterializedRuntimeIdentity["kind"],
  path: readonly StatementIdentity[]
) => `module-runtime:${materializedRuntimeIdentityKey(kind, path)}`;

const runtimeIdentityOf = (
  kind: MaterializedRuntimeIdentity["kind"],
  path: readonly StatementIdentity[]
): MaterializedRuntimeIdentity => ({
  kind,
  path: [...path],
  key: materializedRuntimeIdentityKey(kind, path)
});

const sourceBlockType = (statement: DslStatement) =>
  statement.kind === "group" ||
  (statement.kind === "element" && (statement.type === "conditionalGroup" || statement.type === "forGroup"));

const parentForRootStatement = (
  statements: readonly DslStatement[],
  statement: DslStatement,
  runtimeIdBySourceIndex: ReadonlyMap<number, ElementId>
): ParentRuntime => {
  let enclosing = statement.enclosing;
  while (enclosing) {
    const parent = statements[enclosing.statementIndex];
    const parentId = runtimeIdBySourceIndex.get(enclosing.statementIndex);
    if (parent && parentId && sourceBlockType(parent)) {
      return {
        id: parentId,
        sourceBlockChild: true,
        ...(parent.kind === "element" && parent.type === "conditionalGroup"
          ? { branch: enclosing.branch }
          : {})
      };
    }
    enclosing = parent?.enclosing ?? null;
  }
  return { sourceBlockChild: false };
};

const parentForBodyStatement = (
  statements: readonly DslStatement[],
  statement: DslStatement,
  definitionStatementIndex: number,
  localRuntimeIdBySourceIndex: ReadonlyMap<number, ElementId>,
  moduleInstanceId: ElementId
): ParentRuntime => {
  let enclosing = statement.enclosing;
  while (enclosing) {
    const parent = statements[enclosing.statementIndex];
    const localParentId = localRuntimeIdBySourceIndex.get(enclosing.statementIndex);
    if (parent && localParentId && sourceBlockType(parent)) {
      return {
        id: localParentId,
        sourceBlockChild: true,
        ...(parent.kind === "element" && parent.type === "conditionalGroup"
          ? { branch: enclosing.branch }
          : {})
      };
    }
    if (enclosing.statementIndex === definitionStatementIndex) {
      return { id: moduleInstanceId, sourceBlockChild: false };
    }
    enclosing = parent?.enclosing ?? null;
  }
  return { id: moduleInstanceId, sourceBlockChild: false };
};

/**
 * Lower resolved module calls into a source-ordered runtime execution plan.
 * This function only references parser statements && Task 3 semantic data;
 * it does not parse, serialize, evaluate, || mutate source text.
 */
export const materializeModuleExecution = ({
  statements,
  stableStatementIdByIndex,
  assignedElementIds,
  moduleSemanticAnalysis
}: MaterializationInput): ModuleMaterialization => {
  const runtimeIdByRootSourceIndex = new Map<number, ElementId>();
  const elementIdBySourceStatementIndex = new Map<number, ElementId>();
  const rootInstanceBySourceIndex = new Map<number, ModuleInstanceSemantic>();

  for (const [statementIndex, statement] of statements.entries()) {
    if (isInUnloweredModuleSubtree(statements, statementIndex)) continue;
    if (runtimeElementTypeOf(statement)) {
      const id = assignedElementIds.get(statementIndex);
      if (id === undefined) {
        throw new Error(`moduleMaterialization: no assigned runtime element ID for index ${statementIndex}`);
      }
      runtimeIdByRootSourceIndex.set(statementIndex, id);
      elementIdBySourceStatementIndex.set(statementIndex, id);
      continue;
    }
    if (statement.kind !== "moduleInstance") continue;
    const statementId = requireStatementIdentity(stableStatementIdByIndex, statementIndex);
    const instance = moduleSemanticAnalysis.instancesByStatementId.get(statementId);
    if (!instance?.callee) continue;
    const id = materializedRuntimeElementId("moduleInstance", [statementId]);
    runtimeIdByRootSourceIndex.set(statementIndex, id);
    rootInstanceBySourceIndex.set(statementIndex, instance);
  }

  const executionStatements: MaterializedExecutionStatement[] = [];
  const sourceExecutionUnits: SourceExecutionUnit[] = [];
  const sourceExecutionPositionByRuntimeElementId = new Map<ElementId, number>();
  const originByRuntimeElementId = new Map<ElementId, ModuleOrigin>();
  const runtimeIdentityByElementId = new Map<ElementId, MaterializedRuntimeIdentity>();

  const emitInstance = (
    instance: ModuleInstanceSemantic,
    parent: ParentRuntime,
    parentInstancePath: readonly StatementIdentity[],
    executionUnitStatementIndex: number
  ): ElementId => {
    if (!instance.callee) throw new Error("moduleMaterialization: cannot emit an unresolved module instance");
    const instancePath = [...parentInstancePath, instance.statementId];
    const runtimeIdentity = runtimeIdentityOf("moduleInstance", instancePath);
    const runtimeElementId = materializedRuntimeElementId("moduleInstance", instancePath);
    const definition = moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) {
      throw new Error(`moduleMaterialization: missing definition ${instance.callee.definitionStatementId}`);
    }

    executionStatements.push({
      statement: statements[instance.statementIndex],
      sourceStatementId: instance.statementId,
      sourceStatementIndex: instance.statementIndex,
      runtimeElementId,
      type: "moduleInstance",
      ...(parent.id ? { parentGroupId: parent.id } : {}),
      executionUnitStatementIndex,
      instancePath,
      runtimeIdentity,
      origin: {
        kind: "moduleInstance",
        sourceStatementId: instance.statementId,
        sourceStatementIndex: instance.statementIndex,
        moduleDefinitionStatementId: instance.callee.definitionStatementId,
        callerModuleDefinitionStatementId: instance.callerModuleDefinitionStatementId,
        instancePath
      },
      sourceBlockChild: parent.sourceBlockChild,
      ...(parent.branch ? { conditionalBranch: parent.branch } : {})
    });
    originByRuntimeElementId.set(runtimeElementId, executionStatements.at(-1)!.origin!);
    runtimeIdentityByElementId.set(runtimeElementId, runtimeIdentity);
    sourceExecutionPositionByRuntimeElementId.set(runtimeElementId, executionUnitStatementIndex);

    const localRuntimeIdBySourceIndex = new Map<number, ElementId>();
    for (const body of definition.bodyStatements) {
      const statement = statements[body.statementIndex];
      if (!statement || statement.kind === "moduleDefinition") continue;

      if (statement.kind === "moduleInstance") {
        const nested = moduleSemanticAnalysis.instancesByStatementId.get(body.statementId);
        if (!nested?.callee) continue;
        const nestedParent = parentForBodyStatement(
          statements,
          statement,
          definition.statementIndex,
          localRuntimeIdBySourceIndex,
          runtimeElementId
        );
        const nestedId = emitInstance(nested, nestedParent, instancePath, executionUnitStatementIndex);
        localRuntimeIdBySourceIndex.set(body.statementIndex, nestedId);
        continue;
      }

      if (!isElementDslStatement(statement)) continue;
      const type = runtimeElementTypeOf(statement);
      if (!type) continue;
      const bodyPath = [...instancePath, body.statementId];
      const bodyIdentity = runtimeIdentityOf("moduleBody", bodyPath);
      const bodyRuntimeElementId = materializedRuntimeElementId("moduleBody", bodyPath);
      const bodyParent = parentForBodyStatement(
        statements,
        statement,
        definition.statementIndex,
        localRuntimeIdBySourceIndex,
        runtimeElementId
      );
      const bodyOrigin: ModuleOrigin = {
        kind: "moduleBody",
        sourceStatementId: body.statementId,
        sourceStatementIndex: body.statementIndex,
        moduleDefinitionStatementId: definition.statementId,
        callerModuleDefinitionStatementId: instance.callerModuleDefinitionStatementId,
        instancePath
      };
      executionStatements.push({
        statement,
        sourceStatementId: body.statementId,
        sourceStatementIndex: body.statementIndex,
        runtimeElementId: bodyRuntimeElementId,
        type,
        ...(bodyParent.id ? { parentGroupId: bodyParent.id } : {}),
        ...(bodyParent.branch ? { conditionalBranch: bodyParent.branch } : {}),
        sourceBlockChild: bodyParent.sourceBlockChild,
        executionUnitStatementIndex,
        instancePath,
        runtimeIdentity: bodyIdentity,
        origin: bodyOrigin
      });
      localRuntimeIdBySourceIndex.set(body.statementIndex, bodyRuntimeElementId);
      originByRuntimeElementId.set(bodyRuntimeElementId, bodyOrigin);
      runtimeIdentityByElementId.set(bodyRuntimeElementId, bodyIdentity);
      sourceExecutionPositionByRuntimeElementId.set(bodyRuntimeElementId, executionUnitStatementIndex);
    }
    return runtimeElementId;
  };

  for (const [statementIndex, statement] of statements.entries()) {
    if (isInUnloweredModuleSubtree(statements, statementIndex)) continue;
    const rootInstance = rootInstanceBySourceIndex.get(statementIndex);
    const type = runtimeElementTypeOf(statement);
    if (!rootInstance && !type) continue;

    const runtimeStart = executionStatements.length;
    if (rootInstance) {
      emitInstance(
        rootInstance,
        parentForRootStatement(statements, statement, runtimeIdByRootSourceIndex),
        [],
        statementIndex
      );
    } else {
      const runtimeElementId = runtimeIdByRootSourceIndex.get(statementIndex);
      if (!runtimeElementId) continue;
      const parent = parentForRootStatement(statements, statement, runtimeIdByRootSourceIndex);
      const sourceStatementId = requireStatementIdentity(stableStatementIdByIndex, statementIndex);
      executionStatements.push({
        statement,
        sourceStatementId,
        sourceStatementIndex: statementIndex,
        runtimeElementId,
        type: type!,
        ...(parent.id ? { parentGroupId: parent.id } : {}),
        ...(parent.branch ? { conditionalBranch: parent.branch } : {}),
        sourceBlockChild: parent.sourceBlockChild,
        executionUnitStatementIndex: statementIndex,
        instancePath: []
      });
    }
    sourceExecutionUnits.push({
      sourceStatementIndex: statementIndex,
      runtimeStart,
      runtimeEnd: executionStatements.length
    });
  }

  const atStopIndex = statements.findIndex(
    (statement, statementIndex) => statement.kind === "atStop" && !isInUnloweredModuleSubtree(statements, statementIndex)
  );
  const evaluationLimitIndex = atStopIndex >= 0
    ? executionStatements.filter((entry) => entry.executionUnitStatementIndex < atStopIndex).length
    : undefined;

  return {
    executionStatements,
    sourceExecutionUnits,
    elementIdBySourceStatementIndex,
    sourceExecutionPositionByRuntimeElementId,
    originByRuntimeElementId,
    runtimeIdentityByElementId,
    evaluationLimitIndex
  };
};
