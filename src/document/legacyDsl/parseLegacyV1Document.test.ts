import { describe, expect, it } from "vitest";
import { parseLegacyV1Document } from "./parseLegacyV1Document";
import sampleV1 from "../../dsl/__fixtures__/sample.v1.nui?raw";

// C1後: live `src/dsl/` は v2 専用になり、v1 テキストを受理しない。この凍結
// facade単独の固定期待値で健全性を検証する(旧「live との等価性」比較は
// docs/dsl2/tasks/w5-legacy-freeze.md の引き継ぎどおりC1で成立しなくなった)。
// v1/v2 サンプルの意味等価性そのものは
// src/dsl/dslV2RoundTrip.test.ts が引き続き検証する。
describe("parseLegacyV1Document (C1後: 凍結側単独の期待値固定)", () => {
  it("sample.v1.nui をエラー無く読め、代表的な要素・設定を含む", () => {
    const legacy = parseLegacyV1Document(sampleV1);
    expect(legacy.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(legacy.elements.length).toBeGreaterThan(0);
    expect(legacy.palette.colors.length).toBeGreaterThan(0);
    expect(legacy.visibilityProfiles.length).toBeGreaterThan(0);
    expect(legacy.printLayouts.length).toBeGreaterThan(0);
    expect(legacy.activePrintLayoutId).toBeTruthy();
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

// 04: DivisionPlacement characterization。v1の`between`/`on`糖衣構文でdistance/ratio両方が
// 指定された場合、v2パーサー(dslCallParser.ts)のような「同時に指定できません」診断は出ず、
// withPlacementMode(dslCompiler.ts)がdistanceを先にcheckして無条件に選ぶ。v2との非対称は
// 現行仕様として固定する(修正しない)。
describe("parseLegacyV1Document (DivisionPlacement characterization)", () => {
  it("silently prefers distance over ratio when v1 between supplies both, with no diagnostic", () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "point P = between A B distance=5 ratio=0.9"
    ].join("\n");
    const result = parseLegacyV1Document(source);

    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const division = result.elements.find((element) => element.name === "P");
    expect(division).toMatchObject({ type: "divisionPoint", placement: { kind: "distance", value: 5 } });
  });

  it("silently prefers distance over ratio when v1 on supplies both, with no diagnostic", () => {
    const source = [
      "nui 1",
      "point A = (0, 0)",
      "point B = (10, 0)",
      "line AB = A -> B",
      "point Q = on AB distance=5 ratio=0.9"
    ].join("\n");
    const result = parseLegacyV1Document(source);

    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const division = result.elements.find((element) => element.name === "Q");
    expect(division).toMatchObject({ type: "lineDivisionPoint", placement: { kind: "distance", value: 5 } });
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
