import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput, type EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import historical from "./fixtures/issue1412/adjacent.json";
import manifest from "./fixtures/issue1419/manifest.json";
import regressions from "./fixtures/issue1419/regressions.json";
import { checkCompiler, checkValues } from "./fixtures/issue1419/assertions";
import { blank, configuration, json, makePair, replaySeed, slotFor, type Program } from "./fixtures/issue1419/model";

const evidence = process.env.ISSUE1419_EVIDENCE;
const hashText = (s: string) => createHash("sha256").update(s).digest("hex");

describe("Issue #1419 evaluator boundary detector calibration and Stage 3", () => {
  let rust: RustEvaluationProcess;
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed: Promise<void> | undefined;
  let writes: ReturnType<typeof vi.spyOn>;
  let watchdog: ReturnType<typeof setTimeout>;
  let disposing = false;
  let resourceError: Error | undefined;
  const counts = { compiler: 0, reference: 0, production: 0 };
  const accepted = new Set<string>(), calibrated = new Set<string>();
  const dispositions: Record<string, unknown>[] = [];
  const started = Date.now();
  const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
  beforeAll(() => {
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      try { for (const hash of readFileSync(join(evidence, "accepted.sha256"), "utf8").trim().split("\n")) if (hash) accepted.add(hash); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
    // Reuse the Stage 1/2 persistent production client and lifecycle pattern.
    rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
      spawnProcess: ((...args: Parameters<typeof spawn>) => {
        child = spawn(...args) as ChildProcessWithoutNullStreams;
        closed = new Promise(resolve => {
          child!.once("close", (code, signal) => {
            if (!disposing) resourceError = new Error(`unexpected Rust close ${code}/${signal}`);
            resolve();
          });
          child!.once("error", error => { resourceError = error; });
        });
        child.stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (!disposing || !["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) resourceError = error;
        });
        writes = vi.spyOn(child.stdin, "write");
        return child;
      }) as typeof spawn
    });
    watchdog = setTimeout(() => { resourceError = new Error("Stage 3 process lifetime exceeded 10 minutes"); rust.dispose(); }, 600_000);
  }, 130_000);
  afterAll(async () => {
    clearTimeout(watchdog);
    disposing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust teardown exceeded 5 seconds")); }, 5_000);
    });
    try { rust?.dispose(); if (closed) await Promise.race([closed, stopped]); }
    finally {
      clearTimeout(timer); writes?.mockRestore();
      const metrics = { counts, uniqueAccepted: accepted.size, elapsedMs: Date.now() - started, dispositions };
      if (evidence) appendFileSync(join(evidence, "runs.ndjson"), JSON.stringify(metrics) + "\n");
      console.info(`Stage 3 metrics ${JSON.stringify({ counts, uniqueAccepted: accepted.size, elapsedMs: metrics.elapsedMs, cells: dispositions.length, passed: dispositions.filter(d => d.status === "PASS").length })}`);
    }
    if (resourceError) throw resourceError;
  }, 10_000);

  const production = async (input: EvaluateDocumentInput) => {
    if (resourceError) throw resourceError;
    counts.production++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const payload = await Promise.race([
      rust.request(input),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { resourceError = new Error("persistent Rust request timeout"); rust.dispose(); reject(resourceError); }, 10_000); })
    ]).finally(() => clearTimeout(timer)) as EvaluationPayload;
    expect(JSON.parse(String(writes.mock.calls.at(-1)![0])).input).toEqual(JSON.parse(JSON.stringify(input)));
    return payload;
  };

  for (const id of ["X02", "X05", "X07"]) it(`calibration ${id}`, async () => {
    const source = historical.find(c => c.id === id)!.source;
    counts.compiler++;
    const compiled = compileCanonicalText(initial, source);
    expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
    const fixture = { compiled, elements: compiled.doc.document.elements };
    const options = optionsFor(fixture);
    const prepared = prepareRustEvaluation(fixture.elements, options);
    expect(prepared.rustEligible).toBe(true);
    const resultId = compiled.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === "result")!.id;
    const checkValue = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      const value = result.computedScalarBindings!.get(resultId);
      if (value?.status !== "ok" || value.value.kind !== "number" || Math.abs(value.value.value - 16) > 1e-9)
        throw new Error(`${id} independent value oracle: expected 16 degrees; actual ${JSON.stringify(value)}`);
    };
    const check = (payload: EvaluationPayload) => {
      checkValue(payload);
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]); expect(payload.geometryValueErrors ?? []).toEqual([]);
      // Independently: acos(abs(cos(23° - 7°))) = 16°, with 0 < 16 < 90.
      expect(result.computedScalarBindings!.get(resultId)).toMatchObject({ status: "ok", value: { kind: "number", value: expect.closeTo(16, 9) } });
    };
    counts.reference++;
    const reference = evaluateElementsReferencePayload(fixture.elements, options);
    check(reference);
    const actual = await production(prepared.input); check(actual);
    if (evidence) writeFileSync(join(evidence, `${id}-control.json`), JSON.stringify({ source, sourceHash: hashText(source), input: prepared.input, reference, actual }, null, 2));
    const corrupt = structuredClone(prepared.input);
    let negativeOptions: typeof options;
    let boundary: string;
    let assertBoundary: (input: EvaluateDocumentInput) => void;
    if (id === "X02") {
      const a = corrupt.elements.find(e => e.name === "A")!;
      const plans = corrupt.bindingVersions!.immutableForGroups!;
      const childPlan = plans.find(p => p.geometryCarries?.some(c => (c.initializerTarget as { statementId?: string }).statementId === a.id))!;
      expect(childPlan).toBeDefined();
      const childBinding = childPlan.geometryCarries![0].bindingId;
      expect(plans.some(p => p !== childPlan && p.geometryCarries?.some(c => {
        const target = c.nextTarget as { kind?: string; bindingId?: string };
        return target.kind === "geometryCarry" && target.bindingId === childBinding;
      }))).toBe(true);
      assertBoundary = input => {
        if (!input.bindingVersions!.immutableForGroups!.some(p => p.geometryCarries?.some(c => c.bindingId === childBinding)))
          throw new Error("X02 deferred child carry reference has no owning runtime plan");
      };
      boundary = "deferred child carry reference has no owning runtime plan";
      assertBoundary(prepared.input);
      corrupt.bindingVersions!.immutableForGroups = plans.filter(p => p !== childPlan);
      negativeOptions = { ...options, bindingVersions: { ...options.bindingVersions!, immutableForGroups: new Map([...options.bindingVersions!.immutableForGroups!].filter(([owner]) => owner !== childPlan.ownerStatementId)) } };
    } else if (id === "X05") {
      const entry = corrupt.geometryValueProgram!.find(p => p.occurrence.instancePath?.length === 1)!;
      if (entry.construction.kind !== "reference" || entry.construction.target.kind !== "geometryCarry") throw new Error("X05 missing indexed forwarded carry");
      const target = entry.construction.target;
      const binding = target.bindingId;
      expect(corrupt.bindingVersions!.immutableForGroups!.some(p => p.geometryCarries?.some(c => c.bindingId === binding))).toBe(true);
      const occurrence = entry.occurrence;
      assertBoundary = input => {
        const forwarded = input.geometryValueProgram!.find(p => JSON.stringify(p.occurrence) === JSON.stringify(occurrence))!;
        if (forwarded.construction.kind !== "reference" || forwarded.construction.target.kind !== "geometryCarry" || forwarded.construction.target.bindingId !== binding)
          throw new Error("X05 indexed forwarding changed the already-qualified child carry identity");
      };
      boundary = "indexed forwarding changed the already-qualified child carry identity";
      assertBoundary(prepared.input);
      const double = `module-binding:5:carry${entry.occurrence.instancePath!.map(p => `${p.length}:${p}`).join("")}${target.bindingId.length}:${target.bindingId}`;
      entry.construction = { ...entry.construction, target: { ...target, bindingId: double, statementId: double } };
      negativeOptions = { ...options, geometryValueProgram: corrupt.geometryValueProgram };
    } else {
      const graph = corrupt.scalarExpressionPayload!.conditionalDependencyGraph!;
      const loss = graph.edges.filter(e => e.from.kind === "geometry-value" && e.to.kind === "geometry-value");
      expect(loss).toHaveLength(1);
      const dependent = corrupt.geometryValueProgram!.find(p => p.occurrence.instancePath?.length === 1)!;
      const predecessor = corrupt.geometryValueProgram!.find(p => p.occurrence.instancePath?.length === 2)!;
      expect(predecessor.sourceExecutionPosition!).toBeGreaterThan(dependent.sourceExecutionPosition!);
      expect(predecessor.executionPosition).toBeLessThan(dependent.executionPosition);
      expect(dependent.construction).toMatchObject({ kind: "reference", target: { kind: "geometryValue", occurrence: predecessor.occurrence } });
      assertBoundary = input => {
        if (!input.scalarExpressionPayload!.conditionalDependencyGraph!.edges.some(e => e.from.id === loss[0].from.id && e.to.id === loss[0].to.id))
          throw new Error("X07 dependent release no longer waits for its source-fenced predecessor");
      };
      boundary = "dependent release no longer waits for its source-fenced predecessor";
      assertBoundary(prepared.input);
      graph.edges = graph.edges.filter(e => !loss.includes(e));
      negativeOptions = { ...options, typedDependencyGraph: { ...options.typedDependencyGraph!, edges: graph.edges } };
    }
    expect(() => assertBoundary(corrupt)).toThrow(boundary);
    counts.reference++;
    const negativeReference = evaluateElementsReferencePayload(fixture.elements, negativeOptions);
    const negative = await production(corrupt);
    for (const payload of [negativeReference, negative]) {
      expect(() => checkValue(payload)).toThrow(`${id} independent value oracle: expected 16 degrees`);
      expect(evaluationPayloadToResult(payload).computedScalarBindings!.get(resultId)).toMatchObject({ status: "error", issueCode: "evaluation-geometry-builtin-unavailable" });
      expect(payload.geometryValueErrors).toContainEqual(expect.objectContaining({ message: "Geometry value reference is unavailable at runtime." }));
    }
    if (evidence) writeFileSync(join(evidence, `${id}-negative.json`), JSON.stringify({ input: corrupt, negativeReference, negative, boundary }, null, 2));
    calibrated.add(id);
  }, 20_000);

  it("retains the immutable 64-ID pre-exploration manifest", () => {
    expect(manifest).toEqual([..."RNGD"].flatMap(suite => [1, 2].flatMap(shape => [..."ab"].flatMap(op => [0, 1, 2, 3].map(i => `${suite}-${shape}-${op}-${String(i).padStart(2, "0")}`)))));
    expect(new Set(manifest).size).toBe(64);
    const sources = manifest.flatMap(id => { const slot = slotFor(id); return makePair(slot, fc.sample(configuration, { seed: replaySeed(slot), numRuns: 1 })[0]).map(p => p.source); });
    expect(new Set(sources).size, "no duplicated pair sources").toBe(128);
  });

  const evaluate = async (program: Program, label: string) => {
    if (resourceError) throw resourceError;
    expect(calibrated.size, "Phase A must pass before any novel compilation").toBe(3);
    const hash = hashText(program.source);
    if (!accepted.has(hash) && accepted.size >= 400) throw new Error("400 accepted distinct exploratory source ceiling reached");
    counts.compiler++;
    const compiled = compileCanonicalText(initial, program.source);
    if (compiled.status === "valid" && !compiled.diagnostics.some(d => d.severity === "error") && !accepted.has(hash)) {
      accepted.add(hash); if (evidence) appendFileSync(join(evidence, "accepted.sha256"), hash + "\n");
    }
    const record: Record<string, unknown> = { label, hash, source: program.source, expected: JSON.parse(json({ scalars: program.scalars, geometry: program.geometry, failedGeometry: program.failedGeometry, templates: program.templates, trace: program.trace, diagnostics: program.diagnosticBindings, errors: program.errors, valueErrors: program.valueErrors, errorInstances: program.errorInstances, paths: program.paths })), compilerStatus: compiled.status, diagnostics: compiled.diagnostics };
    try {
      expect(compiled.status, program.source).toBe("valid"); expect(compiled.diagnostics, program.source).toEqual([]);
      const fixture = { compiled, elements: compiled.doc.document.elements };
      const options = optionsFor(fixture), prepared = prepareRustEvaluation(fixture.elements, options);
      record.semanticGeometryValues = compiled.currentCompiled.moduleSemanticAnalysis?.geometryValues;
      record.rustEligible = prepared.rustEligible;
      if (!prepared.rustEligible) expect(program.paths.some(path => path.includes("staged-path") || path.includes("deferred-Module")), "unexpected Rust ineligibility").toBe(true);
      // The existing eligibility predicate rejects path-valued endpoint targets
      // used as point inputs. Retain that fact; exercise the canonical supported
      // direct stdio input with carry plans rather than calling it eligible.
      const input = prepared.rustEligible ? prepared.input : buildRustEvaluationInput(fixture.elements, options);
      record.productionMode = prepared.rustEligible ? "eligible" : "supported-direct-input; path endpoint eligibility exclusion";
      record.input = input;
      const failures: unknown[] = [];
      try { checkCompiler(program, compiled, input); } catch (error) { record.compilerFailure = String(error); failures.push(error); }
      counts.reference++;
      const reference = evaluateElementsReferencePayload(fixture.elements, options); record.reference = reference;
      try { checkValues(program, compiled, reference); } catch (error) { record.referenceFailure = String(error); failures.push(error); }
      const actual = await production(input); record.actual = actual;
      try { checkValues(program, compiled, actual); } catch (error) { record.productionFailure = String(error); failures.push(error); }
      if (failures.length) throw failures[0];
      record.status = "PASS";
    } catch (error) { record.status = "UNRESOLVED"; record.failure = String(error); throw error; }
    finally { if (evidence) appendFileSync(join(evidence, "attempts.ndjson"), JSON.stringify(record) + "\n"); }
    return hash;
  };
  const ids = process.env.ISSUE1419_IDS?.split(",");
  for (const regression of regressions) it(`reduced ${regression.id}`, async () => {
    for (const [kind, source] of [["control", regression.control], ["reproducer", regression.source]]) {
      const program = { ...blank(), source, ...(regression.expected === null ? { geometry: regression.geometry ? [{ name: "Observed", at: [0], value: regression.geometry }] : [], carries: regression.carries ?? ["Points"] } : { scalars: { Result: BigInt(regression.expected) }, carries: regression.carries ?? ["Outer", "Inner"] }), errors: regression.errors ?? [], paths: regression.paths ?? ["reduced-boundary"] };
      if (regression.scalars) program.scalars = Object.fromEntries(Object.entries(regression.scalars).map(([k, v]) => [k, typeof v === "number" ? BigInt(v) : v]));
      if (regression.expected === null) program.templates = ["Observed"];
      if (regression.diagnosticBindings) program.diagnosticBindings = regression.diagnosticBindings;
      if (kind === "reproducer" && regression.valueErrors) program.valueErrors = regression.valueErrors;
      await evaluate(program, `${regression.id}-${kind}`);
    }
  });
  const wave = process.env.ISSUE1419_WAVE;
  const ordered = [...manifest.filter(id => slotFor(id).configuration < 2), ...manifest.filter(id => slotFor(id).configuration >= 2)];
  for (const id of ordered.filter(id => (!ids || ids.includes(id)) && (!wave || (slotFor(id).configuration < 2 ? "first" : "later") === wave))) it(id, async () => {
    const slot = slotFor(id), seed = replaySeed(slot);
    let hashes: string[] = [], expected: unknown;
    const run = await fc.check(fc.asyncProperty(configuration, async config => {
      const pair = makePair(slot, config);
      expect(pair[0].source).not.toBe(pair[1].source);
      expected = JSON.parse(json(pair[0]));
      hashes = [];
      for (const [index, program] of pair.entries()) {
        hashes.push(await evaluate(program, `${id}-${index === 0 ? "A" : "B"}`));
        if (program.selectedControl) await evaluate(program.selectedControl, `${id}-${index === 0 ? "A" : "B"}-selected-control`);
      }
    }), { seed, numRuns: 1, ...(process.env.ISSUE1419_PATH ? { path: process.env.ISSUE1419_PATH } : {}), interruptAfterTimeLimit: 25_000, markInterruptAsFailure: true });
    dispositions.push({ id, status: run.failed ? "UNRESOLVED" : "PASS", hashes, expected, seed, path: run.counterexamplePath, shrinks: run.numShrinks });
    if (run.failed) throw new Error(`${id}: fast-check seed=${seed} path=${run.counterexamplePath} shrinks=${run.numShrinks}\n${String(run.errorInstance)}`, { cause: run.errorInstance });
  }, 30_000);
});
