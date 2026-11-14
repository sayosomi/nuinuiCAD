import * as vscode from "vscode";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import { normalizedSourceFor } from "./sourceOffsetAdapter";
import {
  sourceOutputTemplateIsLegalIn,
  sourceOutputTemplateSnippetFor,
  type SourceOutputTemplateId
} from "../../src/commands/sourceOutputTemplateCatalog";
import {
  resolveDocumentEndSourceCreationInsertion,
} from "../../src/commands/sourceCreationInsertion";
import {
  insertSourceOutputTemplateSnippet,
  openNativeSourceSnippetPicker
} from "./sourceCreationSnippetAdapter";
import { runSourceCreationFlow } from "./sourceCreationFlow";
import { createSourceCreationMru } from "./sourceCreationMru";
import { nativeShowQuickPick } from "./nativeQuickInput";
import {
  createOfficialSnippetConfigurationFeature,
  VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID
} from "./officialSnippetConfiguration";
import {
  sourceCreationMessageFor,
  sourceOutputPrintPickerItemsFor
} from "./sourceCreationPresentationLocalization";

export const VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID = "nuinuiCAD.createGeometry";
export const VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID = "nuinuiCAD.insertTemplate";

export type SourceCreationInternalInvocation = {
  documentUri: string;
  expectedDocumentVersion: number;
  insertionOrigin: "document-end";
  preselectedFamilyId: "output-print";
};

const isSourceCreationInternalInvocation = (value: unknown): value is SourceCreationInternalInvocation => {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  if (keys.length !== 4 || keys.some((key) => ![
    "documentUri",
    "expectedDocumentVersion",
    "insertionOrigin",
    "preselectedFamilyId"
  ].includes(key))) return false;
  const candidate = value as Partial<SourceCreationInternalInvocation>;
  return typeof candidate.documentUri === "string" &&
    Number.isInteger(candidate.expectedDocumentVersion) &&
    candidate.insertionOrigin === "document-end" &&
    candidate.preselectedFamilyId === "output-print";
};

type SourceTemplateTarget = {
  editor: vscode.TextEditor;
  document: vscode.TextDocument;
  documentUri: string;
  documentVersion: number;
  rawSource: string;
  sourceRevision: number;
  insertionPosition: vscode.Position;
  session: NuiLanguageAnalysisSession;
};

export const isWritableSourceDocument = (document: vscode.TextDocument): boolean => {
  if (
    document.languageId !== "nui" ||
    document.uri.scheme !== "file" ||
    !document.fileName.endsWith(".nui")
  ) return false;
  return vscode.workspace.fs?.isWritableFileSystem(document.uri.scheme) !== false;
};

export const isWritableSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  editor !== undefined && isWritableSourceDocument(editor.document);

type SourceEditorSelectionSnapshot = {
  anchor: { line: number; character: number };
  active: { line: number; character: number };
};

const sourceEditorSelectionsFor = (editor: vscode.TextEditor): SourceEditorSelectionSnapshot[] =>
  editor.selections.map(({ anchor, active }) => ({
    anchor: { line: anchor.line, character: anchor.character },
    active: { line: active.line, character: active.character }
  }));

const sourceEditorSelectionsMatch = (
  editor: vscode.TextEditor,
  expected: readonly SourceEditorSelectionSnapshot[]
): boolean => editor.selections.length === expected.length && editor.selections.every((selection, index) => {
  const original = expected[index];
  return original !== undefined &&
    selection.anchor.line === original.anchor.line &&
    selection.anchor.character === original.anchor.character &&
    selection.active.line === original.active.line &&
    selection.active.character === original.active.character;
});

/** Resolves the guarded document-end target used only by Output Preview's internal flow. */
const currentSourceTemplateTargetFor = (
  editor: vscode.TextEditor,
  languageAnalysisSessionFor: ((document: vscode.TextDocument) => NuiLanguageAnalysisSession) | undefined
): SourceTemplateTarget | null => {
  if (!languageAnalysisSessionFor || !isWritableSourceEditor(editor)) return null;
  const document = editor.document;
  const rawSource = document.getText();
  const session = languageAnalysisSessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(session, source);
  if (!semantic) return null;

  const insertion = resolveDocumentEndSourceCreationInsertion({
    sourceText: rawSource,
    documentText: rawSource,
    sourceRevision: source.sourceRevision,
    elements: [...semantic.compiled.sourceElementsByStatementIndex.values()],
    statementMap: semantic.compiled.statementMap
  });
  if (insertion.kind !== "safe") return null;

  return {
    editor,
    document,
    documentUri: document.uri.toString(),
    documentVersion: document.version,
    rawSource,
    sourceRevision: source.sourceRevision,
    insertionPosition: document.positionAt(rawSource.length),
    session
  };
};

const sourceOutputSnippetOptionsFor = (target: SourceTemplateTarget) =>
  !target.rawSource.endsWith("\n")
    ? { prefixText: "\n" }
    : undefined;

const illegalScopeMessageFor = (
  templateId: SourceOutputTemplateId,
  displayLanguage: string
): string =>
  templateId === "place"
    ? sourceCreationMessageFor("placeScope", displayLanguage)
    : sourceCreationMessageFor("outputTopLevel", displayLanguage);

const insertOutputTemplate = async (
  target: SourceTemplateTarget,
  insertionPosition: vscode.Position,
  isCurrent: () => boolean,
  showStaleMessage: () => void,
  displayLanguage: string
): Promise<boolean | undefined> => {
  const outputTemplate = await nativeShowQuickPick(sourceOutputPrintPickerItemsFor(displayLanguage));
  if (!isCurrent()) {
    showStaleMessage();
    return undefined;
  }
  if (!outputTemplate) return undefined;
  const templateId = outputTemplate.id;
  if (!sourceOutputTemplateIsLegalIn(templateId, "top-level")) {
    void vscode.window.showErrorMessage(illegalScopeMessageFor(templateId, displayLanguage));
    return undefined;
  }

  return insertSourceOutputTemplateSnippet(
    target.editor,
    sourceOutputTemplateSnippetFor(templateId),
    insertionPosition,
    sourceOutputSnippetOptionsFor(target)
  );
};

export const registerVscodeSourceCreationCommandFeature = ({
  context,
  activeSourceEditor,
  displayLanguageFor,
  languageAnalysisSessionFor
}: {
  context: vscode.ExtensionContext;
  activeSourceEditor: () => vscode.TextEditor | undefined;
  displayLanguageFor: () => string;
  languageAnalysisSessionFor?: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
}): vscode.Disposable => {
  const sourceCreationMru = createSourceCreationMru();
  const officialSnippetConfiguration = createOfficialSnippetConfigurationFeature(context, displayLanguageFor);
  const configureOfficialSnippetsCommand = vscode.commands.registerCommand(
    VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID,
    officialSnippetConfiguration.configure
  );
  const createGeometryCommand = vscode.commands.registerCommand(
    VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID,
    async (): Promise<boolean | undefined> => {
      const editor = activeSourceEditor();
      if (!editor) return undefined;
      const position = editor.selection.active;
      return runSourceCreationFlow(editor, position, displayLanguageFor(), sourceCreationMru);
    }
  );
  const insertTemplateCommand = vscode.commands.registerCommand(
    VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID,
    async (invocationArgument?: unknown): Promise<boolean | undefined> => {
      if (invocationArgument === undefined) {
        const editor = activeSourceEditor();
        if (!isWritableSourceEditor(editor)) return undefined;
        const document = editor.document;
        const documentVersion = document.version;
        const selections = sourceEditorSelectionsFor(editor);
        if (!await officialSnippetConfiguration.beforeFirstInsert()) return undefined;
        const currentEditor = activeSourceEditor();
        if (
          currentEditor !== editor ||
          !isWritableSourceEditor(currentEditor) ||
          currentEditor.document !== document ||
          document.version !== documentVersion ||
          !sourceEditorSelectionsMatch(currentEditor, selections)
        ) return undefined;
        await openNativeSourceSnippetPicker(editor, documentVersion);
        return undefined;
      }

      if (!isSourceCreationInternalInvocation(invocationArgument)) return undefined;
      const internalInvocation = invocationArgument;
      const editor = activeSourceEditor();
      if (!isWritableSourceEditor(editor)) return undefined;
      const displayLanguage = displayLanguageFor();
      if (
        editor.document.uri.toString() !== internalInvocation.documentUri ||
        editor.document.version !== internalInvocation.expectedDocumentVersion
      ) return undefined;

      const target = currentSourceTemplateTargetFor(editor, languageAnalysisSessionFor);
      if (!target) {
        void vscode.window.showErrorMessage(sourceCreationMessageFor("unsafeInsertion", displayLanguage));
        return undefined;
      }

      let staleMessageShown = false;
      const showStaleMessage = (): void => {
        if (staleMessageShown) return;
        staleMessageShown = true;
        void vscode.window.showErrorMessage(sourceCreationMessageFor("stale", displayLanguage));
      };
      const isCurrent = (): boolean => {
        const currentEditor = activeSourceEditor();
        return target.editor.document === target.document &&
          target.editor.document.uri.toString() === target.documentUri &&
          target.document.version === target.documentVersion &&
          target.session.getSourceRevision() === target.sourceRevision &&
          target.session.getSource() === target.rawSource &&
          isWritableSourceEditor(currentEditor) &&
          currentEditor.document.uri.toString() === internalInvocation.documentUri &&
          currentEditor.document.version === internalInvocation.expectedDocumentVersion;
      };

      return insertOutputTemplate(
        target,
        target.insertionPosition,
        isCurrent,
        showStaleMessage,
        displayLanguage
      );
    }
  );
  return {
    dispose: (): void => {
      configureOfficialSnippetsCommand.dispose();
      createGeometryCommand.dispose();
      insertTemplateCommand.dispose();
    }
  };
};
