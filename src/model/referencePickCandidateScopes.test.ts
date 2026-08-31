import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { evaluateElements } from "../geometry/evaluate";
import { referencePickCandidates } from "./referencePickCandidates";

const REVISION = 52;

const compileSource = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-scope:${index}`]))
  });
};

const targetAt = (source: string, compiled: CompiledDslDocument, fragment: string) => {
  const from = source.indexOf(fragment);
  const at = fragment.indexOf("@");
  if (from < 0 || at < 0) throw new Error(`missing target fragment: ${fragment}`);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: REVISION },
    position: from + at + 2,
    semantic: { sourceRevision: REVISION, compiled }
  });
  if (!target) throw new Error(`no target for fragment: ${fragment}`);
  return target;
};

const evaluate = (compiled: CompiledDslDocument) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("fixture did not compile");
  return evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
};

const bases = (
  source: string,
  compiled: CompiledDslDocument,
  fragment: string
) => referencePickCandidates({
  compiled,
  evaluation: evaluate(compiled),
  target: targetAt(source, compiled, fragment)
}).flatMap((candidate) => candidate.options.map((option) => option.reference.base));

describe("referencePickCandidates source scope", () => {
  it("uses the shortest authored lexical path that resolves to the candidate", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "group G {",
      "  line In = segment(start: @A, end: @B)",
      "  line InnerUse = offset(sources: [@In], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "line OuterUse = offset(sources: [@G::In], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const compiled = compileSource(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    expect(bases(source, compiled, "sources: [@In]")).toContain("In");
    expect(bases(source, compiled, "sources: [@G::In]")).toContain("G::In");
  });

  it("projects a Source target onto each concrete parent instance for direct nested exports", () => {
    const source = [
      "nui 1",
      "module Child() {",
      "  export line Out = segment(start: (0, 0), end: (10, 0))",
      "}",
      "module Parent() {",
      "  instance C1 = Child()",
      "  line Use = offset(sources: [@C1::Out], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance P1 = Parent()",
      "instance P2 = Parent()"
    ].join("\n");
    const compiled = compileSource(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const references = bases(source, compiled, "sources: [@C1::Out]");
    expect(references.filter((base) => base === "C1::Out")).toHaveLength(2);
    expect(references.some((base) => base.includes("P1"))).toBe(false);
    expect(references.some((base) => base.includes("P2"))).toBe(false);
  });
});
