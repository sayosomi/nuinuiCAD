import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CadElement } from "../src/types/geometry";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";

type EvaluationFixture = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
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

const evaluateWithRust = (name: string): EvaluationPayload => {
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      cargoManifest,
      "--example",
      "evaluate_fixture",
      "--",
      join(fixtureDir, name)
    ],
    { encoding: "utf8" }
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
        evaluationLimitIndex: fixture.evaluationLimitIndex
      });
      const rustPayload = evaluateWithRust(name);

      expect(normalizeNumbers(rustPayload)).toEqual(normalizeNumbers(tsPayload));
    },
    30000
  );
});
