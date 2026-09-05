import type { CompiledDslDocument } from "../dsl/dslDocument";
import { documentForNuiLanguageSession } from "../internal/nuiLanguageSessionDocument";
import type { NuiLanguageSession } from "../nuiLanguageSession";

export type NuiWorkspaceCurrentCompiledSemanticSnapshot = {
  sourceRevision: number;
  sourceText: string;
  compiled: CompiledDslDocument;
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export const currentCompiledSemanticSnapshotFor = (
  session: NuiLanguageSession
): NuiWorkspaceCurrentCompiledSemanticSnapshot | undefined => {
  const document = documentForNuiLanguageSession(session);
  if (!document) return undefined;

  const state = document.getState();
  const sourceText = document.getSource();
  const normalizedSource = normalizedSourceFor(sourceText);
  const sourceRevision = state.currentCompiled.spans.sourceMap.sourceRevision;
  if (
    state.currentCompiled.spans.sourceMap.source !== normalizedSource ||
    sourceRevision !== session.getSourceRevision()
  ) return undefined;

  return {
    sourceRevision,
    sourceText: normalizedSource,
    compiled: state.currentCompiled
  };
};
