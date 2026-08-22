import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import type { LegacyDocumentPalette } from "./palette";
import { resolvedElementColorMap } from "./elementColors";

const palette: LegacyDocumentPalette = {
  defaultColorId: "black",
  colors: [
    { id: "black", name: "Black", hex: "#111111" },
    { id: "red", name: "Red", hex: "#aa0000" },
    { id: "blue", name: "Blue", hex: "#0000aa" }
  ]
};

const point = (id: string, patch: Partial<CadElement> & { colorId?: string } = {}): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0,
  ...patch
} as unknown as CadElement);

const group = (id: string, patch: Partial<CadElement> & { colorId?: string } = {}): CadElement => ({
  id,
  name: id,
  type: "group",
  activity: "visible",
  ...patch
} as unknown as CadElement);

describe("resolvedElementColorMap", () => {
  it("uses an element color before the document default", () => {
    const colors = resolvedElementColorMap([point("p", { colorId: "red" })], palette);

    expect(colors.get("p")).toBe("#aa0000");
  });

  it("uses the document default for elements without a color", () => {
    const colors = resolvedElementColorMap([point("p")], palette);

    expect(colors.get("p")).toBe("#111111");
  });

  it("inherits the nearest parent group color", () => {
    const elements = [
      group("outer", { colorId: "red" }),
      group("inner", { parentGroupId: "outer", colorId: "blue" }),
      point("p", { parentGroupId: "inner" })
    ];

    const colors = resolvedElementColorMap(elements, palette);

    expect(colors.get("p")).toBe("#0000aa");
  });

  it("ignores invalid color ids and falls back through ancestors", () => {
    const elements = [
      group("g", { colorId: "red" }),
      point("p", { parentGroupId: "g", colorId: "missing" })
    ];

    const colors = resolvedElementColorMap(elements, palette);

    expect(colors.get("p")).toBe("#aa0000");
  });

  it("crosses a moduleInstance for ancestry but does not use its color as a group source", () => {
    const elements = [
      group("outer", { colorId: "red" }),
      ({
        id: "module",
        name: "module",
        type: "moduleInstance" as const,
        activity: "visible" as const,
        parentGroupId: "outer",
        colorId: "blue"
      } as unknown as CadElement),
      point("p", { parentGroupId: "module" })
    ];

    const colors = resolvedElementColorMap(elements, palette);

    expect(colors.get("p")).toBe("#aa0000");
  });
});
