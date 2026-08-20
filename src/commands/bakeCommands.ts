import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { getSelectedElementIds } from "./commandRuntime";
import type { Command, CommandContext } from "./commandTypes";
import { applyBakePlan, planBakeGeometry, type BakeMode } from "./bakeGeometry";

const runBake = (mode: BakeMode, context?: CommandContext) => {
  const document = useCadDocumentStore.getState();
  const evaluation = context?.evaluation;
  if (!evaluation || context?.evaluationIsCurrent === false || document.docText !== document.sourceText) {
    useCadUiStore.getState().setCommandErrorMessage("現在の評価結果がないため、Bakeを実行できません。");
    return false;
  }
  const plan = planBakeGeometry({
    mode,
    elements: document.elements,
    evaluation,
    baseEvaluation: context?.baseEvaluation,
    compiled: document.doc,
    selectedElementIds: getSelectedElementIds(),
    sourceStatementIndex: context?.sourceStatementIndex,
    emitSkippedComments: context?.emitSkippedComments ?? true,
    includeHiddenGeometry: context?.includeHiddenGeometry ?? false,
    includeDisabledGeometry: context?.includeDisabledGeometry ?? false,
    bakeDisabledEvaluation: context?.bakeDisabledEvaluation
  });
  if (!plan || (plan.splices.length === 0 && plan.generatedElementIds.length === 0)) {
    useCadUiStore.getState().setCommandErrorMessage("Bakeできるジオメトリがありません。");
    return false;
  }
  return applyBakePlan(plan);
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
