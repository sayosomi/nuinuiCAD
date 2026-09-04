import * as vscode from "vscode";
import {
  applyCoordinatePointConversionPlan,
  coordinatePointConversionTargetEligibility,
  planCoordinatePointConversion,
  type CoordinatePointConversionPlan,
  type CoordinatePointConversionSkip
} from "../../src/commands/coordinatePointConversion";
import {
  coordinatePointConversionReferenceSuggestions,
  startCoordinatePointConversionSession,
  type CoordinatePointConversionSession,
  type CoordinatePointConversionSessionOrigin
} from "../../src/commands/coordinatePointConversionSession";
import type { LineSplice } from "../../src/document/textPatch";
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
  coordinatePointConversionTranslatorFor,
  presentCoordinatePointConversionResult,
  type CoordinatePointConversionOutputTarget
} from "./coordinatePointConversionPresentation";
import type {
  VscodeCanvasObservationElementSource,
  VscodeCanvasObservationSnapshot
} from "../../src/vscode/protocol";

export const VSCODE_COORDINATE_POINT_CONVERSION_XY_COMMAND_ID =
  "nuinuiCAD.convertPointToXYOffset";
export const VSCODE_COORDINATE_POINT_CONVERSION_ANGLE_DISTANCE_COMMAND_ID =
  "nuinuiCAD.convertPointToAngleDistanceOffset";
export const VSCODE_COORDINATE_POINT_CONVERSION_SOURCE_TARGET_CONTEXT_KEY =
  "nuinuiCAD.coordinatePointConversionSourceTarget";
export const VSCODE_COORDINATE_POINT_CONVERSION_EXPLORER_CONTEXT_VALUE =
  "nuinuiCAD.coordinatePointConversionTarget";

export type CoordinatePointConversionCanvasTarget = {
  runtimeElementId: string;
  sourceStatementIndex: number;
};

export type CoordinatePointConversionCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
  targetSources: () => readonly CoordinatePointConversionCanvasTarget[];
};

export type CoordinatePointConversionFeatureHost = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  rustProcessOwner: Pick<RustEvaluationProcessOwner, "get">;
  ensureCanvas: (
    document: vscode.TextDocument
  ) => CoordinatePointConversionCanvasEndpoint | null | Promise<CoordinatePointConversionCanvasEndpoint | null>;
  activeCanvasEndpoint: () => CoordinatePointConversionCanvasEndpoint | null;
  applySourceLineSplices: (
    editor: vscode.TextEditor,
    expectedDocumentVersion: number,
    expectedSourceText: string,
    splices: readonly LineSplice[]
  ) => Thenable<boolean> | Promise<boolean>;
  activeExplorerDocument: () => vscode.TextDocument | undefined;
  isSourceEditorActive?: () => boolean;
  refreshElementsTree?: () => void;
  output?: () => CoordinatePointConversionOutputTarget;
  displayLanguageFor?: () => string;
};

export type VscodeCoordinatePointConversionFeature = vscode.Disposable & {
  explorerContextValueFor: (node: NuiElementsTreeNode) => string | undefined;
  handleCommitStart: (document: vscode.TextDocument, requestId: number, operationId: number, sourceText?: string) => void;
  handleDocumentChange: (document: vscode.TextDocument) => void;
  handleDocumentClose: (document: vscode.TextDocument) => void;
};

type SourceTargetResolution = {
  targetId: string;
  documentVersion: number;
  normalizedSource: string;
  snapshot: NonNullable<Awaited<ReturnType<NuiRuntimeEvaluationService["evaluateCurrent"]>>>;
};

type CoordinatePointConversionStartRequest = Extract<
  import("../../src/vscode/protocol").ExtensionToVscodeMessage,
  { type: "coordinatePointConversionStart" }
>;

type ActiveRequest = {
  editor: vscode.TextEditor;
  endpoint: CoordinatePointConversionCanvasEndpoint;
  request: CoordinatePointConversionStartRequest;
  selection: vscode.Selection;
  ownedCommitOperationId: number | null;
  ownedCommitSourceText: string | null;
  ownedCommitChangeObserved: boolean;
  disposable: vscode.Disposable;
};

type ActiveNativeRequest = {
  editor: vscode.TextEditor;
  request: CoordinatePointConversionStartRequest;
  session: CoordinatePointConversionSession;
  selection: vscode.Selection;
  canvasEndpoint: CoordinatePointConversionCanvasEndpoint | null;
  canvasTargetSources: readonly CoordinatePointConversionCanvasTarget[] | null;
};

type CoordinatePointConversionQuickPickItem = Omit<vscode.QuickPickItem, "kind"> & (
  | { kind: "base"; baseKey: string }
  | { kind: "canvas" }
);

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  Boolean(editor) && editor!.document.uri.scheme === "file" && editor!.document.fileName.endsWith(".nui");

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const positionEquals = (
  left: vscode.Position,
  right: vscode.Position
): boolean => left.line === right.line && left.character === right.character;

const selectionEquals = (
  left: vscode.Selection,
  right: vscode.Selection
): boolean => positionEquals(left.start, right.start) && positionEquals(left.end, right.end);

const canvasTargetSourcesEqual = (
  left: readonly CoordinatePointConversionCanvasTarget[],
  right: readonly CoordinatePointConversionCanvasTarget[]
): boolean => {
  if (left.length !== right.length) return false;
  return left.every((target, index) => {
    const other = right[index];
    return target.runtimeElementId === other?.runtimeElementId &&
      target.sourceStatementIndex === other?.sourceStatementIndex;
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isDocumentRange = (value: unknown): value is { from: number; to: number } =>
  isRecord(value) && typeof value.from === "number" && typeof value.to === "number";

const isDocumentSymbol = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" &&
    typeof value.detail === "string" &&
    typeof value.kind === "string" &&
    isDocumentRange(value.range) &&
    isDocumentRange(value.selectionRange) &&
    Array.isArray(value.children) &&
    value.children.every((child) => isDocumentSymbol(child));
};

const isNuiElementsTreeNode = (value: unknown): value is NuiElementsTreeNode =>
  isRecord(value) && isDocumentSymbol(value.symbol);

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

const ordinaryCanvasObservationSource = (
  source: VscodeCanvasObservationElementSource | undefined
): source is Extract<VscodeCanvasObservationElementSource, { sourceStatementIndex: number }> => {
  if (!source || !("sourceStatementIndex" in source) || "runtimeKind" in source) return false;
  return Number.isInteger(source.sourceStatementIndex) &&
    source.sourceStatementIndex >= 0 &&
    typeof source.elementType === "string";
};

/** Projects Canvas runtime targets onto the ordinary Source identity already published by Canvas. */
export const coordinatePointConversionCanvasTargetsFor = (
  snapshot: VscodeCanvasObservationSnapshot | null | undefined
): CoordinatePointConversionCanvasTarget[] => {
  const targetIds = snapshot?.coordinatePointConversionTargetIds ?? [];
  const sources = snapshot?.selectedElementSources ?? [];
  if (targetIds.length === 0 || sources.length === 0) return [];

  const sourcesByRuntimeElementId = new Map<string, VscodeCanvasObservationElementSource[]>();
  for (const source of sources) {
    const existing = sourcesByRuntimeElementId.get(source.runtimeElementId);
    if (existing) existing.push(source);
    else sourcesByRuntimeElementId.set(source.runtimeElementId, [source]);
  }

  const sourceStatementIndexes = new Set<number>();
  const targets: CoordinatePointConversionCanvasTarget[] = [];
  for (const runtimeElementId of targetIds) {
    const candidates = sourcesByRuntimeElementId.get(runtimeElementId);
    if (candidates?.length !== 1) return [];
    const source = candidates[0];
    if (!ordinaryCanvasObservationSource(source)) return [];
    if (sourceStatementIndexes.has(source.sourceStatementIndex)) return [];
    sourceStatementIndexes.add(source.sourceStatementIndex);
    targets.push({ runtimeElementId, sourceStatementIndex: source.sourceStatementIndex });
  }
  return targets;
};

type ResolvedCoordinatePointConversionCanvasTarget = CoordinatePointConversionCanvasTarget & {
  elementId: string;
};

type CanvasTargetResolution =
  | { status: "resolved"; targets: readonly ResolvedCoordinatePointConversionCanvasTarget[] }
  | { status: "rejected"; reason: CoordinatePointConversionSkip["reason"] };

const resolveCanvasTargetIdsFor = (
  canvasTargetSources: readonly CoordinatePointConversionCanvasTarget[],
  snapshot: NonNullable<Awaited<ReturnType<NuiRuntimeEvaluationService["evaluateCurrent"]>>>,
  displayLanguage: string
): CanvasTargetResolution => {
  const translator = coordinatePointConversionTranslatorFor(displayLanguage);
  const canonical = canonicalDocumentFor(snapshot);
  if (!canonical) {
    return {
      status: "rejected",
      reason: {
        code: "revalidation-failed",
        message: translator("coordinatePointConversion.revalidation.canvasTargetUnavailable")
      }
    };
  }

  const resolvedTargets: ResolvedCoordinatePointConversionCanvasTarget[] = [];
  const resolvedElementIds = new Set<string>();
  for (const canvasTarget of canvasTargetSources) {
    const elementId = snapshot.compiled.statementMap.elementIdByStatementIndex.get(canvasTarget.sourceStatementIndex);
    if (!elementId || resolvedElementIds.has(elementId) || !coordinatePointConversionTargetEligibility({
      document: canonical,
      evaluation: snapshot.evaluation
    }, elementId).eligible) {
      return {
        status: "rejected",
        reason: {
          code: "revalidation-failed",
          message: translator("coordinatePointConversion.revalidation.canvasTargetUnavailable")
        }
      };
    }
    resolvedElementIds.add(elementId);
    resolvedTargets.push({ ...canvasTarget, elementId });
  }
  return { status: "resolved", targets: resolvedTargets };
};

const canvasSourceStatementIndexesFor = (
  resolvedTargets: readonly ResolvedCoordinatePointConversionCanvasTarget[],
  successfulTargetIds: readonly string[]
): readonly number[] | null => {
  const sourceStatementIndexesByElementId = new Map(
    resolvedTargets.map((target) => [target.elementId, target.sourceStatementIndex] as const)
  );
  const sourceStatementIndexes = successfulTargetIds.map((targetId) => sourceStatementIndexesByElementId.get(targetId));
  if (sourceStatementIndexes.some((sourceStatementIndex) => sourceStatementIndex === undefined)) return null;
  const resolvedSourceStatementIndexes = sourceStatementIndexes as number[];
  return new Set(resolvedSourceStatementIndexes).size === resolvedSourceStatementIndexes.length
    ? resolvedSourceStatementIndexes
    : null;
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
    normalizedSource: source.normalizedSource,
    snapshot
  };
};

export const registerVscodeCoordinatePointConversionFeature = ({
  languageAnalysisSessionFor,
  rustProcessOwner,
  ensureCanvas,
  activeCanvasEndpoint,
  applySourceLineSplices,
  activeExplorerDocument,
  isSourceEditorActive,
  refreshElementsTree,
  output,
  displayLanguageFor = vscodeDisplayLanguage
}: CoordinatePointConversionFeatureHost): VscodeCoordinatePointConversionFeature => {
  const runtimeEvaluation = createNuiRuntimeEvaluationService({
    rustProcessOwner,
    isDocumentCurrent: (key, version) => vscode.workspace.textDocuments.some((document) =>
      document.uri.toString() === key && document.version === version
    )
  });
  let activeRequest: ActiveRequest | null = null;
  let activeNativeRequest: ActiveNativeRequest | null = null;
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
    void refreshExplorerTargets(editor.document);
    return enabled;
  };

  const nativeQuickPickItemsFor = (
    session: CoordinatePointConversionSession,
    displayLanguage: string
  ): readonly CoordinatePointConversionQuickPickItem[] => {
    const translator = coordinatePointConversionTranslatorFor(displayLanguage);
    const items: CoordinatePointConversionQuickPickItem[] = [
      {
        label: translator("coordinatePointConversion.picker.pickCanvas"),
        description: translator("coordinatePointConversion.picker.description"),
        kind: "canvas"
      },
      ...coordinatePointConversionReferenceSuggestions(session).map((suggestion) => ({
        label: suggestion.canonicalToken,
        description: translator("coordinatePointConversion.picker.legalCandidate"),
        detail: `${suggestion.detail} · ${suggestion.searchAliases.join(", ")}`,
        kind: "base" as const,
        baseKey: suggestion.baseKey
      }))
    ];
    return items;
  };

  const conversionResultFor = (
    request: CoordinatePointConversionStartRequest,
    status: "applied" | "noop" | "rejected",
    plan: Pick<CoordinatePointConversionPlan, "classification" | "successfulTargetIds" | "successfulTargetCount" | "skippedTargets" | "skippedTargetCount">,
    documentVersion: number
  ) => ({
    type: "coordinatePointConversionResult" as const,
    requestId: request.requestId,
    operationId: 0,
    documentUri: request.documentUri,
    documentVersion,
    origin: request.origin,
    mode: request.mode,
    status,
    classification: plan.classification,
    successfulTargetIds: plan.successfulTargetIds,
    successfulTargetCount: plan.successfulTargetCount,
    skippedTargets: plan.skippedTargets,
    skippedTargetCount: plan.skippedTargetCount
  });

  const rejectedResultFor = (
    request: CoordinatePointConversionStartRequest,
    reason: CoordinatePointConversionSkip["reason"],
    documentVersion: number
  ) => conversionResultFor(request, "rejected", {
    classification: "all-skipped",
    successfulTargetIds: [],
    successfulTargetCount: 0,
    skippedTargets: request.targetIds.map((targetId) => ({ targetId, reason })),
    skippedTargetCount: request.targetIds.length
  }, documentVersion);

  const presentResult = async (result: ReturnType<typeof conversionResultFor>): Promise<void> => {
    await presentCoordinatePointConversionResult(result, output?.(), {
      showInformationMessage: (message) => vscode.window.showInformationMessage(message),
      showWarningMessage: (message, action) => vscode.window.showWarningMessage(message, action),
      showErrorMessage: (message, action) => vscode.window.showErrorMessage(message, action)
    }, displayLanguageFor());
  };
  const presentationText = (key: string): string =>
    coordinatePointConversionTranslatorFor(displayLanguageFor())(key);

  const cancelActiveRequest = (): void => {
    activeNativeRequest = null;
    activeRequest?.disposable.dispose();
    activeRequest = null;
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
      if ((message as { type?: string }).type === "webviewAuthoritativeDocumentReady") sendActiveRequest(current);
      if ((message as { type?: string }).type === "coordinatePointConversionResult") {
        const result = message as Extract<
          import("../../src/vscode/protocol").VscodeToExtensionMessage,
          { type: "coordinatePointConversionResult" }
        >;
        if (result.requestId !== current.request.requestId || result.documentUri !== current.request.documentUri) return;
        if (current.ownedCommitOperationId !== null && result.operationId !== current.ownedCommitOperationId) return;
        void presentCoordinatePointConversionResult(result, output?.(), {
          showInformationMessage: (message) => vscode.window.showInformationMessage(message),
          showWarningMessage: (message, action) => vscode.window.showWarningMessage(message, action),
          showErrorMessage: (message, action) => vscode.window.showErrorMessage(message, action)
        }, displayLanguageFor());
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

  const startCanvasRequest = (
    request: CoordinatePointConversionStartRequest,
    editor: vscode.TextEditor,
    endpoint: CoordinatePointConversionCanvasEndpoint
  ): void => {
    const current: ActiveRequest = {
      editor,
      endpoint,
      request,
      selection: editor.selection,
      ownedCommitOperationId: null,
      ownedCommitSourceText: null,
      ownedCommitChangeObserved: false,
      disposable: { dispose: () => undefined }
    };
    activeRequest?.disposable.dispose();
    activeRequest = null;
    attachRequest(current);
  };

  const runtimeSnapshotFor = async (
    editor: vscode.TextEditor,
    session = languageAnalysisSessionFor(editor.document),
    isCancelled?: () => boolean
  ) => {
    const document = editor.document;
    const rawSource = document.getText();
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: session.getSourceRevision()
    };
    return runtimeEvaluation.evaluateCurrent({
      documentKey: documentKey(document),
      documentVersion: document.version,
      source,
      session,
      isCancelled: () => isCancelled?.() === true || !vscode.workspace.textDocuments.some((candidate) =>
        sameDocument(candidate, document) && candidate.version === document.version
      )
    });
  };

  const revalidateNativeRequest = async (
    current: ActiveNativeRequest
  ): Promise<
    | {
        status: "valid";
        snapshot: NonNullable<Awaited<ReturnType<NuiRuntimeEvaluationService["evaluateCurrent"]>>>;
        session: CoordinatePointConversionSession;
        resolvedCanvasTargets: readonly ResolvedCoordinatePointConversionCanvasTarget[] | null;
      }
    | { status: "rejected"; reason: CoordinatePointConversionSkip["reason"] }
  > => {
    const { editor, request, session } = current;
    const document = editor.document;
    const stale = (message: string): { status: "rejected"; reason: CoordinatePointConversionSkip["reason"] } => ({
      status: "rejected",
      reason: { code: "revalidation-failed", message }
    });
    if (
      !isSupportedSourceEditor(editor) ||
      documentKey(document) !== request.documentUri ||
      document.version !== request.documentVersion ||
      document.getText() !== session.sourceText ||
      !selectionEquals(editor.selection, current.selection)
    ) return stale(coordinatePointConversionTranslatorFor(displayLanguageFor())(
      "coordinatePointConversion.revalidation.documentChanged"
    ));

    if (request.origin === "canvas") {
      const endpoint = activeCanvasEndpoint();
      if (!endpoint || !sameDocument(endpoint.document, document) || !canvasTargetSourcesEqual(
        endpoint.targetSources(),
        current.canvasTargetSources ?? []
      )) {
        return stale(coordinatePointConversionTranslatorFor(displayLanguageFor())(
          "coordinatePointConversion.revalidation.canvasTargetChanged"
        ));
      }
    }

    const snapshot = await runtimeSnapshotFor(editor);
    if (
      !snapshot ||
      snapshot.proof.documentVersion !== request.documentVersion ||
      snapshot.proof.normalizedSource !== session.sourceText ||
      snapshot.proof.sourceRevision !== session.sourceRevision
    ) return stale(coordinatePointConversionTranslatorFor(displayLanguageFor())(
      "coordinatePointConversion.revalidation.staleEvaluation"
    ));

    const resolvedCanvasTargets = request.origin === "canvas"
      ? resolveCanvasTargetIdsFor(current.canvasTargetSources ?? [], snapshot, displayLanguageFor())
      : null;
    if (resolvedCanvasTargets?.status === "rejected") return resolvedCanvasTargets;
    const targetIds = resolvedCanvasTargets?.status === "resolved"
      ? resolvedCanvasTargets.targets.map((target) => target.elementId)
      : session.targetIds;

    const restarted = startCoordinatePointConversionSession({
      requestId: request.requestId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      mode: request.mode,
      origin: request.origin as CoordinatePointConversionSessionOrigin,
      targetIds,
      snapshot: { document: canonicalDocumentFor(snapshot)!, evaluation: snapshot.evaluation }
    });
    return restarted.status === "started"
      ? {
          status: "valid",
          snapshot,
          session: restarted.session,
          resolvedCanvasTargets: resolvedCanvasTargets?.status === "resolved" ? resolvedCanvasTargets.targets : null
        }
      : { status: "rejected", reason: restarted.reason };
  };

  const applyNativeBase = async (
    current: ActiveNativeRequest,
    baseKey: string
  ): Promise<void> => {
    const revalidated = await revalidateNativeRequest(current);
    if (revalidated.status === "rejected") {
      await presentResult(rejectedResultFor(current.request, revalidated.reason, current.editor.document.version));
      return;
    }
    const base = revalidated.session.baseCandidates.find((candidate) => candidate.key === baseKey);
    if (!base) {
      const reason: CoordinatePointConversionSkip["reason"] = {
        code: "base-not-candidate",
        message: presentationText("coordinatePointConversion.revalidation.baseNotCandidate")
      };
      await presentResult(rejectedResultFor(current.request, reason, current.editor.document.version));
      return;
    }

    const snapshot = { document: canonicalDocumentFor(revalidated.snapshot)!, evaluation: revalidated.snapshot.evaluation };
    const plan = planCoordinatePointConversion({
      snapshot,
      targetIds: revalidated.session.targetIds,
      base,
      mode: revalidated.session.mode
    });
    const applied = applyCoordinatePointConversionPlan(plan, snapshot);
    if (applied.status === "rejected") {
      await presentResult(conversionResultFor(current.request, "rejected", applied.plan, current.editor.document.version));
      return;
    }
    if (applied.status === "noop") {
      await presentResult(conversionResultFor(current.request, "noop", applied.plan, current.editor.document.version));
      return;
    }

    const successfulCanvasTargetSourceStatementIndexes = current.request.origin === "canvas"
      ? current.canvasTargetSources && revalidated.resolvedCanvasTargets
        ? canvasSourceStatementIndexesFor(revalidated.resolvedCanvasTargets, applied.plan.successfulTargetIds)
        : null
      : null;
    if (current.request.origin === "canvas" && !successfulCanvasTargetSourceStatementIndexes) {
      const reason: CoordinatePointConversionSkip["reason"] = {
        code: "revalidation-failed",
        message: presentationText("coordinatePointConversion.revalidation.canvasSelectionMappingFailed")
      };
      await presentResult(rejectedResultFor(current.request, reason, current.editor.document.version));
      return;
    }

    const edited = await applySourceLineSplices(
      current.editor,
      current.request.documentVersion,
      current.session.sourceText,
      applied.plan.splices
    );
    if (!edited) {
      await presentResult(conversionResultFor(current.request, "rejected", applied.plan, current.editor.document.version));
      return;
    }

    const documentVersion = current.editor.document.version;
    if (current.request.origin === "canvas" && current.canvasEndpoint) {
      void current.canvasEndpoint.panel.webview.postMessage({
        type: "coordinatePointConversionSelection",
        requestId: current.request.requestId,
        documentVersion,
        successfulTargetSourceStatementIndexes: [...successfulCanvasTargetSourceStatementIndexes!]
      } satisfies import("../../src/vscode/protocol").ExtensionToVscodeMessage);
    }
    await presentResult(conversionResultFor(current.request, "applied", applied.plan, documentVersion));
    if (current.request.origin === "source" || current.request.origin === "explorer") {
      void vscode.window.showTextDocument(current.editor.document, {
        preserveFocus: false,
        preview: false,
        selection: current.selection
      });
    }
  };

  const handoffToCanvasPick = async (current: ActiveNativeRequest): Promise<void> => {
    const revalidated = await revalidateNativeRequest(current);
    if (revalidated.status === "rejected") {
      await presentResult(rejectedResultFor(current.request, revalidated.reason, current.editor.document.version));
      return;
    }

    let endpoint = current.canvasEndpoint;
    if (!endpoint) {
      endpoint = await ensureCanvas(current.editor.document);
      if (!endpoint || current.editor.document.version !== current.request.documentVersion ||
          documentKey(current.editor.document) !== current.request.documentUri ||
          current.editor.document.getText() !== current.session.sourceText ||
          !selectionEquals(current.editor.selection, current.selection)) {
        const reason: CoordinatePointConversionSkip["reason"] = {
          code: "revalidation-failed",
          message: presentationText("coordinatePointConversion.revalidation.canvasOpenedStale")
        };
        await presentResult(rejectedResultFor(current.request, reason, current.editor.document.version));
        return;
      }
    }
    if (!endpoint || !sameDocument(endpoint.document, current.editor.document)) return;
    if (current.request.origin === "source" || current.request.origin === "explorer") {
      try {
        await vscode.window.showTextDocument(current.editor.document, {
          preserveFocus: false,
          preview: false,
          selection: current.selection
        });
      } catch {
        return;
      }
    }
    endpoint.panel.reveal(vscode.ViewColumn.Beside, true);
    const canvasRequest = {
      ...current.request,
      canvasBasePick: true,
      ...(current.request.origin === "canvas" && current.canvasTargetSources
        ? { targetIds: current.canvasTargetSources.map((target) => target.runtimeElementId) }
        : {})
    };
    startCanvasRequest(canvasRequest, current.editor, endpoint);
  };

  const startNative = async (
    mode: "xy" | "angle-distance",
    origin: CoordinatePointConversionSessionOrigin,
    targetIds: readonly string[],
    editor: vscode.TextEditor,
    snapshot?: NonNullable<Awaited<ReturnType<NuiRuntimeEvaluationService["evaluateCurrent"]>>>,
    canvasEndpoint: CoordinatePointConversionCanvasEndpoint | null = null,
    canvasTargetSources: readonly CoordinatePointConversionCanvasTarget[] | null = null
  ): Promise<void> => {
    cancelActiveRequest();
    const currentSnapshot = snapshot ?? await runtimeSnapshotFor(editor);
    const canonical = canonicalDocumentFor(currentSnapshot);
    const requestTargetIds = origin === "canvas"
      ? canvasTargetSources?.map((target) => target.runtimeElementId) ?? []
      : targetIds;
    const initialRequest: CoordinatePointConversionStartRequest = {
      type: "coordinatePointConversionStart" as const,
      requestId: nextRequestId++,
      documentUri: documentKey(editor.document),
      documentVersion: editor.document.version,
      mode,
      targetIds: [...requestTargetIds],
      origin
    };
    if (!currentSnapshot || !canonical || editor.document.version !== initialRequest.documentVersion) {
      const reason: CoordinatePointConversionSkip["reason"] = {
        code: "revalidation-failed",
        message: presentationText("coordinatePointConversion.revalidation.evaluationUnavailable")
      };
      await presentResult(rejectedResultFor(initialRequest, reason, editor.document.version));
      return;
    }

    const resolvedCanvasTargets = origin === "canvas"
      ? resolveCanvasTargetIdsFor(canvasTargetSources ?? [], currentSnapshot, displayLanguageFor())
      : null;
    if (resolvedCanvasTargets?.status === "rejected") {
      await presentResult(rejectedResultFor(initialRequest, resolvedCanvasTargets.reason, editor.document.version));
      return;
    }
    const resolvedTargetIds = resolvedCanvasTargets?.status === "resolved"
      ? resolvedCanvasTargets.targets.map((target) => target.elementId)
      : targetIds;
    const request: CoordinatePointConversionStartRequest = {
      ...initialRequest,
      targetIds: [...resolvedTargetIds]
    };
    const started = startCoordinatePointConversionSession({
      requestId: request.requestId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      mode,
      origin,
      targetIds: resolvedTargetIds,
      snapshot: { document: canonical, evaluation: currentSnapshot.evaluation }
    });
    if (started.status === "rejected") {
      await presentResult(rejectedResultFor(request, started.reason, editor.document.version));
      return;
    }
    const native: ActiveNativeRequest = {
      editor,
      request,
      session: started.session,
      selection: editor.selection,
      canvasEndpoint,
      canvasTargetSources: origin === "canvas" ? canvasTargetSources ?? [] : null
    };
    activeNativeRequest = native;
    const displayLanguage = displayLanguageFor();
    const translator = coordinatePointConversionTranslatorFor(displayLanguage);
    const selected = await vscode.window.showQuickPick(nativeQuickPickItemsFor(started.session, displayLanguage), {
      placeHolder: mode === "xy"
        ? translator("coordinatePointConversion.picker.xyPlaceholder")
        : translator("coordinatePointConversion.picker.anglePlaceholder"),
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (activeNativeRequest !== native) return;
    activeNativeRequest = null;
    if (!selected) return;
    if (selected.kind === "canvas") {
      activeNativeRequest = native;
      await handoffToCanvasPick(native);
      if (activeNativeRequest === native) activeNativeRequest = null;
      return;
    }
    await applyNativeBase(native, selected.baseKey);
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
      void vscode.window.showErrorMessage(
        coordinatePointConversionTranslatorFor(displayLanguageFor())("coordinatePointConversion.source.noTarget")
      );
      return;
    }
    await startNative(mode, "source", [resolution.targetId], editor, resolution.snapshot);
  };

  const convertFromCanvas = (mode: "xy" | "angle-distance"): void => {
    const endpoint = activeCanvasEndpoint();
    if (!endpoint) return;
    const targetSources = endpoint.targetSources();
    if (targetSources.length === 0) return;
    const editor = vscode.window.visibleTextEditors.find((candidate) => sameDocument(candidate.document, endpoint.document));
    if (!editor) return;
    void startNative(mode, "canvas", [], editor, undefined, endpoint, targetSources);
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
    await startNative(mode, "explorer", [targetId], editor, snapshot);
  };

  const explorerContextValueFor = (node: NuiElementsTreeNode): string | undefined => {
    const ranges = explorerRangesByDocument.get(documentKey(activeExplorerDocument() ?? ({ uri: { toString: () => "" } } as vscode.TextDocument)));
    return ranges?.has(node.symbol.range.from) ? VSCODE_COORDINATE_POINT_CONVERSION_EXPLORER_CONTEXT_VALUE : undefined;
  };

  const commands = [
    vscode.commands.registerCommand(VSCODE_COORDINATE_POINT_CONVERSION_XY_COMMAND_ID, (invocation: unknown) => {
      if (isNuiElementsTreeNode(invocation)) void convertFromExplorer("xy", invocation);
      else if (activeCanvasEndpoint()) convertFromCanvas("xy");
      else void convertFromSource("xy");
    }),
    vscode.commands.registerCommand(VSCODE_COORDINATE_POINT_CONVERSION_ANGLE_DISTANCE_COMMAND_ID, (invocation: unknown) => {
      if (isNuiElementsTreeNode(invocation)) void convertFromExplorer("angle-distance", invocation);
      else if (activeCanvasEndpoint()) convertFromCanvas("angle-distance");
      else void convertFromSource("angle-distance");
    })
  ];
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (activeRequest && (!editor || !sameDocument(editor.document, activeRequest.editor.document))) {
      activeRequest.disposable.dispose();
      activeRequest = null;
    }
    if (activeNativeRequest && (!editor || !sameDocument(editor.document, activeNativeRequest.editor.document))) {
      activeNativeRequest = null;
    }
    void sourceTargetAvailable(editor);
  });
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) void sourceTargetAvailable(event.textEditor);
  });
  const handleDocumentChange = (document: vscode.TextDocument): void => {
    runtimeEvaluation.invalidateDocument(documentKey(document));
    if (activeRequest && sameDocument(document, activeRequest.editor.document)) {
      if (activeRequest.ownedCommitOperationId === null) {
        activeRequest.disposable.dispose();
        activeRequest = null;
      } else if (
        activeRequest.ownedCommitChangeObserved ||
        (activeRequest.ownedCommitSourceText !== null &&
          normalizedSourceFor(document.getText()) !== activeRequest.ownedCommitSourceText)
      ) {
        activeRequest.disposable.dispose();
        activeRequest = null;
      } else {
        activeRequest.ownedCommitChangeObserved = true;
      }
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
    if (activeNativeRequest && sameDocument(document, activeNativeRequest.editor.document)) {
      activeNativeRequest = null;
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
        activeNativeRequest = null;
        activeRequest?.disposable.dispose();
        activeRequest = null;
        runtimeEvaluation.dispose();
        setSourceContext(false);
      }
    }
  ) as VscodeCoordinatePointConversionFeature;
  disposable.explorerContextValueFor = explorerContextValueFor;
  disposable.handleCommitStart = (document, requestId, operationId, sourceText) => {
    if (!activeRequest || !sameDocument(document, activeRequest.editor.document)) return;
    if (activeRequest.request.requestId !== requestId) return;
    activeRequest.ownedCommitOperationId = operationId;
    activeRequest.ownedCommitSourceText = sourceText ?? null;
    activeRequest.ownedCommitChangeObserved = false;
  };
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
