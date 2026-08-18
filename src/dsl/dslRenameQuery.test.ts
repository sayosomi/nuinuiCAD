import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  planDslRenameEdits,
  queryDslRenameTarget,
  type DslRenameSnapshot
} from "./dslRenameQuery";

const compile = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `rename-test:${index}`]))
  });
};

const snapshot = (source: string, sourceRevision = 7): DslRenameSnapshot => ({
  source: { normalizedSource: source, sourceRevision },
  semantic: { sourceRevision, compiled: compile(source, sourceRevision) }
});

const at = (source: string, token: string, offset = 0) => source.indexOf(token) + offset;

describe("host-neutral DSL rename query", () => {
  it("renames a typed declaration from either its declaration or reference", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "let result: number = @width + 1"
    ].join("\n");
    const declaration = queryDslRenameTarget(snapshot(source), at(source, "width"));
    const reference = queryDslRenameTarget(snapshot(source), at(source, "@width") + 1);
    expect(declaration?.range).toEqual({ from: at(source, "width"), to: at(source, "width") + 5 });
    expect(reference?.range).toEqual({ from: at(source, "@width") + 1, to: at(source, "@width") + 6 });
    const plan = planDslRenameEdits(snapshot(source), at(source, "@width") + 1, "横幅");
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["width", "width"]);
    expect(plan?.edits.every((edit) => edit.newText === "横幅")).toBe(true);
  });

  it("keeps @ and qualified separators outside the target range", () => {
    const source = [
      "nui 4",
      "group Front {",
      "  point Shoulder = coordinate(x: 0, y: 0)",
      "}",
      "point Use = offset(from: @Front::Shoulder, dx: 1, dy: 0)"
    ].join("\n");
    const group = queryDslRenameTarget(snapshot(source), at(source, "@Front::Shoulder") + 1);
    const shoulder = queryDslRenameTarget(snapshot(source), at(source, "@Front::Shoulder") + "@Front::".length);
    expect(group?.oldName).toBe("Front");
    expect(shoulder?.oldName).toBe("Shoulder");
    expect(group?.range).toEqual({ from: at(source, "@Front::Shoulder") + 1, to: at(source, "@Front::Shoulder") + 6 });
    expect(shoulder?.range.from).toBe(at(source, "@Front::Shoulder") + "@Front::".length);
  });

  it("projects an element rename without changing comments or unrelated text", () => {
    const source = [
      "nui 4",
      "# Base in a comment",
      "point Base = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point Use = offset(",
      "  from: @Base,",
      "  dx: 1,",
      "  dy: 0,",
      ")",
      "point BaseCopy = coordinate(x: 2, y: 0)"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "@Base") + 1, "Renamed");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => edit.expectedText)).toEqual(["Base", "Base"]);
    expect(plan?.edits.every((edit) => edit.newText === "Renamed")).toBe(true);
    expect(plan?.edits.some((edit) => source.slice(edit.from, edit.to) === "BaseCopy")).toBe(false);
  });

  it("projects element-side geometry properties from numeric expressions", () => {
    const source = [
      "nui 4",
      "# A in a comment",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point B = coordinate(",
      "  x: @A.x + 10,",
      "  y: 0,",
      ")",
      'text Label = label(text: "A", anchor: none, size: 3)'
    ].join("\n");
    const referenceStart = at(source, "@A.x");
    const target = queryDslRenameTarget(snapshot(source), referenceStart + 1);
    expect(target).toEqual({
      sourceRevision: 7,
      oldName: "A",
      range: { from: referenceStart + 1, to: referenceStart + 2 }
    });
    expect(queryDslRenameTarget(snapshot(source), referenceStart + 3)).toBeNull();

    const plan = planDslRenameEdits(snapshot(source), referenceStart + 1, "Renamed");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => edit.expectedText)).toEqual(["A", "A"]);
    expect(plan?.edits.every((edit) => edit.newText === "Renamed")).toBe(true);
    expect(plan?.edits.every((edit) => edit.from > source.indexOf("# A"))).toBe(true);
    expect(source.slice(plan!.edits[0].from, plan!.edits[0].to)).toBe("A");
    expect(source).toContain('text: "A"');
  });

  it("projects qualified numeric geometry-property segments independently", () => {
    const source = [
      "nui 4",
      "group Group {",
      "  point A = coordinate(",
      "    x: 0,",
      "    y: 0,",
      "  )",
      "}",
      "point B = coordinate(",
      "  x: @Group::A.x + 10,",
      "  y: 0,",
      ")"
    ].join("\n");
    const referenceStart = at(source, "@Group::A.x");
    const group = queryDslRenameTarget(snapshot(source), referenceStart + 1);
    const elementStart = referenceStart + "@Group::".length;
    const element = queryDslRenameTarget(snapshot(source), elementStart);
    expect(group?.oldName).toBe("Group");
    expect(group?.range).toEqual({ from: referenceStart + 1, to: referenceStart + 6 });
    expect(element?.oldName).toBe("A");
    expect(element?.range).toEqual({ from: elementStart, to: elementStart + 1 });
    expect(queryDslRenameTarget(snapshot(source), referenceStart + "@Group::A".length + 1)).toBeNull();

    const groupPlan = planDslRenameEdits(snapshot(source), referenceStart + 1, "RenamedGroup");
    expect(groupPlan).not.toBeNull();
    expect(groupPlan?.edits.map((edit) => edit.expectedText)).toEqual(["Group", "Group"]);
    const elementPlan = planDslRenameEdits(snapshot(source), elementStart, "RenamedA");
    expect(elementPlan).not.toBeNull();
    expect(elementPlan?.edits.map((edit) => edit.expectedText)).toEqual(["A", "A"]);
  });

  it("starts element rename from derived endpoint geometry properties", () => {
    const source = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point B = coordinate(",
      "  x: 10,",
      "  y: 0,",
      ")",
      "line AB = segment(",
      "  start: @A,",
      "  end: @B,",
      ")",
      "point Use = coordinate(",
      "  x: @AB.startPoint.x + 1,",
      "  y: 0,",
      ")"
    ].join("\n");
    const referenceStart = at(source, "@AB.startPoint.x");
    expect(queryDslRenameTarget(snapshot(source), referenceStart + 1)?.oldName).toBe("AB");
    const plan = planDslRenameEdits(snapshot(source), referenceStart + 1, "RenamedLine");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => edit.expectedText)).toEqual(["AB", "AB"]);
  });

  it("starts rename from printLayout and place numeric geometry properties", () => {
    const source = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "group G {",
      "}",
      "printLayout Sheet(",
      "  output: pdf,",
      "  paper: a4,",
      "  orientation: portrait,",
      "  width: 210+@A.x,",
      "  height: 297,",
      "  columns: 2,",
      "  rows: 2,",
      "  overlap: 10,",
      "  scale: 1+@A.x,",
      ") {",
      "  place @G(x: 3+@A.x, y: 4+@A.x, angle: 5+@A.x, mirrorX: false)",
      "}"
    ].join("\n");
    const scaleReference = source.indexOf("@A.x", source.indexOf("scale:"));
    const placeReference = source.indexOf("@A.x", source.indexOf("place"));
    const xReference = source.indexOf("@A.x", source.indexOf("x: 3"));
    const yReference = source.indexOf("@A.x", source.indexOf("y: 4"));
    const angleReference = source.indexOf("@A.x", source.indexOf("angle:"));
    for (const referenceStart of [scaleReference, placeReference, xReference, yReference, angleReference]) {
      expect(queryDslRenameTarget(snapshot(source), referenceStart + 1)?.oldName).toBe("A");
    }
  });

  it("routes module definitions, parameters, instances, and call labels through module semantics", () => {
    const source = [
      "nui 4",
      "module Measure(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const definition = planDslRenameEdits(snapshot(source), at(source, "Measure"), "MeasureLine");
    const parameter = planDslRenameEdits(snapshot(source), at(source, "width: number"), "length");
    expect(definition?.edits.length).toBe(2);
    expect(parameter?.edits.length).toBe(3);
  });

  it("fails closed for stale, fatal, unresolved, and module-iteration snapshots", () => {
    const source = ["nui 4", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const stale = snapshot(source, 7);
    expect(queryDslRenameTarget({ ...stale, source: { ...stale.source, sourceRevision: 8 } }, 6)).toBeNull();
    expect(queryDslRenameTarget({
      ...stale,
      semantic: { ...stale.semantic!, sourceText: `${source} ` }
    }, 6)).toBeNull();

    const brokenSource = ["nui 4", "point A = offset(from: @Missing, dx: 1, dy: 0)"].join("\n");
    expect(queryDslRenameTarget(snapshot(brokenSource), at(brokenSource, "Missing"))).toBeNull();

    const iterationSource = [
      "nui 4",
      "for i in range(from: 0, count: 1) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    expect(planDslRenameEdits(snapshot(iterationSource), at(iterationSource, "i in") , "j")).toBeNull();
  });

  it("uses UTF-16 offsets when a surrogate pair precedes a Japanese identifier", () => {
    const source = [
      "nui 4",
      "# 😀",
      "point 前身頃 = coordinate(x: 0, y: 0)"
    ].join("\n");
    const offset = source.indexOf("前身頃");
    const target = queryDslRenameTarget(snapshot(source), offset + 1);
    expect(target?.range).toEqual({ from: offset, to: offset + "前身頃".length });
  });

  it("renames an ordinary source element in a document with materialized Module elements", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @width + 5",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用点 = offset(from: @前身頃, dx: 10, dy: 0)",
      "const 前身頃X: number = @前身頃.x",
      "module Measure(input: point) {",
      "  point P = offset(from: @input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: @前身頃)"
    ].join("\n");
    const declarationOffset = at(source, "前身頃 =");
    const referenceOffset = at(source, "@前身頃") + 1;

    const declarationPlan = planDslRenameEdits(snapshot(source), declarationOffset, "後身頃");
    const referencePlan = planDslRenameEdits(snapshot(source), referenceOffset, "後身頃");

    expect(declarationPlan).not.toBeNull();
    expect(referencePlan).not.toBeNull();
    expect(declarationPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "前身頃",
      "前身頃",
      "前身頃",
      "前身頃"
    ]);
    expect(declarationPlan?.edits.map((edit) => edit.newText)).toEqual(["後身頃", "後身頃", "後身頃", "後身頃"]);
    expect(referencePlan?.edits).toEqual(declarationPlan?.edits);
    expect(declarationPlan?.edits.every((edit) => !source.slice(edit.from, edit.to).includes(".x"))).toBe(true);

    const widthPlan = planDslRenameEdits(snapshot(source), at(source, "@width") + 1, "renamedWidth");
    expect(widthPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["width", "width"]);
  });

  it("renames qualified module-backed element segments without projecting aggregate candidates", () => {
    const source = [
      "nui 4",
      "group Front {",
      "  point Shoulder = coordinate(x: 0, y: 20)",
      "}",
      "point QualifiedUse = offset(",
      "  from: @Front::Shoulder,",
      "  dx: 10,",
      "  dy: 0,",
      ")",
      "module Measure(input: point) {",
      "  point P = offset(from: @input, dx: 1, dy: 0)",
      "}",
      "instance Call = Measure(input: @QualifiedUse)"
    ].join("\n");
    const qualifiedReference = at(source, "@Front::Shoulder");
    const frontOffset = qualifiedReference + 1;
    const shoulderOffset = qualifiedReference + "@Front::".length;

    const frontPlan = planDslRenameEdits(snapshot(source), frontOffset, "Bodice");
    expect(frontPlan).not.toBeNull();
    expect(frontPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Front", "Front"]);
    expect(frontPlan?.edits.map((edit) => edit.newText)).toEqual(["Bodice", "Bodice"]);

    const shoulderFromReference = planDslRenameEdits(snapshot(source), shoulderOffset, "NeckPoint");
    const shoulderFromDeclaration = planDslRenameEdits(snapshot(source), at(source, "Shoulder ="), "NeckPoint");
    for (const shoulderPlan of [shoulderFromReference, shoulderFromDeclaration]) {
      expect(shoulderPlan).not.toBeNull();
      expect(shoulderPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Shoulder", "Shoulder"]);
      expect(shoulderPlan?.edits.map((edit) => edit.expectedText)).toEqual(["Shoulder", "Shoulder"]);
      expect(shoulderPlan?.edits.map((edit) => edit.newText)).toEqual(["NeckPoint", "NeckPoint"]);
      expect(shoulderPlan?.edits.every((edit) => source.slice(edit.from, edit.to) !== "Front::Shoulder")).toBe(true);
    }
    expect(shoulderFromReference?.edits).toEqual(shoulderFromDeclaration?.edits);
  });

  it("preserves ordinary same-scope collisions in a document with materialized Module elements", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 0)",
      "module Measure(input: point) {",
      "  point P = offset(from: @input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: @A)"
    ].join("\n");

    expect(planDslRenameEdits(snapshot(source), at(source, "A ="), "B")).toBeNull();
  });
});
