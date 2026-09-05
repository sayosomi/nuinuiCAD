import {
  createNuiLanguageSession,
  type DslCompletionRecoveryInput,
  type DslCompletionSemanticSnapshot,
  type DslDefinitionSemanticSnapshot,
  type DslFixedColorSemanticSnapshot,
  type DslFoldingQueryInput,
  type DslHoverSemanticSnapshot,
  type DslThemeRoleColorSemanticSnapshot,
  type DslReferencesSemanticSnapshot,
  type DslRenameSemanticSnapshot,
  type DslSignatureHelpSemanticSnapshot,
  type DslSourceValueStepSemanticSnapshot,
  type NuiCurrentCompiledSemanticBridge,
  type NuiDiagnostic,
  type NuiEvaluableDocumentSnapshot,
  type NuiLanguageSession
} from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { VscodeRuntimeDiagnosticsPublication } from "../../src/vscode/runtimeDiagnosticsProtocol";
import { createRuntimeDiagnosticsSidecar, type RuntimeDiagnosticsSidecarSnapshot } from "./runtimeDiagnosticsSidecar";

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export type NuiRuntimeEvaluationSemanticSnapshot = NuiEvaluableDocumentSnapshot;

export type NuiFoldingSyntaxSnapshot = {
  sourceRevision: number;
  sourceText: string;
  statements: DslFoldingQueryInput["statements"];
  sourceMap: DslFoldingQueryInput["sourceMap"];
};

export type NuiDocumentSymbolSyntaxSnapshot = NuiFoldingSyntaxSnapshot;

export type NuiChoiceQuickFixSemanticSnapshot = {
  sourceRevision: number;
  sourceText: string;
  currentCompiled: NonNullable<NuiCurrentCompiledSemanticBridge>["compiled"];
};

type LegacyLanguageOperations = {
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  getDiagnostics: () => readonly NuiDiagnostic[];
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  runtimeEvaluationSemanticSnapshot: (source: SourceSnapshot) => NuiRuntimeEvaluationSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  completionSemanticSnapshot: (source: SourceSnapshot) => DslCompletionSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  completionRecoverySnapshot: (source: SourceSnapshot) => DslCompletionRecoveryInput | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  fixedColorSemanticSnapshot: (source: SourceSnapshot) => DslFixedColorSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  themeRoleColorSemanticSnapshot: (source: SourceSnapshot) => DslThemeRoleColorSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  valueStepSemanticSnapshot: (source: SourceSnapshot) => DslSourceValueStepSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  signatureHelpSemanticSnapshot: (source: SourceSnapshot) => DslSignatureHelpSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  definitionSemanticSnapshot: (source: SourceSnapshot) => DslDefinitionSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  hoverSemanticSnapshot: (source: SourceSnapshot) => DslHoverSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  referencesSemanticSnapshot: (source: SourceSnapshot) => DslReferencesSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  renameSemanticSnapshot: (source: SourceSnapshot) => DslRenameSemanticSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  foldingSyntaxSnapshot: (source: SourceSnapshot) => NuiFoldingSyntaxSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  documentSymbolSyntaxSnapshot: (source: SourceSnapshot) => NuiDocumentSymbolSyntaxSnapshot | undefined;
  /** @deprecated Slice 3 transition shim for deferred/non-provider consumers. */
  choiceQuickFixSemanticSnapshot: (source: SourceSnapshot) => NuiChoiceQuickFixSemanticSnapshot | undefined;
};

export type NuiLanguageAnalysisSession = NuiLanguageSession & LegacyLanguageOperations & {
  acceptRuntimeDiagnostics: (
    currentDocumentVersion: number,
    publication: VscodeRuntimeDiagnosticsPublication
  ) => boolean;
  clearRuntimeDiagnostics: () => void;
  runtimeDiagnosticsSnapshotFor: (
    currentDocumentVersion: number
  ) => RuntimeDiagnosticsSidecarSnapshot | null;
};

const currentSourceMatches = (
  session: NuiLanguageSession,
  source: SourceSnapshot
): boolean => normalizedSourceFor(session.getSource()) === source.normalizedSource &&
  session.getSourceRevision() === source.sourceRevision;

const bridgeFor = (
  session: NuiLanguageSession,
  source: SourceSnapshot
): NuiCurrentCompiledSemanticBridge | undefined => {
  if (!currentSourceMatches(session, source)) return undefined;
  return session.currentCompiledSemanticBridge() ?? undefined;
};

export const createLanguageAnalysisSession = (sourceText: string): NuiLanguageAnalysisSession => {
  const language = createNuiLanguageSession(sourceText);
  const runtimeDiagnostics = createRuntimeDiagnosticsSidecar();

  const semanticSnapshotFor = (
    source: SourceSnapshot
  ): DslCompletionSemanticSnapshot | undefined => {
    const bridge = bridgeFor(language, source);
    if (!bridge) return undefined;
    return {
      sourceRevision: bridge.sourceRevision,
      sourceText: bridge.sourceText,
      compiled: bridge.compiled,
      ...(bridge.compiled.bindingAnalysis
        ? { bindingAnalysis: bridge.compiled.bindingAnalysis }
        : {})
    };
  };

  const hostSession = language as NuiLanguageAnalysisSession;
  hostSession.getDiagnostics = () => [...language.diagnostics()];
  hostSession.acceptRuntimeDiagnostics = runtimeDiagnostics.accept;
  hostSession.clearRuntimeDiagnostics = runtimeDiagnostics.clear;
  hostSession.runtimeDiagnosticsSnapshotFor = runtimeDiagnostics.snapshotFor;

  const replaceSource = language.replaceSource.bind(language);
  hostSession.replaceSource = (nextSourceText: string): void => {
    if (nextSourceText !== language.getSource()) runtimeDiagnostics.clear();
    replaceSource(nextSourceText);
  };

  hostSession.completionSemanticSnapshot = semanticSnapshotFor;
  hostSession.completionRecoverySnapshot = (source) =>
    currentSourceMatches(language, source) ? language.currentCompletionRecovery() : undefined;
  hostSession.fixedColorSemanticSnapshot = semanticSnapshotFor;
  hostSession.themeRoleColorSemanticSnapshot = semanticSnapshotFor;
  hostSession.valueStepSemanticSnapshot = semanticSnapshotFor;
  hostSession.signatureHelpSemanticSnapshot = (source) => {
    const semantic = semanticSnapshotFor(source);
    return semantic?.compiled
      ? { sourceRevision: semantic.sourceRevision, sourceText: semantic.sourceText!, compiled: semantic.compiled }
      : undefined;
  };
  hostSession.definitionSemanticSnapshot = semanticSnapshotFor;
  hostSession.hoverSemanticSnapshot = semanticSnapshotFor;
  hostSession.referencesSemanticSnapshot = semanticSnapshotFor;
  hostSession.renameSemanticSnapshot = semanticSnapshotFor;
  hostSession.foldingSyntaxSnapshot = (source) => {
    const bridge = bridgeFor(language, source);
    return bridge
      ? {
          sourceRevision: bridge.sourceRevision,
          sourceText: bridge.sourceText,
          statements: bridge.compiled.statements,
          sourceMap: bridge.compiled.spans.sourceMap
        }
      : undefined;
  };
  hostSession.documentSymbolSyntaxSnapshot = hostSession.foldingSyntaxSnapshot;
  hostSession.choiceQuickFixSemanticSnapshot = (source) => {
    const bridge = bridgeFor(language, source);
    return bridge
      ? {
          sourceRevision: bridge.sourceRevision,
          sourceText: bridge.sourceText,
          currentCompiled: bridge.compiled
        }
      : undefined;
  };
  hostSession.runtimeEvaluationSemanticSnapshot = (source) => {
    const snapshot = language.runtimeEvaluationSnapshot();
    return snapshot && currentSourceMatches(language, source)
      ? snapshot
      : undefined;
  };

  return hostSession;
};
