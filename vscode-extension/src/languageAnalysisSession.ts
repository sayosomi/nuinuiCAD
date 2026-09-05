import {
  createNuiLanguageSession,
  type NuiDiagnostic,
  type NuiLanguageSession
} from "@nuinuicad/nui-language";
import {
  currentCompiledSemanticSnapshotFor as currentCompiledWorkspaceSemanticSnapshotFor,
  type NuiWorkspaceCurrentCompiledSemanticSnapshot
} from "@nuinuicad/nui-language/workspace";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import type { VscodeRuntimeDiagnosticsPublication } from "../../src/vscode/runtimeDiagnosticsProtocol";
import { createRuntimeDiagnosticsSidecar, type RuntimeDiagnosticsSidecarSnapshot } from "./runtimeDiagnosticsSidecar";

export type NuiLanguageAnalysisSession = NuiLanguageSession & {
  /** Compatibility alias for existing host composition. */
  getDiagnostics: () => readonly NuiDiagnostic[];
  acceptRuntimeDiagnostics: (
    currentDocumentVersion: number,
    publication: VscodeRuntimeDiagnosticsPublication
  ) => boolean;
  clearRuntimeDiagnostics: () => void;
  runtimeDiagnosticsSnapshotFor: (
    currentDocumentVersion: number
  ) => RuntimeDiagnosticsSidecarSnapshot | null;
};

export const currentCompiledSemanticSnapshotFor = (
  session: NuiLanguageSession,
  source: SourceSnapshot
): NuiWorkspaceCurrentCompiledSemanticSnapshot | undefined => {
  const snapshot = currentCompiledWorkspaceSemanticSnapshotFor(session);
  return snapshot &&
    snapshot.sourceText === source.normalizedSource &&
    snapshot.sourceRevision === source.sourceRevision
    ? snapshot
    : undefined;
};

export const createLanguageAnalysisSession = (sourceText: string): NuiLanguageAnalysisSession => {
  const language = createNuiLanguageSession(sourceText);
  const runtimeDiagnostics = createRuntimeDiagnosticsSidecar();

  const hostSession = language as NuiLanguageAnalysisSession;
  hostSession.getDiagnostics = () => language.diagnostics();
  hostSession.acceptRuntimeDiagnostics = runtimeDiagnostics.accept;
  hostSession.clearRuntimeDiagnostics = runtimeDiagnostics.clear;
  hostSession.runtimeDiagnosticsSnapshotFor = runtimeDiagnostics.snapshotFor;

  const replaceSource = language.replaceSource.bind(language);
  hostSession.replaceSource = (nextSourceText: string): void => {
    if (nextSourceText !== language.getSource()) runtimeDiagnostics.clear();
    replaceSource(nextSourceText);
  };

  return hostSession;
};
