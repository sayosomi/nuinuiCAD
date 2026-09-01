import * as vscode from "vscode";

export type VscodeSourceAuthoringPosition = {
  documentVersion: number;
  line: number;
  character: number;
};

export type VscodeSourceAuthoringPositionAfterCommit = {
  line: number;
  character: number;
};

export type VscodeCanvasCreationRequest = {
  requestId: number;
  documentVersion: number;
  sourcePosition: VscodeSourceAuthoringPosition;
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

type PendingCommandOwnedEdit = {
  sessionToken: object;
  document: vscode.TextDocument;
  documentUri: string;
  sourcePosition: VscodeSourceAuthoringPosition;
  marked: boolean;
  provisionalDocumentVersion: number | null;
  onObserved?: (documentVersion: number) => void;
};

export type VscodeSourceAuthoringPositionFeature = vscode.Disposable & {
  sourceAuthoringPositionFor: (document: vscode.TextDocument) => VscodeSourceAuthoringPosition | null;
  beginCommandOwnedEdit: (options: {
    sessionToken: object;
    document: vscode.TextDocument;
    sourcePosition: VscodeSourceAuthoringPosition;
    onObserved?: (documentVersion: number) => void;
  }) => number | null;
  beginCanvasCreation: (
    sessionToken: object,
    document: vscode.TextDocument
  ) => VscodeCanvasCreationRequest | null;
  markCommandOwnedEdit: (requestId: number) => void;
  completeCommandOwnedEdit: (options: {
    requestId: number;
    document: vscode.TextDocument;
    documentVersion: number;
    postPosition: VscodeSourceAuthoringPositionAfterCommit;
  }) => boolean;
  rejectCommandOwnedEdit: (requestId: number) => void;
  setExplicitSourceAuthoringPosition: (
    document: vscode.TextDocument,
    position: VscodeSourceAuthoringPosition
  ) => void;
  disposeSession: (sessionToken: object, document: vscode.TextDocument) => void;
};

const sourcePositionIsValid = (position: unknown): position is VscodeSourceAuthoringPosition => {
  if (typeof position !== "object" || position === null) return false;
  const candidate = position as Partial<VscodeSourceAuthoringPosition>;
  return typeof candidate.documentVersion === "number" && Number.isInteger(candidate.documentVersion) &&
    candidate.documentVersion >= 0 &&
    typeof candidate.line === "number" && Number.isInteger(candidate.line) && candidate.line >= 0 &&
    typeof candidate.character === "number" && Number.isInteger(candidate.character) && candidate.character >= 0;
};

const sourcePositionForEditor = (editor: vscode.TextEditor): VscodeSourceAuthoringPosition | null => {
  if (!isSupportedSourceDocument(editor.document)) return null;
  const position = editor.selection.active;
  if (!sourcePositionIsValid({
    documentVersion: editor.document.version,
    line: position.line,
    character: position.character
  })) return null;
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

const isSupportedSourceDocument = (document: vscode.TextDocument): boolean =>
  document.languageId === "nui" &&
  document.uri.scheme === "file" &&
  document.fileName.endsWith(".nui");

const sourceDocumentKey = (document: vscode.TextDocument): string => document.uri.toString();

const samePosition = (
  left: Pick<VscodeSourceAuthoringPosition, "line" | "character">,
  right: Pick<VscodeSourceAuthoringPosition, "line" | "character">
): boolean => left.line === right.line && left.character === right.character;

export const registerVscodeSourceAuthoringPositionFeature = ({
  onDocumentInvalidated = () => undefined
}: {
  onDocumentInvalidated?: (document: vscode.TextDocument) => void;
} = {}): VscodeSourceAuthoringPositionFeature => {
  const sourceAnchors = new Map<string, VscodeSourceAuthoringPosition>();
  const commandOwnedAnchorHistories = new Map<string, CommandOwnedAnchorHistory>();
  const pendingCommandOwnedEdits = new Map<number, PendingCommandOwnedEdit>();
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

  const invalidatePendingForDocument = (document: vscode.TextDocument): void => {
    for (const [requestId, pending] of pendingCommandOwnedEdits) {
      if (pending.document === document) pendingCommandOwnedEdits.delete(requestId);
    }
    onDocumentInvalidated(document);
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
    const commandOwnedEntry = [...pendingCommandOwnedEdits.entries()].find(([, pending]) =>
      pending.marked &&
      pending.document === event.document &&
      pending.provisionalDocumentVersion === null &&
      event.document.version === pending.sourcePosition.documentVersion + 1
    );
    const commandOwnedEdit = commandOwnedEntry?.[1];
    if (commandOwnedEdit) {
      commandOwnedEdit.marked = false;
      commandOwnedEdit.provisionalDocumentVersion = event.document.version;
      commandOwnedEdit.onObserved?.(event.document.version);
      return;
    }

    if (event.reason === vscode.TextDocumentChangeReason?.Undo || event.reason === vscode.TextDocumentChangeReason?.Redo) {
      invalidatePendingForDocument(event.document);
      const direction = event.reason === vscode.TextDocumentChangeReason?.Undo ? "undo" : "redo";
      const entry = direction === "undo" ? history?.past.at(-1) : history?.future[0];
      const expectedCurrentPosition = direction === "undo" ? entry?.postInsertion : entry?.preCommand;
      if (
        !history ||
        !entry ||
        !currentAnchor ||
        !expectedCurrentPosition ||
        currentAnchor.documentVersion !== event.document.version - 1 ||
        !samePosition(currentAnchor, expectedCurrentPosition)
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

    invalidatePendingForDocument(event.document);
    clearCommandOwnedAnchorHistory(documentUri);
    queueMicrotask(() => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document || editor.document.version !== event.document.version) return;
      const position = sourcePositionForEditor(editor);
      if (position) sourceAnchors.set(sourceDocumentKey(editor.document), position);
    });
  });

  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    const documentUri = sourceDocumentKey(document);
    sourceAnchors.delete(documentUri);
    clearCommandOwnedAnchorHistory(documentUri);
    for (const [requestId, pending] of pendingCommandOwnedEdits) {
      if (pending.document === document) pendingCommandOwnedEdits.delete(requestId);
    }
  });

  const beginCommandOwnedEdit = ({
    sessionToken,
    document,
    sourcePosition,
    onObserved
  }: {
    sessionToken: object;
    document: vscode.TextDocument;
    sourcePosition: VscodeSourceAuthoringPosition;
    onObserved?: (documentVersion: number) => void;
  }): number | null => {
    if (!isSupportedSourceDocument(document) ||
      !sourcePositionIsValid(sourcePosition) ||
      sourcePosition.documentVersion !== document.version) return null;
    const requestId = nextRequestId++;
    pendingCommandOwnedEdits.set(requestId, {
      sessionToken,
      document,
      documentUri: sourceDocumentKey(document),
      sourcePosition: { ...sourcePosition },
      marked: false,
      provisionalDocumentVersion: null,
      onObserved
    });
    return requestId;
  };

  return Object.assign(vscode.Disposable.from(selectionListener, documentChangeListener, closeListener), {
    sourceAuthoringPositionFor: (document: vscode.TextDocument): VscodeSourceAuthoringPosition | null => {
      const position = sourceAnchors.get(sourceDocumentKey(document));
      return position ? { ...position } : null;
    },
    beginCommandOwnedEdit,
    beginCanvasCreation: (
      sessionToken: object,
      document: vscode.TextDocument
    ): VscodeCanvasCreationRequest | null => {
      const sourcePosition = sourceAnchors.get(sourceDocumentKey(document));
      if (!sourcePosition || sourcePosition.documentVersion !== document.version) return null;
      const requestId = beginCommandOwnedEdit({ sessionToken, document, sourcePosition });
      return requestId === null ? null : {
        requestId,
        documentVersion: document.version,
        sourcePosition: { ...sourcePosition }
      };
    },
    markCommandOwnedEdit: (requestId: number): void => {
      const pending = pendingCommandOwnedEdits.get(requestId);
      if (pending) pending.marked = true;
    },
    completeCommandOwnedEdit: ({
      requestId,
      document,
      documentVersion,
      postPosition
    }): boolean => {
      const pending = pendingCommandOwnedEdits.get(requestId);
      if (!pending || pending.document !== document ||
        pending.sourcePosition.documentVersion + 1 !== documentVersion ||
        pending.provisionalDocumentVersion !== documentVersion ||
        document.version !== documentVersion ||
        !sourcePositionIsValid({ documentVersion, ...postPosition })) return false;
      const currentAnchor = sourceAnchors.get(pending.documentUri);
      if (!currentAnchor ||
        currentAnchor.documentVersion !== pending.sourcePosition.documentVersion ||
        !samePosition(currentAnchor, pending.sourcePosition)) return false;
      const history = commandOwnedAnchorHistoryFor(pending.documentUri);
      history.past = [...history.past, {
        preCommand: {
          line: pending.sourcePosition.line,
          character: pending.sourcePosition.character
        },
        postInsertion: { line: postPosition.line, character: postPosition.character }
      }];
      history.future = [];
      sourceAnchors.set(pending.documentUri, {
        documentVersion,
        line: postPosition.line,
        character: postPosition.character
      });
      pendingCommandOwnedEdits.delete(requestId);
      return true;
    },
    rejectCommandOwnedEdit: (requestId: number): void => {
      pendingCommandOwnedEdits.delete(requestId);
    },
    setExplicitSourceAuthoringPosition: (
      document: vscode.TextDocument,
      position: VscodeSourceAuthoringPosition
    ): void => {
      if (!isSupportedSourceDocument(document) ||
        !sourcePositionIsValid(position) ||
        position.documentVersion !== document.version) return;
      sourceAnchors.set(sourceDocumentKey(document), { ...position });
    },
    disposeSession: (sessionToken: object, document: vscode.TextDocument): void => {
      for (const [requestId, pending] of pendingCommandOwnedEdits) {
        if (pending.sessionToken === sessionToken && pending.document === document) {
          pendingCommandOwnedEdits.delete(requestId);
        }
      }
    }
  }) as VscodeSourceAuthoringPositionFeature;
};
