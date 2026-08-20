import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticDeclarationRange,
  dslSemanticOccurrenceAt,
  dslSemanticIdentityKey,
  type DslSemanticRange
} from "./dslSemanticOccurrenceIndex";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";

export type DslReferencesSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
  bindingAnalysis?: BindingAnalysis;
};

export type DslReferencesQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslReferencesSemanticSnapshot;
};

export type DslReferencesQueryResult = {
  declarationRange: DslSemanticRange;
  referenceRanges: readonly DslSemanticRange[];
};

const semanticSourceText = (semantic: DslReferencesSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (source: SourceSnapshot, semantic: DslReferencesSemanticSnapshot | undefined) => {
  if (!semantic || semantic.sourceRevision !== source.sourceRevision) return false;
  if (semanticSourceText(semantic) !== source.normalizedSource) return false;
  return !semantic.compiled || (
    semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
    semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
  );
};

/**
 * Return all same-document usages of the compiler-resolved identity at a
 * source position. This query deliberately does not inspect diagnostics:
 * unrelated current-document errors do not invalidate a proven occurrence.
 */
export const queryDslReferences = ({ source, position, semantic }: DslReferencesQueryInput): DslReferencesQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  if (!semanticIsExact(source, semantic) || !semantic?.compiled) return null;

  const occurrenceIndex = createDslSemanticOccurrenceIndex(
    semantic.compiled,
    semantic.bindingAnalysis ?? semantic.compiled.bindingAnalysis
  );
  const selected = dslSemanticOccurrenceAt(occurrenceIndex, position);
  if (!selected) return null;
  const declarationRange = dslSemanticDeclarationRange(occurrenceIndex, selected.identity);
  if (!declarationRange) return null;

  const identityKey = dslSemanticIdentityKey(selected.identity);
  const referenceRanges: DslSemanticRange[] = [];
  const seen = new Set<string>();
  for (const occurrence of occurrenceIndex.occurrences) {
    if (occurrence.kind !== "reference" || dslSemanticIdentityKey(occurrence.identity) !== identityKey) continue;
    const key = `${occurrence.from}:${occurrence.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    referenceRanges.push({ from: occurrence.from, to: occurrence.to });
  }
  referenceRanges.sort((left, right) => left.from - right.from || left.to - right.to);
  return { declarationRange, referenceRanges };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
