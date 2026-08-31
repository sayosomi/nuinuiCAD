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
  it("revalidates the exact target and replaces a complete numeric property operand", () => {
    const source = [
      "nui 1",
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
      references: [],
      allowedCandidateReferences: [{ base: "Base" }, { base: "Other" }],
      numericProperty: { reference: { base: "Other" }, property: "length" },
      allowedNumericCandidates: [
        { reference: { base: "Base" }, properties: ["length"] },
        { reference: { base: "Other" }, properties: ["length"] }
      ]
    });

    expect(plan).not.toBeNull();
    expect(plan?.range).toEqual({
      from: source.indexOf("@Base.length"),
      to: source.indexOf("@Base.length") + "@Base.length".length
    });
    const next = source.slice(0, plan!.range.from) + plan!.replacement + source.slice(plan!.range.to);
    expect(next).toContain("dx: @Other.length");
    expect(next).not.toContain("@Base.length");
    expect(plan?.caretNormalizedOffset).toBe(plan!.range.from + "@Other.length".length);
  });

  it("replaces a reference list as one canonical edit and permits removing every draft item", () => {
    const source = [
      "nui 1",
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
      "nui 1",
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

  it("writes a complete numeric property expression in one replacement", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: 20, dy: 0)"
    ].join("\n");
    const { compiled, position, proof } = fixture(source, "20");
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      normalizedSourceOffset: position,
      targetProof: proof,
      references: [],
      allowedCandidateReferences: [{ base: "Base" }],
      numericProperty: { reference: { base: "Base" }, property: "length" },
      allowedNumericCandidates: [{ reference: { base: "Base" }, properties: ["length"] }]
    });
    expect(plan).toMatchObject({ replacement: "@Base.length" });
    expect(source.slice(0, plan!.range.from) + plan!.replacement + source.slice(plan!.range.to))
      .toContain("dx: @Base.length");
  });

  it("inserts complete numeric property expressions for empty declaration and coordinate operands", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "const X: number = ",
      "point P = coordinate(x: 0, y: )"
    ].join("\n");
    const compiled = compile(source);
    const numericCandidate = { reference: { base: "Base" }, properties: ["length"] as const };

    const planFor = (position: number) => {
      const target = queryDslReferencePickTarget({
        source: { normalizedSource: source, sourceRevision: REVISION },
        position,
        semantic: { sourceRevision: REVISION, sourceText: source, compiled }
      });
      if (!target) throw new Error(`missing empty target at ${position}`);
      const proof = referencePickTargetProofFor(source, target);
      if (!proof) throw new Error(`missing empty proof at ${position}`);
      return planVscodeReferencePickSourceEdit({
        source: { normalizedSource: source, sourceRevision: REVISION },
        compiled,
        normalizedSourceOffset: position,
        targetProof: proof,
        references: [],
        allowedCandidateReferences: [{ base: "Base" }],
        numericProperty: { reference: numericCandidate.reference, property: "length" },
        allowedNumericCandidates: [numericCandidate]
      });
    };

    const declarationPosition = source.indexOf("const X: number = ") + "const X: number = ".length;
    const declarationPlan = planFor(declarationPosition);
    expect(declarationPlan).toMatchObject({
      range: { from: declarationPosition, to: declarationPosition },
      replacement: "@Base.length",
      caretNormalizedOffset: declarationPosition + "@Base.length".length
    });

    const coordinatePosition = source.indexOf("y: )") + "y: ".length;
    const coordinatePlan = planFor(coordinatePosition);
    expect(coordinatePlan).toMatchObject({
      range: { from: coordinatePosition, to: coordinatePosition },
      replacement: "@Base.length",
      caretNormalizedOffset: coordinatePosition + "@Base.length".length
    });
  });

  it("rejects forged and unsupported numeric results", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line Base = segment(start: @A, end: @B)",
      "point P = offset(from: @A, dx: @Base.length, dy: 0)"
    ].join("\n");
    const { compiled, position, proof } = fixture(source, "@Base.length");
    const planFor = (reference: { base: string; pointKey?: string }, property: string) =>
      planVscodeReferencePickSourceEdit({
        source: { normalizedSource: source, sourceRevision: REVISION },
        compiled,
        normalizedSourceOffset: position,
        targetProof: proof,
        references: [],
        allowedCandidateReferences: [{ base: "Base" }],
        numericProperty: { reference, property: property as never },
        allowedNumericCandidates: [{ reference: { base: "Base" }, properties: ["length"] }]
      });
    expect(planFor({ base: "Missing" }, "length")).toBeNull();
    expect(planFor({ base: "Base" }, "startHandleLength")).toBeNull();
    expect(planFor({ base: "Base" }, "endAngleDeg")).toBeNull();
    expect(planFor({ base: "Base", pointKey: "start" }, "length")).toBeNull();
  });
});
