import type { StatementIdentity } from "../document/statementIdentity";
import {
  queryModulePreviewTarget,
  type ModulePreviewTarget,
  type ModulePreviewTargetSemanticSnapshot,
  type SourceSnapshot
} from "../dsl/modulePreviewTarget";

export type CurrentModulePreviewTarget = {
  target: ModulePreviewTarget;
  normalizedSourceOffset: number;
};

const statementIndexForIdentity = (
  semantic: ModulePreviewTargetSemanticSnapshot,
  definitionStatementId: StatementIdentity
): number | null => {
  const compiled = semantic.compiled;
  if (!compiled) return null;
  const mapped = compiled.statementMap?.statementIndexByStatementId?.get(definitionStatementId);
  if (mapped !== undefined) return mapped;
  const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(definitionStatementId);
  if (definition) return definition.statementIndex;
  const declaration = compiled.sourceLexicalNamespace?.allDeclarations.find(
    (candidate) => candidate.kind === "moduleDefinition" && candidate.statementId === definitionStatementId
  );
  return declaration?.statementIndex ?? null;
};

/**
 * Refresh an already-open Module Preview by stable definition identity.
 * Identity lookup only chooses the source position; SAY-171's exact target
 * query remains authoritative for the final current target and fails closed
 * if the source/semantic snapshot no longer agrees.
 */
export const currentModulePreviewTargetByIdentity = ({
  source,
  semantic,
  definitionStatementId
}: {
  source: SourceSnapshot;
  semantic: ModulePreviewTargetSemanticSnapshot | undefined;
  definitionStatementId: StatementIdentity;
}): CurrentModulePreviewTarget | null => {
  if (!semantic?.compiled) return null;
  const statementIndex = statementIndexForIdentity(semantic, definitionStatementId);
  if (statementIndex === null) return null;
  const statement = semantic.compiled.statements[statementIndex];
  if (!statement || statement.kind !== "moduleDefinition") return null;
  const normalizedSourceOffset = statement.documentRange.from;
  const target = queryModulePreviewTarget({ source, position: normalizedSourceOffset, semantic });
  if (!target || target.definitionStatementId !== definitionStatementId) return null;
  return { target, normalizedSourceOffset };
};
