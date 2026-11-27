import * as vscode from "vscode";
import {
  isVscodeSurfaceDiagnosticsPublication,
  type VscodeSurfaceDiagnosticsPublication,
  type VscodeSurfaceFeedbackDiagnostic
} from "../../src/vscode/surfaceFeedbackProtocol";

export const VSCODE_SURFACE_FEEDBACK_SCHEME = "nuinui-surface-feedback";

export type SurfaceFeedbackSession = {
  readonly id: string;
  readonly surface: "canvas" | "outputPreview";
  readonly documentUri: string;
  readonly uri: vscode.Uri;
};

type SessionState = {
  session: SurfaceFeedbackSession;
  lastPresentationId: number;
  lastPublication: string | null;
};

const severityFor = (severity: VscodeSurfaceFeedbackDiagnostic["severity"]): vscode.DiagnosticSeverity => {
  switch (severity) {
    case "error": return vscode.DiagnosticSeverity.Error;
    case "warning": return vscode.DiagnosticSeverity.Warning;
    case "info": return vscode.DiagnosticSeverity.Information;
  }
};

const diagnosticSourceFor = (surface: SurfaceFeedbackSession["surface"]): string =>
  surface === "canvas" ? "nuinuiCAD / Canvas" : "nuinuiCAD / Output Preview";

const surfaceLabelFor = (surface: SurfaceFeedbackSession["surface"]): string =>
  surface === "canvas" ? "Canvas" : "Output Preview";

export class SurfaceFeedbackDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("nuinuiCAD surface feedback");
  private readonly contentChanged = new vscode.EventEmitter<vscode.Uri>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly contents = new Map<string, string>();
  private readonly providerRegistration: vscode.Disposable;
  private nextSessionId = 1;

  constructor() {
    this.providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
      VSCODE_SURFACE_FEEDBACK_SCHEME,
      {
        onDidChange: this.contentChanged.event,
        provideTextDocumentContent: (uri) => this.contents.get(uri.toString()) ?? "No current surface diagnostics."
      }
    );
  }

  createSession(surface: SurfaceFeedbackSession["surface"], documentUri: string): SurfaceFeedbackSession {
    const id = String(this.nextSessionId++);
    const session: SurfaceFeedbackSession = {
      id,
      surface,
      documentUri,
      uri: vscode.Uri.parse(`${VSCODE_SURFACE_FEEDBACK_SCHEME}:${id}`)
    };
    this.sessions.set(id, { session, lastPresentationId: -1, lastPublication: null });
    return session;
  }

  accept(
    session: SurfaceFeedbackSession,
    publication: VscodeSurfaceDiagnosticsPublication
  ): boolean {
    const state = this.sessions.get(session.id);
    if (state?.session !== session || publication.surface !== session.surface ||
        !isVscodeSurfaceDiagnosticsPublication(publication)) return false;
    const serialized = JSON.stringify(publication);
    if (publication.presentationId < state.lastPresentationId) return false;
    if (publication.presentationId === state.lastPresentationId) return serialized === state.lastPublication;

    const lines = [`${surfaceLabelFor(session.surface)} diagnostics`, ""];
    const diagnostics = publication.diagnostics.map((item) => {
      const severityLabel = item.severity === "error" ? "Error" : item.severity === "warning" ? "Warning" : "Information";
      const line = lines.length;
      const text = `${severityLabel}: ${item.message}`;
      lines.push(text);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Math.max(1, text.length)),
        item.message,
        severityFor(item.severity)
      );
      diagnostic.source = diagnosticSourceFor(session.surface);
      diagnostic.code = item.id;
      return diagnostic;
    });

    state.lastPresentationId = publication.presentationId;
    state.lastPublication = serialized;
    this.contents.set(session.uri.toString(), lines.join("\n"));
    this.contentChanged.fire(session.uri);
    if (diagnostics.length > 0) this.collection.set(session.uri, diagnostics);
    else this.collection.delete(session.uri);
    return true;
  }

  disposeSession(session: SurfaceFeedbackSession): void {
    if (this.sessions.get(session.id)?.session !== session) return;
    this.sessions.delete(session.id);
    this.contents.delete(session.uri.toString());
    this.collection.delete(session.uri);
    this.contentChanged.fire(session.uri);
  }

  dispose(): void {
    for (const { session } of this.sessions.values()) this.disposeSession(session);
    this.collection.clear();
    this.contentChanged.dispose();
    this.providerRegistration.dispose();
    this.collection.dispose();
  }
}
