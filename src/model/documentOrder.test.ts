import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { moveElementsToInsertionIndex } from "./documentOrder";

const ids = (elements: typeof sampleElements) => elements.map((element) => element.id);

describe("moveElementsToInsertionIndex", () => {
  it("moves a single element to a requested insertion index", () => {
    const change = moveElementsToInsertionIndex({
      elements: sampleElements,
      elementIds: ["point-a"],
      insertionIndex: 3,
      selectedElementId: "point-a",
      selectionAnchorElementId: "point-a"
    });

    expect(change).not.toBeNull();
    expect(ids(change!.elements).slice(0, 4)).toEqual([
      "point-b",
      "point-c",
      "point-a",
      "line-ab"
    ]);
    expect(change).toMatchObject({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"],
      selectionAnchorElementId: "point-a"
    });
  });

  it("moves multiple elements while preserving relative order", () => {
    const change = moveElementsToInsertionIndex({
      elements: sampleElements,
      elementIds: ["point-b", "point-c"],
      insertionIndex: 4,
      selectedElementId: "point-c",
      selectionAnchorElementId: "point-b"
    });

    expect(change).not.toBeNull();
    expect(ids(change!.elements)).toEqual([
      "point-a",
      "line-ab",
      "point-b",
      "point-c",
      "line-bc",
      "curve-ac"
    ]);
    expect(change).toMatchObject({
      selectedElementId: "point-c",
      selectedElementIds: ["point-b", "point-c"],
      selectionAnchorElementId: "point-b"
    });
  });

  it("returns null for no-op drops into the moving range", () => {
    expect(
      moveElementsToInsertionIndex({
        elements: sampleElements,
        elementIds: ["point-b", "point-c"],
        insertionIndex: 2,
        selectedElementId: "point-b",
        selectionAnchorElementId: "point-b"
      })
    ).toBeNull();
  });

  it("clamps insertion indexes outside the document bounds", () => {
    const beforeStart = moveElementsToInsertionIndex({
      elements: sampleElements,
      elementIds: ["line-ab"],
      insertionIndex: -10,
      selectedElementId: "line-ab",
      selectionAnchorElementId: "line-ab"
    });
    const afterEnd = moveElementsToInsertionIndex({
      elements: sampleElements,
      elementIds: ["point-a"],
      insertionIndex: 999,
      selectedElementId: "point-a",
      selectionAnchorElementId: "point-a"
    });

    expect(beforeStart?.elements[0].id).toBe("line-ab");
    expect(afterEnd?.elements.at(-1)?.id).toBe("point-a");
  });

  it("uses the first moving id as primary when the previous primary is outside a multi-selection", () => {
    const change = moveElementsToInsertionIndex({
      elements: sampleElements,
      elementIds: ["point-b", "point-c"],
      insertionIndex: 4,
      selectedElementId: "point-a",
      selectionAnchorElementId: null
    });

    expect(change).toMatchObject({
      selectedElementId: "point-b",
      selectedElementIds: ["point-b", "point-c"],
      selectionAnchorElementId: "point-b"
    });
  });

  it("returns null when none of the requested ids exist", () => {
    expect(
      moveElementsToInsertionIndex({
        elements: sampleElements,
        elementIds: ["missing"],
        insertionIndex: 1,
        selectedElementId: null,
        selectionAnchorElementId: null
      })
    ).toBeNull();
  });
});
