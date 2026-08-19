import * as vscode from "vscode";
import {
  planDslRenameEditsResult,
  queryDslRenameTarget,
  type DslRenameEditPlan,
  type DslRenameEditPlanResult,
  type DslRenameRejection,
  type DslRenameTarget
} from "../../src/dsl/dslRenameQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiRenameSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const prepareRenameFailureMessage = "Rename is not available at this position.";
const provideRenameEditsFailureMessage = "Rename could not be applied.";
const invalidCurrentSourceRenameMessage = "現在のソースにエラーがあるため、リネームできません。エラーを修正してから再試行してください。";

const say41PositionSnapshot = (position: vscode.Position) => ({
  line: position.line,
  character: position.character
});

const say41SelectionSnapshot = (selection: vscode.Selection) => ({
  anchor: say41PositionSnapshot(selection.anchor),
  active: say41PositionSnapshot(selection.active),
  start: say41PositionSnapshot(selection.start),
  end: say41PositionSnapshot(selection.end),
  isEmpty: selection.isEmpty
});

const say41EditorSnapshot = (editor: vscode.TextEditor | undefined) => editor ? ({
  uri: editor.document.uri.toString(),
  version: editor.document.version,
  viewColumn: editor.viewColumn,
  selection: say41SelectionSnapshot(editor.selection)
}) : null;

let say41TraceListenersInstalled = false;

const installSay41TraceListeners = (): void => {
  if (say41TraceListenersInstalled) return;
  say41TraceListenersInstalled = true;

  if (typeof vscode.window.onDidChangeActiveTextEditor === "function") {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      console.info("[SAY-41][activeTextEditor]", JSON.stringify({
        at: Date.now(),
        editor: say41EditorSnapshot(editor)
      }));
    });
  }

  if (typeof vscode.window.onDidChangeTextEditorSelection === "function") {
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!event.textEditor.document.fileName.endsWith(".nui")) return;
      console.info("[SAY-41][selection]", JSON.stringify({
        at: Date.now(),
        kind: event.kind,
        sameAsActiveEditor: event.textEditor === vscode.window.activeTextEditor,
        editor: say41EditorSnapshot(event.textEditor),
        eventSelections: event.selections.map(say41SelectionSnapshot),
        activeEditor: say41EditorSnapshot(vscode.window.activeTextEditor)
      }));
    });
  }
};

export const renameRejectionMessage = (rejection: DslRenameRejection): string => {
  switch (rejection.reason) {
    case "invalid-name":
      return rejection.message;
    case "same-scope-collision":
      return rejection.conflictingLine === undefined
        ? `「${rejection.conflictingName}」はこのスコープに既に存在します。`
        : `「${rejection.conflictingName}」は${rejection.conflictingLine}行目に既に存在します。`;
    case "reference-resolution-change":
      if (rejection.family === "typed") return `「${rejection.referencedName}」の参照先が変わるため、リネームできません。`;
      if (rejection.family === "element") {
        return rejection.line === undefined
          ? "参照先が変わるため、リネームできません。"
          : `${rejection.line}行目の参照先が変わるため、リネームできません。`;
      }
      return "リネーム後にModuleの参照解決が変わるため、変更を中止しました。";
    case "unavailable":
      return provideRenameEditsFailureMessage;
  }
};

const vscodeRangeFor = (
  document: vscode.TextDocument,
  rawSource: string,
  range: { from: number; to: number }
): vscode.Range => vscodeRangeForNormalized(document, rawSource, range);

export type NuiRenameSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

type RenameCallSnapshot = {
  documentVersion: number;
  rawSource: string;
  source: SourceSnapshot;
  semantic: ReturnType<NuiLanguageAnalysisSession["renameSemanticSnapshot"]>;
  hasCurrentErrors: boolean;
};

const captureRenameCall = (
  document: vscode.TextDocument,
  sessionFor: NuiRenameSessionFor
): RenameCallSnapshot => {
  const documentVersion = document.version;
  const rawSource = document.getText();
  const session = sessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);

  const source: SourceSnapshot = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  return {
    documentVersion,
    rawSource,
    source,
    semantic: session.renameSemanticSnapshot(source),
    hasCurrentErrors: session.getDiagnostics().some((diagnostic) => diagnostic.severity === "error")
  };
};

const isCurrentDocument = (document: vscode.TextDocument, snapshot: RenameCallSnapshot): boolean =>
  document.version === snapshot.documentVersion && document.getText() === snapshot.rawSource;

const exactPlanForSource = (
  plan: DslRenameEditPlan,
  source: SourceSnapshot
): boolean =>
  plan.sourceRevision === source.sourceRevision &&
  plan.edits.every((edit) =>
    Number.isInteger(edit.from) &&
    Number.isInteger(edit.to) &&
    edit.from >= 0 &&
    edit.to >= edit.from &&
    edit.to <= source.normalizedSource.length &&
    source.normalizedSource.slice(edit.from, edit.to) === edit.expectedText
  );

const currentTargetRangeFor = (
  document: vscode.TextDocument,
  snapshot: RenameCallSnapshot,
  target: DslRenameTarget
): vscode.Range => vscodeRangeFor(document, snapshot.rawSource, target.range);

export const createNuiRenameProvider = (
  sessionFor: NuiRenameSessionFor
): vscode.RenameProvider => {
  installSay41TraceListeners();
  return {
    prepareRename: (document, position) => {
      if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

      const rawOffset = document.offsetAt(position);
      console.info("[SAY-41][prepareRename]", JSON.stringify({
        at: Date.now(),
        uri: document.uri.toString(),
        version: document.version,
        position: say41PositionSnapshot(position),
        rawOffset,
        activeEditor: say41EditorSnapshot(vscode.window.activeTextEditor)
      }));

      const snapshot = captureRenameCall(document, sessionFor);
      if (snapshot.hasCurrentErrors) throw new Error(invalidCurrentSourceRenameMessage);
      if (!snapshot.semantic) throw new Error(prepareRenameFailureMessage);

      let target: DslRenameTarget | null;
      const normalizedOffset = normalizedOffsetFromRaw(snapshot.rawSource, rawOffset);
      try {
        target = queryDslRenameTarget(
          { source: snapshot.source, semantic: snapshot.semantic },
          normalizedOffset
        );
      } catch (error) {
        console.info("[SAY-41][prepareRenameQueryThrow]", JSON.stringify({
          at: Date.now(),
          normalizedOffset,
          error: error instanceof Error ? error.message : String(error)
        }));
        throw new Error(prepareRenameFailureMessage);
      }
      const currentDocument = isCurrentDocument(document, snapshot);
      console.info("[SAY-41][prepareRenameResult]", JSON.stringify({
        at: Date.now(),
        normalizedOffset,
        currentDocument,
        target: target ? {
          oldName: target.oldName,
          range: target.range
        } : null
      }));
      if (!target || !currentDocument) throw new Error(prepareRenameFailureMessage);

      return {
        range: currentTargetRangeFor(document, snapshot, target),
        placeholder: target.oldName
      };
    },

    provideRenameEdits: (document, position, newName) => {
      if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

      const snapshot = captureRenameCall(document, sessionFor);
      if (snapshot.hasCurrentErrors) throw new Error(invalidCurrentSourceRenameMessage);
      if (!snapshot.semantic) throw new Error(provideRenameEditsFailureMessage);

      let result: DslRenameEditPlanResult;
      try {
        result = planDslRenameEditsResult(
          { source: snapshot.source, semantic: snapshot.semantic },
          normalizedOffsetFromRaw(snapshot.rawSource, document.offsetAt(position)),
          newName
        );
      } catch {
        throw new Error(provideRenameEditsFailureMessage);
      }

      if (result.status === "rejected") {
        throw new Error(renameRejectionMessage(result.rejection));
      }

      const plan: DslRenameEditPlan = result.plan;
      try {
        if (!exactPlanForSource(plan, snapshot.source) || !isCurrentDocument(document, snapshot)) {
          throw new Error(provideRenameEditsFailureMessage);
        }

        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const edit of plan.edits) {
          workspaceEdit.replace(
            document.uri,
            vscodeRangeFor(document, snapshot.rawSource, edit),
            edit.newText
          );
        }
        return workspaceEdit;
      } catch {
        throw new Error(provideRenameEditsFailureMessage);
      }
    }
  };
};
