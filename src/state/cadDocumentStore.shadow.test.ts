import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { DEFAULT_PRINT_LAYOUT } from "../print/printLayout";
import type { CadElement } from "../types/geometry";
import { snapshotToDslData, zipAssignedElementIds } from "../document/shadowText";
import {
  currentDocumentSnapshot,
  initialCadDocumentState,
  useCadDocumentStore,
  type CadDocumentSnapshot
} from "./cadDocumentStore";

// Phase 1b: 影テキスト維持機構のストア統合テスト。
// 「コンソールに影assert警告が出ないこと」を明示的にアサートすることで、
// 手動確認項目(docs/overhaul/tasks/phase-1b-shadow-text.md)を自動化する。

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

const expectNoShadowWarnings = () => {
  expect(consoleErrorSpy).not.toHaveBeenCalled();
};

// アプリ本体(assertShadowEquivalent)と同じ「意味的等価」の定義(正準
// シリアライズ比較)を使う。オブジェクトレベルの構造比較
// (expectSemanticallyEqualDocuments)は、手書きモデル(例: sampleData.ts の
// fromPointId 由来フィールド省略)と再パース後の完全形の差を拾って過検出に
// なるため、ここでは使わない。
const expectShadowConsistent = () => {
  const state = useCadDocumentStore.getState();
  expect(state.shadowCompiled.document).not.toBeNull();
  const afterDoc = snapshotToDslData(currentDocumentSnapshot(state));
  expect(serializeDocumentToDsl(state.shadowCompiled.document!)).toBe(serializeDocumentToDsl(afterDoc));
};

// 影テキストへノイズ(コメント等)を手動注入したうえで、要素IDを
// state.elements と同じ順序でzipし直す(実際のIDと矛盾した影を作らないため)。
const recompileWithZippedIds = (text: string, elements: CadElement[]) => {
  const parsed = parseDsl(text);
  const assignedElementIds = zipAssignedElementIds(parsed.statements, elements);
  expect(assignedElementIds, "zip must succeed").not.toBeNull();
  return compileDslDocument(text, { assignedElementIds: assignedElementIds! });
};

const seedFromSource = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document, `must compile:\n${source}`).not.toBeNull();
  const doc = compiled.document!;
  const printLayouts = doc.printLayouts.length ? doc.printLayouts : [DEFAULT_PRINT_LAYOUT];
  const activePrintLayoutId = doc.activePrintLayoutId || printLayouts[0].id;
  const snapshot: CadDocumentSnapshot = {
    elements: doc.elements,
    palette: doc.palette,
    visibilityRoles: doc.visibilityRoles,
    visibilityProfiles: doc.visibilityProfiles,
    activeVisibilityProfileId: doc.activeVisibilityProfileId,
    printLayouts,
    activePrintLayoutId,
    printLayout: printLayouts.find((layout) => layout.id === activePrintLayoutId) ?? printLayouts[0],
    evaluationLimitIndex: doc.evaluationLimitIndex,
    selectedElementId: doc.elements[0]?.id ?? null,
    selectedElementIds: doc.elements[0] ? [doc.elements[0].id] : [],
    selectionAnchorElementId: doc.elements[0]?.id ?? null,
    selectedParameterKey: null
  };
  useCadDocumentStore.getState().replaceDocument(snapshot, null);
};

describe("cadDocumentStore 影テキスト: 初期状態", () => {
  it("初期状態の影はモデルと意味的に等価で警告が出ない", () => {
    expectShadowConsistent();
    expectNoShadowWarnings();
  });
});

describe("cadDocumentStore 影テキスト: previewDocumentChange", () => {
  it("previewDocumentChangeは影テキスト・影コンパイル結果を一切変更しない", () => {
    const before = useCadDocumentStore.getState();
    const shadowTextBefore = before.shadowText;
    const shadowCompiledBefore = before.shadowCompiled;

    useCadDocumentStore.getState().previewDocumentChange({
      elements: before.elements.map((element) => ({ ...element, locked: true }) as CadElement)
    });

    const after = useCadDocumentStore.getState();
    expect(after.elements).toBe(before.elements);
    expect(after.previewElements).not.toBeNull();
    expect(after.shadowText).toBe(shadowTextBefore);
    expect(after.shadowCompiled).toBe(shadowCompiledBefore);
    expectNoShadowWarnings();
  });
});

describe("cadDocumentStore 影テキスト: 代表的なコミット経路", () => {
  it("updateElementで影が更新され警告が出ない", () => {
    const id = useCadDocumentStore.getState().elements[0].id;
    useCadDocumentStore.getState().updateElement(id, { locked: true });
    expect(useCadDocumentStore.getState().shadowText).toContain("locked=true");
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("renameElementで影が更新され警告が出ない", () => {
    const id = useCadDocumentStore.getState().elements[0].id;
    useCadDocumentStore.getState().renameElement(id, "改名後");
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("パレット操作(追加・編集・既定色変更・削除)で警告が出ない", () => {
    useCadDocumentStore.getState().addPaletteColor();
    const newColorId = useCadDocumentStore.getState().palette.colors.at(-1)!.id;
    useCadDocumentStore.getState().updatePaletteColor(newColorId, { name: "新色" });
    useCadDocumentStore.getState().setDefaultColorId(newColorId);
    useCadDocumentStore.getState().deletePaletteColor(newColorId === useCadDocumentStore.getState().palette.defaultColorId ? useCadDocumentStore.getState().palette.colors[0].id : newColorId);
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("可視性ロール・プロファイル操作で警告が出ない", () => {
    useCadDocumentStore.getState().addVisibilityRole("ガイド");
    const roleId = useCadDocumentStore.getState().visibilityRoles.at(-1)!.id;
    useCadDocumentStore.getState().updateVisibilityRole(roleId, { name: "ガイド線" });
    useCadDocumentStore.getState().addVisibilityProfile("印刷用");
    const profileId = useCadDocumentStore.getState().visibilityProfiles.at(-1)!.id;
    useCadDocumentStore.getState().setVisibilityProfileRoleVisible(profileId, roleId, false);
    useCadDocumentStore.getState().deleteVisibilityRole(roleId);
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("印刷レイアウト操作(追加・複製・削除)で警告が出ない", () => {
    useCadDocumentStore.getState().addPrintLayout();
    useCadDocumentStore.getState().duplicatePrintLayout();
    const layoutId = useCadDocumentStore.getState().activePrintLayoutId;
    useCadDocumentStore.getState().deletePrintLayout(layoutId);
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("group化に相当する一括コミット(グループ要素の挿入+親付け替え)で警告が出ない", () => {
    seedFromSource(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const state = useCadDocumentStore.getState();
    const groupCompiled = compileDslDocument("nui 1\ngroup G {\n}");
    const groupElement = groupCompiled.document!.elements[0];
    const nextElements: CadElement[] = [
      groupElement,
      ...state.elements.map((element) => ({ ...element, parentGroupId: groupElement.id }) as CadElement)
    ];
    useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("ungroup化に相当する一括コミット(グループ要素の削除+親付け替え解除)で警告が出ない", () => {
    seedFromSource(["nui 1", "group G {", "  point A = (0, 0)", "  point B = (1, 1)", "}"].join("\n"));
    const state = useCadDocumentStore.getState();
    const group = state.elements.find((element) => element.type === "group")!;
    const nextElements = state.elements
      .filter((element) => element.id !== group.id)
      .map((element) =>
        element.parentGroupId === group.id ? ({ ...element, parentGroupId: undefined } as CadElement) : element
      );
    useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("テンプレート挿入に相当する一括コミット(複数要素の一括追加)で警告が出ない", () => {
    const state = useCadDocumentStore.getState();
    const inserted = compileDslDocument(
      ["nui 1", "point T1 = (10, 10)", "point T2 = offset T1 dx=5 dy=5"].join("\n")
    ).document!.elements;
    useCadDocumentStore.getState().commitDocumentChange({ elements: [...state.elements, ...inserted] });
    expectShadowConsistent();
    expectNoShadowWarnings();
  });
});

describe("cadDocumentStore 影テキスト: コメント・空行の保存", () => {
  it("手置きのコメント・空行はコミット後もバイト単位で保存される", () => {
    seedFromSource(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const state = useCadDocumentStore.getState();

    // 影テキストへ手動でコメント・空行を注入する(要素IDは実モデルとzipし直す)。
    const withNoise = state.shadowText.replace(
      "point A = (0, 0)",
      ["", "# 注釈行", "point A = (0, 0)"].join("\n")
    );
    const recompiled = recompileWithZippedIds(withNoise, state.elements);
    expect(recompiled.document).not.toBeNull();
    useCadDocumentStore.setState({ shadowText: withNoise, shadowCompiled: recompiled });

    const targetId = state.elements.find((element) => element.name === "B")!.id;
    useCadDocumentStore.getState().updateElement(targetId, { locked: true });

    const { shadowText } = useCadDocumentStore.getState();
    // 注入した空行・コメント・直後の行が連続したまま(バイト単位で不変)
    // 保存されていること。絶対行番号ではなく部分文字列として検証する
    // (palette等の前置セクションの有無で絶対位置は変わり得るため)。
    expect(shadowText).toContain(["", "# 注釈行", "point A = (0, 0)"].join("\n"));
    expectShadowConsistent();
    expectNoShadowWarnings();
  });
});

describe("cadDocumentStore 影テキスト: undo/redo/replaceDocument の全体再生成", () => {
  it("undoは影を巻き戻し先のモデルへ全体再生成する", () => {
    const id = useCadDocumentStore.getState().elements[0].id;
    useCadDocumentStore.getState().updateElement(id, { locked: true });
    expect(useCadDocumentStore.getState().shadowText).toContain("locked=true");

    useCadDocumentStore.getState().undo();

    expect(useCadDocumentStore.getState().shadowText).not.toContain("locked=true");
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("redoは影をやり直し先のモデルへ全体再生成する", () => {
    const id = useCadDocumentStore.getState().elements[0].id;
    useCadDocumentStore.getState().updateElement(id, { locked: true });
    useCadDocumentStore.getState().undo();
    useCadDocumentStore.getState().redo();

    expect(useCadDocumentStore.getState().shadowText).toContain("locked=true");
    expectShadowConsistent();
    expectNoShadowWarnings();
  });

  it("replaceDocumentは影を読み込んだモデルへ全体再生成する", () => {
    const compiled = compileDslDocument(["nui 1", "point X = (7, 7)"].join("\n"));
    const doc = compiled.document!;
    useCadDocumentStore.getState().replaceDocument(
      {
        ...currentDocumentSnapshot(useCadDocumentStore.getState()),
        elements: doc.elements,
        evaluationLimitIndex: doc.evaluationLimitIndex,
        selectedElementId: doc.elements[0].id,
        selectedElementIds: [doc.elements[0].id],
        selectionAnchorElementId: doc.elements[0].id
      },
      "/tmp/loaded.nuinui.json"
    );

    expect(useCadDocumentStore.getState().shadowText).toContain("point X = (7, 7)");
    expectShadowConsistent();
    expectNoShadowWarnings();
  });
});

describe("cadDocumentStore 影テキスト: setStateによる影driftからの自己修復", () => {
  it("影を経由しないモデル直書き換え後も、次のコミットはクラッシュせず偽警告も出さない", () => {
    seedFromSource(["nui 1", "point A = (0, 0)", "point B = (1, 1)"].join("\n"));
    const state = useCadDocumentStore.getState();
    const inserted = compileDslDocument("nui 1\npoint C = (2, 2)").document!.elements[0];

    // 影を経由しない直接書き換え(テストがよくやるパターン)でドリフトさせる。
    useCadDocumentStore.setState({ elements: [...state.elements, inserted] });

    const idToLock = state.elements[0].id;
    expect(() => useCadDocumentStore.getState().updateElement(idToLock, { locked: true })).not.toThrow();

    expectShadowConsistent();
    // prevCompiled.document(ドリフト前の影)を基準に比較するため、
    // ドリフトで増えた要素は「今回のコミットでの挿入」として正しく解釈され、
    // 偽の継承漏れ警告にはならない。
    expectNoShadowWarnings();
  });

  it("行パッチで表現できないほど大きくドリフトしても最終的にクラッシュせず一貫性を取り戻す", () => {
    seedFromSource(["nui 1", "point A = (0, 0)", "point B = (1, 1)", "point C = (2, 2)"].join("\n"));
    const state = useCadDocumentStore.getState();

    // 要素を全消去する極端なドリフト。
    useCadDocumentStore.setState({ elements: [] });
    expect(() =>
      useCadDocumentStore.getState().commitDocumentChange({
        elements: [state.elements[0]]
      })
    ).not.toThrow();

    expectShadowConsistent();
  });
});
