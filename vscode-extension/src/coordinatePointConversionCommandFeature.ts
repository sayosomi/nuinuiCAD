import * as vscode from "vscode";
import {
  coordinatePointConversionTargetEligibility
} from "../../src/commands/coordinatePointConversion";
import type { CoordinatePointConversionSessionOrigin } from "../../src/commands/coordinatePointConversionSession";
import type { CanonicalDocumentValue } from "../../src/document/canonicalDocument";
import { queryDslCanvasSourceTarget } from "../../src/dsl/dslNavigationQuery";
import type { NuiElementsTreeNode } from "./elementsTreeProvider";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createNuiRuntimeEvaluationService,
  type NuiRuntimeEvaluationService
} from "./runtimeEvaluationService";
import type { RustEvaluationProcessOwner } from "./rustEvaluationProcessOwner";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";
import {
  presentCoordinatePointConversionResult,
  type CoordinatePointConversionOutputTarget
} from "./coordinatePointConversionPresentation";

export const VSCODE_COORDINATE_POINT_CONVERSION_XY_COMMAND_ID =
  "nuinuiCAD.convertPointToXYOffset";
export const VSCODE_COORDINATE_POINT_CONVERSION_ANGLE_DISTANCE_COMMAND_ID =
  "nuinuiCAD.convertPointToAngleDistanceOffset";
export const VSCODE_COORDINATE_POINT_CONVERSION_SOURCE_TARGET_CONTEXT_KEY =
  "nuinuiCAD.coordinatePointConversionSourceTarget";
export const VSCODE_COORDINATE_POINT_CONVERSION_EXPLORER_CONTEXT_VALUE =
  "nuinuiCAD.coordinatePointConversionTarget";

export type CoordinatePointConversionCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
  targetIds: () => readonly string[];
};

export type CoordinatePointConversionFeatureHost = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  rustProcessOwner: Pick<RustEvaluationProcessOwner, "get">;
  ensureCanvas: (
    document: vscode.TextDocument
  ) => CoordinatePointConversionCanvasEndpoint | null | Promise<CoordinatePointConversionCanvasEndpoint | null>;
  activeCanvasEndpoint: () => CoordinatePointConversionCanvasEndpoint | null;
  activeExplorerDocument: () => vscode.TextDocument | undefined;
  isSourceEditorActive?: () => boolean;
  refreshElementsTree?: () => void;
  output?: () => CoordinatePointConversionOutputTarget;
};

export type VscodeCoordinatePointConversionFeature = vscode.Disposable & {
  explorerContextValueFor: (node: NuiElementsTreeNode) => string | undefined;
  handleDocumentChange: (document: vscode.TextDocument) => void;
  handleDocumentClose: (document: vscode.TextDocument) => void;
};

type SourceTargetResolution = {
  targetId: string;
  documentVersion: number;
  normalizedSource: string;
};

type ActiveRequest = {
  editor: vscode.TextEditor;
  endpoint: CoordinatePointConversionCanvasEndpoint;
  request: Extract<
    import("../../src/vscode/protocol").ExtensionToVscodeMessage,
    { type: "coordinatePointConversionStart" }
  >;
  selection: vscode.Selection;
  disposable: vscode.Disposable;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  Boolean(editor) && editor!.document.uri.scheme === "file" && editor!.document.fileName.endsWith(".nui");

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const canonicalDocumentFor = (snapshot: Awaited<ReturnType<NuiRuntimeEvaluationService["evaluateCurrent"]>>): CanonicalDocumentValue | null => {
  if (!snapshot) return null;
  return {
    sourceText: snapshot.proof.normalizedSource,
    doc: snapshot.compiled,
    docText: snapshot.compiled.spans.sourceMap.source,
    diagnostics: snapshot.compiled.diagnostics,
    bindingIssueDiagnostics: snapshot.compiled.bindingIssueDiagnostics ?? [],
    typedDependencyGraph: snapshot.compiled.typedDependencyGraph
  };
};

const sourceTargetResolutionFor = async (
  editor: vscode.TextEditor,
  session: NuiLanguageAnalysisSession,
  runtimeEvaluation: NuiRuntimeEvaluationService,
  isDocumentCurrent: (document: vscode.TextDocument, version: number) => boolean
): Promise<SourceTargetResolution | null> => {
  if (!isSupportedSourceEditor(editor)) return null;
  const document = editor.document;
  const rawSource = document.getText();
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  const snapshot = await runtimeEvaluation.evaluateCurrent({
    documentKey: documentKey(document),
    documentVersion: document.version,
    source,
    session,
    isCancelled: () => !isDocumentCurrent(document, document.version)
  });
  if (!snapshot || !isDocumentCurrent(document, snapshot.proof.documentVersion)) return null;
  const target = queryDslCanvasSourceTarget({
    source,
    compiled: snapshot.compiled,
    position: normalizedOffsetFromRaw(rawSource, document.offsetAt(editor.selection.active))
  });
  if (!target) return null;
  const targetId = snapshot.compiled.statementMap.elementIdByStatementIndex.get(target.sourceStatementIndex);
  const canonical = canonicalDocumentFor(snapshot);
  if (!targetId || !canonical || !coordinatePointConversionTargetEligibility({
    document: canonical,
    evaluation: snapshot.evaluation
  }, targetId).eligible) return null;
  return {
    targetId,
    documentVersion: document.version,
    normalizedSource: source.normalizedSource
  };
};

export const registerVscodeCoordinatePointConversionFeature = ({
  languageAnalysisSessionFor,
  rustProcessOwner,
  ensureCanvas,
  activeCanvasEndpoint,
  activeExplorerDocument,
  isSourceEditorActive,
  refreshElementsTree,
  output
}: CoordinatePointConversionFeatureHost): VscodeCoordinatePointConversionFeature => {
  const runtimeEvaluation = createNuiRuntimeEvaluationService({
    rustProcessOwner,
    isDocumentCurrent: (key, version) => vscode.workspace.textDocuments.some((document) =>
      document.uri.toString() === key && document.version === version
    )
  });
  let activeRequest: ActiveRequest | null = null;
  let disposed = false;
  let nextRequestId = 1;
  const explorerRangesByDocument = new Map<string, Set<number>>();
  let contextUpdate: Promise<void> = Promise.resolve();

  const setSourceContext = (enabled: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand(
        "setContext",
        VSCODE_COORDINATE_POINT_CONVERSION_SOURCE_TARGET_CONTEXT_KEY,
        enabled
      ))
      .then(() => undefined);
  };

  const refreshExplorerTargets = async (document: vscode.TextDocument): Promise<void> => {
    if (disposed || !isSupportedSourceEditor(vscode.window.activeTextEditor) || !sameDocument(document, vscode.window.activeTextEditor!.document)) return;
    const session = languageAnalysisSessionFor(document);
    const rawSource = document.getText();
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source = { normalizedSource: normalizedSourceFor(rawSource), sourceRevision: session.getSourceRevision() };
    const snapshot = await runtimeEvaluation.evaluateCurrent({
      documentKey: documentKey(document),
      documentVersion: document.version,
      source,
      session,
      isCancelled: () => disposed || document.version !== vscode.window.activeTextEditor?.document.version
    });
    const canonical = canonicalDocumentFor(snapshot);
    if (!snapshot || !canonical || document.version !== snapshot.proof.documentVersion) return;
    const ranges = new Set<number>();
    for (const element of snapshot.compiled.document.elements) {
      const eligibility = coordinatePointConversionTargetEligibility({ document: canonical, evaluation: snapshot.evaluation }, element.id);
      if (!eligibility.eligible) continue;
      const statement = snapshot.compiled.statementMap.byElementId.get(element.id);
      if (statement) ranges.add(snapshot.compiled.statements[statement.statementIndex]?.documentRange.from ?? -1);
    }
    explorerRangesByDocument.set(documentKey(document), ranges);
    refreshElementsTree?.();
  };

  const sourceTargetAvailable = async (editor: vscode.TextEditor | undefined): Promise<boolean> => {
    if (!isSupportedSourceEditor(editor)) {
      setSourceContext(false);
      return false;
    }
    const resolution = await sourceTargetResolutionFor(
      editor,
      languageAnalysisSessionFor(editor.document),
      runtimeEvaluation,
      (document, version) => vscode.workspace.textDocuments.some((candidate) =>
        sameDocument(candidate, document) && candidate.version === version
      )
    );
    const current = vscode.window.activeTextEditor;
    const enabled = Boolean(resolution && current && current.document.version === resolution.documentVersion && sameDocument(current.document, editor.document));
    setSourceContext(enabled);
    if (enabled) void refreshExplorerTargets(editor.document);
    return enabled;
  };

  const sendActiveRequest = (current: ActiveRequest): void => {
    if (activeRequest !== current || disposed || !isSupportedSourceEditor(current.editor)) return;
    if (
      current.editor.document.version !== current.request.documentVersion ||
      !sameDocument(current.editor.document, current.endpoint.document) ||
      !current.endpoint.isAuthoritativeReady()
    ) return;
    void current.endpoint.panel.webview.postMessage(current.request);
  };

  const attachRequest = (current: ActiveRequest): void => {
    activeRequest = current;
    const webviewDisposable = current.endpoint.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (activeRequest !== current || typeof message !== "object" || message === null || !("type" in message)) return;
      if ((message as { type?: string }).type === "webviewReady") sendActiveRequest(current);
      if ((message as { type?: string }).type === "coordinatePointConversionResult") {
        const result = message as Extract<
          import("../../src/vscode/protocol").VscodeToExtensionMessage,
          { type: "coordinatePointConversionResult" }
        >;
        if (result.requestId !== current.request.requestId || result.documentUri !== current.request.documentUri) return;
        void presentCoordinatePointConversionResult(result, output?.(), {
          showInformationMessage: (message) => vscode.window.showInformationMessage(message),
          showWarningMessage: (message, action) => vscode.window.showWarningMessage(message, action),
          showErrorMessage: (message, action) => vscode.window.showErrorMessage(message, action)
        });
        if (result.origin === "source" || result.origin === "explorer") {
          void vscode.window.showTextDocument(current.editor.document, {
            viewColumn: current.editor.viewColumn,
            preserveFocus: false,
            preview: false,
            selection: current.selection
          });
        }
        current.disposable.dispose();
        if (activeRequest === current) activeRequest = null;
      }
    });
    const panelDisposable = current.endpoint.panel.onDidDispose(() => {
      if (activeRequest !== current) return;
      activeRequest = null;
    });
    current.disposable = vscode.Disposable.from(webviewDisposable, panelDisposable);
    sendActiveRequest(current);
  };

  const start = async (mode: "xy" | "angle-distance", origin: CoordinatePointConversionSessionOrigin, targetIds: readonly string[], editor: vscode.TextEditor, endpoint: CoordinatePointConversionCanvasEndpoint): Promise<void> => {
    const request = {
      type: "coordinatePointConversionStart" as const,
      requestId: nextRequestId++,
      documentUri: documentKey(editor.document),
      documentVersion: editor.document.version,
      mode,
      targetIds: [...targetIds],
      origin
    };
    const current: ActiveRequest = {
      editor,
      endpoint,
      request,
      selection: editor.selection,
      disposable: { dispose: () => undefined }
    };
    activeRequest?.disposable.dispose();
    activeRequest = null;
    attachRequest(current);
  };

  const convertFromSource = async (mode: "xy" | "angle-distance"): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!isSupportedSourceEditor(editor)) return;
    const resolution = await sourceTargetResolutionFor(
      editor,
      languageAnalysisSessionFor(editor.document),
      runtimeEvaluation,
      (document, version) => vscode.workspace.textDocuments.some((candidate) => sameDocument(candidate, document) && candidate.version === version)
    );
    if (!resolution || editor.document.version !== resolution.documentVersion) {
      setSourceContext(false);
      void vscode.window.showErrorMessage("nuinuiCAD: Source Editorのカーソル位置に変換できるcoordinate pointがありません。");
      return;
    }
    const endpoint = await ensureCanvas(editor.document);
    if (!endpoint || editor.document.version !== resolution.documentVersion) return;
    try {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: editor.selection
      });
    } catch {
      return;
    }
    endpoint.panel.reveal(vscode.ViewColumn.Beside, true);
    await start(mode, "source", [resolution.targetId], editor, endpoint);
  };

  const convertFromCanvas = (mode: "xy" | "angle-distance"): void => {
    const endpoint = activeCanvasEndpoint();
    if (!endpoint) return;
    const targetIds = endpoint.targetIds();
    if (targetIds.length === 0) return;
    const editor = vscode.window.visibleTextEditors.find((candidate) => sameDocument(candidate.document, endpoint.document));
    if (!editor) return;
    void start(mode, "canvas", targetIds, editor, endpoint);
  };

  const convertFromExplorer = async (mode: "xy" | "angle-distance", node?: NuiElementsTreeNode): Promise<void> => {
    const document = activeExplorerDocument();
    if (!document || !node) return;
    const editor = vscode.window.visibleTextEditors.find((candidate) => sameDocument(candidate.document, document));
    if (!editor) return;
    const rawSource = document.getText();
    const session = languageAnalysisSessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source = { normalizedSource: normalizedSourceFor(rawSource), sourceRevision: session.getSourceRevision() };
    const snapshot = await runtimeEvaluation.evaluateCurrent({
      documentKey: documentKey(document),
      documentVersion: document.version,
      source,
      session
    });
    const canonical = canonicalDocumentFor(snapshot);
    const target = node.symbol.range.from >= 0 && snapshot
      ? queryDslCanvasSourceTarget({ source, compiled: snapshot.compiled, position: node.symbol.range.from })
      : null;
    const targetId = target && snapshot ? snapshot.compiled.statementMap.elementIdByStatementIndex.get(target.sourceStatementIndex) : undefined;
    if (!snapshot || !canonical || !targetId || !coordinatePointConversionTargetEligibility({ document: canonical, evaluation: snapshot.evaluation }, targetId).eligible) return;
    const endpoint = await ensureCanvas(document);
    if (!endpoint || endpoint.document.version !== document.version) return;
    endpoint.panel.reveal(vscode.ViewColumn.Beside, true);
    await start(mode, "explorer", [targetId], editor, endpoint);
  };

  const explorerContextValueFor = (node: NuiElementsTreeNode): string | undefined => {
    const ranges = explorerRangesByDocument.get(documentKey(activeExplorerDocument() ?? ({ uri: { toString: () => "" } } as vscode.TextDocument)));
    return ranges?.has(node.symbol.range.from) ? VSCODE_COORDINATE_POINT_CONVERSION_EXPLORER_CONTEXT_VALUE : undefined;
  };

  const commands = [
    vscode.commands.registerCommand(VSCODE_COORDINATE_POINT_CONVERSION_XY_COMMAND_ID, (node?: NuiElementsTreeNode) => {
      if (node) void convertFromExplorer("xy");
      else if (activeCanvasEndpoint()) convertFromCanvas("xy");
      else void convertFromSource("xy");
    }),
    vscode.commands.registerCommand(VSCODE_COORDINATE_POINT_CONVERSION_ANGLE_DISTANCE_COMMAND_ID, (node?: NuiElementsTreeNode) => {
      if (node) void convertFromExplorer("angle-distance");
      else if (activeCanvasEndpoint()) convertFromCanvas("angle-distance");
      else void convertFromSource("angle-distance");
    })
  ];
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (activeRequest && (!editor || !sameDocument(editor.document, activeRequest.editor.document))) {
      activeRequest.disposable.dispose();
      activeRequest = null;
    }
    void sourceTargetAvailable(editor);
  });
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) void sourceTargetAvailable(event.textEditor);
  });
  const handleDocumentChange = (document: vscode.TextDocument): void => {
    runtimeEvaluation.invalidateDocument(documentKey(document));
    if (activeRequest && sameDocument(document, activeRequest.editor.document)) {
      activeRequest.disposable.dispose();
      activeRequest = null;
    }
    if (sameDocument(document, vscode.window.activeTextEditor?.document ?? document) && (isSourceEditorActive?.() ?? true)) {
      void sourceTargetAvailable(vscode.window.activeTextEditor);
    } else {
      setSourceContext(false);
    }
  };
  const handleDocumentClose = (document: vscode.TextDocument): void => {
    runtimeEvaluation.closeDocument(documentKey(document));
    explorerRangesByDocument.delete(documentKey(document));
    if (activeRequest && sameDocument(document, activeRequest.editor.document)) {
      activeRequest.disposable.dispose();
      activeRequest = null;
    }
    setSourceContext(false);
  };

  setSourceContext(false);

  const disposable = vscode.Disposable.from(
    ...commands,
    activeEditorListener,
    selectionListener,
    {
      dispose: () => {
        disposed = true;
        activeRequest?.disposable.dispose();
        activeRequest = null;
        runtimeEvaluation.dispose();
        setSourceContext(false);
      }
    }
  ) as VscodeCoordinatePointConversionFeature;
  disposable.explorerContextValueFor = explorerContextValueFor;
  disposable.handleDocumentChange = handleDocumentChange;
  disposable.handleDocumentClose = handleDocumentClose;
  return disposable;
};

export const coordinatePointConversionExplorerContextValueFor = (
  node: NuiElementsTreeNode,
  context: { documentUri: string; eligibleRanges: ReadonlySet<number> }
): string | undefined => context.eligibleRanges.has(node.symbol.range.from)
  ? VSCODE_COORDINATE_POINT_CONVERSION_EXPLORER_CONTEXT_VALUE
  : undefined;
