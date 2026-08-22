import * as vscode from "vscode";
import { activate as activateExtension, deactivate as deactivateExtension } from "./extension";
import {
  createMcpObservationBridge,
  NUI_MCP_OBSERVATION_SETTING
} from "./mcpObservationBridge";
import { vscodeObservationState } from "./vscodeObservationState";

export const activate = (context: vscode.ExtensionContext): void => {
  activateExtension(context);

  const bridge = createMcpObservationBridge({
    configured: vscode.workspace.getConfiguration("nuinuiCAD").get<boolean>(NUI_MCP_OBSERVATION_SETTING, false),
    workspaceFolderPaths: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
    observationProvider: () => vscodeObservationState.snapshot()
  });
  if (!bridge) return;

  context.subscriptions.push(bridge);
  void bridge.ready.catch((error: unknown) => {
    console.error(`nuinuiCAD MCP observation bridge failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });
};

export const deactivate = deactivateExtension;
