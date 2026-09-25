import * as vscode from "vscode";
import {
  collectExtractModuleSourceTargets,
  VSCODE_EXTRACT_MODULE_COMMAND_ID
} from "./extractModuleCommandFeature";
import {
  collectInlineModuleSourceTargets,
  VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID
} from "./inlineModuleCommandFeature";
import {
  geometryReferenceRetargetTargetForEditor,
  VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID
} from "./geometryReferenceRetargetCommandFeature";
import {
  VSCODE_COORDINATE_POINT_CONVERSION_ANGLE_DISTANCE_COMMAND_ID,
  VSCODE_COORDINATE_POINT_CONVERSION_XY_COMMAND_ID,
  type VscodeCoordinatePointConversionFeature
} from "./coordinatePointConversionCommandFeature";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";

export const nuiRefactorCodeActionSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export const nuiRefactorCodeActionKinds: readonly vscode.CodeActionKind[] = [
  vscode.CodeActionKind.RefactorExtract,
  vscode.CodeActionKind.RefactorInline,
  vscode.CodeActionKind.RefactorRewrite
];

type RefactorCodeActionProviderHost = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  coordinatePointConversionFeature: Pick<VscodeCoordinatePointConversionFeature, "sourceTargetAvailableForEditor">;
  displayLanguageFor?: () => string;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isWritableNuiDocument = (document: vscode.TextDocument): boolean =>
  document.languageId === "nui" &&
  document.uri.scheme === "file" &&
  document.fileName.endsWith(".nui") &&
  vscode.workspace.fs?.isWritableFileSystem(document.uri.scheme) !== false;

const activeSourceEditorFor = (document: vscode.TextDocument): vscode.TextEditor | undefined => {
  const editor = vscode.window.activeTextEditor;
  return editor && sameDocument(editor.document, document) && isWritableNuiDocument(editor.document)
    ? editor
    : undefined;
};

const kindValueFor = (kind: vscode.CodeActionKind): string => {
  const value = (kind as unknown as { value?: unknown }).value;
  return typeof value === "string" ? value : String(kind);
};

const kindRequestedBy = (
  actionKind: vscode.CodeActionKind,
  only: vscode.CodeActionKind | undefined
): boolean => {
  if (!only) return true;
  const contains = (only as unknown as { contains?: (other: vscode.CodeActionKind) => boolean }).contains;
  if (typeof contains === "function") return contains.call(only, actionKind);
  const requested = kindValueFor(only);
  const action = kindValueFor(actionKind);
  return action === requested || action.startsWith(`${requested}.`);
};

const titleFor = (key: "extract" | "inline" | "replace" | "xy" | "angle-distance", language: string): string => {
  const japanese = language.toLowerCase().startsWith("ja");
  if (japanese) {
    return {
      extract: "nuinuiCAD: Moduleを抽出",
      inline: "nuinuiCAD: Module instanceをインライン化",
      replace: "nuinuiCAD: ジオメトリ参照を置換",
      xy: "nuinuiCAD: XYオフセット…",
      "angle-distance": "nuinuiCAD: 角度と距離のオフセット…"
    }[key];
  }
  return {
    extract: "nuinuiCAD: Extract Module",
    inline: "nuinuiCAD: Inline Module Instance",
    replace: "nuinuiCAD: Replace Geometry References",
    xy: "nuinuiCAD: XY Offset…",
    "angle-distance": "nuinuiCAD: Angle-Distance Offset…"
  }[key];
};

const actionFor = (
  title: string,
  kind: vscode.CodeActionKind,
  command: string
): vscode.CodeAction => {
  const action = new vscode.CodeAction(title, kind);
  action.command = { title, command };
  return action;
};

export const createNuiRefactorCodeActionProvider = ({
  languageAnalysisSessionFor,
  coordinatePointConversionFeature,
  displayLanguageFor = () => vscode.env?.language ?? "en"
}: RefactorCodeActionProviderHost): vscode.CodeActionProvider => ({
  provideCodeActions: async (
    document,
    _range,
    context
  ): Promise<readonly vscode.CodeAction[]> => {
    if (!isWritableNuiDocument(document)) return [];
    const editor = activeSourceEditorFor(document);
    if (!editor) return [];

    const requested = (kind: vscode.CodeActionKind): boolean => kindRequestedBy(kind, context.only);
    const session = languageAnalysisSessionFor(document);
    const actions: vscode.CodeAction[] = [];

    if (requested(vscode.CodeActionKind.RefactorExtract)) {
      const invocation = collectExtractModuleSourceTargets(editor, languageAnalysisSessionFor);
      if (invocation && invocation.targets.length > 0) {
        actions.push(actionFor(
          titleFor("extract", displayLanguageFor()),
          vscode.CodeActionKind.RefactorExtract,
          VSCODE_EXTRACT_MODULE_COMMAND_ID
        ));
      }
    }

    if (requested(vscode.CodeActionKind.RefactorInline)) {
      const invocation = collectInlineModuleSourceTargets(editor, languageAnalysisSessionFor);
      if (invocation && invocation.targets.length > 0) {
        actions.push(actionFor(
          titleFor("inline", displayLanguageFor()),
          vscode.CodeActionKind.RefactorInline,
          VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID
        ));
      }
    }

    if (requested(vscode.CodeActionKind.RefactorRewrite)) {
      const geometryTarget = geometryReferenceRetargetTargetForEditor(editor, session);
      if (geometryTarget) {
        actions.push(actionFor(
          titleFor("replace", displayLanguageFor()),
          vscode.CodeActionKind.RefactorRewrite,
          VSCODE_GEOMETRY_REFERENCE_RETARGET_COMMAND_ID
        ));
      }

      if (await coordinatePointConversionFeature.sourceTargetAvailableForEditor(editor)) {
        actions.push(
          actionFor(
            titleFor("xy", displayLanguageFor()),
            vscode.CodeActionKind.RefactorRewrite,
            VSCODE_COORDINATE_POINT_CONVERSION_XY_COMMAND_ID
          ),
          actionFor(
            titleFor("angle-distance", displayLanguageFor()),
            vscode.CodeActionKind.RefactorRewrite,
            VSCODE_COORDINATE_POINT_CONVERSION_ANGLE_DISTANCE_COMMAND_ID
          )
        );
      }
    }

    return actions;
  }
});
