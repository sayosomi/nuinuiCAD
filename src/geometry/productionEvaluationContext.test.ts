import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { emptyDocument } from "@nuinuicad/nui-language";
import type { GeometryInputTarget } from "../types/geometry";
import type { EvaluateElementsOptions } from "./evaluate";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const standardPropertiesSource = [
  "nui 1",
  "const side: choice(right, left) = left",
  "const enabled: boolean = true",
  "const mirrored: boolean = true",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 20, y: 0)",
  "point C = coordinate(x: 10, y: -10)",
  "point D = coordinate(x: 10, y: 10)",
  "line AB = segment(start: @A, end: @B)",
  "line CD = segment(start: @C, end: @D)",
  "line Off = offset(sources: [@AB], distance: 3, side: @side, closed: @enabled, suppressTrimWarnings: @enabled)",
  "point Cross = intersection(line1: @AB, line2: @CD, index: 0, extensions: @enabled)",
  "line Copy = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: @mirrored, baseLines: [@AB])",
  "move AB (from: @A, to: @B, scale: 1, angleDeg: 0, mirrorX: @mirrored)",
  "image Guide = image(source: \"guide.png\", origin: (0, 0), scale: 1, angleDeg: 0, mirrorX: @mirrored)"
].join("\n");

const numericReferenceSource = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 30, y: 40)",
  "point C = coordinate(x: 60, y: 0)",
  "line AB = segment(start: @A, end: @B)",
  "arc Arc = arc(center: @A, radius: 10, start: 0, end: 90)",
  "curve Bez = bezier(start: @A, end: @C)",
  "point Measured = coordinate(x: @AB.length, y: @Arc.endAngleDeg)",
  "point Multi = coordinate(x: @AB.startPoint.x, y: @Bez.startPoint.y)",
  "point Combined = coordinate(x: @AB.length + @Arc.radius, y: @Bez.endHandleLength)"
].join("\n");

const controlSource = [
  "nui 1",
  "const flag: boolean = true",
  "const total: number = 0",
  "const show: boolean = false",
  "if (@flag) {",
  "  text Then = label(text: \"${@total}\", anchor: none, size: 3)",
  "} else {",
  "  text Else = label(text: \"inactive\", anchor: none, size: 3)",
  "}",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line AB = segment(start: @A, end: @B)",
  "for i in range(min: 0, max: 1, step: 1, showGenerated: @show) carry loopTotal: number = @total {",
  "  next loopTotal = @loopTotal + 1",
  "  text T = label(text: \"${@total}\", anchor: none, size: 3)",
  "  line Copy = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: @flag, baseLines: [@AB])",
  "}",
  "text Final = label(text: \"${@loopTotal}\", anchor: none, size: 3)"
].join("\n");

const declarationsTemplatesSource = [
  "nui 1",
  "const length: number = 12.3456",
  "const label: string = \"前身頃\"",
  "const printed: boolean = true",
  "const side: choice(right, left) = left",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: @length, y: 0)",
  "line AB = segment(start: @A, end: @B)",
  "text Label = label(text: \"${@label} ${@length}\", anchor: none, size: 3)",
  "text Bare = label(text: @label, anchor: none, size: 3)"
].join("\n");

const moduleScalarSource = [
  "nui 1",
  "module M(value: number, side: choice(right, left), label: string) {",
  "  point A = coordinate(x: 0, y: 0)",
  "  point B = coordinate(x: 10, y: 0)",
  "  line AB = segment(start: @A, end: @B)",
  "  line Off = offset(sources: [@AB], distance: @value, side: @side, closed: false, suppressTrimWarnings: false)",
  "  text Label = label(text: @label, anchor: none, size: 3)",
  "}",
  "instance I = M(value: 2, side: left, label: \"first\")"
].join("\n");

const geometryTargetOverlaySource = [
  "nui 1",
  "const seed: point[] = [(3, 4)]",
  "const empty: number[] = []",
  "for n in @empty carry pts: point[] = @seed {",
  "  next pts = @pts",
  "}",
  "for i in range(min: 0, max: 0, step: 1) {",
  "  point Mark = coordinate(x: 1, y: 2)",
  "}",
  "line Use = segment(start: @Mark[0], end: @pts[0])"
].join("\n");

const optionsFor = (
  compiledDocument: LastGoodDslDocument,
  evaluationLimitIndex: number | undefined = compiledDocument.document.evaluationLimitIndex
): EvaluateElementsOptions => buildEvaluationOptions({ compiledDocument, evaluationLimitIndex });

const elementByName = (compiled: LastGoodDslDocument, name: string) => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`missing element ${name}`);
  return element;
};

const entryKeys = (compiled: LastGoodDslDocument, entries: readonly { elementId: string; parameterKey: string }[] | undefined) =>
  (entries ?? []).map((entry) => `${compiled.document.elements.find((element) => element.id === entry.elementId)?.name}:${entry.parameterKey}`);

describe("buildEvaluationOptions", () => {
  it("lowers a plain compiled document without taking ownership of runtime elements", () => {
    const compiled = compile(["nui 1", "point A = coordinate(x: 1, y: 2)"].join("\n"));
    const options = optionsFor(compiled, undefined);

    expect(options.evaluationLimitIndex).toBeUndefined();
    expect(options).not.toHaveProperty("elements");
    expect(options).not.toHaveProperty("scalarProgram");
  });

  it("lowers compiled document-level drawing style definitions", () => {
    const compiled = compile([
      "nui 1",
      "style Hide {",
      "  visible: false,",
      "}",
      "point P [Hide] = coordinate(x: 1, y: 2)"
    ].join("\n"));

    expect(optionsFor(compiled).drawingModifiers).toEqual([{ name: "Hide", visible: false }]);
  });

  it("builds source property, numeric, control, condition, and text runtime metadata", () => {
    const propertyCompiled = compile(standardPropertiesSource);
    const propertyOptions = optionsFor(propertyCompiled);
    expect(entryKeys(propertyCompiled, propertyOptions.propertyBindingEntries)).toEqual(expect.arrayContaining([
      "Off:side",
      "Off:closed",
      "Off:suppressTrimWarnings",
      "Cross:useExtensions",
      "Copy:mirrorX",
      "Guide:mirrorX"
    ]));

    const numericCompiled = compile(numericReferenceSource);
    const numericOptions = optionsFor(numericCompiled);
    expect(entryKeys(numericCompiled, numericOptions.numericBindingEntries)).toEqual(expect.arrayContaining([
      "Measured:x",
      "Measured:y",
      "Multi:x",
      "Multi:y",
      "Combined:x",
      "Combined:y"
    ]));

    const controlCompiled = compile(controlSource);
    const controlOptions = optionsFor(controlCompiled);
    expect(entryKeys(controlCompiled, controlOptions.controlBooleanEntries)).toContain(":showGenerated");
    expect(controlOptions.conditionalGroupConditionsByElementId?.size).toBeGreaterThan(0);
    expect(controlOptions.textTemplateEntriesByElementId?.size).toBeGreaterThan(0);

    const textCompiled = compile(declarationsTemplatesSource);
    const textOptions = optionsFor(textCompiled);
    expect(entryKeys(textCompiled, textOptions.textPropertyBindingEntries)).toContain("Bare:text");
  });

  it("forwards compiled transformation numeric bindings by recipe identity", () => {
    const compiled = compile([
      "nui 1",
      "const dx: number = 3",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L (from: (0, 0), to: (@dx, 10))"
    ].join("\n"));
    const options = optionsFor(compiled);
    const recipe = compiled.runtimeTransformationRecipes?.find((candidate) => candidate.construction === "move");

    expect(options.transformationNumericBindingEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recipeId: recipe?.id,
        parameterPath: "endPoint.x",
        parameterKey: "endPoint:x",
        references: [expect.objectContaining({ bindingId: expect.any(String), name: "dx" })]
      })
    ]));
  });

  it("includes Module materialized property, numeric, control, and text metadata", () => {
    const scalarCompiled = compile(moduleScalarSource);
    const scalarOptions = optionsFor(scalarCompiled);
    expect(scalarOptions.propertyBindingEntries?.length).toBeGreaterThan(0);
    expect(scalarOptions.numericBindingEntries?.length).toBeGreaterThan(0);
    expect(scalarOptions.textPropertyBindingEntries?.length).toBeGreaterThan(0);

    const controlCompiled = compile([
      "nui 1",
      "module M(show: boolean) {",
      "  for i in range(min: 0, max: 1, step: 1, showGenerated: @show) {",
      "    point P = coordinate(x: i, y: 0)",
      "  }",
      "}",
      "instance I = M(show: true)"
    ].join("\n"));
    const controlOptions = optionsFor(controlCompiled);
    expect(controlOptions.controlBooleanEntries?.length).toBeGreaterThan(0);

    const textCompiled = compile([
      "nui 1",
      "module M(value: number) {",
      "  text T = label(text: \"${@value}\", anchor: none, size: 3)",
      "}",
      "instance I = M(value: 12)"
    ].join("\n"));
    const textOptions = optionsFor(textCompiled);
    expect(textOptions.textTemplateEntriesByElementId?.get(elementByName(textCompiled, "T").id)).toBeDefined();
  });

  it("merges source and Module materialized metadata for properties, numbers, controls, text, and owners", () => {
    const compiled = compile([
      "nui 1",
      "const flag: boolean = true",
      "const total: number = 0",
      "if (@flag) {",
      "  text Then = label(text: \"${@total}\", anchor: none, size: 3)",
      "}",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point Iteration = coordinate(x: @i, y: 0)",
      "}",
      "module M(enabled: boolean) {",
      "  const local: number = 0",
      "  if (@enabled) {",
      "    text LocalThen = label(text: \"${@local}\", anchor: none, size: 3)",
      "  }",
      "  for j in range(min: 0, max: 1, step: 1) {",
      "    point LoopPoint = coordinate(x: @j, y: @local)",
      "  }",
      "  point P = coordinate(x: @local, y: 0)",
      "  text T = label(text: \"${@local}\", anchor: none, size: 3)",
      "}",
      "instance I = M(enabled: @flag)"
    ].join("\n"));
    const options = optionsFor(compiled);

    const sourceConditionalIds = [...(options.conditionalOwnerStatementIdByElementId ?? [])]
      .map(([elementId]) => elementId)
      .filter((elementId) => compiled.document.elements.find((element) => element.id === elementId)?.type === "conditionalGroup");
    const moduleConditionalIds = [...(options.moduleConditionalOwnerStatementIdByElementId?.keys() ?? [])];
    expect(sourceConditionalIds.length).toBeGreaterThan(0);
    expect(moduleConditionalIds.length).toBeGreaterThan(0);
    expect([...sourceConditionalIds, ...moduleConditionalIds].length).toBeGreaterThan(1);

    const sourceForGroupIds = [...(options.forGroupMutationOwnerByElementId ?? [])]
      .map(([elementId]) => elementId)
      .filter((elementId) => compiled.document.elements.find((element) => element.id === elementId)?.type === "forGroup");
    const moduleForGroupIds = [...(options.moduleForGroupExecutionOwnerByElementId?.keys() ?? [])];
    expect(sourceForGroupIds.length).toBeGreaterThan(0);
    expect(moduleForGroupIds.length).toBeGreaterThan(0);
  });

  it("keeps canonical compiled and runtime geometry targets by element and parameter slot", () => {
    const compiled = compile(geometryTargetOverlaySource);
    const use = elementByName(compiled, "Use");
    const rootTargets = compiled.geometryInputTargetsByElementId?.get(use.id);
    const runtimeTargets = compiled.moduleGeometryRuntime?.geometryInputTargetsByRuntimeElementId.get(use.id);
    if (!rootTargets || !runtimeTargets) throw new Error("expected root and runtime targets for Use");

    const rootStart = rootTargets.get("startPoint") as GeometryInputTarget;
    const rootEnd = rootTargets.get("endPoint") as GeometryInputTarget;
    const runtimeStart = runtimeTargets.get("startPoint") as GeometryInputTarget;
    const rootEntriesBefore = [...rootTargets];
    const runtimeEntriesBefore = [...runtimeTargets];
    const options = optionsFor(compiled);
    const mergedTargets = options.geometryInputTargetsByElementId?.get(use.id);
    if (!mergedTargets) throw new Error("buildEvaluationOptions omitted Use geometry targets");

    expect(rootStart).toMatchObject({
      kind: "forGroupOccurrence",
      templateElementId: expect.any(String),
      geometryType: "point",
      targetSourceOrder: 3,
      index: { kind: "numberLiteral", span: { start: 32, end: 33 }, value: 0, type: { kind: "number" } },
      sourceText: "@Mark[0]"
    });
    expect(runtimeStart).toMatchObject({
      kind: "forGroupOccurrence",
      templateElementId: rootStart.kind === "forGroupOccurrence" ? rootStart.templateElementId : undefined,
      geometryType: "point",
      targetSourceOrder: 3,
      index: { kind: "numberLiteral", span: { start: 32, end: 33 }, value: 0, type: { kind: "number" } }
    });
    expect(rootEnd).toMatchObject({
      kind: "collectionIndex",
      collectionValueId: expect.stringMatching(/^carry-collection:/),
      collectionLength: null,
      targetSourceOrder: -1,
      index: { kind: "numberLiteral", span: { start: 46, end: 47 }, value: 0, type: { kind: "number" } },
      members: []
    });
    expect([...mergedTargets.keys()]).toEqual(["startPoint", "endPoint"]);
    expect(mergedTargets.get("startPoint")).toBe(runtimeStart);
    expect(mergedTargets.get("endPoint")).toBe(rootEnd);
    expect([...rootTargets]).toEqual(rootEntriesBefore);
    expect([...runtimeTargets]).toEqual(runtimeEntriesBefore);
  });

  it("keeps runtime replacement slot-local without mutating or combining either target map", () => {
    const compiled = compile(geometryTargetOverlaySource);
    const use = elementByName(compiled, "Use");
    const rootTargets = compiled.geometryInputTargetsByElementId?.get(use.id);
    const moduleRuntime = compiled.moduleGeometryRuntime;
    const runtimeTargets = moduleRuntime?.geometryInputTargetsByRuntimeElementId.get(use.id);
    if (!rootTargets || !moduleRuntime || !runtimeTargets) throw new Error("expected root and runtime targets for Use");

    const rootStart = rootTargets.get("startPoint") as GeometryInputTarget;
    const rootEnd = rootTargets.get("endPoint") as GeometryInputTarget;
    const runtimeStart = runtimeTargets.get("startPoint") as GeometryInputTarget;
    const rootList = [rootStart];
    const runtimeList = [runtimeStart];
    const rootTargetsWithList = new Map(rootTargets);
    rootTargetsWithList.set("overlappingTargetList", rootList);
    const runtimeTargetsWithList = new Map(runtimeTargets);
    runtimeTargetsWithList.set("overlappingTargetList", runtimeList);
    const rootTargetsByElementId = new Map(compiled.geometryInputTargetsByElementId);
    rootTargetsByElementId.set(use.id, rootTargetsWithList);
    const runtimeTargetsByElementId = new Map(moduleRuntime.geometryInputTargetsByRuntimeElementId);
    runtimeTargetsByElementId.set(use.id, runtimeTargetsWithList);
    const withOverlappingList = {
      ...compiled,
      geometryInputTargetsByElementId: rootTargetsByElementId,
      moduleGeometryRuntime: {
        ...moduleRuntime,
        geometryInputTargetsByRuntimeElementId: runtimeTargetsByElementId
      }
    };

    const overlaid = optionsFor(withOverlappingList).geometryInputTargetsByElementId?.get(use.id);
    expect(overlaid?.get("startPoint")).toBe(runtimeStart);
    expect(overlaid?.get("endPoint")).toBe(rootEnd);
    expect(overlaid?.get("overlappingTargetList")).toBe(runtimeList);
    expect(overlaid?.get("overlappingTargetList")).toHaveLength(1);
    expect(rootTargets.has("overlappingTargetList")).toBe(false);
    expect(runtimeTargets.has("overlappingTargetList")).toBe(false);

    const rootOnly = optionsFor({ ...compiled, moduleGeometryRuntime: undefined })
      .geometryInputTargetsByElementId?.get(use.id);
    expect(rootOnly).toEqual(rootTargets);
    expect(rootOnly?.get("startPoint")).toBe(rootStart);
    expect(rootOnly?.get("endPoint")).toBe(rootEnd);

    const runtimeOnly = optionsFor({ ...compiled, geometryInputTargetsByElementId: undefined })
      .geometryInputTargetsByElementId?.get(use.id);
    expect(runtimeOnly).toEqual(runtimeTargets);
    expect(runtimeOnly?.get("startPoint")).toBe(runtimeStart);
  });

  it("keeps all-numeric text templates when scalarProgram is absent", () => {
    const compiled = compile([
      "nui 1",
      "text T = label(text: \"cost ${12.5} yen\", anchor: none, size: 3)"
    ].join("\n"));
    const options = optionsFor(compiled);

    expect(compiled.scalarProgram).toBeUndefined();
    expect(options.textTemplateEntriesByElementId?.get(elementByName(compiled, "T").id)).toBeDefined();
  });

  it("uses the caller's evaluation limit without falling back to the compiled document", () => {
    const compiled = compile([
      "nui 1",
      "point A = coordinate(x: 1, y: 2)",
      "point B = coordinate(x: 3, y: 4)"
    ].join("\n"));

    expect(compiled.document.evaluationLimitIndex).toBeUndefined();
    expect(buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }).evaluationLimitIndex)
      .toBeUndefined();
    expect(buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: 0 }).evaluationLimitIndex)
      .toBe(0);
  });
});
