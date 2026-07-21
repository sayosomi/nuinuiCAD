import { beforeEach, describe, expect, it } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  groupSelectedElements,
  indentSelectedElements,
  moveElementsToInsertionIndexWithParent,
  outdentSelectedElements,
  ungroupSelectedGroup
} from "./selectionCommands";
import { selectionCommandDefinitions } from "./selectionCommandDefinitions";

const pointId = (name: string) =>
  useCadDocumentStore.getState().elements.find((element) => element.name === name)!.id;

const select = (ids: string[]) => {
  useCadUiStore.getState().setSelectedElementIds(ids, ids[0] ?? null);
};

describe("legacy locked attribute: compat parsing and unblocked destructive commands", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("parses legacy locked as an ignored, warned attribute instead of an error", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0 locked: true)";
    useCadDocumentStore.getState().commitText(source, "test");

    expect(useCadDocumentStore.getState().diagnostics.some((item) => item.severity === "error")).toBe(false);
    expect(useCadDocumentStore.getState().diagnostics.some((item) => item.message === "locked は廃止された属性のため無視されます。")).toBe(true);
    expect(useCadDocumentStore.getState().elements[0]).not.toHaveProperty("locked");
  });

  it("preserves legacy locked source text byte-for-byte on open and immediate save", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0 locked: true)";
    useCadDocumentStore.getState().commitText(source, "test");

    expect(useCadDocumentStore.getState().sourceText).toBe(source);
  });

  it("never regenerates locked when the statement is rewritten", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0 locked: true)";
    useCadDocumentStore.getState().commitText(source, "test");

    const elements = useCadDocumentStore.getState().elements;
    useCadDocumentStore.getState().commitDocumentChange({
      elements: elements.map((element) => (element.name === "A" ? { ...element, enabled: false } : element))
    });

    const sourceText = useCadDocumentStore.getState().sourceText;
    expect(sourceText).not.toContain("locked");
    expect(sourceText).toContain("enabled: false");
  });

  it("deletes an element whose legacy source declared it locked", () => {
    useCadDocumentStore.getState().commitText(
      "nui 2\npoint A = coordinate(x: 0 y: 0 locked: true)\npoint B = coordinate(x: 10 y: 0)",
      "test"
    );
    select([pointId("A")]);

    selectionCommandDefinitions.deleteSelectedElement.run();

    const names = useCadDocumentStore.getState().elements.map((element) => element.name);
    expect(names).toEqual(["B"]);
  });

  it("moves an element whose legacy source declared it locked into a new parent group", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "group G {", "}", "point A = coordinate(x: 0 y: 0 locked: true)"].join("\n"),
      "test"
    );
    const groupId = useCadDocumentStore.getState().elements.find((element) => element.type === "group")!.id;
    const aId = pointId("A");

    moveElementsToInsertionIndexWithParent([aId], 1, groupId);

    expect(useCadDocumentStore.getState().elements.find((element) => element.id === aId)?.parentGroupId).toBe(groupId);
  });

  it("groups selected elements even when one declared legacy locked", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "point A = coordinate(x: 0 y: 0 locked: true)", "point B = coordinate(x: 10 y: 0)"].join("\n"),
      "test"
    );
    select([pointId("A"), pointId("B")]);

    groupSelectedElements();

    const elements = useCadDocumentStore.getState().elements;
    const group = elements.find((element) => element.type === "group");
    expect(group).toBeDefined();
    expect(elements.find((element) => element.name === "A")?.parentGroupId).toBe(group!.id);
    expect(elements.find((element) => element.name === "B")?.parentGroupId).toBe(group!.id);
  });

  it("ungroups even when the group and its child both declared legacy locked", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "group G (locked: true) {", "  point A = coordinate(x: 0 y: 0 locked: true)", "}"].join("\n"),
      "test"
    );
    const groupId = useCadDocumentStore.getState().elements.find((element) => element.type === "group")!.id;
    select([groupId]);

    ungroupSelectedGroup();

    const elements = useCadDocumentStore.getState().elements;
    expect(elements.some((element) => element.id === groupId)).toBe(false);
    expect(elements.find((element) => element.name === "A")?.parentGroupId).toBeUndefined();
  });

  it("indents and outdents an element whose legacy source declared it locked", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 2", "group G {", "}", "point A = coordinate(x: 0 y: 0 locked: true)"].join("\n"),
      "test"
    );
    const groupId = useCadDocumentStore.getState().elements.find((element) => element.type === "group")!.id;
    const aId = pointId("A");
    select([aId]);

    indentSelectedElements();
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === aId)?.parentGroupId).toBe(groupId);

    outdentSelectedElements();
    expect(useCadDocumentStore.getState().elements.find((element) => element.id === aId)?.parentGroupId).toBeUndefined();
  });
});
