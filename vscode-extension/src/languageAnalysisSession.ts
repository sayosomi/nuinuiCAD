import { AutomationDocument, type AutomationDocumentState } from "../../src/document/automationDocument";
import type { DslCompletionRecoveryInput, DslCompletionSemanticSnapshot } from "../../src/dsl/dslCompletionQuery";
import type { DslFixedColorSemanticSnapshot } from "../../src/dsl/dslFixedColorQuery";
import type { DslDefinitionSemanticSnapshot } from "../../src/dsl/dslDefinitionQuery";
import type { DslFoldingQueryInput } from "../../src/dsl/dslFoldingQuery";
import type { DslHoverSemanticSnapshot } from "../../src/dsl/dslHoverQuery";
import type { DslReferencesSemanticSnapshot } from "../../src/dsl/dslReferencesQuery";
import type { DslRenameSemanticSnapshot } from "../../src/dsl/dslRenameQuery";
import type { DslSignatureHelpSemanticSnapshot } from "../../src/dsl/dslSignatureHelpQuery";
import type { DslSourceValueStepSemanticSnapshot } from "../../src/dsl/dslSourceValueStepQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import { reconcileStatements } from "../../src/document/statementReconciler";
import {
  compilerDiagnosticsForState,
  type CompilerDiagnostic
} from "./compilerDiagnostics";
import { projectConfiguredCompilerDiagnosticsWithTypoSuggestions } from "./typoDiagnosticPresentation";
import { createRuntimeDiagnosticsSidecar, type RuntimeDiagnosticsSidecarSnapshot } from "./runtimeDiagnosticsSidecar";
import type { VscodeRuntimeDiagnosticsPublication } from "../../src/vscode/runtimeDiagnosticsProtocol";

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const completionRecoveryFor = (
  state: AutomationDocumentState
): DslCompletionRecoveryInput | undefined => {
  if (state.currentCompiled.statementMap || !state.doc.statementMap?.statementIndexByStatementId) return undefined;

  try {
    const reconciled = reconcileStatements({
      oldStatements: state.doc.statements,
      oldLines: state.doc.sourceLines,
      oldElementIds: state.doc.statementMap.elementIdByStatementIndex,
      oldStatementIds: state.doc.statementMap.statementIdByStatementIndex,
      newStatements: state.currentCompiled.statements,
      newLines: state.currentCompiled.sourceLines
    });
    const mappedStatementIds = new Map<number, string>();
    for (const [liveStatementIndex, statementId] of reconciled.assignedIds) {
      if (state.doc.statementMap.statementIndexByStatementId.has(statementId)) {
        mappedStatementIds.set(liveStatementIndex, statementId);
      }
    }
    if (mappedStatementIds.size === 0) return undefined;
    return {
      liveCompiled: state.currentCompiled,
      lastGoodCompiled: state.doc,
      mappedStatementIds
    };
  } catch {
    // Completion must fail closed if a dirty snapshot cannot be reconciled.
    return undefined;
  }
};

export type NuiLanguageAnalysisSession = {
  getSource: () => string;
  getSourceRevision: () => number;
  replaceSource: (sourceText: string) => void;
  getDiagnostics: () => CompilerDiagnostic[];
  acceptRuntimeDiagnostics: (
    currentDocumentVersion: number,
    publication: VscodeRuntimeDiagnosticsPublication
  ) => boolean;
  clearRuntimeDiagnostics: () => void;
  runtimeDiagnosticsSnapshotFor: (
    currentDocumentVersion: number
  ) => RuntimeDiagnosticsSidecarSnapshot | null;
  runtimeEvaluationSemanticSnapshot: (
    source: SourceSnapshot
  ) => NuiRuntimeEvaluationSemanticSnapshot | undefined;
  completionSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslCompletionSemanticSnapshot | undefined;
  completionRecoverySnapshot: (
    source: SourceSnapshot
  ) => DslCompletionRecoveryInput | undefined;
  fixedColorSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslFixedColorSemanticSnapshot | undefined;
  valueStepSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslSourceValueStepSemanticSnapshot | undefined;
  signatureHelpSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslSignatureHelpSemanticSnapshot | undefined;
  definitionSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslDefinitionSemanticSnapshot | undefined;
  hoverSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslHoverSemanticSnapshot | undefined;
  referencesSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslReferencesSemanticSnapshot | undefined;
  renameSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslRenameSemanticSnapshot | undefined;
  foldingSyntaxSnapshot: (
    source: SourceSnapshot
  ) => NuiFoldingSyntaxSnapshot | undefined;
  documentSymbolSyntaxSnapshot: (
    source: SourceSnapshot
  ) => NuiDocumentSymbolSyntaxSnapshot | undefined;
  choiceQuickFixSemanticSnapshot: (
    source: SourceSnapshot
  ) => NuiChoiceQuickFixSemanticSnapshot | undefined;
};

export type NuiRuntimeEvaluationSemanticSnapshot = {
  sourceRevision: number;
  sourceText: string;
  documentRevision: number;
  compiledDocumentRevision: number;
  compiled: AutomationDocumentState["doc"];
};

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
  currentCompiled: AutomationDocumentState["currentCompiled"];
};

export const createLanguageAnalysisSession = (sourceText: string): NuiLanguageAnalysisSession => {
  const document = AutomationDocument.fromSource(sourceText);
  let diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());
  let completionRecovery = completionRecoveryFor(document.getState());
  const runtimeDiagnostics = createRuntimeDiagnosticsSidecar();

  const currentSourceRevision = (): number =>
    document.getState().currentCompiled.spans.sourceMap.sourceRevision;

  const semanticSnapshotFor = (
    source: SourceSnapshot
  ): DslCompletionSemanticSnapshot & DslDefinitionSemanticSnapshot & DslHoverSemanticSnapshot & DslReferencesSemanticSnapshot & DslRenameSemanticSnapshot | undefined => {
    const state = document.getState();
    const currentRawSource = document.getSource();
    const normalizedCurrentSource = normalizedSourceFor(currentRawSource);

    if (
      source.normalizedSource !== normalizedCurrentSource ||
      source.sourceRevision !== currentSourceRevision() ||
      state.currentCompiled.spans.sourceMap.source !== normalizedCurrentSource
    ) return undefined;

    return {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedCurrentSource,
      compiled: state.currentCompiled,
      ...(state.currentCompiled.bindingAnalysis
        ? { bindingAnalysis: state.currentCompiled.bindingAnalysis }
        : {})
    };
  };

  const runtimeEvaluationSemanticSnapshot = (
    source: SourceSnapshot
  ): NuiRuntimeEvaluationSemanticSnapshot | undefined => {
    const state = document.getState();
    const currentRawSource = document.getSource();
    const normalizedCurrentSource = normalizedSourceFor(currentRawSource);

    if (
      source.normalizedSource !== normalizedCurrentSource ||
      source.sourceRevision !== currentSourceRevision() ||
      state.currentCompiled.spans.sourceMap.source !== normalizedCurrentSource ||
      state.status === "fatal" ||
      state.docText !== currentRawSource ||
      state.doc.spans.sourceMap.source !== normalizedCurrentSource ||
      state.doc.spans.sourceMap.sourceRevision !== source.sourceRevision
    ) return undefined;

    return {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedCurrentSource,
      documentRevision: state.revision,
      compiledDocumentRevision: state.compiledRevision,
      compiled: state.doc
    };
  };

  const choiceQuickFixSemanticSnapshot = (
    source: SourceSnapshot
  ): NuiChoiceQuickFixSemanticSnapshot | undefined => {
    const state = document.getState();
    const currentRawSource = document.getSource();
    const normalizedCurrentSource = normalizedSourceFor(currentRawSource);

    if (
      source.normalizedSource !== normalizedCurrentSource ||
      source.sourceRevision !== currentSourceRevision() ||
      state.currentCompiled.spans.sourceMap.source !== normalizedCurrentSource
    ) return undefined;

    return {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedCurrentSource,
      currentCompiled: state.currentCompiled
    };
  };

  const signatureHelpSemanticSnapshot = (
    source: SourceSnapshot
  ): DslSignatureHelpSemanticSnapshot | undefined => {
    const state = document.getState();
    const currentRawSource = document.getSource();
    const normalizedCurrentSource = normalizedSourceFor(currentRawSource);

    if (
      source.normalizedSource !== normalizedCurrentSource ||
      source.sourceRevision !== currentSourceRevision() ||
      state.currentCompiled.spans.sourceMap.source !== normalizedCurrentSource
    ) return undefined;

    return {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedCurrentSource,
      compiled: state.currentCompiled
    };
  };

  const fixedColorSemanticSnapshot = (
    source: SourceSnapshot
  ): DslFixedColorSemanticSnapshot | undefined => semanticSnapshotFor(source);

  const sourceStructureSnapshot = (
    source: SourceSnapshot
  ): NuiFoldingSyntaxSnapshot | undefined => {
    const state = document.getState();
    const currentRawSource = document.getSource();
    const normalizedCurrentSource = normalizedSourceFor(currentRawSource);

    if (
      source.normalizedSource !== normalizedCurrentSource ||
      source.sourceRevision !== currentSourceRevision() ||
      state.currentCompiled.spans.sourceMap.source !== normalizedCurrentSource
    ) return undefined;

    return {
      sourceRevision: source.sourceRevision,
      sourceText: normalizedCurrentSource,
      statements: state.currentCompiled.statements,
      sourceMap: state.currentCompiled.spans.sourceMap
    };
  };

  const foldingSyntaxSnapshot = (source: SourceSnapshot): NuiFoldingSyntaxSnapshot | undefined =>
    sourceStructureSnapshot(source);

  const documentSymbolSyntaxSnapshot = (
    source: SourceSnapshot
  ): NuiDocumentSymbolSyntaxSnapshot | undefined => sourceStructureSnapshot(source);

  return {
    getSource: () => document.getSource(),
    getSourceRevision: currentSourceRevision,
    replaceSource: (nextSourceText) => {
      if (nextSourceText !== document.getSource()) runtimeDiagnostics.clear();
      document.replaceSource(nextSourceText);
      diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());
      completionRecovery = completionRecoveryFor(document.getState());
    },
    getDiagnostics: () => {
      const currentRawSource = document.getSource();
      const source: SourceSnapshot = {
        normalizedSource: normalizedSourceFor(currentRawSource),
        sourceRevision: currentSourceRevision()
      };
      const semantic = semanticSnapshotFor(source);
      return semantic
        ? projectConfiguredCompilerDiagnosticsWithTypoSuggestions(diagnostics, source, semantic)
        : diagnostics;
    },
    acceptRuntimeDiagnostics: runtimeDiagnostics.accept,
    clearRuntimeDiagnostics: runtimeDiagnostics.clear,
    runtimeDiagnosticsSnapshotFor: runtimeDiagnostics.snapshotFor,
    runtimeEvaluationSemanticSnapshot,
    completionSemanticSnapshot: semanticSnapshotFor,
    completionRecoverySnapshot: (source) => {
      const state = document.getState();
      const currentRawSource = document.getSource();
      const normalizedCurrentSource = normalizedSourceFor(currentRawSource);
      return source.normalizedSource === normalizedCurrentSource &&
        source.sourceRevision === currentSourceRevision() &&
        state.currentCompiled.spans.sourceMap.source === normalizedCurrentSource
        ? completionRecovery
        : undefined;
    },
    fixedColorSemanticSnapshot,
    valueStepSemanticSnapshot: semanticSnapshotFor,
    signatureHelpSemanticSnapshot,
    definitionSemanticSnapshot: semanticSnapshotFor,
    hoverSemanticSnapshot: semanticSnapshotFor,
    referencesSemanticSnapshot: semanticSnapshotFor,
    renameSemanticSnapshot: semanticSnapshotFor,
    foldingSyntaxSnapshot,
    documentSymbolSyntaxSnapshot,
    choiceQuickFixSemanticSnapshot
  };
};
