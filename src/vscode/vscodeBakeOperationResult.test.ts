import { describe, expect, it } from "vitest";
import type { BakeCommandResult } from "../commands/bakeOperationResult";
import type { VscodeToExtensionMessage } from "./protocol";
import { vscodeBakeOperationResultFromCommand } from "./vscodeBakeOperationResult";

const bakeCommandResult: BakeCommandResult = {
  status: "noop",
  bakeSummary: {
    successfulTargetCount: 1,
    skippedTargetCount: 1,
    skippedTargets: [{
      targetId: "target-1",
      sourceElementId: "source-1",
      sourceLabel: "line Broken",
      reason: {
        code: "evaluation-failed",
        diagnostics: [{
          elementId: "target-1",
          elementName: "Broken",
          missingDependencyId: "dependency-1",
          missingDependencyName: "Missing",
          message: "missing dependency"
        }]
      }
    }]
  }
};

describe("VS Code Bake operation result", () => {
  it("projects the command result without reclassifying semantic failures", () => {
    expect(vscodeBakeOperationResultFromCommand(bakeCommandResult)).toEqual({
      status: "nothing",
      summary: bakeCommandResult.bakeSummary
    });
    expect(vscodeBakeOperationResultFromCommand(false)).toBeNull();
    expect(vscodeBakeOperationResultFromCommand({ status: "rejected", reason: "invalid-change" })).toBeNull();
  });

  it("keeps Source and Canvas semantic result messages JSON-friendly", () => {
    const operationResult = vscodeBakeOperationResultFromCommand(bakeCommandResult)!;
    const messages: VscodeToExtensionMessage[] = [
      {
        type: "bakeOperationResult",
        surface: "source",
        requestId: 7,
        ...operationResult
      },
      {
        type: "bakeOperationResult",
        surface: "canvas",
        ...operationResult
      }
    ];

    expect(JSON.parse(JSON.stringify(messages))).toEqual(messages);
  });
});
