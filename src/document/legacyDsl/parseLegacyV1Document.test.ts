import { describe, expect, it } from "vitest";
import { compileDslDocument, type DslDocumentData } from "../../dsl/dslDocument";
import { expectSemanticallyEqualDocuments } from "../../dsl/dslDocumentTestUtils";
import { parseLegacyV1Document } from "./parseLegacyV1Document";
import sampleV1 from "../../dsl/__fixtures__/sample.v1.nui?raw";

// このテストは C1 以前(live `src/dsl/` がまだ v1)の間だけ「凍結側 == live側」を
// 検証する。C1 で live 側が v2 化したら、この等価性は成り立たなくなるため、
// 凍結側単独の期待値固定テストへ書き換えること
// (docs/dsl2/tasks/w5-legacy-freeze.md の引き継ぎ欄参照)。
describe("parseLegacyV1Document (C1前: liveのv1パースとの等価性)", () => {
  it("sample.v1.nui を live compileDslDocument と同一の文書として読める", () => {
    const legacy = parseLegacyV1Document(sampleV1);
    expect(legacy.diagnostics.filter((item) => item.severity === "error")).toEqual([]);

    const live = compileDslDocument(sampleV1);
    expect(live.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(live.document).not.toBeNull();

    const legacyDocument: DslDocumentData = {
      elements: legacy.elements,
      palette: legacy.palette,
      visibilityRoles: legacy.visibilityRoles,
      visibilityProfiles: legacy.visibilityProfiles,
      activeVisibilityProfileId: legacy.activeVisibilityProfileId,
      printLayouts: legacy.printLayouts,
      activePrintLayoutId: legacy.activePrintLayoutId,
      evaluationLimitIndex: legacy.evaluationLimitIndex
    };
    expectSemanticallyEqualDocuments(legacyDocument, live.document!);
  });
});

describe("parseLegacyV1Document (v1糖衣形の代表ケース)", () => {
  it("element type= 汎用形を読める(move)", () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line AB = A -> B",
      "element M type=move startPoint=A endPoint=B baseLineIds=[AB]"
    ].join("\n");
    const result = parseLegacyV1Document(source);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.elements).toHaveLength(4);
    const move = result.elements.find((element) => element.type === "move");
    expect(move).toBeDefined();
    expect(move?.name).toBe("M");
  });

  it("バックスラッシュ継続行を読める", () => {
    const source = [
      "nui 1",
      "point A = (0, 0) \\",
      "  color=main",
      "point B = (1, 1)"
    ].join("\n");
    const result = parseLegacyV1Document(source);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.elements).toHaveLength(2);
    const a = result.elements.find((element) => element.name === "A");
    expect(a).toMatchObject({ colorId: "main" });
  });

  it("parent= 属性によるブロック外フラット子付けを読める", () => {
    const source = [
      "nui 1",
      "group G {",
      "}",
      "point D = (5, 5) parent=G"
    ].join("\n");
    const result = parseLegacyV1Document(source);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.elements).toHaveLength(2);
    const group = result.elements.find((element) => element.type === "group");
    const d = result.elements.find((element) => element.name === "D");
    expect(group).toBeDefined();
    expect(d?.parentGroupId).toBe(group?.id);
  });
});

describe("parseLegacyV1Document (回帰)", () => {
  it("重複名検出のキーはNUL区切りで、スペース結合すると衝突するscope/nameでも偽の重複診断を出さない", () => {
    // scope="parent:A B" + name="C" と scope="parent:A" + name="B C" は
    // スペース結合すると同じ文字列("parent:A B C")になり、NUL区切りでなければ
    // 誤って同名衝突と判定される。
    const source = [
      "nui 1",
      "group A {",
      "}",
      'group "A B" {',
      "}",
      'point C = (0, 0) parent="A B"',
      'point "B C" = (1, 1) parent=A'
    ].join("\n");
    const result = parseLegacyV1Document(source);
    const duplicateNameDiagnostics = result.diagnostics.filter((item) =>
      item.message.includes("同名の要素")
    );
    expect(duplicateNameDiagnostics).toEqual([]);
    expect(result.elements).toHaveLength(4);
  });

  it("構文エラー1件について、同じparse診断を1回だけ返す", () => {
    const source = ["nui 1", "foobar X = 1"].join("\n");
    const result = parseLegacyV1Document(source);
    const unsupportedKeywordDiagnostics = result.diagnostics.filter((item) =>
      item.message.includes("未対応のDSLキーワードです")
    );
    expect(unsupportedKeywordDiagnostics).toHaveLength(1);
  });
});
