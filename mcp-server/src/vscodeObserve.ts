import { createHash } from "node:crypto";
import {
  canonicalizeObservationDocumentPath,
  requestVscodeObservation,
  resolveVscodeObservationInstance,
  type VscodeObservationCandidateMetadata,
  type VscodeObservationDiscoveryOptions,
  type VscodeObservationLiveInstance
} from "../../src/node/vscodeObservationBridge";
import { materializedRuntimeElementId } from "../../src/dsl/moduleMaterialization";
import { stableSnapshotElementId, stableSnapshotStatementId } from "./documentSnapshot";

export type VscodeObserveInput = {
  instanceId?: string;
  documentPath?: string;
  includeSourceText?: boolean;
};

export type VscodeObserveOptions = Pick<
  VscodeObservationDiscoveryOptions,
  "descriptorDirectory" | "timeoutMs" | "cleanupStale"
>;

type JsonObject = Record<string, unknown>;

type CanvasElementSource = {
  runtimeElementId: string;
  sourceStatementIndex: number;
  elementType: string;
} | {
  runtimeElementId: string;
  runtimeKind: "moduleInstance" | "moduleBody";
  sourceStatementPath: number[];
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const candidateMetadata = (
  instance: VscodeObservationLiveInstance
): VscodeObservationCandidateMetadata => ({
  instanceId: instance.descriptor.instanceId,
  pid: instance.descriptor.pid,
  port: instance.descriptor.port,
  workspaceFolderPaths: [...instance.descriptor.workspaceFolderPaths],
  startedAt: instance.descriptor.startedAt,
  documentPaths: [...instance.documentPaths]
});

const jsonFriendlyCopy = (value: unknown): unknown => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("VS Code observation is not JSON serializable");
  return JSON.parse(encoded) as unknown;
};

const canvasNeedsStableSelectionProjection = (canvas: unknown): boolean => {
  if (!isObject(canvas)) return false;
  return Array.isArray(canvas.selectedElementIds) &&
    canvas.selectedElementIds.length > 0 &&
    Array.isArray(canvas.selectedElementSources) &&
    canvas.selectedElementSources.length > 0;
};

const observationNeedsStableSelectionProjection = (observation: unknown): boolean =>
  isObject(observation) &&
  Array.isArray(observation.documents) &&
  observation.documents.some((document) =>
    isObject(document) && canvasNeedsStableSelectionProjection(document.canvas)
  );

const canvasElementSources = (value: unknown): CanvasElementSource[] | null => {
  if (!Array.isArray(value)) return null;
  const result: CanvasElementSource[] = [];
  const runtimeElementIds = new Set<string>();
  for (const item of value) {
    if (!isObject(item) || typeof item.runtimeElementId !== "string" || item.runtimeElementId.length === 0) {
      return null;
    }
    if (runtimeElementIds.has(item.runtimeElementId)) return null;
    runtimeElementIds.add(item.runtimeElementId);

    if (item.runtimeKind === "moduleInstance" || item.runtimeKind === "moduleBody") {
      if (
        !Array.isArray(item.sourceStatementPath) ||
        item.sourceStatementPath.length === 0 ||
        !item.sourceStatementPath.every((index): index is number =>
          Number.isSafeInteger(index) && index >= 0
        )
      ) return null;
      result.push({
        runtimeElementId: item.runtimeElementId,
        runtimeKind: item.runtimeKind,
        sourceStatementPath: [...item.sourceStatementPath]
      });
      continue;
    }

    if (
      item.runtimeKind !== undefined ||
      !Number.isSafeInteger(item.sourceStatementIndex) ||
      (item.sourceStatementIndex as number) < 0 ||
      typeof item.elementType !== "string" ||
      item.elementType.length === 0
    ) return null;
    result.push({
      runtimeElementId: item.runtimeElementId,
      sourceStatementIndex: item.sourceStatementIndex as number,
      elementType: item.elementType
    });
  }
  return result;
};

const projectCanvasSelection = (
  canvas: JsonObject,
  sourceText: unknown
): JsonObject => {
  if (typeof sourceText !== "string" || !Array.isArray(canvas.selectedElementIds)) return canvas;
  const runtimeSelectedElementIds = canvas.selectedElementIds;
  if (
    runtimeSelectedElementIds.length === 0 ||
    !runtimeSelectedElementIds.every((value): value is string => typeof value === "string")
  ) return canvas;

  const sources = canvasElementSources(canvas.selectedElementSources);
  if (!sources || sources.length !== runtimeSelectedElementIds.length || sources.length === 0) return canvas;
  if (new Set(runtimeSelectedElementIds).size !== runtimeSelectedElementIds.length) return canvas;
  const sourceByRuntimeId = new Map(sources.map((source) => [source.runtimeElementId, source] as const));
  const selectedSources = runtimeSelectedElementIds.map((runtimeElementId) => sourceByRuntimeId.get(runtimeElementId));
  if (
    selectedSources.some((source) => source === undefined) ||
    sources.some((source) => !runtimeSelectedElementIds.includes(source.runtimeElementId))
  ) return canvas;

  const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
  return {
    ...canvas,
    runtimeSelectedElementIds: [...runtimeSelectedElementIds],
    selectedElementIds: selectedSources.map((source) => {
      const selectedSource = source!;
      if (!("runtimeKind" in selectedSource)) {
        return stableSnapshotElementId(sourceHash, selectedSource.sourceStatementIndex, selectedSource.elementType);
      }
      const stablePath = selectedSource.sourceStatementPath.map((statementIndex) =>
        stableSnapshotStatementId(sourceHash, statementIndex)
      );
      return materializedRuntimeElementId(selectedSource.runtimeKind, stablePath);
    })
  };
};

const projectObservation = (
  observation: unknown,
  includeSourceText: boolean
): JsonObject | null => {
  const copied = jsonFriendlyCopy(observation);
  if (!isObject(copied) || !Array.isArray(copied.documents)) return null;

  const documents = copied.documents.map((document) => {
    if (!isObject(document)) return document;
    const sourceText = document.sourceText;
    const projected: JsonObject = { ...document };
    if (isObject(document.canvas)) {
      projected.canvas = projectCanvasSelection(document.canvas, sourceText);
    }
    if (includeSourceText) return projected;
    delete projected.sourceText;
    return projected;
  });

  return { ...copied, documents };
};

const observationDocumentPaths = (observation: unknown): string[] => {
  if (!isObject(observation) || !Array.isArray(observation.documents)) return [];
  return observation.documents.flatMap((document) =>
    isObject(document) && typeof document.documentPath === "string"
      ? [document.documentPath]
      : []
  );
};

const observationStillMatchesDocument = (
  observation: unknown,
  documentPath: string
): boolean => {
  const requested = canonicalizeObservationDocumentPath(documentPath);
  return observationDocumentPaths(observation).some(
    (path) => canonicalizeObservationDocumentPath(path) === requested
  );
};

type StaleDocument = {
  documentPath: string | null;
  documentVersion: number | null;
  canvasDocumentVersion: number | null;
  isCurrent: boolean | null;
  isStale: boolean | null;
};

const staleDocumentsFor = (observation: JsonObject): StaleDocument[] | null => {
  if (!Array.isArray(observation.documents)) return null;
  const stale: StaleDocument[] = [];

  for (const document of observation.documents) {
    if (!isObject(document)) return null;
    const canvas = document.canvas;
    if (canvas === null || canvas === undefined) continue;
    if (!isObject(canvas)) return null;

    const documentVersion = typeof document.documentVersion === "number" ? document.documentVersion : null;
    const canvasDocumentVersion = typeof canvas.documentVersion === "number" ? canvas.documentVersion : null;
    const isCurrent = typeof canvas.isCurrent === "boolean" ? canvas.isCurrent : null;
    const isStale = typeof canvas.isStale === "boolean" ? canvas.isStale : null;

    if (
      documentVersion === null ||
      canvasDocumentVersion === null ||
      canvasDocumentVersion !== documentVersion ||
      isCurrent !== true ||
      isStale !== false
    ) {
      stale.push({
        documentPath: typeof document.documentPath === "string" ? document.documentPath : null,
        documentVersion,
        canvasDocumentVersion,
        isCurrent,
        isStale
      });
    }
  }

  return stale;
};

const unavailableAfterResolution = (
  instance: VscodeObservationCandidateMetadata
): Record<string, unknown> => ({
  status: "unavailable",
  reason: "source-text-unavailable",
  instance
});

const staleAfterResolution = (
  instance: VscodeObservationCandidateMetadata,
  reason: "document-selection-changed-during-source-read"
): Record<string, unknown> => ({
  status: "stale",
  reason,
  instance
});

export const observeVscode = async (
  input: VscodeObserveInput,
  options: VscodeObserveOptions = {}
): Promise<Record<string, unknown>> => {
  const resolution = await resolveVscodeObservationInstance(
    {
      ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      ...(input.documentPath ? { documentPath: input.documentPath } : {})
    },
    options
  );

  if (resolution.kind === "not-found") {
    return {
      status: "unavailable",
      reason: resolution.reason,
      candidates: resolution.candidates
    };
  }

  if (resolution.kind === "ambiguous") {
    return {
      status: "ambiguous",
      reason: resolution.reason,
      candidates: resolution.candidates
    };
  }

  const instance = candidateMetadata(resolution.instance);
  let rawObservation = resolution.instance.observation;
  const needsStableSelectionProjection = observationNeedsStableSelectionProjection(rawObservation);
  const needsSourceText = input.includeSourceText === true || needsStableSelectionProjection;

  if (needsSourceText) {
    try {
      const sourceObservation = await requestVscodeObservation(
        resolution.instance.descriptor,
        {
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          includeSourceText: true
        }
      );
      if (sourceObservation === null) {
        return unavailableAfterResolution(instance);
      }
      rawObservation = sourceObservation;
    } catch {
      return unavailableAfterResolution(instance);
    }

    if (
      input.documentPath &&
      !input.instanceId &&
      !observationStillMatchesDocument(rawObservation, input.documentPath)
    ) {
      return staleAfterResolution(instance, "document-selection-changed-during-source-read");
    }
  }

  let observation: JsonObject | null;
  try {
    observation = projectObservation(rawObservation, input.includeSourceText === true);
  } catch {
    observation = null;
  }

  if (!observation) {
    return {
      status: "unavailable",
      reason: "invalid-observation",
      instance
    };
  }

  const staleDocuments = staleDocumentsFor(observation);
  if (staleDocuments === null) {
    return {
      status: "unavailable",
      reason: "invalid-observation",
      instance
    };
  }
  if (staleDocuments.length > 0) {
    return {
      status: "stale",
      reason: "runtime-snapshot-not-current",
      instance,
      staleDocuments
    };
  }

  return {
    status: "ok",
    instance,
    indexing: {
      sourceSelection: {
        line: "zero-based",
        character: "zero-based-UTF-16-code-unit"
      }
    },
    observation
  };
};
