import * as vscode from "vscode";
import type { DslSourceValueStepPlan, NuiLanguageSession } from "@nuinuicad/nui-language";
import type { DslValueStepDirection } from "../../src/dsl/dslValueStep";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID = "nuinuiCAD.stepSourceValueForward";
export const VSCODE_SOURCE_VALUE_STEP_BACKWARD_COMMAND_ID = "nuinuiCAD.stepSourceValueBackward";
export const VSCODE_SOURCE_VALUE_STEP_FORWARD_KEYBINDING_COMMAND_ID = "nuinuiCAD.stepSourceValueForward.keybinding";
export const VSCODE_SOURCE_VALUE_STEP_BACKWARD_KEYBINDING_COMMAND_ID = "nuinuiCAD.stepSourceValueBackward.keybinding";
export const VSCODE_SOURCE_VALUE_STEP_CONTEXT_KEY = "nuinuiCAD.sourceValueStepTarget";

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  Boolean(editor) &&
  editor!.document.languageId === "nui" &&
  editor!.document.uri.scheme === "file" &&
  editor!.document.fileName.endsWith(".nui") &&
  vscode.workspace.fs.isWritableFileSystem(editor!.document.uri.scheme) !== false;

const stepPlanForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageSession,
  direction: DslValueStepDirection
): DslSourceValueStepPlan | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const selections = editor.selections.map((selection) => ({
      start: normalizedOffsetFromRaw(rawSource, editor.document.offsetAt(selection.start)),
      end: normalizedOffsetFromRaw(rawSource, editor.document.offsetAt(selection.end))
    }));
  if (selections.length !== 1) return null;
  return languageAnalysisSession.sourceValueStepForSelection(selections[0]!, direction);
};

export const sourceValueStepIsAvailableForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageSession
): boolean => Boolean(
  stepPlanForEditor(editor, languageAnalysisSession, 1) ??
  stepPlanForEditor(editor, languageAnalysisSession, -1)
);

export const registerVscodeSourceValueStepFeature = ({
  languageAnalysisSessionFor
}: {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageSession;
}): vscode.Disposable => {
  let contextUpdate: Promise<void> = Promise.resolve();

  const setContext = (available: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => vscode.commands.executeCommand(
        "setContext",
        VSCODE_SOURCE_VALUE_STEP_CONTEXT_KEY,
        available
      ))
      .then(() => undefined);
  };

  const refreshContext = (editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void => {
    setContext(Boolean(editor && isSupportedSourceEditor(editor) && sourceValueStepIsAvailableForEditor(
      editor,
      languageAnalysisSessionFor(editor.document)
    )));
  };

  const execute = async (direction: DslValueStepDirection): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!isSupportedSourceEditor(editor)) return;
    const document = editor.document;
    const documentVersion = document.version;
    const rawSource = document.getText();
    const session = languageAnalysisSessionFor(document);
    const plan = stepPlanForEditor(editor, session, direction);
    if (!plan) {
      refreshContext(editor);
      return;
    }

    if (
      vscode.window.activeTextEditor !== editor ||
      !sameDocument(vscode.window.activeTextEditor.document, document) ||
      document.version !== documentVersion ||
      document.getText() !== rawSource ||
      session.getSourceRevision() !== plan.sourceRevision ||
      normalizedSourceFor(rawSource).slice(plan.edit.from, plan.edit.to) !== plan.edit.expectedText
    ) return;

    const editRange = vscodeRangeForNormalized(document, rawSource, plan.edit);
    const applied = await editor.edit(
      (builder) => builder.replace(editRange, plan.edit.newText),
      { undoStopBefore: true, undoStopAfter: true }
    );
    if (!applied) return;

    const currentRawSource = document.getText();
    const selectionRange = vscodeRangeForNormalized(document, currentRawSource, {
      from: plan.selection.start,
      to: plan.selection.end
    });
    editor.selection = new vscode.Selection(selectionRange.start, selectionRange.end);
    refreshContext(editor);
  };

  const forward = vscode.commands.registerCommand(
    VSCODE_SOURCE_VALUE_STEP_FORWARD_COMMAND_ID,
    () => execute(1)
  );
  const backward = vscode.commands.registerCommand(
    VSCODE_SOURCE_VALUE_STEP_BACKWARD_COMMAND_ID,
    () => execute(-1)
  );
  // VS Code folds a contributed command's `enablement` into every keybinding
  // that targets that command. Keep the broad Source-owned chords on private
  // dispatch IDs so a transient target context cannot fall through to a core
  // binding; both routes still reuse the same authoritative execute function.
  const forwardKeybinding = vscode.commands.registerCommand(
    VSCODE_SOURCE_VALUE_STEP_FORWARD_KEYBINDING_COMMAND_ID,
    () => execute(1)
  );
  const backwardKeybinding = vscode.commands.registerCommand(
    VSCODE_SOURCE_VALUE_STEP_BACKWARD_KEYBINDING_COMMAND_ID,
    () => execute(-1)
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
    forward,
    backward,
    forwardKeybinding,
    backwardKeybinding,
    activeEditorListener,
    selectionListener,
    documentChangeListener,
    closeListener,
    { dispose: () => setContext(false) }
  );
};
