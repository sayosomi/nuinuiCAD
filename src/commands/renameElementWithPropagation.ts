import { analyzeRename, type RenameAnalysisRejected } from "../document/renameAnalysis";
import { shadowAssertEnabled } from "../document/shadowTextAssert";
import { sourceEditSession } from "../editor/sourceEditSession";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId } from "../types/geometry";
import { assertRenameBridgeCommit } from "./renameBridgeDevAssert";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const invalidSourceError = "DSLテキストにエラーがあるため、リネームできません。エラーを修正してから再操作してください。";

const analysisError = (analysis: RenameAnalysisRejected) => {
  switch (analysis.reason) {
    case "same-scope-conflict":
      return `${analysis.detail.conflictingLine}行目の「${analysis.detail.conflictingElementName}」と同じ名前は使えません。`;
    case "resolution-change": {
      const first = analysis.detail.changes[0];
      return first
        ? `${first.line}行目の参照先が変わるため、リネームできません。`
        : "参照先が変わるため、リネームできません。";
    }
    case "invalid-name":
      return analysis.detail.message;
    case "target-not-found":
      return "リネーム対象の要素が見つかりません。";
    case "invalid-source":
    case "analysis-incomplete":
      return `リネームの安全性を確認できません: ${analysis.detail.message}`;
  }
};

const hasCleanCanonicalSource = () => {
  const document = useCadDocumentStore.getState();
  return document.docText === document.sourceText &&
    Boolean(document.doc.document && document.doc.statementMap) &&
    !document.diagnostics.some((diagnostic) => diagnostic.severity === "error");
};

/**
 * Safely renames one compiled element through the existing model-to-text bridge.
 * This is intentionally not registered as a palette command until Phase 5g.
 */
export const renameElementWithPropagation = (elementId: ElementId, requestedName: string) => {
  if (sourceEditSession.flush("command") === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  if (!hasCleanCanonicalSource()) {
    useCadUiStore.getState().setCommandErrorMessage(invalidSourceError);
    return false;
  }

  const before = useCadDocumentStore.getState();
  const analysis = analyzeRename({
    sourceText: before.sourceText,
    compiled: before.doc,
    targetElementId: elementId,
    newName: requestedName
  });
  if (analysis.verdict === "rejected") {
    useCadUiStore.getState().setCommandErrorMessage(analysisError(analysis));
    return false;
  }
  const target = before.elements.find((element) => element.id === elementId)!;
  if (analysis.newName === target.name) {
    useCadUiStore.getState().setCommandErrorMessage(null);
    return true;
  }

  const result = useCadDocumentStore.getState().commitDocumentChange({
    elements: before.elements.map((element) =>
      element.id === elementId ? { ...element, name: analysis.newName } : element
    )
  });
  if (result.status === "rejected") {
    return false;
  }
  if (result.status === "applied" && shadowAssertEnabled) {
    const after = useCadDocumentStore.getState();
    assertRenameBridgeCommit({
      before: before.doc,
      after: after.doc,
      expectedPatchedLines: analysis.expectedPatchedLines,
      beforeSourceRevision: before.sourceRevision,
      afterSourceRevision: after.sourceRevision,
      sourceUpdate: after.sourceUpdate
    });
  }

  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};
