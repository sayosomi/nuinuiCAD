import { describe, expect, it } from "vitest";
import { compileDslDocument, resolveSourceLexicalPath, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
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
  if (from < 0) throw new Error(`missing target fragment: ${fragment}`);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: REVISION },
    position: from + "sources: [".length,
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
      "  line In = segment(start: A, end: B)",
      "  line InnerUse = offset(sources: [In], distance: 1, side: @left, closed: false, suppressTrimWarnings: false)",
      "}",
      "line OuterUse = offset(sources: [G::In], distance: 1, side: @left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const compiled = compileSource(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    expect(bases(source, compiled, "sources: [In]")).toContain("In");
    expect(bases(source, compiled, "sources: [G::In]")).toContain("G::In");
  });

  it("projects a Source target onto each concrete parent instance for direct nested exports", () => {
    const source = [
      "nui 1",
      "module Child() {",
      "  export line Out = segment(start: (0, 0), end: (10, 0))",
      "}",
      "module Parent() {",
      "  instance C1 = Child()",
      "  line Use = offset(sources: [C1::Out], distance: 1, side: @left, closed: false, suppressTrimWarnings: false)",
      "}",
      "instance P1 = Parent()",
      "instance P2 = Parent()"
    ].join("\n");
    const compiled = compileSource(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const references = bases(source, compiled, "sources: [C1::Out]");
    expect(references.filter((base) => base === "C1::Out")).toHaveLength(2);
    expect(references.some((base) => base.includes("P1"))).toBe(false);
    expect(references.some((base) => base.includes("P2"))).toBe(false);
  });
});

it("Browse proves root Module exports and grouped lexical paths without a destination", () => {
  const source = `nui 1
module M() {
 export line Public = segment(start: (0,0), end: (20,0))
 line Private = segment(start: (0,10), end: (20,10))
}
instance X = M()
group G {
 line In = segment(start: (0,20), end: (20,20))
}`;
  const compiled = compileSource(source);
  expect(compiled.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  const candidates = referencePickCandidates({ compiled, evaluation: evaluate(compiled), target: null });
  const names = candidates.flatMap(c => c.options.map(o => o.reference.base));
  expect(names).toEqual(expect.arrayContaining(['X::Public', 'G::In']));
  expect(names.some(n => n.includes('Private'))).toBe(false);
});

it("Browse qualifies group-local Module exports and preserves target-bound relative paths", () => {
  const source = [
    "nui 1",
    "module M() {",
    "  export line Out = segment(start: (0, 0), end: (20, 0))",
    "  line Private = segment(start: (0, 10), end: (20, 10))",
    "}",
    "instance Root = M()",
    "group G1 {",
    "  instance I = M()",
    "  const Proof: line = I::Out",
    "  line Use = offset(sources: [I::Out], distance: 1, side: @left, closed: false, suppressTrimWarnings: false)",
    "  line Ordinary = segment(start: (0, 30), end: (20, 30))",
    "}",
    "group G2 {",
    "  instance I = M()",
    "  line Ordinary = segment(start: (0, 40), end: (20, 40))",
    "}",
    "instance Hidden(visible: false) = M()",
    "instance Disabled(enabled: false) = M()"
  ].join("\n");
  const compiled = compileSource(source);
  expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  const evaluation = evaluate(compiled);
  expect(evaluation.errors).toEqual([]);
  const candidates = referencePickCandidates({ compiled, evaluation, target: null });
  const names = candidates.flatMap(candidate => candidate.options.map(option => option.reference.base));

  expect(names).toContain("Root::Out");
  expect(names).toContain("G1::I::Out");
  expect(names).toContain("G2::I::Out");
  expect(names).not.toContain("I::Out");
  expect(names).toContain("G1::Ordinary");
  expect(names).toContain("G2::Ordinary");
  expect(names.some(name => name.includes("Private"))).toBe(false);
  expect(names).not.toContain("Hidden::Out");
  expect(names).not.toContain("Disabled::Out");

  const candidateFor = (base: string) => candidates.find(candidate =>
    candidate.options.some(option => option.reference.base === base)
  );
  const g1 = candidateFor("G1::I::Out");
  const g2 = candidateFor("G2::I::Out");
  const root = candidateFor("Root::Out");
  expect(g1).toBeDefined();
  expect(g2).toBeDefined();
  expect(root).toBeDefined();
  if (!g1 || !g2 || !root || !compiled.moduleMaterialization || !compiled.sourceLexicalNamespace) return;

  const declarationIdFor = (segments: string[]) => {
    const resolved = resolveSourceLexicalPath(compiled.sourceLexicalNamespace!, 0, { absolute: false, segments });
    expect(resolved.kind).toBe("resolved");
    return resolved.kind === "resolved" ? resolved.declaration.statementId : null;
  };
  const g1InstanceId = declarationIdFor(["G1", "I"]);
  const g2InstanceId = declarationIdFor(["G2", "I"]);
  const rootInstanceId = declarationIdFor(["Root"]);
  expect(g1InstanceId).not.toBeNull();
  expect(g2InstanceId).not.toBeNull();
  expect(rootInstanceId).not.toBeNull();
  expect(compiled.moduleMaterialization.originByRuntimeElementId.get(g1.elementId)?.instancePath.at(-1)).toBe(g1InstanceId);
  expect(compiled.moduleMaterialization.originByRuntimeElementId.get(g2.elementId)?.instancePath.at(-1)).toBe(g2InstanceId);
  expect(compiled.moduleMaterialization.originByRuntimeElementId.get(root.elementId)?.instancePath.at(-1)).toBe(rootInstanceId);
  expect(g1.elementId).not.toBe(g2.elementId);
  expect(g1.options).toContainEqual(expect.objectContaining({ reference: { base: "G1::I::Out", pointKey: "end" } }));

  expect(bases(source, compiled, "sources: [I::Out]")).toContain("I::Out");
});
