import * as vscode from "vscode";
import { activate as activateExtension, deactivate as deactivateExtension } from "./extension";
import {
  createMcpObservationBridge,
  NUI_MCP_OBSERVATION_SETTING
} from "./mcpObservationBridge";
import { createVscodeMultiDocumentHost } from "./multiDocumentHost";
import { vscodeObservationState } from "./vscodeObservationState";

const observationSnapshot = (includeSourceText: boolean): unknown => {
  const snapshot = vscodeObservationState.snapshot();
  if (!includeSourceText) return snapshot;

  const observedDocumentUris = new Set(snapshot.documents.map((document) => document.documentUri));
  const sourceTextByUri = new Map(
    vscode.workspace.textDocuments
      .filter((document) => observedDocumentUris.has(document.uri.toString()))
      .map((document) => [document.uri.toString(), document.getText()] as const)
  );

  return {
    ...snapshot,
    documents: snapshot.documents.map((document) => {
      const sourceText = sourceTextByUri.get(document.documentUri);
      return sourceText === undefined ? document : { ...document, sourceText };
    })
  };
};

export const activate = (context: vscode.ExtensionContext): void => {
  activateExtension(context);

  const multiDocumentHost = createVscodeMultiDocumentHost();
  multiDocumentHost.start();
  context.subscriptions.push(multiDocumentHost);

  const bridge = createMcpObservationBridge({
    configured: vscode.workspace.getConfiguration("nuinuiCAD").get<boolean>(NUI_MCP_OBSERVATION_SETTING, false),
    workspaceFolderPaths: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
    observationProvider: ({ includeSourceText }) => observationSnapshot(includeSourceText)
  });
  if (!bridge) return;

  context.subscriptions.push(bridge);
  void bridge.ready.catch((error: unknown) => {
    console.error(`nuinuiCAD MCP observation bridge failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });
};

export const deactivate = deactivateExtension;
