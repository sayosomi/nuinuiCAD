import { AutomationDocument, type AutomationDocumentState } from "../../src/document/automationDocument";
import type { DslCompletionSemanticSnapshot } from "../../src/dsl/dslCompletionQuery";
import type { DslDefinitionSemanticSnapshot } from "../../src/dsl/dslDefinitionQuery";
import type { DslFoldingQueryInput } from "../../src/dsl/dslFoldingQuery";
import type { DslReferencesSemanticSnapshot } from "../../src/dsl/dslReferencesQuery";
import type { DslRenameSemanticSnapshot } from "../../src/dsl/dslRenameQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import {
  compilerDiagnosticsForState,
  type CompilerDiagnostic
} from "./compilerDiagnostics";

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export type NuiLanguageAnalysisSession = {
  getSource: () => string;
  getSourceRevision: () => number;
  replaceSource: (sourceText: string) => void;
  getDiagnostics: () => CompilerDiagnostic[];
  completionSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslCompletionSemanticSnapshot | undefined;
  definitionSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslDefinitionSemanticSnapshot | undefined;
  referencesSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslReferencesSemanticSnapshot | undefined;
  renameSemanticSnapshot: (
    source: SourceSnapshot
  ) => DslRenameSemanticSnapshot | undefined;
  foldingSyntaxSnapshot: (
    source: SourceSnapshot
  ) => NuiFoldingSyntaxSnapshot | undefined;
  choiceQuickFixSemanticSnapshot: (
    source: SourceSnapshot
  ) => NuiChoiceQuickFixSemanticSnapshot | undefined;
};

export type NuiFoldingSyntaxSnapshot = {
  sourceRevision: number;
  sourceText: string;
  statements: DslFoldingQueryInput["statements"];
  sourceMap: DslFoldingQueryInput["sourceMap"];
};

export type NuiChoiceQuickFixSemanticSnapshot = {
  sourceRevision: number;
  sourceText: string;
  currentCompiled: AutomationDocumentState["currentCompiled"];
};

export const createLanguageAnalysisSession = (sourceText: string): NuiLanguageAnalysisSession => {
  const document = AutomationDocument.fromSource(sourceText);
  let diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());

  const currentSourceRevision = (): number => {
    const state = document.getState();
    return state.status === "fatal"
      ? state.revision + 1
      : state.doc.statementMap?.sourceRevision ?? state.revision;
  };

  const semanticSnapshotFor = (
    source: SourceSnapshot
  ): DslCompletionSemanticSnapshot & DslDefinitionSemanticSnapshot & DslReferencesSemanticSnapshot & DslRenameSemanticSnapshot | undefined => {
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

  const foldingSyntaxSnapshot = (
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

  return {
    getSource: () => document.getSource(),
    getSourceRevision: currentSourceRevision,
    replaceSource: (nextSourceText) => {
      document.replaceSource(nextSourceText);
      diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());
    },
    getDiagnostics: () => diagnostics,
    completionSemanticSnapshot: semanticSnapshotFor,
    definitionSemanticSnapshot: semanticSnapshotFor,
    referencesSemanticSnapshot: semanticSnapshotFor,
    renameSemanticSnapshot: semanticSnapshotFor,
    foldingSyntaxSnapshot,
    choiceQuickFixSemanticSnapshot
  };
};
