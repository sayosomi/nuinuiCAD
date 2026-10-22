import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { emptyDocument, geometryValueOccurrenceKey } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import authoredCases from "./fixtures/issue1260-d1/cases.json";
import frozen from "./fixtures/issue1260-d1/freeze.json";
import { checkCampaign, type Cell } from "./fixtures/issue1260-d1/assertions";
const cells = authoredCases as Cell[];
import { checkPayload } from "./fixtures/issue1194-d1/assertions";
import { checkEighthCompiler as checkCompiler } from "./fixtures/issue1194-d1/residual8-assertions";
const reductions: Cell[] = [];
import { recordsIn } from "./fixtures/issue1419/assertions";
import { normalizeParityPayload } from "./evaluationParitySupport";
import { nameFor } from "./fixtures/issue-stage7/assertions";
import registry from "./fixtures/issue1260-d1/input-registry.json";

const mode = process.env.ISSUE1260_MODE ?? "verify";
const phase = process.env.ISSUE1260_PHASE ?? mode;
const evidence = process.env.ISSUE1260_EVIDENCE;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const bundleHash = (c: Cell) => hash(c.source);
const json = (v: unknown) => JSON.stringify(v, (_, x) => x instanceof Map ? [...x] : x instanceof Set ? [...x] : x);
const counts = { compiler: 0, setupCompiler: 0, reference: 0, production: 0 };
const productionOwners = [
  "packages/nui-language/src/document/multiDocumentModuleSemantics.ts",
  "packages/nui-language/src/dsl/moduleGeometryRuntime.ts",
  "packages/nui-language/src/dsl/moduleGeometryArrayRuntime.ts",
  "packages/nui-language/src/dsl/dslDocument.ts", "packages/nui-language/src/dsl/geometryArraySemanticAnalysis.ts",
  "packages/nui-language/src/dsl/moduleGeometryRuntimeLowering.ts", "packages/nui-language/src/dsl/moduleScalarExpression.ts",
  "packages/nui-language/src/dsl/moduleSemanticAnalysis.ts", "packages/nui-language/src/dsl/moduleSemanticTypes.ts",
  "packages/nui-language/src/dsl/recordSemanticAnalysis.ts", "packages/nui-language/src/scalars/moduleScalarRuntime.ts",
  "packages/nui-language/src/scalars/recordScalarLowering.ts",
  "packages/nui-language/src/dsl/geometryArrayExpression.ts", "packages/nui-language/src/dsl/geometryArraySemantics.ts",
  "packages/nui-language/src/scalars/scalarExpressionCollection.ts", "packages/nui-language/src/scalars/typedDependencyGraph.ts",
  "src/geometry/evaluate.ts", "rust-evaluator/src/evaluation/conditional_dependency_runtime.rs",
  "rust-evaluator/src/evaluation/mod.rs", "rust-evaluator/src/evaluation/scalars/mutation/for_group_scheduler.rs"
];
const sourceTreeSha256 = hash(json(productionOwners.map(path => [path, hash(readFileSync(path, "utf8"))])));
const runId = `${phase}-${Date.now()}`;
let blank: ReturnType<typeof regenerateCanonicalFromModel>;
let writes: ReturnType<typeof vi.spyOn> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
const results: Record<string, unknown>[] = [];
const accepted = new Set<string>();
let rust: RustEvaluationProcess | undefined;
let child: ChildProcessWithoutNullStreams | undefined;
let closed: Promise<void> | undefined;
let stopping = false;
const transportRecord = (event: string, details: Record<string, unknown> = {}) => record("lifecycle.ndjson", { event, timestamp: Date.now(), pid: child?.pid, ...details });
let resourceError: Error | undefined;
const record = (file: string, v: Record<string, unknown>) => { if (evidence) appendFileSync(join(evidence, file), json({ runId, phase, sourceTreeSha256, ...v }) + "\n"); };

beforeAll(() => {
  for (const sourceHash of registry.acceptedSha256) accepted.add(sourceHash);
  expect(cells.filter(c => c.historical && c.deferred), "fixed transfers and historical repaired controls must run in normal verification").toEqual([]);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    try { for (const s of readFileSync(join(evidence, "accepted.sha256"), "utf8").trim().split("\n")) if (s) accepted.add(s); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    // Persist the complete oracle before invoking any compiler or evaluator.
    writeFileSync(join(evidence, `frozen-${runId}.json`), json([...cells, ...reductions].map(c => ({ ...c, sha256: bundleHash(c) }))));
  }
  counts.setupCompiler++;
  blank = regenerateCanonicalFromModel(emptyDocument(), 1);
  if (mode === "prevalidate") return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args) as ChildProcessWithoutNullStreams;
      child.once("spawn", () => transportRecord("spawn"));
      child.once("exit", (code, signal) => transportRecord("exit", { code, signal }));
      closed = new Promise(resolve => {
        child!.once("close", (code, signal) => { transportRecord("close", { code, signal }); if (!stopping) resourceError = new Error(`Rust unexpected close ${code}/${signal}`); resolve(); });
        child!.once("error", e => { resourceError = e; });
      });
      child.stderr.on("data", chunk => record("stderr.ndjson", { data: String(chunk) }));
      child.stdout.on("data", chunk => record("transport.ndjson", { phase: "stdout", data: String(chunk) }));
      const write = child.stdin.write.bind(child.stdin);
      writes = vi.spyOn(child.stdin, "write").mockImplementation(((...args: Parameters<typeof write>) => {
        transportRecord("write", { bytes: Buffer.byteLength(String(args[0])), writable: child!.stdin.writable });
        return write(...args);
      }) as typeof write);
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
  const result = compileCanonicalText(blank, c.source);
  return { compiled: result.currentCompiled, result };
};

for (const c of [...cells, ...reductions].filter(c => !process.env.ISSUE1260_IDS || process.env.ISSUE1260_IDS.split(",").includes(c.id))) it.skipIf(mode === "verify" && Boolean(c.deferred))(c.id, async () => {
  if (resourceError) throw resourceError;
  const failures: string[] = [];
  const check = (boundary: string, f: () => void) => { try { f(); } catch (e) { failures.push(`${boundary}: ${String(e)}`); } };
  const sha256 = hash(c.source);
  expect(frozen.find(row => row.id === c.id)).toMatchObject({ id: c.id, sha256: hash(c.source), expected: c.expected, geometry: c.geometry ?? [], errors: c.errors ?? [], expectedIssues: c.expectedIssues ?? {} });
  let output: Awaited<ReturnType<typeof compile>>;
  try { output = await compile(c); }
  catch (e) {
    if (e instanceof RangeError || /out of memory|stack overflow|allocation failed/i.test(String(e))) resourceError = e instanceof Error ? e : new Error(String(e));
    const row = { id: c.id, sha256, status: resourceError ? "BLOCKED" : "UNRESOLVED", boundary: "compiler-exception", exception: String(e), stack: e instanceof Error ? e.stack : undefined };
    record("compiler.ndjson", row); results.push(row);
    if (mode === "verify") throw e;
    return;
  }
  const { compiled } = output;
  const diagnostics = [...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])].filter(d => d.severity === "error");
  const valid = diagnostics.length === 0;
  record("compiler.ndjson", { id: c.id, sha256, diagnostics, compiled });
  if (valid && !c.expectedCompilerError && !c.historical) {
    accepted.add(hash(c.source));
    expect(accepted.size).toBeLessThanOrEqual(96);
    if (evidence) writeFileSync(join(evidence, "accepted.sha256"), [...accepted].sort().join("\n") + "\n");
  }
  if (c.expectedCompilerError && mode === "verify") expect(valid, c.id).toBe(false);
  if (!valid || !compiled.document || !compiled.statementMap || compiled.majorVersion === null) {
    if (c.expectedCompilerError) {
      // The invalid unwrap oracle requires rejection; the diagnostic code is
      // incidental and is retained separately in first-loss evidence.
      if (mode === "verify" && c.expectedCompilerError !== "*") expect(diagnostics.some(d => d.code === c.expectedCompilerError), json(diagnostics)).toBe(true);
      results.push({ id: c.id, sha256, status: "CONTRACT_INVALID", diagnostics });
      return;
    }
    const row = { id: c.id, sha256, status: "UNRESOLVED", boundary: "compiler", diagnostics };
    results.push(row);
    if (mode === "verify") expect(row, c.id).toMatchObject({ status: "PASS" });
    return;
  }
  if (mode === "prevalidate") { results.push({ id: c.id, sha256, status: "PREVALIDATED" }); return; }
  const document = { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion };
  const elements = document.document.elements;
  const through = c.limitThrough && c.limitThrough !== "before-first"
    ? elements.findIndex(e => nameFor(output.result, e.id) === c.limitThrough) : undefined;
  if (through !== undefined) expect(through, "limit must name an exact current owner").toBeGreaterThanOrEqual(0);
  const limit = c.limitThrough === "before-first" ? 0 : through !== undefined ? through + 1 : document.document.evaluationLimitIndex;
  let options: ReturnType<typeof buildEvaluationOptions>;
  let prepared: ReturnType<typeof prepareRustEvaluation>;
  try {
    options = buildEvaluationOptions({ compiledDocument: document, evaluationLimitIndex: limit });
    prepared = prepareRustEvaluation(elements, options);
  } catch (e) {
    const row = { id: c.id, sha256, status: "UNRESOLVED", boundary: "production-payload", exception: String(e) };
    results.push(row); record("raw.ndjson", row);
    if (mode === "verify") throw e;
    return;
  }
  check("compiler", () => {
    if (c.historical) checkCompiler(c, document);
    if (["G-map-free-dynamic", "B-min-forward-dynamic", "A-min-optional-forward"].includes(c.id)) {
      const targets = (document.geometryValueProgram ?? []).flatMap(entry => recordsIn(entry.construction)
        .filter(node => node.kind === "collectionIndex").map(node => ({ node, consumer: entry.sourceExecutionPosition })));
      expect(targets.length, "dynamic geometry collection target retained").toBeGreaterThan(0);
      for (const { node, consumer } of targets) if (typeof node.targetSourceOrder === "number") {
        expect(consumer).toBeDefined();
        expect(node.targetSourceOrder, "earlier producer is visible to its consumer").toBeLessThanOrEqual(consumer!);
      }
    }
    if (c.id === "B-map-free-scalar-source") {
      const producers = (document.geometryValueProgram ?? []).filter(entry =>
        recordsIn(entry.construction).some(node => node.kind === "collectionIndex"));
      expect(producers, "two asymmetric Module collection consumers").toHaveLength(2);
      for (const entry of producers) {
        const dependencies = document.typedDependencyGraph!.edges.filter(edge =>
          edge.from.kind === "geometry-value" && edge.from.id === geometryValueOccurrenceKey(entry.occurrence) &&
          edge.to.kind === "binding" && edge.to.name === "n");
        expect(dependencies, "geometry waits for its selected collection member's scalar parameter").toHaveLength(1);
        const dependency = dependencies[0];
        expect(dependency.to.id).toContain(entry.occurrence.instancePath[0]);
      }
    }
    if (c.id === "R2-02") {
      const carry = [...document.bindingVersions!.immutableForGroups!.values()]
        .flatMap(plan => plan.geometryCollectionCarries ?? [])[0];
      expect(carry.next).toMatchObject({ kind: "node", node: { kind: "leaf", targets: [{ stagePath: ["base"] }] } });
    }
    if (c.id === "R2-03" || c.id === "R2-04") {
      const owners = new Set([...document.moduleForGroupExecutionOwnerByElementId!.values()].map(owner => owner.ownerStatementId));
      const plans = [...document.bindingVersions!.immutableForGroups!.values()];
      expect(plans).toHaveLength(2);
      for (const plan of plans) expect(owners.has(plan.ownerStatementId), "exact instance-qualified carry owner").toBe(true);
    }
    if (c.id === "R4-02") {
      const final = document.bindingAnalysis!.catalog.bindings.find(binding => binding.name === "Final")!;
      const plan = [...document.bindingVersions!.immutableForGroups!.values()].find(plan => plan.carries.some(carry => carry.bindingId.endsWith(":Total")))!;
      const owner = [...options.forGroupMutationOwnerByElementId!.values()].find(owner => owner.ownerStatementId === plan.ownerStatementId)!;
      expect(document.typedDependencyGraph!.edges.some(edge => edge.from.id === final.id && edge.to.kind === "element" && edge.to.id === owner.elementId), "escaped scalar waits for loop completion").toBe(true);
    }
  });
  const assertPayload = (payload: EvaluationPayload) => {
    if (c.historical) checkPayload(c, document, payload);
    else checkCampaign(c, output.result, payload);
  };
  let reference: EvaluationPayload | undefined, production: EvaluationPayload | undefined;
  counts.reference++;
  try { reference = evaluateElementsReferencePayload(elements, options); check("TS", () => assertPayload(reference!)); }
  catch (e) { failures.push(`TS exception: ${String(e)}`); }
  if (mode === "verify" && reference && ["R2-02", "R4-03", "R6-04", "R7-01"].includes(c.id)) {
    const changed = structuredClone(reference);
    if (c.id === "R6-04") changed.instanceBaseGeometry = [];
    else if (c.id === "R7-01") changed.computedScalarBindings = [];
    else {
      const point = changed.computedGeometry.find(geometry => geometry.kind === "point")!;
      if (point.kind === "point") point.x += 1;
    }
    expect(() => assertPayload(changed), "detector rejects a wrong coordinate, owner snapshot, or diagnostic set").toThrow();
  }
  record("raw.ndjson", { id: c.id, sha256, phase: "before-rust", wire: prepared.input, rustEligible: prepared.rustEligible, reference, failures });
  if (prepared.rustEligible) {
    counts.production++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      production = await Promise.race([rust!.request(prepared.input), new Promise<never>((_, reject) => { timer = setTimeout(() => { transportRecord("request-timeout", { writableLength: child?.stdin.writableLength, writable: child?.stdin.writable, exitCode: child?.exitCode, killed: child?.killed }); resourceError = new Error("Rust request timeout"); rust?.dispose(); reject(resourceError); }, 10_000); })]) as EvaluationPayload;
      expect(JSON.parse(String(writes!.mock.calls.at(-1)![0])).input).toEqual(JSON.parse(JSON.stringify(prepared.input)));
      check("Rust", () => assertPayload(production!));
      if (c.historical) check("TS/Rust parity", () => expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference)));
    } catch (e) { failures.push(`Rust request: ${String(e)}`); }
    finally { clearTimeout(timer); }
  } else failures.push("normal Rust eligibility false");
  record("raw.ndjson", { id: c.id, sha256, phase: "after-rust", production, failures });
  results.push({ id: c.id, sha256, status: failures.length ? "UNRESOLVED" : "PASS", rustEligible: prepared.rustEligible, failures });
  if (mode === "verify") expect(failures, c.id).toEqual([]);
}, 60_000);
