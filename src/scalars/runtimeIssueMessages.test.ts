import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { runtimeIssueMessage } from "./runtimeIssueMessages";

describe("runtimeIssueMessage", () => {
  it("resolves a named direct geometry target", () => {
    expect(runtimeIssueMessage(
      "evaluation-geometry-builtin-disabled",
      { kind: "geometryBuiltinTarget", targetElementId: "element:direct" },
      [{ id: "element:direct", name: "DirectOff" } as CadElement]
    )).toBe("「DirectOff」は評価OFFのためgeometry引数として利用できません。評価ONにするか、参照先を変更してください。");
  });

  it("resolves a named derived geometry target and keeps the action text on the base element", () => {
    expect(runtimeIssueMessage(
      "evaluation-geometry-builtin-disabled",
      { kind: "geometryBuiltinTarget", targetElementId: "element:shoulder", pointKey: "start" },
      [{ id: "element:shoulder", name: "肩線" } as CadElement]
    )).toBe("「肩線.start」は評価OFFのためgeometry引数として利用できません。「肩線」を評価ONにするか、参照先を変更してください。");
  });

  it("falls back to an element ID without context, even when the target cannot be resolved", () => {
    expect(runtimeIssueMessage(
      "evaluation-geometry-builtin-disabled",
      { kind: "geometryBuiltinTarget", targetElementId: "element:missing" }
    )).toBe("「element:missing」は評価OFFのためgeometry引数として利用できません。評価ONにするか、参照先を変更してください。");
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
