import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import {
  elementIdByOffset,
  elementIdsInDocumentOrder,
  selectedIndexes,
  selectionRangeIds,
  toggleSelectionIds
} from "./documentSelection";

describe("documentSelection", () => {
  it("orders selected ids by document order", () => {
    expect(
      elementIdsInDocumentOrder(sampleElements, ["line-ab", "point-a", "point-c"])
    ).toEqual(["point-a", "point-c", "line-ab"]);
  });

  it("returns selected indexes in document order", () => {
    expect(selectedIndexes(sampleElements, ["point-c", "point-a"])).toEqual([0, 2]);
  });

  it("selects ids by offset and clamps at document edges", () => {
    expect(elementIdByOffset(sampleElements, "point-a", -1)).toBe("point-a");
    expect(elementIdByOffset(sampleElements, "point-a", 1)).toBe("point-b");
    expect(elementIdByOffset(sampleElements, sampleElements.at(-1)!.id, 1)).toBe(
      sampleElements.at(-1)!.id
    );
  });

  it("uses the first element when the selected id is missing", () => {
    expect(elementIdByOffset(sampleElements, "missing", 0)).toBe("point-a");
  });

  it("returns range ids between anchor and target", () => {
    expect(selectionRangeIds(sampleElements, "point-a", "line-ab")).toEqual([
      "point-a",
      "point-b",
      "point-c",
      "line-ab"
    ]);
    expect(selectionRangeIds(sampleElements, "line-ab", "point-b")).toEqual([
      "point-b",
      "point-c",
      "line-ab"
    ]);
  });

  it("returns an empty range when either endpoint is missing", () => {
    expect(selectionRangeIds(sampleElements, "point-a", "missing")).toEqual([]);
  });

  it("toggles selected ids while keeping at least one selected id", () => {
    expect(toggleSelectionIds(sampleElements, ["point-a"], "point-a")).toEqual({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"]
    });
    expect(toggleSelectionIds(sampleElements, ["point-a"], "point-b")).toEqual({
      selectedElementId: "point-b",
      selectedElementIds: ["point-a", "point-b"]
    });
    expect(toggleSelectionIds(sampleElements, ["point-a", "point-b"], "point-b")).toEqual({
      selectedElementId: "point-a",
      selectedElementIds: ["point-a"]
    });
  });

  it("ignores toggle requests for missing ids", () => {
    expect(toggleSelectionIds(sampleElements, ["point-a"], "missing")).toBeNull();
  });
});
