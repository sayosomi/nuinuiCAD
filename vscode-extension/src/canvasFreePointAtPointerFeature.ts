import * as vscode from "vscode";
import {
  isVscodeCanvasPointer,
  vscodeCanvasPointerContextKeys,
  type VscodeCanvasPointer
} from "../../src/vscode/protocol";
import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";
import {
  registerVscodeSourceAuthoringPositionFeature,
  type VscodeSourceAuthoringPosition,
  type VscodeSourceAuthoringPositionFeature
} from "./sourceAuthoringPositionFeature";
import { canvasPresentationTextFor } from "./canvasPresentationLocalization";

export const VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID = "nuinuiCAD.createFreePointAtPointer";

export type { VscodeSourceAuthoringPosition } from "./sourceAuthoringPositionFeature";

export type VscodeCanvasFreePointAtPointerEndpoint = {
  sessionToken: object;
  document: vscode.TextDocument;
  isCurrent: () => boolean;
  isAuthoritativeReady: () => boolean;
  lastCanvasPointer: () => VscodeCanvasPointer | null;
  postFreePointAtPointer: (request: {
    requestId: number;
    documentVersion: number;
    pointer: VscodeCanvasPointer;
    sourcePosition: VscodeSourceAuthoringPosition;
  }) => void;
};

export type VscodeCanvasFreePointAtPointerFeature = vscode.Disposable & {
  handleAuthoritativeDocumentReady: (
    sessionToken: object,
    document: vscode.TextDocument,
    documentVersion: number
  ) => void;
  setExplicitSourceAuthoringPosition: (
    document: vscode.TextDocument,
    position: VscodeSourceAuthoringPosition
  ) => void;
  markCanvasEdit: (requestId: number) => void;
  handleSourceDocumentInvalidated: (document: vscode.TextDocument) => void;
  disposeSession: (sessionToken: object, document: vscode.TextDocument) => void;
  handleResult: (
    sessionToken: object,
    document: vscode.TextDocument,
    message: Extract<VscodeToExtensionMessage, { type: "canvasFreePointAtPointerResult" }>
  ) => void;
};

type PendingRequest = {
  sessionToken: object;
  document: vscode.TextDocument;
  documentUri: string;
  sourcePosition: VscodeSourceAuthoringPosition;
};

type DeferredInvocation = {
  endpoint: VscodeCanvasFreePointAtPointerEndpoint;
  document: vscode.TextDocument;
  documentUri: string;
  pointer: VscodeCanvasPointer;
};

type FreePointSessionState = {
  sessionToken: object;
  document: vscode.TextDocument;
  documentUri: string;
  queuedInvocations: DeferredInvocation[];
  inFlightRequestId: number | null;
  expectedDocumentVersion: number;
  provisionalCommandOwnedDocumentVersion: number | null;
  authoritativeReadyVersion: number | null;
};

export const isVscodeCanvasBlankContext = (context: unknown): boolean =>
  typeof context === "object" && context !== null &&
  (context as Record<string, unknown>).webviewSection === "blank";

const pointerFromContext = (context: unknown): VscodeCanvasPointer | null => {
  if (typeof context !== "object" || context === null) return null;
  const values = context as Record<string, unknown>;
  if (!isVscodeCanvasBlankContext(context)) return null;
  const pointer = {
    x: values[vscodeCanvasPointerContextKeys.x],
    y: values[vscodeCanvasPointerContextKeys.y]
  };
  return isVscodeCanvasPointer(pointer) ? pointer : null;
};

const displayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

const sourceAnchorError = (): string => canvasPresentationTextFor("canvas.sourceAnchor", displayLanguage());
const staleSourceAnchorError = (): string => canvasPresentationTextFor("canvas.staleSourceAnchor", displayLanguage());
const pointerError = (): string => canvasPresentationTextFor("canvas.pointer", displayLanguage());

const sourcePositionIsValid = (position: unknown): position is { line: number; character: number } => {
  if (typeof position !== "object" || position === null) return false;
  const candidate = position as { line?: unknown; character?: unknown };
  return typeof candidate.line === "number" && Number.isInteger(candidate.line) && candidate.line >= 0 &&
    typeof candidate.character === "number" && Number.isInteger(candidate.character) && candidate.character >= 0;
};

export const registerVscodeCanvasFreePointAtPointerFeature = ({
  activeCanvasEndpoint,
  sourceAuthoringPosition
}: {
  activeCanvasEndpoint: (context?: unknown) => VscodeCanvasFreePointAtPointerEndpoint | null;
  sourceAuthoringPosition?: VscodeSourceAuthoringPositionFeature;
}): VscodeCanvasFreePointAtPointerFeature => {
  const pendingRequests = new Map<number, PendingRequest>();
  const sessionStates = new Map<object, FreePointSessionState>();
  let handleSourceDocumentInvalidated: (document: vscode.TextDocument) => void = () => undefined;
  const ownedSourceAuthoringPosition = sourceAuthoringPosition ?? registerVscodeSourceAuthoringPositionFeature({
    onDocumentInvalidated: (document) => handleSourceDocumentInvalidated(document)
  });

  const invalidateSessionState = (state: FreePointSessionState, errorMessage?: string): void => {
    const hadQueuedInvocations = state.queuedInvocations.length > 0;
    state.queuedInvocations = [];
    if (state.inFlightRequestId !== null) {
      pendingRequests.delete(state.inFlightRequestId);
      ownedSourceAuthoringPosition.rejectCommandOwnedEdit(state.inFlightRequestId);
    }
    state.inFlightRequestId = null;
    state.provisionalCommandOwnedDocumentVersion = null;
    state.authoritativeReadyVersion = null;
    sessionStates.delete(state.sessionToken);
    if (hadQueuedInvocations && errorMessage) void vscode.window.showErrorMessage(errorMessage);
  };

  const stateForEndpoint = (endpoint: VscodeCanvasFreePointAtPointerEndpoint): FreePointSessionState => {
    const documentUri = endpoint.document.uri.toString();
    const existing = sessionStates.get(endpoint.sessionToken);
    if (existing && (existing.document !== endpoint.document || existing.documentUri !== documentUri)) {
      invalidateSessionState(existing, staleSourceAnchorError());
    }
    const current = sessionStates.get(endpoint.sessionToken);
    if (current) return current;
    const created: FreePointSessionState = {
      sessionToken: endpoint.sessionToken,
      document: endpoint.document,
      documentUri,
      queuedInvocations: [],
      inFlightRequestId: null,
      expectedDocumentVersion: endpoint.document.version,
      provisionalCommandOwnedDocumentVersion: null,
      authoritativeReadyVersion: null
    };
    sessionStates.set(endpoint.sessionToken, created);
    return created;
  };

  const dispatchNext = (state: FreePointSessionState, allowEndpointReadiness: boolean): void => {
    if (state.inFlightRequestId !== null) return;
    const invocation = state.queuedInvocations[0];
    if (!invocation) {
      sessionStates.delete(state.sessionToken);
      return;
    }
    const endpoint = invocation.endpoint;
    if (
      invocation.document !== state.document ||
      endpoint.sessionToken !== state.sessionToken ||
      endpoint.document !== state.document ||
      endpoint.document.uri.toString() !== state.documentUri ||
      !endpoint.isCurrent()
    ) {
      invalidateSessionState(state, staleSourceAnchorError());
      return;
    }
    if (endpoint.document.version !== state.expectedDocumentVersion) {
      invalidateSessionState(state, staleSourceAnchorError());
      return;
    }
    const readyForCurrentVersion = state.authoritativeReadyVersion === endpoint.document.version;
    if (!readyForCurrentVersion && (!allowEndpointReadiness || !endpoint.isAuthoritativeReady())) return;

    const anchor = ownedSourceAuthoringPosition.sourceAuthoringPositionFor(state.document);
    if (!anchor) {
      invalidateSessionState(state, sourceAnchorError());
      return;
    }
    if (anchor.documentVersion !== endpoint.document.version) {
      invalidateSessionState(state, staleSourceAnchorError());
      return;
    }

    const sourcePosition = { ...anchor };
    const requestId = ownedSourceAuthoringPosition.beginCommandOwnedEdit({
      sessionToken: endpoint.sessionToken,
      document: endpoint.document,
      sourcePosition,
      onObserved: (documentVersion) => {
        const currentState = sessionStates.get(endpoint.sessionToken);
        if (currentState) currentState.provisionalCommandOwnedDocumentVersion = documentVersion;
      }
    });
    if (requestId === null) {
      invalidateSessionState(state, staleSourceAnchorError());
      return;
    }
    state.queuedInvocations = state.queuedInvocations.slice(1);
    state.inFlightRequestId = requestId;
    state.provisionalCommandOwnedDocumentVersion = null;
    state.authoritativeReadyVersion = null;
    pendingRequests.set(requestId, {
      sessionToken: endpoint.sessionToken,
      document: endpoint.document,
      documentUri: state.documentUri,
      sourcePosition
    });
    endpoint.postFreePointAtPointer({
      requestId,
      documentVersion: endpoint.document.version,
      pointer: invocation.pointer,
      sourcePosition
    });
  };

  const execute = (context?: unknown): void => {
    const endpoint = activeCanvasEndpoint(context);
    if (!endpoint || !endpoint.isCurrent()) return;

    const documentUri = endpoint.document.uri.toString();
    const state = stateForEndpoint(endpoint);
    if (
      (state.inFlightRequestId !== null || state.queuedInvocations.length > 0) &&
      (state.document !== endpoint.document ||
        (endpoint.document.version !== state.expectedDocumentVersion &&
          !(state.inFlightRequestId !== null &&
            state.provisionalCommandOwnedDocumentVersion === endpoint.document.version)))
    ) {
      invalidateSessionState(state, staleSourceAnchorError());
      return;
    }
    const anchor = ownedSourceAuthoringPosition.sourceAuthoringPositionFor(endpoint.document);
    if (!anchor) {
      void vscode.window.showErrorMessage(sourceAnchorError());
      return;
    }
    const anchorAtExpectedVersion = anchor.documentVersion === state.expectedDocumentVersion;
    const anchorAtCurrentVersion = anchor.documentVersion === endpoint.document.version;
    const enqueueBehindProvisionalCommandEdit = state.inFlightRequestId !== null &&
      state.provisionalCommandOwnedDocumentVersion === endpoint.document.version;
    if (!anchorAtCurrentVersion && !(enqueueBehindProvisionalCommandEdit && anchorAtExpectedVersion)) {
      void vscode.window.showErrorMessage(staleSourceAnchorError());
      return;
    }

    const pointer = context === undefined ? endpoint.lastCanvasPointer() : pointerFromContext(context);
    if (!pointer || !isVscodeCanvasPointer(pointer)) {
      void vscode.window.showErrorMessage(pointerError());
      return;
    }

    const invocation: DeferredInvocation = {
      endpoint,
      document: endpoint.document,
      documentUri,
      pointer
    };
    state.queuedInvocations = [...state.queuedInvocations, invocation];
    dispatchNext(state, state.inFlightRequestId === null && state.queuedInvocations.length === 1);
  };

  const command = vscode.commands.registerCommand(
    VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID,
    execute
  );

  handleSourceDocumentInvalidated = (document: vscode.TextDocument): void => {
    for (const state of [...sessionStates.values()]) {
      if (state.document === document) invalidateSessionState(state, staleSourceAnchorError());
    }
    for (const [requestId, pending] of pendingRequests) {
      if (pending.document === document) pendingRequests.delete(requestId);
    }
  };

  return Object.assign(vscode.Disposable.from(command, ...(sourceAuthoringPosition ? [] : [ownedSourceAuthoringPosition])), {
    handleAuthoritativeDocumentReady: (
      sessionToken: object,
      document: vscode.TextDocument,
      documentVersion: number
    ): void => {
      const state = sessionStates.get(sessionToken);
      if (!state || state.document !== document || state.documentUri !== document.uri.toString()) return;
      if (document.version !== documentVersion) return;
      state.authoritativeReadyVersion = documentVersion;
      dispatchNext(state, true);
    },
    setExplicitSourceAuthoringPosition: (
      document: vscode.TextDocument,
      position: VscodeSourceAuthoringPosition
    ): void => {
      ownedSourceAuthoringPosition.setExplicitSourceAuthoringPosition(document, position);
    },
    handleResult: (
      sessionToken: object,
      document: vscode.TextDocument,
      message: Extract<VscodeToExtensionMessage, { type: "canvasFreePointAtPointerResult" }>
    ): void => {
      const pending = pendingRequests.get(message.requestId);
      if (!pending || pending.sessionToken !== sessionToken || pending.document !== document) return;
      pendingRequests.delete(message.requestId);
      const state = sessionStates.get(pending.sessionToken);
      if (!state || state.document !== document || state.inFlightRequestId !== message.requestId) return;
      state.inFlightRequestId = null;
      const provisionalDocumentVersion = state.provisionalCommandOwnedDocumentVersion;
      if (
        message.status !== "applied" ||
        !sourcePositionIsValid(message.nextSourcePosition) ||
        document.version !== message.documentVersion ||
        message.documentVersion !== pending.sourcePosition.documentVersion + 1 ||
        provisionalDocumentVersion !== message.documentVersion
      ) {
        invalidateSessionState(state, staleSourceAnchorError());
        return;
      }
      const completed = ownedSourceAuthoringPosition.completeCommandOwnedEdit({
        requestId: message.requestId,
        document,
        documentVersion: message.documentVersion,
        postPosition: message.nextSourcePosition
      });
      if (!completed) {
        invalidateSessionState(state, staleSourceAnchorError());
        return;
      }
      state.provisionalCommandOwnedDocumentVersion = null;
      state.expectedDocumentVersion = message.documentVersion;
      if (state.queuedInvocations.length === 0) {
        sessionStates.delete(state.sessionToken);
        return;
      }
      if (state.authoritativeReadyVersion === message.documentVersion) dispatchNext(state, false);
    },
    markCanvasEdit: (requestId: number): void => {
      ownedSourceAuthoringPosition.markCommandOwnedEdit(requestId);
    },
    handleSourceDocumentInvalidated,
    disposeSession: (sessionToken: object, document: vscode.TextDocument): void => {
      const state = sessionStates.get(sessionToken);
      if (state?.document === document) invalidateSessionState(state);
      for (const [requestId, pending] of pendingRequests) {
        if (pending.sessionToken === sessionToken && pending.document === document) pendingRequests.delete(requestId);
      }
    }
  }
  ) as VscodeCanvasFreePointAtPointerFeature;
};
