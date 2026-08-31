import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import {
  referencePickReplacementText,
  referencePickSeedReferences,
  referencePickTargetMatchesProof,
  referencePickTargetProofFor
} from "./referencePickProtocol";

const REVISION = 71;

const targetAt = (source: string, fragment: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-protocol:${index}`]))
  });
  const fragmentStart = source.indexOf(fragment);
  const caret = fragmentStart + Math.max(1, fragment.indexOf("@") + 2);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: REVISION },
    position: caret,
    semantic: { sourceRevision: REVISION, sourceText: source, compiled }
  });
  if (!target) throw new Error(`missing target: ${fragment}`);
  return { target, compiled, caret };
};

describe("reference pick VS Code protocol proof", () => {
  it("captures cross-process-stable target identity and old source text", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = onLine(from: @Base.start, distance: 2)"
    ].join("\n");
    const { target } = targetAt(source, "@Base.start");
    const proof = referencePickTargetProofFor(source, target);

    expect(proof).not.toBeNull();
    expect(proof?.oldText).toBe("@Base.start");
    expect(referencePickTargetMatchesProof(source, target, proof!)).toBe(true);

    const equivalentTargetFromAnotherCompilerSession = {
      ...target,
      sourceAnchor: {
        ...target.sourceAnchor,
        sourceRevision: target.sourceAnchor.sourceRevision + 1000,
        statementId: "other-session-statement",
        sourceOrderIndex: target.sourceAnchor.sourceOrderIndex + 1000,
        scopeId: "other-session-scope"
      }
    };
    expect(referencePickTargetMatchesProof(source, equivalentTargetFromAnotherCompilerSession, proof!)).toBe(true);

    expect(referencePickTargetMatchesProof(`${source} `, target, proof!)).toBe(true);
    expect(referencePickTargetMatchesProof(
      source.slice(0, target.range.from) + "@A" + source.slice(target.range.to),
      target,
      proof!
    )).toBe(false);
  });

  it("proves the complete numeric property operand as its editable range", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const { target } = targetAt(source, "@Base.length");
    const proof = referencePickTargetProofFor(source, target)!;

    expect(proof.range).toEqual({ from: target.range.from, to: target.range.to });
    expect(source.slice(proof.range.from, proof.range.to)).toBe("@Base.length");
    expect(source.slice(proof.activationRange.from, proof.activationRange.to)).toBe("@Base.length");
    expect(proof.numericProperty).toEqual({ kind: "propertySelectionRequired" });
    expect(referencePickTargetMatchesProof(source, target, proof)).toBe(true);
    expect(referencePickTargetMatchesProof(source.replace("length", "endAngleDeg"), target, proof)).toBe(false);
    expect(referencePickTargetMatchesProof(source, target, {
      ...proof,
      numericProperty: null
    })).toBe(false);
  });

  it("parses current list references as draft seed without losing quoted names", () => {
    const source = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line \"B, C\" = segment(start: (0, 10), end: (10, 10))",
      "line Seam = offset(sources: [@A, @\"B, C\"], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const { target } = targetAt(source, "[@A, @\"B, C\"]");
    const proof = referencePickTargetProofFor(source, target)!;

    expect(referencePickSeedReferences(proof)).toEqual([
      { base: "A" },
      { base: "\"B, C\"" }
    ]);
    expect(referencePickReplacementText("multiple", referencePickSeedReferences(proof)))
      .toBe("[@A, @\"B, C\"]");
  });

  it("formats structured derived-point references without string splitting", () => {
    expect(referencePickReplacementText("single", [{ base: "Front::Seam", pointKey: "start" }]))
      .toBe("@Front::Seam.start");
    expect(referencePickReplacementText("multiple", [{ base: "A" }, { base: "B" }]))
      .toBe("[@A, @B]");
    expect(referencePickReplacementText("single", [])).toBeNull();
  });
});
