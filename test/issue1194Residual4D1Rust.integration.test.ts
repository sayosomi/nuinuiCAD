import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix, join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileDslDocument, createModuleRuntimeContext, emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph, documentIdFromHost, moduleDeclarationContributor, savedSourceFingerprintFromHost } from "@nuinuicad/nui-language/workspace";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import type { ResidualCell } from "./fixtures/issue1194-d1/residual-model";
import cumulativeRegistry from "./fixtures/issue1194-d1/residual4-input-registry.json";
import authoredCases from "./fixtures/issue1194-d1/residual4-cases.json";
type Cell = ResidualCell & { deferred?: string };
const cells = authoredCases as Cell[];
import initialRegistry from "./fixtures/issue1194-d1/input-registry.json";
import frozen from "./fixtures/issue1194-d1/residual4-freeze.json";
import residualRegistry from "./fixtures/issue1194-d1/residual-input-registry.json";
import { checkPayload } from "./fixtures/issue1194-d1/assertions";
import { checkFourthCompiler as checkCompiler } from "./fixtures/issue1194-d1/residual4-assertions";
const reductions: Cell[] = [];
import { normalizeParityPayload } from "./evaluationParitySupport";

const mode = process.env.ISSUE1194_RESIDUAL4_MODE ?? "verify";
const phase = process.env.ISSUE1194_RESIDUAL4_PHASE ?? mode;
const evidence = process.env.ISSUE1194_RESIDUAL4_EVIDENCE;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const bundleHash = (c: Cell) => hash(JSON.stringify([["root.nui", c.source], ...Object.entries(c.saved ?? {}).sort(([a], [b]) => a.localeCompare(b))]));
const json = (v: unknown) => JSON.stringify(v, (_, x) => x instanceof Map ? [...x] : x instanceof Set ? [...x] : x);
const counts = { compiler: 0, setupCompiler: 0, reference: 0, production: 0 };
const productionOwners = [
  "packages/nui-language/src/document/multiDocumentModuleSemantics.ts",
  "packages/nui-language/src/dsl/dslDocument.ts", "packages/nui-language/src/dsl/geometryArraySemanticAnalysis.ts",
  "packages/nui-language/src/dsl/moduleGeometryRuntimeLowering.ts", "packages/nui-language/src/dsl/moduleScalarExpression.ts",
  "packages/nui-language/src/dsl/moduleSemanticAnalysis.ts", "packages/nui-language/src/dsl/moduleSemanticTypes.ts",
  "packages/nui-language/src/dsl/recordSemanticAnalysis.ts", "packages/nui-language/src/scalars/moduleScalarRuntime.ts",
  "packages/nui-language/src/scalars/recordScalarLowering.ts",
  "packages/nui-language/src/dsl/geometryArrayExpression.ts", "packages/nui-language/src/dsl/geometryArraySemantics.ts",
  "packages/nui-language/src/scalars/scalarExpressionCollection.ts",
  "src/geometry/evaluate.ts", "rust-evaluator/src/evaluation/control_boolean_runtime.rs"
];
const sourceTreeSha256 = hash(json(productionOwners.map(path => [path, hash(readFileSync(path, "utf8"))])));
const runId = `${phase}-${Date.now()}`;
let blank: ReturnType<typeof regenerateCanonicalFromModel>;
let writes: ReturnType<typeof vi.spyOn> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
const results: Record<string, unknown>[] = [];
const accepted = new Set<string>(cumulativeRegistry.acceptedSha256);
let rust: RustEvaluationProcess | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let closed: Promise<void> | undefined;
let stopping = false;
let resourceError: Error | undefined;
const record = (file: string, v: Record<string, unknown>) => { if (evidence) appendFileSync(join(evidence, file), json({ runId, phase, sourceTreeSha256, ...v }) + "\n"); };

beforeAll(() => {
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    try { for (const s of readFileSync(join(evidence, "accepted.sha256"), "utf8").trim().split("\n")) if (s) accepted.add(s); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    // Persist the complete oracle before invoking any compiler or evaluator.
    writeFileSync(join(evidence, `frozen-${runId}.json`), json([...cells, ...reductions].map(c => ({ ...c, sha256: bundleHash(c) }))));
  }
  expect(new Set([...initialRegistry.acceptedSha256, ...residualRegistry.acceptedSha256]).size).toBe(110);
  for (const sha of [...initialRegistry.acceptedSha256, ...residualRegistry.acceptedSha256]) expect(accepted.has(sha)).toBe(true);
  expect(accepted.size).toBeGreaterThanOrEqual(cumulativeRegistry.acceptedCount);
  counts.setupCompiler++;
  blank = regenerateCanonicalFromModel(emptyDocument(), 1);
  if (mode === "prevalidate") return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args) as ChildProcessWithoutNullStreams;
      closed = new Promise(resolve => {
        child!.once("close", (code, signal) => { if (!stopping) resourceError = new Error(`Rust unexpected close ${code}/${signal}`); resolve(); });
        child!.once("error", e => { resourceError = e; });
      });
      child.stderr.on("data", chunk => record("stderr.ndjson", { data: String(chunk) }));
      child.stdout.on("data", chunk => record("transport.ndjson", { phase: "stdout", data: String(chunk) }));
      writes = vi.spyOn(child.stdin, "write");
      child.stdin.on("error", (e: NodeJS.ErrnoException) => { if (!stopping || !["EPIPE", "ERR_STREAM_DESTROYED"].includes(e.code ?? "")) resourceError = e; });
      return child;
    }) as typeof spawn
  });
  watchdog = setTimeout(() => { resourceError = new Error("Rust process lifetime exceeded 10 minutes"); rust?.dispose(); }, 600_000);
}, 130_000);

afterAll(async () => {
  stopping = true;
  clearTimeout(watchdog);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    rust?.dispose();
    if (closed) await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust cleanup timeout")); }, 5_000); })]);
  } finally {
    clearTimeout(timer);
    writes?.mockRestore();
    record("runs.ndjson", { mode, counts, accepted: accepted.size, results, resourceError: resourceError?.message });
    console.info(json({ mode, counts, accepted: accepted.size, results }));
  }
  if (resourceError) throw resourceError;
}, 10_000);

const compile = async (c: Cell) => {
  counts.compiler++;
  if (!c.saved) return { compiled: compileCanonicalText(blank, c.source).currentCompiled, graph: undefined, semantics: undefined };
  const rootId = documentIdFromHost("/issue1194/root.nui");
  const graph = await buildMultiDocumentImportGraph({
    root: { kind: "root-current", documentId: rootId, normalizedSource: c.source, sourceRevision: 1 },
    loader: { async loadSavedDependency(importer, relative) {
      const path = posix.normalize(posix.join(posix.dirname(importer), relative));
      const text = c.saved![posix.relative("/issue1194", path)];
      return text === undefined ? { status: "failed", reason: "missing" } : { status: "loaded", snapshot: {
        kind: "dependency-saved", documentId: documentIdFromHost(path), normalizedSource: text, savedSourceFingerprint: savedSourceFingerprintFromHost(hash(text))
      } };
    } },
    declarationContributors: [moduleDeclarationContributor]
  });
  const semantics = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, semantics);
  const node = graph.nodes.get(rootId)!;
  return { compiled: compileDslDocument(c.source, { preparsed: node.artifact.parsed, sourceRevision: 1, assignedStatementIds: node.artifact.statementIdByStatementIndex, moduleRuntimeContext: context }), graph, semantics };
};

for (const c of [...cells, ...reductions].filter(c => !process.env.ISSUE1194_RESIDUAL4_IDS || process.env.ISSUE1194_RESIDUAL4_IDS.split(",").includes(c.id))) it.skipIf(mode === "verify" && Boolean(c.deferred))(c.id, async () => {
  if (resourceError) throw resourceError;
  const failures: string[] = [];
  const check = (boundary: string, f: () => void) => { try { f(); } catch (e) { failures.push(`${boundary}: ${String(e)}`); } };
  const sha256 = bundleHash(c);
  expect(frozen.find(row => row.id === c.id)).toEqual({ id: c.id, sha256, expected: c.expected,
    ...(c.expectedIssues ? { expectedIssues: c.expectedIssues } : {}),
    ...(c.expectedNone ? { expectedNone: c.expectedNone } : {}),
    ...(c.expectedCompilerError ? { expectedCompilerError: c.expectedCompilerError } : {}),
    savedDocumentPaths: Object.keys(c.saved ?? {}).sort() });
  let output: Awaited<ReturnType<typeof compile>>;
  try { output = await compile(c); }
  catch (e) {
    if (e instanceof RangeError || /out of memory|stack overflow|allocation failed/i.test(String(e))) resourceError = e instanceof Error ? e : new Error(String(e));
    const row = { id: c.id, sha256, status: resourceError ? "BLOCKED" : "UNRESOLVED", boundary: "compiler-exception", exception: String(e), stack: e instanceof Error ? e.stack : undefined };
    record("compiler.ndjson", row); results.push(row);
    if (mode === "verify") throw e;
    return;
  }
  const { compiled, graph } = output;
  const diagnostics = [...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? []), ...(output.semantics?.root?.diagnostics ?? [])].filter(d => d.severity === "error");
  const valid = diagnostics.length === 0 && (!graph || graph.valid);
  record("compiler.ndjson", { id: c.id, sha256, diagnostics, graph, semantics: output.semantics, compiled });
  if (valid) {
    accepted.add(sha256);
    if (evidence) writeFileSync(join(evidence, "accepted.sha256"), [...accepted].sort().join("\n") + "\n");
  }
  if (c.expectedCompilerError && mode === "verify") expect(valid, c.id).toBe(false);
  if (!valid || !compiled.document || !compiled.statementMap || compiled.majorVersion === null) {
    if (c.expectedCompilerError) {
      if (mode === "verify") expect(diagnostics.some(d => d.code === c.expectedCompilerError), json(diagnostics)).toBe(true);
      results.push({ id: c.id, sha256, status: "CONTRACT_INVALID", diagnostics });
      return;
    }
    const row = { id: c.id, sha256, status: "UNRESOLVED", boundary: "compiler", diagnostics, graphValid: graph?.valid };
    results.push(row);
    if (mode === "verify") expect(row, c.id).toMatchObject({ status: "PASS" });
    return;
  }
  if (mode === "prevalidate") { results.push({ id: c.id, sha256, status: "PREVALIDATED" }); return; }
  const document = { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion };
  const elements = document.document.elements;
  const options = buildEvaluationOptions({ compiledDocument: document, evaluationLimitIndex: document.document.evaluationLimitIndex });
  const prepared = prepareRustEvaluation(elements, options);
  check("compiler", () => checkCompiler(c, document, output.graph, output.semantics));
  const assertPayload = (payload: EvaluationPayload) => checkPayload(c, document, payload);
  let reference: EvaluationPayload | undefined, production: EvaluationPayload | undefined;
  counts.reference++;
  try { reference = evaluateElementsReferencePayload(elements, options); check("TS", () => assertPayload(reference!)); }
  catch (e) { failures.push(`TS exception: ${String(e)}`); }
  record("raw.ndjson", { id: c.id, sha256, phase: "before-rust", wire: prepared.input, rustEligible: prepared.rustEligible, reference, failures });
  if (prepared.rustEligible) {
    counts.production++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      production = await Promise.race([rust!.request(prepared.input), new Promise<never>((_, reject) => { timer = setTimeout(() => { resourceError = new Error("Rust request timeout"); rust?.dispose(); reject(resourceError); }, 10_000); })]) as EvaluationPayload;
      expect(JSON.parse(String(writes!.mock.calls.at(-1)![0])).input).toEqual(JSON.parse(JSON.stringify(prepared.input)));
      check("Rust", () => assertPayload(production!));
      check("TS/Rust parity", () => expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference)));
    } catch (e) { failures.push(`Rust request: ${String(e)}`); }
    finally { clearTimeout(timer); }
  } else failures.push("normal Rust eligibility false");
  record("raw.ndjson", { id: c.id, sha256, phase: "after-rust", production, failures });
  results.push({ id: c.id, sha256, status: failures.length ? "UNRESOLVED" : "PASS", rustEligible: prepared.rustEligible, failures });
  if (mode === "verify") expect(failures, c.id).toEqual([]);
}, 60_000);
