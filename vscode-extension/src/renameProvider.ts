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
import { activeVscodeMultiDocumentHost } from "./multiDocumentHost";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";
import { renameRejectionMessageFor, renameTranslatorFor } from "./renameLocalization";

export const nuiRenameSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

export const renameRejectionMessage = (
  rejection: DslRenameRejection,
  displayLanguage = vscodeDisplayLanguage()
): string => renameRejectionMessageFor(rejection, displayLanguage);

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
  sessionFor: NuiRenameSessionFor,
  displayLanguageFor: () => string = vscodeDisplayLanguage
): vscode.RenameProvider => ({
  prepareRename: (document, position) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const prepareSingleDocument = () => {
      const snapshot = captureRenameCall(document, sessionFor);
      const translator = renameTranslatorFor(displayLanguageFor());
      if (snapshot.hasCurrentErrors) throw new Error(translator("rename.currentSourceInvalid"));
      if (!snapshot.semantic) throw new Error(translator("rename.prepareUnavailable"));

      let target: DslRenameTarget | null;
      try {
        target = queryDslRenameTarget({ source: snapshot.source, semantic: snapshot.semantic }, normalizedOffsetFromRaw(
          snapshot.rawSource,
          document.offsetAt(position)
        ));
      } catch {
        throw new Error(renameTranslatorFor(displayLanguageFor())("rename.prepareUnavailable"));
      }
      if (!target || !isCurrentDocument(document, snapshot)) {
        throw new Error(renameTranslatorFor(displayLanguageFor())("rename.prepareUnavailable"));
      }

      return {
        range: currentTargetRangeFor(document, snapshot, target),
        placeholder: target.oldName
      };
    };

    const multiDocument = activeVscodeMultiDocumentHost();
    return multiDocument
      ? multiDocument.prepareRename(document, position).then((handled) => {
          if (!handled.handled) return prepareSingleDocument();
          if (!handled.value) throw new Error(renameTranslatorFor(displayLanguageFor())("rename.prepareUnavailable"));
          return handled.value;
        })
      : prepareSingleDocument();
  },

  provideRenameEdits: (document, position, newName) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const provideSingleDocument = (): vscode.WorkspaceEdit => {
      const snapshot = captureRenameCall(document, sessionFor);
      const translator = renameTranslatorFor(displayLanguageFor());
      if (snapshot.hasCurrentErrors) throw new Error(translator("rename.currentSourceInvalid"));
      if (!snapshot.semantic) throw new Error(translator("rename.applyUnavailable"));

      let result: DslRenameEditPlanResult;
      try {
        result = planDslRenameEditsResult(
          { source: snapshot.source, semantic: snapshot.semantic },
          normalizedOffsetFromRaw(snapshot.rawSource, document.offsetAt(position)),
          newName
        );
      } catch {
        throw new Error(renameTranslatorFor(displayLanguageFor())("rename.applyUnavailable"));
      }

      if (result.status === "rejected") {
        throw new Error(renameRejectionMessage(result.rejection, displayLanguageFor()));
      }

      const plan: DslRenameEditPlan = result.plan;
      try {
        if (!exactPlanForSource(plan, snapshot.source) || !isCurrentDocument(document, snapshot)) {
          throw new Error(renameTranslatorFor(displayLanguageFor())("rename.applyUnavailable"));
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
        throw new Error(renameTranslatorFor(displayLanguageFor())("rename.applyUnavailable"));
      }
    };

    const multiDocument = activeVscodeMultiDocumentHost();
    return multiDocument
      ? multiDocument.provideRenameEdits(document, position, newName).then((handled) => {
          if (!handled.handled) return provideSingleDocument();
          if (!handled.value) throw new Error(renameTranslatorFor(displayLanguageFor())("rename.applyUnavailable"));
          return handled.value;
        })
      : provideSingleDocument();
  }
});
