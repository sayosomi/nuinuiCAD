import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { getSelectedElementIds } from "./commandRuntime";
import type { BakeSandboxEvaluation, Command, CommandContext } from "./commandTypes";
import {
  applyBakePlan,
  planBakeGeometry,
  resolveDisabledBakeTargetIds,
  type BakeMode,
  type BakePlan
} from "./bakeGeometry";
import {
  bakeOperationSummaryForPlan,
  emptyBakeOperationSummary,
  type BakeCommandResult
} from "./bakeOperationResult";

const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

const bakeFailure = (message: string) => {
  useCadUiStore.getState().setCommandErrorMessage(message);
  return false;
};

const bakeNothing = (plan: BakePlan | null): BakeCommandResult => {
  useCadUiStore.getState().setCommandErrorMessage("Bakeできるジオメトリがありません。");
  return {
    status: "noop",
    bakeSummary: plan ? bakeOperationSummaryForPlan(plan) : emptyBakeOperationSummary()
  };
};

const runBake = (mode: BakeMode, context?: CommandContext) => {
  const document = useCadDocumentStore.getState();
  const evaluation = context?.evaluation;
  if (!evaluation || context?.evaluationIsCurrent === false || document.docText !== document.sourceText) {
    return bakeFailure("現在の評価結果がないため、Bakeを実行できません。");
  }
  const selectedElementIds = context?.bakeSelectedElementIds ?? getSelectedElementIds();
  const includeHiddenGeometry = context?.includeHiddenGeometry ?? false;
  const includeDisabledGeometry = context?.includeDisabledGeometry ?? false;
  const disabledTargetIds = resolveDisabledBakeTargetIds({
    compiled: document.doc,
    elements: document.elements,
    selectedElementIds,
    sourceStatementIndex: context?.sourceStatementIndex
  });
  const runWithSandbox = (sandbox?: BakeSandboxEvaluation) => {
    const currentDocument = useCadDocumentStore.getState();
    if (sandbox && (
      sandbox.compiledDocumentRevision !== currentDocument.compiledDocumentRevision ||
      !sameIds(sandbox.targetIds, disabledTargetIds)
    )) return bakeFailure("Bake対象の評価結果が古くなったため、Bakeを中止しました。");
    const plan = planBakeGeometry({
      mode,
      elements: currentDocument.elements,
      evaluation,
      baseEvaluation: context?.baseEvaluation,
      compiled: currentDocument.doc,
      selectedElementIds,
      sourceStatementIndex: context?.sourceStatementIndex,
      emitSkippedComments: context?.emitSkippedComments ?? true,
      includeHiddenGeometry,
      includeDisabledGeometry,
      bakeDisabledEvaluation: sandbox?.evaluation ?? context?.bakeDisabledEvaluation
    });
    if (!plan || (plan.splices.length === 0 && plan.generatedElementIds.length === 0)) {
      return bakeNothing(plan);
    }
    const mutation = applyBakePlan(plan);
    if (mutation.status === "rejected") return mutation;
    return {
      ...mutation,
      bakeSummary: bakeOperationSummaryForPlan(plan)
    } satisfies BakeCommandResult;
  };

  if (includeDisabledGeometry && disabledTargetIds.length > 0) {
    const suppliedTargetIds = context?.bakeDisabledEvaluationTargetIds;
    const suppliedIsCurrent = context?.bakeDisabledEvaluationIsCurrent === true;
    if (context?.bakeDisabledEvaluation && suppliedIsCurrent &&
      suppliedTargetIds && sameIds(suppliedTargetIds, disabledTargetIds)) {
      return runWithSandbox({
        evaluation: context.bakeDisabledEvaluation,
        targetIds: suppliedTargetIds,
        compiledDocumentRevision: document.compiledDocumentRevision
      });
    }
    if (!context?.prepareBakeSandbox) return bakeFailure("disabled geometryのBake用評価を準備できないため、Bakeを中止しました。");
    return context.prepareBakeSandbox(disabledTargetIds)
      .then((sandbox) => sandbox ? runWithSandbox(sandbox) : bakeFailure("Bake用評価が利用できないか、古くなったため、Bakeを中止しました。"))
      .catch(() => bakeFailure("Bake用評価に失敗したため、Bakeを中止しました。"));
  }

  return runWithSandbox();
};

export const bakeCommandDefinitions: Record<"bakeCurrentShape" | "bakeBaseShape", Command> = {
  bakeCurrentShape: {
    id: "bakeCurrentShape",
    label: "現在の形状をBake",
    palette: { order: 40, keywords: ["bake", "current", "形状", "現在"] },
    run: (context) => runBake("current", context)
  },
  bakeBaseShape: {
    id: "bakeBaseShape",
    label: "ベース形状をBake",
    palette: { order: 41, keywords: ["bake", "base", "形状", "ベース"] },
    run: (context) => runBake("base", context)
  }
};
