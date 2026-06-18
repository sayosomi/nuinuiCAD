import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  getDependencyJumpTargets,
  getDependencySummary,
  getDirectChildren,
  getDirectParentIds
} from "./dependencies";

const elements: CadElement[] = [
  {
    id: "a",
    name: "点A",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 0,
    y: 0
  },
  {
    id: "b",
    name: "点B",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "a",
    dx: 10,
    dy: 0
  },
  {
    id: "c",
    name: "点C",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "b",
    dx: 10,
    dy: 0
  },
  {
    id: "ab",
    name: "線AB",
    type: "line",
    visible: true,
    enabled: true,
    startPointId: "a",
    endPointId: "b"
  },
  {
    id: "bc",
    name: "線BC",
    type: "line",
    visible: true,
    enabled: true,
    startPointId: "b",
    endPointId: "c"
  }
];

describe("dependencies", () => {
  it("returns direct parent ids by element type", () => {
    expect(getDirectParentIds(elements[0])).toEqual([]);
    expect(getDirectParentIds(elements[1])).toEqual(["a"]);
    expect(getDirectParentIds(elements[3])).toEqual(["a", "b"]);
  });

  it("returns direct children", () => {
    expect(getDirectChildren("b", elements).map((element) => element.id)).toEqual([
      "c",
      "ab",
      "bc"
    ]);
  });

  it("summarizes direct relationships and recursive counts without duplicates", () => {
    const summary = getDependencySummary(elements[4], elements);

    expect(summary.parents.map((parent) => parent.element?.id)).toEqual(["b", "c"]);
    expect(summary.children).toEqual([]);
    expect(summary.ancestorCount).toBe(3);
    expect(summary.descendantCount).toBe(0);
  });

  it("keeps missing direct references visible but out of jump targets", () => {
    const broken: CadElement = {
      id: "broken",
      name: "壊れた点",
      type: "offsetPoint",
      visible: true,
      enabled: true,
      fromPointId: "missing",
      dx: 0,
      dy: 0
    };
    const summary = getDependencySummary(broken, [...elements, broken]);

    expect(summary.parents).toEqual([{ id: "missing", element: null }]);
    expect(getDependencyJumpTargets(broken, [...elements, broken])).toEqual([]);
  });

  it("orders jump targets as direct parents then direct children", () => {
    expect(getDependencyJumpTargets(elements[1], elements).map((element) => element.id)).toEqual([
      "a",
      "c",
      "ab",
      "bc"
    ]);
  });
});
