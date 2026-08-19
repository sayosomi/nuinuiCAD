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
import {
  createNuiDefinitionProvider,
  nuiDefinitionSelector
} from "./definitionProvider";
import {
  createNuiRenameProvider,
  nuiRenameSelector
} from "./renameProvider";
import {
  createNuiChoiceQuickFixApplyHandler,
  createNuiChoiceQuickFixProvider,
  nuiChoiceQuickFixSelector,
  NUI_CHOICE_QUICK_FIX_APPLY_COMMAND
} from "./choiceQuickFixProvider";
import {
  createNuiFoldingProvider,
  nuiFoldingSelector
} from "./foldingProvider";
import type {
  ExtensionToVscodeMessage,
  VscodeCanvasCommandId,
  VscodeBenchmarkConfig,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";

type DocumentSession = {
  key: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  disposables: vscode.Disposable[];
  inFlightCanvasHistory: {
    direction: "undo" | "redo";
    expectedDocumentVersion: number;
    changeObserved: boolean;
    commandCompleted: boolean;
  } | null;
};

let say48HistorySequence = 0;

const say48SourceFingerprint = (sourceText: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < sourceText.length; index += 1) {
    hash ^= sourceText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${sourceText.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const say48SerializeDetails = (details: Record<string, unknown>): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(details, (_key, value) => {
      if (typeof value === "bigint") return `${value}n`;
      if (value !== null && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    }) ?? "null";
  } catch {
    return "{\"serializationError\":\"unable to serialize diagnostic details\"}";
  }
};

const say48HistoryLog = (
  label: string,
  document: vscode.TextDocument | undefined,
  details: Record<string, unknown> = {}
): void => {
  const sequence = ++say48HistorySequence;
  const timestamp = typeof performance !== "undefined"
    ? performance.timeOrigin + performance.now()
    : Date.now();
  console.info(
    `[SAY48-HISTORY] seq=${sequence} t=${timestamp.toFixed(3)} ${label} ${say48SerializeDetails({
      ...(document
        ? {
            documentUri: document.uri.toString(),
            fileName: document.fileName,
            documentVersion: document.version
          }
        : {}),
      ...details
    })}`
  );
};

const say48InFlightHistoryForLog = (inFlightHistory: DocumentSession["inFlightCanvasHistory"]) =>
  inFlightHistory === null
    ? null
    : {
        direction: inFlightHistory.direction,
        expectedDocumentVersion: inFlightHistory.expectedDocumentVersion,
        changeObserved: inFlightHistory.changeObserved,
        commandCompleted: inFlightHistory.commandCompleted
      };

const say48RawDocumentChangeReason = (reason: vscode.TextDocumentChangeReason | undefined): string =>
  reason === undefined
    ? "undefined"
    : reason === vscode.TextDocumentChangeReason.Undo
      ? "Undo"
      : reason === vscode.TextDocumentChangeReason.Redo
        ? "Redo"
        : `other(${String(reason)})`;

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
  <body class="vscode-canvas-webview">
    <div id="root"></div>
    <script nonce="${contentNonce}" src="${script}"></script>
  </body>
</html>`;
};

const rustBinaryPath = (context: vscode.ExtensionContext): string =>
  process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(context.extensionPath, "..", "src-tauri", "target", "debug", "evaluation_stdio");

const postDocumentText = (
  panel: vscode.WebviewPanel,
  sourceText: string,
  documentVersion: number,
  reason: VscodeDocumentChangeReason
): void => {
  void panel.webview.postMessage({
    type: "commitText",
    sourceText,
    documentVersion,
    reason
  } satisfies ExtensionToVscodeMessage);
};

const documentChangeReasonFor = (reason: vscode.TextDocumentChangeReason | undefined): VscodeDocumentChangeReason =>
  reason === vscode.TextDocumentChangeReason.Undo
    ? "undo"
    : reason === vscode.TextDocumentChangeReason.Redo
      ? "redo"
      : "edit";

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
  const canvasHistoryHandoffContextKey = "nuinuiCAD.canvasHistoryHandoff";
  let canvasHistoryHandoffSession: DocumentSession | null = null;
  let canvasHistoryHandoffContextUpdate: Promise<void> = Promise.resolve();

  const setCanvasHistoryHandoffContext = (enabled: boolean): Promise<void> => {
    canvasHistoryHandoffContextUpdate = canvasHistoryHandoffContextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand("setContext", canvasHistoryHandoffContextKey, enabled))
      .then(() => undefined);
    return canvasHistoryHandoffContextUpdate;
  };

  const clearCanvasHistoryHandoff = (session: DocumentSession): void => {
    if (canvasHistoryHandoffSession !== session) return;
    canvasHistoryHandoffSession = null;
    void setCanvasHistoryHandoffContext(false).catch(() => undefined);
  };

  const clearCanvasHistoryHandoffIfReady = (session: DocumentSession): void => {
    if (session.panel.active && session.inFlightCanvasHistory === null) clearCanvasHistoryHandoff(session);
  };

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
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    nuiDefinitionSelector,
    createNuiDefinitionProvider(languageAnalysisSessionFor)
  );
  const renameProvider = vscode.languages.registerRenameProvider(
    nuiRenameSelector,
    createNuiRenameProvider(languageAnalysisSessionFor)
  );
  const choiceQuickFixProvider = vscode.languages.registerCodeActionsProvider(
    nuiChoiceQuickFixSelector,
    createNuiChoiceQuickFixProvider(languageAnalysisSessionFor),
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    nuiFoldingSelector,
    createNuiFoldingProvider(languageAnalysisSessionFor)
  );
  context.subscriptions.push(
    compilerDiagnosticCollection,
    compilerDiagnosticOpenListener,
    compilerDiagnosticChangeListener,
    compilerDiagnosticCloseListener,
    disposeCompilerDiagnosticSessions,
    completionProvider,
    definitionProvider,
    renameProvider,
    choiceQuickFixProvider,
    foldingProvider
  );
  for (const document of vscode.workspace.textDocuments) publishCompilerDiagnostics(document);

  const resync = (session: DocumentSession): void => {
    if (sessions.get(session.key) !== session || !isOpenDocument(session.document)) return;
    postAuthoritativeDocument(session.panel, session.document);
  };

  const completeCanvasHistory = (session: DocumentSession): void => {
    const inFlightHistory = session.inFlightCanvasHistory;
    if (!inFlightHistory) return;
    say48HistoryLog("completeCanvasHistory start", session.document, {
      direction: inFlightHistory.direction,
      inFlightCanvasHistory: say48InFlightHistoryForLog(inFlightHistory)
    });
    session.inFlightCanvasHistory = null;
    session.panel.reveal(vscode.ViewColumn.Beside, false);
    void session.panel.webview.postMessage({
      type: "canvasHistoryResult",
      direction: inFlightHistory.direction,
      status: "completed",
      documentVersion: session.document.version
    } satisfies ExtensionToVscodeMessage);
    say48HistoryLog("canvasHistoryResult posted", session.document, {
      direction: inFlightHistory.direction,
      status: "completed",
      documentVersion: session.document.version
    });
  };

  const activeColorThemeListener = vscode.window.onDidChangeActiveColorTheme(() => {
    for (const session of sessions.values()) {
      void session.panel.webview.postMessage({ type: "canvasThemeChanged" } satisfies ExtensionToVscodeMessage);
    }
  });
  context.subscriptions.push(activeColorThemeListener);

  const applyCanvasCommit = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasCommit" }>
  ): Promise<void> => {
    const matchingDocumentAvailable = isOpenDocument(session.document);
    const matchingEditorAvailable = visibleEditorFor(session.document) !== undefined;
    say48HistoryLog("canvasCommit received", session.document, {
      expectedDocumentVersion: message.expectedDocumentVersion,
      actualDocumentVersion: session.document.version,
      mutationKind: message.mutationKind,
      incomingSourceFingerprint: say48SourceFingerprint(message.sourceText),
      matchingDocumentAvailable,
      matchingEditorAvailable
    });

    if (!matchingDocumentAvailable || session.document.version !== message.expectedDocumentVersion) {
      say48HistoryLog("canvasCommit fail-closed", session.document, {
        reason: !matchingDocumentAvailable ? "document closed" : "stale expected version",
        expectedDocumentVersion: message.expectedDocumentVersion,
        actualDocumentVersion: session.document.version
      });
      resync(session);
      return;
    }

    const editor = visibleEditorFor(session.document);
    if (!editor) {
      say48HistoryLog("canvasCommit fail-closed", session.document, {
        reason: "visible editor missing"
      });
      resync(session);
      return;
    }

    const sourceText = session.document.getText();
    const lineEdits: Array<{ range: vscode.Range; replacement: string }> = [];
    if (message.mutationKind === "model-patch") {
      if (!message.splices) {
        say48HistoryLog("canvasCommit fail-closed", session.document, {
          reason: "model patch splices missing"
        });
        resync(session);
        return;
      }
      try {
        const patchedText = applyLineSplices(sourceText, message.splices);
        if (patchedText !== message.sourceText) {
          say48HistoryLog("canvasCommit fail-closed", session.document, {
            reason: "patch mismatch",
            currentSourceFingerprint: say48SourceFingerprint(sourceText),
            incomingSourceFingerprint: say48SourceFingerprint(message.sourceText)
          });
          resync(session);
          return;
        }
        lineEdits.push(...message.splices.map((splice) => textEditForLineSplice(session.document, sourceText, splice)));
      } catch {
        say48HistoryLog("canvasCommit fail-closed", session.document, {
          reason: "patch application failed",
          currentSourceFingerprint: say48SourceFingerprint(sourceText),
          incomingSourceFingerprint: say48SourceFingerprint(message.sourceText)
        });
        resync(session);
        return;
      }
    }
    let editResult: Thenable<boolean>;
    say48HistoryLog("canvasCommit editor.edit start", session.document, {
      documentVersionBeforeEdit: session.document.version,
      currentSourceFingerprint: say48SourceFingerprint(sourceText),
      targetSourceFingerprint: say48SourceFingerprint(message.sourceText)
    });
    try {
      editResult = editor.edit((editBuilder) => {
        if (message.mutationKind === "model-patch") {
          for (const edit of lineEdits) editBuilder.replace(edit.range, edit.replacement);
          return;
        }
        editBuilder.replace(fullDocumentRange(session.document), message.sourceText);
      }, { undoStopBefore: true, undoStopAfter: true });
    } catch {
      say48HistoryLog("canvasCommit editor.edit rejected", session.document, {
        reason: "editor.edit invocation threw",
        currentSourceFingerprint: say48SourceFingerprint(session.document.getText())
      });
      resync(session);
      return;
    }

    try {
      const editCompleted = await editResult;
      say48HistoryLog("canvasCommit editor.edit completed", session.document, {
        returnedBoolean: editCompleted,
        documentVersionAtCompletion: session.document.version,
        currentSourceFingerprint: say48SourceFingerprint(session.document.getText())
      });
      if (!editCompleted) {
        say48HistoryLog("canvasCommit editor.edit rejected", session.document, {
          reason: "editor.edit returned false"
        });
        resync(session);
      }
    } catch {
      say48HistoryLog("canvasCommit editor.edit rejected", session.document, {
        reason: "editor.edit promise rejected",
        currentSourceFingerprint: say48SourceFingerprint(session.document.getText())
      });
      resync(session);
    }
  };

  const applyCanvasHistory = async (
    session: DocumentSession,
    message: Extract<VscodeToExtensionMessage, { type: "canvasHistoryRequest" }>
  ): Promise<void> => {
    say48HistoryLog("canvasHistoryRequest received", session.document, {
      requestedDirection: message.direction,
      expectedDocumentVersion: message.expectedDocumentVersion,
      actualDocumentVersion: session.document.version,
      panelActive: session.panel.active,
      sourceFingerprint: say48SourceFingerprint(session.document.getText())
    });
    const postResult = (status: "completed" | "resynced" | "failed") => {
      void session.panel.webview.postMessage({
        type: "canvasHistoryResult",
        direction: message.direction,
        status,
        documentVersion: session.document.version
      } satisfies ExtensionToVscodeMessage);
      say48HistoryLog("canvasHistoryResult posted", session.document, {
        direction: message.direction,
        status,
        documentVersion: session.document.version
      });
    };
    let sourceEditorActivated = false;
    const failClosed = (status: "resynced" | "failed", reason: string) => {
      say48HistoryLog("canvasHistory fail-closed", session.document, {
        reason,
        status,
        direction: message.direction,
        inFlightCanvasHistory: say48InFlightHistoryForLog(session.inFlightCanvasHistory)
      });
      session.inFlightCanvasHistory = null;
      resync(session);
      postResult(status);
      if (sourceEditorActivated) {
        session.panel.reveal(vscode.ViewColumn.Beside, false);
        return;
      }
      clearCanvasHistoryHandoffIfReady(session);
    };

    if (!session.panel.active) {
      failClosed("resynced", "panel inactive");
      return;
    }
    if (!isOpenDocument(session.document)) {
      failClosed("resynced", "document closed");
      return;
    }
    if (session.document.version !== message.expectedDocumentVersion) {
      failClosed("resynced", "stale expected version");
      return;
    }

    const editor = visibleEditorFor(session.document);
    if (!editor) {
      failClosed("resynced", "visible editor missing");
      return;
    }

    const expectedVersion = session.document.version;
    session.inFlightCanvasHistory = {
      direction: message.direction,
      expectedDocumentVersion: expectedVersion,
      changeObserved: false,
      commandCompleted: false
    };
    canvasHistoryHandoffSession = session;
    say48HistoryLog("canvasHistory in-flight established", session.document, {
      direction: message.direction,
      expectedDocumentVersion: expectedVersion,
      inFlightCanvasHistory: say48InFlightHistoryForLog(session.inFlightCanvasHistory)
    });
    let historyPhase: "handoff-context" | "source-editor-activation" | "native-history-command" = "handoff-context";
    try {
      await setCanvasHistoryHandoffContext(true);
      if (canvasHistoryHandoffSession !== session || sessions.get(session.key) !== session) return;
      historyPhase = "source-editor-activation";
      say48HistoryLog("canvasHistory source-editor activation start", session.document, {
        direction: message.direction,
        documentVersion: session.document.version
      });
      await vscode.window.showTextDocument(session.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false
      });
      const activeEditor = vscode.window.activeTextEditor;
      say48HistoryLog("canvasHistory source-editor activation completed", session.document, {
        direction: message.direction,
        activeDocumentUri: activeEditor?.document.uri.toString() ?? null,
        activeFileName: activeEditor?.document.fileName ?? null,
        activeDocumentVersion: activeEditor?.document.version ?? null
      });
      sourceEditorActivated = true;
      const nativeHistoryCommand = message.direction === "undo" ? "undo" : "redo";
      historyPhase = "native-history-command";
      say48HistoryLog("native history command start", session.document, {
        direction: message.direction,
        command: nativeHistoryCommand,
        documentVersion: session.document.version
      });
      await vscode.commands.executeCommand(nativeHistoryCommand);
      say48HistoryLog("native history command completed", session.document, {
        direction: message.direction,
        documentVersion: session.document.version,
        inFlightCanvasHistory: say48InFlightHistoryForLog(session.inFlightCanvasHistory)
      });
    } catch {
      failClosed(
        "failed",
        historyPhase === "native-history-command"
          ? "native history command failure"
          : historyPhase === "source-editor-activation"
            ? "source-editor activation failure"
            : "history handoff context failure"
      );
      return;
    }

    const inFlightHistory = session.inFlightCanvasHistory;
    if (!inFlightHistory) return;
    inFlightHistory.commandCompleted = true;
    say48HistoryLog("native history command state updated", session.document, {
      direction: inFlightHistory.direction,
      inFlightCanvasHistory: say48InFlightHistoryForLog(inFlightHistory)
    });

    if (!isOpenDocument(session.document)) {
      failClosed("resynced", "document closed");
      return;
    }

    if (inFlightHistory.changeObserved || session.document.version === inFlightHistory.expectedDocumentVersion) {
      completeCanvasHistory(session);
    }
  };

  const disposeSession = (session: DocumentSession): void => {
    if (sessions.get(session.key) !== session) return;
    session.inFlightCanvasHistory = null;
    clearCanvasHistoryHandoff(session);
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
    const session: DocumentSession = {
      key,
      document,
      panel,
      disposables: [],
      inFlightCanvasHistory: null
    };
    sessions.set(key, session);
    updatePanelTitles();

    const post = (message: ExtensionToVscodeMessage) => void panel.webview.postMessage(message);
    if (!benchmarkConfig) {
      session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
        if (sameDocument(event.document, session.document)) {
          if (event.contentChanges.length === 0) return;

          const inFlightHistory = session.inFlightCanvasHistory;
          const documentChangedDuringCanvasHistory = inFlightHistory !== null
            && !inFlightHistory.changeObserved
            && event.document.version !== inFlightHistory.expectedDocumentVersion;
          if (documentChangedDuringCanvasHistory) {
            inFlightHistory.changeObserved = true;
          }
          const sourceText = event.document.getText();
          const effectiveReason = documentChangedDuringCanvasHistory
            ? inFlightHistory.direction
            : documentChangeReasonFor(event.reason);
          say48HistoryLog("TextDocument change observed", event.document, {
            previousOrInFlightExpectedDocumentVersion: inFlightHistory?.expectedDocumentVersion ?? null,
            newDocumentVersion: event.document.version,
            rawEventReason: say48RawDocumentChangeReason(event.reason),
            inFlightCanvasHistoryExists: inFlightHistory !== null,
            direction: inFlightHistory?.direction ?? null,
            changeObserved: inFlightHistory?.changeObserved ?? null,
            commandCompleted: inFlightHistory?.commandCompleted ?? null,
            documentChangedDuringCanvasHistory,
            effectiveReason,
            sourceFingerprint: say48SourceFingerprint(sourceText)
          });
          postDocumentText(
            panel,
            sourceText,
            event.document.version,
            effectiveReason
          );
          say48HistoryLog("TextDocument change forwarded", event.document, {
            documentVersion: event.document.version,
            forwardedReason: effectiveReason,
            sourceFingerprint: say48SourceFingerprint(sourceText)
          });
          if (documentChangedDuringCanvasHistory && inFlightHistory.commandCompleted) {
            completeCanvasHistory(session);
          }
        }
      }));
    }

    session.disposables.push(panel.onDidChangeViewState(() => {
      if (panel.active && session.inFlightCanvasHistory === null) clearCanvasHistoryHandoff(session);
    }));

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
      if (message.type === "canvasHistoryRequest") {
        if (benchmarkConfig) return;
        await applyCanvasHistory(session, message);
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

  const executeCanvasCommand = (commandId: VscodeCanvasCommandId): void => {
    const activeSession = [...sessions.values()].find((candidate) => candidate.panel.active);
    const session = activeSession ?? (
      commandId === "undo" || commandId === "redo"
        ? canvasHistoryHandoffSession
        : null
    );
    if (!session) {
      void vscode.window.showErrorMessage("nuinuiCAD: アクティブなCanvasがありません。Canvasを開いてから実行してください。");
      return;
    }
    void session.panel.webview.postMessage({ type: "canvasCommand", commandId } satisfies ExtensionToVscodeMessage);
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
  const choiceQuickFixApplyCommand = vscode.commands.registerCommand(
    NUI_CHOICE_QUICK_FIX_APPLY_COMMAND,
    createNuiChoiceQuickFixApplyHandler(languageAnalysisSessionFor)
  );
  const canvasCommandDisposables = [
    ["nuinuiCAD.canvasUndo", "undo"],
    ["nuinuiCAD.canvasRedo", "redo"],
    ["nuinuiCAD.clearCanvasSelection", "clearCanvasSelection"],
    ["nuinuiCAD.resetCanvasView", "resetCanvasView"],
    ["nuinuiCAD.fitDrawing", "fitDrawing"],
    ["nuinuiCAD.toggleCanvasElementNames", "toggleCanvasElementNames"],
    ["nuinuiCAD.toggleCanvasPoints", "toggleCanvasPoints"]
  ].map(([command, commandId]) => vscode.commands.registerCommand(command, () => {
    executeCanvasCommand(commandId as VscodeCanvasCommandId);
  }));

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
  context.subscriptions.push(
    command,
    choiceQuickFixApplyCommand,
    ...canvasCommandDisposables,
    closeDocumentListener,
    disposeAllSessions,
    disposeRustProcess
  );

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
