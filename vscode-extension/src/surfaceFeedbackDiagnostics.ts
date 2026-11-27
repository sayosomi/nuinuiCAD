import * as vscode from "vscode";
import {
  isVscodeSurfaceDiagnosticsPublication,
  isVscodeCanvasFrameDrawn,
  type VscodeCanvasFeedbackGraphIdentity,
  type VscodeCanvasFrameDrawn,
  type VscodeCanvasFrameIdentity,
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
  diagnostics: readonly VscodeSurfaceFeedbackDiagnostic[];
  canvasUpdate: {
    generation: number;
    documentVersion: number;
    message: string;
    graphIdentity?: VscodeCanvasFeedbackGraphIdentity;
    frameIdentity: VscodeCanvasFrameIdentity | null;
  } | null;
  terminalDiagnostic: VscodeSurfaceFeedbackDiagnostic | null;
  terminalGeneration: number | null;
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

const sameGraphIdentity = (
  left: VscodeCanvasFeedbackGraphIdentity | undefined,
  right: VscodeCanvasFeedbackGraphIdentity | undefined
): boolean => left === right || Boolean(left && right &&
  left.hostDocumentUri === right.hostDocumentUri &&
  left.graphRevision === right.graphRevision &&
  left.sourceRevision === right.sourceRevision);

const sameFrameIdentity = (left: VscodeCanvasFrameIdentity, right: VscodeCanvasFrameIdentity): boolean =>
  left.documentVersion === right.documentVersion &&
  left.updateGeneration === right.updateGeneration &&
  left.sourceRevision === right.sourceRevision &&
  sameGraphIdentity(left.graphIdentity, right.graphIdentity) &&
  left.evaluationRevision === right.evaluationRevision &&
  left.evaluationRequestRevision === right.evaluationRequestRevision;

export type CanvasUpdateProgress = {
  generation: number;
  documentVersion: number;
  message: string;
};

export class SurfaceFeedbackDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("nuinuiCAD surface feedback");
  private readonly contentChanged = new vscode.EventEmitter<vscode.Uri>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly contents = new Map<string, string>();
  private readonly providerRegistration: vscode.Disposable;
  private nextSessionId = 1;
  private nextCanvasUpdateGeneration = 1;

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
    this.sessions.set(id, {
      session,
      lastPresentationId: -1,
      lastPublication: null,
      diagnostics: [],
      canvasUpdate: null,
      terminalDiagnostic: null,
      terminalGeneration: null
    });
    return session;
  }

  beginCanvasUpdate(
    session: SurfaceFeedbackSession,
    input: {
      documentVersion: number;
      message: string;
      graphIdentity?: VscodeCanvasFeedbackGraphIdentity;
      forceNewGeneration?: boolean;
    }
  ): CanvasUpdateProgress | null {
    const state = this.sessions.get(session.id);
    if (state?.session !== session || session.surface !== "canvas" ||
        !Number.isSafeInteger(input.documentVersion) || input.documentVersion < 0 || !input.message) return null;
    if (state.canvasUpdate?.documentVersion === input.documentVersion && !input.forceNewGeneration) {
      if (input.graphIdentity) state.canvasUpdate.graphIdentity = input.graphIdentity;
      state.canvasUpdate.message = input.message;
      this.publish(state);
      return {
        generation: state.canvasUpdate.generation,
        documentVersion: state.canvasUpdate.documentVersion,
        message: state.canvasUpdate.message
      };
    }
    state.canvasUpdate = {
      generation: this.nextCanvasUpdateGeneration++,
      documentVersion: input.documentVersion,
      message: input.message,
      ...(input.graphIdentity ? { graphIdentity: input.graphIdentity } : {}),
      frameIdentity: null
    };
    state.terminalDiagnostic = null;
    state.terminalGeneration = null;
    this.publish(state);
    return {
      generation: state.canvasUpdate.generation,
      documentVersion: state.canvasUpdate.documentVersion,
      message: state.canvasUpdate.message
    };
  }

  currentCanvasUpdate(session: SurfaceFeedbackSession): CanvasUpdateProgress | null {
    const update = this.sessions.get(session.id)?.canvasUpdate;
    if (this.sessions.get(session.id)?.session !== session || !update) return null;
    return { generation: update.generation, documentVersion: update.documentVersion, message: update.message };
  }

  setCanvasUpdateGraphIdentity(
    session: SurfaceFeedbackSession,
    update: Pick<CanvasUpdateProgress, "generation" | "documentVersion">,
    graphIdentity: VscodeCanvasFeedbackGraphIdentity
  ): boolean {
    const state = this.sessions.get(session.id);
    if (state?.session !== session || state.canvasUpdate?.generation !== update.generation ||
        state.canvasUpdate.documentVersion !== update.documentVersion) return false;
    state.canvasUpdate.graphIdentity = graphIdentity;
    state.canvasUpdate.frameIdentity = null;
    this.publish(state);
    return true;
  }

  terminateCanvasUpdate(
    session: SurfaceFeedbackSession,
    input: {
      generation: number;
      documentVersion: number;
      diagnostic?: VscodeSurfaceFeedbackDiagnostic;
    }
  ): boolean {
    const state = this.sessions.get(session.id);
    if (state?.session !== session || state.canvasUpdate?.generation !== input.generation ||
        state.canvasUpdate.documentVersion !== input.documentVersion) return false;
    state.canvasUpdate = null;
    state.terminalDiagnostic = input.diagnostic ?? null;
    state.terminalGeneration = input.generation;
    this.publish(state);
    return true;
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
    state.lastPresentationId = publication.presentationId;
    state.lastPublication = serialized;
    state.diagnostics = publication.diagnostics;
    const progress = state.canvasUpdate;
    if (session.surface === "canvas" && progress && publication.canvasUpdate?.generation === progress.generation &&
        publication.documentVersion === progress.documentVersion) {
      if (publication.canvasUpdate.outcome === "terminal") {
        state.canvasUpdate = null;
        state.terminalDiagnostic = null;
        state.terminalGeneration = null;
      } else {
        progress.frameIdentity = publication.canvasUpdate.frameIdentity ?? null;
      }
    } else if (session.surface === "canvas" && state.terminalDiagnostic &&
        publication.canvasUpdate?.outcome === "terminal" &&
        publication.canvasUpdate.generation === state.terminalGeneration) {
      state.terminalDiagnostic = null;
      state.terminalGeneration = null;
    }
    this.publish(state);
    return true;
  }

  completeCanvasUpdate(session: SurfaceFeedbackSession, completion: VscodeCanvasFrameDrawn): boolean {
    if (!isVscodeCanvasFrameDrawn(completion)) return false;
    const state = this.sessions.get(session.id);
    const update = state?.canvasUpdate;
    if (state?.session !== session || session.surface !== "canvas" || !update ||
        update.documentVersion !== completion.documentVersion || update.generation !== completion.updateGeneration ||
        !update.frameIdentity || !sameFrameIdentity(update.frameIdentity, {
          documentVersion: completion.documentVersion,
          updateGeneration: completion.updateGeneration,
          sourceRevision: completion.sourceRevision,
          ...(completion.graphIdentity ? { graphIdentity: completion.graphIdentity } : {}),
          evaluationRevision: completion.evaluationRevision,
          evaluationRequestRevision: completion.evaluationRequestRevision
        }) ||
        (update.graphIdentity && !sameGraphIdentity(update.graphIdentity, completion.graphIdentity))) return false;
    state.canvasUpdate = null;
    state.terminalDiagnostic = null;
    state.terminalGeneration = null;
    this.publish(state);
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

  private publish(state: SessionState): void {
    const { session } = state;
    const items: VscodeSurfaceFeedbackDiagnostic[] = [...state.diagnostics];
    if (state.canvasUpdate) {
      items.push({ id: "canvas-updating", severity: "info", message: state.canvasUpdate.message });
    }
    if (state.terminalDiagnostic && !items.some((item) => item.id === state.terminalDiagnostic?.id)) {
      items.push(state.terminalDiagnostic);
    }
    const lines = [`${surfaceLabelFor(session.surface)} diagnostics`, ""];
    const diagnostics = items.map((item) => {
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
    this.contents.set(session.uri.toString(), lines.join("\n"));
    this.contentChanged.fire(session.uri);
    if (diagnostics.length > 0) this.collection.set(session.uri, diagnostics);
    else this.collection.delete(session.uri);
  }
}
