import type { RuntimeScalarDiagnostic } from "../../src/scalars/runtimeScalarDiagnostics";
import type { VscodeRuntimeDiagnosticsPublication } from "../../src/vscode/protocol";

export type RuntimeDiagnosticsSidecarSnapshot = {
  documentVersion: number;
  diagnostics: readonly RuntimeScalarDiagnostic[];
};

export type RuntimeDiagnosticsSidecar = {
  accept: (
    currentDocumentVersion: number,
    publication: VscodeRuntimeDiagnosticsPublication
  ) => boolean;
  clear: () => void;
  snapshotFor: (currentDocumentVersion: number) => RuntimeDiagnosticsSidecarSnapshot | null;
};

/**
 * Stores the last exact-current canonical runtime diagnostic publication for one
 * open VS Code document session. Session ownership/open-document checks stay in
 * the Extension Host adapter; this sidecar owns only version freshness and the
 * original structured payload.
 */
export const createRuntimeDiagnosticsSidecar = (): RuntimeDiagnosticsSidecar => {
  let snapshot: RuntimeDiagnosticsSidecarSnapshot | null = null;

  return {
    accept: (currentDocumentVersion, publication) => {
      if (publication.documentVersion !== currentDocumentVersion) return false;
      snapshot = {
        documentVersion: publication.documentVersion,
        diagnostics: publication.diagnostics
      };
      return true;
    },
    clear: () => {
      snapshot = null;
    },
    snapshotFor: (currentDocumentVersion) =>
      snapshot?.documentVersion === currentDocumentVersion ? snapshot : null
  };
};
