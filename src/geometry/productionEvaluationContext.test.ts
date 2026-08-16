import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import type { EvaluateElementsOptions } from "./evaluate";
import { buildEvaluationOptions } from "./productionEvaluationContext";

const compile = (source: string): LastGoodDslDocument => {
  const result = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 4), source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const standardPropertiesSource = [
  "nui 4",
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
  "line Copy = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: @mirrored, baseLines: [@AB])",
  "move(targets: [@AB], from: @A, to: @B, scale: 1, angleDeg: 0, mirrorX: @mirrored)",
  "image Guide = image(source: \"guide.png\", origin: (0, 0), scale: 1, angleDeg: 0, mirrorX: @mirrored)"
].join("\n");

const numericReferenceSource = [
  "nui 4",
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

const controlMutationSource = [
  "nui 4",
  "let flag: boolean = true",
  "let total: number = 0",
  "let show: boolean = false",
  "if (@flag) {",
  "  set total = @total + 3",
  "  text Then = label(text: \"${@total}\", anchor: none, size: 3)",
  "} else {",
  "  set total = 99",
  "  text Else = label(text: \"inactive\", anchor: none, size: 3)",
  "}",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line AB = segment(start: @A, end: @B)",
  "for i in range(from: 0, count: 2, step: 1, showGenerated: @show) {",
  "  set total = @total + 1",
  "  text T = label(text: \"${@total}\", anchor: none, size: 3)",
  "  line Copy = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: @flag, baseLines: [@AB])",
  "}",
  "text Final = label(text: \"${@total}\", anchor: none, size: 3)"
].join("\n");

const declarationsTemplatesSource = [
  "nui 4",
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
  "nui 4",
  "module M(value: number, side: choice(right, left), label: string) {",
  "  point A = coordinate(x: 0, y: 0)",
  "  point B = coordinate(x: 10, y: 0)",
  "  line AB = segment(start: @A, end: @B)",
  "  line Off = offset(sources: [@AB], distance: @value, side: @side, closed: false, suppressTrimWarnings: false)",
  "  text Label = label(text: @label, anchor: none, size: 3)",
  "}",
  "instance I = M(value: 2, side: left, label: \"first\")"
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
    const compiled = compile(["nui 4", "point A = coordinate(x: 1, y: 2)"].join("\n"));
    const options = optionsFor(compiled, undefined);

    expect(options.evaluationLimitIndex).toBeUndefined();
    expect(options).not.toHaveProperty("elements");
    expect(options).not.toHaveProperty("scalarProgram");
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
      ":mirrorX",
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

    const controlCompiled = compile(controlMutationSource);
    const controlOptions = optionsFor(controlCompiled);
    expect(entryKeys(controlCompiled, controlOptions.controlBooleanEntries)).toContain(":showGenerated");
    expect(controlOptions.conditionalGroupConditionsByElementId?.size).toBeGreaterThan(0);
    expect(controlOptions.textTemplateEntriesByElementId?.size).toBeGreaterThan(0);

    const textCompiled = compile(declarationsTemplatesSource);
    const textOptions = optionsFor(textCompiled);
    expect(entryKeys(textCompiled, textOptions.textPropertyBindingEntries)).toContain("Bare:text");
  });

  it("includes Module materialized property, numeric, control, and text metadata", () => {
    const scalarCompiled = compile(moduleScalarSource);
    const scalarOptions = optionsFor(scalarCompiled);
    expect(scalarOptions.propertyBindingEntries?.length).toBeGreaterThan(0);
    expect(scalarOptions.numericBindingEntries?.length).toBeGreaterThan(0);
    expect(scalarOptions.textPropertyBindingEntries?.length).toBeGreaterThan(0);

    const controlCompiled = compile([
      "nui 4",
      "module M(show: boolean) {",
      "  for i in range(from: 0, count: 2, step: 1, showGenerated: @show) {",
      "    point P = coordinate(x: i, y: 0)",
      "  }",
      "}",
      "instance I = M(show: true)"
    ].join("\n"));
    const controlOptions = optionsFor(controlCompiled);
    expect(controlOptions.controlBooleanEntries?.length).toBeGreaterThan(0);

    const textCompiled = compile([
      "nui 4",
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
      "nui 4",
      "let flag: boolean = true",
      "let total: number = 0",
      "if (@flag) {",
      "  set total = 1",
      "}",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  set total = @total + 1",
      "}",
      "module M(enabled: boolean) {",
      "  let local: number = 0",
      "  if (@enabled) {",
      "    set local = 1",
      "  }",
      "  for j in range(from: 0, count: 2, step: 1) {",
      "    set local = @local + 1",
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
    const moduleForGroupIds = [...(options.moduleForGroupMutationOwnerByElementId?.keys() ?? [])];
    expect(sourceForGroupIds.length).toBeGreaterThan(0);
    expect(moduleForGroupIds.length).toBeGreaterThan(0);
  });

  it("keeps all-numeric text templates when scalarProgram is absent", () => {
    const compiled = compile([
      "nui 4",
      "text T = label(text: \"cost ${12.5} yen\", anchor: none, size: 3)"
    ].join("\n"));
    const options = optionsFor(compiled);

    expect(compiled.scalarProgram).toBeUndefined();
    expect(options.textTemplateEntriesByElementId?.get(elementByName(compiled, "T").id)).toBeDefined();
  });

  it("uses the caller's evaluation limit without falling back to the compiled document", () => {
    const compiled = compile([
      "nui 4",
      "point A = coordinate(x: 1, y: 2)",
      "stop",
      "point B = coordinate(x: 3, y: 4)"
    ].join("\n"));

    expect(compiled.document.evaluationLimitIndex).toBe(1);
    expect(buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined }).evaluationLimitIndex)
      .toBeUndefined();
    expect(buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: 0 }).evaluationLimitIndex)
      .toBe(0);
  });
});
