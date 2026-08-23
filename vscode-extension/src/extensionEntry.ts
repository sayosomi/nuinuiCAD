import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { vscodeWebviewSurfaceDataAttribute, type VscodeCanvasCommandId } from "../../src/vscode/protocol";
import {
  defaultVscodeCanvasRibbons,
  normalizeVscodeCanvasRibbons,
  patchVscodeCanvasRibbonPosition,
  VSCODE_CANVAS_RIBBON_SETTING
} from "../../src/vscode/vscodeCanvasRibbonConfig";
import { activate as activateExtension, deactivate as deactivateExtension } from "./extension";
import { createLanguageAnalysisSession, type NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  registerModulePreviewFeature,
  type ModulePreviewFeature
} from "./modulePreviewFeature";
import {
  createMcpObservationBridge,
  NUI_MCP_OBSERVATION_SETTING
} from "./mcpObservationBridge";
import { createVscodeMultiDocumentHost } from "./multiDocumentHost";
import { activeRustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";
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

const modulePreviewNonce = (): string => randomBytes(16).toString("hex");

const modulePreviewWebviewHtml = (
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext
): string => {
  const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const nonce = modulePreviewNonce();
  return `<!doctype html>
<html lang="ja" ${vscodeWebviewSurfaceDataAttribute}="modulePreview">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';" />
  </head>
  <body class="vscode-canvas-webview">
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
};

const modulePreviewCanvasRibbons = (): ReturnType<typeof defaultVscodeCanvasRibbons> => {
  const configuration = vscode.workspace.getConfiguration();
  return normalizeVscodeCanvasRibbons(configuration.get<unknown>(VSCODE_CANVAS_RIBBON_SETTING));
};

const updateModulePreviewCanvasRibbonPosition = async (
  ribbonId: string,
  x: number,
  y: number
): Promise<void> => {
  const configuration = vscode.workspace.getConfiguration();
  const current = configuration.get<unknown>(VSCODE_CANVAS_RIBBON_SETTING);
  const patched = patchVscodeCanvasRibbonPosition(current, ribbonId, x, y);
  if (!patched) return;
  await configuration.update(
    VSCODE_CANVAS_RIBBON_SETTING,
    patched,
    vscode.ConfigurationTarget.Global
  );
};

const registerModulePreviewCommands = (
  feature: ModulePreviewFeature
): vscode.Disposable[] => {
  const definitions: readonly [string, VscodeCanvasCommandId][] = [
    ["nuinuiCAD.modulePreview.clearSelection", "clearCanvasSelection"],
    ["nuinuiCAD.modulePreview.resetView", "resetCanvasView"],
    ["nuinuiCAD.modulePreview.fitDrawing", "fitDrawing"],
    ["nuinuiCAD.modulePreview.togglePointNames", "toggleCanvasPointNames"],
    ["nuinuiCAD.modulePreview.toggleGeometryNames", "toggleCanvasGeometryNames"],
    ["nuinuiCAD.modulePreview.togglePoints", "toggleCanvasPoints"]
  ];
  return definitions.map(([command, commandId]) =>
    vscode.commands.registerCommand(command, () => feature.postCanvasCommandIfActive(commandId))
  );
};

const registerModulePreview = (context: vscode.ExtensionContext): void => {
  const rustProcessOwner = activeRustEvaluationProcessOwner();
  if (!rustProcessOwner) {
    throw new Error("nuinuiCAD Module Preview requires the active VS Code Rust evaluation process owner.");
  }

  const analysisSessions = new Map<string, NuiLanguageAnalysisSession>();
  const sessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {
    const key = document.uri.toString();
    const existing = analysisSessions.get(key);
    if (existing) return existing;
    const session = createLanguageAnalysisSession(document.getText());
    analysisSessions.set(key, session);
    return session;
  };

  const feature = registerModulePreviewFeature({
    languageAnalysisSessionFor: sessionFor,
    webviewHtml: (panel) => modulePreviewWebviewHtml(panel, context),
    canvasRibbons: modulePreviewCanvasRibbons,
    updateCanvasRibbonPosition: updateModulePreviewCanvasRibbonPosition,
    editCanvasRibbon: () => {
      void vscode.commands.executeCommand("workbench.action.openSettings", VSCODE_CANVAS_RIBBON_SETTING);
    },
    evaluateWithRust: (input) => rustProcessOwner.get().request(input)
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    analysisSessions.delete(document.uri.toString());
  });
  const disposeAnalysisSessions = {
    dispose: () => analysisSessions.clear()
  };
  context.subscriptions.push(
    feature,
    ...registerModulePreviewCommands(feature),
    closeListener,
    disposeAnalysisSessions
  );
};

export const activate = (context: vscode.ExtensionContext): void => {
  activateExtension(context);
  registerModulePreview(context);

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