import {
  nuiDiagnosticsFor,
  nuiDiagnosticsForState,
  toNuiDiagnostic,
  type NuiDiagnostic,
  type NuiDiagnosticRelatedInformation,
  type NuiDiagnosticRange,
  type NuiDiagnosticPosition
} from "@nuinuicad/nui-language";
import type { AutomationDocumentState } from "@nuinuicad/nui-language/document";
import type { DslDiagnostic } from "@nuinuicad/nui-language";

/** @deprecated VS Code's name for the package-owned NuiDiagnostic DTO. */
export type CompilerDiagnostic = NuiDiagnostic;
export type CompilerDiagnosticPosition = NuiDiagnosticPosition;
export type CompilerDiagnosticRange = NuiDiagnosticRange;
export type CompilerDiagnosticRelatedInformation = NuiDiagnosticRelatedInformation;

/** @deprecated Host adapters now receive this projection from NuiLanguageSession. */
export const toCompilerDiagnostic = toNuiDiagnostic;

/** @deprecated Kept for the deferred multi-document host adapter. */
export const compilerDiagnosticsFor = nuiDiagnosticsFor;

/** @deprecated Kept for existing host diagnostics tests and adapters. */
export const compilerDiagnosticsForState = (
  sourceText: string,
  state: Pick<AutomationDocumentState, "diagnostics" | "bindingIssueDiagnostics">
): CompilerDiagnostic[] => nuiDiagnosticsForState(sourceText, state);

export type { DslDiagnostic };
