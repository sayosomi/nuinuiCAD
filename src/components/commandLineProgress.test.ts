import { describe, expect, it } from "vitest";
import type { CommandLineSession } from "../commands/commandLineSession";
import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement } from "../types/geometry";
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
      editingReturnPickState: null,
      insertionAnchor: { kind: "documentEnd" },
      insertionTarget: { insertionIndex: 0 },
      sourceInsertionLine: null,
      sourceInsertionOrigin: null,
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

  it("renders point-list progress in authored order, including repeated anchors", () => {
    const elements: CadElement[] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const session = {
      recipe: {
        type: "polyline",
        steps: [
          { kind: "pointList", key: "points", prompt: "点" },
          { kind: "name", autoSuggest: true }
        ]
      },
      args: {
        points: [referenceAnchor("a"), referenceAnchor("b"), referenceAnchor("a")],
        name: "折れ線"
      },
      currentStepIndex: 2,
      editingStepIndex: null,
      editingDraft: null,
      editingReturnPickState: null,
      insertionAnchor: { kind: "documentEnd" },
      insertionTarget: { insertionIndex: 0 },
      sourceInsertionLine: null,
      sourceInsertionOrigin: null,
      insertionIndex: 0,
      startedAtRevision: 1,
      nameSuggestion: "折れ線",
      error: null
    } satisfies CommandLineSession;

    expect(completedCommandLineSteps(session, elements)).toEqual([
      { stepIndex: 0, key: "points", label: "点", value: "A, B, A" },
      { stepIndex: 1, key: "name", label: "名前", value: "折れ線" }
    ]);
  });
});
