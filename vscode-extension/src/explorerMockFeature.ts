import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { vscodeWebviewSurfaceDataAttribute } from "../../src/vscode/protocol";

export const NUI_EXPLORER_MOCK_VIEW_ID = "nuinuiCAD.explorerMock";

const explorerMockNonce = (): string => randomBytes(16).toString("hex");

const explorerMockWebviewHtml = (
  webview: vscode.Webview,
  context: vscode.ExtensionContext
): string => {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const nonce = explorerMockNonce();
  return `<!doctype html>
<html lang="ja" ${vscodeWebviewSurfaceDataAttribute}="explorerMock">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  </head>
  <body class="vscode-explorer-mock-webview">
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
};

export const registerExplorerMockFeature = (context: vscode.ExtensionContext): vscode.Disposable => {
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView) {
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
      };
      webviewView.webview.html = explorerMockWebviewHtml(webviewView.webview, context);
    }
  };
  return vscode.window.registerWebviewViewProvider(NUI_EXPLORER_MOCK_VIEW_ID, provider);
};
