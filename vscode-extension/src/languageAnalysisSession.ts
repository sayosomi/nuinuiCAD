import {
  createNuiLanguageSession,
  type NuiCurrentCompiledSemanticBridge,
  type NuiDiagnostic,
  type NuiLanguageSession
} from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
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

export const currentCompiledSemanticBridgeFor = (
  session: NuiLanguageSession,
  source: SourceSnapshot
): NuiCurrentCompiledSemanticBridge | undefined => {
  const bridge = session.currentCompiledSemanticBridge();
  return bridge &&
    bridge.sourceText === source.normalizedSource &&
    bridge.sourceRevision === source.sourceRevision
    ? bridge
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
