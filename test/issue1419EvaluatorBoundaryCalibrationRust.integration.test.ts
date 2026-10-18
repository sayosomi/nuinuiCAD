import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import historical from "./fixtures/issue1412/adjacent.json";

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
  const started = Date.now();
  const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
  beforeAll(() => {
    if (evidence) mkdirSync(evidence, { recursive: true });
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
      const metrics = { counts, elapsedMs: Date.now() - started };
      if (evidence) appendFileSync(join(evidence, "runs.ndjson"), JSON.stringify(metrics) + "\n");
      console.info(`Stage 3 metrics ${JSON.stringify(metrics)}`);
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
    let negativeOptions = { ...options };
    let boundary: string;
    let assertBoundary: (input: EvaluateDocumentInput) => void;
    if (id === "X02") {
      const a = corrupt.elements.find(e => e.name === "A")!;
      const plans = corrupt.bindingVersions!.immutableForGroups!;
      const childPlan = plans.find(p => p.geometryCarries?.some(c => c.initializerTarget.statementId === a.id))!;
      expect(childPlan).toBeDefined();
      const childBinding = childPlan.geometryCarries![0].bindingId;
      expect(plans.some(p => p !== childPlan && p.geometryCarries?.some(c => c.nextTarget.kind === "geometryCarry" && c.nextTarget.bindingId === childBinding))).toBe(true);
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
      target.bindingId = `module-binding:5:carry${entry.occurrence.instancePath!.map(p => `${p.length}:${p}`).join("")}${target.bindingId.length}:${target.bindingId}`;
      target.statementId = target.bindingId;
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
  }, 20_000);
});
