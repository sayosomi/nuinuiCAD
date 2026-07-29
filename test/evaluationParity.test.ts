import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { printableGroups } from "../src/print/printGeometry";
import {
  evaluateWithRustFixture,
  isNui3ReleaseFixture,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  parityFixtureNames,
  readParityFixture,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";
const fixtureNames = runRustParity ? parityFixtureNames(repoRoot) : [];

const printGroupIdsFor = (fixture: ReturnType<typeof readParityFixture>, payload: ReturnType<typeof evaluateWithRustFixture>) => {
  const doc = fixture.compiled?.doc;
  if (!doc) return [];
  return printableGroups(
    doc.document.elements,
    { propertyBindings: doc.propertyBindings, byElementId: doc.statementMap.byElementId },
    evaluationPayloadToResult(payload).computedScalarBindings
  ).map((group) => group.id);
};

describe.skipIf(!runRustParity)("TypeScript/Rust evaluation parity fixtures", () => {
  it.each(fixtureNames)("%s matches the TypeScript reference payload", (name: string) => {
    const fixture = readParityFixture(repoRoot, name);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    if (!isNui3ReleaseFixture(name)) return;
    expect(isRustEligibleFixture(fixture), `${name} must use the production Rust route`).toBe(true);
    expect(normalizeParityPayload(runtimeDiagnosticsFor(fixture, rustPayload))).toEqual(
      normalizeParityPayload(runtimeDiagnosticsFor(fixture, tsPayload))
    );
    expect(printGroupIdsFor(fixture, rustPayload)).toEqual(printGroupIdsFor(fixture, tsPayload));
  }, 30000);
});
