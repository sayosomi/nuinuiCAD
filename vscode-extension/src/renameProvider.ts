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

export const nuiRenameSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");
const prepareRenameFailureMessage = "Rename is not available at this position.";
const provideRenameEditsFailureMessage = "Rename could not be applied.";

export const renameRejectionMessage = (rejection: DslRenameRejection): string => {
  switch (rejection.reason) {
    case "invalid-name":
      return rejection.message;
    case "same-scope-collision":
      return rejection.conflictingLine === undefined
        ? `「${rejection.conflictingName}」と同じ名前は使えません。`
        : `${rejection.conflictingLine}行目の「${rejection.conflictingName}」と同じ名前は使えません。`;
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

const normalizedOffsetFromRaw = (rawSource: string, rawOffset: number): number => {
  let removedCarriageReturns = 0;
  for (let index = 0; index < rawOffset; index += 1) {
    if (rawSource[index] === "\r" && rawSource[index + 1] === "\n") removedCarriageReturns += 1;
  }
  return rawOffset - removedCarriageReturns;
};

const rawOffsetFromNormalized = (rawSource: string, normalizedOffset: number): number => {
  let rawOffset = 0;
  let normalizedPosition = 0;
  while (rawOffset < rawSource.length && normalizedPosition < normalizedOffset) {
    if (rawSource[rawOffset] === "\r" && rawSource[rawOffset + 1] === "\n") rawOffset += 1;
    rawOffset += 1;
    normalizedPosition += 1;
  }
  return rawOffset;
};

const vscodeRangeFor = (
  document: vscode.TextDocument,
  rawSource: string,
  range: { from: number; to: number }
): vscode.Range => new vscode.Range(
  document.positionAt(rawOffsetFromNormalized(rawSource, range.from)),
  document.positionAt(rawOffsetFromNormalized(rawSource, range.to))
);

export type NuiRenameSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

type RenameCallSnapshot = {
  documentVersion: number;
  rawSource: string;
  source: SourceSnapshot;
  semantic: ReturnType<NuiLanguageAnalysisSession["renameSemanticSnapshot"]>;
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
    semantic: session.renameSemanticSnapshot(source)
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
): vscode.RenameProvider => ({
  prepareRename: (document, position) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const snapshot = captureRenameCall(document, sessionFor);
    if (!snapshot.semantic) throw new Error(prepareRenameFailureMessage);

    let target: DslRenameTarget | null;
    try {
      target = queryDslRenameTarget({ source: snapshot.source, semantic: snapshot.semantic }, normalizedOffsetFromRaw(
        snapshot.rawSource,
        document.offsetAt(position)
      ));
    } catch {
      throw new Error(prepareRenameFailureMessage);
    }
    if (!target || !isCurrentDocument(document, snapshot)) throw new Error(prepareRenameFailureMessage);

    return {
      range: currentTargetRangeFor(document, snapshot, target),
      placeholder: target.oldName
    };
  },

  provideRenameEdits: (document, position, newName) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const snapshot = captureRenameCall(document, sessionFor);
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
});
