import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticDeclarationRange,
  dslSemanticOccurrenceAt
} from "./dslSemanticOccurrenceIndex";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";

export type DslDefinitionRange = { from: number; to: number };

export type DslDefinitionSemanticSnapshot = {
  /** Source revision that produced this semantic snapshot. */
  sourceRevision: SourceRevision;
  /** Optional exact source proof. When omitted, compiled.spans.sourceMap.source is used. */
  sourceText?: string;
  /** Production source semantics for the exact source snapshot. */
  compiled?: CompiledDslDocument;
  /** Optional explicit binding analysis for callers that already hold it. */
  bindingAnalysis?: BindingAnalysis;
};

export type DslDefinitionQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslDefinitionSemanticSnapshot;
};

export type DslDefinitionQueryResult = {
  /** Exact source range of the reference identifier, excluding `@`. */
  referenceRange: DslDefinitionRange;
  /** Exact source range of the resolved declaration identifier. */
  declarationRange: DslDefinitionRange;
};

const semanticSourceText = (semantic: DslDefinitionSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (source: SourceSnapshot, semantic: DslDefinitionSemanticSnapshot | undefined) => {
  if (!semantic || semantic.sourceRevision !== source.sourceRevision) return false;
  if (semanticSourceText(semantic) !== source.normalizedSource) return false;
  // An explicit sourceText is useful as a proof carried beside a semantic
  // result, but it cannot make a compiled source map from a different source
  // safe for source-range projection.
  return !semantic.compiled || (
    semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
    semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
  );
};

/** Query a resolved DSL reference without importing VS Code, CodeMirror, or Tauri. */
export const queryDslDefinition = ({ source, position, semantic }: DslDefinitionQueryInput): DslDefinitionQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  if (!semanticIsExact(source, semantic) || !semantic?.compiled) return null;

  const occurrenceIndex = createDslSemanticOccurrenceIndex(
    semantic.compiled,
    semantic.bindingAnalysis ?? semantic.compiled.bindingAnalysis
  );
  const occurrence = dslSemanticOccurrenceAt(occurrenceIndex, position);
  if (!occurrence || occurrence.kind !== "reference") return null;
  const declarationRange = dslSemanticDeclarationRange(occurrenceIndex, occurrence.identity);
  if (!declarationRange || (declarationRange.from === occurrence.from && declarationRange.to === occurrence.to)) return null;
  return {
    referenceRange: { from: occurrence.from, to: occurrence.to },
    declarationRange
  };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
