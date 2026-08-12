import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { buildConditionalGroupConditionsByElementId } from "../geometry/controlBooleanRuntime";
import { evaluateElements, type EvaluateElementsOptions } from "../geometry/evaluate";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import type { BindingId } from "../scalars/bindingCatalog";
import {
  typedBindingRuntimeInspectorPresentation,
  type TypedBindingRuntimeConsumerSources
} from "./typedBindingRuntimeInspectorPresentation";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
  const result = compileCanonicalText(baseline, source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return result.doc;
};

const optionsFor = (compiled: LastGoodDslDocument): EvaluateElementsOptions => ({
  evaluationLimitIndex: compiled.document.evaluationLimitIndex,
  scalarProgram: compiled.scalarProgram,
  bindingVersions: compiled.bindingVersions,
  statementInfoByElementId: compiled.statementMap.byElementId,
  statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
  conditionalOwnerStatementIdByElementId: compiled.bindingVersions
    ? conditionalOwnerIdByElementId(buildConditionalMutationOwners(
        compiled.bindingVersions, compiled.document.elements, compiled.statementMap.byElementId,
        compiled.statementMap.statementIdByStatementIndex
      ))
    : undefined,
  forGroupMutationOwnerByElementId: compiled.bindingVersions
    ? forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
        compiled.bindingVersions, compiled.document.elements, compiled.statementMap.byElementId,
        compiled.statementMap.statementIdByStatementIndex
      ))
    : undefined,
  conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
    compiled.conditionalGroupConditions ?? new Map(),
    compiled.statementMap.elementIdByStatementIndex
  )
});

const bindingIdByName = (compiled: LastGoodDslDocument, name: string): BindingId =>
  compiled.bindingAnalysis!.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === name)!.id;

const consumersFor = (compiled: LastGoodDslDocument): TypedBindingRuntimeConsumerSources => ({
  propertyBindings: compiled.propertyBindings,
  conditionalGroupConditions: compiled.conditionalGroupConditions,
  textTemplates: compiled.textTemplates,
  statementMap: compiled.statementMap,
  elements: compiled.document.elements
});

const consumerRowsFor = (compiled: LastGoodDslDocument, bindingId: BindingId) =>
  typedBindingRuntimeInspectorPresentation(
    compiled.bindingAnalysis!,
    compiled.bindingVersions,
    evaluateElements(compiled.document.elements, optionsFor(compiled)),
    consumersFor(compiled),
    bindingId,
    true
  )?.consumerRows ?? [];

describe("typedBindingRuntimeInspectorPresentation: consumer rows", () => {
  it("offsetLine.side (choice) - exact property jump", () => {
    const compiled = compileCanonical([
      "nui 3",
      "const 方向: choice(right, left) = right",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 10, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "方向");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Off", detail: "オフセット線・位置" });
    expect(rows[0].jump.kind).toBe("property");
  });

  it("intersectionPoint.useExtensions (boolean)", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 延長: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point C = coordinate(x: 0, y: 10)",
      "point D = coordinate(x: 10, y: 10)",
      "line AB = segment(start: @A, end: @B)",
      "line CD = segment(start: @C, end: @D)",
      "point X = intersection(line1: @AB, line2: @CD, extensions: @延長)"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "延長");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "X", detail: "交点・延長" });
    expect(rows[0].jump.kind).toBe("property");
  });

  it("group.printEnabled", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 印刷: boolean = true",
      "group G (printEnabled: @印刷) {",
      "}"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "印刷");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "G", detail: "グループ・印刷" });
  });

  it("forGroup.showGenerated", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 表示: boolean = true",
      "for 繰返し (i, from: 0, count: 2, step: 1, showGenerated: @表示) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "表示");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "繰返し", detail: "forブロック・生成結果を表示" });
  });

  it("text.text bare binding", () => {
    const compiled = compileCanonical([
      "nui 3",
      'const ラベル: string = "前身頃"',
      "text T = label(text: @ラベル, anchor: none, size: 3)"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "ラベル");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "T", detail: "テキスト・テキスト" });
    expect(rows[0].jump.kind).toBe("property");
  });

  it("conditionalGroup.condition - falls back to a whole-element jump (no Task 43 span index for a condition expression)", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let flag: boolean = true",
      "if C (@flag) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "flag");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "C", detail: "ifブロック・条件式" });
    expect(rows[0].jump).toEqual({ kind: "element" });
  });

  it("a text-template interpolation hole - resolves the exact holeIndex", () => {
    const compiled = compileCanonical([
      "nui 3",
      'const ラベル: string = "前身頃"',
      'text T = label(text: "{@ラベル}を2枚カット", anchor: none, size: 3)'
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "ラベル");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "T" });
    expect(rows[0].jump).toMatchObject({ kind: "templateHole", holeIndex: 0 });
  });

  it("a second hole later in the same template resolves a non-zero holeIndex", () => {
    const compiled = compileCanonical([
      "nui 3",
      'const 前: string = "前身頃"',
      'const 後: string = "後身頃"',
      'text T = label(text: "{@前}と{@後}", anchor: none, size: 3)'
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "後");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows).toHaveLength(1);
    expect(rows[0].jump).toMatchObject({ kind: "templateHole", holeIndex: 1 });
  });

  it("a binding with no consumers returns an empty array", () => {
    const compiled = compileCanonical(["nui 3", "const unused: number = 1"].join("\n"));
    const bindingId = bindingIdByName(compiled, "unused");
    expect(consumerRowsFor(compiled, bindingId)).toEqual([]);
  });

  it("one binding consumed by two different properties produces two rows", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 印刷: boolean = true",
      "group G1 (printEnabled: @印刷) {",
      "}",
      "group G2 (printEnabled: @印刷) {",
      "}"
    ].join("\n"));
    const bindingId = bindingIdByName(compiled, "印刷");
    const rows = consumerRowsFor(compiled, bindingId);
    expect(rows.map((row) => row.label).sort()).toEqual(["G1", "G2"]);
  });

  it("does not include a different binding's consumers", () => {
    const compiled = compileCanonical([
      "nui 3",
      "let 印刷A: boolean = true",
      "let 印刷B: boolean = false",
      "group G1 (printEnabled: @印刷A) {",
      "}",
      "group G2 (printEnabled: @印刷B) {",
      "}"
    ].join("\n"));
    const bindingIdA = bindingIdByName(compiled, "印刷A");
    const rows = consumerRowsFor(compiled, bindingIdA);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("G1");
  });
});
