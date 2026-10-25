// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { compileModulePreviewRoot } from "../dsl/modulePreviewRoot";
import { queryModulePreviewTarget } from "../dsl/modulePreviewTarget";
import { createModulePreviewSession } from "../dsl/modulePreviewState";
import { buildModulePreviewEvaluationOptions } from "./modulePreviewEvaluation";
import { modulePreviewValueSnapshotFor, modulePreviewValueSummaryFor } from "./modulePreviewValueProjection";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { evaluatePreparedRust, prepareRustEvaluation, type RustEvaluationTransport } from "../geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../node/rustEvaluationProcess";
import type { EvaluationPayload } from "../geometry/evaluationPayload";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { evaluateOutputPlan, type OutputPlan, type OutputText } from "../output/outputCore";
import { outputPreviewGuideLinesFor, outputPreviewPageRectsFor, outputPreviewPathDataFor, outputPreviewScreenPointFor, outputPreviewTextTransformFor } from "./outputPreviewRendering";
import { fitOutputPreviewViewport, outputPreviewFitBoundsFor, outputPreviewScreenToWorld } from "./outputPreviewViewport";
import { loadFreshNuiDocumentSnapshot } from "../../mcp-server/src/documentSnapshot";
import { evaluateNuiDocument } from "../../mcp-server/src/documentEvaluation";

type Point = [number, number];
type Frozen = {
  id: string; source: string; sha256: string; revised?: string; revisedSha256?: string;
  invalid?: string; invalidSha256?: string; target?: string;
  arguments?: { name: string; expression: string }[];
  ancestor?: { name: string; arguments: { name: string; expression: string }[] };
  expected: Record<string, unknown>; control?: Record<string, Point | Point[]>;
};
const root = "test/fixtures/issue-1460/";
const cases: Frozen[] = JSON.parse(readFileSync(`${root}cases.json`, "utf8"));
const reducers: Frozen[] = JSON.parse(readFileSync(`${root}reducers.json`, "utf8"));
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const near = (a: number, b: number) => expect(Math.abs(a - b), `${a} != ${b}`).toBeLessThan(1e-8);
const xy = (p: { x: number; y: number }): Point => [p.x, p.y];
const point = (a: { x: number; y: number }, b: Point) => { near(a.x, b[0]); near(a.y, b[1]); };
const nums = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const numbers = (a: number[], b: number[]) => { expect(a).toHaveLength(b.length); a.forEach((x, i) => near(x, b[i])); };
const size = { width: 600, height: 400 };
const viewport = { panX: 17, panY: -11, zoom: 2 };
const screen = (p: Point): Point => [317 + 2 * p[0], 189 - 2 * p[1]];
const observations: object[] = [];
const compile = (source: string) => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  expect(result.doc.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  expect((result.doc.bindingIssueDiagnostics ?? []).filter(d => d.severity === "error")).toEqual([]);
  return result.doc;
};
type Compiled = ReturnType<typeof compile>;
const compiled = new Map<string, Compiled>();
const bounded = async <T,>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Issue 1460 request exceeded 15 seconds")), 15000); })]); }
  finally { clearTimeout(timer); }
};
let rust: RustEvaluationProcess;
let child: ChildProcessWithoutNullStreams;
let closed: Promise<void> | undefined;
let resourceError: Error | undefined;
let directory: string;
let requests = 0;
const transport: RustEvaluationTransport = async input => {
  ++requests;
  return await bounded(rust.request(input)) as EvaluationPayload;
};
const evaluate = async (elements: CadElement[], options: Parameters<typeof prepareRustEvaluation>[1]) => {
  const prepared = prepareRustEvaluation(elements, options);
  expect(prepared.rustEligible, "ordinary production Rust eligibility").toBe(true);
  const result = await evaluatePreparedRust(prepared, transport);
  expect(result.errors).toEqual([]);
  return result;
};
const canonical = (doc: Compiled, profile?: string) => evaluate(doc.document.elements, buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: doc.document.evaluationLimitIndex, selectedDrawingProfileId: profile }));
const one = (result: EvaluationResult, name: string) => {
  const matches = [...result.computedGeometry.values()].filter(g => g.name === name);
  expect(matches, name).toHaveLength(1);
  return matches[0];
};
const pointGeometry = (g: ComputedGeometry): Extract<ComputedGeometry, { kind: "point" }> => {
  expect(g?.kind).toBe("point");
  if (g.kind !== "point") throw new Error("expected point");
  return g;
};
const instanceIds = (doc: Compiled, name: string) => {
  const instance = doc.moduleSemanticAnalysis!.instances.find(i => i.name === name)!;
  expect(instance, name).toBeDefined();
  return new Set([...doc.moduleMaterialization!.originByRuntimeElementId].filter(([, o]) => o.instancePath[0] === instance.statementId).map(([id]) => id));
};
const subset = (result: EvaluationResult, ids: ReadonlySet<string>) => ({ ...result, computedGeometry: new Map([...result.computedGeometry].filter(([id]) => ids.has(id))) });
const checkPoints = (result: EvaluationResult, expected: Record<string, unknown>) => {
  for (const [name, value] of Object.entries(expected)) {
    const list = (Array.isArray(value) && Array.isArray(value[0]) ? value : [value]) as Point[];
    const matches = [...result.computedGeometry.values()].filter(g => g.name === name);
    expect(matches, name).toHaveLength(list.length);
    matches.forEach((g, i) => point(pointGeometry(g), list[i]));
  }
};
const checkCurve = (result: EvaluationResult, expected: Record<string, unknown>) => {
  point(pointGeometry(one(result, "P")), expected.point as Point);
  const curve = one(result, "Curve");
  expect(curve.kind).toBe("bezierCurve");
  if (curve.kind !== "bezierCurve") throw new Error("expected cubic");
  expect(curve.segments).toHaveLength(1);
  const segment = curve.segments[0];
  for (const key of ["start", "control1", "control2", "end"] as const) point(segment[key], expected[key] as Point);
};

beforeAll(() => {
  // Compiler/source identity is frozen for the entire matrix before product observation.
  for (const c of [...cases, ...reducers]) {
    expect(hash(c.source)).toBe(c.sha256);
    compiled.set(c.id, compile(c.source));
    if (c.revised) { expect(hash(c.revised)).toBe(c.revisedSha256); compiled.set(`${c.id}:revised`, compile(c.revised)); }
    if (c.invalid) expect(hash(c.invalid)).toBe(c.invalidSha256);
  }
  if (process.env.ISSUE1460_COMPILE_ONLY === "1") return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000 });
  directory = mkdtempSync(join(tmpdir(), "nuinui-1460-"));
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", { spawnProcess: ((...args: Parameters<typeof spawn>) => {
    child = spawn("/bin/sh", ["-c", 'ulimit -t 60 || exit 1; exec "$@"', "issue1460-rust", args[0]], { stdio: ["pipe", "pipe", "pipe"] });
    const memory = setInterval(() => {
      try {
        const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 }));
        if (rss > 512 * 1024) { resourceError = new Error("Issue 1460 Rust RSS exceeded 512 MiB"); rust.dispose(); }
      } catch { /* Process can exit between sampling and its close event. */ }
    }, 200);
    closed = new Promise(resolve => {
      child.once("close", () => { clearInterval(memory); resolve(); });
      child.once("error", error => { resourceError = error; clearInterval(memory); resolve(); });
    });
    return child;
  }) as typeof spawn });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (directory) rmSync(directory, { recursive: true, force: true });
  if (process.env.ISSUE1460_EVIDENCE) writeFileSync(process.env.ISSUE1460_EVIDENCE, JSON.stringify({ requests, observations, resourceError: resourceError?.message, childClosed: closed ? child.exitCode !== null || child.signalCode !== null : true, temporaryDirectoryRemoved: true }, null, 2) + "\n");
  expect(resourceError).toBeUndefined();
});

it("freeze: compiler-valid matrix sources and exact hashes", () => expect(compiled.size).toBe(17));

describe("Issue 1460 Module Preview/live Canvas", () => {
  for (const c of cases.filter(c => c.id.startsWith("A"))) it(c.id, async () => {
    const doc = compiled.get(c.id)!;
    if (c.id === "A4") {
      // The single replacement failed its intended discriminator: these are
      // ordinary names, not direct gates. Retain CONTRACT_INVALID evidence;
      // do not call it a gate PASS or invent a third exploratory source.
      expect(doc.document.elements.some(e => e.name === "Hidden(visible: false)")).toBe(true);
      expect(doc.document.elements.some(e => e.name === "Hidden")).toBe(false);
      observations.push({ id: c.id, disposition: "CONTRACT_INVALID", sourceHash: c.sha256, reason: "replacement's parenthesized declaration text is parsed as a name; no gate comparison accepted" });
      return;
    }
    const source = { normalizedSource: c.source, sourceRevision: doc.spans.sourceMap.sourceRevision };
    const semantic = { sourceRevision: source.sourceRevision, compiled: doc };
    const target = queryModulePreviewTarget({ source, semantic, position: c.source.indexOf(c.target!) + 2 });
    expect(target).not.toBeNull();
    if (!target) throw new Error("missing exact target");
    const ancestor = c.ancestor && doc.moduleSemanticAnalysis!.definitions.find(d => d.name === c.ancestor!.name);
    const preview = compileModulePreviewRoot({ source, semantic, target, arguments: c.arguments, ancestorContexts: ancestor ? [{ definitionStatementId: ancestor.statementId, arguments: c.ancestor!.arguments }] : [] });
    expect(preview).not.toBeNull();
    if (!preview) throw new Error("missing legal preview");
    if (c.id === "A3") {
      const control = await canonical(doc);
      checkPoints(subset(control, instanceIds(doc, "Left")), c.expected);
      checkPoints(subset(control, instanceIds(doc, "Right")), c.control!);
      const runtime = preview.moduleScalarRuntime;
      observations.push({ id: "A3-boundary", canonicalIndependentOracle: "PASS", missingControlBindings: runtime.bindingAnalysis.catalog.bindings.filter(b => !runtime.controlByScopeId.has(b.effectiveScopeId)), rootSourceScopes: [...doc.bindingAnalysis!.catalog.scopeIndex.scopes.keys()], controls: [...runtime.controlByScopeId.keys()] });
    }
    const result = await evaluate(preview.compileResult.elements, buildModulePreviewEvaluationOptions(preview));
    const targetResult = subset(result, new Set(preview.targetRuntimeElementIds));
    const liveDoc = compiled.get(`${c.id}:revised`) ?? doc;
    const live = await canonical(liveDoc);
    const left = subset(live, instanceIds(liveDoc, "Left"));
    const right = subset(live, instanceIds(liveDoc, "Right"));
    observations.push({ id: c.id, sourceHash: c.sha256, target: target.name, preview: [...targetResult.computedGeometry.values()], liveLeft: [...left.computedGeometry.values()], liveRight: [...right.computedGeometry.values()] });
    checkPoints(targetResult, c.expected);
    checkPoints(left, c.expected);
    checkPoints(right, c.control!);
    if (c.id !== "A4") {
      for (const r of [targetResult, left]) {
        const edge = one(r, "Edge");
        if (edge.kind !== "line") throw new Error("expected line");
        point(edge.start, c.expected.P as Point); point(edge.end, c.expected.Q as Point);
      }
      expect(() => checkPoints(right, c.expected), "wrong sibling sensitivity").toThrow();
    } else {
      for (const r of [targetResult, left]) {
        const hidden = one(r, "Hidden");
        expect(r.effectiveVisibleElementIds?.has(hidden.elementId)).toBe(false);
        expect([...r.computedGeometry.values()].some(g => g.name === "Off")).toBe(false);
      }
      const wrong = structuredClone(targetResult);
      wrong.computedGeometry.delete([...wrong.computedGeometry.values()].find(g => g.name === "Mark")!.elementId);
      expect(() => checkPoints(wrong, c.expected), "omitted occurrence sensitivity").toThrow();
    }
    expect([...targetResult.computedGeometry.values()].some(g => g.name === "Outside")).toBe(false);
    expect(hash(doc.spans.sourceMap.source)).toBe(c.sha256);
    if (c.id === "A2") {
      const session = createModulePreviewSession();
      session.activate({ source, semantic, target });
      const state = session.setParameterValue(target.definitionStatementId, 0, "19")!;
      expect(state.preview.kind).toBe("current");
      const value = modulePreviewValueSnapshotFor({ snapshot: state, sessionId: "1460", documentUri: "file:///1460.nui", documentVersion: 1, normalizedSource: c.source, sessionRevision: 2 });
      expect(value.groups[0].parameters[0]).toMatchObject({ value: "19", valueState: "explicit" });
      expect(modulePreviewValueSummaryFor(state)[0]).toMatchObject({ value: "19", valueState: "explicit" });
      if (state.preview.kind === "current") checkPoints(subset(await evaluate(state.preview.result.compileResult.elements, buildModulePreviewEvaluationOptions(state.preview.result)), new Set(state.preview.result.targetRuntimeElementIds)), c.expected);
      const before = await canonical(doc);
      checkPoints(subset(before, instanceIds(doc, "Right")), c.control!);
      point(pointGeometry(one(before, "Outside")), [-41, 23]);
      expect(hash(source.normalizedSource)).toBe(c.sha256);
    }
  }, 30000);
});

// B/C tests are added before their first product observations.

it("F1: nested Preview retains no canonical materialization bindings", async () => {
  const c = reducers[0]; const doc = compiled.get(c.id)!;
  const control = await canonical(doc);
  checkPoints(subset(control, instanceIds(doc, "Left")), c.expected);
  const source = { normalizedSource: c.source, sourceRevision: doc.spans.sourceMap.sourceRevision };
  const semantic = { sourceRevision: source.sourceRevision, compiled: doc };
  const target = queryModulePreviewTarget({ source, semantic, position: c.source.indexOf(c.target!) + 2 })!;
  const outer = doc.moduleSemanticAnalysis!.definitions.find(d => d.name === "Outer")!;
  const preview = compileModulePreviewRoot({ source, semantic, target, arguments: c.arguments, ancestorContexts: [{ definitionStatementId: outer.statementId, arguments: c.ancestor!.arguments }] })!;
  expect(preview).not.toBeNull();
  observations.push({ id: "F1", sourceHash: c.sha256, canonicalIndependentOracle: "PASS", missingControlBindings: preview.moduleScalarRuntime.bindingAnalysis.catalog.bindings.filter(b => !preview.moduleScalarRuntime.controlByScopeId.has(b.effectiveScopeId)) });
  const result = await evaluate(preview.compileResult.elements, buildModulePreviewEvaluationOptions(preview));
  checkPoints(subset(result, new Set(preview.targetRuntimeElementIds)), c.expected);
}, 30000);

describe("Issue 1460 fresh saved MCP/current Canvas", () => {
  for (const c of cases.filter(c => c.id.startsWith("C"))) it(c.id, async () => {
    const file = join(directory, `${c.id}.nui`);
    writeFileSync(file, c.source);
    const fresh = async (sourceText: string) => {
      const snapshot = await loadFreshNuiDocumentSnapshot(file, "document_evaluate");
      expect(snapshot.currentSemanticsAvailable).toBe(true);
      expect(snapshot.sourceIdentity).toEqual({ algorithm: "sha256", hash: hash(sourceText), byteLength: Buffer.byteLength(sourceText), normalizedLength: sourceText.length });
      const elements = snapshot.currentCompiled.document!.elements;
      const ids = ["P", "Curve"].map(name => {
        const e = elements.filter(e => e.name === name);
        expect(e).toHaveLength(1); return e[0].id;
      });
      const dto = await evaluateNuiDocument(file, { requestedElementIds: ids, includeEvaluatedElementIds: true }, { transport });
      expect(dto.status).toBe("evaluated"); expect(dto.rustEligible).toBe(true);
      expect(dto.sourceIdentity).toEqual(snapshot.sourceIdentity);
      expect(dto.evaluation!.errors).toEqual([]);
      expect(dto.evaluation!.computedGeometry).toHaveLength(2);
      expect(dto.evaluation!.evaluatedElementIds).toEqual(expect.arrayContaining(ids));
      // DTO geometry came from a real eligible Rust request, and IDs were taken
      // from this fresh compiled snapshot. No ID namespace equality is assumed.
      const result: EvaluationResult = { computedGeometry: new Map(dto.evaluation!.computedGeometry!.map(g => [g.elementId, g])), errors: dto.evaluation!.errors, warnings: dto.evaluation!.warnings };
      return { dto, result, snapshot, ids };
    };
    const original = await fresh(c.source);
    checkCurve(original.result, cases.find(c => c.id === "C1")!.expected);
    if (c.id === "C1") {
      const control = await canonical(compiled.get(c.id)!);
      checkCurve(control, c.expected);
      checkCurve(evaluateElementsReference(compiled.get(c.id)!.document.elements, buildEvaluationOptions({ compiledDocument: compiled.get(c.id)!, evaluationLimitIndex: compiled.get(c.id)!.document.evaluationLimitIndex })), c.expected);
      const ordinary = await evaluateNuiDocument(file, {}, { transport });
      expect(ordinary.evaluation).not.toHaveProperty("computedGeometry");
      expect(ordinary.evaluation).not.toHaveProperty("evaluatedElementIds");
      const mutant = structuredClone(original.result);
      pointGeometry(one(mutant, "P")).x += 1;
      expect(() => checkCurve(mutant, c.expected), "wrong requested geometry sensitivity").toThrow();
    } else if (c.id === "C2") {
      // A real old-source request completes, then the file changes before the
      // production evaluator's post-request source-identity revalidation.
      const stale = await evaluateNuiDocument(file, { requestedElementIds: original.ids }, { transport: async input => {
        const payload = await transport(input);
        writeFileSync(file, c.revised!);
        return payload;
      } });
      expect(stale.status).toBe("stale"); expect(stale.evaluation).toBeUndefined();
      const revised = await fresh(c.revised!);
      expect(revised.dto.sourceIdentity.hash).not.toBe(original.dto.sourceIdentity.hash);
      checkCurve(revised.result, c.expected);
      checkCurve(await canonical(compiled.get(`${c.id}:revised`)! ), c.expected);
      expect(() => checkCurve(original.result, c.expected), "old result sensitivity").toThrow();
      observations.push({ id: c.id, staleStatus: stale.status, oldIdentity: original.dto.sourceIdentity, newIdentity: revised.dto.sourceIdentity, geometry: [...revised.result.computedGeometry.values()] });
    } else if (c.id === "C3") {
      writeFileSync(file, c.invalid!);
      const invalidSnapshot = await loadFreshNuiDocumentSnapshot(file, "document_evaluate");
      expect(invalidSnapshot.sourceIdentity.hash).toBe(c.invalidSha256);
      expect(invalidSnapshot.currentSemanticsAvailable).toBe(false);
      const invalid = await evaluateNuiDocument(file, { requestedElementIds: original.ids }, { transport });
      expect(invalid.status).toBe("source-unavailable"); expect(invalid.evaluation).toBeUndefined();
      writeFileSync(file, c.revised!);
      const repaired = await fresh(c.revised!); checkCurve(repaired.result, c.expected);
      expect(repaired.dto.sourceIdentity.hash).not.toBe(original.dto.sourceIdentity.hash);
      observations.push({ id: c.id, invalidStatus: invalid.status, compileStatus: invalid.compileStatus, repaired: repaired.dto });
    } else {
      const unsaved = await canonical(compiled.get(`${c.id}:revised`)!);
      checkCurve(unsaved, c.expected);
      const unchanged = await fresh(c.source);
      checkCurve(unchanged.result, cases.find(c => c.id === "C1")!.expected);
      expect(unchanged.dto.sourceIdentity).toEqual(original.dto.sourceIdentity);
      expect(() => checkCurve(unchanged.result, c.expected), "unsaved/saved isolation sensitivity").toThrow();
      writeFileSync(file, c.revised!);
      const saved = await fresh(c.revised!); checkCurve(saved.result, c.expected);
      expect(saved.dto.sourceIdentity.hash).not.toBe(original.dto.sourceIdentity.hash);
      observations.push({ id: c.id, savedBefore: original.dto.sourceIdentity, unsavedHash: c.revisedSha256, savedAfter: saved.dto.sourceIdentity, geometry: [...saved.result.computedGeometry.values()] });
    }
    observations.push({ id: c.id, initial: original.dto });
  }, 30000);
});

const outputPlan = async (c: Frozen) => {
  const doc = compiled.get(c.id)!;
  const output = doc.document.svgOutputs[0] ?? doc.document.printOutputs[0];
  return await evaluateOutputPlan({ compiledDocument: doc, output, evaluate });
};
const checkOrder = (plan: OutputPlan, expected: string[]) => expect(plan.drawables.map(d => d.name)).toEqual(expected);
const checkPath = (plan: OutputPlan, expected: Point[]) => {
  const [line, cubic] = plan.drawables;
  expect(line.kind).toBe("line"); expect(cubic.kind).toBe("bezier");
  if (line.kind !== "line" || cubic.kind !== "bezier") throw new Error("expected line and cubic");
  point(line.start, expected[0]); point(line.end, expected[1]);
  point(cubic.start, expected[0]); point(cubic.end, expected[1]);
  point(cubic.control1, expected[2]); point(cubic.control2, expected[3]);
  numbers(nums(outputPreviewPathDataFor(line, size, viewport)!), [...screen(expected[0]), ...screen(expected[1])]);
  numbers(nums(outputPreviewPathDataFor(cubic, size, viewport)!), [...screen(expected[0]), ...screen(expected[2]), ...screen(expected[3]), ...screen(expected[1])]);
};
describe("Issue 1460 Canvas/OutputPlan/Output Preview", () => {
  for (const c of cases.filter(c => ["B1", "B2", "B3"].includes(c.id))) it(c.id, async () => {
    const doc = compiled.get(c.id)!;
    const canvasProfile = c.id === "B3" ? doc.document.drawingProfiles.find(p => p.name === "Canvas")!.id : undefined;
    const canvas = await canonical(doc, canvasProfile);
    const reference = evaluateElementsReference(doc.document.elements, buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: doc.document.evaluationLimitIndex, selectedDrawingProfileId: canvasProfile }));
    expect(reference.errors).toEqual([]);
    const plan = await outputPlan(c);
    checkOrder(plan, c.expected.order as string[]);
    observations.push({ id: c.id, sourceHash: c.sha256, canvas: [...canvas.computedGeometry.values()], drawables: plan.drawables, placements: plan.placements, bounds: plan.bounds });
    if (c.id !== "B3") {
      for (const r of [canvas, reference]) {
        const edge = one(r, "Edge"); const curve = one(r, "Curve");
        if (edge.kind !== "line" || curve.kind !== "bezierCurve") throw new Error("expected source paths");
        const points = c.expected.points as Point[];
        point(edge.start, points[0]); point(edge.end, points[1]);
        point(curve.segments[0].control1, points[2]); point(curve.segments[0].control2, points[3]);
        point(pointGeometry(one(r, "Origin")), [3, -4]);
      }
      checkPath(plan, c.expected.placed as Point[]);
      for (const p of c.expected.placed as Point[]) point(outputPreviewScreenPointFor({ x: p[0], y: p[1] }, size, viewport), screen(p));
      expect(plan.drawables.some(d => d.name === "Origin")).toBe(false);
      const mutant = structuredClone(plan);
      if (mutant.drawables[1].kind === "bezier") mutant.drawables[1].control1.x += 1;
      expect(() => checkPath(mutant, c.expected.placed as Point[]), "transformed control sensitivity").toThrow();
      mutant.drawables.reverse();
      expect(() => checkOrder(mutant, c.expected.order as string[]), "order sensitivity").toThrow();
    } else {
      const edge = plan.drawables[0];
      if (edge.kind !== "line") throw new Error("expected styled line");
      point(edge.start, c.expected.start as Point); point(edge.end, c.expected.end as Point);
      near(edge.stroke.widthMm, c.expected.widthMm as number);
      expect(edge.stroke).toMatchObject({ style: c.expected.style, colorHex: c.expected.color });
      const canvasEdge = one(canvas, "Edge"); const hidden = one(canvas, "Hidden");
      expect(canvas.effectiveVisibleElementIds?.has(hidden.elementId)).toBe(true);
      expect(canvas.effectiveDrawingModifierStrokes!.get(canvasEdge.elementId)).toEqual({ widthPx: 3, style: "solid", color: { kind: "fixed", hex: "#334455" } });
      const mutant = structuredClone(plan); mutant.drawables.push(structuredClone(edge));
      expect(() => checkOrder(mutant, c.expected.order as string[]), "suppressed geometry sensitivity").toThrow();
      expect(() => near(edge.stroke.widthMm * 2, c.expected.widthMm as number), "physical stroke sensitivity").toThrow();
    }
  }, 30000);
});

it("B4: real print path/page/inverse and upright multiline glyph projection", async () => {
  const c = cases.find(c => c.id === "B4")!;
  const plan = await outputPlan(c);
  checkOrder(plan, c.expected.order as string[]);
  const [joined, caption] = plan.drawables;
  if (joined.kind !== "joinedPath" || caption.kind !== "text") throw new Error("expected joined path and multiline label");
  expect(joined.segments).toHaveLength(2);
  const segments = c.expected.segments as [Point, Point][];
  joined.segments.forEach((segment, i) => {
    expect(segment.kind).toBe("line");
    if (segment.kind !== "line") throw new Error("expected straight segment");
    point(segment.start, segments[i][0]); point(segment.end, segments[i][1]);
  });
  const doc = compiled.get(c.id)!;
  expect(joined.elementId).toBe(doc.document.elements.find(e => e.name === "Joined")!.id);
  numbers(nums(outputPreviewPathDataFor(joined, size, viewport)!), segments.flatMap(segment => segment.flatMap(screen)));
  point(caption.anchor, c.expected.anchor as Point);
  expect(caption.text).toBe("Alpha\nBeta");
  near(caption.fontSizeMm, c.expected.fontSize as number); near(caption.lineHeightMm, c.expected.lineHeight as number);
  const paper = plan.print!;
  expect(paper.columns).toBe(2); expect(paper.rows).toBe(1); expect(paper.pages).toHaveLength(2);
  point(paper.pages[0].origin, c.expected.pageOrigin as Point);
  paper.pages.forEach((page, i) => {
    const origin: Point = [(c.expected.pageOrigin as Point)[0] + 190 * i, (c.expected.pageOrigin as Point)[1]];
    point(page.origin, origin);
    expect(page.guides.map(g => g.positionMm)).toEqual(c.expected.guides);
    const rect = outputPreviewPageRectsFor(plan, size, viewport)[i];
    point(rect, screen([origin[0], origin[1] + 297])); near(rect.width, 420); near(rect.height, 594);
    const guides = outputPreviewGuideLinesFor(plan, size, viewport).slice(i * 4, i * 4 + 4);
    const expectedGuides = [
      [...screen([origin[0] + 10, origin[1]]), ...screen([origin[0] + 10, origin[1] + 297])],
      [...screen([origin[0] + 200, origin[1]]), ...screen([origin[0] + 200, origin[1] + 297])],
      [...screen([origin[0], origin[1] + 10]), ...screen([origin[0] + 210, origin[1] + 10])],
      [...screen([origin[0], origin[1] + 287]), ...screen([origin[0] + 210, origin[1] + 287])]
    ];
    guides.forEach((g, j) => numbers([g.x1, g.y1, g.x2, g.y2], expectedGuides[j]));
    point(outputPreviewScreenToWorld({ x: screen(origin)[0], y: screen(origin)[1] }, size, viewport), origin);
  });
  const fitBounds = outputPreviewFitBoundsFor(plan)!;
  const fitted = fitOutputPreviewViewport(fitBounds, size);
  const boundsCenter = { x: (fitBounds.minX + fitBounds.maxX) / 2, y: (fitBounds.minY + fitBounds.maxY) / 2 };
  point(outputPreviewScreenPointFor(boundsCenter, size, fitted), [300, 200]);
  point(outputPreviewScreenToWorld({ x: 300, y: 200 }, size, fitted), xy(boundsCenter));
  const mutant = structuredClone(plan); if (mutant.drawables[0].kind === "joinedPath") mutant.drawables[0].segments.reverse();
  expect(nums(outputPreviewPathDataFor(mutant.drawables[0], size, viewport)!)).not.toEqual(nums(outputPreviewPathDataFor(joined, size, viewport)!));
  const textProjection = (text: OutputText) => {
    const [tx, ty, angle, sx, sy] = nums(outputPreviewTextTransformFor(text, size, viewport));
    near(angle, 0); numbers([tx, ty], screen(c.expected.anchor as Point));
    // SVG font glyph ascent is negative local Y. The current App uses -lineHeight
    // for tspan line 2. Apply the real returned affine scale to both probes.
    return { glyphUp: [0 * sx, -1 * sy], secondBaseline: [0 * sx, -caption.lineHeightMm * sy] };
  };
  const vectors = textProjection(caption);
  observations.push({ id: c.id, sourceHash: c.sha256, vectorPathPageInverse: "PASS", caption, transform: outputPreviewTextTransformFor(caption, size, viewport), vectors, expectedGlyphUp: c.expected.glyphUpScreenVector, expectedSecondBaseline: c.expected.secondBaselineScreenVector });
  numbers(vectors.secondBaseline, c.expected.secondBaselineScreenVector as number[]);
  numbers(vectors.glyphUp, c.expected.glyphUpScreenVector as number[]);
}, 30000);
