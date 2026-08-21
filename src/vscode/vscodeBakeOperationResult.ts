import { isBakeCommandResult } from "../commands/bakeOperationResult";
import type { VscodeBakeOperationResult } from "./protocol";

export const vscodeBakeOperationResultFromCommand = (
  result: unknown
): VscodeBakeOperationResult | null => {
  if (!isBakeCommandResult(result)) return null;
  return {
    status: result.status === "applied" ? "applied" : "nothing",
    summary: result.bakeSummary
  };
};
