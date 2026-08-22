import * as vscode from "vscode";
import type { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { createNuiHoverProvider, nuiHoverSelector } from "./hoverProvider";
import { createNuiRuntimeEvaluationService } from "./runtimeEvaluationService";

export type NuiHoverFeatureSessionFor = (
  document: vscode.TextDocument
) => NuiLanguageAnalysisSession;

export const registerNuiHoverFeature = ({
  rustProcessOwner,
  sessionFor
}: {
  rustProcessOwner: Pick<RustEvaluationProcessOwner, "get">;
  sessionFor: NuiHoverFeatureSessionFor;
}): vscode.Disposable => {
  // Some focused Extension Host tests provide only the language APIs they
  // exercise. Production VS Code always supplies registerHoverProvider.
  const registerHoverProvider = (vscode.languages as typeof vscode.languages & {
    registerHoverProvider?: typeof vscode.languages.registerHoverProvider;
  }).registerHoverProvider;
  if (typeof registerHoverProvider !== "function") {
    return { dispose: () => {} };
  }

  const runtimeEvaluation = createNuiRuntimeEvaluationService({
    rustProcessOwner,
    isDocumentCurrent: (documentKey, documentVersion) =>
      vscode.workspace.textDocuments.some((document) =>
        document.uri.toString() === documentKey && document.version === documentVersion
      )
  });
  const hoverProvider = registerHoverProvider.call(
    vscode.languages,
    nuiHoverSelector,
    createNuiHoverProvider(sessionFor, runtimeEvaluation)
  );

  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.scheme !== "file" || !event.document.fileName.endsWith(".nui")) return;
    runtimeEvaluation.invalidateDocument(event.document.uri.toString());
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return;
    runtimeEvaluation.closeDocument(document.uri.toString());
  });

  return {
    dispose: () => {
      hoverProvider.dispose();
      changeListener.dispose();
      closeListener.dispose();
      runtimeEvaluation.dispose();
    }
  };
};
