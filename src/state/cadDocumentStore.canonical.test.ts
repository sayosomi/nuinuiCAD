import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CadElement } from "../types/geometry";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const seedText = (text: string) => {
  useCadDocumentStore.getState().commitText(text, "test");
  useCadDocumentStore.setState({ past: [], future: [], dirtySinceSave: false });
};

const pointId = (name: string) =>
  useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;

const onePointSource = (x = 0, y = 0) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y }
]);

const twoPointSource = () => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 }
]);

describe("cadDocumentStore canonical text", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("separates valid, warning-only, and fatal text states", () => {
    const valid = onePointSource();
    seedText(valid);
    expect(useCadDocumentStore.getState()).toMatchObject({
      sourceText: valid,
      docText: valid,
      diagnostics: []
    });

    const warning = dslTextForElements([
      { id: "b", name: "B", type: "offsetPoint", activity: "visible", fromPoint: { mode: "reference", pointId: "Missing" }, dx: 1, dy: 2 }
    ]);
    useCadDocumentStore.getState().commitText(warning, "test");
    const warningState = useCadDocumentStore.getState();
    expect(warningState.sourceText).toBe(warning);
    expect(warningState.docText).toBe(warning);
    expect(warningState.diagnostics.some((item) => item.severity === "warning")).toBe(true);
    expect(warningState.diagnostics.some((item) => item.severity === "error")).toBe(false);
    expect(warningState.doc.document.elements).toHaveLength(1);

    const lastGoodDoc = warningState.doc;
    // 意図的な構文エラー(未閉じ呼び出し)。fatal挙動の検証が目的であり、
    // 生成経由化は不可。
    const fatal = "nui 4\npoint Broken = coordinate(";
    useCadDocumentStore.getState().commitText(fatal, "test");
    const fatalState = useCadDocumentStore.getState();
    expect(fatalState.sourceText).toBe(fatal);
    expect(fatalState.docText).toBe(warning);
    expect(fatalState.doc).toBe(lastGoodDoc);
    expect(fatalState.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("keeps fatal text, rejects model bridge edits, and recovers with one undo", () => {
    const valid = onePointSource();
    seedText(valid);
    // 意図的な構文エラー(未閉じ呼び出し)。
    const fatalText = "nui 4\npoint A = coordinate(";
    useCadDocumentStore.getState().commitText(fatalText, "test");
    const fatalState = useCadDocumentStore.getState();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    useCadDocumentStore.getState().commitDocumentChange({
      elements: fatalState.elements.map((element) => ({ ...element, activity: "disabled" }) as CadElement)
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(fatalText);
    expect(useCadDocumentStore.getState().doc).toBe(fatalState.doc);
    expect(useCadDocumentStore.getState().past).toHaveLength(1);
    expect(error).toHaveBeenCalledOnce();

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(valid);
    expect(useCadDocumentStore.getState().docText).toBe(valid);
    expect(useCadDocumentStore.getState().diagnostics).toEqual([]);
    error.mockRestore();
  });

  it("keeps the current-source typed dependency graph when fatal text retains last-good geometry", () => {
    seedText(["nui 4", "const stable: number = 1"].join("\n"));
    const lastGoodGraph = useCadDocumentStore.getState().typedDependencyGraph;
    const fatal = [
      "nui 4",
      "const missing: number = @unknown",
      "group G (printEnabled: @unknown) {",
      "}"
    ].join("\n");

    useCadDocumentStore.getState().commitText(fatal, "test");
    const state = useCadDocumentStore.getState();

    expect(state.docText).not.toBe(fatal);
    expect(state.typedDependencyGraph).not.toBe(lastGoodGraph);
    expect(state.typedDependencyGraph?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "initializer", reason: "missing" })
    ]));
  });

  it("unifies text and model commits into one alternating undo history", () => {
    seedText(twoPointSource());
    useCadDocumentStore.getState().commitText(
      dslTextForElements([
        { id: "a", name: "Renamed", type: "freePoint", activity: "visible", x: 0, y: 0 },
        { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 }
      ]),
      "test"
    );
    const renamedId = pointId("Renamed");
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    expect(useCadDocumentStore.getState().past).toHaveLength(2);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.activity).toBe("visible");
    expect(pointId("Renamed")).toBe(renamedId);

    useCadDocumentStore.getState().undo();
    expect(pointId("A")).toBe(renamedId);
    useCadDocumentStore.getState().redo();
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.activity).toBe("disabled");
  });

  // コメント・空行・未解決の color: 参照がモデルブリッジ編集後も保持されるかを
  // 検証する、手書きレイアウトが主題のテスト。
  it("keeps comments and dangling tokens through model bridge edits", () => {
    seedText([
      "nui 4",
      "",
      "# keep this comment",
      "point A = coordinate(x: 0, y: 0, color: missing-color)",
      "point B = coordinate(x: 10, y: 0)"
    ].join("\n"));
    const nextElements = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "B" ? ({ ...element, activity: "disabled" } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
    expect(useCadDocumentStore.getState().sourceText).toContain("# keep this comment");
    expect(useCadDocumentStore.getState().sourceText).toContain("color: missing-color");
    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.colorId)
      .toBe("missing-color");
  });

  it("uses reconciler IDs for rename, line move, and cross-group move", () => {
    seedText(dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      { id: "h", name: "H", type: "group", activity: "visible" },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0, parentGroupId: "h" }
    ]));
    const aId = pointId("A");
    const bId = pointId("B");

    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "a", name: "Renamed", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      { id: "h", name: "H", type: "group", activity: "visible" },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0, parentGroupId: "h" }
    ]), "test");
    expect(pointId("Renamed")).toBe(aId);

    useCadDocumentStore.getState().commitText(dslTextForElements([
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "h", name: "H", type: "group", activity: "visible" },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0, parentGroupId: "h" },
      { id: "a", name: "Renamed", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "h" }
    ]), "test");
    expect(pointId("Renamed")).toBe(aId);
    expect(pointId("B")).toBe(bId);

    useCadDocumentStore.getState().undo();
    expect(pointId("Renamed")).toBe(aId);
    expect(pointId("B")).toBe(bId);
  });

  it("keeps bridge element object identity and ignores preview/snapshot state", () => {
    seedText(twoPointSource());
    const before = useCadDocumentStore.getState();
    const changedA = { ...before.elements[0], activity: "disabled" } as CadElement;
    const nextElements = [changedA, before.elements[1]];
    useCadDocumentStore.getState().previewDocumentChange({
      elements: before.elements.map((element) => ({ ...element }) as CadElement)
    });
    useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
    const after = useCadDocumentStore.getState();
    expect(after.elements[0]).toBe(changedA);
    expect(after.elements[1]).toBe(before.elements[1]);
    expect(after.previewElements).toBeNull();
    expect(after.past).toHaveLength(1);
  });

  it("caps text history at 200 and marks undo/redo dirty", () => {
    seedText(onePointSource());
    for (let index = 1; index <= 205; index += 1) {
      useCadDocumentStore.getState().commitText(onePointSource(index, 0), "test");
    }
    expect(useCadDocumentStore.getState().past).toHaveLength(200);
    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);
    useCadDocumentStore.getState().markDocumentSaved(
      "/tmp/pattern.nuinui.json",
      useCadDocumentStore.getState().sourceText
    );
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);
  });
});
