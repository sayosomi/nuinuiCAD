import { describe, expect, it } from "vitest";
import { compileDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { expectSemanticallyEqualDocuments } from "../dsl/dslDocumentTestUtils";
import type { CadElement } from "../types/geometry";
import {
  applyLineSplices,
  buildTextPatch,
  diffDocuments,
  elementUpdateSetForTesting,
  elementUpdateSetFullComparisonForTesting,
  type LineSplice
} from "./textPatch";

const elementByName = (document: DslDocumentData, name: string): CadElement => {
  const element = document.elements.find((item) => item.name === name);
  expect(element, `element ${name}`).toBeDefined();
  return element!;
};

// 小さなDSL片から挿入用の要素オブジェクトを作る(IDは新規=挿入として扱われる)。
const makeElement = (statement: string, overrides: Partial<CadElement> = {}): CadElement => {
  const compiled = compileDslDocument(`nui 3\n${statement}`);
  expect(compiled.document).not.toBeNull();
  return { ...compiled.document!.elements[0], ...overrides } as CadElement;
};

const applyChange = (
  oldSource: string,
  mutate: (document: DslDocumentData) => DslDocumentData
) => {
  const old = compileDslDocument(oldSource);
  expect(old.statementMap, "old source must compile").not.toBeNull();
  const newDocument = mutate(old.document!);
  const splices = buildTextPatch({ old, newDocument });
  const patched = applyLineSplices(oldSource, splices);
  const reparsed = compileDslDocument(patched);
  expect(
    reparsed.diagnostics.filter((item) => item.severity === "error"),
    `patched text must reparse:\n${patched}`
  ).toEqual([]);
  expectSemanticallyEqualDocuments(reparsed.document!, newDocument);
  return { old, newDocument, splices, patched, reparsed };
};

// スプライスが指定行(1-based)に一切触れていないこと。
const expectLinesUntouched = (splices: LineSplice[], lines: number[]) => {
  for (const line of lines) {
    expect(
      splices.some((splice) => splice.startLine <= line && line <= splice.endLine),
      `line ${line} should be untouched`
    ).toBe(false);
  }
};

const BASE_SOURCE = [
  "nui 3",
  "",
  "# パレット注釈",
  'color main ("#112233", name: "本体", default: true)',
  "",
  'role seam (name: "縫い代")',
  "view 通常 (default: true, seam: false)",
  "activeView 通常",
  "",
  "# 本体",
  "group G {",
  "  point A = coordinate(x: 0, y: 0)  # Aの注釈",
  "  point B = coordinate(x: 1, y: 1)",
  "  # グループ末尾コメント",
  "}",
  "point C = coordinate(x: 2, y: 2)"
].join("\n");

describe("applyLineSplices", () => {
  it("挿入・置換・削除を旧座標で適用する", () => {
    const text = ["l1", "l2", "l3", "l4"].join("\n");
    const patched = applyLineSplices(text, [
      { startLine: 2, endLine: 2, replacementLines: ["L2"] },
      { startLine: 3, endLine: 3, replacementLines: [] },
      { startLine: 5, endLine: 4, replacementLines: ["l5"] }
    ]);
    expect(patched).toBe(["l1", "L2", "l4", "l5"].join("\n"));
  });

  it("重複するスプライスを拒否する", () => {
    expect(() =>
      applyLineSplices("a\nb\nc", [
        { startLine: 1, endLine: 2, replacementLines: [] },
        { startLine: 2, endLine: 3, replacementLines: [] }
      ])
    ).toThrow();
  });

  it("未ソートのスプライスを拒否する", () => {
    expect(() =>
      applyLineSplices("a\nb\nc", [
        { startLine: 3, endLine: 3, replacementLines: [] },
        { startLine: 1, endLine: 1, replacementLines: [] }
      ])
    ).toThrow();
  });

  it("文書外の行範囲を拒否する", () => {
    expect(() => applyLineSplices("a\nb", [{ startLine: 4, endLine: 4, replacementLines: [] }])).toThrow();
  });

  it("CRLF文書の行スプライスで改行様式を保つ", () => {
    expect(applyLineSplices("a\r\nb\r\n", [{
      startLine: 2,
      endLine: 2,
      replacementLines: ["B"]
    }])).toBe("a\r\nB\r\n");
  });

  it("mixed改行のモデルパッチは無関係な行の改行を再正規化しない", () => {
    expect(applyLineSplices("a\nb\r\nc\r\n", [{
      startLine: 2,
      endLine: 2,
      replacementLines: ["B"]
    }])).toBe("a\nB\nc\r\n");
  });
});

describe("textPatch 要素の更新", () => {
  it("属性編集はstatementの行群だけを書き換え、隣接行と行末コメントを保存する", () => {
    // v2は要素statementの正準出力が常に縦型callのため、属性を1つ追加すると
    // 物理行数が増える。ヘッダ行の置換(旧行そのまま)と、増えた引数行の挿入
    // (旧行の直後へのinsertBefore)の2スプライスに分かれるが、どちらもB
    // statementの直後(13〜14行目)に閉じており、他行には一切触れない。
    const { splices, patched } = applyChange(BASE_SOURCE, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    }));
    expectLinesUntouched(splices, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16]);
    expect(patched).toContain("state: disabled");
    expect(patched).toContain("point A = coordinate(x: 0, y: 0)  # Aの注釈");
    expect(patched).toContain("# グループ末尾コメント");
    expect(patched).toContain("# 本体");
  });

  it("更新行の行末コメントは書き換え後も保存される", () => {
    const { patched } = applyChange(BASE_SOURCE, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "A" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    }));
    // 旧statementが単一物理行だった場合、行末コメントはヘッダ行に付く
    // (mergeFromSingleLineOld)。
    expect(patched).toContain("point A = coordinate(  # Aの注釈");
    expect(patched).toContain("state: disabled");
  });

  it("コンテナの属性編集は開き行の末尾 `{` を保つ", () => {
    const { patched } = applyChange(BASE_SOURCE, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "G" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    }));
    const groupLine = patched.split("\n").find((line) => line.startsWith("group G"));
    expect(groupLine).toContain("state: disabled");
    expect(groupLine!.endsWith("{")).toBe(true);
  });
});

describe("textPatch 要素の挿入", () => {
  it("グループ内への挿入は閉じ `}` の直前に入る", () => {
    const { old, patched } = applyChange(BASE_SOURCE, (document) => {
      const group = elementByName(document, "G");
      const inserted = makeElement("point Z = coordinate(x: 9, y: 9)", { parentGroupId: group.id });
      const elements = [...document.elements];
      const bIndex = elements.findIndex((element) => element.name === "B");
      elements.splice(bIndex + 1, 0, inserted);
      return { ...document, elements, evaluationLimitIndex: undefined };
    });
    expect(old.sourceLines).toHaveLength(16);
    const lines = patched.split("\n");
    const zIndex = lines.findIndex((line) => line.includes("point Z"));
    expect(lines[zIndex]).toBe("  point Z = coordinate(");
    expect(lines[zIndex + 1]).toBe("    x: 9,");
    expect(lines[zIndex + 2]).toBe("    y: 9");
    expect(lines[zIndex + 3]).toBe("  )");
    expect(lines[zIndex + 4]).toBe("}");
    expect(lines[zIndex - 1]).toBe("  # グループ末尾コメント");
  });

  it("トップレベル末尾への挿入", () => {
    const { patched } = applyChange(BASE_SOURCE, (document) => ({
      ...document,
      elements: [...document.elements, makeElement("point Z = coordinate(x: 9, y: 9)")],
      evaluationLimitIndex: undefined
    }));
    const lines = patched.split("\n");
    expect(lines.slice(-4)).toEqual(["point Z = coordinate(", "  x: 9,", "  y: 9", ")"]);
  });

  it("else枝への初回挿入は `} else {` 行を生成する", () => {
    const source = ["nui 3", "if 分岐 (1) {", "  point T = coordinate(x: 0, y: 0)", "}"].join("\n");
    const { patched } = applyChange(source, (document) => {
      const conditional = elementByName(document, "分岐");
      const inserted = makeElement("point E = coordinate(x: 5, y: 5)", {
        parentGroupId: conditional.id,
        conditionalBranch: "else"
      });
      return {
        ...document,
        elements: [...document.elements, inserted],
        evaluationLimitIndex: undefined
      };
    });
    expect(patched).toContain("} else {");
    expect(patched).toContain("  point E = coordinate(");
    expect(patched).toContain("    x: 5");
    expect(patched).toContain("    y: 5");
  });

  it("サブツリー(グループごと)の挿入は1回の挿入runで入る", () => {
    const { patched, splices } = applyChange(BASE_SOURCE, (document) => {
      const group = makeElement("group H {\n}");
      const child = makeElement("point HP = coordinate(x: 7, y: 7)", { parentGroupId: group.id });
      return {
        ...document,
        elements: [...document.elements, group, child],
        evaluationLimitIndex: undefined
      };
    });
    expect(splices).toHaveLength(1);
    // v2の正準出力はコンテナヘッダ行の末尾に `{` を直接付ける(独立した `{` 行は
    // 生成しない)。
    expect(patched.split("\n").some((line) => line.trim() === "group H {")).toBe(true);
    expect(patched).toContain("  point HP = coordinate(");
    expect(patched).toContain("    x: 7");
    expect(patched).toContain("    y: 7");
  });

  it("要素セクションが空の文書への挿入はセクションを新設する", () => {
    const source = ["nui 3", "", 'color main ("#112233", name: "本体", default: true)'].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      elements: [makeElement("point Z = coordinate(x: 9, y: 9)")],
      evaluationLimitIndex: undefined
    }));
    expect(patched.split("\n")).toEqual([
      "nui 3",
      "",
      'color main ("#112233", name: "本体", default: true)',
      "",
      "point Z = coordinate(",
      "  x: 9,",
      "  y: 9",
      ")"
    ]);
  });
});

describe("textPatch 要素の削除", () => {
  it("末端要素の削除は該当行のみ", () => {
    const { splices, patched } = applyChange(BASE_SOURCE, (document) => ({
      ...document,
      elements: document.elements.filter((element) => element.name !== "C"),
      evaluationLimitIndex: document.evaluationLimitIndex
    }));
    expect(splices).toHaveLength(1);
    expect(patched).not.toContain("point C");
    expect(patched).toContain("# グループ末尾コメント");
  });

  it("サブツリーごとの削除はブロック全範囲(内側コメント含む)を除去する", () => {
    const { patched } = applyChange(BASE_SOURCE, (document) => {
      const group = elementByName(document, "G");
      const removed = new Set(
        document.elements
          .filter((element) => element.id === group.id || element.parentGroupId === group.id)
          .map((element) => element.id)
      );
      return {
        ...document,
        elements: document.elements.filter((element) => !removed.has(element.id)),
        evaluationLimitIndex: document.evaluationLimitIndex
      };
    });
    expect(patched).not.toContain("group G");
    expect(patched).not.toContain("# Aの注釈");
    expect(patched).not.toContain("# グループ末尾コメント");
    expect(patched).toContain("# 本体");
    expect(patched).toContain("point C = coordinate(x: 2, y: 2)");
  });

  it("ungroup(メンバー保持)は開き/閉じ行を除去しメンバーをデデント、内側コメントは保存する", () => {
    const { patched } = applyChange(BASE_SOURCE, (document) => {
      const group = elementByName(document, "G");
      return {
        ...document,
        elements: document.elements
          .filter((element) => element.id !== group.id)
          .map((element) =>
            element.parentGroupId === group.id
              ? ({ ...element, parentGroupId: undefined } as CadElement)
              : element
          ),
        evaluationLimitIndex: document.evaluationLimitIndex
      };
    });
    expect(patched).not.toContain("group G");
    const lines = patched.split("\n");
    // ungroupで depth が変わるため、v2では構造変更として全行再生成される
    // (statementの内容自体は変わらなくても縦型callへ展開される)。
    expect(lines).toContain("point A = coordinate(  # Aの注釈");
    expect(lines).toContain("point B = coordinate(");
    expect(lines).toContain("  # グループ末尾コメント");
    expect(lines).not.toContain("}");
  });

  it("else枝の最後のメンバー削除は `} else {` 行も除去する", () => {
    const source = [
      "nui 3",
      "if 分岐 (1) {",
      "  point T = coordinate(x: 0, y: 0)",
      "} else {",
      "  point E = coordinate(x: 5, y: 5)",
      "}"
    ].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      elements: document.elements.filter((element) => element.name !== "E"),
      evaluationLimitIndex: document.evaluationLimitIndex
    }));
    expect(patched).not.toContain("} else {");
    expect(patched).toContain("  point T = coordinate(x: 0, y: 0)");
  });
});

describe("textPatch 要素の移動・親変更", () => {
  it("同一スコープ内の並べ替えは削除+挿入で表現される", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)", "point C = coordinate(x: 2, y: 2)"].join("\n");
    const { patched } = applyChange(source, (document) => {
      const [a, b, c] = document.elements;
      return { ...document, elements: [a, c, b] };
    });
    const lines = patched.split("\n");
    expect(lines.indexOf("point C = coordinate(x: 2, y: 2)")).toBeLessThan(lines.indexOf("point B = coordinate(x: 1, y: 1)"));
  });

  it("グループへの親変更(indent)は移動先ブロック内に入る", () => {
    const { patched } = applyChange(BASE_SOURCE, (document) => {
      const group = elementByName(document, "G");
      const c = elementByName(document, "C");
      const others = document.elements.filter((element) => element.id !== c.id);
      const bIndex = others.findIndex((element) => element.name === "B");
      const moved = { ...c, parentGroupId: group.id } as CadElement;
      return {
        ...document,
        elements: [...others.slice(0, bIndex + 1), moved, ...others.slice(bIndex + 1)]
      };
    });
    const lines = patched.split("\n");
    const cIndex = lines.findIndex((line) => line.includes("point C"));
    expect(lines[cIndex].startsWith("  ")).toBe(true);
    const closeIndex = lines.findIndex((line, index) => index > cIndex && line === "}");
    expect(closeIndex).toBeGreaterThan(cIndex);
  });

  it("非連続な親子順序は parent: フォールバックで表現される", () => {
    const source = ["nui 3", "group G {", "  point A = coordinate(x: 0, y: 0)", "}", "point C = coordinate(x: 2, y: 2)"].join("\n");
    const { patched } = applyChange(source, (document) => {
      const group = elementByName(document, "G");
      const inserted = makeElement("point B = coordinate(x: 1, y: 1)", { parentGroupId: group.id });
      // C(トップレベル)の後ろに、Gを親とするBを置く=ブロック表現不能。
      return { ...document, elements: [...document.elements, inserted], evaluationLimitIndex: undefined };
    });
    expect(patched).toContain("parent: @G");
  });

  it("既存statementを新規groupで包むと、子の内容はgroupヘッダより後ろに来る", () => {
    // W2の複数行row対応に切り替える際、matched statementの置換をinsertBefore
    // ベースに一般化しかけたところ、同じアンカー行へ挿入されるrun(新規group
    // ヘッダ)とstatement自身の内容の相対順序がinsertBeforeの呼び出し順に
    // 依存してしまい、子の内容がgroupヘッダより前に出てしまう回帰があった
    // (発見・修正はW2実装時)。ここで固定する。
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const { patched } = applyChange(source, (document) => {
      const group = makeElement("group G {\n}");
      return {
        ...document,
        elements: [
          group,
          ...document.elements.map((element) => ({ ...element, parentGroupId: group.id }) as CadElement)
        ],
        evaluationLimitIndex: undefined
      };
    });
    const lines = patched.split("\n");
    // v2の正準コンテナヘッダは `{` を自身の行末に直接持つ(独立した `{` 行はない)。
    const groupIndex = lines.findIndex((line) => line.trim() === "group G {");
    const aIndex = lines.findIndex((line) => line.includes("point A"));
    const bIndex = lines.findIndex((line) => line.includes("point B"));
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThan(groupIndex);
    expect(bIndex).toBeGreaterThan(aIndex);
  });
});

// このdescribe全体が複数物理行statement(v2のunclosed-paren継続)の検知・
// パッチ挙動を主題として検証するため、手書きリテラルのまま残す。
describe("textPatch 複数行statement(括弧継続)", () => {
  const CONTINUATION_SOURCE = [
    "nui 3",
    "point A = coordinate(",
    "  x: 0,",
    "  y: 0,",
    "  color: main  # 継続コメント",
    ")",
    "point B = coordinate(x: 1, y: 1)"
  ].join("\n");

  it("継続statementの内容変更は正準な縦型callへ再構成され、継続行のコメントを保存する", () => {
    const { patched } = applyChange(CONTINUATION_SOURCE, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "A" ? ({ ...element, colorId: "accent" } as CadElement) : element
      )
    }));
    const lines = patched.split("\n");
    expect(lines).toContain("  color: accent  # 継続コメント");
    expect(lines).not.toContain("  color: main  # 継続コメント");
    expect(patched).toContain("point B = coordinate(x: 1, y: 1)");
  });

  it("内容変更のない継続statementの移動(既存groupへのdepth変更)も全範囲を置換する", () => {
    const source = ["nui 3", "group G {", "}", "point A = coordinate(", "  x: 0,", "  y: 0,", "  color: main", ")"].join("\n");
    const { patched } = applyChange(source, (document) => {
      const group = elementByName(document, "G");
      return {
        ...document,
        elements: document.elements.map((element) =>
          element.name === "A" ? ({ ...element, parentGroupId: group.id } as CadElement) : element
        )
      };
    });
    const lines = patched.split("\n");
    expect(lines).toContain("  point A = coordinate(");
    expect(lines).toContain("    color: main");
    // 旧・継続行の残骸(トップレベルの"  color: main"単独行)が残っていないこと。
    expect(lines.filter((line) => line.includes("color: main"))).toHaveLength(1);
  });

  it("削除された継続statementは継続行を含めて全行が消える", () => {
    const { patched } = applyChange(CONTINUATION_SOURCE, (document) => ({
      ...document,
      elements: document.elements.filter((element) => element.name !== "A"),
      evaluationLimitIndex: document.evaluationLimitIndex
    }));
    expect(patched).not.toContain("point A");
    expect(patched).not.toContain("color: main");
    expect(patched).toContain("point B = coordinate(x: 1, y: 1)");
  });

  it("無変更の継続statementはスプライスが一切触れない", () => {
    const { splices } = applyChange(CONTINUATION_SOURCE, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    }));
    expectLinesUntouched(splices, [2, 3, 4, 5, 6]);
  });

  it("マッチした継続statementの直後への挿入は継続行の途中に割り込まない", () => {
    // 挿入runのアンカー("最後にマッチした旧行の直後")がstatementのヘッダ行
    // だけを見ていると、無変更の複数行文が文書末尾にあるとき、新規要素が
    // ヘッダ行と継続行の間に挟まってしまい継続が壊れる回帰があった
    // (property testで発見・修正)。
    const source = ["nui 3", "point B = coordinate(x: 1, y: 1)", "point A = coordinate(", "  x: 0,", "  y: 0,", "  color: main", ")"].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      elements: [...document.elements, makeElement("point Z = coordinate(x: 9, y: 9)")],
      evaluationLimitIndex: undefined
    }));
    const reparsed = compileDslDocument(patched);
    expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const lines = patched.split("\n");
    const continuationIndex = lines.findIndex((line) => line.includes("color: main"));
    const zIndex = lines.findIndex((line) => line.includes("point Z"));
    expect(zIndex).toBeGreaterThan(continuationIndex);
  });
});

describe("textPatch リネーム伝播", () => {
  it("参照元のリネームで参照行が書き換わり、無関係行は不変", () => {
    const source = [
      "nui 3",
      "# 注釈",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 2)",
      "point C = coordinate(x: 5, y: 5)"
    ].join("\n");
    const { splices, patched } = applyChange(source, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "A" ? ({ ...element, name: "A2" } as CadElement) : element
      )
    }));
    expect(patched).toContain("point A2 = coordinate(");
    expect(patched).toContain("from: @A2");
    expectLinesUntouched(splices, [1, 2, 5]);
  });

  it("配置済みグループのリネームで printLayout ブロックが書き換わる", () => {
    const source = [
      "nui 3",
      "group 前身頃 {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "",
      "printLayout A4 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place 前身頃 (at: (0, 0), angle: 0, mirrorX: false)",
      "}"
    ].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      elements: document.elements.map((element) =>
        element.name === "前身頃" ? ({ ...element, name: "後身頃" } as CadElement) : element
      )
    }));
    expect(patched).toContain("place 後身頃 ");
    expect(patched.split("\n").some((line) => line.startsWith("group 後身頃") && line.endsWith("{"))).toBe(true);
  });
});

describe("textPatch 非要素セクション", () => {
  it("色の追加・編集・default移動・削除", () => {
    const source = [
      "nui 3",
      "",
      'color main ("#112233", name: "本体", default: true)',
      'color sub ("#445566", name: "サブ")',
      'color gone ("#778899", name: "消える")',
      "",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { patched, splices } = applyChange(source, (document) => ({
      ...document,
      palette: {
        colors: [
          { id: "main", name: "本体", hex: "#000000" },
          { id: "sub", name: "サブ", hex: "#445566" },
          { id: "added", name: "追加", hex: "#abcdef" }
        ],
        defaultColorId: "sub"
      }
    }));
    expect(patched).toContain('color main ("#000000", name: "本体")');
    expect(patched).toContain('color sub ("#445566", name: "サブ", default: true)');
    expect(patched).toContain('color added ("#abcdef", name: "追加")');
    expect(patched).not.toContain("gone");
    expectLinesUntouched(splices, [1, 2, 7]);
  });

  it("ロール追加は各view行を個別に書き換え、行間コメントを保存する", () => {
    const source = [
      "nui 3",
      'role seam (name: "縫い代")',
      "view 通常 (default: true, seam: false)",
      "# ビュー間コメント",
      "view 印刷 (default: true, seam: true)",
      "activeView 通常",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      visibilityRoles: [...document.visibilityRoles, { id: "guide", name: "ガイド" }],
      visibilityProfiles: document.visibilityProfiles.map((profile) => ({
        ...profile,
        roleVisibility: { ...profile.roleVisibility, guide: profile.defaultRoleVisible }
      }))
    }));
    expect(patched).toContain('role guide (name: "ガイド")');
    expect(patched).toContain("# ビュー間コメント");
    expect(patched).toContain("view 通常 (default: true, seam: false, guide: true)");
    expect(patched).toContain("view 印刷 (default: true, seam: true, guide: true)");
  });

  it("activeView の切替はその行だけを書き換える", () => {
    const source = [
      "nui 3",
      'role seam (name: "縫い代")',
      "view 通常 (default: true, seam: false)",
      "view 印刷 (default: true, seam: true)",
      "activeView 通常",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { patched, splices, newDocument } = applyChange(source, (document) => ({
      ...document,
      activeVisibilityProfileId: document.visibilityProfiles.find((profile) => profile.name === "印刷")!.id
    }));
    expect(newDocument.activeVisibilityProfileId).toBe("印刷");
    expect(splices).toHaveLength(1);
    expect(splices[0]).toMatchObject({ startLine: 5, endLine: 5 });
    expect(patched).toContain("activeView 印刷");
  });

  it("printLayout の属性変更はブロック単位で置換される", () => {
    const source = [
      "nui 3",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "printLayout A4 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "  place G (at: (0, 15), angle: 0, mirrorX: false)",
      "}"
    ].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      printLayouts: document.printLayouts.map((layout) => ({ ...layout, columns: 5 }))
    }));
    expect(patched).toContain("columns: 5");
    expect(patched).toContain("place G ");
  });

  it("printLayout の追加と activePrintLayout の切替", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "printLayout 一枚目 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "}"
    ].join("\n");
    const { patched } = applyChange(source, (document) => {
      const added = {
        ...document.printLayouts[0],
        id: "二枚目",
        name: "二枚目",
        placements: [],
        numericVariables: []
      };
      return {
        ...document,
        printLayouts: [...document.printLayouts, added],
        activePrintLayoutId: "二枚目"
      };
    });
    expect(patched).toContain("printLayout 二枚目 ");
    expect(patched).toContain("activePrintLayout 二枚目");
  });

  it("printLayoutが存在しない文書に新規追加すると、既存elementsセクションより後に挿入される", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      printLayouts: [
        {
          id: "レイアウト1",
          name: "レイアウト1",
          outputKind: "pdf",
          visibilityProfileId: undefined,
          paperSizeId: "a4",
          orientation: "portrait",
          columns: 2,
          rows: 2,
          overlapMm: 10,
          scale: 1,
          svgCanvasWidthMm: 410,
          svgCanvasHeightMm: 584,
          numericVariables: [],
          placements: []
        }
      ],
      activePrintLayoutId: "レイアウト1"
    }));
    const lines = patched.split("\n");
    const pointBLine = lines.findIndex((line) => line.startsWith("point B"));
    const printLayoutLine = lines.findIndex((line) => line.startsWith("printLayout"));
    expect(pointBLine).toBeGreaterThanOrEqual(0);
    expect(printLayoutLine).toBeGreaterThan(pointBLine);
  });

  it("末尾に@stopがある文書に新規printLayoutを追加すると、@stopより後に挿入される", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "@stop"].join("\n");
    // applyChange itself already asserts the patched text reparses with zero
    // error diagnostics - if printLayout landed before @stop, that assertion
    // would fail on validatePrintLayoutPlacement's structural diagnostic
    // ("printLayoutブロック以降には...") before this test body even runs.
    const { patched } = applyChange(source, (document) => ({
      ...document,
      printLayouts: [
        {
          id: "レイアウト1",
          name: "レイアウト1",
          outputKind: "pdf",
          visibilityProfileId: undefined,
          paperSizeId: "a4",
          orientation: "portrait",
          columns: 2,
          rows: 2,
          overlapMm: 10,
          scale: 1,
          svgCanvasWidthMm: 410,
          svgCanvasHeightMm: 584,
          numericVariables: [],
          placements: []
        }
      ],
      activePrintLayoutId: "レイアウト1"
    }));
    const lines = patched.split("\n");
    const atStopLine = lines.findIndex((line) => line.startsWith("@stop"));
    const printLayoutLine = lines.findIndex((line) => line.startsWith("printLayout"));
    expect(atStopLine).toBeGreaterThanOrEqual(0);
    expect(printLayoutLine).toBeGreaterThan(atStopLine);
  });

  it("printLayoutが既に存在する文書へ新規elementを追加すると、printLayoutセクションより前に挿入される", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "printLayout 一枚目 (output: pdf, paper: a4, orientation: portrait, columns: 2, rows: 2, overlap: 10, scale: 1, canvas: (410, 584)) {",
      "}"
    ].join("\n");
    const newElement = makeElement("point B = coordinate(x: 5, y: 5)");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      elements: [...document.elements, newElement]
    }));
    const lines = patched.split("\n");
    const pointBLine = lines.findIndex((line) => line.startsWith("point B"));
    const printLayoutLine = lines.findIndex((line) => line.startsWith("printLayout"));
    expect(pointBLine).toBeGreaterThanOrEqual(0);
    expect(printLayoutLine).toBeGreaterThan(pointBLine);
  });

  it("@stop の移動は削除+挿入", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "@stop", "point B = coordinate(x: 1, y: 1)", "point C = coordinate(x: 2, y: 2)"].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      evaluationLimitIndex: 2
    }));
    const lines = patched.split("\n");
    expect(lines.filter((line) => line === "@stop")).toHaveLength(1);
    const stopIndex = lines.indexOf("@stop");
    const bIndex = lines.findIndex((line) => line.startsWith("point B "));
    const cIndex = lines.findIndex((line) => line.startsWith("point C "));
    expect(stopIndex).toBeGreaterThan(bIndex);
    expect(stopIndex).toBeLessThan(cIndex);
  });

  it("@stop を明示的に除去したら行も除去される", () => {
    const source = ["nui 3", "point A = coordinate(x: 0, y: 0)", "@stop", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const { patched } = applyChange(source, (document) => ({
      ...document,
      evaluationLimitIndex: undefined
    }));
    expect(patched).not.toContain("@stop");
  });
});

describe("diffDocuments", () => {
  it("update / insert / delete / move と非要素フラグを要約する", () => {
    const old = compileDslDocument(BASE_SOURCE);
    const document = old.document!;
    const group = elementByName(document, "G");
    const inserted = makeElement("point Z = coordinate(x: 9, y: 9)");
    const next: DslDocumentData = {
      ...document,
      elements: [
        ...document.elements
          .filter((element) => element.name !== "C")
          .map((element) =>
            element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
          ),
        inserted
      ],
      activeVisibilityProfileId: document.activeVisibilityProfileId,
      evaluationLimitIndex: document.evaluationLimitIndex
    };
    const diff = diffDocuments(document, next);
    const kinds = new Map(diff.elements.map((change) => [change.id, change.kind]));
    expect(kinds.get(elementByName(document, "B").id)).toBe("update");
    expect(kinds.get(elementByName(document, "C").id)).toBe("delete");
    expect(kinds.get(inserted.id)).toBe("insert");
    expect(kinds.has(group.id)).toBe(false);
    expect(diff.palette).toBe(false);
    expect(diff.visibility).toBe(false);
  });

  it("ungroup を membersKept 付きの delete として要約する", () => {
    const old = compileDslDocument(BASE_SOURCE);
    const document = old.document!;
    const group = elementByName(document, "G");
    const next: DslDocumentData = {
      ...document,
      elements: document.elements
        .filter((element) => element.id !== group.id)
        .map((element) =>
          element.parentGroupId === group.id
            ? ({ ...element, parentGroupId: undefined } as CadElement)
            : element
        )
    };
    const diff = diffDocuments(document, next);
    expect(diff.elements).toContainEqual({ kind: "delete", id: group.id, membersKept: true });
  });
});

// elementUpdateSet の高速経路(namesAndParentsUnchanged による全量serializeスキップ)が
// 常に「従来どおり全要素をserializeして比較する」実装と同じ結果を返すことの
// 差分テスト(性能修正Step 3)。rename・祖先rename・グループ移動・サブツリー移動・
// 無名⇄命名・dangling参照の各シナリオで高速経路のゲート判定(namesAndParentsUnchanged)
// が正しくfull比較へフォールバックすること、および変化なしシナリオで高速経路自体が
// full比較と一致することを検証する。
describe("elementUpdateSet 高速経路とfull比較の等価性", () => {
  const NESTED_SOURCE = [
    "nui 3",
    "group Outer {",
    "  group Inner {",
    "    point P1 = coordinate(x: 0, y: 0)",
    "    point P2 = offset(from: @P1, dx: 1, dy: 1)",
    "  }",
    "  point Q = coordinate(x: 5, y: 5)",
    "}",
    "point R = offset(from: @Q, dx: 2, dy: 2)",
    "point Ghost = offset(from: @R, dx: 3, dy: 3)"
  ].join("\n");

  const expectFastMatchesFull = (oldDoc: DslDocumentData, newDoc: DslDocumentData) => {
    const fast = elementUpdateSetForTesting(oldDoc, newDoc);
    const full = elementUpdateSetFullComparisonForTesting(oldDoc, newDoc);
    expect([...fast].sort()).toEqual([...full].sort());
    return fast;
  };

  it("純粋な属性編集(改名・移動なし)は高速経路でもfullと一致する", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const next: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.name === "P2" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    };
    const updates = expectFastMatchesFull(document, next);
    expect(updates.has(elementByName(document, "P2").id)).toBe(true);
    expect(updates.has(elementByName(document, "P1").id)).toBe(false);
  });

  it("葉要素のリネームはfullへフォールバックし、参照元も一致する", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const next: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.name === "P1" ? ({ ...element, name: "P1x" } as CadElement) : element
      )
    };
    const updates = expectFastMatchesFull(document, next);
    expect(updates.has(elementByName(document, "P2").id)).toBe(true);
  });

  it("祖先(グループ)のリネームはfullへフォールバックする", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const next: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.name === "Inner" ? ({ ...element, name: "InnerX" } as CadElement) : element
      )
    };
    expectFastMatchesFull(document, next);
  });

  it("葉要素の親変更(既存グループ間の移動)はfullへフォールバックする", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const inner = elementByName(document, "Inner");
    const q = elementByName(document, "Q");
    const next: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.id === q.id ? ({ ...element, parentGroupId: inner.id } as CadElement) : element
      )
    };
    expectFastMatchesFull(document, next);
  });

  it("サブツリーごとの移動(祖先の親替え、子は同じ親IDのまま)はfullへフォールバックする", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const inner = elementByName(document, "Inner");
    const next: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.id === inner.id ? ({ ...element, parentGroupId: undefined } as CadElement) : element
      )
    };
    expectFastMatchesFull(document, next);
  });

  it("無名化はfullへフォールバックする", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const next: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.name === "Q" ? ({ ...element, name: "" } as CadElement) : element
      )
    };
    expectFastMatchesFull(document, next);
  });

  it("命名化(無名→命名)はfullへフォールバックする", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const unnamed: DslDocumentData = {
      ...document,
      elements: document.elements.map((element) =>
        element.name === "Q" ? ({ ...element, name: "" } as CadElement) : element
      )
    };
    const next: DslDocumentData = {
      ...unnamed,
      elements: unnamed.elements.map((element) =>
        element.id === elementByName(document, "Q").id ? ({ ...element, name: "Q2" } as CadElement) : element
      )
    };
    expectFastMatchesFull(unnamed, next);
  });

  it("dangling参照が残ったままの無関係編集は高速経路が有効なまま一致する", () => {
    const withDangling = compileDslDocument(NESTED_SOURCE).document!;
    const ghost = elementByName(withDangling, "Ghost");
    // "存在しないID" を直接参照させ、danglingを固定する。
    const danglingDoc: DslDocumentData = {
      ...withDangling,
      elements: withDangling.elements.map((element) =>
        element.id === ghost.id
          ? ({
              ...element,
              fromPoint: { mode: "reference", pointId: "does-not-exist" }
            } as CadElement)
          : element
      )
    };
    const next: DslDocumentData = {
      ...danglingDoc,
      elements: danglingDoc.elements.map((element) =>
        element.name === "P2" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    };
    const updates = expectFastMatchesFull(danglingDoc, next);
    expect(updates.has(ghost.id)).toBe(false);
  });

  it("dangling参照の復旧(参照先IDの新規挿入)はfullへフォールバックする", () => {
    const withDangling = compileDslDocument(NESTED_SOURCE).document!;
    const ghost = elementByName(withDangling, "Ghost");
    const danglingDoc: DslDocumentData = {
      ...withDangling,
      elements: withDangling.elements.map((element) =>
        element.id === ghost.id
          ? ({
              ...element,
              fromPoint: { mode: "reference", pointId: "recovered-point" }
            } as CadElement)
          : element
      )
    };
    const recovered = makeElement("point Recovered = coordinate(x: 9, y: 9)", { id: "recovered-point" });
    const next: DslDocumentData = {
      ...danglingDoc,
      elements: [...danglingDoc.elements, recovered]
    };
    expectFastMatchesFull(danglingDoc, next);
  });

  it("挿入と削除が同時発生(要素数不変)してもfullへフォールバックする", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const ghost = elementByName(document, "Ghost");
    const inserted = makeElement("point New = coordinate(x: 7, y: 7)");
    const next: DslDocumentData = {
      ...document,
      elements: [...document.elements.filter((element) => element.id !== ghost.id), inserted]
    };
    expectFastMatchesFull(document, next);
  });

  it("改名・移動のない並べ替えのみは高速経路のままfullと一致する", () => {
    const document = compileDslDocument(NESTED_SOURCE).document!;
    const [outer, inner, p1, p2, q, r, ghost] = document.elements;
    const next: DslDocumentData = {
      ...document,
      elements: [outer, inner, p2, p1, q, ghost, r]
    };
    expectFastMatchesFull(document, next);
  });
});
