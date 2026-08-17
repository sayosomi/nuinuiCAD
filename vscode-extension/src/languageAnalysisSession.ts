import { AutomationDocument } from "../../src/document/automationDocument";
import type { DslCompletionSemanticSnapshot } from "../../src/dsl/dslCompletionQuery";
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

  return {
    getSource: () => document.getSource(),
    getSourceRevision: currentSourceRevision,
    replaceSource: (nextSourceText) => {
      document.replaceSource(nextSourceText);
      diagnostics = compilerDiagnosticsForState(document.getSource(), document.getState());
    },
    getDiagnostics: () => diagnostics,
    completionSemanticSnapshot: (source) => {
      const state = document.getState();
      const currentRawSource = document.getSource();
      const normalizedCurrentSource = normalizedSourceFor(currentRawSource);

      if (
        source.normalizedSource !== normalizedCurrentSource ||
        source.sourceRevision !== currentSourceRevision() ||
        state.status === "fatal" ||
        state.docText !== currentRawSource ||
        state.doc.spans.sourceMap.source !== normalizedCurrentSource ||
        state.doc.statementMap?.sourceRevision !== source.sourceRevision
      ) return undefined;

      return {
        sourceRevision: source.sourceRevision,
        sourceText: normalizedCurrentSource,
        compiled: state.doc,
        ...(state.doc.bindingAnalysis ? { bindingAnalysis: state.doc.bindingAnalysis } : {})
      };
    }
  };
};
