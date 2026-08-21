import type { BakePlan, BakeSkippedTarget } from "./bakeGeometry";

export type BakeOperationSummary = {
  successfulTargetCount: number;
  skippedTargets: BakeSkippedTarget[];
  skippedTargetCount: number;
};

export type BakeCommandResult = {
  status: "applied" | "noop";
  bakeSummary: BakeOperationSummary;
};

export const bakeOperationSummaryForPlan = (plan: BakePlan): BakeOperationSummary => ({
  successfulTargetCount: plan.successfulTargetCount,
  skippedTargets: [...plan.skippedTargets],
  skippedTargetCount: plan.skippedTargets.length
});

export const isBakeCommandResult = (value: unknown): value is BakeCommandResult => {
  if (typeof value !== "object" || value === null || !("status" in value) || !("bakeSummary" in value)) return false;
  const candidate = value as { status?: unknown; bakeSummary?: unknown };
  if (candidate.status !== "applied" && candidate.status !== "noop") return false;
  const summary = candidate.bakeSummary;
  if (typeof summary !== "object" || summary === null) return false;
  const typed = summary as Partial<BakeOperationSummary>;
  return Number.isInteger(typed.successfulTargetCount) &&
    Number.isInteger(typed.skippedTargetCount) &&
    Array.isArray(typed.skippedTargets);
};
