import { describe, expect, it } from "vitest";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { compileDslToElements } from "../dsl/dslCompiler";
import { normalizeForComparison } from "../dsl/dslDocumentTestUtils";
import { parseDsl } from "../dsl/dslParser";
import { documentDslRefs, serializeElementsToDsl } from "../dsl/dslSerializer";
import { serializeElementStatementLogical } from "../dsl/dslSerializeElement";
import { elementTypeLabels, type CadElementType } from "../types/geometry";
import { creationCommandDefinitions } from "./creationCommandDefinitions";
import {
  creationRecipeExcludedTypes,
  creationRecipeForType,
  creationRecipes,
  emitCreationRecipe,
  fallbackCreationRecipe,
  type CreationArgs,
  type CreationRecipe
} from "./creationRecipes";
import {
  creationRecipeForLegacyCommand,
  legacyCreationCommandRecipeMap
} from "./legacyCreationRecipes";

const sourceElements = () => {
  const result = compileDslToElements(
    [
      "point A = coordinate(x: 0 y: 0 id: point-a)",
      "point B = coordinate(x: 100 y: 0 id: point-b)",
      "line AB = segment(start: A end: B id: line-ab)"
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

const legacyCreationRecipes = () =>
  Object.entries(legacyCreationCommandRecipeMap).map(([commandId, entry]) => {
    const recipe = creationRecipeForLegacyCommand(commandId);
    if (!recipe) throw new Error(`旧作成commandにレシピがありません: ${commandId}`);
    if (recipe.type !== entry.type) throw new Error(`旧作成commandの型が不一致です: ${commandId}`);
    return recipe;
  });

const nonElementCreationCommandIds = new Set([
  "addImage",
  "addNumericVariable",
  "deleteNumericVariable",
  "addBezierNumericVariable",
  "deleteBezierNumericVariable",
  "addBezierIntermediatePoint",
  "deleteBezierIntermediatePoint"
]);

describe("creationRecipes", () => {
  it("registers every specialized recipe required by the legacy creation commands", () => {
    expect(creationRecipes.map((recipe) => recipe.type)).toEqual([
      "freePoint",
      "line",
      "arcLine",
      "bezierCurve",
      "offsetLine",
      "variable",
      "divisionPoint",
      "lineDivisionPoint",
      "angleLengthLine",
      "copyLine",
      "symmetricCopyLine",
      "move",
      "symmetricMove"
    ]);
  });

  it("keeps every legacy creation recipe step aligned with its parameter definition", () => {
    for (const recipe of legacyCreationRecipes()) {
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

  it("covers every step kind through the legacy creation recipes", () => {
    const kinds = new Set(legacyCreationRecipes().flatMap((recipe) => recipe.steps.map((step) => step.kind)));
    expect(kinds).toEqual(new Set(["point", "endpoint", "line", "lineList", "number", "name"]));
  });

  it("serializes every legacy creation recipe to the golden DSL statement", () => {
    const statements = Object.fromEntries(legacyCreationRecipes().map((recipe) => {
      const { context, element } = emittedFor(recipe);
      return [recipe.type, serializeElementStatementLogical(element, documentDslRefs([...context.elements, element]))];
    }));

    expect(statements).toEqual({
      freePoint: "point 作成freePoint = coordinate(x: 12 y: 12)",
      variable: "var 作成variable = 12",
      text: "text 作成text = label(text: \"テキスト\" anchor: A size: 12)",
      offsetPoint: "point 作成offsetPoint = offset(from: A dx: 12 dy: 12)",
      polarOffsetPoint: "point 作成polarOffsetPoint = polar(from: A angle: 12 distance: 12)",
      divisionPoint: "point 作成divisionPoint = between(start: A end: A ratio: 12 steps: [ratio: 0.01])",
      lineDivisionPoint: "point 作成lineDivisionPoint = onLine(from: AB.start ratio: 12 steps: [ratio: 0.01])",
      intersectionPoint: "point 作成intersectionPoint = intersection(line1: AB line2: AB index: 12 extensions: true)",
      lineTangentOffsetPoint: "point 作成lineTangentOffsetPoint = tangentOffset(line: AB base: A angle: 12 distance: 12)",
      line: "line 作成line = segment(start: A end: A)",
      angleLengthLine: "line 作成angleLengthLine = polar(start: A angle: 12 length: 12)",
      arcLine: "arc 作成arcLine = arc(center: A radius: 12 start: 12 end: 12)",
      threePointArcLine: "arc 作成threePointArcLine = through(point1: A point2: A point3: A start: 12 end: 12)",
      cornerRadiusArcLine: "arc 作成cornerRadiusArcLine = corner(end1: AB.start end2: AB.start radius: 12 index: 12)",
      edge: "line 作成edge = edge(end1: AB.start end2: AB.start index: 12)",
      extendTrim: "line 作成extendTrim = extend(end: AB.start to: A)",
      bezierCurve: "curve 作成bezierCurve = bezier(start: A end: A startAngle: 12 startLength: 12 endAngle: 12 endLength: 12)",
      offsetLine: "line 作成offsetLine = offset(sources: [AB] distance: 12 side: right closed: false suppressTrimWarnings: false)",
      copyLine: "line 作成copyLine = copy(startPoint: A endPoint: A scale: 12 angleDeg: 12 mirrorX: false baseLines: [AB])",
      symmetricCopyLine: "line 作成symmetricCopyLine = mirrorCopy(axis1: A axis2: A baseLines: [AB])",
      move: "line 作成move = move(startPoint: A endPoint: A scale: 12 angleDeg: 12 mirrorX: false baseLines: [AB])",
      symmetricMove: "line 作成symmetricMove = mirrorMove(axis1: A axis2: A baseLines: [AB])",
      splitLine: "line 作成splitLine = split(source: AB at: A)"
    });
  });

  it("round-trips named and unnamed legacy creation recipes through the parser and compiler", () => {
    for (const recipe of legacyCreationRecipes()) {
      for (const includeName of [true, false]) {
        const { context, element } = emittedFor(recipe, includeName);
        const source = [
          serializeElementsToDsl(context.elements),
          serializeElementStatementLogical(element, documentDslRefs([...context.elements, element]))
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
    const endpoint = emitCreationRecipe(creationRecipeForLegacyCommand("addLineDivisionPoint")!, {}, context);
    const angleLength = emitCreationRecipe(creationRecipeForLegacyCommand("addAngleLengthLine")!, {}, context);

    expect(line).toMatchObject({
      id: "recipe-created-id",
      name: "",
      startPoint: referenceAnchor(""),
      endPoint: referenceAnchor("")
    });
    expect(offset).toMatchObject({ name: "", baseLineIds: [] });
    expect(endpoint).toMatchObject({ name: "", endpoint: { lineId: "", endpointKey: "start" } });
    expect(angleLength).toMatchObject({ name: "", startPoint: referenceAnchor("") });
  });

  it("keeps angleLengthLine to one start-point prompt and leaves incomplete empty-document previews to Phase 4f", () => {
    const recipe = creationRecipeForLegacyCommand("addAngleLengthLine")!;
    expect(recipe.steps.map((step) => step.kind === "name" ? "name" : step.key)).toEqual([
      "startPoint",
      "angleDeg",
      "length",
      "name"
    ]);

    const element = emitCreationRecipe(recipe, {}, {
      elements: [],
      referenceElements: [],
      createId: () => "angle-length-empty"
    });
    expect(element).toMatchObject({ startPoint: { mode: "coordinate", x: 0, y: 0 } });
  });

  it("maps every element-creation command to a resolvable recipe without manual cutover mapping", () => {
    const commandIds = Object.keys(creationCommandDefinitions)
      .filter((commandId) => !nonElementCreationCommandIds.has(commandId));
    expect(Object.keys(legacyCreationCommandRecipeMap)).toEqual(commandIds);

    for (const [commandId, entry] of Object.entries(legacyCreationCommandRecipeMap)) {
      const recipe = creationRecipeForLegacyCommand(commandId);
      expect(recipe, commandId).not.toBeNull();
      expect(recipe!.type, commandId).toBe(entry.type);
      expect(entry.recipeKind, commandId).toBe(
        creationRecipes.some((specialized) => specialized.type === entry.type) ? "specialized" : "fallback"
      );
      if (entry.recipeKind === "fallback") {
        expect(recipe, commandId).toEqual(fallbackCreationRecipe(entry.type));
      }
    }
    expect(creationRecipeForLegacyCommand("addImage")).toBeNull();
    expect(creationRecipeForLegacyCommand("addGroup")).toBeNull();
    expect(creationRecipeForLegacyCommand("addConditionalGroup")).toBeNull();
    expect(creationRecipeForLegacyCommand("addForGroup")).toBeNull();
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
