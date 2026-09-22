import * as vscode from "vscode";
import type { NormalizedSourceRange } from "@nuinuicad/nui-language";
import {
  outputPreviewPlaceCoordinatePatchesAreSafe
} from "../../src/vscode/outputPreviewPlaceDrag";
import type { VscodeToExtensionMessage } from "../../src/vscode/protocol";
import { normalizedSourceFor, vscodeRangeForNormalized } from "./sourceOffsetAdapter";
import {
  isWritableSourceDocument,
  VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID,
  type SourceCreationInternalInvocation
} from "./sourceCreationCommandFeature";

export type OutputPreviewSourceInteractionSession = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
};

export type OutputPreviewSourceInteractionHost = {
  isSessionCurrent: (session: OutputPreviewSourceInteractionSession) => boolean;
  isOpenDocument: (document: vscode.TextDocument) => boolean;
  sameDocument: (left: vscode.TextDocument, right: vscode.TextDocument) => boolean;
  isNormalizedRangeSafe: (document: vscode.TextDocument, range: NormalizedSourceRange) => boolean;
  visibleEditorFor: (document: vscode.TextDocument) => vscode.TextEditor | undefined;
  resyncOutputPreview: (session: OutputPreviewSourceInteractionSession) => void;
};

export type OutputPreviewSourceInteractionFeature = {
  handleInsertTemplate: (
    session: OutputPreviewSourceInteractionSession,
    message: Extract<VscodeToExtensionMessage, { type: "outputPreviewInsertTemplate" }>
  ) => Promise<void>;
  handleSourceNavigation: (
    session: OutputPreviewSourceInteractionSession,
    message: Extract<VscodeToExtensionMessage, { type: "outputPreviewSourceNavigation" }>
  ) => Promise<void>;
  applyPlaceCommit: (
    session: OutputPreviewSourceInteractionSession,
    message: Extract<VscodeToExtensionMessage, { type: "outputPreviewPlaceCommit" }>
  ) => Promise<void>;
};

/**
 * Owns the Output Preview Source interaction adapter while leaving session
 * lifecycle and registry ownership in the Extension Host composition root.
 */
export const createOutputPreviewSourceInteractionFeature = (
  host: OutputPreviewSourceInteractionHost
): OutputPreviewSourceInteractionFeature => ({
  handleInsertTemplate: async (session, message) => {
    if (
      !session.panel.active ||
      !host.isSessionCurrent(session) ||
      !host.isOpenDocument(session.document) ||
      session.document.version !== message.documentVersion ||
      !isWritableSourceDocument(session.document)
    ) return;

    const visibleEditor = host.visibleEditorFor(session.document);
    const document = session.document;
    let editor: vscode.TextEditor | undefined;
    try {
      const end = document.positionAt(document.getText().length);
      editor = await vscode.window.showTextDocument(document, {
        viewColumn: visibleEditor?.viewColumn ?? vscode.ViewColumn.Beside,
        preserveFocus: false,
        preview: false,
        selection: new vscode.Selection(end, end)
      });
    } catch {
      return;
    }
    if (
      !editor ||
      !host.isSessionCurrent(session) ||
      !host.isOpenDocument(document) ||
      document.version !== message.documentVersion ||
      !host.sameDocument(editor.document, document) ||
      !isWritableSourceDocument(editor.document)
    ) return;

    const invocation: SourceCreationInternalInvocation = {
      documentUri: document.uri.toString(),
      expectedDocumentVersion: message.documentVersion,
      insertionOrigin: "document-end"
    };
    await vscode.commands.executeCommand(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID, invocation);
  },

  handleSourceNavigation: async (session, message) => {
    if (
      !session.panel.active ||
      !host.isOpenDocument(session.document) ||
      session.document.version !== message.documentVersion ||
      !host.isNormalizedRangeSafe(session.document, message.range)
    ) return;
    const visibleEditor = host.visibleEditorFor(session.document);
    const range = vscodeRangeForNormalized(session.document, session.document.getText(), message.range);
    let editor: vscode.TextEditor | undefined;
    try {
      editor = await vscode.window.showTextDocument(session.document, {
        viewColumn: visibleEditor?.viewColumn ?? vscode.ViewColumn.Beside,
        preserveFocus: false,
        preview: false,
        selection: new vscode.Range(range.start, range.start)
      });
    } catch {
      return;
    }
    if (!editor || session.document.version !== message.documentVersion) return;
    try {
      await vscode.commands.executeCommand("editor.unfold");
    } catch {
      return;
    }
    if (session.document.version !== message.documentVersion) return;
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  },

  applyPlaceCommit: async (session, message) => {
    if (
      !host.isOpenDocument(session.document) ||
      session.document.version !== message.documentVersion
    ) {
      host.resyncOutputPreview(session);
      return;
    }
    const rawSource = session.document.getText();
    const normalizedSource = normalizedSourceFor(rawSource);
    if (
      normalizedSource !== message.normalizedSourceSnapshot ||
      !outputPreviewPlaceCoordinatePatchesAreSafe({
        normalizedSource,
        statementRange: message.statementRange,
        patches: message.patches
      })
    ) {
      host.resyncOutputPreview(session);
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    for (const patch of message.patches) {
      edit.replace(
        session.document.uri,
        vscodeRangeForNormalized(session.document, rawSource, patch.range),
        patch.replacement
      );
    }
    try {
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) host.resyncOutputPreview(session);
    } catch {
      host.resyncOutputPreview(session);
    }
  }
});
