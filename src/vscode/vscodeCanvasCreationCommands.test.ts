import { describe, expect, it } from "vitest";
import { creationCommandDefinitions } from "../commands/creationCommandDefinitions";
import { legacyCreationCommandRecipeMap } from "../commands/legacyCreationRecipes";
import {
  normalizeVscodeCanvasQuickCreateCommands,
  filterVscodeCanvasCreationCommands,
  vscodeCanvasCreationCommands,
  type VscodeCanvasCreationCommandId
} from "./vscodeCanvasCreationCommands";

describe("VS Code Canvas creation catalog", () => {
  it("projects exactly the legacy command-line creation membership", () => {
    expect(vscodeCanvasCreationCommands.map(({ commandId }) => commandId)).toEqual(
      Object.keys(legacyCreationCommandRecipeMap)
    );
  });

  it("keeps English and Japanese search keywords aligned with the shared palette", () => {
    for (const entry of vscodeCanvasCreationCommands) {
      const definition = creationCommandDefinitions[entry.commandId as keyof typeof creationCommandDefinitions];
      expect(definition.palette?.keywords).toEqual(entry.keywords);
      expect(entry.title.startsWith("nuinuiCAD: Create ")).toBe(true);
      expect(entry.quickPickDescription).toContain(entry.keywords[0]!);
    }
  });

  it("filters the label and presentation keywords with trimmed AND matching", () => {
    expect(filterVscodeCanvasCreationCommands("ベジェ").map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint",
      "addBezierExtremePoint",
      "addBezierCurve"
    ]);
    expect(filterVscodeCanvasCreationCommands("  CURVE  ").map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint",
      "addBezierExtremePoint",
      "addBezierCurve",
      "addOffsetLine",
      "addCopyLine",
      "addMove"
    ]);
    expect(filterVscodeCanvasCreationCommands("bezier 曲線").map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint",
      "addBezierExtremePoint",
      "addBezierCurve"
    ]);
    expect(filterVscodeCanvasCreationCommands("   ")).toEqual(vscodeCanvasCreationCommands);
  });
});

describe("VS Code Canvas Quick Create normalization", () => {
  it("accepts an empty configuration", () => {
    expect(normalizeVscodeCanvasQuickCreateCommands([])).toEqual([]);
    expect(normalizeVscodeCanvasQuickCreateCommands(undefined)).toEqual([]);
  });

  it("preserves order, keeps the first duplicate, and drops unknown values", () => {
    const input = [
      "addLine",
      "unknown",
      "addFreePoint",
      "addLine",
      "addArcLine",
      "addText",
      "addMove",
      "addOffsetLine",
      "addCopyLine",
      "addSymmetricMove"
    ];
    expect(normalizeVscodeCanvasQuickCreateCommands(input)).toEqual([
      "addLine",
      "addFreePoint",
      "addArcLine",
      "addText",
      "addMove",
      "addOffsetLine",
      "addCopyLine",
      "addSymmetricMove"
    ] satisfies VscodeCanvasCreationCommandId[]);
  });
});
