import * as vscode from "vscode";
import {
  onVscodeWebviewSessionRegistryEvent,
  type VscodeWebviewSessionBase
} from "../../src/vscode/vscodeWebviewSession";
import { activate as activateExtension, deactivate as deactivateExtension } from "./extension";
import { createLanguageAnalysisSession, type NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createMcpObservationBridge,
  NUI_MCP_OBSERVATION_SETTING
} from "./mcpObservationBridge";
import {
  registerVscodeReferencePickFeature,
  type VscodeReferencePickCanvasEndpoint
} from "./referencePickCommandFeature";
import { vscodeObservationState } from "./vscodeObservationState";

type ReferencePickCanvasSession = VscodeWebviewSessionBase & {
  surfaceKind: "canvas";
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  inFlightCanvasHistory: unknown | null;
};

const asReferencePickCanvasSession = (
  session: VscodeWebviewSessionBase
): ReferencePickCanvasSession | null => {
  if (session.surfaceKind !== "canvas") return null;
  const candidate = session as Partial<ReferencePickCanvasSession>;
  return candidate.document &&
    candidate.panel &&
    typeof candidate.webviewReady === "boolean" &&
    "authoritativeDocumentVersion" in candidate &&
    "inFlightCanvasHistory" in candidate
    ? candidate as ReferencePickCanvasSession
    : null;
};

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
  const canvasSessions = new Map<string, ReferencePickCanvasSession>();
  const stopObservingSessions = onVscodeWebviewSessionRegistryEvent((event) => {
    const session = asReferencePickCanvasSession(event.session);
    if (!session) return;
    if (event.type === "set") {
      canvasSessions.set(session.documentUri, session);
      return;
    }
    if (canvasSessions.get(session.documentUri) === session) canvasSessions.delete(session.documentUri);
  });
  context.subscriptions.push({ dispose: stopObservingSessions });

  activateExtension(context);

  const referencePickLanguageSessions = new Map<string, NuiLanguageAnalysisSession>();
  const referencePickLanguageSessionFor = (document: vscode.TextDocument): NuiLanguageAnalysisSession => {
    const key = document.uri.toString();
    let session = referencePickLanguageSessions.get(key);
    if (!session) {
      session = createLanguageAnalysisSession(document.getText());
      referencePickLanguageSessions.set(key, session);
    }
    return session;
  };
  const referencePickFeature = registerVscodeReferencePickFeature({
    languageAnalysisSessionFor: referencePickLanguageSessionFor,
    ensureCanvas: async (document): Promise<VscodeReferencePickCanvasEndpoint | null> => {
      const key = document.uri.toString();
      let session = canvasSessions.get(key);
      if (!session) {
        await vscode.commands.executeCommand("nuinuiCAD.openCanvas");
        session = canvasSessions.get(key);
      }
      if (!session || session.document.uri.toString() !== key) return null;
      const matchingSession = session;
      return {
        document: matchingSession.document,
        panel: matchingSession.panel,
        isAuthoritativeReady: () =>
          canvasSessions.get(key) === matchingSession &&
          matchingSession.webviewReady &&
          matchingSession.authoritativeDocumentVersion === matchingSession.document.version &&
          matchingSession.inFlightCanvasHistory === null
      };
    }
  });
  const referencePickDocumentCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
    referencePickLanguageSessions.delete(document.uri.toString());
  });
  context.subscriptions.push(referencePickFeature, referencePickDocumentCloseListener);

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
