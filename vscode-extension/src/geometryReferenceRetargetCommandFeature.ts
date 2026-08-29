import * as vscode from "vscode";
import {
  planDslGeometryReferenceRetargetEditsResult,
  queryDslGeometryReferenceRetargetTarget,
  type DslGeometryReferenceRetargetCandidate,
  type DslGeometryReferenceRetargetEdit,
  type DslGeometryReferenceRetargetTarget,
  type DslGeometryReferenceRetargetSemanticSnapshot
} from "../../src/dsl/dslGeometryReferenceRetargetQuery";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID = "nuinuiCAD.replaceGeometryReferences";
export const VSCODE_GEOMETRY_REFERENCE_RETARGET_CONTEXT_KEY = "nuinuiCAD.geometryReferenceRetargetSourceTarget";

type GeometryReferenceRetargetQuickPickItem = vscode.QuickPickItem & {
  candidate: DslGeometryReferenceRetargetCandidate;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isSupportedWritableSourceEditor = (
  editor: vscode.TextEditor | undefined
): editor is vscode.TextEditor => Boolean(
  editor &&
  editor.document.languageId === "nui" &&
  editor.document.uri.scheme === "file" &&
  editor.document.fileName.endsWith(".nui") &&
  vscode.workspace.fs?.isWritableFileSystem(editor.document.uri.scheme) !== false
);

type SourceState = {
  rawSource: string;
  normalizedSourceOffset: number;
  source: {
    normalizedSource: string;
    sourceRevision: number;
  };
  semantic: DslGeometryReferenceRetargetSemanticSnapshot | undefined;
  session: NuiLanguageAnalysisSession;
  target: DslGeometryReferenceRetargetTarget | null;
};

const sourceStateForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): SourceState => {
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  const semantic = languageAnalysisSession.definitionSemanticSnapshot(source);
  return {
    rawSource,
    normalizedSourceOffset,
    source,
    semantic,
    session: languageAnalysisSession,
    target: queryDslGeometryReferenceRetargetTarget({ source, semantic }, normalizedSourceOffset)
  };
};

export const geometryReferenceRetargetTargetForEditor = (
  editor: vscode.TextEditor | undefined,
  languageAnalysisSession: NuiLanguageAnalysisSession
): DslGeometryReferenceRetargetTarget | null => {
  if (!isSupportedWritableSourceEditor(editor)) return null;
  return sourceStateForEditor(editor, languageAnalysisSession).target;
};

const quickPickItemsFor = (
  candidates: readonly DslGeometryReferenceRetargetCandidate[]
): readonly GeometryReferenceRetargetQuickPickItem[] => candidates.map((candidate) => {
  const paths = candidate.referencePaths.map((path) => `@${path}`).join(", ");
  return {
    label: candidate.name,
    description: `${candidate.interfaceType} geometry`,
    detail: `Reference path${candidate.referencePaths.length === 1 ? "" : "s"}: ${paths}`,
    candidate
  };
});

const plannerFailureMessage = (reason: string): string => {
  switch (reason) {
    case "stale-source":
      return "Source changed while replacing geometry references. Run the command again.";
    case "unavailable-semantics":
      return "Current Source semantics are unavailable. Fix the current Source diagnostics and try again.";
    case "invalid-target":
      return "The current caret is no longer on a geometry reference. Run the command again.";
    case "incomplete-references":
      return "The geometry references could not be fully identified. No changes were made.";
    case "candidate-not-found":
      return "The selected geometry is no longer an available replacement. Run the command again.";
    case "incompatible-candidate":
      return "The selected geometry is not compatible with every reference. Choose another candidate.";
    case "unreachable-candidate":
      return "The selected geometry cannot be referenced from every occurrence. Choose another candidate.";
    case "proposed-source-verification-failed":
      return "The proposed Source edit failed semantic verification. No changes were made.";
    default:
      return "The geometry-reference replacement could not be verified. No changes were made.";
  }
};

const mappedEditFor = (
  document: vscode.TextDocument,
  rawSource: string,
  edit: DslGeometryReferenceRetargetEdit
): { range: vscode.Range; edit: DslGeometryReferenceRetargetEdit } | null => {
  const normalizedSource = normalizedSourceFor(rawSource);
  if (normalizedSource.slice(edit.from, edit.to) !== edit.expectedText) return null;
  const range = vscodeRangeForNormalized(document, rawSource, edit);
  const rawFrom = document.offsetAt(range.start);
  const rawTo = document.offsetAt(range.end);
  if (rawSource.slice(rawFrom, rawTo) !== edit.expectedText) return null;
  return { range, edit };
};

export const registerVscodeGeometryReferenceRetargetFeature = ({
  languageAnalysisSessionFor
}: {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
}): vscode.Disposable => {
  let contextUpdate: Promise<void> = Promise.resolve();

  const setContext = (available: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.resolve(vscode.commands.executeCommand(
        "setContext",
        VSCODE_GEOMETRY_REFERENCE_RETARGET_CONTEXT_KEY,
        available
      )))
      .then(() => undefined);
  };

  const refreshContext = (editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void => {
    setContext(Boolean(
      isSupportedWritableSourceEditor(editor) &&
      sourceStateForEditor(editor, languageAnalysisSessionFor(editor.document)).target
    ));
  };

  const execute = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!isSupportedWritableSourceEditor(editor)) return;

    const captured = sourceStateForEditor(editor, languageAnalysisSessionFor(editor.document));
    if (!captured.target) {
      refreshContext(editor);
      void vscode.window.showErrorMessage(
        "nuinuiCAD: Place the Source caret on an exact geometry reference to replace it."
      );
      return;
    }
    if (captured.target.candidates.length === 0) {
      void vscode.window.showErrorMessage(
        "nuinuiCAD: No compatible geometry replacement is available for this reference."
      );
      return;
    }

    const document = editor.document;
    const documentVersion = document.version;
    const items = quickPickItemsFor(captured.target.candidates);
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select replacement geometry",
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!selected) return;

    const currentEditor = vscode.window.activeTextEditor;
    if (
      !currentEditor ||
      currentEditor !== editor ||
      !sameDocument(currentEditor.document, document) ||
      document.version !== documentVersion ||
      document.getText() !== captured.rawSource
    ) {
      void vscode.window.showErrorMessage(
        "nuinuiCAD: Source changed while choosing a replacement. No changes were made."
      );
      return;
    }

    const current = sourceStateForEditor(editor, captured.session);
    const result = planDslGeometryReferenceRetargetEditsResult(
      {
        source: current.source,
        semantic: current.semantic
      },
      captured.normalizedSourceOffset,
      selected.candidate.identity
    );
    if (result.status === "rejected") {
      void vscode.window.showErrorMessage(`nuinuiCAD: ${plannerFailureMessage(result.rejection.reason)}`);
      return;
    }

    const mappedEdits = result.plan.edits.map((edit) => mappedEditFor(document, current.rawSource, edit));
    if (mappedEdits.some((mapped) => mapped === null)) {
      void vscode.window.showErrorMessage(
        "nuinuiCAD: The current Source text no longer matches the planned replacement. No changes were made."
      );
      return;
    }

    if (
      vscode.window.activeTextEditor !== editor ||
      document.version !== documentVersion ||
      document.getText() !== current.rawSource
    ) {
      void vscode.window.showErrorMessage(
        "nuinuiCAD: Source changed before the replacement could be applied. No changes were made."
      );
      return;
    }

    const applied = await editor.edit((builder) => {
      for (const mapped of mappedEdits) {
        if (mapped) builder.replace(mapped.range, mapped.edit.newText);
      }
    }, { undoStopBefore: true, undoStopAfter: true });
    if (!applied) {
      void vscode.window.showErrorMessage(
        "nuinuiCAD: VS Code could not apply the geometry-reference replacement. No changes were made."
      );
      return;
    }
    refreshContext(editor);
  };

  const command = vscode.commands.registerCommand(
    VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID,
    execute
  );
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => refreshContext(editor));
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) refreshContext(event.textEditor);
  });
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && sameDocument(editor.document, event.document)) refreshContext(editor);
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument(() => refreshContext(vscode.window.activeTextEditor));

  refreshContext();
  return vscode.Disposable.from(
    command,
    activeEditorListener,
    selectionListener,
    documentChangeListener,
    closeListener,
    { dispose: () => setContext(false) }
  );
};
