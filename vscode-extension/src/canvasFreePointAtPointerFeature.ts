import * as vscode from "vscode";
import {
  isVscodeCanvasPointer,
  vscodeCanvasPointerContextKeys,
  type VscodeCanvasPointer
} from "../../src/vscode/protocol";
import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";

export const VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID = "nuinuiCAD.createFreePointAtPointer";

export type VscodeSourceAuthoringPosition = {
  documentVersion: number;
  line: number;
  character: number;
};

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
  handleResult: (
    sessionToken: object,
    document: vscode.TextDocument,
    message: Extract<VscodeToExtensionMessage, { type: "canvasFreePointAtPointerResult" }>
  ) => void;
};

type PendingRequest = {
  sessionToken: object;
  documentUri: string;
  sourcePosition: VscodeSourceAuthoringPosition;
  canvasEditMarked: boolean;
};

type DeferredInvocation = {
  endpoint: VscodeCanvasFreePointAtPointerEndpoint;
  documentUri: string;
  documentVersion: number;
  pointer: VscodeCanvasPointer;
};

type CommandOwnedAnchorPosition = Pick<VscodeSourceAuthoringPosition, "line" | "character">;

type CommandOwnedAnchorHistoryEntry = {
  preCommand: CommandOwnedAnchorPosition;
  postInsertion: CommandOwnedAnchorPosition;
};

type CommandOwnedAnchorHistory = {
  past: CommandOwnedAnchorHistoryEntry[];
  future: CommandOwnedAnchorHistoryEntry[];
};

type SourceSelectionChangeEvent = {
  textEditor: vscode.TextEditor;
  kind?: number;
};

type SourceDocumentChangeEvent = {
  document: vscode.TextDocument;
  contentChanges: readonly unknown[];
  reason?: number;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isSupportedSourceDocument = (document: vscode.TextDocument): boolean =>
  document.languageId === "nui" &&
  document.uri.scheme === "file" &&
  document.fileName.endsWith(".nui");

const sourceDocumentKey = (document: vscode.TextDocument): string => document.uri.toString();

const sourcePositionIsValid = (position: unknown): position is { line: number; character: number } => {
  if (typeof position !== "object" || position === null) return false;
  const candidate = position as { line?: unknown; character?: unknown };
  return typeof candidate.line === "number" && Number.isInteger(candidate.line) && candidate.line >= 0 &&
    typeof candidate.character === "number" && Number.isInteger(candidate.character) && candidate.character >= 0;
};

const sourcePositionForEditor = (editor: vscode.TextEditor): VscodeSourceAuthoringPosition | null => {
  if (!isSupportedSourceDocument(editor.document)) return null;
  const position = editor.selection.active;
  if (!sourcePositionIsValid(position)) return null;
  return {
    documentVersion: editor.document.version,
    line: position.line,
    character: position.character
  };
};

const explicitSelectionChange = (event: SourceSelectionChangeEvent): boolean => {
  const selectionChangeKind = (vscode as typeof vscode & {
    TextEditorSelectionChangeKind?: { Keyboard?: number; Mouse?: number };
  }).TextEditorSelectionChangeKind;
  if (selectionChangeKind) {
    return event.kind === selectionChangeKind.Keyboard || event.kind === selectionChangeKind.Mouse;
  }
  return event.kind === 1 || event.kind === 2;
};

const pointerFromContext = (context: unknown): VscodeCanvasPointer | null => {
  if (typeof context !== "object" || context === null) return null;
  const values = context as Record<string, unknown>;
  if (values.webviewSection !== "blank") return null;
  const pointer = {
    x: values[vscodeCanvasPointerContextKeys.x],
    y: values[vscodeCanvasPointerContextKeys.y]
  };
  return isVscodeCanvasPointer(pointer) ? pointer : null;
};

const sourceAnchorError = "nuinuiCAD: Sourceの挿入位置を先に確定してください。Sourceでキャレットを明示的に移動してから再試行してください。";
const staleSourceAnchorError = "nuinuiCAD: Sourceの挿入位置が古くなっています。現在のSourceでキャレットを再確定してから再試行してください。";
const pointerError = "nuinuiCAD: Canvas上にポインターを置いてから実行してください。";

export const registerVscodeCanvasFreePointAtPointerFeature = ({
  activeCanvasEndpoint
}: {
  activeCanvasEndpoint: () => VscodeCanvasFreePointAtPointerEndpoint | null;
}): VscodeCanvasFreePointAtPointerFeature => {
  const sourceAnchors = new Map<string, VscodeSourceAuthoringPosition>();
  const commandOwnedAnchorHistories = new Map<string, CommandOwnedAnchorHistory>();
  const pendingRequests = new Map<number, PendingRequest>();
  let deferredInvocation: DeferredInvocation | null = null;
  let nextRequestId = 1;

  const commandOwnedAnchorHistoryFor = (documentUri: string): CommandOwnedAnchorHistory => {
    const existing = commandOwnedAnchorHistories.get(documentUri);
    if (existing) return existing;
    const created = { past: [], future: [] };
    commandOwnedAnchorHistories.set(documentUri, created);
    return created;
  };

  const clearCommandOwnedAnchorHistory = (documentUri: string): void => {
    commandOwnedAnchorHistories.delete(documentUri);
  };

  const dispatch = (invocation: DeferredInvocation): void => {
    const endpoint = invocation.endpoint;
    if (!endpoint.isCurrent()) {
      if (deferredInvocation === invocation) deferredInvocation = null;
      return;
    }
    if (!endpoint.isAuthoritativeReady()) return;

    const anchor = sourceAnchors.get(invocation.documentUri);
    if (!anchor) {
      if (deferredInvocation === invocation) deferredInvocation = null;
      void vscode.window.showErrorMessage(sourceAnchorError);
      return;
    }
    if (
      anchor.documentVersion !== endpoint.document.version ||
      anchor.documentVersion !== invocation.documentVersion
    ) {
      if (deferredInvocation === invocation) deferredInvocation = null;
      void vscode.window.showErrorMessage(staleSourceAnchorError);
      return;
    }

    const requestId = nextRequestId++;
    if (deferredInvocation === invocation) deferredInvocation = null;
    pendingRequests.set(requestId, {
      sessionToken: endpoint.sessionToken,
      documentUri: invocation.documentUri,
      sourcePosition: anchor,
      canvasEditMarked: false
    });
    endpoint.postFreePointAtPointer({
      requestId,
      documentVersion: endpoint.document.version,
      pointer: invocation.pointer,
      sourcePosition: anchor
    });
  };

  const execute = (context?: unknown): void => {
    const endpoint = activeCanvasEndpoint();
    if (!endpoint || !endpoint.isCurrent()) return;

    const documentUri = sourceDocumentKey(endpoint.document);
    const anchor = sourceAnchors.get(documentUri);
    if (!anchor) {
      void vscode.window.showErrorMessage(sourceAnchorError);
      return;
    }
    if (anchor.documentVersion !== endpoint.document.version) {
      void vscode.window.showErrorMessage(staleSourceAnchorError);
      return;
    }

    const pointer = context === undefined ? endpoint.lastCanvasPointer() : pointerFromContext(context);
    if (!pointer || !isVscodeCanvasPointer(pointer)) {
      void vscode.window.showErrorMessage(pointerError);
      return;
    }

    const invocation: DeferredInvocation = {
      endpoint,
      documentUri,
      documentVersion: endpoint.document.version,
      pointer
    };
    deferredInvocation = invocation;
    dispatch(invocation);
  };

  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event: SourceSelectionChangeEvent) => {
    if (!explicitSelectionChange(event)) return;
    const position = sourcePositionForEditor(event.textEditor);
    if (position) sourceAnchors.set(sourceDocumentKey(event.textEditor.document), position);
  });

  const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event: SourceDocumentChangeEvent) => {
    if (event.contentChanges.length === 0 || !isSupportedSourceDocument(event.document)) return;
    const documentUri = sourceDocumentKey(event.document);
    const currentAnchor = sourceAnchors.get(documentUri);
    const history = commandOwnedAnchorHistories.get(documentUri);
    if (event.reason === vscode.TextDocumentChangeReason?.Undo || event.reason === vscode.TextDocumentChangeReason?.Redo) {
      const direction = event.reason === vscode.TextDocumentChangeReason?.Undo ? "undo" : "redo";
      const entry = direction === "undo" ? history?.past.at(-1) : history?.future[0];
      const expectedCurrentPosition = direction === "undo" ? entry?.postInsertion : entry?.preCommand;
      if (
        !history ||
        !entry ||
        !currentAnchor ||
        !expectedCurrentPosition ||
        currentAnchor.documentVersion !== event.document.version - 1 ||
        currentAnchor.line !== expectedCurrentPosition.line ||
        currentAnchor.character !== expectedCurrentPosition.character
      ) {
        clearCommandOwnedAnchorHistory(documentUri);
        return;
      }
      if (direction === "undo") {
        history.past = history.past.slice(0, -1);
        history.future = [entry, ...history.future];
        sourceAnchors.set(documentUri, {
          documentVersion: event.document.version,
          line: entry.preCommand.line,
          character: entry.preCommand.character
        });
      } else {
        history.future = history.future.slice(1);
        history.past = [...history.past, entry];
        sourceAnchors.set(documentUri, {
          documentVersion: event.document.version,
          line: entry.postInsertion.line,
          character: entry.postInsertion.character
        });
      }
      return;
    }
    const canvasEdit = [...pendingRequests.values()].find((pending) =>
      pending.canvasEditMarked &&
      pending.documentUri === documentUri &&
      event.document.version === pending.sourcePosition.documentVersion + 1
    );
    if (canvasEdit) {
      canvasEdit.canvasEditMarked = false;
      return;
    }
    clearCommandOwnedAnchorHistory(documentUri);
    queueMicrotask(() => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !sameDocument(editor.document, event.document) || editor.document.version !== event.document.version) return;
      const position = sourcePositionForEditor(editor);
      if (position) sourceAnchors.set(sourceDocumentKey(editor.document), position);
    });
  });

  const closeListener = vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
    const documentUri = sourceDocumentKey(document);
    sourceAnchors.delete(documentUri);
    clearCommandOwnedAnchorHistory(documentUri);
    if (deferredInvocation?.documentUri === documentUri) deferredInvocation = null;
    for (const [requestId, pending] of pendingRequests) {
      if (pending.documentUri === documentUri) pendingRequests.delete(requestId);
    }
  });

  const command = vscode.commands.registerCommand(
    VSCODE_CANVAS_FREE_POINT_AT_POINTER_COMMAND_ID,
    execute
  );

  return Object.assign(vscode.Disposable.from(selectionListener, documentChangeListener, closeListener, command), {
    handleAuthoritativeDocumentReady: (
      sessionToken: object,
      document: vscode.TextDocument,
      documentVersion: number
    ): void => {
      const invocation = deferredInvocation;
      if (!invocation) return;
      if (!invocation.endpoint.isCurrent()) {
        deferredInvocation = null;
        return;
      }
      if (
        invocation.endpoint.sessionToken !== sessionToken ||
        !sameDocument(invocation.endpoint.document, document) ||
        document.version !== documentVersion
      ) return;
      if (invocation.documentVersion !== documentVersion) {
        deferredInvocation = null;
        void vscode.window.showErrorMessage(staleSourceAnchorError);
        return;
      }
      dispatch(invocation);
    },
    setExplicitSourceAuthoringPosition: (
      document: vscode.TextDocument,
      position: VscodeSourceAuthoringPosition
    ): void => {
      if (
        !isSupportedSourceDocument(document) ||
        !sourcePositionIsValid(position) ||
        position.documentVersion !== document.version
      ) return;
      sourceAnchors.set(sourceDocumentKey(document), position);
    },
    handleResult: (
      sessionToken: object,
      document: vscode.TextDocument,
      message: Extract<VscodeToExtensionMessage, { type: "canvasFreePointAtPointerResult" }>
    ): void => {
      const pending = pendingRequests.get(message.requestId);
      if (!pending || pending.sessionToken !== sessionToken) return;
      pendingRequests.delete(message.requestId);
      if (message.status !== "applied" || !sourcePositionIsValid(message.nextSourcePosition)) return;
      if (document.version !== message.documentVersion) return;
      const currentAnchor = sourceAnchors.get(pending.documentUri);
      if (
        !currentAnchor ||
        currentAnchor.documentVersion !== pending.sourcePosition.documentVersion ||
        currentAnchor.line !== pending.sourcePosition.line ||
        currentAnchor.character !== pending.sourcePosition.character
      ) return;
      const history = commandOwnedAnchorHistoryFor(pending.documentUri);
      history.past = [...history.past, {
        preCommand: {
          line: pending.sourcePosition.line,
          character: pending.sourcePosition.character
        },
        postInsertion: {
          line: message.nextSourcePosition.line,
          character: message.nextSourcePosition.character
        }
      }];
      history.future = [];
      sourceAnchors.set(pending.documentUri, {
        documentVersion: message.documentVersion,
        line: message.nextSourcePosition.line,
        character: message.nextSourcePosition.character
      });
    },
    markCanvasEdit: (requestId: number): void => {
      const pending = pendingRequests.get(requestId);
      if (pending) pending.canvasEditMarked = true;
    }
  }
  ) as VscodeCanvasFreePointAtPointerFeature;
};
