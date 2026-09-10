import { describe, expect, it } from "vitest";
import {
  evaluateWithRustOptions,
  fixtureFromSource,
  isRustEligibleFixture,
  optionsFor
} from "./evaluationParitySupport";

describe("geometry collection value-for Rust evaluation", () => {
  it("preserves coordinate-backed map members through the Rust evaluation boundary", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for item in @points { @item }",
      "line Selected = segment(start: @mapped[0], end: @mapped[1])"
    ].join("\n"));
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const payload = evaluateWithRustOptions(process.cwd(), fixture.elements, optionsFor(fixture));

    expect(payload.errors).toEqual([]);
    const selected = fixture.elements.find((element) => element.name === "Selected");
    expect(selected).toBeDefined();
    expect(payload.computedGeometry.find((geometry) => geometry.elementId === selected!.id)).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 }
    });
    expect(payload.computedGeometryValues).toHaveLength(2);
    expect(payload.computedGeometryValues?.every((entry) => !entry.value.elementId && !entry.value.name)).toBe(true);
  });

  it("materializes point map members only through their consuming geometry targets", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)",
      "const points: point[] = [@A, @B]",
      "const mapped: point[] = for item in @points { @item }",
      "line Selected = segment(start: @mapped[0], end: @mapped[1])"
    ].join("\n"));
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const payload = evaluateWithRustOptions(process.cwd(), fixture.elements, optionsFor(fixture));

    expect(payload.errors).toEqual([]);
    const selected = fixture.elements.find((element) => element.name === "Selected");
    expect(selected).toBeDefined();
    expect(payload.computedGeometry.find((geometry) => geometry.elementId === selected!.id)).toMatchObject({
      kind: "line",
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 }
    });
    expect(payload.computedGeometryValues).toHaveLength(2);
  });

  it("preserves line-to-path assignability for lazy map members", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Base = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@Base]",
      "const mapped: path[] = for item in @lines { @item }",
      "line Selected = offset(sources: [@mapped[0]], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const payload = evaluateWithRustOptions(process.cwd(), fixture.elements, optionsFor(fixture));

    expect(payload.errors).toEqual([]);
    const selected = fixture.elements.find((element) => element.name === "Selected");
    expect(selected).toBeDefined();
    expect(payload.computedGeometry.find((geometry) => geometry.elementId === selected!.id)).toMatchObject({
      kind: "offsetLine"
    });
  });
});
