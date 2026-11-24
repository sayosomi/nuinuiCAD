import { basename } from "node:path";
import * as vscode from "vscode";
import {
  defaultOutputExportPath,
  ensureOutputExportExtension,
  isLastGoodDslDocument,
  type LastGoodDslDocument
} from "@nuinuicad/nui-language/document";
import {
  projectDslOutputPreviewRevealRuntimeTarget,
  queryDslOutputPreviewRevealSourceTarget,
  type NormalizedSourceRange
} from "@nuinuicad/nui-language";
import type { OutputPreviewRevealTarget } from "../../src/output/outputPreviewReveal";
import { evaluateOutputPlan } from "../../src/output/outputCore";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";
import { evaluatePreparedRust, prepareRustEvaluation, type PreparedRustEvaluation } from "../../src/geometry/rustEvaluationRunner";
import type { EvaluationPayload } from "../../src/geometry/evaluationPayload";
import {
  outputPreviewGraphAuthorityFor,
  outputPreviewRequiresGraph,
  outputPreviewSourceEditingFor,
  sameOutputPreviewGraphAuthority,
  type VscodeMultiDocumentGraphPublication,
  type VscodeOutputPreviewGraphAuthority
} from "../../src/vscode/multiDocumentGraphTransport";
import { serializeSourceEditingDocument } from "../../src/vscode/multiDocumentRuntimeTransport";
import { outputPreviewCandidateForKey, outputPreviewCandidatesFor } from "../../src/vscode/outputPreviewSelection";
import type {
  ExtensionToVscodeMessage,
  VscodeDocumentChangeReason,
  VscodeToExtensionMessage
} from "../../src/vscode/protocol";
import type {
  VscodeOutputPreviewExportAvailability,
  VscodeOutputPreviewExportRequest,
  VscodeOutputPreviewPlanRequest,
  VscodeOutputPreviewRevealResult
} from "../../src/vscode/outputPreviewProtocol";
import type { VscodeWebviewSessionBase } from "../../src/vscode/vscodeWebviewSession";
import type { VscodeMultiDocumentDiagnosticSnapshot } from "./multiDocumentHost";
import type { VscodeOutputPreviewRevealSourceTargetResult } from "./referencePickCommandFeature";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";
import {
  createOutputPreviewSourceInteractionFeature
} from "./outputPreviewSourceInteractionFeature";
import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryDirection
} from "./outputPreviewHistory";
import { outputPreviewTranslatorFor } from "./outputPreviewLocalization";
import { webviewPresentationFor } from "./webviewPresentationLocalization";
import type { WebviewEditableFocusAttachment, WebviewEditableFocusWebview } from "./webviewEditableFocusContext";

type OutputPreviewGraphContext = {
  authority: VscodeOutputPreviewGraphAuthority;
  snapshot: VscodeMultiDocumentDiagnosticSnapshot;
  compiled: LastGoodDslDocument;
  prepared: PreparedRustEvaluation;
};

export type OutputPreviewSession = VscodeWebviewSessionBase & {
  surfaceKind: "outputPreview";
  documentUri: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  disposables: vscode.Disposable[];
  webviewReady: boolean;
  authoritativeDocumentVersion: number | null;
  pendingOpen: { normalizedSourceOffset: number | null } | null;
  pendingReveal: {
    requestId: number;
    documentVersion: number;
    normalizedSourceOffset: number;
    graphAuthority?: VscodeOutputPreviewGraphAuthority;
  } | null;
  inFlightRevealRequestId: number | null;
  latestRevealRequestId: number | null;
  exportAvailability: Omit<VscodeOutputPreviewExportAvailability, "type"> | null;
  inFlightExportRequestId: number | null;
  graphRequired: boolean;
  graphContext: OutputPreviewGraphContext | null;
  graphPublicationSequence: number;
};

type OutputPreviewRegistry = {
  get: (documentUri: string) => OutputPreviewSession | undefined;
  set: (session: OutputPreviewSession) => void;
  replayGraph: (session: OutputPreviewSession) => void;
  delete: (documentUri: string) => boolean;
  values: () => OutputPreviewSession[];
};

export type OutputPreviewFeatureHost = {
  registry: OutputPreviewRegistry;
  extensionUri: vscode.Uri;
  webviewHtml: (panel: vscode.WebviewPanel) => string;
  postAuthoritativeDocument: (panel: vscode.WebviewPanel, document: vscode.TextDocument) => void;
  postDocumentText: (
    panel: vscode.WebviewPanel,
    sourceText: string,
    documentVersion: number,
    reason: VscodeDocumentChangeReason
  ) => void;
  documentChangeReasonFor: (reason: vscode.TextDocumentChangeReason | undefined) => VscodeDocumentChangeReason;
  documentKey: (document: vscode.TextDocument) => string;
  canonicalDocumentUri: (document: vscode.TextDocument) => string;
  graphSnapshotFor: (document: vscode.TextDocument) => VscodeMultiDocumentDiagnosticSnapshot | null;
  revalidateGraphAuthority: (document: vscode.TextDocument, authority: VscodeOutputPreviewGraphAuthority) => Promise<boolean>;
  sameDocument: (left: vscode.TextDocument, right: vscode.TextDocument) => boolean;
  isOpenDocument: (document: vscode.TextDocument) => boolean;
  visibleEditorFor: (document: vscode.TextDocument) => vscode.TextEditor | undefined;
  isNormalizedRangeSafe: (document: vscode.TextDocument, range: NormalizedSourceRange) => boolean;
  requestRustEvaluation: (
    input: Extract<VscodeToExtensionMessage, { type: "rustEvaluationRequest" }> ["input"]
  ) => Promise<EvaluationPayload>;
  exportOutput: (request: {
    path: string;
    payload: VscodeOutputPreviewExportRequest["payload"];
  }) => Promise<void>;
  activeNuiTextEditorForCommand: () => vscode.TextEditor | undefined;
  outputPreviewRevealSourceTargetForEditor: (
    editor: vscode.TextEditor
  ) => VscodeOutputPreviewRevealSourceTargetResult;
  activeCanvasDocumentForOpenCommand: () => vscode.TextDocument | null;
  isOutputPreviewTabActive: () => boolean;
  attachWebviewEditableFocus?: (webview: WebviewEditableFocusWebview) => WebviewEditableFocusAttachment;
  displayLanguageFor?: () => string;
};

export type OutputPreviewFeature = vscode.Disposable & {
  openForDocument: (
    document: vscode.TextDocument,
    normalizedSourceOffset: number | null,
    preserveFocus?: boolean
  ) => OutputPreviewSession;
  activeSessionForOpenCommand: () => OutputPreviewSession | null;
  disposeSession: (session: OutputPreviewSession) => void;
};

/**
 * Owns the Output Preview Extension Host lifecycle, commands, and Webview
 * routing. The Extension Host composition root supplies only shared registry,
 * document, and Rust-process adapters.
 */
export const registerOutputPreviewFeature = (host: OutputPreviewFeatureHost): OutputPreviewFeature => {
  type OutputPreviewViewportAction = "outputPreviewFit" | "outputPreviewResetView";
  let nextRevealRequestId = 1;
  let lastActiveSession: OutputPreviewSession | null = null;

  const displayLanguage = (): string => {
    if (host.displayLanguageFor) return host.displayLanguageFor();
    try {
      return vscode.env?.language ?? "en";
    } catch {
      return "en";
    }
  };

  const activeSession = (): OutputPreviewSession | null => {
    if (!host.isOutputPreviewTabActive()) return null;
    const current = host.registry.values().find((candidate) => candidate.panel.active);
    if (current) {
      lastActiveSession = current;
      return current;
    }
    const remembered = lastActiveSession;
    return remembered &&
      host.registry.get(remembered.documentUri) === remembered &&
      remembered.panel.visible
      ? remembered
      : null;
  };

  const activeSessionForOpenCommand = (): OutputPreviewSession | null =>
    host.isOutputPreviewTabActive() ? activeSession() : null;

  const graphContextFor = (session: OutputPreviewSession): OutputPreviewGraphContext | null => {
    const context = session.graphContext;
    return context && host.graphSnapshotFor(session.document) === context.snapshot ? context : null;
  };

  const actionAuthorityIsCurrent = (
    session: OutputPreviewSession,
    authority: VscodeOutputPreviewGraphAuthority | undefined
  ): boolean => {
    if (host.registry.get(session.documentUri) !== session || !host.isOpenDocument(session.document)) return false;
    if (!session.graphRequired) return authority === undefined;
    const context = graphContextFor(session);
    return context !== null && sameOutputPreviewGraphAuthority(context.authority, authority);
  };

  const revalidateActionAuthority = async (
    session: OutputPreviewSession,
    authority: VscodeOutputPreviewGraphAuthority
  ): Promise<boolean> => actionAuthorityIsCurrent(session, authority) &&
    await host.revalidateGraphAuthority(session.document, authority) &&
    actionAuthorityIsCurrent(session, authority);

  const resyncOutputPreview = (session: OutputPreviewSession): void => {
    if (host.registry.get(session.documentUri) !== session || !host.isOpenDocument(session.document)) return;
    session.authoritativeDocumentVersion = null;
    session.pendingReveal = null;
    session.inFlightRevealRequestId = null;
    session.latestRevealRequestId = null;
    host.postAuthoritativeDocument(session.panel, session.document);
    host.registry.replayGraph(session);
  };

  const sourceInteraction = createOutputPreviewSourceInteractionFeature({
    isSessionCurrent: (session) => host.registry.get(host.documentKey(session.document)) === session,
    isAuthorityCurrent: (session, authority) => {
      const current = host.registry.get(host.documentKey(session.document));
      return current === session && actionAuthorityIsCurrent(current, authority);
    },
    revalidateAuthority: async (session, authority) => {
      const current = host.registry.get(host.documentKey(session.document));
      return current === session && revalidateActionAuthority(current, authority);
    },
    isOpenDocument: host.isOpenDocument,
    sameDocument: host.sameDocument,
    isNormalizedRangeSafe: host.isNormalizedRangeSafe,
    visibleEditorFor: host.visibleEditorFor,
    resyncOutputPreview: (session) => {
      const current = host.registry.get(host.documentKey(session.document));
      if (current?.panel === session.panel) resyncOutputPreview(current);
    }
  });

  const deliverPendingOpen = (session: OutputPreviewSession): void => {
    const pending = session.pendingOpen;
    if (
      !pending ||
      !session.webviewReady ||
      session.authoritativeDocumentVersion !== session.document.version
    ) return;
    session.pendingOpen = null;
    void session.panel.webview.postMessage({
      type: "outputPreviewOpen",
      documentVersion: session.document.version,
      normalizedSourceOffset: pending.normalizedSourceOffset
    } satisfies ExtensionToVscodeMessage);
  };

  const deliverPendingReveal = async (session: OutputPreviewSession): Promise<void> => {
    const pending = session.pendingReveal;
    if (!pending || !session.webviewReady || session.authoritativeDocumentVersion !== session.document.version) return;
    if (
      host.registry.get(session.documentUri) !== session ||
      !host.isOpenDocument(session.document) ||
      pending.documentVersion !== session.document.version ||
      session.latestRevealRequestId !== pending.requestId
    ) {
      session.pendingReveal = null;
      session.inFlightRevealRequestId = null;
      return;
    }
    const graphContext = graphContextFor(session);
    if (session.graphRequired && !graphContext) return;
    if (!sameOutputPreviewGraphAuthority(graphContext?.authority, pending.graphAuthority)) {
      invalidateReveal(session);
      return;
    }
    if (pending.graphAuthority && (
      !await revalidateActionAuthority(session, pending.graphAuthority) ||
      session.pendingReveal !== pending || session.authoritativeDocumentVersion !== pending.documentVersion
    )) return;
    let runtimeTarget: OutputPreviewRevealTarget | undefined;
    if (graphContext) {
      const { compiled, authority } = graphContext;
      const sourceTarget = queryDslOutputPreviewRevealSourceTarget({
        compiled,
        source: { normalizedSource: compiled.spans.sourceMap.source, sourceRevision: authority.rootSourceRevision },
        position: pending.normalizedSourceOffset
      });
      if (sourceTarget.status === "resolved") {
        const target = sourceTarget.target;
        if (target.kind === "group" || target.kind === "geometry" || target.kind === "semantic") {
          const projected = projectDslOutputPreviewRevealRuntimeTarget({
            target, compiled, moduleGeometryRuntime: compiled.moduleGeometryRuntime, elements: compiled.document.elements
          });
          if (projected.status === "resolved") runtimeTarget = projected.target;
        } else {
          runtimeTarget = target;
        }
      }
    }
    session.pendingReveal = null;
    session.inFlightRevealRequestId = pending.requestId;
    void session.panel.webview.postMessage({
      type: "outputPreviewReveal",
      requestId: pending.requestId,
      documentVersion: pending.documentVersion,
      normalizedSourceOffset: pending.normalizedSourceOffset,
      ...(graphContext ? { graphAuthority: graphContext.authority, runtimeTarget } : {})
    } satisfies ExtensionToVscodeMessage);
  };

  const revealFailureMessageFor = (
    reason: Exclude<VscodeOutputPreviewRevealResult, { status: "resolved" }> ["reason"],
    currentDisplayLanguage: string
  ): string => {
    const translator = outputPreviewTranslatorFor(currentDisplayLanguage);
    if (reason === "no-containing-output") {
      return translator("outputPreview.reveal.no-containing-output");
    }
    if (reason === "evaluation-failed") {
      return translator("outputPreview.reveal.evaluation-failed");
    }
    return translator("outputPreview.reveal.target-unavailable");
  };

  const invalidateReveal = (session: OutputPreviewSession): void => {
    session.pendingReveal = null;
    session.inFlightRevealRequestId = null;
    session.latestRevealRequestId = null;
  };

  const publishGraph = async (
    session: OutputPreviewSession,
    publication: VscodeMultiDocumentGraphPublication,
    sequence: number
  ): Promise<void> => {
    if (!session.webviewReady) return;
    const document = session.document;
    const hostDocumentUri = host.canonicalDocumentUri(document);
    if (publication.hostDocumentUri !== hostDocumentUri ||
      (publication.documentVersion !== document.version && publication.status !== "unavailable")) return;
    const outputPreview: NonNullable<VscodeMultiDocumentGraphPublication["outputPreview"]> = { sequence };
    let context: OutputPreviewGraphContext | null = null;
    if (publication.status === "current" && session.graphRequired) {
      const source = normalizedSourceFor(document.getText());
      const authority = outputPreviewGraphAuthorityFor(
        publication, hostDocumentUri, document.version, source
      );
      if (!authority) return;
      const snapshot = host.graphSnapshotFor(document);
      if (!snapshot || snapshot.graphRevision !== authority.graphRevision) return;
      const compiled = snapshot.compiled;
      const dependencyFingerprints: ReadonlyMap<string, string> = snapshot.graph.dependencyFingerprints;
      if (
        snapshot.documentVersion === authority.documentVersion &&
        String(snapshot.graph.rootDocumentId) === authority.hostDocumentUri &&
        snapshot.graph.rootSource.sourceRevision === authority.rootSourceRevision &&
        snapshot.graph.rootSource.normalizedSource === source &&
        publication.graph.dependencyFingerprints.length === dependencyFingerprints.size &&
        publication.graph.dependencyFingerprints.every(({ documentId, savedSourceFingerprint }) =>
          dependencyFingerprints.get(documentId) === savedSourceFingerprint
        )
      ) {
        outputPreview.error = snapshot.diagnostics.find(diagnostic => diagnostic.severity === "error")?.message;
        if (compiled && isLastGoodDslDocument(compiled)) {
          const runtime = publication.canvasRuntime;
          const graphRuntime = runtime && !runtime.identityOnly ? runtime : null;
          const sourceEditing = graphRuntime?.modulePresentation.sourceEditing ?? serializeSourceEditingDocument(compiled);
          const prepared = graphRuntime?.preparedRustEvaluation ?? prepareRustEvaluation(
            compiled.document.elements,
            buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: compiled.document.evaluationLimitIndex })
          );
          const candidate = { ...outputPreview, sourceEditing };
          if (
            snapshot.graph.valid && compiled.moduleRuntimeContext?.graph === snapshot.graph &&
            compiled.moduleRuntimeContext.valid && prepared.rustEligible &&
            sourceEditing?.spans.sourceMap === compiled.spans.sourceMap &&
            sourceEditing.document.elements === compiled.document.elements &&
            prepared.input.elements === compiled.document.elements &&
            outputPreviewSourceEditingFor({ ...publication, outputPreview: candidate })
          ) {
            outputPreview.sourceEditing = sourceEditing;
            context = { authority, snapshot, compiled, prepared };
          }
        }
      }
    }
    if (context && (
      !await host.revalidateGraphAuthority(document, context.authority) ||
      host.graphSnapshotFor(document) !== context.snapshot
    )) return;
    if (sequence !== session.graphPublicationSequence || host.registry.get(session.documentUri) !== session) return;
    if (session.graphContext?.snapshot !== context?.snapshot) {
      session.exportAvailability = null;
      if (session.graphContext) invalidateReveal(session);
    }
    session.graphContext = context;
    void session.panel.webview.postMessage({ ...publication, outputPreview } satisfies ExtensionToVscodeMessage);
    void deliverPendingReveal(session);
  };

  const handlePlanRequest = async (session: OutputPreviewSession, message: VscodeOutputPreviewPlanRequest): Promise<void> => {
    const { requestId, graphAuthority, outputKey } = message;
    const respond = (result: { plan: Awaited<ReturnType<typeof evaluateOutputPlan>> } | { error: string }): void => {
      if (host.registry.get(session.documentUri) !== session) return;
      void session.panel.webview.postMessage({
        type: "outputPreviewPlanResult", requestId, graphAuthority, ...result
      } satisfies ExtensionToVscodeMessage);
    };
    const context = graphContextFor(session);
    const compiled = context?.compiled;
    const candidate = compiled && outputPreviewCandidateForKey(
      outputPreviewCandidatesFor(compiled.spans.sourceMap.source, compiled), outputKey
    );
    if (
      !context || !candidate || session.authoritativeDocumentVersion !== session.document.version ||
      !await revalidateActionAuthority(session, graphAuthority)
    ) {
      respond({ error: "The current Output Preview graph is unavailable." });
      return;
    }
    const result = await evaluateOutputPlan({
      compiledDocument: context.compiled,
      output: candidate.output,
      evaluate: () => evaluatePreparedRust(context.prepared, host.requestRustEvaluation)
    }).then(
      plan => ({ plan }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })
    );
    if (!await revalidateActionAuthority(session, graphAuthority)) {
      respond({ error: "The Output Preview graph changed during evaluation." });
      return;
    }
    respond(result);
  };

  const handleRevealResult = async (
    session: OutputPreviewSession,
    message: VscodeOutputPreviewRevealResult
  ): Promise<void> => {
    const isInFlight = () => session.inFlightRevealRequestId === message.requestId &&
      session.latestRevealRequestId === message.requestId;
    if (!isInFlight()) return;
    if (
      host.registry.get(session.documentUri) !== session ||
      !host.isOpenDocument(session.document) ||
      message.documentVersion !== session.document.version ||
      !actionAuthorityIsCurrent(session, message.graphAuthority)
    ) return;
    if (message.graphAuthority &&
      (!await revalidateActionAuthority(session, message.graphAuthority) || !isInFlight())) return;
    session.inFlightRevealRequestId = null;
    if (message.status === "failed") {
      if (message.reason !== "stale") {
        void vscode.window.showErrorMessage(revealFailureMessageFor(message.reason, displayLanguage()));
      }
      return;
    }
    session.panel.reveal(vscode.ViewColumn.Beside, false);
  };

  const postExportResult = (
    session: OutputPreviewSession,
    requestId: number,
    status: "saved" | "cancelled" | "failed"
  ): void => {
    void session.panel.webview.postMessage({
      type: "outputPreviewExportResult",
      requestId,
      status
    } satisfies ExtensionToVscodeMessage);
  };

  const postViewportAction = (session: OutputPreviewSession, action: OutputPreviewViewportAction): void => {
    if (!session.webviewReady) return;
    if (action === "outputPreviewFit" && session.authoritativeDocumentVersion !== session.document.version) return;
    void session.panel.webview.postMessage({ type: action } satisfies ExtensionToVscodeMessage);
  };

  const exportRequestIsCurrent = (
    session: OutputPreviewSession,
    message: VscodeOutputPreviewExportRequest
  ): boolean => {
    const availability = session.exportAvailability;
    const payloadMatchesFormat = message.format === "pdf"
      ? message.payload.kind === "print"
      : message.payload.kind === "svg";
    return host.registry.get(session.documentUri) === session
      && payloadMatchesFormat
      && session.panel.active
      && host.isOpenDocument(session.document)
      && session.webviewReady
      && session.authoritativeDocumentVersion === session.document.version
      && session.document.version === message.documentVersion
      && availability?.documentVersion === message.documentVersion
      && availability.outputKey === message.outputKey
      && availability.format === message.format
      && sameOutputPreviewGraphAuthority(availability.graphAuthority, message.graphAuthority)
      && actionAuthorityIsCurrent(session, message.graphAuthority);
  };

  const handleExport = async (
    session: OutputPreviewSession,
    message: VscodeOutputPreviewExportRequest
  ): Promise<void> => {
    const translator = outputPreviewTranslatorFor(displayLanguage());
    if (session.inFlightExportRequestId !== null || !exportRequestIsCurrent(session, message)) {
      postExportResult(session, message.requestId, "failed");
      void vscode.window.showErrorMessage(translator("outputPreview.changed"));
      return;
    }
    session.inFlightExportRequestId = message.requestId;
    const defaultPath = defaultOutputExportPath({
      outputName: message.outputName,
      documentPath: session.document.fileName,
      extension: message.format
    });
    try {
      if (message.graphAuthority && (
        !await revalidateActionAuthority(session, message.graphAuthority) || !exportRequestIsCurrent(session, message)
      )) {
        postExportResult(session, message.requestId, "failed");
        void vscode.window.showErrorMessage(translator("outputPreview.changed"));
        return;
      }
      const selected = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultPath),
        filters: message.format === "pdf"
          ? { [translator("outputPreview.pdfDocument")]: ["pdf"] }
          : { [translator("outputPreview.svgDocument")]: ["svg"] },
        saveLabel: message.format === "pdf"
          ? translator("outputPreview.exportPdf")
          : translator("outputPreview.exportSvg")
      });
      if ((message.graphAuthority && !await revalidateActionAuthority(session, message.graphAuthority)) ||
        (selected && !exportRequestIsCurrent(session, message))) {
        postExportResult(session, message.requestId, "failed");
        void vscode.window.showErrorMessage(translator("outputPreview.changedWhileSaving"));
        return;
      }
      if (!selected) {
        postExportResult(session, message.requestId, "cancelled");
        return;
      }
      if (selected.scheme !== "file") throw new Error(translator("outputPreview.localFileOnly"));
      const path = ensureOutputExportExtension(selected.fsPath, message.format);
      await host.exportOutput({ path, payload: message.payload });
      postExportResult(session, message.requestId, "saved");
      void vscode.window.showInformationMessage(translator("outputPreview.saved", { fileName: basename(path) }));
    } catch (error) {
      postExportResult(session, message.requestId, "failed");
      void vscode.window.showErrorMessage(
        translator("outputPreview.exportFailed", {
          error: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      if (session.inFlightExportRequestId === message.requestId) session.inFlightExportRequestId = null;
    }
  };

  const handleRustEvaluationRequest = async (
    session: OutputPreviewSession,
    message: Extract<VscodeToExtensionMessage, { type: "rustEvaluationRequest" }>
  ): Promise<void> => {
    try {
      const payload = await host.requestRustEvaluation(message.input);
      void session.panel.webview.postMessage({ type: "rustEvaluationResponse", id: message.id, payload } satisfies ExtensionToVscodeMessage);
    } catch (error) {
      void session.panel.webview.postMessage({
        type: "rustEvaluationError",
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      } satisfies ExtensionToVscodeMessage);
    }
  };

  const disposeSession = (session: OutputPreviewSession): void => {
    if (host.registry.get(session.documentUri) !== session) return;
    if (lastActiveSession === session) lastActiveSession = null;
    session.pendingOpen = null;
    invalidateReveal(session);
    host.registry.delete(session.documentUri);
    for (const disposable of session.disposables.splice(0)) disposable.dispose();
  };

  const getOrCreateSession = (
    document: vscode.TextDocument,
    preserveFocus: boolean
  ): OutputPreviewSession => {
    const documentUri = host.documentKey(document);
    const existing = host.registry.get(documentUri);
    if (existing) {
      if (preserveFocus) existing.panel.reveal(vscode.ViewColumn.Beside, true);
      else existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "nuinuiCAD.outputPreview",
      outputPreviewTranslatorFor(displayLanguage())("outputPreview.panelTitle", {
        document: basename(document.fileName)
      }),
      preserveFocus
        ? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
        : vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(host.extensionUri, "dist")]
      }
    );
    panel.webview.html = host.webviewHtml(panel);
    const session: OutputPreviewSession = {
      documentUri,
      surfaceKind: "outputPreview",
      document,
      panel,
      disposables: [],
      webviewReady: false,
      authoritativeDocumentVersion: null,
      pendingOpen: null,
      pendingReveal: null,
      inFlightRevealRequestId: null,
      latestRevealRequestId: null,
      exportAvailability: null,
      inFlightExportRequestId: null,
      graphRequired: outputPreviewRequiresGraph(document.getText()),
      graphContext: null,
      graphPublicationSequence: 0,
      receiveMultiDocumentGraphPublication: publication => {
        void publishGraph(session, publication, ++session.graphPublicationSequence);
      }
    };
    host.registry.set(session);
    if (panel.active) lastActiveSession = session;

    session.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (!host.sameDocument(event.document, session.document) || event.contentChanges.length === 0) return;
      session.authoritativeDocumentVersion = null;
      session.exportAvailability = null;
      session.graphContext = null;
      session.graphRequired = outputPreviewRequiresGraph(event.document.getText());
      invalidateReveal(session);
      host.postDocumentText(panel, event.document.getText(), event.document.version, host.documentChangeReasonFor(event.reason));
    }));
    session.disposables.push(panel.webview.onDidReceiveMessage(async (message: VscodeToExtensionMessage) => {
      if (message.type === "webviewReady") {
        session.webviewReady = true;
        session.authoritativeDocumentVersion = null;
        session.exportAvailability = null;
        if (session.pendingReveal) session.inFlightRevealRequestId = null;
        else invalidateReveal(session);
        void panel.webview.postMessage({
          type: "webviewPresentation",
          presentation: webviewPresentationFor(displayLanguage())
        } satisfies ExtensionToVscodeMessage);
        host.postAuthoritativeDocument(panel, session.document);
        host.registry.replayGraph(session);
        return;
      }
      if (message.type === "webviewAuthoritativeDocumentReady") {
        if (message.documentVersion !== session.document.version) return;
        session.authoritativeDocumentVersion = message.documentVersion;
        deliverPendingOpen(session);
        void deliverPendingReveal(session);
        return;
      }
      if (message.type === "outputPreviewFit" || message.type === "outputPreviewResetView") {
        postViewportAction(session, message.type);
        return;
      }
      if (message.type === "outputPreviewExportAvailability") {
        if (
          message.documentVersion !== session.document.version ||
          session.authoritativeDocumentVersion !== session.document.version ||
          !actionAuthorityIsCurrent(session, message.graphAuthority)
        ) {
          session.exportAvailability = null;
          return;
        }
        session.exportAvailability = {
          documentVersion: message.documentVersion,
          outputKey: message.outputKey,
          format: message.format,
          graphAuthority: message.graphAuthority
        };
        return;
      }
      if (message.type === "outputPreviewExportRequest") {
        await handleExport(session, message);
        return;
      }
      if (message.type === "outputPreviewInsertTemplate") {
        await sourceInteraction.handleInsertTemplate(session, message);
        return;
      }
      if (message.type === "outputPreviewPlanRequest") {
        await handlePlanRequest(session, message);
        return;
      }
      if (message.type === "outputPreviewRevealResult") {
        await handleRevealResult(session, message);
        return;
      }
      if (message.type === "outputPreviewSourceNavigation") {
        await sourceInteraction.handleSourceNavigation(session, message);
        return;
      }
      if (message.type === "outputPreviewPlaceCommit") {
        await sourceInteraction.applyPlaceCommit(session, message);
        return;
      }
      if (message.type === "rustEvaluationRequest") await handleRustEvaluationRequest(session, message);
    }));
    session.disposables.push(panel.onDidChangeViewState(() => {
      if (panel.active) lastActiveSession = session;
    }));
    const editableFocusAttachment = host.attachWebviewEditableFocus?.(panel.webview);
    if (editableFocusAttachment) session.disposables.push(editableFocusAttachment);
    panel.onDidDispose(() => disposeSession(session));
    return session;
  };

  const openForDocument = (
    document: vscode.TextDocument,
    normalizedSourceOffset: number | null,
    preserveFocus = false
  ): OutputPreviewSession => {
    const session = getOrCreateSession(document, preserveFocus);
    invalidateReveal(session);
    session.pendingOpen = { normalizedSourceOffset };
    deliverPendingOpen(session);
    return session;
  };

  const executeOpen = (): void => {
    const editor = host.activeNuiTextEditorForCommand();
    if (editor) {
      const offset = normalizedOffsetFromRaw(editor.document.getText(), editor.document.offsetAt(editor.selection.active));
      openForDocument(editor.document, offset);
      return;
    }
    const canvasDocument = host.activeCanvasDocumentForOpenCommand();
    if (canvasDocument) {
      openForDocument(canvasDocument, null);
      return;
    }
    void vscode.window.showErrorMessage(
      outputPreviewTranslatorFor(displayLanguage())("outputPreview.requiresSourceOrCanvas")
    );
  };

  const executeRevealInOutputPreview = async (): Promise<void> => {
    const translator = outputPreviewTranslatorFor(displayLanguage());
    const editor = host.activeNuiTextEditorForCommand();
    if (!editor) return;
    const target = host.outputPreviewRevealSourceTargetForEditor(editor);
    if (target.status === "failed") {
      const message = target.reason === "analysis-unavailable"
        ? translator("outputPreview.sourceReveal.analysis-unavailable")
        : target.reason === "source-mismatch"
          ? translator("outputPreview.sourceReveal.source-mismatch")
          : target.reason === "invalid-position"
            ? translator("outputPreview.sourceReveal.invalid-position")
            : translator("outputPreview.sourceReveal.no-target");
      void vscode.window.showErrorMessage(message);
      return;
    }

    const documentVersion = editor.document.version;
    if (!host.isOpenDocument(editor.document)) return;
    if (target.graphAuthority) {
      if (!await host.revalidateGraphAuthority(editor.document, target.graphAuthority)) return;
      const current = host.outputPreviewRevealSourceTargetForEditor(editor);
      if (host.activeNuiTextEditorForCommand() !== editor ||
        current.status !== "resolved" || current.normalizedSourceOffset !== target.normalizedSourceOffset ||
        !sameOutputPreviewGraphAuthority(current.graphAuthority, target.graphAuthority)) return;
    }
    const session = getOrCreateSession(editor.document, true);
    if (
      editor.document.version !== documentVersion ||
      host.registry.get(session.documentUri) !== session ||
      !host.isOpenDocument(session.document)
    ) return;

    const requestId = nextRevealRequestId++;
    session.pendingOpen = null;
    session.pendingReveal = {
      requestId,
      documentVersion,
      normalizedSourceOffset: target.normalizedSourceOffset,
      graphAuthority: target.graphAuthority
    };
    session.latestRevealRequestId = requestId;
    await deliverPendingReveal(session);
  };

  const executeFit = (): void => {
    const session = activeSession();
    if (session) postViewportAction(session, "outputPreviewFit");
  };

  const executeResetView = (): void => {
    const session = activeSession();
    if (session) postViewportAction(session, "outputPreviewResetView");
  };

  const executeClearFocus = (): void => {
    const session = activeSession();
    if (session?.webviewReady && session.authoritativeDocumentVersion === session.document.version) {
      void session.panel.webview.postMessage({ type: "outputPreviewClearFocus" } satisfies ExtensionToVscodeMessage);
    }
  };

  const executeExportCurrent = (): void => {
    const session = activeSessionForOpenCommand();
    if (!session) {
      void vscode.window.showErrorMessage(
        outputPreviewTranslatorFor(displayLanguage())("outputPreview.exportOnlyActive")
      );
      return;
    }
    if (
      session.inFlightExportRequestId !== null ||
      session.authoritativeDocumentVersion !== session.document.version ||
      session.exportAvailability?.documentVersion !== session.document.version ||
      session.exportAvailability.outputKey === null ||
      session.exportAvailability.format === null ||
      !actionAuthorityIsCurrent(session, session.exportAvailability.graphAuthority)
    ) {
      void vscode.window.showErrorMessage(
        outputPreviewTranslatorFor(displayLanguage())("outputPreview.noExportableOutput")
      );
      return;
    }
    void session.panel.webview.postMessage({ type: "outputPreviewExport" } satisfies ExtensionToVscodeMessage);
  };

  const executeHistory = async (direction: OutputPreviewHistoryDirection): Promise<void> => {
    const session = activeSessionForOpenCommand();
    if (!session) return;
    await handoffOutputPreviewHistory(direction, {
      isSessionCurrent: () => host.registry.get(session.documentUri) === session,
      isPanelActive: () => session.panel.active,
      isDocumentOpen: () => host.isOpenDocument(session.document),
      documentVersion: () => session.document.version,
      activateMatchingSource: async () => {
        const editor = host.visibleEditorFor(session.document);
        if (!editor) return false;
        try {
          const activatedEditor = await vscode.window.showTextDocument(session.document, {
            viewColumn: editor.viewColumn,
            preserveFocus: false,
            preview: false
          });
          return host.sameDocument(activatedEditor.document, session.document);
        } catch {
          return false;
        }
      },
      executeNativeHistory: async (nativeDirection) => {
        await vscode.commands.executeCommand(nativeDirection);
      },
      restorePreviewFocus: () => session.panel.reveal(undefined, false)
    });
  };

  const commandDisposables = [
    vscode.commands.registerCommand("nuinuiCAD.openOutputPreview", executeOpen),
    vscode.commands.registerCommand("nuinuiCAD.revealInOutputPreview", executeRevealInOutputPreview),
    vscode.commands.registerCommand("nuinuiCAD.resetOutputPreviewView", executeResetView),
    vscode.commands.registerCommand("nuinuiCAD.fitOutputPreview", executeFit),
    vscode.commands.registerCommand("nuinuiCAD.clearOutputPreviewFocus", executeClearFocus),
    vscode.commands.registerCommand("nuinuiCAD.exportCurrentOutput", executeExportCurrent),
    vscode.commands.registerCommand("nuinuiCAD.outputPreviewUndo", () => executeHistory("undo")),
    vscode.commands.registerCommand("nuinuiCAD.outputPreviewRedo", () => executeHistory("redo"))
  ];

  return {
    activeSessionForOpenCommand,
    openForDocument,
    disposeSession,
    dispose: () => {
      for (const disposable of commandDisposables) disposable.dispose();
    }
  };
};
