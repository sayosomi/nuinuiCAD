import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import { checkCompiler, checkValues } from "./fixtures/issue1419/assertions";
import { json } from "./fixtures/issue1419/model";
import { matrix, pair, type Candidate } from "./fixtures/issue-stage4/model";

const root = "test/fixtures/issue-stage4";
const evidence = process.env.ISSUE1421_EVIDENCE;
const mode = process.env.ISSUE1421_MODE ?? "verify";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
const pilotIds = matrix.filter(id => Number(id.split("-")[2]) < 2);
const allPilot = pilotIds.flatMap(pair);
const freezeFile = join(root, "pilot.json");
const frozen = () => allPilot.map(c => ({ ...JSON.parse(json(c)), sha256: hash(c.program.source) }));
const selectionFile = join(root, "selection.json");
const selected: Record<string, string> = existsSync(selectionFile) ? JSON.parse(readFileSync(selectionFile, "utf8")).methods : {};
const adaptiveIds = matrix.filter(id => Number(id.split("-")[2]) >= 2 && selected[id[0]] === id[2]);
const ids = process.env.ISSUE1421_IDS?.split(",");
const cases = (mode === "pilot" ? pilotIds : mode === "adaptive" ? adaptiveIds : [...pilotIds, ...adaptiveIds]).filter(id => !ids || ids.includes(id));

describe("Issue #1421 Stage 4 using the Stage 3 compiler/oracle/persistent-stdio boundaries", () => {
  let rust: RustEvaluationProcess;
  let child: ChildProcessWithoutNullStreams | undefined, closed: Promise<void> | undefined;
  let disposing = false, resourceError: Error | undefined;
  let watchdog: ReturnType<typeof setTimeout>;
  const counts = { compiler: 0, reference: 0, production: 0 };
  const started = Date.now(), accepted = new Set<string>();
  const dispositions: unknown[] = [];
  beforeAll(() => {
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      const ledger = join(evidence, "accepted.sha256");
      if (existsSync(ledger)) for (const h of readFileSync(ledger, "utf8").trim().split("\n")) if (h) accepted.add(h);
    }
    if (mode === "freeze") return;
    expect(JSON.parse(readFileSync(freezeFile, "utf8")), "complete pilot must be frozen before evaluation").toEqual(frozen());
    execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
    // Stage 3's production client, bounded requests and close-before-dispose
    // lifecycle, with listeners installed before any transition is triggered.
    rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
      spawnProcess: ((...args: Parameters<typeof spawn>) => {
        child = spawn(...args) as ChildProcessWithoutNullStreams;
        closed = new Promise(resolve => {
          child!.once("close", (code, signal) => { if (!disposing) resourceError = new Error(`unexpected Rust close ${code}/${signal}`); resolve(); });
          child!.once("error", error => { resourceError = error; });
        });
        child.stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (!disposing || !["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) resourceError = error;
        });
        return child;
      }) as typeof spawn
    });
    watchdog = setTimeout(() => { resourceError = new Error("Stage 4 process exceeded 10 minutes"); rust.dispose(); }, 600_000);
  }, 130_000);
  afterAll(async () => {
    clearTimeout(watchdog); disposing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { if (closed) timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust teardown exceeded 5 seconds")); }, 5_000); });
      rust?.dispose(); if (closed) await Promise.race([closed, timeout]);
    } finally {
      clearTimeout(timer);
      const metrics = { mode, started, ended: Date.now(), elapsedMs: Date.now() - started, counts, uniqueAccepted: accepted.size, dispositions };
      if (evidence) appendFileSync(join(evidence, "runs.ndjson"), JSON.stringify(metrics) + "\n");
      console.info(`Stage 4 ${JSON.stringify(metrics)}`);
    }
    if (resourceError) throw resourceError;
  }, 10_000);

  function compile(c: Candidate) {
    const sha256 = hash(c.program.source);
    if (!accepted.has(sha256) && accepted.size >= 200) throw new Error("200 novel accepted exploratory text ceiling");
    counts.compiler++;
    const compiled = compileCanonicalText(initial, c.program.source);
    if (compiled.status === "valid" && !compiled.diagnostics.some(d => d.severity === "error")) {
      if (!accepted.has(sha256)) {
        accepted.add(sha256);
        if (evidence) appendFileSync(join(evidence, "accepted.sha256"), sha256 + "\n");
      }
    }
    return compiled;
  }

  it("freezes all 18 pilot pairs and independent oracles before evaluation", () => {
    expect(new Set(allPilot.map(c => c.program.source)).size).toBe(36);
    if (mode === "freeze") {
      const rejections: unknown[] = [];
      for (const c of allPilot) {
        const compiled = compile(c);
        if (compiled.status !== "valid" || compiled.diagnostics.length) rejections.push({ id: c.id, member: c.member, sha256: hash(c.program.source), source: c.program.source, status: compiled.status, diagnostics: compiled.diagnostics });
      }
      if (evidence) writeFileSync(join(evidence, `prevalidation-${Date.now()}.json`), json({ counts, rejections }));
      expect(rejections).toEqual([]);
      writeFileSync(freezeFile, JSON.stringify(frozen(), null, 2) + "\n");
    } else expect(JSON.parse(readFileSync(freezeFile, "utf8"))).toEqual(frozen());
  });

  async function production(input: Parameters<RustEvaluationProcess["request"]>[0]) {
    if (resourceError) throw resourceError;
    counts.production++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return await Promise.race([rust.request(input), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { resourceError = new Error("persistent Rust request exceeded 10 seconds"); rust.dispose(); reject(resourceError); }, 10_000);
    })]).finally(() => clearTimeout(timer)) as EvaluationPayload;
  }

  async function evaluate(c: Candidate) {
    const t = Date.now(), record: Record<string, unknown> = { id: c.id, member: c.member, sha256: hash(c.program.source), activationClaims: c.activation };
    const failures: string[] = [];
    const capture = (boundary: string, action: () => void) => { try { action(); } catch (error) { failures.push(`${boundary}: ${String(error)}`); } };
    const compiled = compile(c);
    record.compilerStatus = compiled.status; record.compilerDiagnostics = compiled.diagnostics;
    try {
      expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
      const fixture = { compiled, elements: compiled.doc.document.elements };
      const p = c.program;
      const placements = c.limits ?? [{ placement: "full", through: undefined, expected: p, instances: [] }];
      const observations: unknown[] = [];
      // A final full→zero replay tests persistent-process request isolation.
      const ordered = c.limits ? [...placements, placements[0], placements[3]] : placements;
      for (const limit of ordered) {
        const index = c.limits ? (limit.through ? fixture.elements.findIndex(e => e.name === limit.through) + 1 : 0) : undefined;
        const options = optionsFor({ ...fixture, evaluationLimitIndex: index });
        const prepared = prepareRustEvaluation(fixture.elements, options);
        expect(prepared.rustEligible, "normal host eligibility; no fabricated parity").toBe(true);
        capture("compiler/payload", () => checkCompiler(p, compiled, prepared.input));
        counts.reference++;
        const reference = evaluateElementsReferencePayload(fixture.elements, options);
        const actual = await production(prepared.input);
        const check = (payload: EvaluationPayload) => {
          if (!c.limits) { checkValues(p, compiled, payload); return; }
          const result = evaluationPayloadToResult(payload);
          const snapshots = compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots;
          const name = (id: string) => {
            const element = fixture.elements.find(e => e.id === id)!;
            const owner = snapshots.find(s => s.descendantIds.includes(id));
            return owner ? `${fixture.elements.find(e => e.id === owner.instanceId)!.name}::${element.name}` : element.name;
          };
          expect([...result.computedGeometry.keys()].map(name).sort(), "exact materialized geometry set").toEqual(limit.expected.geometry.map(o => o.name).sort());
          for (const observation of limit.expected.geometry) {
            const entry = [...result.computedGeometry].find(([id]) => name(id) === observation.name);
            expect(entry?.[1]).toMatchObject({ kind: "point", ...observation.value });
          }
          expect(result.errors.map(e => name(e.elementId)).sort(), "precise failed owner; dependents suppressed").toEqual([...limit.expected.errors].sort());
          expect([...(result.instanceBaseGeometry?.keys() ?? [])].map(id => name(id)).sort(), "atomic instance snapshots").toEqual([...limit.instances].sort());
          expect(payload.geometryValueErrors ?? [], "no excluded/stale Module diagnostics").toEqual([]);
          for (const entry of result.computedGeometryValues?.values() ?? []) {
            const owner = snapshots.find(s => JSON.stringify(s.instancePath) === JSON.stringify(entry.occurrence.instancePath));
            if (owner) expect(limit.instances).toContain(name(owner.instanceId));
          }
        };
        capture(`TS/${limit.placement}`, () => check(reference)); capture(`Rust/${limit.placement}`, () => check(actual));
        observations.push({ placement: limit.placement, evaluationLimitIndex: index, rustEligible: prepared.rustEligible, input: prepared.input, reference, actual });
      }
      record.observations = observations;
    } catch (error) { failures.push(`compile/resource: ${String(error)}`); }
    record.failures = failures; record.status = failures.length ? "UNRESOLVED" : "PASS"; record.elapsedMs = Date.now() - t;
    if (evidence) appendFileSync(join(evidence, "attempts.ndjson"), json(record) + "\n");
    return record;
  }

  if (mode !== "freeze") for (const id of cases) it(id, async () => {
    const results = [];
    for (const c of pair(id)) results.push(await evaluate(c));
    dispositions.push({ id, members: results.map(r => ({ member: r.member, status: r.status, failures: r.failures, elapsedMs: r.elapsedMs })) });
    expect(results.flatMap(r => r.failures as string[]), id).toEqual([]);
  }, 60_000);
});
