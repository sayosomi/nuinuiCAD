import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { MultiDocumentImportGraph } from "@nuinuicad/nui-language/workspace";
import { documentIdFromHost } from "@nuinuicad/nui-language/workspace";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  prepareRustEvaluation,
  type PreparedRustEvaluation
} from "../geometry/rustEvaluationRunner";
import {
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  type CompiledDslDocument,
  type DslDocumentData,
  type DslStatement,
  type StatementMap
} from "@nuinuicad/nui-language";
import type {
  CanvasModuleOrigin,
  MaterializedExecutionStatement,
  MaterializedRuntimeIdentity,
  ModuleMaterialization,
  ModuleMaterializationSnapshot,
  ModuleOrigin,
  SourceExecutionUnit
} from "@nuinuicad/nui-language";
import type { VisibilityProfile, CadElement, ElementId } from "../types/geometry";
import type { CanvasModuleMaterialization } from "@nuinuicad/nui-language";
import { canvasLayerSourceDocumentFor } from "../model/canvasLayerPresentation";
import type { CanvasLayerSourceDocument } from "../model/canvasLayerPresentation";
import type { LogicalStatement, LogicalStatementSourceMap } from "@nuinuicad/nui-language";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import type {
  DuplicateSnapshotRuntimeSourceOwnership,
  DuplicateSnapshotRuntimeSourceOwner
} from "../commands/commandTypes";

type SerializedStatementMap = Omit<
  StatementMap,
  | "byElementId"
  | "elementIdByStatementIndex"
  | "byModifierName"
  | "modifierDefinitionRangeByName"
  | "statementIdByStatementIndex"
  | "statementIndexByStatementId"
  | "statementRangeById"
  | "byKey"
> & {
  byElementId: readonly (readonly [ElementId, StatementMap["byElementId"] extends Map<ElementId, infer V> ? V : never])[];
  elementIdByStatementIndex: readonly (readonly [number, ElementId])[];
  byModifierName: readonly (readonly [string, StatementMap["byModifierName"] extends Map<string, infer V> ? V : never])[];
  modifierDefinitionRangeByName: readonly (readonly [string, StatementMap["modifierDefinitionRangeByName"] extends Map<string, infer V> ? V : never])[];
  statementIdByStatementIndex?: readonly (readonly [number, string])[];
  statementIndexByStatementId?: readonly (readonly [string, number])[];
  statementRangeById: readonly (readonly [string, StatementMap["statementRangeById"] extends Map<string, infer V> ? V : never])[];
  byKey: readonly (readonly [string, StatementMap["byKey"] extends Map<string, infer V> ? V : never])[];
};

type SourceLayerMembershipByStatementId = NonNullable<DslDocumentData["sourceLayerMembershipsBySourceStatementId"]> extends ReadonlyMap<string, infer Value>
  ? Value
  : never;
type SourceLayerMembershipByElementId = NonNullable<DslDocumentData["sourceLayerMembershipsByElementId"]> extends ReadonlyMap<ElementId, infer Value>
  ? Value
  : never;
type GeometryInputTargets = NonNullable<DslDocumentData["geometryInputTargetsByElementId"]> extends ReadonlyMap<ElementId, infer Value>
  ? Value extends ReadonlyMap<string, infer Target> ? Target : never
  : never;

type SerializedDslDocumentData = Omit<
  DslDocumentData,
  | "sourceLayerMembershipsBySourceStatementId"
  | "sourceLayerMembershipsByElementId"
  | "geometryInputTargetsByElementId"
> & {
  sourceLayerMembershipsBySourceStatementId?: readonly (readonly [string, SourceLayerMembershipByStatementId])[];
  sourceLayerMembershipsByElementId?: readonly (readonly [ElementId, SourceLayerMembershipByElementId])[];
  geometryInputTargetsByElementId?: readonly (readonly [ElementId, readonly (readonly [string, GeometryInputTargets])[]])[];
};

type SerializedSourceEditingDocument = {
  sourceText: string;
  sourceRevision: number;
  majorVersion: NonNullable<CompiledDslDocument["majorVersion"]>;
  document: SerializedDslDocumentData;
  statements: readonly DslStatement[];
  statementMap: SerializedStatementMap;
  sourceLines: readonly string[];
  spans: {
    sourceMap: LogicalStatementSourceMap;
    logicalStatementByRangeFrom: readonly (readonly [number, LogicalStatement])[];
  };
  sourceElementsByStatementIndex: readonly (readonly [number, CadElement])[];
};

export type VscodeMultiDocumentCanvasSourceEditingDocument = {
  sourceText: string;
  sourceRevision: number;
  compiled: CompiledDslDocument & {
    document: DslDocumentData;
    statementMap: StatementMap;
    majorVersion: NonNullable<CompiledDslDocument["majorVersion"]>;
  };
};

export type VscodeMultiDocumentCanvasRuntimeSnapshot = {
  /** Carries only cross-compiler Canvas identity projection; the Webview keeps
   * its local presentation and evaluation when this is true. */
  identityOnly?: boolean;
  /** Uses the exact compiled Host root and Rust input without Module materialization. */
  rootOnly?: true;
  graphRevision: number;
  rootDocumentId: string;
  rootSourceRevision: number;
  sourceElementRuntimeIdsByStatementIndex?: readonly (readonly [number, string])[];
  preparedRustEvaluation: PreparedRustEvaluation;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string;
  modulePresentation: {
    instanceBaseGeometrySnapshots: readonly ModuleMaterializationSnapshot[];
    layerSourceDocuments: readonly CanvasLayerSourceDocument[];
    origins: readonly {
      runtimeElementId: string;
      kind: "moduleInstance" | "moduleBody";
      instancePath: readonly string[];
      runtimeInstancePath?: readonly string[];
      sourceStatementId?: string;
      sourceDocumentId?: string;
    }[];
    revealMaterialization?: VscodeMultiDocumentRevealMaterialization;
    sourceEditing?: SerializedSourceEditingDocument;
    /** Narrow compiler-verified owner evidence; never includes ModuleRuntimeContext. */
    sourceOwnership?: DuplicateSnapshotRuntimeSourceOwnership;
  };
};

/** JSON-safe transport form of the exact materialization fields used by the
 * shared Reveal runtime projection. Maps are restored only in the Webview. */
export type VscodeMultiDocumentRevealMaterialization = {
  executionStatements: readonly MaterializedExecutionStatement[];
  sourceExecutionUnits: readonly SourceExecutionUnit[];
  elementIdBySourceStatementIndex: readonly (readonly [number, string])[];
  sourceExecutionPositionByRuntimeElementId: readonly (readonly [string, number])[];
  originByRuntimeElementId: readonly (readonly [string, ModuleOrigin])[];
  runtimeIdentityByElementId: readonly (readonly [string, MaterializedRuntimeIdentity])[];
  instanceBaseGeometrySnapshots: readonly ModuleMaterializationSnapshot[];
  scalarExecutionPositionByRuntimeElementId?: readonly (readonly [string, number])[];
  evaluationLimitIndex: number | undefined;
};

export type VscodeMultiDocumentCanvasRuntimePresentation = {
  rootOnly?: true;
  graphRevision: number;
  rootDocumentId: string;
  rootSourceRevision: number;
  elements: CadElement[];
  evaluationLimitIndex: number | undefined;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  moduleMaterialization: CanvasModuleMaterialization;
  layerSourceDocuments: readonly CanvasLayerSourceDocument[];
  revealMaterialization?: ModuleMaterialization;
  sourceEditing?: VscodeMultiDocumentCanvasSourceEditingDocument;
  sourceOwnership?: DuplicateSnapshotRuntimeSourceOwnership;
};

const serializeStatementMap = (statementMap: StatementMap): SerializedStatementMap => ({
  sourceRevision: statementMap.sourceRevision,
  statements: statementMap.statements,
  byElementId: [...statementMap.byElementId.entries()],
  elementIdByStatementIndex: [...statementMap.elementIdByStatementIndex.entries()],
  byModifierName: [...statementMap.byModifierName.entries()],
  modifierDefinitionRangeByName: [...statementMap.modifierDefinitionRangeByName.entries()],
  ...(statementMap.statementIdByStatementIndex
    ? { statementIdByStatementIndex: [...statementMap.statementIdByStatementIndex.entries()] }
    : {}),
  ...(statementMap.statementIndexByStatementId
    ? { statementIndexByStatementId: [...statementMap.statementIndexByStatementId.entries()] }
    : {}),
  statementRangeById: [...statementMap.statementRangeById.entries()],
  byKey: [...statementMap.byKey.entries()],
  sectionEnds: { ...statementMap.sectionEnds }
});

const deserializeStatementMap = (statementMap: SerializedStatementMap): StatementMap => ({
  sourceRevision: statementMap.sourceRevision,
  statements: [...statementMap.statements],
  byElementId: new Map(statementMap.byElementId),
  elementIdByStatementIndex: new Map(statementMap.elementIdByStatementIndex),
  byModifierName: new Map(statementMap.byModifierName),
  modifierDefinitionRangeByName: new Map(statementMap.modifierDefinitionRangeByName),
  ...(statementMap.statementIdByStatementIndex
    ? { statementIdByStatementIndex: new Map(statementMap.statementIdByStatementIndex) }
    : {}),
  ...(statementMap.statementIndexByStatementId
    ? { statementIndexByStatementId: new Map(statementMap.statementIndexByStatementId) }
    : {}),
  statementRangeById: new Map(statementMap.statementRangeById),
  byKey: new Map(statementMap.byKey),
  sectionEnds: { ...statementMap.sectionEnds }
});

const serializeDslDocumentData = (document: DslDocumentData): SerializedDslDocumentData => ({
  ...document,
  ...(document.sourceLayerMembershipsBySourceStatementId
    ? { sourceLayerMembershipsBySourceStatementId: [...document.sourceLayerMembershipsBySourceStatementId.entries()] }
    : {}),
  ...(document.sourceLayerMembershipsByElementId
    ? { sourceLayerMembershipsByElementId: [...document.sourceLayerMembershipsByElementId.entries()] }
    : {}),
  ...(document.geometryInputTargetsByElementId
    ? {
        geometryInputTargetsByElementId: [...document.geometryInputTargetsByElementId.entries()].map(([elementId, targets]) =>
          [elementId, [...targets.entries()]] as const)
      }
    : {})
}) as SerializedDslDocumentData;

const deserializeDslDocumentData = (serialized: SerializedDslDocumentData): DslDocumentData => {
  const {
    sourceLayerMembershipsBySourceStatementId,
    sourceLayerMembershipsByElementId,
    geometryInputTargetsByElementId,
    ...document
  } = serialized;
  return {
  ...document,
  ...(sourceLayerMembershipsBySourceStatementId
    ? { sourceLayerMembershipsBySourceStatementId: new Map(sourceLayerMembershipsBySourceStatementId) }
    : {}),
  ...(sourceLayerMembershipsByElementId
    ? { sourceLayerMembershipsByElementId: new Map(sourceLayerMembershipsByElementId) }
    : {}),
  ...(geometryInputTargetsByElementId
    ? {
        geometryInputTargetsByElementId: new Map(geometryInputTargetsByElementId.map(([elementId, targets]) =>
          [elementId, new Map(targets)] as const))
      }
    : {})
  };
};

const serializeSourceEditingDocument = (
  compiled: CompiledDslDocument
): SerializedSourceEditingDocument | undefined => {
  if (!compiled.document || !compiled.statementMap || !compiled.majorVersion) return undefined;
  return {
    sourceText: compiled.spans.sourceMap.source,
    sourceRevision: compiled.spans.sourceMap.sourceRevision,
    majorVersion: compiled.majorVersion,
    document: serializeDslDocumentData(compiled.document),
    statements: compiled.statements,
    statementMap: serializeStatementMap(compiled.statementMap),
    sourceLines: compiled.sourceLines,
    spans: {
      sourceMap: compiled.spans.sourceMap,
      logicalStatementByRangeFrom: [...compiled.spans.logicalStatementByRangeFrom.entries()]
    },
    sourceElementsByStatementIndex: [...compiled.sourceElementsByStatementIndex.entries()]
  };
};

const deserializeSourceEditingDocument = (
  sourceEditing: SerializedSourceEditingDocument,
  moduleMaterialization: ModuleMaterialization | undefined
): VscodeMultiDocumentCanvasSourceEditingDocument => ({
  sourceText: sourceEditing.sourceText,
  sourceRevision: sourceEditing.sourceRevision,
  compiled: {
    majorVersion: sourceEditing.majorVersion,
    document: deserializeDslDocumentData(sourceEditing.document),
    statements: [...sourceEditing.statements],
    statementMap: deserializeStatementMap(sourceEditing.statementMap),
    sourceLines: [...sourceEditing.sourceLines],
    spans: {
      sourceMap: sourceEditing.spans.sourceMap,
      logicalStatementByRangeFrom: new Map(sourceEditing.spans.logicalStatementByRangeFrom)
    },
    sourceElementsByStatementIndex: new Map(sourceEditing.sourceElementsByStatementIndex),
    diagnostics: [],
    ...(moduleMaterialization ? { moduleMaterialization } : {})
  }
});

const revealMaterializationFor = (
  serialized: VscodeMultiDocumentRevealMaterialization,
  rootDocumentId: string
): ModuleMaterialization => ({
  rootDocumentId: documentIdFromHost(rootDocumentId),
  executionStatements: serialized.executionStatements,
  sourceExecutionUnits: serialized.sourceExecutionUnits,
  elementIdBySourceStatementIndex: new Map(serialized.elementIdBySourceStatementIndex),
  sourceExecutionPositionByRuntimeElementId: new Map(serialized.sourceExecutionPositionByRuntimeElementId),
  originByRuntimeElementId: new Map(serialized.originByRuntimeElementId),
  runtimeIdentityByElementId: new Map(serialized.runtimeIdentityByElementId),
  instanceBaseGeometrySnapshots: serialized.instanceBaseGeometrySnapshots,
  ...(serialized.scalarExecutionPositionByRuntimeElementId
    ? { scalarExecutionPositionByRuntimeElementId: new Map(serialized.scalarExecutionPositionByRuntimeElementId) }
    : {}),
  evaluationLimitIndex: serialized.evaluationLimitIndex
});

const hasGatingError = (compiled: CompiledDslDocument): boolean =>
  compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
  (compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

const hasImportedNominalRecordDependency = (
  graph: MultiDocumentImportGraph<unknown>,
  compiled: CompiledDslDocument
): boolean => {
  const rootRecordAnalysis = compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
  if (!rootRecordAnalysis) return false;
  const importedDefinitionIdentities = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.documentId === graph.rootDocumentId) continue;
    for (const identity of node.artifact.sourceLexicalNamespace?.recordSemanticAnalysis?.definitionsByStatementId.keys() ?? []) {
      importedDefinitionIdentities.add(identity);
    }
  }
  if (importedDefinitionIdentities.size === 0) return false;
  const referencedIdentities = [
    ...[...rootRecordAnalysis.valuesByStatementId.values()].map((value) => value.typeReference.typeIdentity),
    ...rootRecordAnalysis.moduleParameters.map((parameter) => parameter.typeReference.typeIdentity)
  ];
  return referencedIdentities.some((identity) => identity !== null && importedDefinitionIdentities.has(identity));
};

const exactLastGoodDocument = (compiled: CompiledDslDocument): LastGoodDslDocument | null =>
  compiled.majorVersion === NEW_DOCUMENT_DSL_MAJOR_VERSION &&
  compiled.document &&
  compiled.statementMap
    ? compiled as LastGoodDslDocument
    : null;

const duplicateSnapshotOwnerFingerprint = (owner: Omit<DuplicateSnapshotRuntimeSourceOwner, "verificationFingerprint">) => {
  let value = 0x811c9dc5;
  for (const character of JSON.stringify(owner)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
};

const sourceOwnershipFor = (
  compiled: LastGoodDslDocument,
  graph: MultiDocumentImportGraph<unknown>,
  graphRevision: number
): DuplicateSnapshotRuntimeSourceOwnership => {
  const runtimeElementIds = new Set<ElementId>([
    ...compiled.document.elements.map(({ id }) => id),
    ...(compiled.moduleMaterialization?.originByRuntimeElementId.keys() ?? [])
  ]);
  const owners: DuplicateSnapshotRuntimeSourceOwner[] = [];
  for (const runtimeElementId of runtimeElementIds) {
    const owner = sourceOwnerForRuntimeElementId(compiled, runtimeElementId);
    if (!owner) continue;
    const evidence: Omit<DuplicateSnapshotRuntimeSourceOwner, "verificationFingerprint"> = {
      runtimeElementId: owner.runtimeElementId,
      kind: owner.kind,
      sourceStatementId: owner.sourceStatementId,
      sourceStatementIndex: owner.sourceStatementIndex,
      statement: {
        statementIndex: owner.statement.statementIndex,
        sourceRevision: owner.statement.sourceRevision,
        range: { ...owner.statement.range }
      },
      ...(owner.sourceDocumentId ? { sourceDocumentId: String(owner.sourceDocumentId) } : {}),
      ...(owner.sourceIdentity ? {
        sourceIdentity: {
          documentId: String(owner.sourceIdentity.documentId),
          localIdentity: owner.sourceIdentity.localIdentity
        }
      } : {}),
      ...(owner.source ? {
        source: owner.source.kind === "root-current"
          ? {
              kind: owner.source.kind,
              documentId: String(owner.source.documentId),
              sourceRevision: owner.source.sourceRevision
            }
          : {
              kind: owner.source.kind,
              documentId: String(owner.source.documentId),
              savedSourceFingerprint: String(owner.source.savedSourceFingerprint)
            }
      } : {}),
      ...(owner.sourceLocation ? {
        sourceLocation: {
          source: owner.sourceLocation.source.kind === "root-current"
            ? {
                kind: owner.sourceLocation.source.kind,
                documentId: String(owner.sourceLocation.source.documentId),
                sourceRevision: owner.sourceLocation.source.sourceRevision
              }
            : {
                kind: owner.sourceLocation.source.kind,
                documentId: String(owner.sourceLocation.source.documentId),
                savedSourceFingerprint: String(owner.sourceLocation.source.savedSourceFingerprint)
              },
          range: { ...owner.sourceLocation.range }
        }
      } : {})
    };
    owners.push({
      ...evidence,
      verificationFingerprint: duplicateSnapshotOwnerFingerprint(evidence)
    });
  }
  return {
    rootDocumentId: String(graph.rootDocumentId),
    graphRevision,
    rootSourceRevision: graph.rootSource.sourceRevision,
    dependencySourceIdentities: [...graph.dependencyFingerprints.entries()]
      .filter(([documentId]) => documentId !== graph.rootDocumentId)
      .map(([documentId, savedSourceFingerprint]) => ({
        documentId: String(documentId),
        savedSourceFingerprint: String(savedSourceFingerprint)
      }))
      .sort((left, right) => left.documentId.localeCompare(right.documentId)),
    owners
  };
};

/**
 * Project the exact graph-backed Module root into the narrow data contract
 * consumed by the VS Code Canvas. This is deliberately the only production
 * runtime projection; the Webview never rebuilds the graph or compiler state.
 */
export const projectVscodeMultiDocumentCanvasRuntime = ({
  graph,
  compiled,
  graphRevision
}: {
  graph: MultiDocumentImportGraph<unknown>;
  compiled: CompiledDslDocument;
  graphRevision: number;
}): VscodeMultiDocumentCanvasRuntimeSnapshot | null => {
  if (!graph.valid || graph.rootSource.kind !== "root-current" || hasGatingError(compiled)) return null;
  const document = exactLastGoodDocument(compiled);
  const context = compiled.moduleRuntimeContext;
  const materialization = compiled.moduleMaterialization;
  if (
    !document ||
    !context ||
    !context.valid ||
    context.graph !== graph ||
    context.rootDocumentId !== graph.rootDocumentId ||
    document.spans.sourceMap.source !== graph.rootSource.normalizedSource ||
    document.spans.sourceMap.sourceRevision !== graph.rootSource.sourceRevision ||
    document.statementMap.sourceRevision !== graph.rootSource.sourceRevision
  ) return null;
  const rootRuntimeDocument = context.documentFor(context.rootDocumentId);
  if (
    !rootRuntimeDocument ||
    rootRuntimeDocument.source.kind !== "root-current" ||
    rootRuntimeDocument.source.sourceRevision !== graph.rootSource.sourceRevision
  ) return null;

  const hasCrossDocumentMaterialization = [...(materialization?.originByRuntimeElementId.values() ?? [])].some(
    origin => origin.sourceDocumentId !== undefined && origin.sourceDocumentId !== graph.rootDocumentId
  );
  // Empty imported Modules still require the graph, even without a body
  // geometry occurrence. Use the existing resolved callee identity; unused
  // imports and same-file instances retain their ordinary local presentation.
  const hasImportedInstance = compiled.moduleSemanticAnalysis?.instances.some(instance => {
    const definitionDocumentId = instance.callee?.definitionIdentity?.documentId ?? instance.callee?.definitionDocumentId;
    return definitionDocumentId !== undefined && definitionDocumentId !== graph.rootDocumentId;
  });
  const requiresModuleRuntime = hasCrossDocumentMaterialization || hasImportedInstance;
  const requiresRootOnlyRuntime = hasImportedNominalRecordDependency(graph, compiled);
  if (!requiresModuleRuntime && !requiresRootOnlyRuntime) return null;

  const preparedRustEvaluation = prepareRustEvaluation(
    document.document.elements,
    buildEvaluationOptions({
      compiledDocument: document,
      evaluationLimitIndex: document.document.evaluationLimitIndex
    })
  );
  if (!preparedRustEvaluation.rustEligible) return null;
  const sourceOwnership = sourceOwnershipFor(document, graph, graphRevision);

  const rootLayerSourceDocument = canvasLayerSourceDocumentFor({
    documentId: String(rootRuntimeDocument.documentId),
    sourceLexicalNamespace: rootRuntimeDocument.sourceLexicalNamespace,
    statements: rootRuntimeDocument.statements,
    document: document.document
  });

  if (!requiresModuleRuntime) {
    const sourceEditing = serializeSourceEditingDocument(document);
    if (
      !sourceEditing ||
      sourceEditing.sourceText !== graph.rootSource.normalizedSource ||
      sourceEditing.sourceRevision !== graph.rootSource.sourceRevision ||
      sourceEditing.statementMap.sourceRevision !== sourceEditing.sourceRevision
    ) return null;
    return {
      rootOnly: true,
      graphRevision,
      rootDocumentId: String(graph.rootDocumentId),
      rootSourceRevision: graph.rootSource.sourceRevision,
      preparedRustEvaluation,
      visibilityProfiles: document.document.visibilityProfiles.map((profile) => ({ ...profile })),
      activeVisibilityProfileId: document.document.activeVisibilityProfileId,
      modulePresentation: {
        instanceBaseGeometrySnapshots: [],
        layerSourceDocuments: [rootLayerSourceDocument],
        origins: [],
        sourceEditing,
        sourceOwnership
      }
    };
  }

  if (!materialization) return null;

  return {
    graphRevision,
    rootDocumentId: String(graph.rootDocumentId),
    rootSourceRevision: graph.rootSource.sourceRevision,
    preparedRustEvaluation,
    visibilityProfiles: document.document.visibilityProfiles.map((profile) => ({ ...profile })),
    activeVisibilityProfileId: document.document.activeVisibilityProfileId,
    modulePresentation: {
      instanceBaseGeometrySnapshots: materialization.instanceBaseGeometrySnapshots.map((snapshot) => ({
        instanceId: snapshot.instanceId,
        endRuntimeIndex: snapshot.endRuntimeIndex,
        descendantIds: [...snapshot.descendantIds],
        ...(snapshot.instancePath ? { instancePath: [...snapshot.instancePath] } : {})
      })),
      layerSourceDocuments: [
        rootLayerSourceDocument,
        ...[...context.documentsById.values()]
          .filter((sourceDocument) => sourceDocument.documentId !== context.rootDocumentId)
          .map((sourceDocument) => canvasLayerSourceDocumentFor({
            documentId: String(sourceDocument.documentId),
            sourceLexicalNamespace: sourceDocument.sourceLexicalNamespace,
            statements: sourceDocument.statements
          }))
      ],
      origins: [...materialization.originByRuntimeElementId.entries()].map(([runtimeElementId, origin]) => ({
        runtimeElementId,
        kind: origin.kind,
        instancePath: [...origin.instancePath],
        sourceStatementId: origin.sourceStatementId,
        ...(origin.sourceDocumentId ? { sourceDocumentId: String(origin.sourceDocumentId) } : {}),
        ...(origin.runtimeInstancePath ? { runtimeInstancePath: [...origin.runtimeInstancePath] } : {})
      })),
      sourceEditing: serializeSourceEditingDocument(document),
      sourceOwnership,
      revealMaterialization: {
        executionStatements: materialization.executionStatements,
        sourceExecutionUnits: materialization.sourceExecutionUnits,
        elementIdBySourceStatementIndex: [...materialization.elementIdBySourceStatementIndex.entries()],
        sourceExecutionPositionByRuntimeElementId: [...materialization.sourceExecutionPositionByRuntimeElementId.entries()],
        originByRuntimeElementId: [...materialization.originByRuntimeElementId.entries()],
        runtimeIdentityByElementId: [...materialization.runtimeIdentityByElementId.entries()],
        instanceBaseGeometrySnapshots: materialization.instanceBaseGeometrySnapshots,
        ...(materialization.scalarExecutionPositionByRuntimeElementId
          ? { scalarExecutionPositionByRuntimeElementId: [...materialization.scalarExecutionPositionByRuntimeElementId.entries()] }
          : {}),
        evaluationLimitIndex: materialization.evaluationLimitIndex
      }
    }
  };
};

/**
 * Project only the root source-statement to graph-runtime-ID correspondence
 * when an imported graph has no imported Module runtime to present. The
 * Extension Host uses these IDs for its canonical source-definition query;
 * the Webview keeps its local Canvas geometry and evaluation.
 */
export const projectVscodeMultiDocumentCanvasIdentity = ({
  graph,
  compiled,
  graphRevision
}: {
  graph: MultiDocumentImportGraph<unknown>;
  compiled: CompiledDslDocument;
  graphRevision: number;
}): VscodeMultiDocumentCanvasRuntimeSnapshot | null => {
  if (
    !graph.valid ||
    graph.rootSource.kind !== "root-current" ||
    graph.nodes.size <= 1 ||
    hasGatingError(compiled)
  ) return null;
  const document = exactLastGoodDocument(compiled);
  const context = compiled.moduleRuntimeContext;
  if (
    !document ||
    !context ||
    !context.valid ||
    context.graph !== graph ||
    context.rootDocumentId !== graph.rootDocumentId ||
    document.spans.sourceMap.source !== graph.rootSource.normalizedSource ||
    document.spans.sourceMap.sourceRevision !== graph.rootSource.sourceRevision ||
    document.statementMap.sourceRevision !== graph.rootSource.sourceRevision
  ) return null;
  const rootRuntimeDocument = context.documentFor(context.rootDocumentId);
  if (
    !rootRuntimeDocument ||
    rootRuntimeDocument.source.kind !== "root-current" ||
    rootRuntimeDocument.source.sourceRevision !== graph.rootSource.sourceRevision
  ) return null;

  const hasCrossDocumentMaterialization = [...(compiled.moduleMaterialization?.originByRuntimeElementId.values() ?? [])].some(
    origin => origin.sourceDocumentId !== undefined && origin.sourceDocumentId !== graph.rootDocumentId
  );
  const hasImportedInstance = compiled.moduleSemanticAnalysis?.instances.some(instance => {
    const definitionDocumentId = instance.callee?.definitionIdentity?.documentId ?? instance.callee?.definitionDocumentId;
    return definitionDocumentId !== undefined && definitionDocumentId !== graph.rootDocumentId;
  });
  if (hasCrossDocumentMaterialization || hasImportedInstance) return null;

  return {
    identityOnly: true,
    sourceElementRuntimeIdsByStatementIndex: [...document.statementMap.elementIdByStatementIndex.entries()],
    graphRevision,
    rootDocumentId: String(graph.rootDocumentId),
    rootSourceRevision: graph.rootSource.sourceRevision,
    preparedRustEvaluation: prepareRustEvaluation(
      document.document.elements,
      buildEvaluationOptions({
        compiledDocument: document,
        evaluationLimitIndex: document.document.evaluationLimitIndex
      })
    ),
    visibilityProfiles: document.document.visibilityProfiles.map((profile) => ({ ...profile })),
    activeVisibilityProfileId: document.document.activeVisibilityProfileId,
    modulePresentation: {
      instanceBaseGeometrySnapshots: [],
      layerSourceDocuments: [canvasLayerSourceDocumentFor({
        documentId: String(rootRuntimeDocument.documentId),
        sourceLexicalNamespace: rootRuntimeDocument.sourceLexicalNamespace,
        statements: rootRuntimeDocument.statements,
        document: document.document
      })],
      origins: []
    }
  };
};

/** Rehydrate only the presentation maps needed by Canvas helpers. */
export const canvasRuntimePresentationFor = (
  snapshot: VscodeMultiDocumentCanvasRuntimeSnapshot
): VscodeMultiDocumentCanvasRuntimePresentation => {
  const revealMaterialization = snapshot.modulePresentation.revealMaterialization
    ? revealMaterializationFor(snapshot.modulePresentation.revealMaterialization, snapshot.rootDocumentId)
    : undefined;
  return {
    ...(snapshot.rootOnly ? { rootOnly: true as const } : {}),
    graphRevision: snapshot.graphRevision,
    rootDocumentId: snapshot.rootDocumentId,
    rootSourceRevision: snapshot.rootSourceRevision,
    elements: snapshot.preparedRustEvaluation.input.elements,
    evaluationLimitIndex: snapshot.preparedRustEvaluation.input.evaluationLimitIndex,
    visibilityProfiles: [...snapshot.visibilityProfiles],
    activeVisibilityProfileId: snapshot.activeVisibilityProfileId,
    layerSourceDocuments: [...snapshot.modulePresentation.layerSourceDocuments],
    moduleMaterialization: {
      instanceBaseGeometrySnapshots: snapshot.modulePresentation.instanceBaseGeometrySnapshots,
      originByRuntimeElementId: new Map<ElementId, CanvasModuleOrigin>(
        snapshot.modulePresentation.origins.map((origin) => [origin.runtimeElementId, {
          kind: origin.kind,
          instancePath: [...origin.instancePath],
          sourceStatementId: origin.sourceStatementId,
          ...(origin.sourceDocumentId ? { sourceDocumentId: origin.sourceDocumentId } : {}),
          ...(origin.runtimeInstancePath ? { runtimeInstancePath: [...origin.runtimeInstancePath] } : {})
        } satisfies CanvasModuleOrigin] as const)
      )
    },
    ...(revealMaterialization ? { revealMaterialization } : {}),
    ...(snapshot.modulePresentation.sourceEditing && (snapshot.rootOnly ? !snapshot.identityOnly : revealMaterialization)
      ? {
          sourceEditing: deserializeSourceEditingDocument(
            snapshot.modulePresentation.sourceEditing,
            revealMaterialization
          )
        }
      : {}),
    ...(snapshot.modulePresentation.sourceOwnership
      ? { sourceOwnership: snapshot.modulePresentation.sourceOwnership }
      : {})
  };
};
