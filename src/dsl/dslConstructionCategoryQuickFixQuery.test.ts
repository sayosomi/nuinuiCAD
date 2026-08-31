import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  queryDslConstructionCategoryQuickFixes
} from "./dslConstructionCategoryQuickFixQuery";
import type { DslDiagnostic } from "./dslTypes";

const SOURCE_REVISION = 41;

const compileWithIds = (source: string, sourceRevision = SOURCE_REVISION): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `category-query-test:${index}`]))
  });
};

const mismatchFor = (compiled: CompiledDslDocument): DslDiagnostic => {
  const diagnostic = compiled.diagnostics.find((item) => item.code === "construction-category-mismatch");
  expect(diagnostic).toBeDefined();
  return diagnostic!;
};

const queryFor = (source: string) => {
  const compiled = compileWithIds(source);
  const diagnostic = mismatchFor(compiled);
  const result = queryDslConstructionCategoryQuickFixes({
    source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
    diagnostic,
    semantic: { sourceRevision: SOURCE_REVISION, compiled }
  });
  return { compiled, diagnostic, result };
};

describe("queryDslConstructionCategoryQuickFixes", () => {
  it("repairs only the category token for a known construction mismatch", () => {
    const source = "nui 1\npoint P = segment(start: @A, end: @B)";
    const { diagnostic, result } = queryFor(source);

    expect(diagnostic.exactSpanOnly).toBe(true);
    expect(source.slice(
      diagnostic.physicalSpan!.segments[0]!.from,
      diagnostic.physicalSpan!.segments[0]!.to
    )).toBe("segment");
    expect(result).toEqual([{
      targetCategory: "line",
      edit: {
        from: source.indexOf("point"),
        to: source.indexOf("point") + "point".length,
        expectedText: "point",
        newText: "line"
      }
    }]);

    const plan = result[0]!;
    expect(`${source.slice(0, plan.edit.from)}${plan.edit.newText}${source.slice(plan.edit.to)}`).toBe(
      "nui 1\nline P = segment(start: @A, end: @B)"
    );
  });

  it("returns all canonical categories in registry order without rewriting arguments", () => {
    const source = "nui 1\narc P = offset(sources: [@A], distance: 2)";
    const { result } = queryFor(source);

    expect(result.map((plan) => plan.targetCategory)).toEqual(["point", "line"]);
    expect(result.map((plan) => plan.edit.newText)).toEqual(["point", "line"]);
    expect(result.every((plan) => plan.edit.from === source.indexOf("arc"))).toBe(true);
    expect(result.every((plan) => plan.edit.to === source.indexOf("arc") + "arc".length)).toBe(true);
    expect(result.every((plan) => plan.edit.expectedText === "arc")).toBe(true);
  });

  it.each([
    ["stale source revision", (source: string, diagnostic: DslDiagnostic, compiled: CompiledDslDocument) => ({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION + 1 },
      diagnostic,
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })],
    ["stale source text", (source: string, diagnostic: DslDiagnostic, compiled: CompiledDslDocument) => ({
      source: { normalizedSource: `${source}\n`, sourceRevision: SOURCE_REVISION },
      diagnostic,
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })],
    ["wrong diagnostic code", (source: string, diagnostic: DslDiagnostic, compiled: CompiledDslDocument) => ({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
      diagnostic: { ...diagnostic, code: "unknown-construction" },
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })],
    ["missing exact span", (source: string, diagnostic: DslDiagnostic, compiled: CompiledDslDocument) => ({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
      diagnostic: { ...diagnostic, exactSpanOnly: undefined },
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })],
    ["missing physical proof", (source: string, diagnostic: DslDiagnostic, compiled: CompiledDslDocument) => ({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
      diagnostic: { ...diagnostic, physicalSpan: undefined },
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })],
    ["multi-segment physical proof", (source: string, diagnostic: DslDiagnostic, compiled: CompiledDslDocument) => ({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
      diagnostic: {
        ...diagnostic,
        physicalSpan: {
          sourceRevision: SOURCE_REVISION,
          segments: [diagnostic.physicalSpan!.segments[0]!, diagnostic.physicalSpan!.segments[0]!]
        }
      },
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })]
  ])("fails closed for %s", (_name, inputFor) => {
    const source = "nui 1\npoint P = segment(start: @A, end: @B)";
    const { diagnostic, compiled } = queryFor(source);
    expect(queryDslConstructionCategoryQuickFixes(inputFor(source, diagnostic, compiled))).toEqual([]);
  });

  it("fails closed when the semantic statement no longer proves the diagnosed construction", () => {
    const source = "nui 1\npoint P = segment(start: @A, end: @B)";
    const { diagnostic, compiled } = queryFor(source);
    const statement = compiled.statements.find((item) => item.kind === "element");
    expect(statement).toBeDefined();

    const changedStatements = compiled.statements.map((item) =>
      item === statement && item.kind === "element"
        ? { ...item, construction: "offset" }
        : item
    );
    expect(queryDslConstructionCategoryQuickFixes({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
      diagnostic,
      semantic: {
        sourceRevision: SOURCE_REVISION,
        compiled: { ...compiled, statements: changedStatements }
      }
    })).toEqual([]);
  });
});
