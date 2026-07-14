import { describe, expect, it } from "vitest";
import type { CommandLineSession } from "../commands/commandLineSession";
import { completedCommandLineSteps } from "./commandLineProgress";

describe("completedCommandLineSteps", () => {
  it("uses recipe order and safe fallbacks when a completed reference is unavailable", () => {
    const session = {
      recipe: {
        type: "lineDivisionPoint",
        steps: [
          { kind: "endpoint", key: "endpoint", prompt: "端点" },
          { kind: "number", key: "ratio", prompt: "割合" },
          { kind: "name", autoSuggest: true }
        ]
      },
      args: {
        endpoint: { lineId: "missing-line", endpointKey: "end" },
        ratio: { kind: "expression", expression: "rise / 2" },
        name: "分点"
      },
      currentStepIndex: 3,
      editingStepIndex: null,
      editingDraft: null,
      insertionIndex: 0,
      startedAtRevision: 1,
      nameSuggestion: "分点",
      error: null
    } satisfies CommandLineSession;

    expect(completedCommandLineSteps(session, [])).toEqual([
      { stepIndex: 0, key: "endpoint", label: "端点", value: "missing-line・終点" },
      { stepIndex: 1, key: "ratio", label: "割合", value: "rise / 2" },
      { stepIndex: 2, key: "name", label: "名前", value: "分点" }
    ]);
  });
});
