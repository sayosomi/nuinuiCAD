import { isInUnloweredModuleSubtree } from "./dslCompilationGuard";
import { isElementDslStatement } from "./dslParser";
import { encodeIdentityTuple } from "../document/identityTuple";
import { elementTypesWithoutOwnDrawableGeometry } from "../model/elementActivity";
import { isContainerElementType } from "../model/containers";
import type { DslStatement } from "./dslTypes";
import type {
  ModuleInstanceSemantic,
  ModuleSemanticAnalysis
} from "./moduleSemanticTypes";
import type { StatementIdentity } from "../document/statementIdentity";
import type {
  DocumentId,
  DocumentQualifiedSemanticIdentity,
  DocumentQualifiedSourceLocation,
  DocumentSourceIdentity
} from "../document/multiDocumentPrimitives";
import type { ModuleRuntimeContext } from "./moduleRuntimeContext";
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
  /** Present only for graph-backed materialization; proves the exact source owner. */
  sourceDocumentId?: DocumentId;
  sourceIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  source?: DocumentSourceIdentity;
  sourceLocation?: DocumentQualifiedSourceLocation;
  moduleDefinitionDocumentId?: DocumentId;
  moduleDefinitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity>;
  callerModuleDefinitionDocumentId?: DocumentId | null;
  callerModuleDefinitionIdentity?: DocumentQualifiedSemanticIdentity<StatementIdentity> | null;
  runtimeInstancePath?: readonly string[];
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
  /** Runtime-qualified path; absent for ordinary/single-document entries. */
  runtimeInstancePath?: readonly string[];
  runtimeIdentity?: MaterializedRuntimeIdentity;
  origin?: ModuleOrigin;
};

export type SourceExecutionUnit = {
  sourceStatementIndex: number;
  runtimeStart: number;
  runtimeEnd: number;
};

/** Evaluator-owned boundary for a concrete module instance's Base geometry. */
export type ModuleMaterializationSnapshot = {
  instanceId: ElementId;
  endRuntimeIndex: number;
  descendantIds: readonly ElementId[];
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
  /** Concrete-instance boundaries derived from the same execution plan. */
  instanceBaseGeometrySnapshots: readonly ModuleMaterializationSnapshot[];
  /** Scalar execution order is separate from the outer atomic call unit. */
  scalarExecutionPositionByRuntimeElementId?: ReadonlyMap<ElementId, number>;
  evaluationLimitIndex: number | undefined;
};

type MaterializationInput = {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  assignedElementIds: ReadonlyMap<number, ElementId>;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  moduleRuntimeContext?: ModuleRuntimeContext;
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
  moduleSemanticAnalysis,
  moduleRuntimeContext
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
    const runtimePath = moduleRuntimeContext
      ? moduleRuntimeContext.runtimePathForInstance([], instance)
      : [statementId];
    const id = materializedRuntimeElementId("moduleInstance", runtimePath);
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
    parentRuntimePath: readonly string[],
    executionUnitStatementIndex: number
  ): ElementId => {
    if (!instance.callee) throw new Error("moduleMaterialization: cannot emit an unresolved module instance");
    const instancePath = [...parentInstancePath, instance.statementId];
    const runtimeInstancePath = moduleRuntimeContext
      ? moduleRuntimeContext.runtimePathForInstance(parentRuntimePath, instance)
      : instancePath;
    const runtimeIdentity = runtimeIdentityOf("moduleInstance", runtimeInstancePath);
    const runtimeElementId = materializedRuntimeElementId("moduleInstance", runtimeInstancePath);
    const definition = moduleRuntimeContext
      ? moduleRuntimeContext.definitionFor(instance.callee.definitionIdentity) ?? moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId)
      : moduleSemanticAnalysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    if (!definition) {
      throw new Error(`moduleMaterialization: missing definition ${instance.callee.definitionStatementId}`);
    }
    const instanceDocument = moduleRuntimeContext?.documentFor(
      instance.documentId ?? moduleRuntimeContext.rootDocumentId
    );
    const instanceStatement = instanceDocument?.statements[instance.statementIndex] ?? statements[instance.statementIndex];
    if (!instanceStatement) {
      throw new Error(`moduleMaterialization: missing instance statement ${instance.statementId}`);
    }

    executionStatements.push({
      statement: instanceStatement,
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
        instancePath,
        ...(moduleRuntimeContext ? {
          sourceDocumentId: instance.documentId ?? moduleRuntimeContext.rootDocumentId,
          sourceIdentity: instance.identity ?? {
            documentId: instance.documentId ?? moduleRuntimeContext.rootDocumentId,
            localIdentity: instance.statementId
          },
          source: instanceDocument?.sourceIdentity,
          sourceLocation: (() => {
            return instanceDocument && instanceStatement
              ? { source: instanceDocument.sourceIdentity, range: instanceStatement.documentRange }
              : undefined;
          })(),
          moduleDefinitionDocumentId: instance.callee.definitionIdentity?.documentId ?? instance.callee.definitionDocumentId ?? moduleRuntimeContext.rootDocumentId,
          moduleDefinitionIdentity: instance.callee.definitionIdentity ?? {
            documentId: instance.callee.definitionDocumentId ?? moduleRuntimeContext.rootDocumentId,
            localIdentity: instance.callee.definitionStatementId
          },
          callerModuleDefinitionDocumentId: instance.callerModuleDefinitionIdentity?.documentId ?? null,
          callerModuleDefinitionIdentity: instance.callerModuleDefinitionIdentity ?? null,
          runtimeInstancePath
        } : {})
      },
      sourceBlockChild: parent.sourceBlockChild,
      runtimeInstancePath,
      ...(parent.branch ? { conditionalBranch: parent.branch } : {})
    });
    originByRuntimeElementId.set(runtimeElementId, executionStatements.at(-1)!.origin!);
    runtimeIdentityByElementId.set(runtimeElementId, runtimeIdentity);
    sourceExecutionPositionByRuntimeElementId.set(runtimeElementId, executionUnitStatementIndex);

    const localRuntimeIdBySourceIndex = new Map<number, ElementId>();
    for (const body of definition.bodyStatements) {
      const definitionDocument = moduleRuntimeContext?.documentFor(definition.documentId ?? instance.callee.definitionIdentity?.documentId);
      const definitionStatements = definitionDocument?.statements ?? statements;
      const statement = definitionStatements[body.statementIndex];
      if (!statement || statement.kind === "moduleDefinition") continue;

      if (statement.kind === "moduleInstance") {
        const nested = definitionDocument
          ? definitionDocument.moduleSemanticAnalysis.instancesByStatementId.get(body.statementId)
          : moduleSemanticAnalysis.instancesByStatementId.get(body.statementId);
        if (!nested?.callee) continue;
        const nestedParent = parentForBodyStatement(
          definitionStatements,
          statement,
          definition.statementIndex,
          localRuntimeIdBySourceIndex,
          runtimeElementId
        );
        const nestedId = emitInstance(nested, nestedParent, instancePath, runtimeInstancePath, executionUnitStatementIndex);
        localRuntimeIdBySourceIndex.set(body.statementIndex, nestedId);
        continue;
      }

      if (!isElementDslStatement(statement)) continue;
      const type = runtimeElementTypeOf(statement);
      if (!type) continue;
      const runtimeBodyPath = [...runtimeInstancePath, body.statementId];
      const bodyIdentity = runtimeIdentityOf("moduleBody", runtimeBodyPath);
      const bodyRuntimeElementId = materializedRuntimeElementId("moduleBody", runtimeBodyPath);
      const bodyParent = parentForBodyStatement(
        definitionStatements,
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
        instancePath,
        runtimeInstancePath
      };
      const bodySourceDocument = definitionDocument;
      if (moduleRuntimeContext && bodySourceDocument) {
        bodyOrigin.sourceDocumentId = bodySourceDocument.documentId;
        bodyOrigin.sourceIdentity = body.identity ?? {
          documentId: bodySourceDocument.documentId,
          localIdentity: body.statementId
        };
        bodyOrigin.source = bodySourceDocument.sourceIdentity;
        const bodyStatement = bodySourceDocument.statements[body.statementIndex];
        if (bodyStatement) bodyOrigin.sourceLocation = { source: bodySourceDocument.sourceIdentity, range: bodyStatement.documentRange };
        bodyOrigin.moduleDefinitionDocumentId = definition.documentId ?? bodySourceDocument.documentId;
        bodyOrigin.moduleDefinitionIdentity = definition.identity ?? {
          documentId: definition.documentId ?? bodySourceDocument.documentId,
          localIdentity: definition.statementId
        };
        bodyOrigin.callerModuleDefinitionDocumentId = instance.callerModuleDefinitionIdentity?.documentId ?? null;
        bodyOrigin.callerModuleDefinitionIdentity = instance.callerModuleDefinitionIdentity ?? null;
      }
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
        runtimeInstancePath,
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
    instanceBaseGeometrySnapshots: executionStatements
      .filter((entry) => entry.type === "moduleInstance")
      .map((entry, entryIndex) => {
        const path = entry.runtimeIdentity?.path ?? entry.instancePath;
        const materializedDescendants = executionStatements
          .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
          .filter(({ candidate }) =>
            candidate.runtimeElementId !== entry.runtimeElementId &&
            (candidate.runtimeIdentity?.path ?? candidate.runtimeInstancePath ?? candidate.instancePath).length >= path.length &&
            path.every((identity, index) => (candidate.runtimeIdentity?.path ?? candidate.runtimeInstancePath ?? candidate.instancePath)[index] === identity)
          );
        const descendants = materializedDescendants.filter(({ candidate }) =>
          !elementTypesWithoutOwnDrawableGeometry.has(candidate.type) &&
          !isContainerElementType(candidate.type)
        );
        const endRuntimeIndex = materializedDescendants.reduce(
          (last, { candidateIndex }) => Math.max(last, candidateIndex),
          entryIndex
        );
        return {
          instanceId: entry.runtimeElementId,
          endRuntimeIndex,
          descendantIds: descendants.map(({ candidate }) => candidate.runtimeElementId)
        };
      }),
    evaluationLimitIndex
  };
};
