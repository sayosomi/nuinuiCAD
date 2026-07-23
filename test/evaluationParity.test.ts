import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CadElement } from "../src/types/geometry";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../src/document/canonicalDocument";
import { emptyDocument } from "../src/dsl/dslDocumentTestUtils";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { ScalarProgram } from "../src/scalars/scalarProgram";

type EvaluationFixture = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
  scalarProgram?: ScalarProgram;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");
const fixtureDir = join(repoRoot, "test", "fixtures", "evaluation");
const cargoManifest = join(repoRoot, "src-tauri", "Cargo.toml");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";

const fixtureNames: string[] = runRustParity
  ? readdirSync(fixtureDir)
      .filter((name: string) => name.endsWith(".json"))
      .sort()
  : [];

const readFixture = (name: string): EvaluationFixture =>
  JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as EvaluationFixture;

const evaluateWithRust = (input: EvaluationFixture): EvaluationPayload => {
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      cargoManifest,
      "--example",
      "evaluate_fixture"
    ],
    { encoding: "utf8", input: JSON.stringify(input) }
  );
  return JSON.parse(output) as EvaluationPayload;
};

const normalizeNumbers = (value: unknown): unknown => {
  if (typeof value === "number") {
    const normalized = Math.round(value * 1e7) / 1e7;
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeNumbers);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, normalizeNumbers(nested)])
    );
  }
  return value;
};

describe.skipIf(!runRustParity)("TypeScript/Rust evaluation parity fixtures", () => {
  it.each(fixtureNames)(
    "%s matches the TypeScript reference payload",
    (name: string) => {
      const fixture = readFixture(name);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
        evaluationLimitIndex: fixture.evaluationLimitIndex,
        scalarProgram: fixture.scalarProgram
      });
      const rustPayload = evaluateWithRust(fixture);

      expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    },
    30000
  );

  it("declaration-only nui 3 source has no TS/Rust shadow mismatch", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const compiled = compileCanonicalText(baseline, [
      "nui 3",
      "const hem: number = 12",
      "const label: string = \"front\"",
      "const printed: boolean = true",
      "const side: choice(right, left) = right",
      "group Scope {",
      "  const hemCopy: number = @hem",
      "}"
    ].join("\n"));

    expect(compiled.status).not.toBe("fatal");
    const fixture: EvaluationFixture = {
      elements: compiled.doc.document.elements,
      scalarProgram: compiled.doc.scalarProgram
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
      scalarProgram: fixture.scalarProgram
    });

    expect(normalizeNumbers(evaluateWithRust(fixture))).toEqual(normalizeNumbers(tsPayload));
  }, 30000);

  it("valid nui 3 overflow source returns matching typed poison through IPC", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
    const maximumFiniteLiteral = `1${"0".repeat(308)}`;
    const compiled = compileCanonicalText(baseline, [
      "nui 3",
      `const maximum: number = ${maximumFiniteLiteral}`,
      "const overflow: number = @maximum + @maximum"
    ].join("\n"));

    expect(compiled.status).not.toBe("fatal");
    const fixture: EvaluationFixture = {
      elements: compiled.doc.document.elements,
      scalarProgram: compiled.doc.scalarProgram
    };
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, {
      scalarProgram: fixture.scalarProgram
    });
    const rustPayload = evaluateWithRust(fixture);
    const rustResult = evaluationPayloadToResult(rustPayload);

    expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    const bindings = Array.from(rustResult.computedScalarBindings ?? []);
    expect(bindings).toHaveLength(2);
    expect(bindings[0][1]).toMatchObject({ status: "ok", type: { kind: "number" } });
    expect(bindings[1][1]).toEqual({
      status: "error",
      type: { kind: "number" },
      issueCode: "evaluation-non-finite-result"
    });
  }, 30000);
});
