import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { vscodeWebviewSurfaceDataAttribute } from "../../src/vscode/protocol";
import type { ModulePreviewFeature } from "./modulePreviewFeature";

export const NUI_MODULE_PREVIEW_PARAMETERS_VIEW_ID = "nuinuiCAD.modulePreviewParameters";

const modulePreviewParametersNonce = (): string => randomBytes(16).toString("hex");

const modulePreviewParametersWebviewHtml = (
  webview: vscode.Webview,
  context: vscode.ExtensionContext
): string => {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const nonce = modulePreviewParametersNonce();
  return `<!doctype html>
<html lang="ja" ${vscodeWebviewSurfaceDataAttribute}="modulePreviewParameters">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  </head>
  <body class="vscode-module-preview-parameters-webview">
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
};

export const registerModulePreviewParametersFeature = (
  context: vscode.ExtensionContext,
  modulePreviewFeature: ModulePreviewFeature
): vscode.Disposable => {
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView) {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
      };
      webviewView.webview.html = modulePreviewParametersWebviewHtml(webviewView.webview, context);
      const attachment = modulePreviewFeature.attachParameterView(webviewView.webview);
      webviewView.onDidDispose(() => attachment.dispose());
    }
  };
  return vscode.window.registerWebviewViewProvider(NUI_MODULE_PREVIEW_PARAMETERS_VIEW_ID, provider);
};
