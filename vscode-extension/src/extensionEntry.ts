import * as vscode from "vscode";
import { activate as activateExtension, deactivate as deactivateExtension } from "./extension";
import {
  createMcpObservationBridge,
  NUI_MCP_OBSERVATION_SETTING
} from "./mcpObservationBridge";
import { vscodeObservationState } from "./vscodeObservationState";

const observationSnapshot = (): unknown => {
  const snapshot = vscodeObservationState.snapshot();
  const sourceTextByUri = new Map(
    vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === "file" && document.fileName.endsWith(".nui"))
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

  const bridge = createMcpObservationBridge({
    configured: vscode.workspace.getConfiguration("nuinuiCAD").get<boolean>(NUI_MCP_OBSERVATION_SETTING, false),
    workspaceFolderPaths: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
    observationProvider: observationSnapshot
  });
  if (!bridge) return;

  context.subscriptions.push(bridge);
  void bridge.ready.catch((error: unknown) => {
    console.error(`nuinuiCAD MCP observation bridge failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });
};

export const deactivate = deactivateExtension;
