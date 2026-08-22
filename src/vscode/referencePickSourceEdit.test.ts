import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import { referencePickTargetProofFor } from "./referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "./referencePickSourceEdit";

const REVISION = 82;

const compile = (source: string, sourceRevision = REVISION): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `pick-edit:${index}`]))
  });
};

const fixture = (source: string, fragment: string) => {
  const compiled = compile(source);
  const fragmentStart = source.indexOf(fragment);
  const position = fragmentStart + Math.max(1, fragment.indexOf("@") + 2);
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source, sourceRevision: REVISION },
    position,
    semantic: { sourceRevision: REVISION, sourceText: source, compiled }
  });
  if (!target) throw new Error(`missing target: ${fragment}`);
  const proof = referencePickTargetProofFor(source, target);
  if (!proof) throw new Error(`missing proof: ${fragment}`);
  return { compiled, position, proof };
};

describe("planVscodeReferencePickSourceEdit", () => {
  it("revalidates the exact target and preserves a numeric property suffix", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "line Other = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const { compiled, position, proof } = fixture(source, "@Base.length");
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset: position,
      targetProof: proof,
      references: [{ base: "Other" }],
      allowedCandidateReferences: [{ base: "Base" }, { base: "Other" }]
    });

    expect(plan).not.toBeNull();
    const next = source.slice(0, plan!.range.from) + plan!.replacement + source.slice(plan!.range.to);
    expect(next).toContain("dx: @Other.length");
    expect(plan?.caretNormalizedOffset).toBe(plan!.range.from + "@Other".length);
  });

  it("replaces a reference list as one canonical edit and permits removing every draft item", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "line C = segment(start: (0, 20), end: (10, 20))",
      "line Seam = offset(sources: [@A, @B], distance: 1, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n");
    const { compiled, position, proof } = fixture(source, "[@A, @B]");
    const changed = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset: position,
      targetProof: proof,
      references: [{ base: "A" }, { base: "C" }],
      allowedCandidateReferences: [{ base: "A" }, { base: "B" }, { base: "C" }]
    });
    expect(changed?.replacement).toBe("[@A, @C]");

    const empty = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset: position,
      targetProof: proof,
      references: [],
      allowedCandidateReferences: [{ base: "A" }, { base: "B" }, { base: "C" }]
    });
    expect(empty?.replacement).toBe("[]");
  });

  it("rejects stale target proofs and references outside the captured candidate set", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point P = offset(from: @A, dx: 0, dy: 0)"
    ].join("\n");
    const { compiled, position, proof } = fixture(source, "from: @A");
    expect(planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset: position,
      targetProof: proof,
      references: [{ base: "Forged" }],
      allowedCandidateReferences: [{ base: "B" }]
    })).toBeNull();

    const staleSource = source.replace("from: @A", "from: @B");
    const staleCompiled = compile(staleSource, REVISION + 1);
    expect(planVscodeReferencePickSourceEdit({
      source: { normalizedSource: staleSource, sourceRevision: REVISION + 1 },
      compiled: staleCompiled,
      normalizedSourceOffset: position,
      targetProof: proof,
      references: [{ base: "B" }],
      allowedCandidateReferences: [{ base: "B" }]
    })).toBeNull();
  });
});
