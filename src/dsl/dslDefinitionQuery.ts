import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticDeclarationRange,
  dslSemanticIdentityKey,
  dslSemanticOccurrenceAt,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
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
  return !semantic.compiled || (
    semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
    semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
  );
};

const shorthandLabelIdentityKey = (
  compiled: CompiledDslDocument,
  from: number,
  to: number
): string | null => {
  const statementIndex = compiled.statements.findIndex((statement) =>
    statement.physicalSpan.segments.some((segment) => from >= segment.from && from <= segment.to)
  );
  const statement = compiled.statements[statementIndex];
  const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) => candidate.statementIndex === statementIndex);
  if (statement?.kind !== "moduleInstance" || !instance?.callee) return null;
  const argumentIndex = statement.arguments.findIndex((argument) => {
    const physical = argument.labelPhysicalSpan?.segments;
    return physical?.length === 1 && physical[0]?.from === from && physical[0]?.to === to;
  });
  if (argumentIndex < 0) return null;
  const binding = instance.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  if (!binding) return null;
  return dslSemanticIdentityKey({
    kind: "module",
    target: {
      kind: "moduleParameter",
      slot: {
        definitionStatementId: instance.callee.definitionStatementId,
        parameterIndex: binding.parameterIndex
      }
    }
  });
};

const shorthandValueOccurrenceAt = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  position: number
): DslSemanticOccurrence | null => {
  const matches = index.occurrences
    .filter((occurrence) => occurrence.kind === "reference" && occurrence.from <= position && position <= occurrence.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from) || left.from - right.from || left.to - right.to);
  if (matches.length === 0) return null;
  const shortest = matches[0]!.to - matches[0]!.from;
  const shortestMatches = matches.filter((occurrence) => occurrence.to - occurrence.from === shortest);
  const labelIdentityKey = shorthandLabelIdentityKey(compiled, shortestMatches[0]!.from, shortestMatches[0]!.to);
  if (!labelIdentityKey) return null;
  const valueMatches = shortestMatches.filter((occurrence) =>
    dslSemanticIdentityKey(occurrence.identity) !== labelIdentityKey
  );
  const identities = new Set(valueMatches.map((occurrence) => dslSemanticIdentityKey(occurrence.identity)));
  return identities.size === 1 ? valueMatches[0] ?? null : null;
};

/** Query a resolved DSL reference without importing VS Code, CodeMirror, or Tauri. */
export const queryDslDefinition = ({ source, position, semantic }: DslDefinitionQueryInput): DslDefinitionQueryResult | null => {
  if (source.normalizedSource.includes("\r") || position < 0 || position > source.normalizedSource.length) return null;
  if (!semanticIsExact(source, semantic) || !semantic?.compiled) return null;

  const occurrenceIndex = createDslSemanticOccurrenceIndex(
    semantic.compiled,
    semantic.bindingAnalysis ?? semantic.compiled.bindingAnalysis
  );
  const occurrence = dslSemanticOccurrenceAt(occurrenceIndex, position) ?? shorthandValueOccurrenceAt(semantic.compiled, occurrenceIndex, position);
  if (!occurrence || occurrence.kind !== "reference") return null;
  const declarationRange = dslSemanticDeclarationRange(occurrenceIndex, occurrence.identity);
  if (!declarationRange || (declarationRange.from === occurrence.from && declarationRange.to === occurrence.to)) return null;
  return {
    referenceRange: { from: occurrence.from, to: occurrence.to },
    declarationRange
  };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";