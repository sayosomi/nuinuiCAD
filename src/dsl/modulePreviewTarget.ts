import type { StatementIdentity } from "../document/statementIdentity";
import type { CompiledDslDocument, StatementInfo } from "./dslDocument";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import type { ModuleDefinitionSemantic } from "./moduleSemanticTypes";

export type ModulePreviewTargetSemanticSnapshot = {
  sourceRevision: SourceRevision;
  /** Optional exact source proof. When omitted, the compiled source map is authoritative. */
  sourceText?: string;
  compiled?: CompiledDslDocument;
};

export type ModulePreviewTargetQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: ModulePreviewTargetSemanticSnapshot;
};

export type ModulePreviewTarget = {
  definitionStatementId: StatementIdentity;
  definitionStatementIndex: number;
  name: string;
};

const semanticSourceText = (semantic: ModulePreviewTargetSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (
  source: SourceSnapshot,
  semantic: ModulePreviewTargetSemanticSnapshot | undefined
) => {
  if (!semantic || semantic.sourceRevision !== source.sourceRevision) return false;
  if (semanticSourceText(semantic) !== source.normalizedSource) return false;
  return !semantic.compiled || (
    semantic.compiled.spans.sourceMap.source === source.normalizedSource &&
    semantic.compiled.spans.sourceMap.sourceRevision === source.sourceRevision
  );
};

const statementAtPosition = (
  compiled: CompiledDslDocument,
  position: number
) => compiled.statements.find((statement) =>
  statement.documentRange.sourceRevision === compiled.spans.sourceMap.sourceRevision &&
  position >= statement.documentRange.from &&
  position <= statement.documentRange.to
);

const definitionFromStatementAncestry = (
  compiled: CompiledDslDocument,
  statementIndex: number
): ModuleDefinitionSemantic | null => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return null;

  let currentIndex: number | null = statementIndex;
  while (currentIndex !== null) {
    const statement = compiled.statements[currentIndex];
    if (!statement) return null;
    if (statement.kind === "moduleDefinition") {
      const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(currentIndex);
      if (statementId) {
        const definition = analysis.definitionsByStatementId.get(statementId);
        if (definition?.statementIndex === currentIndex) return definition;
      }
      const definition = analysis.definitions.find((candidate) => candidate.statementIndex === currentIndex);
      if (definition) return definition;
      return null;
    }
    currentIndex = statement.enclosing?.statementIndex ?? null;
  }
  return null;
};

const sourceLineAt = (source: string, position: number) => {
  let line = 1;
  for (let index = 0; index < position; index += 1) if (source[index] === "\n") line += 1;
  return line;
};

const definitionFromStatementMapRange = (
  compiled: CompiledDslDocument,
  line: number
): ModuleDefinitionSemantic | null => {
  const analysis = compiled.moduleSemanticAnalysis;
  const statementMap = compiled.statementMap;
  if (!analysis || !statementMap) return null;

  let winner: { definition: ModuleDefinitionSemantic; info: StatementInfo } | null = null;
  for (const definition of analysis.definitions) {
    const info = statementMap.statementRangeById.get(definition.statementId);
    if (!info || line < info.range.startLine || line > info.range.endLine) continue;
    if (!winner) {
      winner = { definition, info };
      continue;
    }
    const winnerSpan = winner.info.range.endLine - winner.info.range.startLine;
    const candidateSpan = info.range.endLine - info.range.startLine;
    if (
      candidateSpan < winnerSpan ||
      (candidateSpan === winnerSpan && info.range.startLine >= winner.info.range.startLine)
    ) {
      winner = { definition, info };
    }
  }
  return winner?.definition ?? null;
};

/**
 * Resolve the exact current Module definition containing a source position.
 *
 * The query is deliberately host-neutral and exact-or-nothing. It never falls
 * back to a display name, and a stale semantic snapshot cannot select a Module.
 * A successful StatementMap gives full block coverage (including blank/closing
 * lines); when unrelated diagnostics prevent StatementMap construction, a real
 * parsed statement inside the selected Module can still resolve through its
 * structural ancestry.
 */
export const queryModulePreviewTarget = ({
  source,
  position,
  semantic
}: ModulePreviewTargetQueryInput): ModulePreviewTarget | null => {
  if (
    source.normalizedSource.includes("\r") ||
    position < 0 ||
    position > source.normalizedSource.length ||
    !semanticIsExact(source, semantic) ||
    !semantic?.compiled?.moduleSemanticAnalysis
  ) return null;

  const compiled = semantic.compiled;
  const directStatement = statementAtPosition(compiled, position);
  const definition = directStatement
    ? definitionFromStatementAncestry(compiled, compiled.statements.indexOf(directStatement))
    : definitionFromStatementMapRange(compiled, sourceLineAt(source.normalizedSource, position));
  if (!definition) return null;

  const statement = compiled.statements[definition.statementIndex];
  if (
    !statement ||
    statement.kind !== "moduleDefinition" ||
    statement.sourceRevision !== source.sourceRevision
  ) return null;

  return {
    definitionStatementId: definition.statementId,
    definitionStatementIndex: definition.statementIndex,
    name: definition.name
  };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
