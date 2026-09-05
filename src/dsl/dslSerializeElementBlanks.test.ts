import { describe, expect, it } from "vitest";
import {
  blankCreationRecipeStepKeys,
  creationRecipeExcludedTypes,
  creationRecipeForType,
  materializeCreationRecipeDraft
} from "../commands/creationRecipes";
import { elementTypeLabels, type CadElement, type CadElementType } from "../types/geometry";
import { documentDslRefs, serializedStatementLines } from "./dslSerializer";
import { serializeElementStatementBlockWithBlanks } from "./dslSerializeElement";

const emptyContext = { elements: [], referenceElements: [] };

describe("serializeElementStatementBlockWithBlanks", () => {
  it("renders a blank start/end on a segment line as bare `key: ` holes, not sentinel values", () => {
    const recipe = creationRecipeForType("line")!;
    const draft = materializeCreationRecipeDraft(recipe, {}, emptyContext);
    const refs = documentDslRefs([draft.element]);
    const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);

    expect(statement.header).toBe("line = segment(");
    expect(statement.args).toEqual([
      { key: "start", text: "start: " },
      { key: "end", text: "end: " }
    ]);
    expect(serializedStatementLines(statement, "")).toEqual([
      "line = segment(",
      "  start: ,",
      "  end: ,",
      ")"
    ]);
  });

  it("renders a fully-filled start alongside a blank end", () => {
    const point: CadElement = {
      id: "p1", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0
    };
    const recipe = creationRecipeForType("line")!;
    const draft = materializeCreationRecipeDraft(
      recipe,
      { startPoint: { mode: "reference", pointId: "p1" } },
      { elements: [point], referenceElements: [point] }
    );
    const refs = documentDslRefs([point, draft.element]);
    const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);

    expect(statement.args).toEqual([
      { key: "start", text: "start: @A" },
      { key: "end", text: "end: " }
    ]);
  });

  it("renders a blank lineReferenceList as `sources: `, never `sources: []`", () => {
    const recipe = creationRecipeForType("offsetLine")!;
    expect(blankCreationRecipeStepKeys(recipe, {})).toEqual(new Set(["baseLineIds", "offset"]));
    const draft = materializeCreationRecipeDraft(recipe, {}, emptyContext);
    const refs = documentDslRefs([draft.element]);
    const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);

    // baseLineIds/offset were never filled (blank holes); side/closed/
    // suppressTrimWarnings are never creation-recipe steps at all (boolean/
    // choice parameters never become CreationSteps), so they keep coming
    // from the same factory defaults the complete path already uses.
    expect(statement.args).toEqual([
      { key: "sources", text: "sources: " },
      { key: "distance", text: "distance: " },
      { key: "side", text: "side: right" },
      { key: "closed", text: "closed: false" },
      { key: "suppressTrimWarnings", text: "suppressTrimWarnings: false" }
    ]);
  });

  it("renders a blank polyline point-list as `points: `, never the seeded factory points", () => {
    const recipe = creationRecipeForType("polyline")!;
    const draft = materializeCreationRecipeDraft(recipe, {}, emptyContext);
    const refs = documentDslRefs([draft.element]);
    const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);

    expect(draft.blankParameterKeys).toEqual(new Set(["points"]));
    expect(draft.element.type).toBe("polyline");
    expect(statement.args.find((arg) => arg.key === "points")).toEqual({ key: "points", text: "points: " });
    expect(statement.args.find((arg) => arg.key === "points")?.text).not.toContain("0");
  });

  it("renders a bare mutation-statement header (no name/category) with blank targets", () => {
    const recipe = creationRecipeForType("move")!;
    const draft = materializeCreationRecipeDraft(recipe, {}, emptyContext);
    const refs = documentDslRefs([draft.element]);
    const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);

    expect(statement.header).toBe("move(");
    expect(statement.args).toEqual([
      { key: "targets", text: "targets: " },
      { key: "from", text: "from: " },
      { key: "to", text: "to: " },
      { key: "scale", text: "scale: " },
      { key: "angleDeg", text: "angleDeg: " },
      { key: "mirrorX", text: "mirrorX: false" }
    ]);
  });

  it("never writes a name token when the name step is left blank", () => {
    const recipe = creationRecipeForType("freePoint")!;
    const draft = materializeCreationRecipeDraft(recipe, {}, emptyContext);
    expect(draft.element.name).toBe("");
    const refs = documentDslRefs([draft.element]);
    const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);
    expect(statement.header).toBe("point = coordinate(");
  });

  it("materializes and serializes an all-blank draft for every recipe-eligible element type without throwing", () => {
    const excluded = new Set<CadElementType>(creationRecipeExcludedTypes);
    for (const type of Object.keys(elementTypeLabels) as CadElementType[]) {
      if (excluded.has(type)) continue;
      const recipe = creationRecipeForType(type)!;
      expect(() => {
        const draft = materializeCreationRecipeDraft(recipe, {}, emptyContext);
        const refs = documentDslRefs([draft.element]);
        const statement = serializeElementStatementBlockWithBlanks(draft.element, refs, draft.blankParameterKeys);
        serializedStatementLines(statement, "");
      }, type).not.toThrow();
    }
  });
});
