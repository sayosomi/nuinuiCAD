import { describe, expect, it, vi } from "vitest";
import * as dslDocument from "../../packages/nui-language/src/dsl/dslDocument";
import { compileDslDocument, type CompiledDslDocument } from "../../packages/nui-language/src/dsl/dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  planDslGeometryReferenceRetargetEditsResult,
  queryDslGeometryReferenceRetargetTarget,
  type DslGeometryReferenceRetargetCandidate,
  type DslGeometryReferenceRetargetSnapshot
} from "../../packages/nui-language/src/dsl/dslGeometryReferenceRetargetQuery";

const REVISION = 29;

const compileWithIds = (source: string, sourceRevision = REVISION): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `retarget-test:${index}`]))
  });
};

const snapshotFor = (source: string, sourceRevision = REVISION, compiled = compileWithIds(source, sourceRevision)): DslGeometryReferenceRetargetSnapshot => ({
  source: { normalizedSource: source, sourceRevision },
  semantic: { sourceRevision, sourceText: source, compiled }
});

const targetAt = (source: string, token: string, occurrence = 0) => {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(token, offset + 1);
  if (offset < 0) throw new Error(`missing token ${token} occurrence ${occurrence}`);
  return queryDslGeometryReferenceRetargetTarget(snapshotFor(source), offset + token.length);
};

const candidateNamed = (target: NonNullable<ReturnType<typeof targetAt>>, name: string): DslGeometryReferenceRetargetCandidate => {
  const candidate = target.candidates.find((entry) => entry.name === name);
  if (!candidate) throw new Error(`missing candidate ${name}`);
  return candidate;
};

const planFor = (source: string, token: string, candidateName: string, occurrence = 0) => {
  const target = targetAt(source, token, occurrence);
  expect(target).not.toBeNull();
  const candidate = candidateNamed(target!, candidateName);
  return planDslGeometryReferenceRetargetEditsResult(snapshotFor(source), source.indexOf(token, occurrence === 0 ? 0 : source.indexOf(token) + 1) + token.length, candidate.identity);
};

describe("queryDslGeometryReferenceRetargetTarget", () => {
  it("resolves a reference occurrence but never a definition, comment, or string", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "text Label = label(text: \"@A\", anchor: @A, size: 1)",
      "// @A"
    ].join("\n");
    const snapshot = snapshotFor(source);

    expect(queryDslGeometryReferenceRetargetTarget(snapshot, source.indexOf("point A") + "point ".length + 1)).toBeNull();
    expect(queryDslGeometryReferenceRetargetTarget(snapshot, source.indexOf('"@A"') + 2)).toBeNull();
    expect(queryDslGeometryReferenceRetargetTarget(snapshot, source.lastIndexOf("// @A") + 4)).toBeNull();
    expect(queryDslGeometryReferenceRetargetTarget(snapshot, source.indexOf("@A", source.indexOf("point B")) + 1)).not.toBeNull();
  });

  it("uses semantic identity, excluding a same-name shadow and the declaration", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "group Inner {",
      "  point A = coordinate(x: 10, y: 0)",
      "  point InnerUse = offset(from: @A, dx: 1, dy: 0)",
      "}",
      "point B = coordinate(x: 20, y: 0)",
      "point RootUse = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const rootReference = source.lastIndexOf("@A");
    const target = queryDslGeometryReferenceRetargetTarget(snapshotFor(source), rootReference + 1);

    expect(target).not.toBeNull();
    expect(target!.occurrences).toHaveLength(1);
    expect(source.slice(target!.occurrences[0]!.semanticRange.from, target!.occurrences[0]!.semanticRange.to)).toBe("A");
    expect(source.slice(target!.declarationRange.from, target!.declarationRange.to)).toBe("A");
    expect(target!.candidates.map((candidate) => candidate.name)).toContain("B");
  });

  it("retargets ordinary point references and leaves the declaration text untouched", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "point Use = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const result = planFor(source, "@A", "B");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.edits).toEqual([{
      from: source.indexOf("@A") + 1,
      to: source.indexOf("@A") + 2,
      expectedText: "A",
      newText: "B"
    }]);
    expect(result.plan.proposedSource).toContain("point A = coordinate(x: 0, y: 0)");
    expect(result.plan.proposedSource).toContain("from: @B");
  });

  it("retargets path references and preserves a numeric property suffix", () => {
    const pathSource = [
      "nui 1",
      "point P = coordinate(x: 0, y: 0)",
      "point Q = coordinate(x: 20, y: 0)",
      "line A = segment(start: @P, end: @Q)",
      "line B = segment(start: @Q, end: @P)",
      "line Use = offset(sources: [@A], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const pathResult = planFor(pathSource, "@A", "B");
    expect(pathResult.status).toBe("ok");
    if (pathResult.status === "ok") expect(pathResult.plan.proposedSource).toContain("sources: [@B]");

    const numericSource = [
      "nui 1",
      "point P = coordinate(x: 0, y: 0)",
      "point Q = coordinate(x: 20, y: 0)",
      "line A = segment(start: @P, end: @Q)",
      "line B = segment(start: @Q, end: @P)",
      "point Use = offset(from: @P, dx: @A.length, dy: 0)"
    ].join("\n");
    const numericResult = planFor(numericSource, "@A", "B");
    expect(numericResult.status).toBe("ok");
    if (numericResult.status === "ok") {
      expect(numericResult.plan.proposedSource).toContain("dx: @B.length");
      expect(numericResult.plan.edits[0]!.expectedText).toBe("A");
      expect(numericResult.plan.edits[0]!.newText).toBe("B");
    }
  });

  it("qualifies a replacement when required and keeps same-scope replacements short", () => {
    const qualifiedSource = [
      "nui 1",
      "group Outer {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "group Other {",
      "  point B = coordinate(x: 20, y: 0)",
      "}",
      "point Use = offset(from: @Outer::A, dx: 1, dy: 0)"
    ].join("\n");
    const qualifiedTarget = targetAt(qualifiedSource, "@Outer::A");
    expect(qualifiedTarget).not.toBeNull();
    const qualified = candidateNamed(qualifiedTarget!, "B");
    expect(qualified.referencePaths).toEqual(["Other::B"]);
    const qualifiedPlan = planDslGeometryReferenceRetargetEditsResult(
      snapshotFor(qualifiedSource),
      qualifiedSource.indexOf("@Outer::A") + "@Outer::A".length,
      qualified.identity
    );
    expect(qualifiedPlan.status).toBe("ok");
    if (qualifiedPlan.status === "ok") {
      expect(qualifiedPlan.plan.proposedSource).toContain("from: @Other::B");
      expect(qualifiedPlan.plan.edits[0]).toMatchObject({ expectedText: "Outer::A", newText: "Other::B" });
    }

    const sameScopeSource = [
      "nui 1",
      "group G {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 20, y: 0)",
      "  point Use = offset(from: @A, dx: 1, dy: 0)",
      "}"
    ].join("\n");
    const sameScopeTarget = targetAt(sameScopeSource, "@A");
    expect(sameScopeTarget).not.toBeNull();
    expect(candidateNamed(sameScopeTarget!, "B").referencePaths).toEqual(["B"]);
  });

  it("retargets a qualified Module export through an existing instance alias", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "  point Q = coordinate(x: 20, y: 0)",
      "  export line A = segment(start: @P, end: @Q)",
      "  export line B = segment(start: @Q, end: @P)",
      "}",
      "instance I = M()",
      "line Use = offset(sources: [@I::A], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const target = targetAt(source, "@I::A");
    expect(target).not.toBeNull();
    const candidate = candidateNamed(target!, "B");
    expect(candidate.referencePaths).toEqual(["I::B"]);
    const result = planDslGeometryReferenceRetargetEditsResult(snapshotFor(source), source.indexOf("@I::A") + "@I::A".length, candidate.identity);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.plan.proposedSource).toContain("sources: [@I::B]");
  });

  it("requires one candidate to be reachable and compatible at every occurrence", () => {
    const source = [
      "nui 1",
      "point P = coordinate(x: 0, y: 0)",
      "point Q = coordinate(x: 20, y: 0)",
      "line A = segment(start: @P, end: @Q)",
      "point B = coordinate(x: 30, y: 0)",
      "line PathUse = offset(sources: [@A], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "point PointUse = onLine(from: @A.start, distance: 1)"
    ].join("\n");
    const target = targetAt(source, "@A");
    expect(target).not.toBeNull();
    expect(target!.occurrences).toHaveLength(2);
    expect(target!.candidates.some((candidate) => candidate.name === "B")).toBe(false);
  });

  it("rejects a candidate made unavailable by source order or scope", () => {
    const forwardSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @A, dx: 1, dy: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    expect(targetAt(forwardSource, "@A")!.candidates.some((candidate) => candidate.name === "B")).toBe(false);

    const scopeSource = [
      "nui 1",
      "module M(a: point) {",
      "  point Use = offset(from: @a, dx: 1, dy: 0)",
      "}",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const scopeReference = scopeSource.indexOf("@a");
    const scopeTarget = queryDslGeometryReferenceRetargetTarget(snapshotFor(scopeSource), scopeReference + 1);
    expect(scopeTarget).not.toBeNull();
    expect(scopeTarget!.candidates.some((candidate) => candidate.name === "B")).toBe(false);
  });

  it("excludes a disabled geometry candidate from current compiler availability", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0, state: disabled)",
      "point C = coordinate(x: 20, y: 0)",
      "point Use = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const target = targetAt(source, "@A");

    expect(target).not.toBeNull();
    expect(target!.candidates.map((candidate) => candidate.name)).toContain("C");
    expect(target!.candidates.map((candidate) => candidate.name)).not.toContain("B");
  });

  it("does not compile while enumerating candidates but verifies the final plan", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point C = coordinate(x: 20, y: 0)",
      "point D = coordinate(x: 30, y: 0)",
      "point Use = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const snapshot = snapshotFor(source, REVISION, compiled);
    const compileSpy = vi.spyOn(dslDocument, "compileDslDocument");
    try {
      const target = queryDslGeometryReferenceRetargetTarget(snapshot, source.indexOf("@A") + 1);
      expect(target).not.toBeNull();
      expect(target!.candidates.map((candidate) => candidate.name)).toEqual(["B", "C", "D"]);
      expect(compileSpy).not.toHaveBeenCalled();

      const candidate = candidateNamed(target!, "B");
      const result = planDslGeometryReferenceRetargetEditsResult(snapshot, source.indexOf("@A") + 1, candidate.identity);
      expect(result.status).toBe("ok");
      expect(compileSpy).toHaveBeenCalledTimes(1);
      expect(compileSpy.mock.calls[0]?.[0]).toBe(source.replace("@A", "@B"));
    } finally {
      compileSpy.mockRestore();
    }
  });

  it("retargets all references of a Module parameter in its body", () => {
    const source = [
      "nui 1",
      "module M(a: path, b: path) {",
      "  group One {",
      "    line First = offset(sources: [@a], distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "  }",
      "  group Two {",
      "    line Second = offset(sources: [@a], distance: 2, side: left, closed: false, suppressTrimWarnings: false)",
      "  }",
      "}"
    ].join("\n");
    const target = targetAt(source, "@a");
    expect(target).not.toBeNull();
    expect(target!.occurrences).toHaveLength(2);
    const candidate = candidateNamed(target!, "b");
    expect(candidate.referencePaths).toEqual(["b", "b"]);
    const result = planDslGeometryReferenceRetargetEditsResult(snapshotFor(source), source.indexOf("@a") + 1, candidate.identity);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.plan.proposedSource.match(/@b/g)).toHaveLength(2);
  });

  it("fails closed for stale source and failed proposed-source semantic verification", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)",
      "point Use = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const stale = planDslGeometryReferenceRetargetEditsResult({
      source: { normalizedSource: source, sourceRevision: REVISION + 1 },
      semantic: { sourceRevision: REVISION, sourceText: source, compiled }
    }, source.indexOf("@A") + 1, { kind: "element", elementId: "missing" });
    expect(stale).toEqual({ status: "rejected", rejection: { reason: "stale-source" } });

    const target = targetAt(source, "@A");
    const candidate = candidateNamed(target!, "B");
    const snapshot = snapshotFor(source);
    const compileSpy = vi.spyOn(dslDocument, "compileDslDocument").mockImplementationOnce(() => compiled);
    try {
      const result = planDslGeometryReferenceRetargetEditsResult(snapshot, source.indexOf("@A") + 1, candidate.identity);
      expect(result).toEqual({ status: "rejected", rejection: { reason: "proposed-source-verification-failed" } });
    } finally {
      compileSpy.mockRestore();
    }
  });

  it("returns no applicable plan when there is no compatible candidate", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const target = targetAt(source, "@A");
    expect(target).not.toBeNull();
    expect(target!.candidates).toEqual([]);
    expect(planDslGeometryReferenceRetargetEditsResult(snapshotFor(source), source.indexOf("@A") + 1, { kind: "element", elementId: "missing" })).toEqual({
      status: "rejected",
      rejection: { reason: "candidate-not-found" }
    });
  });
});
