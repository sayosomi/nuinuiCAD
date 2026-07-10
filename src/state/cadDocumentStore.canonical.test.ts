import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CadElement } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";

const seedText = (text: string) => {
  useCadDocumentStore.getState().commitText(text, "test");
  useCadDocumentStore.setState({ past: [], future: [], dirtySinceSave: false });
};

const pointId = (name: string) =>
  useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;

describe("cadDocumentStore canonical text", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("separates valid, warning-only, and fatal text states", () => {
    const valid = "nui 1\npoint A = (0, 0)";
    seedText(valid);
    expect(useCadDocumentStore.getState()).toMatchObject({
      sourceText: valid,
      docText: valid,
      diagnostics: []
    });

    const warning = "nui 1\npoint B = offset Missing dx=1 dy=2";
    useCadDocumentStore.getState().commitText(warning, "test");
    const warningState = useCadDocumentStore.getState();
    expect(warningState.sourceText).toBe(warning);
    expect(warningState.docText).toBe(warning);
    expect(warningState.diagnostics.some((item) => item.severity === "warning")).toBe(true);
    expect(warningState.diagnostics.some((item) => item.severity === "error")).toBe(false);
    expect(warningState.doc.document.elements).toHaveLength(1);

    const lastGoodDoc = warningState.doc;
    const fatal = "nui 1\npoint Broken = (";
    useCadDocumentStore.getState().commitText(fatal, "test");
    const fatalState = useCadDocumentStore.getState();
    expect(fatalState.sourceText).toBe(fatal);
    expect(fatalState.docText).toBe(warning);
    expect(fatalState.doc).toBe(lastGoodDoc);
    expect(fatalState.diagnostics.some((item) => item.severity === "error")).toBe(true);
  });

  it("keeps fatal text, rejects model bridge edits, and recovers with one undo", () => {
    const valid = "nui 1\npoint A = (0, 0)";
    seedText(valid);
    useCadDocumentStore.getState().commitText("nui 1\npoint A = (", "test");
    const fatalState = useCadDocumentStore.getState();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    useCadDocumentStore.getState().commitDocumentChange({
      elements: fatalState.elements.map((element) => ({ ...element, locked: true }) as CadElement)
    });

    expect(useCadDocumentStore.getState().sourceText).toBe("nui 1\npoint A = (");
    expect(useCadDocumentStore.getState().doc).toBe(fatalState.doc);
    expect(useCadDocumentStore.getState().past).toHaveLength(1);
    expect(error).toHaveBeenCalledOnce();

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(valid);
    expect(useCadDocumentStore.getState().docText).toBe(valid);
    expect(useCadDocumentStore.getState().diagnostics).toEqual([]);
    error.mockRestore();
  });

  it("unifies text and model commits into one alternating undo history", () => {
    seedText("nui 1\npoint A = (0, 0)\npoint B = (10, 0)");
    useCadDocumentStore.getState().commitText(
      "nui 1\npoint Renamed = (0, 0)\npoint B = (10, 0)",
      "test"
    );
    const renamedId = pointId("Renamed");
    const changed = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "B" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: changed });
    expect(useCadDocumentStore.getState().past).toHaveLength(2);

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.locked).not.toBe(true);
    expect(pointId("Renamed")).toBe(renamedId);

    useCadDocumentStore.getState().undo();
    expect(pointId("A")).toBe(renamedId);
    useCadDocumentStore.getState().redo();
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.locked).toBe(true);
  });

  it("keeps comments and dangling tokens through model bridge edits", () => {
    seedText([
      "nui 1",
      "",
      "# keep this comment",
      "point A = (0, 0) color=missing-color",
      "point B = (10, 0)"
    ].join("\n"));
    const nextElements = useCadDocumentStore.getState().elements.map((element) =>
      element.name === "B" ? ({ ...element, locked: true } as CadElement) : element
    );
    useCadDocumentStore.getState().commitDocumentChange({ elements: nextElements });
    expect(useCadDocumentStore.getState().sourceText).toContain("# keep this comment");
    expect(useCadDocumentStore.getState().sourceText).toContain("color=missing-color");
    expect(useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.colorId)
      .toBe("missing-color");
  });

  it("uses reconciler IDs for rename, line move, and cross-group move", () => {
    seedText([
      "nui 1",
      "group G {",
      "  point A = (0, 0)",
      "}",
      "group H {",
      "  point B = (10, 0)",
      "}"
    ].join("\n"));
    const aId = pointId("A");
    const bId = pointId("B");

    useCadDocumentStore.getState().commitText([
      "nui 1",
      "group G {",
      "  point Renamed = (0, 0)",
      "}",
      "group H {",
      "  point B = (10, 0)",
      "}"
    ].join("\n"), "test");
    expect(pointId("Renamed")).toBe(aId);

    useCadDocumentStore.getState().commitText([
      "nui 1",
      "group G {",
      "}",
      "group H {",
      "  point B = (10, 0)",
      "  point Renamed = (0, 0)",
      "}"
    ].join("\n"), "test");
    expect(pointId("Renamed")).toBe(aId);
    expect(pointId("B")).toBe(bId);

    useCadDocumentStore.getState().undo();
    expect(pointId("Renamed")).toBe(aId);
    expect(pointId("B")).toBe(bId);
  });

  it("keeps bridge element object identity and ignores preview/snapshot state", () => {
    seedText("nui 1\npoint A = (0, 0)\npoint B = (10, 0)");
    const before = useCadDocumentStore.getState();
    const changedA = { ...before.elements[0], locked: true } as CadElement;
    const nextElements = [changedA, before.elements[1]];
    useCadDocumentStore.getState().previewDocumentChange({
      elements: before.elements.map((element) => ({ ...element }) as CadElement)
    });
    useCadDocumentStore.getState().commitDocumentChangeFromSnapshot(
      { ...before, elements: [] },
      { elements: nextElements }
    );
    const after = useCadDocumentStore.getState();
    expect(after.elements[0]).toBe(changedA);
    expect(after.elements[1]).toBe(before.elements[1]);
    expect(after.previewElements).toBeNull();
    expect(after.past).toHaveLength(1);
  });

  it("caps text history at 200 and marks undo/redo dirty", () => {
    seedText("nui 1\npoint A = (0, 0)");
    for (let index = 1; index <= 205; index += 1) {
      useCadDocumentStore.getState().commitText(`nui 1\npoint A = (${index}, 0)`, "test");
    }
    expect(useCadDocumentStore.getState().past).toHaveLength(200);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);
    useCadDocumentStore.getState().markDocumentSaved("/tmp/pattern.nuinui.json");
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().dirtySinceSave).toBe(true);
  });
});
