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
});
