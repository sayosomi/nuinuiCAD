import {
  queryDslCompletion,
  type DslCompletionCandidateKind,
  type DslCompletionRange,
  type DslCompletionSemanticSnapshot
} from "./dslCompletionQuery";
import { matchDslTypoCandidate } from "./dslTypoMatcher";
import type { SourceSnapshot } from "./logicalStatementSourceMap";
import type { DslDiagnostic } from "./dslTypes";

export const dslTypoSuggestionDiagnosticCodes = [
  "unknown-dsl-keyword",
  "unknown-type",
  "unknown-construction",
  "unknown-construction-argument",
  "undefined-geometry-reference",
  "undefined-binding",
  "module-unresolved-callee",
  "module-unknown-argument",
  "module-undefined-reference",
  "module-undefined-geometry-reference",
  "module-undefined-export"
] as const;

export type DslTypoSuggestionDiagnosticCode = typeof dslTypoSuggestionDiagnosticCodes[number];

export type DslTypoSuggestionCandidate = {
  kind: DslCompletionCandidateKind;
  label: string;
  identity?: string;
  distance: number;
  caseOnly: boolean;
};

export type DslTypoSuggestionQueryResult = {
  typedText: string;
  replacementRange: DslCompletionRange;
  candidates: readonly DslTypoSuggestionCandidate[];
};

export type DslTypoSuggestionQueryInput = {
  source: SourceSnapshot;
  diagnostic: DslDiagnostic;
  semantic: DslCompletionSemanticSnapshot;
};

const eligibleDiagnosticCodes = new Set<string>(dslTypoSuggestionDiagnosticCodes);

export const isDslTypoSuggestionDiagnosticCode = (
  code: string | undefined
): code is DslTypoSuggestionDiagnosticCode => Boolean(code && eligibleDiagnosticCodes.has(code));

const semanticSourceText = (semantic: DslCompletionSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (
  source: SourceSnapshot,
  semantic: DslCompletionSemanticSnapshot
) => semantic.sourceRevision === source.sourceRevision && semanticSourceText(semantic) === source.normalizedSource;

const containsRange = (
  outer: { from: number; to: number },
  inner: { from: number; to: number }
) => inner.from >= outer.from && inner.to <= outer.to;

/**
 * Query typo corrections from the same canonical candidate authority used by
 * source completion. This query is exact-current only: unlike ordinary
 * completion it never falls back to syntax-only candidates when the semantic
 * snapshot or diagnostic proof is stale.
 */
export const queryDslTypoSuggestions = ({
  source,
  diagnostic,
  semantic
}: DslTypoSuggestionQueryInput): DslTypoSuggestionQueryResult | null => {
  if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) return null;
  if (diagnostic.exactSpanOnly !== true || !semanticIsExact(source, semantic)) return null;
  if (diagnostic.sourceRevision !== undefined && diagnostic.sourceRevision !== source.sourceRevision) return null;

  const segments = diagnostic.physicalSpan?.segments;
  if (!segments || segments.length !== 1 || diagnostic.physicalSpan?.sourceRevision !== source.sourceRevision) return null;
  const [diagnosticRange] = segments;
  if (
    !diagnosticRange ||
    diagnosticRange.from < 0 ||
    diagnosticRange.to > source.normalizedSource.length ||
    diagnosticRange.from >= diagnosticRange.to
  ) return null;

  // The diagnostic span may include source syntax which completion deliberately
  // keeps outside its edit range (for example the leading `@` of a binding
  // reference). The completion-owned range is therefore authoritative as long
  // as it remains wholly inside the exact diagnostic token.
  const completion = queryDslCompletion({
    source,
    position: diagnosticRange.to,
    semantic
  });
  if (!completion || !containsRange(diagnosticRange, completion.replacementRange)) return null;
  if (completion.replacementRange.from >= completion.replacementRange.to) return null;

  const typedText = source.normalizedSource.slice(
    completion.replacementRange.from,
    completion.replacementRange.to
  );
  if (!typedText) return null;

  const candidates = completion.candidates
    .flatMap((candidate, sourceIndex) => {
      const match = matchDslTypoCandidate(typedText, candidate.label, sourceIndex);
      return match
        ? [{
            kind: candidate.kind,
            label: candidate.label,
            ...(candidate.identity ? { identity: candidate.identity } : {}),
            distance: match.distance,
            caseOnly: match.caseOnly,
            sourceIndex
          }]
        : [];
    })
    .sort((left, right) => left.distance - right.distance || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex: _sourceIndex, ...candidate }) => candidate);

  return {
    typedText,
    replacementRange: completion.replacementRange,
    candidates
  };
};
