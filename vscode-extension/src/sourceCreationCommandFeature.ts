import * as vscode from "vscode";
import { runSourceCreationFlow } from "./sourceCreationFlow";
import { createSourceCreationMru } from "./sourceCreationMru";

export const VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID = "nuinuiCAD.createGeometry";

export const registerVscodeSourceCreationCommandFeature = ({
  activeSourceEditor,
  displayLanguageFor
}: {
  activeSourceEditor: () => vscode.TextEditor | undefined;
  displayLanguageFor: () => string;
}): vscode.Disposable => {
  const sourceCreationMru = createSourceCreationMru();
  return vscode.commands.registerCommand(
    VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID,
    async (): Promise<boolean | undefined> => {
      const editor = activeSourceEditor();
      if (!editor) return undefined;
      const position = editor.selection.active;
      return runSourceCreationFlow(editor, position, displayLanguageFor(), sourceCreationMru);
    }
  );
};
