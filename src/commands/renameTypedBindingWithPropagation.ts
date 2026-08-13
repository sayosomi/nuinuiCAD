import { analyzeTypedBindingRenameInDocument, type TypedRenameAnalysisRejected } from "../document/typedRenameAnalysis";
import { buildTypedRenameSplices, type TypedRenameSpliceEntry } from "../document/typedRenameSplice";
import { sourceEditSession } from "../editor/sourceEditSession";
import type { BindingId } from "../scalars/bindingCatalog";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const invalidSourceError = "DSLテキストにエラーまたは未解決参照があるため、リネームできません。エラーを修正してから再操作してください。";
const spliceFailedError = "リネームを安全に適用できないため、変更を取り消しました。";

const analysisError = (analysis: TypedRenameAnalysisRejected): string => {
  switch (analysis.reason) {
    case "target-not-found":
      return "リネーム対象の変数が見つかりません。";
    case "invalid-name":
      return analysis.detail.message;
    case "same-scope-collision":
      return `「${analysis.detail.conflictingName}」と同じ名前は使えません。`;
    case "capture":
      return `「${analysis.detail.name}」の参照先が変わるため、リネームできません。`;
  }
};

const hasCleanCanonicalSource = () => {
  const document = useCadDocumentStore.getState();
  return document.docText === document.sourceText &&
    Boolean(document.doc.document && document.doc.statementMap) &&
    document.diagnostics.length === 0;
};

/**
 * Safely renames one typed `const`/`let` binding through the same
 * flush -> analyze -> atomic-reject-or-commit -> one Undo step boundary the
 * existing element rename command uses
 * (src/commands/renameElementWithPropagation.ts), swapping element-model-diff
 * patching for direct LineSplice patching since typed bindings have no
 * CadElement to diff. Not registered as a palette command || bound to any
 * shortcut - a UI entry point is a later task.
 */
export const renameTypedBindingWithPropagation = (bindingId: BindingId, requestedName: string): boolean => {
  if (sourceEditSession.flush("command") === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  if (!hasCleanCanonicalSource()) {
    useCadUiStore.getState().setCommandErrorMessage(invalidSourceError);
    return false;
  }

  const before = useCadDocumentStore.getState();
  const analysis = analyzeTypedBindingRenameInDocument({
    compiled: before.doc,
    targetBindingId: bindingId,
    newName: requestedName
  });
  if (analysis.verdict === "rejected") {
    useCadUiStore.getState().setCommandErrorMessage(analysisError(analysis));
    return false;
  }

  const target = before.doc.bindingAnalysis!.catalog.bindingsById.get(bindingId)!;
  if (analysis.newName === target.name) {
    useCadUiStore.getState().setCommandErrorMessage(null);
    return true;
  }
  if (!analysis.declarationSpan) {
    useCadUiStore.getState().setCommandErrorMessage(spliceFailedError);
    return false;
  }

  const entries: TypedRenameSpliceEntry[] = [
    { statementIndex: target.statementIndex, span: analysis.declarationSpan, oldName: target.name, newName: analysis.newName },
    ...analysis.occurrences
  ];
  const splice = buildTypedRenameSplices(before.sourceText, before.doc, entries);
  if (!splice.ok) {
    useCadUiStore.getState().setCommandErrorMessage(spliceFailedError);
    return false;
  }

  const result = useCadDocumentStore.getState().commitLineSplices(splice.splices);
  if (result.status === "rejected") {
    return false;
  }

  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};
