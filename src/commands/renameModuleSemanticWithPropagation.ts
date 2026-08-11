import { analyzeModuleSemanticRename, type ModuleRenameAnalysisRejected } from "../document/moduleSemanticRenameAnalysis";
import { buildSourceSemanticRenameSplices, type SourceSemanticRenameSpliceEntry } from "../document/typedRenameSplice";
import { sourceEditSession } from "../editor/sourceEditSession";
import type { ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

const compositionError = "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。";
const invalidSourceError = "DSLテキストにエラーまたは未解決参照があるため、リネームできません。エラーを修正してから再操作してください。";
const spliceFailedError = "リネームを安全に適用できないため、変更を取り消しました。";

const analysisError = (analysis: ModuleRenameAnalysisRejected) => {
  switch (analysis.reason) {
    case "target-not-found": return "Moduleのリネーム対象が見つかりません。";
    case "stale": return invalidSourceError;
    case "invalid-name": return analysis.detail ?? "名前をDSL識別子として安全に表現できません。";
    case "same-scope-collision": return `「${analysis.detail ?? "同名"}」と同じ名前は使えません。`;
    case "capture": return "リネーム後にModuleの参照解決が変わるため、変更を中止しました。";
    case "span-mismatch":
    case "overlap": return spliceFailedError;
  }
};

export const renameModuleSemanticWithPropagation = (target: ModuleSemanticTarget, requestedName: string): boolean => {
  if (sourceEditSession.flush("command") === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(compositionError);
    return false;
  }
  const before = useCadDocumentStore.getState();
  if (before.docText !== before.sourceText || before.diagnostics.length > 0 || !before.doc.moduleSemanticAnalysis) {
    useCadUiStore.getState().setCommandErrorMessage(invalidSourceError);
    return false;
  }
  const analysis = analyzeModuleSemanticRename(before.sourceText, before.doc, target, requestedName);
  if (analysis.verdict === "rejected") {
    useCadUiStore.getState().setCommandErrorMessage(analysisError(analysis));
    return false;
  }
  if (analysis.entries.length === 0) {
    useCadUiStore.getState().setCommandErrorMessage(null);
    return true;
  }
  const splice = buildSourceSemanticRenameSplices(before.sourceText, before.doc, analysis.entries as readonly SourceSemanticRenameSpliceEntry[]);
  if (!splice.ok) {
    useCadUiStore.getState().setCommandErrorMessage(spliceFailedError);
    return false;
  }
  const result = useCadDocumentStore.getState().commitLineSplices(splice.splices);
  if (result.status === "rejected") return false;
  useCadUiStore.getState().setCommandErrorMessage(null);
  return true;
};
