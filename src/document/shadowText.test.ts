import { describe, expect, it, vi } from "vitest";
import { compileDslDocument, type DslDocumentData } from "../dsl/dslDocument";
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
  const element = document.elements.find((item) => item.name === name);
  expect(element, `element ${name}`).toBeDefined();
  return element!;
};

describe("snapshotToDslData", () => {
  it("正準スナップショットからDSLDocumentDataフィールドだけを写す", () => {
    const document = compileOrThrow(["nui 1", "point A = (0, 0)"].join("\n"));
    const snapshot = {
      ...document,
      printLayout: document.printLayouts[0] ?? { id: "x" },
      selectedElementId: null,
      selectedElementIds: [],
      selectionAnchorElementId: null,
      selectedParameterKey: null
    } as unknown as Parameters<typeof snapshotToDslData>[0] & { printLayout: unknown };
    const dslData = snapshotToDslData(snapshot);
    expect(dslData.elements).toBe(document.elements);
    expect(dslData).not.toHaveProperty("printLayout");
    expect(dslData).not.toHaveProperty("selectedElementId");
  });
});

describe("zipAssignedElementIds", () => {
  it("要素文数と要素配列の個数が一致すれば位置対応でIDを組む", () => {
    const document = compileOrThrow(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const parsed = compileDslDocument(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const assigned = zipAssignedElementIds(parsed.statements, document.elements);
    expect(assigned).not.toBeNull();
    expect(assigned!.size).toBe(2);
  });

  it("個数不一致は null を返す(黙ってzipを続行しない)", () => {
    const document = compileOrThrow(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const parsed = compileDslDocument(["nui 1", "point A = (0, 0)"].join("\n"));
    const assigned = zipAssignedElementIds(parsed.statements, document.elements);
    expect(assigned).toBeNull();
  });
});

describe("generateShadowFromModel / advanceShadow 基本往復", () => {
  it("モデルから全体再生成した影はモデルと意味的に等価", () => {
    const document = compileOrThrow(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const shadow = generateShadowFromModel(document);
    expect(shadow.compiled.document).not.toBeNull();
    expectSemanticallyEqualDocuments(shadow.compiled.document!, document);
    // zip不変条件: コンパイル後の要素ID列がモデルの要素ID列と一致する。
    expect(shadow.compiled.document!.elements.map((e) => e.id)).toEqual(document.elements.map((e) => e.id));
  });

  it("1コミット分の行パッチはモデルIDをそのまま影に引き継ぐ", () => {
    const source = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "B" ? ({ ...element, locked: true } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc);
    expect(next.compiled.document).not.toBeNull();
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("locked=true");
    expect(next.text).toContain("point A = (0, 0)");
  });

  it("旧影が壊れている(document=null)場合は全体再生成する", () => {
    const prev: ShadowState = {
      text: "garbage",
      compiled: {
        document: null,
        statements: [],
        statementMap: null,
        sourceLines: ["garbage"],
        diagnostics: [{ severity: "error", line: 1, column: 1, message: "test" }]
      }
    };
    const afterDoc = compileOrThrow(["nui 1", "point A = (0, 0)"].join("\n"));
    const next = advanceShadow(prev, afterDoc);
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
    const prevSource = ["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n");
    const prevCompiled = compileDslDocument(prevSource);
    const prev: ShadowState = { text: "nui 1", compiled: prevCompiled };
    const afterDoc = compileOrThrow(
      ["nui 1", "point A = (0, 0)", "point B = (1, 1)", "point C = (2, 2)"].join("\n")
    );
    const onSelfHeal = vi.fn();
    const next = advanceShadow(prev, afterDoc, { onSelfHeal });
    expect(next.compiled.document).not.toBeNull();
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(onSelfHeal).toHaveBeenCalled();
  });

  it("全体再生成自体が失敗する場合(dangling reference)は直前の影を維持しユーザー操作を止めない", () => {
    const source = ["nui 1", "point A = (0, 0)"].join("\n");
    const prev = seedShadow(source);
    const danglingElement: CadElement = {
      id: "dangling",
      name: "B",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPoint: { mode: "reference", pointId: "does-not-exist" },
      dx: 1,
      dy: 1
    } as unknown as CadElement;
    const afterDoc: DslDocumentData = {
      ...prev.compiled.document!,
      elements: [...prev.compiled.document!.elements, danglingElement]
    };
    const onSelfHeal = vi.fn();
    const next = advanceShadow(prev, afterDoc, { onSelfHeal });
    // クラッシュせず、何らかの ShadowState を返す(直前の影を最低限維持)。
    expect(next).toBeDefined();
    expect(onSelfHeal).toHaveBeenCalled();
  });
});

describe("safeGenerateShadowFromModel", () => {
  it("参照先が存在しない文書でも例外を投げず最小状態へ後退する", () => {
    const danglingElement: CadElement = {
      id: "dangling",
      name: "B",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPoint: { mode: "reference", pointId: "does-not-exist" },
      dx: 1,
      dy: 1
    } as unknown as CadElement;
    const afterDoc: DslDocumentData = {
      elements: [danglingElement],
      palette: { colors: [{ id: "main", name: "本体", hex: "#000000" }], defaultColorId: "main" },
      visibilityRoles: [],
      visibilityProfiles: [{ id: "default", name: "通常", defaultRoleVisible: true, roleVisibility: {} }],
      activeVisibilityProfileId: "default",
      printLayouts: [],
      activePrintLayoutId: "",
      evaluationLimitIndex: 1
    };
    const onFailure = vi.fn();
    const shadow = safeGenerateShadowFromModel(afterDoc, onFailure);
    expect(shadow.compiled.document).not.toBeNull();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("正常な文書では例外なくgenerateShadowFromModelと同じ結果になる", () => {
    const afterDoc = compileOrThrow(["nui 1", "point A = (0, 0)"].join("\n"));
    const onFailure = vi.fn();
    const shadow = safeGenerateShadowFromModel(afterDoc, onFailure);
    expect(onFailure).not.toHaveBeenCalled();
    expect(shadow.compiled.document).not.toBeNull();
    expectSemanticallyEqualDocuments(shadow.compiled.document!, afterDoc);
  });
});

describe("advanceShadow 構造ケース(group入れ子・if/else・for・無名要素・非連続parent)", () => {
  it("group入れ子内の属性編集は同一IDのまま反映される", () => {
    const source = ["nui 1", "group G {", "  point A = (0, 0)", "  point B = (1, 1)", "}"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "B" ? ({ ...element, locked: true } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("group G {");
    expect(next.text).toContain("locked=true");
  });

  it("if/elseブロックへの挿入は同一IDのまま反映される", () => {
    const source = ["nui 1", "if 分岐 condition=1 {", "  point T = (0, 0)", "} else {", "  point E = (5, 5)", "}"].join(
      "\n"
    );
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const conditional = elementByName(before, "分岐");
    const inserted = compileOrThrow(`nui 1\npoint N = (9, 9)`).elements[0];
    const afterDoc: DslDocumentData = {
      ...before,
      elements: [
        ...before.elements,
        { ...inserted, parentGroupId: conditional.id, conditionalBranch: "else" } as CadElement
      ]
    };
    const next = advanceShadow(prev, afterDoc);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("point N = (9, 9)");
    expect(next.text).toContain("} else {");
  });

  it("forブロック本体の編集は同一IDのまま反映される", () => {
    const source = ["nui 1", "for F i start=0 count=3 step=1 {", "  point P = (i * 10, 0)", "}"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "P" ? ({ ...element, locked: true } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("for F i");
  });

  it("無名要素の挿入・属性編集は同一IDのまま反映される", () => {
    const source = ["nui 1", "point A = (0, 0)", "point = (5, 5)"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const afterDoc: DslDocumentData = {
      ...before,
      elements: before.elements.map((element) =>
        element.name === "" ? ({ ...element, x: 6, y: 6 } as CadElement) : element
      )
    };
    const next = advanceShadow(prev, afterDoc);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("point = (6, 6)");
  });

  it("非連続な親子順序(parent=フォールバック)を保ったまま編集を反映する", () => {
    const source = ["nui 1", "group G {", "  point A = (0, 0)", "}", "point C = (2, 2)"].join("\n");
    const prev = seedShadow(source);
    const before = prev.compiled.document!;
    const group = elementByName(before, "G");
    const inserted = compileOrThrow(`nui 1\npoint B = (1, 1)`).elements[0];
    const afterDoc: DslDocumentData = {
      ...before,
      elements: [...before.elements, { ...inserted, parentGroupId: group.id } as CadElement]
    };
    const next = advanceShadow(prev, afterDoc);
    expect(next.compiled.document!.elements.map((e) => e.id)).toEqual(afterDoc.elements.map((e) => e.id));
    expect(next.text).toContain("parent=G");
  });
});
