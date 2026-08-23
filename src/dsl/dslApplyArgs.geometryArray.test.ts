import { describe, expect, it, vi } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { createElementNameContext } from "../model/elementNames";
import { referenceAnchor } from "../model/pointAnchors";
import type { CadElement } from "../types/geometry";
import { applyArgs, type DslApplyArgsResolvers } from "./dslApplyArgs";
import { constructionFor } from "./dslConstructions";
import { createNameIndex } from "./dslReferences";
import type { ScannedArg } from "./dslArgScanner";

const references: CadElement[] = [
  { id: "p1", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "p2", name: "B", type: "freePoint", activity: "visible", x: 10, y: 0 },
  { id: "l1", name: "AB", type: "line", activity: "visible", startPoint: referenceAnchor("p1"), endPoint: referenceAnchor("p2") },
  { id: "l2", name: "BA", type: "line", activity: "visible", startPoint: referenceAnchor("p2"), endPoint: referenceAnchor("p1") }
];

const scanned = (value: string): ScannedArg => ({
  key: "sources",
  keySpan: { start: 0, end: 7 },
  value,
  valueSpan: { start: 9, end: 9 + value.length }
});

const baseResolvers = (): DslApplyArgsResolvers => ({
  index: createNameIndex(references),
  line: 3,
  elementsForExpressions: references,
  nameContext: createElementNameContext(references),
  createIntermediateId: () => "mid"
});

describe("geometry array lineReferenceList lowering boundary", () => {
  it("uses an ordered whole-array lowering result without reparsing the source token", () => {
    const resolveLineReferenceList = vi.fn(() => ["l2", "l1", "l2"] as const);
    const resolveId = vi.fn(() => "unexpected");
    const base = createCadElement("offsetLine", references, { createId: () => "offset" });

    const result = applyArgs(
      base,
      constructionFor("line", "offset")!,
      [scanned("@paths")],
      { ...baseResolvers(), resolveLineReferenceList, resolveId }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.element).toMatchObject({ baseLineIds: ["l2", "l1", "l2"] });
    expect(resolveLineReferenceList).toHaveBeenCalledWith(
      "@paths",
      expect.anything(),
      3,
      expect.any(Array),
      expect.objectContaining({ id: "offset" }),
      { start: 9, end: 15 }
    );
    expect(resolveId).not.toHaveBeenCalled();
  });

  it("falls back to the existing authored-list resolver when the array hook declines", () => {
    const base = createCadElement("offsetLine", references, { createId: () => "offset" });
    const result = applyArgs(
      base,
      constructionFor("line", "offset")!,
      [scanned("[@AB, @BA]")],
      { ...baseResolvers(), resolveLineReferenceList: () => null }
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.element).toMatchObject({ baseLineIds: ["l1", "l2"] });
  });
});
