import type { LastGoodDslDocument } from "../document/canonicalDocument";
import type { MultiDocumentImportGraph } from "../document/multiDocumentImportGraph";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  prepareRustEvaluation,
  type PreparedRustEvaluation
} from "../geometry/rustEvaluationRunner";
import {
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  type CompiledDslDocument
} from "../dsl/dslDocument";
import type { CanvasModuleOrigin, ModuleMaterializationSnapshot } from "../dsl/moduleMaterialization";
import type { VisibilityProfile, CadElement, ElementId } from "../types/geometry";
import type { CanvasModuleMaterialization } from "../dsl/moduleMaterialization";

export type VscodeMultiDocumentCanvasRuntimeSnapshot = {
  graphRevision: number;
  rootDocumentId: string;
  rootSourceRevision: number;
  preparedRustEvaluation: PreparedRustEvaluation;
  visibilityProfiles: readonly VisibilityProfile[];
  activeVisibilityProfileId: string;
  modulePresentation: {
    instanceBaseGeometrySnapshots: readonly ModuleMaterializationSnapshot[];
    origins: readonly {
      runtimeElementId: string;
      kind: "moduleInstance" | "moduleBody";
      instancePath: readonly string[];
      runtimeInstancePath?: readonly string[];
    }[];
  };
};

export type VscodeMultiDocumentCanvasRuntimePresentation = {
  graphRevision: number;
  rootDocumentId: string;
  rootSourceRevision: number;
  elements: CadElement[];
  evaluationLimitIndex: number | undefined;
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  moduleMaterialization: CanvasModuleMaterialization;
};

const hasGatingError = (compiled: CompiledDslDocument): boolean =>
  compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
  (compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

const exactLastGoodDocument = (compiled: CompiledDslDocument): LastGoodDslDocument | null =>
  compiled.majorVersion === NEW_DOCUMENT_DSL_MAJOR_VERSION &&
  compiled.document &&
  compiled.statementMap
    ? compiled as LastGoodDslDocument
    : null;

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
    !materialization
  ) return null;

  const hasCrossDocumentMaterialization = [...materialization.originByRuntimeElementId.values()].some(
    (origin) => origin.sourceDocumentId !== undefined && origin.sourceDocumentId !== graph.rootDocumentId
  );
  if (!hasCrossDocumentMaterialization) return null;

  const preparedRustEvaluation = prepareRustEvaluation(
    document.document.elements,
    buildEvaluationOptions({
      compiledDocument: document,
      evaluationLimitIndex: document.document.evaluationLimitIndex
    })
  );
  if (!preparedRustEvaluation.rustEligible) return null;

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
        descendantIds: [...snapshot.descendantIds]
      })),
      origins: [...materialization.originByRuntimeElementId.entries()].map(([runtimeElementId, origin]) => ({
        runtimeElementId,
        kind: origin.kind,
        instancePath: [...origin.instancePath],
        ...(origin.runtimeInstancePath ? { runtimeInstancePath: [...origin.runtimeInstancePath] } : {})
      }))
    }
  };
};

/** Rehydrate only the presentation maps needed by Canvas helpers. */
export const canvasRuntimePresentationFor = (
  snapshot: VscodeMultiDocumentCanvasRuntimeSnapshot
): VscodeMultiDocumentCanvasRuntimePresentation => ({
  graphRevision: snapshot.graphRevision,
  rootDocumentId: snapshot.rootDocumentId,
  rootSourceRevision: snapshot.rootSourceRevision,
  elements: snapshot.preparedRustEvaluation.input.elements,
  evaluationLimitIndex: snapshot.preparedRustEvaluation.input.evaluationLimitIndex,
  visibilityProfiles: [...snapshot.visibilityProfiles],
  activeVisibilityProfileId: snapshot.activeVisibilityProfileId,
  moduleMaterialization: {
    instanceBaseGeometrySnapshots: snapshot.modulePresentation.instanceBaseGeometrySnapshots,
    originByRuntimeElementId: new Map<ElementId, CanvasModuleOrigin>(
      snapshot.modulePresentation.origins.map((origin) => [origin.runtimeElementId, {
        kind: origin.kind,
        instancePath: [...origin.instancePath],
        ...(origin.runtimeInstancePath ? { runtimeInstancePath: [...origin.runtimeInstancePath] } : {})
      } satisfies CanvasModuleOrigin] as const)
    )
  }
});
