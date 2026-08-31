import {
  coordinatePointConversionBaseCandidates,
  coordinatePointConversionTargetEligibility,
  type CoordinatePointConversionBaseCandidate,
  type CoordinatePointConversionMode,
  type CoordinatePointConversionSnapshot,
  type CoordinatePointConversionSkip,
  type CoordinatePointConversionTarget
} from "./coordinatePointConversion";
import { sourceReferenceText } from "../model/moduleSemanticCandidateBoundary";
import { pickRefKey, type PickRef } from "../model/pickReferences";
import type { ReferenceSuggestion } from "../model/referenceSuggestions";
import type { ElementId } from "../types/geometry";

export type CoordinatePointConversionSessionOrigin = "source" | "canvas" | "explorer";

export type CoordinatePointConversionSession = {
  requestId: number;
  documentUri: string;
  documentVersion: number;
  mode: CoordinatePointConversionMode;
  origin: CoordinatePointConversionSessionOrigin;
  targetIds: readonly ElementId[];
  sourceText: string;
  sourceRevision: number;
  targets: readonly CoordinatePointConversionTarget[];
  baseCandidates: readonly CoordinatePointConversionBaseCandidate[];
  selectedBaseKey: string | null;
  query: string;
  status: "active" | "applying";
  error: CoordinatePointConversionSkip["reason"] | null;
};

export type StartCoordinatePointConversionSessionInput = {
  requestId: number;
  documentUri: string;
  documentVersion: number;
  mode: CoordinatePointConversionMode;
  origin: CoordinatePointConversionSessionOrigin;
  targetIds: readonly ElementId[];
  snapshot: CoordinatePointConversionSnapshot;
};

export type StartCoordinatePointConversionSessionResult =
  | { status: "started"; session: CoordinatePointConversionSession }
  | { status: "rejected"; reason: CoordinatePointConversionSkip["reason"] };

const unique = (ids: readonly ElementId[]) => [...new Set(ids)];

const firstTargetReason = (
  snapshot: CoordinatePointConversionSnapshot,
  targetIds: readonly ElementId[]
): CoordinatePointConversionSkip["reason"] => {
  for (const targetId of unique(targetIds)) {
    const eligibility = coordinatePointConversionTargetEligibility(snapshot, targetId);
    if (!eligibility.eligible) return eligibility.reason;
  }
  return {
    code: "target-not-found",
    message: "変換対象が選択されていません。"
  };
};

export const startCoordinatePointConversionSession = ({
  requestId,
  documentUri,
  documentVersion,
  mode,
  origin,
  targetIds,
  snapshot
}: StartCoordinatePointConversionSessionInput): StartCoordinatePointConversionSessionResult => {
  const uniqueTargetIds = unique(targetIds);
  const targets = uniqueTargetIds
    .map((targetId) => coordinatePointConversionTargetEligibility(snapshot, targetId))
    .flatMap((result) => result.eligible ? [result.target] : []);
  if (targets.length === 0) {
    return { status: "rejected", reason: firstTargetReason(snapshot, uniqueTargetIds) };
  }

  const baseCandidates = coordinatePointConversionBaseCandidates({
    snapshot,
    targetIds: uniqueTargetIds
  });
  if (baseCandidates.length === 0) {
    return {
      status: "rejected",
      reason: {
        code: "base-not-candidate",
        message: "全対象に共通する合法な基準点がありません。"
      }
    };
  }

  return {
    status: "started",
    session: {
      requestId,
      documentUri,
      documentVersion,
      mode,
      origin,
      targetIds: uniqueTargetIds,
      sourceText: snapshot.document.sourceText,
      sourceRevision: snapshot.document.doc.statementMap.sourceRevision,
      targets,
      baseCandidates,
      selectedBaseKey: null,
      query: "",
      status: "active",
      error: null
    }
  };
};

export const setCoordinatePointConversionQuery = (
  session: CoordinatePointConversionSession,
  query: string
): CoordinatePointConversionSession => ({ ...session, query, error: null });

export const selectCoordinatePointConversionBase = (
  session: CoordinatePointConversionSession,
  baseKey: string
): CoordinatePointConversionSession => {
  const candidate = session.baseCandidates.find((item) => item.key === baseKey);
  if (!candidate) return session;
  const reference = session.targetIds
    .map((targetId) => candidate.referencesByTargetId.get(targetId))
    .find((value) => value !== undefined);
  return {
    ...session,
    selectedBaseKey: baseKey,
    query: sourceReferenceText(reference ?? null) ?? baseKey,
    error: null
  };
};

export const coordinatePointConversionSelectedBase = (
  session: CoordinatePointConversionSession
): CoordinatePointConversionBaseCandidate | null =>
  session.baseCandidates.find((candidate) => candidate.key === session.selectedBaseKey) ?? null;

export type CoordinatePointConversionBaseSuggestion = {
  key: string;
  canonicalToken: string;
  displayLabel: string;
  detail: string;
  aliases: readonly string[];
  point: CoordinatePointConversionBaseCandidate["point"];
};

const normalized = (value: string): string => value.normalize("NFKC").toLocaleLowerCase();

const suggestionFor = (
  session: CoordinatePointConversionSession,
  candidate: CoordinatePointConversionBaseCandidate
): CoordinatePointConversionBaseSuggestion | null => {
  const reference = session.targetIds
    .map((targetId) => candidate.referencesByTargetId.get(targetId))
    .find((value) => value !== undefined);
  const canonicalToken = sourceReferenceText(reference ?? null);
  if (!canonicalToken) return null;
  const aliases = [canonicalToken, canonicalToken.replace(/^@/, ""), candidate.key, candidate.sourceElementId]
    .filter((value) => value.length > 0);
  return {
    key: candidate.key,
    canonicalToken,
    displayLabel: canonicalToken,
    detail: `${candidate.point.x}, ${candidate.point.y} mm`,
    aliases,
    point: candidate.point
  };
};

export const coordinatePointConversionBaseSuggestions = (
  session: CoordinatePointConversionSession,
  query = session.query,
  limit = 8
): CoordinatePointConversionBaseSuggestion[] => {
  const needle = normalized(query.trim());
  if (!needle) return [];
  return session.baseCandidates
    .map((candidate) => suggestionFor(session, candidate))
    .filter((suggestion): suggestion is CoordinatePointConversionBaseSuggestion => suggestion !== null)
    .map((suggestion, documentOrder) => {
      const aliases = suggestion.aliases.map(normalized);
      const score = aliases.some((alias) => alias === needle)
        ? 0
        : aliases.some((alias) => alias.startsWith(needle))
          ? 1
          : aliases.some((alias) => alias.includes(needle))
            ? 2
            : null;
      return { suggestion, documentOrder, score };
    })
    .filter((item): item is typeof item & { score: number } => item.score !== null)
    .sort((left, right) => left.score - right.score || left.documentOrder - right.documentOrder)
    .slice(0, limit)
    .map((item) => item.suggestion);
};

export const coordinatePointConversionBaseForInput = (
  session: CoordinatePointConversionSession,
  input: string
): CoordinatePointConversionBaseCandidate | null => {
  const normalizedInput = normalized(input.trim());
  if (!normalizedInput) return null;
  return session.baseCandidates.find((candidate) => {
    const reference = session.targetIds
      .map((targetId) => candidate.referencesByTargetId.get(targetId))
      .find((value) => value !== undefined);
    const token = sourceReferenceText(reference ?? null);
    if (!token) return false;
    const normalizedToken = normalized(token);
    return normalizedToken === normalizedInput || normalizedToken.replace(/^@/, "") === normalizedInput.replace(/^@/, "");
  }) ?? null;
};

/** Adapts conversion-owned bases to the shared searchable reference surface. */
export type CoordinatePointConversionReferenceSuggestion = ReferenceSuggestion & {
  baseKey: string;
};

export const coordinatePointConversionReferenceSuggestions = (
  session: CoordinatePointConversionSession
): CoordinatePointConversionReferenceSuggestion[] => session.baseCandidates.flatMap((candidate) => {
  const reference = session.targetIds
    .map((targetId) => candidate.referencesByTargetId.get(targetId))
    .find((value) => value !== undefined);
  const canonicalToken = sourceReferenceText(reference ?? null);
  if (!canonicalToken || candidate.anchor.mode === "coordinate") return [];
  const pickRef: PickRef = candidate.anchor.mode === "reference"
    ? {
        kind: "point:reference",
        candidateElementId: candidate.sourceElementId,
        pointId: candidate.anchor.pointId
      }
    : {
        kind: "point:derived",
        candidateElementId: candidate.sourceElementId,
        elementId: candidate.anchor.elementId,
        pointKey: candidate.anchor.pointKey
      };
  return [{
    baseKey: candidate.key,
    pickRef,
    referenceElementId: candidate.sourceElementId,
    pickRefKey: pickRefKey(pickRef),
    displayLabel: canonicalToken,
    canonicalToken,
    searchAliases: [
      canonicalToken,
      canonicalToken.replace(/^@/, ""),
      candidate.key,
      candidate.sourceElementId
    ].filter((value) => value.length > 0),
    detail: `${candidate.point.x}, ${candidate.point.y} mm`
  }];
});
