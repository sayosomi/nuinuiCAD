import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CadElement } from "../src/types/geometry";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "../src/document/canonicalDocument";
import { emptyDocument } from "../src/dsl/dslDocumentTestUtils";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { canUseRustEvaluationForElements } from "../src/geometry/rustEvaluationEligibility";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { runtimeScalarDiagnostics } from "../src/scalars/runtimeScalarDiagnostics";
import type { EvaluateElementsOptions } from "../src/geometry/evaluate";

export type EvaluationFixture = {
  elements: CadElement[];
  evaluationLimitIndex?: number;
  compiled?: TextCompileResult;
};

export const evaluationFixtureDir = (repoRoot: string) => join(repoRoot, "test", "fixtures", "evaluation");

export const parityFixtureNames = (repoRoot: string): string[] =>
  readdirSync(evaluationFixtureDir(repoRoot))
    .filter((name) => name.endsWith(".nui"))
    .sort();

export const isCurrentReleaseFixture = (name: string) => name.startsWith("nui1-") && name.endsWith(".nui");

export const fixtureFromSource = (source: string): EvaluationFixture => {
  const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
  if (compiled.status === "fatal") throw new Error("parity source failed to compile");
  const doc = compiled.doc;
  return {
    elements: doc.document.elements,
    evaluationLimitIndex: doc.document.evaluationLimitIndex,
    compiled
  };
};

export const readParityFixture = (repoRoot: string, name: string): EvaluationFixture => {
  const source = readFileSync(join(evaluationFixtureDir(repoRoot), name), "utf8");
  return fixtureFromSource(source);
};

export const optionsFor = (
  fixture: EvaluationFixture,
  selectedDrawingProfileId?: string
): EvaluateElementsOptions => {
  if (!fixture.compiled) throw new Error("evaluation fixture has no compiled document");
  return buildEvaluationOptions({
    compiledDocument: fixture.compiled.doc,
    evaluationLimitIndex: fixture.evaluationLimitIndex,
    selectedDrawingProfileId
  });
};

export const evaluateWithRustFixture = (
  repoRoot: string,
  fixture: EvaluationFixture,
  selectedDrawingProfileId?: string
): EvaluationPayload => {
  const cargoManifest = join(repoRoot, "rust-evaluator", "Cargo.toml");
  const input = buildRustEvaluationInput(fixture.elements, optionsFor(fixture, selectedDrawingProfileId));
  const output = execFileSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", cargoManifest, "--example", "evaluate_fixture"],
    { encoding: "utf8", input: JSON.stringify(input), maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(output) as EvaluationPayload;
};

export const normalizeParityPayload = (value: unknown): unknown => {
  if (typeof value === "number") {
    const normalized = Math.round(value * 1e7) / 1e7;
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (Array.isArray(value)) return value.map(normalizeParityPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeParityPayload(nested)])
    );
  }
  return value;
};

export const isRustEligibleFixture = (fixture: EvaluationFixture, selectedDrawingProfileId?: string) =>
  canUseRustEvaluationForElements(fixture.elements, optionsFor(fixture, selectedDrawingProfileId));

export const runtimeDiagnosticsFor = (fixture: EvaluationFixture, payload: EvaluationPayload) => {
  const doc = fixture.compiled?.doc;
  if (!doc?.bindingAnalysis || !doc.statementMap) return [];
  return runtimeScalarDiagnostics({
    computedScalarBindings: evaluationPayloadToResult(payload).computedScalarBindings,
    bindingAnalysis: doc.bindingAnalysis,
    statements: doc.statements,
    spans: doc.spans,
    elementIdByStatementIndex: doc.statementMap.elementIdByStatementIndex,
    propertySourcesByOccurrenceKey: doc.propertyBindings ?? new Map(),
    occurrenceKeysByBindingId: doc.occurrenceKeysByBindingId ?? new Map(),
    elements: fixture.elements,
    freshness: { isSourceDirty: false, isEvaluationStale: false }
  });
};
