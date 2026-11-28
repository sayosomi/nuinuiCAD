import { execFileSync } from "node:child_process";
import { constants, copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CadElement } from "../src/types/geometry";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { emptyDocument } from "@nuinuicad/nui-language";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { canUseRustEvaluationForElements } from "../src/geometry/rustEvaluationEligibility";
import { buildRustEvaluationInput, type EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
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
  if (compiled.status === "fatal") throw new Error(`parity source failed to compile: ${JSON.stringify(compiled.diagnostics)}`);
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

export const optionsFor = (fixture: EvaluationFixture): EvaluateElementsOptions => {
  if (!fixture.compiled) throw new Error("evaluation fixture has no compiled document");
  return buildEvaluationOptions({
    compiledDocument: fixture.compiled.doc,
    evaluationLimitIndex: fixture.evaluationLimitIndex
  });
};

export const evaluateWithRustFixture = (
  repoRoot: string,
  fixture: EvaluationFixture
): EvaluationPayload => evaluateWithRustOptions(
  repoRoot,
  fixture.elements,
  optionsFor(fixture)
);

const builtFixtureExecutables = new Set<string>();

export const evaluateWithRustOptions = (
  repoRoot: string,
  elements: CadElement[],
  options: EvaluateElementsOptions
): EvaluationPayload => {
  const cargoManifest = join(repoRoot, "rust-evaluator", "Cargo.toml");
  const targetPath = resolve(repoRoot, process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target");
  const executableName = process.platform === "win32" ? "evaluate_fixture.exe" : "evaluate_fixture";
  const cargoExecutable = join(targetPath, "debug", "examples", executableName);
  const buildExample = () => {
    execFileSync("cargo", ["build", "--quiet", "--manifest-path", cargoManifest, "--example", "evaluate_fixture"], {
      cwd: repoRoot, timeout: 120_000, stdio: "inherit"
    });
    builtFixtureExecutables.add(cargoExecutable);
  };
  if (!builtFixtureExecutables.has(cargoExecutable)) buildExample();

  const directory = mkdtempSync(join(tmpdir(), "nuinuicad-fixture-parity-"));
  const snapshot = join(directory, executableName);
  try {
    try {
      copyFileSync(cargoExecutable, snapshot, constants.COPYFILE_FICLONE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Another worker's Cargo build can briefly replace the shared link.
      buildExample();
      copyFileSync(cargoExecutable, snapshot, constants.COPYFILE_FICLONE);
    }
    const input = buildRustEvaluationInput(elements, options);
    const output = execFileSync(snapshot, [], {
      encoding: "utf8", input: JSON.stringify(input), maxBuffer: 64 * 1024 * 1024,
      timeout: 15_000, killSignal: "SIGKILL"
    });
    return JSON.parse(output) as EvaluationPayload;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

/** Issue regressions that must cross the production persistent Node→Rust stdio boundary. */
export const createRustStdioParityClient = (
  repoRoot: string,
  options:
    | { prebuiltBinaryPath: string; targetDirectory?: never }
    | { targetDirectory: string; prebuiltBinaryPath?: never }
    | { targetDirectory?: undefined; prebuiltBinaryPath?: undefined } = {}
) => {
  if (options.prebuiltBinaryPath !== undefined && options.targetDirectory !== undefined) {
    throw new Error("prebuiltBinaryPath and targetDirectory are mutually exclusive");
  }

  const cargoManifest = join(repoRoot, "rust-evaluator", "Cargo.toml");
  let binaryPath: string;
  if (options.prebuiltBinaryPath !== undefined) {
    if (!options.prebuiltBinaryPath) throw new Error("prebuiltBinaryPath must be a non-empty path");
    binaryPath = options.prebuiltBinaryPath;
  } else {
    const cargoEnvironment = options.targetDirectory
      ? { ...process.env, CARGO_TARGET_DIR: options.targetDirectory }
      : process.env;
    execFileSync(
      "cargo",
      ["build", "--quiet", "--manifest-path", cargoManifest, "--bin", "evaluation_stdio"],
      { cwd: repoRoot, stdio: "inherit", env: cargoEnvironment, timeout: 120_000 }
    );
    binaryPath = options.targetDirectory
      ? join(options.targetDirectory, "debug", "evaluation_stdio")
      : resolveRustEvaluationBinaryPath(repoRoot);
  }
  const rustProcess = new RustEvaluationProcess(binaryPath);
  const evaluateInput = async (input: EvaluateDocumentInput): Promise<EvaluationPayload> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        rustProcess.request(input) as Promise<EvaluationPayload>,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error("Rust parity stdio request exceeded 15 seconds"));
            rustProcess.dispose();
          }, 15_000);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    evaluate: (elements: CadElement[], options: EvaluateElementsOptions) => evaluateInput(buildRustEvaluationInput(elements, options)),
    evaluateInput,
    dispose: () => rustProcess.dispose()
  };
};

export const evaluateWithRustStdioOptions = async (
  repoRoot: string,
  elements: CadElement[],
  options: EvaluateElementsOptions
): Promise<EvaluationPayload> => {
  const rustStdio = createRustStdioParityClient(repoRoot);
  try {
    return await rustStdio.evaluate(elements, options);
  } finally {
    rustStdio.dispose();
  }
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
        .map(([key, nested]) => {
          const normalized = normalizeParityPayload(nested);
          if (key !== "computedScalarBindingVersions" || !Array.isArray(normalized)) {
            return [key, normalized];
          }
          return [key, [...normalized].sort((left, right) =>
            String((left as { versionId?: unknown }).versionId ?? "")
              .localeCompare(String((right as { versionId?: unknown }).versionId ?? ""))
          )];
        })
    );
  }
  return value;
};

export const isRustEligibleFixture = (fixture: EvaluationFixture) =>
  canUseRustEvaluationForElements(fixture.elements, optionsFor(fixture));

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

/** Test-only inspection of a captured reference's canonical initializer chain.
 * Follow compiler-authored occurrences, preserving the selected owner/prefix;
 * never evaluate geometry or resolve a source name here. */
export const capturedReferenceTarget = (
  fixture: ReturnType<typeof fixtureFromSource>,
  target: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set()
): Record<string, unknown> => {
  if (target.kind !== "geometryValue" || !target.occurrence) return target;
  const occurrence = target.occurrence as { sourceStatementId: string; instancePath: readonly string[] };
  const key = JSON.stringify(occurrence);
  if (seen.has(key)) throw new Error("cyclic captured reference in test evidence");
  const entry = optionsFor(fixture).geometryValueProgram?.find(candidate =>
    candidate.occurrence.sourceStatementId === occurrence.sourceStatementId &&
    JSON.stringify(candidate.occurrence.instancePath) === JSON.stringify(occurrence.instancePath));
  if (entry?.construction.kind !== "reference") throw new Error("expected a canonical captured reference initializer");
  const source = capturedReferenceTarget(fixture, entry.construction.target as unknown as Record<string, unknown>, new Set([...seen, key]));
  return { ...source, ...(target.geometryType ? { geometryType: target.geometryType } : {}),
    ...(target.pointKey ? { pointKey: target.pointKey } : {}) };
};
