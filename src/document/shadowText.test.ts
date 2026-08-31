import { describe, expect, it, vi } from "vitest";
import { compileDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { expectSemanticallyEqualDocuments } from "../dsl/dslDocumentTestUtils";
import type { CadElement } from "../types/geometry";
import {
  advanceShadow,
  generateShadowFromModel,
  safeGenerateShadowFromModel,
  snapshotToDslData,
  zipAssignedElementIds,
  type ShadowState
} from "./shadowText";

const compileOrThrow = (source: string): DslDocumentData => {
  const compiled = compileDslDocument(source);
  expect(compiled.document, `must compile:\n${source}`).not.toBeNull();
  return compiled.document!;
};

const seedShadow = (source: string): ShadowState => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  return { text: source, compiled };
};

const elementByName = (document: DslDocumentData, name: string): CadElement => {
  const element = document.elements.find((item) => item.name === name)
    ?? (name === "分岐" ? document.elements.find((item) => item.type === "conditionalGroup") : undefined)
    ?? (name === "繰返し" ? document.elements.find((item) => item.type === "forGroup") : undefined);
  expect(element, `element ${name}`).toBeDefined();
  return element!;
};

describe("snapshotToDslData", () => {
  it("DSLDocumentDataフィールドだけを写す", () => {
    const document = compileOrThrow(["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    const dslData = snapshotToDslData(document);
    expect(dslData.elements).toBe(document.elements);
    expect(dslData).toEqual(document);
  });
});

describe("zipAssignedElementIds", () => {
  it("要素文数と要素配列の個数が一致すれば位置対応でIDを組む", () => {
    const document = compileOrThrow(
      ["nui 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n")
    );
    const parsed = compileDslDocument(
      ["nui 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n")
    );
    const assigned = zipAssignedElementIds(parsed.statements, document.elements);
    expect(assigned).not.toBeNull();
    expect(assigned!.size).toBe(2);
  });

  it("個数不一致は null を返す(黙ってzipを続行しない)", () => {
    const document = compileOrThrow(
      ["nui 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n")
    );
    const parsed = compileDslDocument(["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    const assigned = zipAssignedElementIds(parsed.statements, document.elements);
    expect(assigned).toBeNull();
  });
});

describe("generateShadowFromModel / advanceShadow 基本往復", () => {
  it("モデルから全体再生成した影はモデルと意味的に等価", () => {
    const document = compileOrThrow(
      ["nui 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n")
    );
    const shadow = generateShadowFromModel(document, 1);
    expect(shadow.compiled.document).not.toBeNull();
    expectSemanticallyEqualDocuments(shadow.compiled.document!, document);
    // zip不変条件: コンパイル後の要素ID列がモデルの要素ID列と一致する。
    expect(shadow.compiled.document!.elements.map((e) => e.id)).toEqual(document.elements.map((e) => e.id));
  });

  it("1コミット分の行パッチはモデルIDをそのまま影に引き継ぐ", () => {
    const source = ["nui 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document).not.toBeNull();
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("state: disabled");
    expect(next.text).toContain("point A = coordinate(x: 0, y: 0)");
  });

  it("旧影が壊れている(document=null)場合は全体再生成する", () => {
    const garbageParsed = parseDslSnapshot({ normalizedSource: "garbage", sourceRevision: 0 });
    const prev: ShadowState = {
      text: "garbage",
      compiled: {
        document: null,
        majorVersion: null,
        statements: [],
        statementMap: null,
        sourceLines: ["garbage"],
        diagnostics: [{ severity: "error", line: 1, column: 1, message: "test" }],
        spans: { sourceMap: garbageParsed.sourceMap, logicalStatementByRangeFrom: garbageParsed.logicalStatementByRangeFrom },
        sourceElementsByStatementIndex: new Map()
      }
    };
    const afterDoc = compileOrThrow(["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document).not.toBeNull();
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
  });
});

describe("advanceShadow 自己修復", () => {
  it("旧影のtextとcompiledが矛盾している(行番号が範囲外)場合でも例外を投げず自己修復する", () => {
    // buildTextPatch は prev.compiled.sourceLines を基準にスプライスの行番号を
    // 決めるが、applyLineSplices は prev.text を実際に切り出す。両者が
    // 矛盾していると applyLineSplices が「行範囲が文書外」で例外を投げる
    // (textPatch.ts の防御的チェック)。advanceShadow はこれを吸収し、
    // 全体再生成へフォールバックしなければならない。
    const prevSource = ["nui 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const prevCompiled = compileDslDocument(prevSource);
    const prev: ShadowState = { text: "nui 1", compiled: prevCompiled };
    const afterDoc = compileOrThrow(
      [
        "nui 1",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 1, y: 1)",
        "point C = coordinate(x: 2, y: 2)"
      ].join("\n")
    );
    const onSelfHeal = vi.fn();
    const next = advanceShadow(prev, afterDoc, 1, { onSelfHeal });
    expect(next.compiled.document).not.toBeNull();
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(onSelfHeal).toHaveBeenCalled();
  });

  it("dangling referenceを含む更新でも自己修復へ後退せず影を進める", () => {
    const source = ["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const prev = seedShadow(source);
    const danglingElement: CadElement = {
      id: "dangling",
      name: "B",
      type: "offsetPoint",
      activity: "visible",
      fromPoint: { mode: "reference", pointId: "does-not-exist" },
      dx: 1,
      dy: 1
    } as unknown as CadElement;
    const afterDoc: DslDocumentData = {
      ...prev.compiled.document!,
      elements: [...prev.compiled.document!.elements, danglingElement]
    };
    const onSelfHeal = vi.fn();
    const next = advanceShadow(prev, afterDoc, 1, { onSelfHeal });
    expect(next.compiled.document).not.toBeNull();
    expect(next.text).toContain("does-not-exist");
    expect(next.compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("does-not-exist") })
    ]));
    expect(onSelfHeal).not.toHaveBeenCalled();
  });
});

describe("safeGenerateShadowFromModel", () => {
  it("参照先が存在しない文書でも最小状態へ後退せず生トークンを保持する", () => {
    const danglingElement: CadElement = {
      id: "dangling",
      name: "B",
      type: "offsetPoint",
      activity: "visible",
      fromPoint: { mode: "reference", pointId: "does-not-exist" },
      dx: 1,
      dy: 1
    } as unknown as CadElement;
    const afterDoc: DslDocumentData = {
      elements: [danglingElement],
      visibilityRoles: [],
      visibilityProfiles: [{ id: "default", name: "通常", defaultRoleVisible: true, roleVisibility: {} }],
      activeVisibilityProfileId: "default",
      layouts: [],
      printOutputs: [],
      svgOutputs: [],
      evaluationLimitIndex: 1
    };
    const onFailure = vi.fn();
    const shadow = safeGenerateShadowFromModel(afterDoc, 1, onFailure);
    expect(shadow.compiled.document).not.toBeNull();
    expect(shadow.text).not.toBe("nui 1");
    expect(shadow.text).toContain("does-not-exist");
    expect(shadow.compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("does-not-exist") })
    ]));
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("正常な文書では例外なくgenerateShadowFromModelと同じ結果になる", () => {
    const afterDoc = compileOrThrow(["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n"));
    const onFailure = vi.fn();
    const shadow = safeGenerateShadowFromModel(afterDoc, 1, onFailure);
    expect(onFailure).not.toHaveBeenCalled();
    expect(shadow.compiled.document).not.toBeNull();
    expectSemanticallyEqualDocuments(shadow.compiled.document!, afterDoc);
  });
});

describe("advanceShadow 構造ケース(group入れ子・if/else・for・無名要素・非連続parent)", () => {
  it("group入れ子内の属性編集は同一IDのまま反映される", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("group G {");
    expect(next.text).toContain("state: disabled");
  });

  it("if/elseブロックへの挿入は同一IDのまま反映される", () => {
    const source = [
      "nui 1",
      "if (true) {",
      "  point T = coordinate(x: 0, y: 0)",
      "} else {",
      "  point E = coordinate(x: 5, y: 5)",
      "}"
    ].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const conditional = elementByName(before, "分岐");
    const inserted = compileOrThrow("nui 1\npoint N = coordinate(x: 9, y: 9)").elements[0];
    const afterDoc: DslDocumentData = {
      ...before,
      elements: [
        ...before.elements,
        { ...inserted, parentGroupId: conditional.id, conditionalBranch: "else" } as CadElement
      ]
    };
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("point N = coordinate(");
    expect(next.text).toContain("x: 9");
    expect(next.text).toContain("y: 9");
    expect(next.text).toContain("} else {");
  });

  it("forブロック本体の編集は同一IDのまま反映される", () => {
    const source = [
      "nui 1",
      "for i in range(from: 0, count: 3, step: 1) {",
      "  point P = coordinate(x: @i * 10, y: 0)",
      "}"
    ].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "P" ? ({ ...element, activity: "disabled" } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("for i in range(");
  });

  it("無名要素の挿入・属性編集は同一IDのまま反映される", () => {
    const source = ["nui 1", "point A = coordinate(x: 0, y: 0)", "point = coordinate(x: 5, y: 5)"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "" ? ({ ...element, x: 6, y: 6 } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("point = coordinate(");
    expect(next.text).toContain("x: 6");
    expect(next.text).toContain("y: 6");
  });

  it("非連続な親子順序(parent=フォールバック)を保ったまま編集を反映する", () => {
    const source = ["nui 1", "group G {", "  point A = coordinate(x: 0, y: 0)", "}", "point C = coordinate(x: 2, y: 2)"].join(
      "\n"
    );
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const group = elementByName(before, "G");
    const inserted = compileOrThrow("nui 1\npoint B = coordinate(x: 1, y: 1)").elements[0];
    const afterDoc: DslDocumentData = {
      ...before,
      elements: [...before.elements, { ...inserted, parentGroupId: group.id } as CadElement]
    };
    const next = advanceShadow(prev, afterDoc, 1);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("parent: @G");
  });
});
