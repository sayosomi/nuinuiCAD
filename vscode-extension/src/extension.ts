import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vscode from "vscode";
import { RustEvaluationProcess } from "./rustEvaluationProcess";
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";

const benchmarkConfigFromEnvironment = (): VscodeBenchmarkConfig | null => {
  const raw = process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  if (!raw) return null;
  return JSON.parse(raw) as VscodeBenchmarkConfig;
};

const nonce = () => randomBytes(16).toString("hex");

const fullDocumentRange = (document: vscode.TextDocument): vscode.Range =>
  new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));

const webviewHtml = (panel: vscode.WebviewPanel, context: vscode.ExtensionContext): string => {
  const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"));
  const contentNonce = nonce();
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${contentNonce}';" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${contentNonce}" src="${script}"></script>
  </body>
</html>`;
};

const rustBinaryPath = (context: vscode.ExtensionContext): string =>
  process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(context.extensionPath, "..", "src-tauri", "target", "debug", "evaluation_stdio");

const postDocumentText = (panel: vscode.WebviewPanel, sourceText: string, documentVersion: number): void => {
  void panel.webview.postMessage({ type: "commitText", sourceText, documentVersion } satisfies ExtensionToVscodeMessage);
};

const postAuthoritativeDocument = (panel: vscode.WebviewPanel, document: vscode.TextDocument): void => {
  void panel.webview.postMessage({
    type: "replaceTextDocument",
    sourceText: document.getText(),
    documentVersion: document.version
  } satisfies ExtensionToVscodeMessage);
};

const activeNuiEditor = (): vscode.TextEditor | undefined => {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.fileName.endsWith(".nui") ? editor : undefined;
};

export const activate = (context: vscode.ExtensionContext): void => {
  let rustProcess: RustEvaluationProcess | null = null;
  const benchmarkConfig = benchmarkConfigFromEnvironment();
  let benchmarkStarted = false;
  let benchmarkEditorListener: vscode.Disposable | null = null;

  const createPerformancePanel = (editor: vscode.TextEditor): void => {
    const document = editor.document;
    const panel = vscode.window.createWebviewPanel(
      "nuinuiCAD.performancePoc",
      "nuinuiCAD Performance PoC",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
      }
    );
    panel.webview.html = webviewHtml(panel, context);

    const post = (message: ExtensionToVscodeMessage) => void panel.webview.postMessage(message);
    const onDocumentChange: vscode.Disposable = benchmarkConfig
      ? { dispose: () => undefined }
      : vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== document.uri.toString()) return;
        postDocumentText(panel, event.document.getText(), event.document.version);
      });
    const onMessage = panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        postAuthoritativeDocument(panel, document);
        if (benchmarkConfig) post({ type: "benchmarkConfig", config: benchmarkConfig });
        return;
      }
      if (message.type === "canvasCommit") {
        if (benchmarkConfig) return;
        if (document.version !== message.expectedDocumentVersion) {
          postAuthoritativeDocument(panel, document);
          return;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullDocumentRange(document), message.sourceText);
        await vscode.workspace.applyEdit(edit);
        return;
      }
      if (message.type === "rustEvaluationRequest") {
        rustProcess ??= new RustEvaluationProcess(rustBinaryPath(context));
        try {
          const payload = await rustProcess.request(message.input);
          post({ type: "rustEvaluationResponse", id: message.id, payload });
        } catch (error) {
          post({ type: "rustEvaluationError", id: message.id, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (message.type === "benchmarkResult") {
        if (!benchmarkConfig) return;
        mkdirSync(resolve(benchmarkConfig.resultPath, ".."), { recursive: true });
        writeFileSync(benchmarkConfig.resultPath, `${JSON.stringify(message.result, null, 2)}\n`, "utf8");
        return;
      }
      if (message.type === "benchmarkError") {
        if (!benchmarkConfig) return;
        writeFileSync(`${benchmarkConfig.resultPath}.error.json`, JSON.stringify({ runId: benchmarkConfig.runId, error: message.error }, null, 2), "utf8");
      }
    });
    const disposePanel = panel.onDidDispose(() => {
      onDocumentChange.dispose();
      onMessage.dispose();
      rustProcess?.dispose();
      if (benchmarkConfig && !existsSync(benchmarkConfig.resultPath) && !existsSync(`${benchmarkConfig.resultPath}.error.json`)) {
        writeFileSync(`${benchmarkConfig.resultPath}.error.json`, JSON.stringify({ runId: benchmarkConfig.runId, error: "Performance PoC panel closed before completion" }, null, 2), "utf8");
      }
    });
    context.subscriptions.push(onDocumentChange, onMessage, disposePanel);
  };

  const startBenchmark = (editor: vscode.TextEditor): void => {
    if (!benchmarkConfig || benchmarkStarted) return;
    benchmarkStarted = true;
    benchmarkEditorListener?.dispose();
    benchmarkEditorListener = null;
    createPerformancePanel(editor);
  };

  const command = vscode.commands.registerCommand("nuinuiCAD.openPerformancePoc", () => {
    const editor = activeNuiEditor();
    if (!editor) {
      void vscode.window.showErrorMessage("nuinuiCAD Performance PoC requires an active .nui Text Editor.");
      return;
    }
    if (benchmarkConfig) {
      startBenchmark(editor);
      return;
    }
    createPerformancePanel(editor);
  });

  context.subscriptions.push(command, { dispose: () => rustProcess?.dispose() });
  if (benchmarkConfig) {
    const startWhenEditorIsReady = () => {
      const editor = activeNuiEditor();
      if (editor) startBenchmark(editor);
    };
    if (activeNuiEditor()) {
      startWhenEditorIsReady();
    } else {
      benchmarkEditorListener = vscode.window.onDidChangeActiveTextEditor(startWhenEditorIsReady);
      context.subscriptions.push(benchmarkEditorListener);
    }
  }
};

export const deactivate = (): void => undefined;
