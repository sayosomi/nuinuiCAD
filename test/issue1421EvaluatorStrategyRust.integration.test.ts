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
import { checkCompiler, checkValues, recordsIn } from "./fixtures/issue1419/assertions";
import { json } from "./fixtures/issue1419/model";
import { matrix, pair, type Candidate } from "./fixtures/issue-stage4/model";
import { independentOracle } from "./fixtures/issue-stage4/oracles";
import { repairCandidates } from "./fixtures/issue-stage4/repairs";

const root = "test/fixtures/issue-stage4";
const evidence = process.env.ISSUE1421_EVIDENCE;
const mode = process.env.ISSUE1421_MODE ?? "verify";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
const pilotIds = matrix.filter(id => Number(id.split("-")[2]) < 2);
const allPilot = pilotIds.flatMap(pair);
const freezeFile = join(root, "pilot.json");
const frozen = () => allPilot.map(c => ({ ...JSON.parse(json(c)), independentOracle: JSON.parse(json(independentOracle(c))), sha256: hash(c.program.source) }));
const selectionFile = join(root, "selection.json");
const selected: Record<string, string> = existsSync(selectionFile) ? JSON.parse(readFileSync(selectionFile, "utf8")).methods : {};
const adaptiveIds = matrix.filter(id => Number(id.split("-")[2]) >= 2 && selected[id[0]] === id[2]);
const ids = process.env.ISSUE1421_IDS?.split(",");
const cases = (mode === "repairs" ? [] : mode === "pilot" ? pilotIds : mode === "adaptive" ? adaptiveIds : [...pilotIds, ...adaptiveIds]).filter(id => !ids || ids.includes(id));

describe("Issue #1421 Stage 4 using the Stage 3 compiler/oracle/persistent-stdio boundaries", () => {
  let rust: RustEvaluationProcess;
  let child: ChildProcessWithoutNullStreams | undefined, closed: Promise<void> | undefined;
  let disposing = false, resourceError: Error | undefined;
  let watchdog: ReturnType<typeof setTimeout>;
  const counts = { compiler: 0, reference: 0, production: 0 };
  const started = Date.now(), accepted = new Set<string>();
  const dispositions: unknown[] = [];
  beforeAll(() => {
    // Historical accepted texts still consume the Issue's global ceiling even
    // when a continuation uses a new directory for raw run evidence.
    const historicalLedger = join(root, "accepted.sha256");
    if (existsSync(historicalLedger)) for (const h of readFileSync(historicalLedger, "utf8").trim().split("\n")) if (h) accepted.add(h);
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
      console.info(`Stage 4 ${JSON.stringify({ mode, counts, uniqueAccepted: accepted.size, elapsedMs: metrics.elapsedMs, cells: dispositions.length })}`);
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
    for (const c of allPilot) {
      const view = (p: Candidate["program"]) => ({ scalars: p.scalars, geometry: p.geometry, errors: p.errors, diagnosticBindings: p.diagnosticBindings, absent: p.absent });
      expect(c.limits ? c.limits.map(l => ({ ...view(l.expected), instances: l.instances })) : view(c.program), `${c.id}/${c.member}: independent closed-form oracle`).toEqual(independentOracle(c));
    }
    if (mode === "freeze") {
      const rejections: unknown[] = [];
      for (const c of allPilot) {
        const compiled = compile(c);
        let shapeError: string | undefined;
        try {
          // Compiler acceptance alone did not detect the original malformed
          // drawable name. Check the intended authored shape before freezing.
          expect(compiled.doc.document.elements.some(e => /[()]/.test(e.name))).toBe(false);
          if (c.stratum === "E") {
            expect(compiled.doc.document.elements.filter(e => e.type === "moduleInstance")).toHaveLength(3);
            expect(compiled.doc.document.elements.filter(e => /^(Renamed)?Fault$/.test(e.name))).toHaveLength(3);
            for (const fault of compiled.doc.document.elements.filter(e => /^(Renamed)?Fault$/.test(e.name))) {
              expect(fault.parentGroupId, "Fault belongs to its authored conditional owner").toBeDefined();
              const owner = compiled.doc.document.elements.find(e => e.id === fault.parentGroupId);
              expect(owner, "conditional owner is a canonical element").toMatchObject({ type: "conditionalGroup" });
            }
          }
        } catch (error) { shapeError = String(error); }
        if (compiled.status !== "valid" || compiled.diagnostics.length || shapeError) rejections.push({ id: c.id, member: c.member, sha256: hash(c.program.source), source: c.program.source, status: compiled.status, diagnostics: compiled.diagnostics, shapeError });
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
    const t = Date.now(), record: Record<string, unknown> = { id: c.id, member: c.member, method: c.method, stratum: c.stratum, purpose: mode === "repairs" ? "minimization/regression" : "pilot", sha256: hash(c.program.source), source: c.program.source, expected: JSON.parse(json(c.limits ?? c.program)), activationClaims: c.activation };
    const failures: string[] = [];
    let boundary = "compiler";
    const capture = (boundary: string, action: () => void) => { try { action(); } catch (error) { failures.push(`${boundary}: ${String(error)}`); } };
    try {
      const compiled = compile(c);
      record.compilerStatus = compiled.status; record.compilerDiagnostics = compiled.diagnostics;
      expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
      const fixture = { compiled, elements: compiled.doc.document.elements };
      const p = c.program;
      record.elements = fixture.elements;
      record.bindingCatalog = compiled.doc.bindingAnalysis!.catalog.bindings;
      if (mode === "repairs") {
        record.dependencyGraph = compiled.doc.typedDependencyGraph;
        record.bindingVersionOrders = compiled.doc.bindingVersions?.versions.map(v => ({ bindingId: v.bindingId, sourceOrder: v.sourceOrder, initialState: v.initialState }));
      }
      const placements = c.limits ?? [{ placement: "full", through: undefined, expected: p, instances: [] }];
      const observations: unknown[] = [];
      record.observations = observations;
      // A final full→zero replay tests persistent-process request isolation.
      const ordered = c.limits?.length === 4 ? [...placements, placements[0], placements[3]] : placements;
      for (const limit of ordered) {
        const through = limit.through ? fixture.elements.findIndex(e => e.name === limit.through) : undefined;
        if (limit.through) expect(through, "limit source owner must exist").toBeGreaterThanOrEqual(0);
        const index = c.limits ? (through === undefined ? 0 : through + 1) : undefined;
        const options = optionsFor({ ...fixture, evaluationLimitIndex: index });
        boundary = "payload-preparation";
        const prepared = prepareRustEvaluation(fixture.elements, options);
        expect(prepared.rustEligible, "normal host eligibility; no fabricated parity").toBe(true);
        const observation: Record<string, unknown> = { placement: limit.placement, evaluationLimitIndex: index, rustEligible: prepared.rustEligible, input: prepared.input };
        observations.push(observation);
        capture("compiler/payload", () => {
          if (c.stratum === "C") { checkCompiler(p, compiled, prepared.input); return; }
          expect(compiled.doc.bindingAnalysis!.issues).toEqual([]);
          expect(compiled.doc.typedDependencyGraph!.cycles).toEqual([]);
          if (c.id === "P1-reproducer") for (const fault of fixture.elements.filter(e => e.name === "Fault")) {
            expect(compiled.doc.typedDependencyGraph!.edges.some(edge => edge.from.kind === "element" && edge.from.id === fault.id && edge.to.kind === "element" && edge.to.id === fault.parentGroupId && edge.requiredness === "required"), "canonical child waits for its statement condition").toBe(true);
          }
          if (c.id === "P3-reproducer") {
            const parameter = compiled.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === "X")!;
            expect(compiled.doc.bindingVersions!.versions.find(v => v.bindingId === parameter.id)?.sourceOrder, "instance event 0, parameter event 1; catalog rank is not execution order").toBe(1);
          }
          for (const name of Object.keys(p.scalars)) expect(compiled.doc.bindingAnalysis!.catalog.bindings.filter(b => b.name === name), `canonical binding ${name}`).toHaveLength(1);
          const wire = prepared.input;
          const occurrences = new Set(wire.geometryValueProgram?.map(entry => JSON.stringify(entry.occurrence)));
          for (const target of recordsIn(wire).filter(r => r.kind === "geometryValue" && r.occurrence)) {
            if (occurrences.has(JSON.stringify(target.occurrence))) continue;
            expect(c.stratum, "only the declared disabled D owner may omit its program").toBe("D");
            const occurrence = target.occurrence as { instancePath: string[] };
            const owner = wire.moduleMaterialization?.instances.find(i => json(i.instancePath) === json(occurrence.instancePath));
            expect(owner, "missing value has an exact canonical Module owner").toBeDefined();
            let element = wire.elements.find(e => e.id === owner!.instanceId);
            const ancestors = [];
            while (element) { ancestors.push(element); element = wire.elements.find(e => e.id === element!.parentGroupId); }
            expect(ancestors.some(e => e.enabled === false), "direct or ancestor computation gate suppresses this exact Module").toBe(true);
          }
        });
        const check = (payload: EvaluationPayload, runtime: string) => {
          if (!c.limits) {
            checkValues(p, compiled, payload);
            if (c.stratum === "D") expect([...evaluationPayloadToResult(payload).computedGeometry.values()].map(g => g.name).sort(), "exact surviving D output; disabled owners stay absent").toEqual(p.geometry.map(g => g.name).sort());
            return;
          }
          const result = evaluationPayloadToResult(payload);
          const snapshots = compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots;
          const name = (id: string) => {
            const element = fixture.elements.find(e => e.id === id)!;
            const owner = snapshots.find(s => s.descendantIds.includes(id));
            return owner ? `${fixture.elements.find(e => e.id === owner.instanceId)!.name}::${element.name}` : element.name;
          };
          const exact = (part: string, action: () => void) => capture(`${runtime}/${limit.placement}/${part}`, action);
          exact("drawable-output", () => {
            expect([...result.computedGeometry.keys()].map(name).sort(), "exact materialized geometry set").toEqual(limit.expected.geometry.map(o => o.name).sort());
            for (const observation of limit.expected.geometry) {
              const entry = [...result.computedGeometry].find(([id]) => name(id) === observation.name);
              expect(entry?.[1]).toMatchObject({ kind: "point", ...observation.value });
            }
          });
          exact("diagnostic-owners", () => {
            expect(result.errors.map(e => name(e.elementId)).sort(), "precise failed owner; dependents suppressed").toEqual([...limit.expected.errors].sort());
            for (const error of result.errors) expect(error.missingDependencyId).toBe("1 / 0");
          });
          exact("instance-snapshots", () => {
            expect([...(result.instanceBaseGeometry?.keys() ?? [])].map(id => name(id)).sort(), "atomic instance snapshots").toEqual([...limit.instances].sort());
            for (const snapshot of payload.instanceBaseGeometry ?? []) {
              const expected = limit.expected.geometry.filter(g => g.name.startsWith(`${name(snapshot.instanceId)}::`));
              expect(snapshot.geometry.map(g => name(g.elementId)).sort(), "complete atomic base snapshot contents").toEqual(expected.map(g => g.name).sort());
              for (const observation of expected) expect(snapshot.geometry.find(g => name(g.elementId) === observation.name)).toMatchObject({ kind: "point", ...observation.value });
            }
          });
          exact("value-diagnostic-owners", () => {
            // nui1's immutable geometry values are source-only, not drawable
            // elements (spec §Immutable single-geometry reference values).
            // The drawable limit does not specify private cache population.
            // Root aliases may report an unavailable export outside the limit;
            // that is distinct from a leaked Module-owned failure diagnostic.
            for (const error of payload.geometryValueErrors ?? []) {
              expect(error.occurrence.instancePath, "no excluded or stale Module-owned value error").toEqual([]);
              const index = [...compiled.doc.statementMap.statementIdByStatementIndex!].find(([, id]) => id === error.occurrence.sourceStatementId)?.[0];
              const statement = index === undefined ? undefined : compiled.doc.statements[index];
              const sourceName = statement && "name" in statement ? statement.name : undefined;
              const aliases = ["One", "Two"].map(instance => c.member === "T" && c.variant % 2 === 0 ? `Renamed${instance}` : instance)
                .filter(instance => !limit.instances.includes(instance)).map(instance => `Export${instance}`);
              expect(c.member === "T" && c.variant % 2 === 1).toBe(true);
              expect(aliases, "exact source-only unavailable alias owner").toContain(sourceName);
              expect(error.message).toBe("Geometry value reference is unavailable at runtime.");
            }
          });
        };
        // Persist the input before either evaluator runs. A failure in one
        // boundary must not erase its evidence or suppress the other runtime.
        counts.reference++;
        try {
          const reference = evaluateElementsReferencePayload(fixture.elements, options);
          observation.reference = reference;
          capture(`TS/${limit.placement}`, () => check(reference, "TS"));
        } catch (error) { observation.referenceError = String(error); failures.push(`TS/execution/${limit.placement}: ${String(error)}`); }
        try {
          const actual = await production(prepared.input);
          observation.actual = actual;
          capture(`Rust/${limit.placement}`, () => check(actual, "Rust"));
        } catch (error) { observation.productionError = String(error); failures.push(`Rust/execution/${limit.placement}: ${String(error)}`); }
      }
    } catch (error) { failures.push(`${boundary}: ${String(error)}`); }
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
  if (mode === "repairs" || mode === "verify") for (const c of repairCandidates.filter(c => !ids || ids.includes(c.id))) it(c.id, async () => {
    const result = await evaluate(c);
    dispositions.push({ id: c.id, status: result.status, failures: result.failures });
    expect(result.failures, c.id).toEqual([]);
  }, 60_000);
});
