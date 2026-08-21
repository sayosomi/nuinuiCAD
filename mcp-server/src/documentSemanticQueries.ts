import { queryDslDefinition } from "../../src/dsl/dslDefinitionQuery";
import { queryDslReferences } from "../../src/dsl/dslReferencesQuery";
import {
  loadFreshNuiDocumentSnapshot,
  SOURCE_POSITION_INDEXING,
  sourceRangeDtoFromOffsets,
  type FreshNuiDocumentSnapshot,
  type SourceRangeDto
} from "./documentSnapshot";

export type SemanticQueryIndexingDto = typeof SOURCE_POSITION_INDEXING;

export type DocumentSemanticQueryBaseDto = {
  path: string;
  sourceIdentity: FreshNuiDocumentSnapshot["sourceIdentity"];
  indexing: SemanticQueryIndexingDto;
  status: "resolved" | "no-result" | "unavailable";
  reason?: "current-semantics-unavailable";
};

export type DocumentDefinitionDto = DocumentSemanticQueryBaseDto & {
  referenceRange?: SourceRangeDto;
  declarationRange?: SourceRangeDto;
};

export type DocumentReferencesDto = DocumentSemanticQueryBaseDto & {
  declarationRange?: SourceRangeDto;
  referenceRanges?: SourceRangeDto[];
};

const baseResult = (
  snapshot: FreshNuiDocumentSnapshot
): Omit<DocumentSemanticQueryBaseDto, "status" | "reason"> => ({
  path: snapshot.path,
  sourceIdentity: snapshot.sourceIdentity,
  indexing: SOURCE_POSITION_INDEXING
});

const semanticFor = (snapshot: FreshNuiDocumentSnapshot) => ({
  sourceRevision: snapshot.source.sourceRevision,
  sourceText: snapshot.source.normalizedSource,
  compiled: snapshot.currentCompiled
});

export const queryNuiDocumentDefinition = async (
  requestedPath: string,
  position: number
): Promise<DocumentDefinitionDto> => {
  const snapshot = await loadFreshNuiDocumentSnapshot(requestedPath, "document_definition");
  const base = baseResult(snapshot);
  if (!snapshot.currentSemanticsAvailable) {
    return {
      ...base,
      status: "unavailable",
      reason: "current-semantics-unavailable"
    };
  }

  const result = queryDslDefinition({
    source: snapshot.source,
    position,
    semantic: semanticFor(snapshot)
  });
  if (!result) return { ...base, status: "no-result" };

  return {
    ...base,
    status: "resolved",
    referenceRange: sourceRangeDtoFromOffsets(snapshot, result.referenceRange),
    declarationRange: sourceRangeDtoFromOffsets(snapshot, result.declarationRange)
  };
};

export const queryNuiDocumentReferences = async (
  requestedPath: string,
  position: number
): Promise<DocumentReferencesDto> => {
  const snapshot = await loadFreshNuiDocumentSnapshot(requestedPath, "document_references");
  const base = baseResult(snapshot);
  if (!snapshot.currentSemanticsAvailable) {
    return {
      ...base,
      status: "unavailable",
      reason: "current-semantics-unavailable"
    };
  }

  const result = queryDslReferences({
    source: snapshot.source,
    position,
    semantic: semanticFor(snapshot)
  });
  if (!result) return { ...base, status: "no-result" };

  return {
    ...base,
    status: "resolved",
    declarationRange: sourceRangeDtoFromOffsets(snapshot, result.declarationRange),
    referenceRanges: result.referenceRanges.map((range) => sourceRangeDtoFromOffsets(snapshot, range))
  };
};
