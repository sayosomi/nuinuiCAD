import * as vscode from "vscode";
import type { NuiDocumentSymbolSessionFor } from "./documentSymbolProvider";
import {
  createNuiElementsTreeProvider,
  NUI_ELEMENTS_VIEW_ID,
  type NuiElementsDocumentFor,
  type NuiElementsTreeItemContextValueFor,
  type NuiElementsTreeProvider
} from "./elementsTreeProvider";

export type NuiElementsTreeFeatureHost = {
  activeNuiDocument: NuiElementsDocumentFor;
  languageAnalysisSessionFor: NuiDocumentSymbolSessionFor;
  treeItemContextValueFor?: NuiElementsTreeItemContextValueFor;
  onProviderReady?: (provider: NuiElementsTreeProvider) => void;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

/**
 * Owns the Elements Tree Extension Host registration and refresh lifecycle.
 *
 * The provider remains the semantic adapter: this feature supplies only the
 * active supported document and the existing language-analysis session lookup.
 */
export const registerNuiElementsTreeFeature = (
  {
    activeNuiDocument,
    languageAnalysisSessionFor,
    treeItemContextValueFor,
    onProviderReady
  }: NuiElementsTreeFeatureHost
): vscode.Disposable => {
  const provider = treeItemContextValueFor
    ? createNuiElementsTreeProvider(activeNuiDocument, languageAnalysisSessionFor, treeItemContextValueFor)
    : createNuiElementsTreeProvider(activeNuiDocument, languageAnalysisSessionFor);
  onProviderReady?.(provider);
  const registration = vscode.window.registerTreeDataProvider?.(
    NUI_ELEMENTS_VIEW_ID,
    provider
  );
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(() => {
    provider.refresh();
  });
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const activeDocument = activeNuiDocument();
    if (activeDocument && sameDocument(activeDocument, event.document)) provider.refresh();
  });
  const documentCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
    const activeDocument = activeNuiDocument();
    if (!activeDocument || sameDocument(activeDocument, document)) provider.refresh();
  });

  return vscode.Disposable.from(
    ...(registration ? [registration] : []),
    activeEditorListener,
    documentChangeListener,
    documentCloseListener
  );
};
