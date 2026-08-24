import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { documentDslRefs } from "../dsl/dslSerializer";
import { serializeElementStatementLogical } from "../dsl/dslSerializeElement";
import { creationRecipeForType, emitCreationRecipe } from "./creationRecipes";

describe("join creation flow", () => {
  it("preserves repeated selected path order and emits closed false", () => {
    const compiled = compileDslToElements([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point C = coordinate(x: 20, y: 0)",
      "line First = segment(start: @A, end: @B)",
      "line Second = segment(start: @B, end: @C)"
    ].join("\n"), { elements: [] });
    expect(compiled.diagnostics).toEqual([]);
    const first = compiled.elements.find((element) => element.name === "First");
    const second = compiled.elements.find((element) => element.name === "Second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const recipe = creationRecipeForType("joinedPath");
    expect(recipe?.steps.map((step) => step.kind)).toEqual(["lineList", "name"]);
    const joined = emitCreationRecipe(
      recipe!,
      { pathIds: [second!.id, first!.id, second!.id], name: "Joined" },
      { elements: compiled.elements, referenceElements: compiled.elements, createId: () => "joined-id" }
    );

    expect(joined).toMatchObject({
      type: "joinedPath",
      pathIds: [second!.id, first!.id, second!.id],
      closed: false
    });
    expect(serializeElementStatementLogical(joined, documentDslRefs([...compiled.elements, joined]))).toBe(
      "line Joined = join(paths: [@Second, @First, @Second], closed: false)"
    );
  });
});
