import { describe, expect, it } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { compileDslToElements } from "../dsl/dslCompiler";
import { normalizeForComparison } from "../dsl/dslDocumentTestUtils";
import { parseDsl } from "../dsl/dslParser";
import { documentDslRefs, serializeElementStatement, serializeElementsToDsl } from "../dsl/dslSerializer";
import { elementTypeLabels, type CadElementType } from "../types/geometry";
import {
  creationRecipeExcludedTypes,
  creationRecipeForType,
  creationRecipes,
  emitCreationRecipe,
  fallbackCreationRecipe,
  type CreationArgs,
  type CreationRecipe
} from "./creationRecipes";

const sourceElements = () => {
  const result = compileDslToElements(
    [
      "point A = (0, 0) id=point-a",
      "point B = (100, 0) id=point-b",
      "line AB = A -> B id=line-ab"
    ].join("\n"),
    { elements: [] }
  );
  expect(result.diagnostics).toEqual([]);
  return result.elements;
};

const contextFor = () => {
  const elements = sourceElements();
  return {
    elements,
    referenceElements: elements,
    createId: () => "recipe-created-id"
  };
};

const argsFor = (recipe: CreationRecipe, includeName = true): CreationArgs => {
  const args: CreationArgs = includeName ? { name: `作成${recipe.type}` } : {};
  for (const step of recipe.steps) {
    if (step.kind === "point") args[step.key] = referenceAnchor("point-a");
    if (step.kind === "endpoint") args[step.key] = { lineId: "line-ab", endpointKey: "start" };
    if (step.kind === "line") args[step.key] = "line-ab";
    if (step.kind === "lineList") args[step.key] = ["line-ab"];
    if (step.kind === "number") args[step.key] = 12;
  }
  return args;
};

const emittedFor = (recipe: CreationRecipe, includeName = true) => {
  const context = contextFor();
  return { context, element: emitCreationRecipe(recipe, argsFor(recipe, includeName), context) };
};

const stepKindForParameterKind = {
  reference: "point",
  lineEndpointReference: "endpoint",
  lineReference: "line",
  lineReferenceList: "lineList",
  number: "number"
} as const;

describe("creationRecipes", () => {
  it("registers only the six Phase 4a-1 specialized recipes", () => {
    expect(creationRecipes.map((recipe) => recipe.type)).toEqual([
      "freePoint",
      "line",
      "arcLine",
      "bezierCurve",
      "offsetLine",
      "variable"
    ]);
  });

  it("keeps every registered step aligned with its parameter definition", () => {
    for (const recipe of creationRecipes) {
      const { element } = emittedFor(recipe);
      const definitions = getParameterDefinitions(element);
      const nameSteps = recipe.steps.filter((step) => step.kind === "name");
      expect(nameSteps, `${recipe.type} must end with one name step`).toEqual([{ kind: "name", autoSuggest: true }]);
      expect(recipe.steps.at(-1)?.kind, `${recipe.type} name step must be last`).toBe("name");

      for (const step of recipe.steps) {
        if (step.kind === "name") continue;
        const definition = definitions.find((item) => item.key === step.key);
        expect(definition, `${recipe.type}.${step.key} is missing from parameterDefinitions`).toBeDefined();
        expect(step.kind, `${recipe.type}.${step.key} has the wrong step kind`).toBe(
          stepKindForParameterKind[definition!.kind as keyof typeof stepKindForParameterKind]
        );
        expect(step.prompt.trim(), `${recipe.type}.${step.key} must have a prompt`).not.toBe("");
      }
    }
  });

  it("covers every step kind, with fallback fixtures for endpoint and line", () => {
    const fixtures = [fallbackCreationRecipe("lineDivisionPoint"), fallbackCreationRecipe("intersectionPoint")];
    const kinds = new Set([...creationRecipes, ...fixtures].flatMap((recipe) => recipe.steps.map((step) => step.kind)));
    expect(kinds).toEqual(new Set(["point", "endpoint", "line", "lineList", "number", "name"]));
  });

  it("serializes every registered recipe to the golden DSL statement", () => {
    const statements = Object.fromEntries(creationRecipes.map((recipe) => {
      const { context, element } = emittedFor(recipe);
      return [recipe.type, serializeElementStatement(element, documentDslRefs([...context.elements, element]))];
    }));

    expect(statements).toEqual({
      freePoint: "point 作成freePoint = (12, 12)",
      line: "line 作成line = A -> A",
      arcLine: "arc 作成arcLine center=A radius=12 start=12 end=12",
      bezierCurve: "curve 作成bezierCurve = A -> A startAngle=12 startLength=12 endAngle=12 endLength=12",
      offsetLine: "line 作成offsetLine = offset [AB] distance=12 side=right closed=false",
      variable: "var 作成variable = 12"
    });
  });

  it("round-trips named and unnamed emitted elements through the parser and compiler", () => {
    for (const recipe of creationRecipes) {
      for (const includeName of [true, false]) {
        const { context, element } = emittedFor(recipe, includeName);
        const source = [
          serializeElementsToDsl(context.elements),
          serializeElementStatement(element, documentDslRefs([...context.elements, element]))
        ].join("\n");
        expect(parseDsl(source).diagnostics).toEqual([]);
        const compiled = compileDslToElements(source, { elements: [] });
        expect(compiled.diagnostics, `${recipe.type} named=${includeName}`).toEqual([]);
        const reloaded = compiled.elements.at(-1);
        expect(reloaded).toBeDefined();
        expect(normalizeForComparison([...context.elements, reloaded!])).toEqual(
          normalizeForComparison([...context.elements, element])
        );
      }
    }
  });

  it("keeps omitted names unnamed and clears only factory-provided reference defaults", () => {
    const context = contextFor();
    const line = emitCreationRecipe(creationRecipeForType("line")!, {}, context);
    const offset = emitCreationRecipe(creationRecipeForType("offsetLine")!, {}, context);
    const endpoint = emitCreationRecipe(fallbackCreationRecipe("lineDivisionPoint"), {}, context);

    expect(line).toMatchObject({
      id: "recipe-created-id",
      name: "",
      startPoint: referenceAnchor(""),
      endPoint: referenceAnchor("")
    });
    expect(offset).toMatchObject({ name: "", baseLineIds: [] });
    expect(endpoint).toMatchObject({ name: "", endpoint: { lineId: "", endpointKey: "start" } });
  });

  it("generates fallbacks for every eligible element type without asking choice, boolean, or text values", () => {
    const excluded = new Set<CadElementType>(creationRecipeExcludedTypes);
    for (const type of Object.keys(elementTypeLabels) as CadElementType[]) {
      const recipe = fallbackCreationRecipe(type);
      const defaultElement = createCadElement(type, [], { createId: () => `${type}-fallback-definition` });
      const expected = getParameterDefinitions(defaultElement)
        .filter((definition) => definition.kind in stepKindForParameterKind)
        .map((definition) => [definition.key, stepKindForParameterKind[definition.kind as keyof typeof stepKindForParameterKind]]);
      const actual = recipe.steps
        .filter((step) => step.kind !== "name")
        .map((step) => [step.key, step.kind]);

      expect(actual, type).toEqual(expected);
      expect(creationRecipeForType(type) === null, type).toBe(excluded.has(type));
    }
  });
});
