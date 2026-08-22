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
  "unknown-function",
  "unknown-function-argument",
  "module-unresolved-callee",
  "module-unknown-argument"
] as const;

export type DslTypoSuggestionDiagnosticCode = typeof dslTypoSuggestionDiagnosticCodes[number];

export type DslTypoTargetKind =
  | "keyword"
  | "type"
  | "construction"
  | "constructionArgument"
  | "geometryReference"
  | "bindingReference"
  | "builtinCallable"
  | "builtinArgument"
  | "moduleCallee"
  | "moduleArgument";

const targetKindByDiagnosticCode: Record<DslTypoSuggestionDiagnosticCode, DslTypoTargetKind> = {
  "unknown-dsl-keyword": "keyword",
  "unknown-type": "type",
  "unknown-construction": "construction",
  "unknown-construction-argument": "constructionArgument",
  "undefined-geometry-reference": "geometryReference",
  "undefined-binding": "bindingReference",
  "unknown-function": "builtinCallable",
  "unknown-function-argument": "builtinArgument",
  "module-unresolved-callee": "moduleCallee",
  "module-unknown-argument": "moduleArgument"
};

export type DslTypoSuggestionCandidate = {
  kind: DslCompletionCandidateKind;
  label: string;
  identity?: string;
  distance: number;
  caseOnly: boolean;
};

export type DslTypoSuggestionQueryResult = {
  targetKind: DslTypoTargetKind;
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
  let completion = queryDslCompletion({
    source,
    position: diagnosticRange.to,
    semantic
  });

  // Line-head completion deliberately stops offering keywords once a statement
  // has additional terms. An exact-current unknown-keyword diagnostic still
  // proves the misspelled head token, so project only that token through the
  // same canonical completion query. The projected query owns keyword spelling;
  // the exact diagnostic owns the physical replacement range.
  if (!completion && diagnostic.code === "unknown-dsl-keyword") {
    const keywordText = source.normalizedSource.slice(diagnosticRange.from, diagnosticRange.to);
    const projected = queryDslCompletion({
      source: { normalizedSource: keywordText, sourceRevision: source.sourceRevision },
      position: keywordText.length
    });
    if (
      projected?.category === "keyword" &&
      projected.replacementRange.from === 0 &&
      projected.replacementRange.to === keywordText.length
    ) {
      completion = { ...projected, replacementRange: diagnosticRange };
    }
  }

  // Construction completion uses the authored prefix to decide whether the
  // cursor is still a construction slot. A spelling error is intentionally not
  // a valid prefix, so erase only the exact diagnosed token in a projection and
  // ask the same completion authority for the category's unfiltered set.
  if (!completion && diagnostic.code === "unknown-construction") {
    const projectedText =
      source.normalizedSource.slice(0, diagnosticRange.from) +
      source.normalizedSource.slice(diagnosticRange.to);
    const projected = queryDslCompletion({
      source: { normalizedSource: projectedText, sourceRevision: source.sourceRevision },
      position: diagnosticRange.from
    });
    if (
      projected?.category === "construction" &&
      projected.replacementRange.from === diagnosticRange.from &&
      projected.replacementRange.to === diagnosticRange.from
    ) {
      completion = { ...projected, replacementRange: diagnosticRange };
    }
  }

  if (!completion || !containsRange(diagnosticRange, completion.replacementRange)) return null;
  if (completion.replacementRange.from >= completion.replacementRange.to) return null;

  const typedText = source.normalizedSource.slice(
    completion.replacementRange.from,
    completion.replacementRange.to
  );
  if (!typedText) return null;

  const rankedCandidates = completion.candidates
    .flatMap((candidate, sourceIndex) => {
      const match = matchDslTypoCandidate(typedText, candidate.label, sourceIndex);
      return match ? [{ candidate, match }] : [];
    })
    .sort((left, right) => left.match.distance - right.match.distance || left.match.sourceIndex - right.match.sourceIndex);

  const candidates: DslTypoSuggestionCandidate[] = rankedCandidates.map(({ candidate, match }) => ({
    kind: candidate.kind,
    label: candidate.label,
    ...(candidate.identity ? { identity: candidate.identity } : {}),
    distance: match.distance,
    caseOnly: match.caseOnly
  }));

  return {
    targetKind: targetKindByDiagnosticCode[diagnostic.code],
    typedText,
    replacementRange: completion.replacementRange,
    candidates
  };
};
