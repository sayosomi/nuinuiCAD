import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as vscode from "vscode";
import { applyLineSplices, type LineSplice } from "../../src/document/textPatch";
import { RustEvaluationProcess } from "./rustEvaluationProcess";
import { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";
import {
  type CompilerDiagnostic
} from "./compilerDiagnostics";
import {
  createLanguageAnalysisSession,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import {
  createNuiCompletionProvider,
  nuiCompletionSelector,
  nuiCompletionTriggerCharacters
} from "./completionProvider";
import type {
  ExtensionToVscodeMessage,
  VscodeBenchmarkConfig,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";

type DocumentSession = {
  key: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  disposables: vscode.Disposable[];
};

const benchmarkConfigFromEnvironment = (): VscodeBenchmarkConfig | null => {
  const raw = process.env.NUINUICAD_VSCODE_BENCHMARK_CONFIG;
  if (!raw) return null;
  return JSON.parse(raw) as VscodeBenchmarkConfig;
};

const nonce = () => randomBytes(16).toString("hex");

const fullDocumentRange = (document: vscode.TextDocument): vscode.Range =>
  new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));

const toVscodeDiagnostic = (diagnostic: CompilerDiagnostic): vscode.Diagnostic => {
  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : vscode.DiagnosticSeverity.Warning;
  const result = new vscode.Diagnostic(
    new vscode.Range(
      new vscode.Position(diagnostic.range.start.line, diagnostic.range.start.character),
      new vscode.Position(diagnostic.range.end.line, diagnostic.range.end.character)
    ),
    diagnostic.message,
    severity
  );
  if (diagnostic.code !== undefined) result.code = diagnostic.code;
  result.source = diagnostic.source;
  return result;
};

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

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || documentKey(left) === documentKey(right);

const isSupportedNuiDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const activeNuiEditor = (): vscode.TextEditor | undefined => {
  const editor = vscode.window.activeTextEditor;
  return editor && isSupportedNuiDocument(editor.document) ? editor : undefined;
};

const isOpenDocument = (document: vscode.TextDocument): boolean =>
  vscode.workspace.textDocuments.some((candidate) => sameDocument(candidate, document));

const visibleEditorFor = (document: vscode.TextDocument): vscode.TextEditor | undefined =>
  vscode.window.visibleTextEditors.find((editor) => sameDocument(editor.document, document));

const sourceNewline = (sourceText: string): string => {
  const separators = [...sourceText.matchAll(/\r?\n/g)].map((match) => match[0]);
  return separators.length > 0 && separators.every((value) => value === "\r\n") ? "\r\n" : "\n";
};

const lineStartsFor = (sourceText: string): { starts: number[]; separatorLengths: number[]; lineCount: number } => {
  const starts = [0];
  const separatorLengths: number[] = [];
  for (const match of sourceText.matchAll(/\r?\n/g)) {
    starts.push((match.index ?? 0) + match[0].length);
    separatorLengths.push(match[0].length);
  }
  return { starts, separatorLengths, lineCount: sourceText.split(/\r?\n/).length };
};

const textEditForLineSplice = (
  document: vscode.TextDocument,
  sourceText: string,
  splice: LineSplice
): { range: vscode.Range; replacement: string } => {
  const { starts, separatorLengths, lineCount } = lineStartsFor(sourceText);
  const startIndex = splice.startLine - 1;
  const deletesLines = splice.endLine >= splice.startLine;
  const newline = sourceNewline(sourceText);
  const replacement = splice.replacementLines.join(newline);
  let from: number;
  let to: number;
  let insert: string;

  if (!deletesLines) {
    from = startIndex < lineCount ? starts[startIndex] : sourceText.length;
    to = from;
    insert = splice.replacementLines.length > 0
      ? startIndex < lineCount
        ? `${replacement}${newline}`
        : `${lineCount > 0 ? newline : ""}${replacement}`
      : "";
  } else if (splice.endLine < lineCount) {
    from = starts[startIndex];
    to = starts[splice.endLine];
    insert = splice.replacementLines.length > 0 ? `${replacement}${newline}` : "";
  } else if (startIndex === 0) {
    from = 0;
    to = sourceText.length;
    insert = replacement;
  } else {
    from = starts[startIndex] - separatorLengths[startIndex - 1];
    to = sourceText.length;
    insert = splice.replacementLines.length > 0 ? `${newline}${replacement}` : "";
  }

  return {
    range: new vscode.Range(document.positionAt(from), document.positionAt(to)),
    replacement: insert
  };
};

const disposeSessionListeners = (session: DocumentSession): void => {
  for (const disposable of session.disposables.splice(0)) disposable.dispose();
};

export const activate = (context: vscode.ExtensionContext): void => {
  const sessions = new Map<string, DocumentSession>();
  const languageAnalysisSessions = new Map<string, NuiLanguageAnalysisSession>();
  const compilerDiagnosticCollection = vscode.languages.createDiagnosticCollection("nuinuiCAD");
  const rustProcessOwner = new RustEvaluationProcessOwner((onTerminated) => new RustEvaluationProcess(rustBinaryPath(context), { onTerminated }));
  const benchmarkConfig = benchmarkConfigFromEnvironment();
  let benchmarkStarted = false;
  let benchmarkEditorListener: vscode.Disposable | null = null;

  const publishCompilerDiagnostics = (document: vscode.TextDocument): void => {
    if (!isSupportedNuiDocument(document)) return;

    const key = documentKey(document);
    const capturedUri = key;
    const capturedVersion = document.version;
    let session = languageAnalysisSessions.get(key);
    const sourceText = document.getText();
    if (session) {
      session.replaceSource(sourceText);
    } else {
      session = languageAnalysisSessions.get(key) ?? createLanguageAnalysisSession(sourceText);
      if (!languageAnalysisSessions.has(key)) languageAnalysisSessions.set(key, session);
    }

    if (
      documentKey(document) !== capturedUri ||
      languageAnalysisSessions.get(key) !== session ||
      !isOpenDocument(document) ||
      document.version !== capturedVersion
    ) return;
    compilerDiagnosticCollection.set(document.uri, session.getDiagnostics().map(toVscodeDiagnostic));
  };

  const languageAnalysisSessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {
    const key = documentKey(document);
    const existing = languageAnalysisSessions.get(key);
    if (existing) return existing;
    const session = createLanguageAnalysisSession(document.getText());
    languageAnalysisSessions.set(key, session);
    return session;
  };

  const compilerDiagnosticOpenListener = vscode.workspace.onDidOpenTextDocument((document) => {
    publishCompilerDiagnostics(document);
  });
  const compilerDiagnosticChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    publishCompilerDiagnostics(event.document);
  });
  const compilerDiagnosticCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (!isSupportedNuiDocument(document)) return;
    const key = documentKey(document);
    languageAnalysisSessions.delete(key);
    compilerDiagnosticCollection.delete(document.uri);
  });
  const disposeCompilerDiagnosticSessions = {
    dispose: () => languageAnalysisSessions.clear()
  };
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    nuiCompletionSelector,
    createNuiCompletionProvider(languageAnalysisSessionFor),
    ...nuiCompletionTriggerCharacters
  );
  context.subscriptions.push(
    compilerDiagnosticCollection,
    compilerDiagnosticOpenListener,
    compilerDiagnosticChangeListener,
    compilerDiagnosticCloseListener,
    disposeCompilerDiagnosticSessions,
    completionProvider
  );
  for (const document of vscode.workspace.textDocuments) publishCompilerDiagnostics(document);

  const resync = (session: DocumentSession): void => {
    if (sessions.get(session.key) !== session || !isOpenDocument(session.document)) return;
    postAuthoritativeDocument(session.panel, session.document);
  };

  const applyCanvasCommit = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasCommit" }>
  ): Promise<void> => {
    if (!isOpenDocument(session.document) || session.document.version !== message.expectedDocumentVersion) {
      resync(session);
      return;
    }

    const editor = visibleEditorFor(session.document);
    if (!editor) {
      resync(session);
      return;
    }

    const sourceText = session.document.getText();
    const lineEdits: Array<{ range: vscode.Range; replacement: string }> = [];
    if (message.mutationKind === "model-patch") {
      if (!message.splices) {
        resync(session);
        return;
      }
      try {
        const patchedText = applyLineSplices(sourceText, message.splices);
        if (patchedText !== message.sourceText) {
          resync(session);
          return;
        }
        lineEdits.push(...message.splices.map((splice) => textEditForLineSplice(session.document, sourceText, splice)));
      } catch {
        resync(session);
        return;
      }
    }
    let editResult: Thenable<boolean>;
    try {
      editResult = editor.edit((editBuilder) => {
        if (message.mutationKind === "model-patch") {
          for (const edit of lineEdits) editBuilder.replace(edit.range, edit.replacement);
          return;
        }
        editBuilder.replace(fullDocumentRange(session.document), message.sourceText);
      }, { undoStopBefore: true, undoStopAfter: true });
    } catch {
      resync(session);
      return;
    }

    try {
      if (!(await editResult)) resync(session);
    } catch {
      resync(session);
    }
  };

  const disposeSession = (session: DocumentSession): void => {
    if (sessions.get(session.key) !== session) return;
    sessions.delete(session.key);
    disposeSessionListeners(session);
    updatePanelTitles();
  };

  const updatePanelTitles = (): void => {
    const sessionsByBasename = new Map<string, DocumentSession[]>();
    for (const session of sessions.values()) {
      const name = basename(session.document.fileName);
      const group = sessionsByBasename.get(name) ?? [];
      group.push(session);
      sessionsByBasename.set(name, group);
    }

    for (const [name, matchingSessions] of sessionsByBasename) {
      for (const session of matchingSessions) {
        const documentName = matchingSessions.length === 1
          ? name
          : vscode.workspace.asRelativePath(session.document.uri, true);
        session.panel.title = `${documentName} — nuinuiCAD`;
      }
    }
  };

  const createCanvasPanel = (editor: vscode.TextEditor): void => {
    const document = editor.document;
    const key = documentKey(document);
    const existing = sessions.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "nuinuiCAD.canvas",
      `${basename(document.fileName)} — nuinuiCAD`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
      }
    );
    panel.webview.html = webviewHtml(panel, context);
    const session: DocumentSession = { key, document, panel, disposables: [] };
    sessions.set(key, session);
    updatePanelTitles();

    const post = (message: ExtensionToVscodeMessage) => void panel.webview.postMessage(message);
    if (!benchmarkConfig) {
      session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (sameDocument(event.document, session.document)) {
          postDocumentText(panel, event.document.getText(), event.document.version);
        }
      }));
    }

    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        postAuthoritativeDocument(panel, session.document);
        if (benchmarkConfig) post({ type: "benchmarkConfig", config: benchmarkConfig });
        return;
      }
      if (message.type === "canvasCommit") {
        if (benchmarkConfig) return;
        await applyCanvasCommit(session, message);
        return;
      }
      if (message.type === "rustEvaluationRequest") {
        try {
          const payload = await rustProcessOwner.get().request(message.input);
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
    }));

    panel.onDidDispose(() => {
      disposeSession(session);
      if (benchmarkConfig && !existsSync(benchmarkConfig.resultPath) && !existsSync(`${benchmarkConfig.resultPath}.error.json`)) {
        writeFileSync(`${benchmarkConfig.resultPath}.error.json`, JSON.stringify({ runId: benchmarkConfig.runId, error: "Performance PoC panel closed before completion" }, null, 2), "utf8");
      }
    });
  };

  const startBenchmark = (editor: vscode.TextEditor): void => {
    if (!benchmarkConfig || benchmarkStarted) return;
    benchmarkStarted = true;
    benchmarkEditorListener?.dispose();
    benchmarkEditorListener = null;
    createCanvasPanel(editor);
  };

  const command = vscode.commands.registerCommand("nuinuiCAD.openCanvas", () => {
    const editor = activeNuiEditor();
    if (!editor) {
      void vscode.window.showErrorMessage("nuinuiCAD requires an active .nui Text Editor.");
      return;
    }
    if (benchmarkConfig) {
      startBenchmark(editor);
      return;
    }
    createCanvasPanel(editor);
  });

  const closeDocumentListener = vscode.workspace.onDidCloseTextDocument((document) => {
    const session = sessions.get(documentKey(document));
    if (session && sameDocument(session.document, document)) session.panel.dispose();
  });
  const disposeAllSessions = {
    dispose: () => {
      for (const session of [...sessions.values()]) disposeSession(session);
      sessions.clear();
    }
  };
  const disposeRustProcess = {
    dispose: () => rustProcessOwner.dispose()
  };
  context.subscriptions.push(command, closeDocumentListener, disposeAllSessions, disposeRustProcess);

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
