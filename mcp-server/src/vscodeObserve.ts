import {
  canonicalizeObservationDocumentPath,
  requestVscodeObservation,
  resolveVscodeObservationInstance,
  type VscodeObservationCandidateMetadata,
  type VscodeObservationDiscoveryOptions,
  type VscodeObservationLiveInstance
} from "../../src/node/vscodeObservationBridge";

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

const projectObservation = (
  observation: unknown,
  includeSourceText: boolean
): JsonObject | null => {
  const copied = jsonFriendlyCopy(observation);
  if (!isObject(copied) || !Array.isArray(copied.documents)) return null;

  const documents = copied.documents.map((document) => {
    if (!isObject(document)) return document;
    if (includeSourceText) return document;
    const withoutSourceText = { ...document };
    delete withoutSourceText.sourceText;
    return withoutSourceText;
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

  if (input.includeSourceText === true) {
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
