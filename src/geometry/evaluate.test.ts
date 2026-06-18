import { describe, expect, it } from "vitest";
import { evaluateElements } from "./evaluate";
import type { CadElement } from "../types/geometry";

const validElements: CadElement[] = [
  {
    id: "a",
    name: "点A",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 10,
    y: 20
  },
  {
    id: "b",
    name: "点B",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "a",
    dx: 30,
    dy: 5
  },
  {
    id: "ab",
    name: "直線AB",
    type: "line",
    visible: true,
    enabled: true,
    startPointId: "a",
    endPointId: "b"
  }
];

describe("evaluateElements", () => {
  it("evaluates points and lines in valid top-to-bottom order", () => {
    const result = evaluateElements(validElements);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("a")).toMatchObject({ kind: "point", x: 10, y: 20 });
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 40, y: 25 });
    expect(result.computedGeometry.get("ab")).toMatchObject({ kind: "line" });
  });

  it("reports a missing dependency", () => {
    const result = evaluateElements([
      {
        id: "b",
        name: "点B",
        type: "offsetPoint",
        visible: true,
        enabled: true,
        fromPointId: "missing",
        dx: 30,
        dy: 5
      }
    ]);

    expect(result.computedGeometry.has("b")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "b",
      missingDependencyId: "missing"
    });
  });

  it("reports a dependency that appears too late", () => {
    const result = evaluateElements([validElements[0], validElements[2], validElements[1]]);

    expect(result.computedGeometry.has("ab")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "ab",
      elementName: "直線AB",
      missingDependencyId: "b",
      missingDependencyName: "点B"
    });
  });

  it("allows hidden elements to be evaluated and referenced", () => {
    const hiddenSource: CadElement[] = [
      { ...validElements[0], visible: false },
      validElements[1]
    ];

    const result = evaluateElements(hiddenSource);

    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get("b")).toMatchObject({ kind: "point", x: 40, y: 25 });
  });

  it("does not evaluate disabled elements", () => {
    const disabledSource: CadElement[] = [
      { ...validElements[0], enabled: false },
      validElements[1]
    ];

    const result = evaluateElements(disabledSource);

    expect(result.computedGeometry.has("a")).toBe(false);
    expect(result.computedGeometry.has("b")).toBe(false);
    expect(result.errors[0]).toMatchObject({
      elementId: "b",
      missingDependencyId: "a"
    });
  });
});
