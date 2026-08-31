import { describe, expect, it, vi } from "vitest";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { LineSplice } from "./textPatch";
import {
  analyzeDrawingModifierAssignmentTarget,
  applyDrawingModifierBatchAssignment,
  planDrawingModifierBatchAssignment,
  type DrawingModifierBatchPlanInput,
  type DrawingModifierSourceTarget
} from "./drawingModifierBatchAssignment";

const sourceLines = (...lines: string[]) => lines.join("\n");

const snapshotFor = (source: string, sourceRevision = 17): SourceSnapshot => ({
  normalizedSource: source,
  sourceRevision
});

const setup = (source: string, sourceRevision = 17) => {
  const sourceSnapshot = snapshotFor(source, sourceRevision);
  const parsed = parseDslSnapshot(sourceSnapshot);
  const target = (name: string): DrawingModifierSourceTarget => {
    const sourceStatementIndex = parsed.statements.findIndex((statement) => statement.name === name);
    if (sourceStatementIndex < 0) throw new Error(`missing statement ${name}`);
    return { sourceStatementIndex, sourceRevision };
  };
  return { source: sourceSnapshot, parsed, target };
};

const applyLineSplices = (source: string, splices: readonly LineSplice[]) => {
  const lines = source.split("\n");
  for (const splice of [...splices].sort((left, right) => right.startLine - left.startLine)) {
    const deleteCount = splice.endLine >= splice.startLine
      ? splice.endLine - splice.startLine + 1
      : 0;
    lines.splice(splice.startLine - 1, deleteCount, ...splice.replacementLines);
  }
  return lines.join("\n");
};

const planAndApply = (input: DrawingModifierBatchPlanInput) => {
  const result = planDrawingModifierBatchAssignment(input);
  if (!result.ok) throw new Error(`unexpected plan failure: ${result.reason}`);
  return {
    result,
    source: applyLineSplices(input.source.normalizedSource, result.plan.splices)
  };
};

const modifierNamesFor = (source: string, name: string) => {
  const parsed = parseDslSnapshot(snapshotFor(source, 91));
  return parsed.statements.find((statement) => statement.name === name)?.modifierNames;
};

describe("drawing modifier batch assignment", () => {
  it("adds one quoted modifier reference using existing DSL name formatting", () => {
    const source = sourceLines(
      "nui 1",
      "modifier \"review guide\" {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)"
    );
    const current = setup(source);
    const applied = planAndApply({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("A")],
      operation: { kind: "add", modifierName: "review guide" }
    });

    expect(applied.source).toContain("point A [\"review guide\"] = coordinate(x: 0, y: 0)");
    expect(modifierNamesFor(applied.source, "A")).toEqual(["review guide"]);
    expect(applied.result.plan.changedTargetCount).toBe(1);
  });

  it("batch-adds geometry and group targets, preserves order, dedupes targets, and is idempotent", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Base {",
      "  state: visible,",
      "}",
      "modifier Guide {",
      "  state: hidden,",
      "}",
      "point A [Base] = coordinate(x: 0, y: 0)",
      "line L [Base, Guide] = segment(start: @A, end: @A)",
      "group G {",
      "}"
    );
    const current = setup(source);
    const applied = planAndApply({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("A"), current.target("L"), current.target("G"), current.target("A")],
      operation: { kind: "add", modifierName: "Guide" }
    });

    expect(modifierNamesFor(applied.source, "A")).toEqual(["Base", "Guide"]);
    expect(modifierNamesFor(applied.source, "L")).toEqual(["Base", "Guide"]);
    expect(modifierNamesFor(applied.source, "G")).toEqual(["Guide"]);
    expect(applied.result.plan.targetCount).toBe(3);
    expect(applied.result.plan.changedTargetCount).toBe(2);
  });

  it("removes every duplicate direct reference while preserving other modifier order", () => {
    const source = sourceLines(
      "nui 1",
      "modifier A {",
      "  state: visible,",
      "}",
      "modifier B {",
      "  state: visible,",
      "}",
      "modifier C {",
      "  state: visible,",
      "}",
      "point P [A, B, A, C] = coordinate(x: 0, y: 0)"
    );
    const current = setup(source);
    const applied = planAndApply({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("P")],
      operation: { kind: "remove", modifierName: "A" }
    });

    expect(modifierNamesFor(applied.source, "P")).toEqual(["B", "C"]);
  });

  it("removes undefined direct references without requiring a modifier definition", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Keep {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "group G [Missing, Keep] {",
      "}"
    );
    const current = setup(source);
    const applied = planAndApply({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("G")],
      operation: { kind: "remove", modifierName: "Missing" }
    });

    expect(modifierNamesFor(applied.source, "G")).toEqual(["Keep"]);
  });

  it("supports authored Module-body geometry without materialization semantics", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "module M() {",
      "  point Internal = coordinate(x: 0, y: 0)",
      "}",
      "instance Use = M()"
    );
    const current = setup(source);
    const applied = planAndApply({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("Internal")],
      operation: { kind: "add", modifierName: "Guide" }
    });

    expect(modifierNamesFor(applied.source, "Internal")).toEqual(["Guide"]);
  });

  it("preserves multiline layout and comments while editing only modifier tokens and delimiters", () => {
    const source = sourceLines(
      "nui 1",
      "modifier A {",
      "  state: visible,",
      "}",
      "modifier B {",
      "  state: visible,",
      "}",
      "modifier C {",
      "  state: visible,",
      "}",
      "point P = coordinate(x: 0, y: 0)",
      "line L [",
      "  A, /* keep modifier comment */",
      "  B",
      "] = segment(",
      "  start: @P, // keep argument comment",
      "  end: @P",
      ")"
    );
    const current = setup(source);
    const withC = planAndApply({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("L")],
      operation: { kind: "add", modifierName: "C" }
    }).source;

    expect(withC).toContain("  A, /* keep modifier comment */\n  B, C\n] = segment(");
    expect(withC).toContain("  start: @P, // keep argument comment\n  end: @P");

    const afterAdd = setup(withC, 18);
    const withoutA = planAndApply({
      source: afterAdd.source,
      parsed: afterAdd.parsed,
      targets: [afterAdd.target("L")],
      operation: { kind: "remove", modifierName: "A" }
    }).source;
    expect(withoutA).toContain("   /* keep modifier comment */\n  B, C\n] = segment(");
    expect(withoutA).toContain("  start: @P, // keep argument comment\n  end: @P");
    expect(modifierNamesFor(withoutA, "L")).toEqual(["B", "C"]);
  });

  it("returns no mutation for an all-noop batch", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "point A [Guide] = coordinate(x: 0, y: 0)",
      "group G [Guide] {",
      "}"
    );
    const current = setup(source);
    const commit = vi.fn();
    const result = applyDrawingModifierBatchAssignment({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("A"), current.target("G")],
      operation: { kind: "add", modifierName: "Guide" }
    }, commit);

    expect(result).toEqual({
      ok: true,
      plan: { splices: [], targetCount: 2, changedTargetCount: 0 }
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects undefined and ambiguous add definitions", () => {
    const undefinedSource = sourceLines("nui 1", "point A = coordinate(x: 0, y: 0)");
    const undefinedCurrent = setup(undefinedSource);
    expect(planDrawingModifierBatchAssignment({
      source: undefinedCurrent.source,
      parsed: undefinedCurrent.parsed,
      targets: [undefinedCurrent.target("A")],
      operation: { kind: "add", modifierName: "Missing" }
    })).toEqual({ ok: false, reason: "modifier-undefined" });

    const ambiguousSource = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "modifier Guide {",
      "  state: hidden,",
      "}",
      "point A = coordinate(x: 0, y: 0)"
    );
    const ambiguousCurrent = setup(ambiguousSource);
    expect(planDrawingModifierBatchAssignment({
      source: ambiguousCurrent.source,
      parsed: ambiguousCurrent.parsed,
      targets: [ambiguousCurrent.target("A")],
      operation: { kind: "add", modifierName: "Guide" }
    })).toEqual({ ok: false, reason: "modifier-ambiguous" });
  });

  it("does not treat a nested modifier definition as a document-level add target", () => {
    const source = sourceLines(
      "nui 1",
      "group Outer {",
      "  modifier Nested {",
      "    state: visible,",
      "  }",
      "}",
      "point A = coordinate(x: 0, y: 0)"
    );
    const current = setup(source);
    expect(planDrawingModifierBatchAssignment({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("A")],
      operation: { kind: "add", modifierName: "Nested" }
    })).toEqual({ ok: false, reason: "modifier-undefined" });
  });

  it("fails closed for an ineligible target without committing an earlier eligible edit", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "const width: number = 10"
    );
    const current = setup(source);
    const typedIndex = current.parsed.statements.findIndex((statement) => statement.kind === "typedDeclaration");
    const typedTarget = { sourceStatementIndex: typedIndex, sourceRevision: current.source.sourceRevision };
    const commit = vi.fn();
    const result = applyDrawingModifierBatchAssignment({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("A"), typedTarget],
      operation: { kind: "add", modifierName: "Guide" }
    }, commit);

    expect(result).toEqual({ ok: false, reason: "ineligible-target", target: typedTarget });
    expect(commit).not.toHaveBeenCalled();
  });

  it("fails closed for stale target identity or mismatched current parse", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)"
    );
    const current = setup(source);
    const staleTarget = { ...current.target("A"), sourceRevision: 16 };
    expect(planDrawingModifierBatchAssignment({
      source: current.source,
      parsed: current.parsed,
      targets: [staleTarget],
      operation: { kind: "add", modifierName: "Guide" }
    })).toEqual({ ok: false, reason: "stale-target", target: staleTarget });

    expect(planDrawingModifierBatchAssignment({
      source: { ...current.source, normalizedSource: `${source}\n` },
      parsed: current.parsed,
      targets: [current.target("A")],
      operation: { kind: "add", modifierName: "Guide" }
    })).toEqual({ ok: false, reason: "invalid-source-snapshot" });
  });

  it("applies one multi-target batch through exactly one source transaction callback", () => {
    const source = sourceLines(
      "nui 1",
      "modifier Guide {",
      "  state: visible,",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)"
    );
    const current = setup(source);
    const commit = vi.fn();
    const result = applyDrawingModifierBatchAssignment({
      source: current.source,
      parsed: current.parsed,
      targets: [current.target("A"), current.target("B")],
      operation: { kind: "add", modifierName: "Guide" }
    }, commit);

    expect(result.ok).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("exposes pure eligibility without UI-specific target lists", () => {
    const source = sourceLines(
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "group G {",
      "}",
      "const width: number = 10"
    );
    const current = setup(source);
    const point = current.parsed.statements.find((statement) => statement.name === "A")!;
    const group = current.parsed.statements.find((statement) => statement.name === "G")!;
    const typed = current.parsed.statements.find((statement) => statement.kind === "typedDeclaration")!;

    expect(analyzeDrawingModifierAssignmentTarget(point)).toEqual({ eligible: true });
    expect(analyzeDrawingModifierAssignmentTarget(group)).toEqual({ eligible: true });
    expect(analyzeDrawingModifierAssignmentTarget(typed)).toEqual({
      eligible: false,
      reason: "unsupported-statement-kind"
    });
  });
});
