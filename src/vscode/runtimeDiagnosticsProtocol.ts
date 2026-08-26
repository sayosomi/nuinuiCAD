import type { DslDiagnostic } from "../dsl/dslTypes";

/** JSON-safe runtime layer published only from the current canonical Webview evaluation. */
export type VscodeRuntimeDiagnosticsPublication = {
  type: "runtimeDiagnosticsPublication";
  documentVersion: number;
  diagnostics: readonly DslDiagnostic[];
};

export type VscodeRuntimeDiagnosticsToExtensionMessage = VscodeRuntimeDiagnosticsPublication;
