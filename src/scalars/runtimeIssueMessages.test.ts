import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { runtimeIssueMessage } from "./runtimeIssueMessages";

describe("runtimeIssueMessage", () => {
  it("resolves a named geometry target and keeps the action text on the base element", () => {
    expect(runtimeIssueMessage(
      "evaluation-geometry-builtin-disabled",
      { kind: "geometryBuiltinTarget", targetElementId: "element:shoulder", pointKey: "start" },
      [{ id: "element:shoulder", name: "肩線" } as CadElement]
    )).toBe("組み込み関数のgeometry引数「肩線.start」は評価OFFのため利用できません。「肩線」を評価ONにするか、参照先を変更してください。");
  });

  it("falls back to an element ID without context, even when the target cannot be resolved", () => {
    expect(runtimeIssueMessage(
      "evaluation-geometry-builtin-disabled",
      { kind: "geometryBuiltinTarget", targetElementId: "element:missing" }
    )).toBe("組み込み関数のgeometry引数「element:missing」は評価OFFのため利用できません。「element:missing」を評価ONにするか、参照先を変更してください。");
    expect(runtimeIssueMessage("evaluation-geometry-builtin-disabled")).toBe(
      "組み込み関数のgeometry引数がdisabledのため利用できません。"
    );
  });

  it("does not change the generic unavailable wording", () => {
    expect(runtimeIssueMessage("evaluation-geometry-builtin-unavailable")).toBe(
      "組み込み関数のgeometry引数を評価できません。参照先のgeometryが有効で、正常に評価済みか確認してください。"
    );
  });
});
