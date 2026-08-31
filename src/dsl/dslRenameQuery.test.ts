import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  planDslRenameEdits,
  planDslRenameEditsResult,
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

const applyEdits = (source: string, edits: readonly { from: number; to: number; newText: string }[]) =>
  [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((text, edit) => `${text.slice(0, edit.from)}${edit.newText}${text.slice(edit.to)}`, source);

describe("host-neutral DSL rename query", () => {
  it("renames a typed declaration from either its declaration or reference", () => {
    const source = [
      "nui 1",
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

  it("returns a structured typed same-scope collision while preserving the null wrapper", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = @width + 5"
    ].join("\n");
    const result = planDslRenameEditsResult(snapshot(source), at(source, "@width") + 1, "result");

    expect(result).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "result", conflictingLine: 3 }
    });
    expect(planDslRenameEdits(snapshot(source), at(source, "@width") + 1, "result")).toBeNull();
  });

  it("returns a structured invalid-name rejection from the typed analyzer", () => {
    const source = "nui 1\nconst width: number = 10";

    expect(planDslRenameEditsResult(snapshot(source), at(source, "width"), "")).toEqual({
      status: "rejected",
      rejection: { reason: "invalid-name", message: "名前は空にできません。" }
    });
  });

  it("returns a structured typed reference-resolution rejection for capture", () => {
    const source = [
      "nui 1",
      "const outer: number = 1",
      "group G {",
      "  const inner: number = 2",
      "  const use: number = @outer",
      "}"
    ].join("\n");

    const result = planDslRenameEditsResult(snapshot(source), at(source, "@outer") + 1, "inner");

    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.rejection : null).toEqual({
      reason: "reference-resolution-change",
      family: "typed",
      referencedName: "outer"
    });
  });

  it("keeps @ and qualified separators outside the target range", () => {
    const source = [
      "nui 1",
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
      "nui 1",
      "// Base in a comment",
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
      "nui 1",
      "// A in a comment",
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
    expect(plan?.edits.every((edit) => edit.from > source.indexOf("// A"))).toBe(true);
    expect(source.slice(plan!.edits[0].from, plan!.edits[0].to)).toBe("A");
    expect(source).toContain('text: "A"');
  });

  it("projects qualified numeric geometry-property segments independently", () => {
    const source = [
      "nui 1",
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

  it("renames the element path of a qualified choice geometry property", () => {
    const source = [
      "nui 1",
      "group Outer {",
      "  arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "}",
      "const direction: choice(counterclockwise, clockwise) = @Outer::A.direction"
    ].join("\n");
    const referenceStart = at(source, "@Outer::A.direction");
    const elementStart = referenceStart + "@Outer::".length;
    const target = queryDslRenameTarget(snapshot(source), elementStart);
    const plan = planDslRenameEdits(snapshot(source), elementStart, "RenamedArc");

    expect(target?.oldName).toBe("A");
    expect(target?.range).toEqual({ from: elementStart, to: elementStart + 1 });
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["A", "A"]);
    expect(plan?.edits.every((edit) => source.slice(edit.from, edit.to) !== "direction")).toBe(true);
    expect(applyEdits(source, plan!.edits)).toContain("@Outer::RenamedArc.direction");
    expect(queryDslRenameTarget(snapshot(source), referenceStart + "@Outer::A.".length + 1)).toBeNull();
  });

  it("rejects semantic fallback renames that capture an ordinary reference", () => {
    const source = [
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "group Nested {",
      "  arc Taken = arc(center: (0, 0), radius: 20, start: 10, end: 90, direction: clockwise)",
      "  line Use = offset(sources: [@A], distance: 5, side: right, closed: false, suppressTrimWarnings: false)",
      "}",
      "const direction: choice(counterclockwise, clockwise) = @A.direction"
    ].join("\n");
    const referenceStart = at(source, "@A.direction");
    const result = planDslRenameEditsResult(snapshot(source), referenceStart + 1, "Taken");

    expect(result).toEqual({
      status: "rejected",
      rejection: {
        reason: "reference-resolution-change",
        family: "element",
        line: 5
      }
    });
  });

  it("starts element rename from derived endpoint geometry properties", () => {
    const source = [
      "nui 1",
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

  it("starts rename from layout and place numeric geometry properties", () => {
    const source = [
      "nui 1",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "group G {",
      "}",
      "layout Sheet(",
      "  scale: 1+@A.x,",
      ") {",
      "  place @G(",
      "    at: (3+@A.x, 4+@A.x),",
      "    angle: 5+@A.x,",
      "    mirror: false,",
      "  )",
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
      "nui 1",
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

  it("renames nominal record types, values, fields, and record Module parameters safely", () => {
    const source = [
      "nui 1",
      "record Pair(x: number, label: string)",
      "record Other(x: number, label: string)",
      'const input: Pair = Pair(x: 1, label: "root")',
      'const other: Other = Other(x: 2, label: "other")',
      "const alias: Pair = @input",
      "module Inner(input: Pair) {",
      "  const copy: Pair = @input",
      "  const member: number = @input.x",
      "  export const output: Pair = @copy",
      "}",
      "instance Use = Inner(@input)",
      "const exported: number = @Use::output.x"
    ].join("\n");
    const current = snapshot(source);

    const typePlan = planDslRenameEdits(current, at(source, "record Pair") + "record ".length, "Duo");
    expect(typePlan).not.toBeNull();
    expect(typePlan?.edits.every((edit) => source.slice(edit.from, edit.to) === "Pair")).toBe(true);
    expect(typePlan?.edits.some((edit) => source.slice(edit.from, edit.to) === "Other")).toBe(false);

    const valueReferenceOffset = source.indexOf("@input", source.indexOf("const alias")) + 1;
    const valuePlan = planDslRenameEdits(current, valueReferenceOffset, "config");
    expect(valuePlan).not.toBeNull();
    expect(valuePlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "input", "input", "@input"
    ]);
    expect(valuePlan?.edits.find((edit) => source.slice(edit.from, edit.to) === "@input")?.newText).toBe("input: @config");

    const fieldPlan = planDslRenameEdits(current, at(source, "x: number"), "amount");
    expect(fieldPlan).not.toBeNull();
    expect(fieldPlan?.edits.every((edit) => source.slice(edit.from, edit.to) === "x")).toBe(true);
    expect(fieldPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["x", "x", "x", "x"]);

    const parameterOffset = source.indexOf("input", source.indexOf("module Inner"));
    const parameterPlan = planDslRenameEdits(current, parameterOffset + 1, "source");
    expect(parameterPlan).not.toBeNull();
    const renamed = applyEdits(source, parameterPlan!.edits);
    expect(renamed).toContain("module Inner(source: Pair)");
    expect(renamed).toContain("@source.x");
    expect(renamed).toContain("Inner(source: @input)");

    expect(planDslRenameEditsResult(current, at(source, "record Pair") + "record ".length, "Other")).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "Other", conflictingLine: 3 }
    });
    expect(planDslRenameEditsResult(current, at(source, "x: number"), "label")).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "label", conflictingLine: 2 }
    });
  });

  it("fails closed for stale, fatal, unresolved, and module-iteration snapshots", () => {
    const source = ["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const stale = snapshot(source, 7);
    expect(queryDslRenameTarget({ ...stale, source: { ...stale.source, sourceRevision: 8 } }, 6)).toBeNull();
    expect(queryDslRenameTarget({
      ...stale,
      semantic: { ...stale.semantic!, sourceText: `${source} ` }
    }, 6)).toBeNull();

    const brokenSource = ["nui 1", "point A = offset(from: @Missing, dx: 1, dy: 0)"].join("\n");
    expect(queryDslRenameTarget(snapshot(brokenSource), at(brokenSource, "Missing"))).toBeNull();

    const iterationSource = [
      "nui 1",
      "for i in range(from: 0, count: 1) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    expect(planDslRenameEdits(snapshot(iterationSource), at(iterationSource, "i in") , "j")).toBeNull();
  });

  it("uses UTF-16 offsets when a surrogate pair precedes a Japanese identifier", () => {
    const source = [
      "nui 1",
      "// 😀",
      "point 前身頃 = coordinate(x: 0, y: 0)"
    ].join("\n");
    const offset = source.indexOf("前身頃");
    const target = queryDslRenameTarget(snapshot(source), offset + 1);
    expect(target?.range).toEqual({ from: offset, to: offset + "前身頃".length });
  });

  it("renames an ordinary source element in a document with materialized Module elements", () => {
    const source = [
      "nui 1",
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
      "nui 1",
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
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 0)",
      "module Measure(input: point) {",
      "  point P = offset(from: @input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: @A)"
    ].join("\n");

    const result = planDslRenameEditsResult(snapshot(source), at(source, "A ="), "B");

    expect(result).toEqual({
      status: "rejected",
      rejection: {
        reason: "same-scope-collision",
        conflictingName: "B",
        conflictingLine: 3
      }
    });
    expect(planDslRenameEdits(snapshot(source), at(source, "A ="), "B")).toBeNull();
  });

  it("returns a structured collision for an ordinary element without Module materialization", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 0)"
    ].join("\n");

    expect(planDslRenameEditsResult(snapshot(source), at(source, "A ="), "B")).toEqual({
      status: "rejected",
      rejection: {
        reason: "same-scope-collision",
        conflictingName: "B",
        conflictingLine: 3
      }
    });
  });

  it("returns a structured Module parameter collision", () => {
    const source = [
      "nui 1",
      "module Measure(width: number, length: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Call = Measure(width: 10, length: 20)"
    ].join("\n");

    expect(planDslRenameEditsResult(snapshot(source), at(source, "width: number"), "length")).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "length", conflictingLine: 2 }
    });
  });

  it("renames multiline layout/profile outputs and qualified placement paths", () => {
    const source = [
      "nui 1",
      "profile OutputProfile",
      "group Outer {",
      "  group Inner {",
      "    point Origin = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "layout Layout {",
      "  place @Outer::Inner(",
      "    origin: @Outer::Inner::Origin,",
      "    at: (0, 0),",
      "  )",
      "}",
      "print PrintOutput(",
      "  layout: @Layout,",
      "  profile: @OutputProfile,",
      "  paper: a4,",
      "  overlap: 0,",
      ")",
      "svg SvgOutput(",
      "  layout: @Layout,",
      "  profile: @OutputProfile,",
      ")"
    ].join("\n");

    const layoutDeclaration = source.indexOf("Layout") + 1;
    const layoutReference = source.indexOf("@Layout") + 1;
    const layoutSvgReference = source.indexOf("@Layout", layoutReference + 1) + 1;
    const layoutFromDeclaration = planDslRenameEdits(snapshot(source), layoutDeclaration, "RenamedLayout");
    const layoutFromPrint = planDslRenameEdits(snapshot(source), layoutReference, "RenamedLayout");
    const layoutFromSvg = planDslRenameEdits(snapshot(source), layoutSvgReference, "RenamedLayout");
    expect(layoutFromDeclaration).not.toBeNull();
    expect(layoutFromPrint?.edits).toEqual(layoutFromDeclaration?.edits);
    expect(layoutFromSvg?.edits).toEqual(layoutFromDeclaration?.edits);
    expect(layoutFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "Layout",
      "Layout",
      "Layout"
    ]);

    const profileDeclaration = source.indexOf("OutputProfile") + 1;
    const profileReference = source.indexOf("@OutputProfile") + 1;
    const profileSvgReference = source.indexOf("@OutputProfile", profileReference + 1) + 1;
    const profileFromDeclaration = planDslRenameEdits(snapshot(source), profileDeclaration, "RenamedProfile");
    const profileFromPrint = planDslRenameEdits(snapshot(source), profileReference, "RenamedProfile");
    const profileFromSvg = planDslRenameEdits(snapshot(source), profileSvgReference, "RenamedProfile");
    expect(profileFromDeclaration).not.toBeNull();
    expect(profileFromPrint?.edits).toEqual(profileFromDeclaration?.edits);
    expect(profileFromSvg?.edits).toEqual(profileFromDeclaration?.edits);
    expect(profileFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "OutputProfile",
      "OutputProfile",
      "OutputProfile"
    ]);

    const innerDeclaration = source.indexOf("Inner") + 1;
    const innerReference = source.indexOf("@Outer::Inner") + 1 + "Outer::".length;
    const innerOriginReference = source.indexOf("@Outer::Inner::Origin") + 1 + "Outer::".length;
    const innerFromDeclaration = planDslRenameEdits(snapshot(source), innerDeclaration, "RenamedInner");
    const innerFromTarget = planDslRenameEdits(snapshot(source), innerReference, "RenamedInner");
    const innerFromOrigin = planDslRenameEdits(snapshot(source), innerOriginReference, "RenamedInner");
    expect(innerFromDeclaration).not.toBeNull();
    expect(innerFromTarget?.edits).toEqual(innerFromDeclaration?.edits);
    expect(innerFromOrigin?.edits).toEqual(innerFromDeclaration?.edits);
    expect(innerFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "Inner",
      "Inner",
      "Inner"
    ]);

    const originDeclaration = source.indexOf("Origin") + 1;
    const originReference = source.indexOf("@Outer::Inner::Origin") + 1 + "Outer::Inner::".length;
    const originFromDeclaration = planDslRenameEdits(snapshot(source), originDeclaration, "RenamedOrigin");
    const originFromReference = planDslRenameEdits(snapshot(source), originReference, "RenamedOrigin");
    expect(originFromDeclaration).not.toBeNull();
    expect(originFromReference?.edits).toEqual(originFromDeclaration?.edits);
    expect(originFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Origin", "Origin"]);
  });

  it("renames print and SVG declarations and rejects same-scope source collisions", () => {
    const source = [
      "nui 1",
      "group Existing {",
      "}",
      "layout Layout {",
      "  place @Existing(at: (0, 0))",
      "}",
      "print PrintOutput(layout: @Layout, paper: a4, overlap: 0)",
      "svg SvgOutput(layout: @Layout)"
    ].join("\n");

    const printPlan = planDslRenameEdits(snapshot(source), source.indexOf("PrintOutput") + 1, "RenamedPrint");
    const svgPlan = planDslRenameEdits(snapshot(source), source.indexOf("SvgOutput") + 1, "RenamedSvg");
    expect(printPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["PrintOutput"]);
    expect(svgPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["SvgOutput"]);
    expect(planDslRenameEdits(snapshot(source), source.indexOf("Layout") + 1, "Existing")).toBeNull();
  });
});
