import type { StatementIdentity } from "../document/statementIdentity";
import type { CompiledDslDocument, StatementInfo } from "./dslDocument";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import type { DslStatement } from "./dslTypes";

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

const definitionAtIndex = (
  compiled: CompiledDslDocument,
  statementIndex: number
): ModulePreviewTarget | null => {
  const statement = compiled.statements[statementIndex];
  if (statement?.kind !== "moduleDefinition") return null;

  const semantic = compiled.moduleSemanticAnalysis?.definitions.find(
    (candidate) => candidate.statementIndex === statementIndex
  );
  if (semantic) {
    return {
      definitionStatementId: semantic.statementId,
      definitionStatementIndex: semantic.statementIndex,
      name: semantic.name
    };
  }

  const declaration = compiled.sourceLexicalNamespace?.allDeclarations.find(
    (candidate) => candidate.kind === "moduleDefinition" && candidate.statementIndex === statementIndex
  );
  if (!declaration) return null;
  return {
    definitionStatementId: declaration.statementId,
    definitionStatementIndex: declaration.statementIndex,
    name: declaration.name
  };
};

const definitionFromStatementAncestry = (
  compiled: CompiledDslDocument,
  statementIndex: number
): ModulePreviewTarget | null => {
  let currentIndex: number | null = statementIndex;
  while (currentIndex !== null) {
    const statement: DslStatement | undefined = compiled.statements[currentIndex];
    if (!statement) return null;
    const definition = definitionAtIndex(compiled, currentIndex);
    if (definition) return definition;
    currentIndex = statement.enclosing?.statementIndex ?? null;
  }
  return null;
};

const sourceLineAt = (source: string, position: number) => {
  let line = 1;
  for (let index = 0; index < position; index += 1) if (source[index] === "\n") line += 1;
  return line;
};

const definitionCandidates = (compiled: CompiledDslDocument): ModulePreviewTarget[] => {
  const byStatementIndex = new Map<number, ModulePreviewTarget>();
  for (const definition of compiled.moduleSemanticAnalysis?.definitions ?? []) {
    byStatementIndex.set(definition.statementIndex, {
      definitionStatementId: definition.statementId,
      definitionStatementIndex: definition.statementIndex,
      name: definition.name
    });
  }
  for (const declaration of compiled.sourceLexicalNamespace?.allDeclarations ?? []) {
    if (declaration.kind !== "moduleDefinition" || byStatementIndex.has(declaration.statementIndex)) continue;
    byStatementIndex.set(declaration.statementIndex, {
      definitionStatementId: declaration.statementId,
      definitionStatementIndex: declaration.statementIndex,
      name: declaration.name
    });
  }
  return [...byStatementIndex.values()];
};

const definitionFromStatementMapRange = (
  compiled: CompiledDslDocument,
  line: number
): ModulePreviewTarget | null => {
  const statementMap = compiled.statementMap;
  if (!statementMap) return null;

  let winner: { definition: ModulePreviewTarget; info: StatementInfo } | null = null;
  for (const definition of definitionCandidates(compiled)) {
    const info = statementMap.statementRangeById.get(definition.definitionStatementId);
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
 * structural ancestry and source-namespace identity.
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
    !semantic?.compiled
  ) return null;

  const compiled = semantic.compiled;
  const directStatement = statementAtPosition(compiled, position);
  const definition = directStatement
    ? definitionFromStatementAncestry(compiled, compiled.statements.indexOf(directStatement))
    : definitionFromStatementMapRange(compiled, sourceLineAt(source.normalizedSource, position));
  if (!definition) return null;

  const statement = compiled.statements[definition.definitionStatementIndex];
  if (
    !statement ||
    statement.kind !== "moduleDefinition" ||
    statement.sourceRevision !== source.sourceRevision
  ) return null;

  return definition;
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
