import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslSourceValueStep } from "./dslSourceValueStepQuery";

const compile = (source: string, revision = 1) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: revision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `source-step:${index}`]))
  });
};

const query = (
  source: string,
  token: string,
  direction: 1 | -1 = 1,
  selection: "caret" | "after" | "exact" | "partial" = "caret",
  occurrence = 0,
  revision = 1
) => {
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = source.indexOf(token, from);
    from = start + 1;
  }
  expect(start).toBeGreaterThanOrEqual(0);
  const span = selection === "after"
    ? { start: start + token.length, end: start + token.length }
    : selection === "exact"
      ? { start, end: start + token.length }
      : selection === "partial"
        ? { start, end: start + Math.max(1, token.length - 1) }
        : { start, end: start };
  return queryDslSourceValueStep({
    source: { normalizedSource: source, sourceRevision: revision },
    semantic: { sourceRevision: revision, compiled: compile(source, revision) },
    selections: [span],
    direction
  });
};

describe("DSL Source Value Step query", () => {
  it("steps exact element literals in single- and multi-line statements", () => {
    const single = ["nui 1", "point A = coordinate(x: 1.5, y: 0)"].join("\n");
    expect(query(single, "1.5")).toMatchObject({
      edit: { expectedText: "1.5", newText: "2.5" }
    });

    const multiline = [
      "nui 1",
      "point A = coordinate(",
      "  x: 1 + 2,",
      "  y: 0",
      ")"
    ].join("\n");
    const plan = query(multiline, "2");
    expect(plan).toMatchObject({ edit: { expectedText: "2", newText: "3" } });
    expect(plan?.edit.from).toBe(multiline.indexOf("2"));
  });

  it("steps typed declarations and set RHS values through compiler binding identity", () => {
    const source = [
      "nui 1",
      "let count: number(step: 0.5) = 1.50",
      "let flag: boolean = true",
      "let side: choice(right, left) = right",
      "set count = 2.00"
    ].join("\n");
    expect(query(source, "1.50")).toMatchObject({ edit: { newText: "2" } });
    expect(query(source, "true")).toMatchObject({ edit: { newText: "false" } });
    expect(query(source, "right", 1, "caret", 1)).toMatchObject({ edit: { newText: "left" } });
    expect(query(source, "2.00")).toMatchObject({ edit: { newText: "2.5" } });
  });

  it("steps only current split modifier tokens and leaves fixed colors non-steppable", () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "  width: 1.5px,",
      "  style: solid,",
      "  color: foreground",
      "}",
      "modifier Fixed {",
      "  color: #336699",
      "}"
    ].join("\n");
    expect(query(source, "visible")).toMatchObject({ edit: { newText: "hidden" } });
    expect(query(source, "1.5")).toMatchObject({ edit: { expectedText: "1.5", newText: "1.6" } });
    expect(query(source, "solid", -1)).toMatchObject({ edit: { newText: "dotted" } });
    expect(query(source, "foreground", -1)).toMatchObject({ edit: { newText: "error" } });
    expect(query(source, "#336699")).toBeNull();
    const unit = source.indexOf("px") + 1;
    expect(queryDslSourceValueStep({
      source: { normalizedSource: source, sourceRevision: 1 },
      semantic: { sourceRevision: 1, compiled: compile(source) },
      selections: [{ start: unit, end: unit }],
      direction: 1
    })).toBeNull();
  });

  it("accepts an after-value caret or exact selection and rejects partial or multiple selections", () => {
    const source = ["nui 1", "let flag: boolean = true"].join("\n");
    expect(query(source, "true", 1, "after")).toMatchObject({ edit: { newText: "false" } });
    expect(query(source, "true", 1, "exact")).toMatchObject({ edit: { newText: "false" } });
    expect(query(source, "true", 1, "partial")).toBeNull();
    const position = source.indexOf("true");
    expect(queryDslSourceValueStep({
      source: { normalizedSource: source, sourceRevision: 1 },
      semantic: { sourceRevision: 1, compiled: compile(source) },
      selections: [{ start: position, end: position }, { start: position, end: position }],
      direction: 1
    })).toBeNull();
  });

  it("fails closed for stale semantics but not for an unrelated current diagnostic", () => {
    const source = [
      "nui 1",
      "modifier Guide {",
      "  style: solid",
      "}",
      "point Broken = coordinate(x: nope, y: 0)"
    ].join("\n");
    expect(query(source, "solid")).toMatchObject({ edit: { newText: "dashed" } });
    const position = source.indexOf("solid");
    expect(queryDslSourceValueStep({
      source: { normalizedSource: source, sourceRevision: 2 },
      semantic: { sourceRevision: 1, compiled: compile(source, 1) },
      selections: [{ start: position, end: position }],
      direction: 1
    })).toBeNull();

    const elementSource = [
      "nui 1",
      "point A = coordinate(x: 1, y: 0)",
      "point Broken = coordinate(x: nope, y: 0)"
    ].join("\n");
    expect(query(elementSource, "1", 1, "caret", 1)).toMatchObject({ edit: { newText: "2" } });
  });
});
