import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDslSemanticOccurrenceIndex, planDslRenameEditsResult, queryDslSourceValueStep } from "@nuinuicad/nui-language";
import { applyLineSplices, buildSourceSemanticRenameSplices, type LastGoodDslDocument, type LineSplice } from "@nuinuicad/nui-language/document";
import { applyBakePlan, planBakeGeometry } from "../src/commands/bakeGeometry";
import { applyCoordinatePointConversionPlan, coordinatePointConversionBaseCandidates, planCoordinatePointConversion } from "../src/commands/coordinatePointConversion";
import { compileModulePreviewRoot } from "../src/dsl/modulePreviewRoot";
import { buildModulePreviewEvaluationOptions } from "../src/vscode/modulePreviewEvaluation";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluatePreparedRust, prepareRustEvaluation, type RustEvaluationTransport } from "../src/geometry/rustEvaluationRunner";
import { useEvaluationEngine, evaluationStateIsCurrentFor } from "../src/geometry/useEvaluationEngine";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { EvaluationResult } from "../src/types/geometry";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { evaluateOutputPlan, type OutputPlan } from "../src/output/outputCore";
import { initialCadDocumentState, useCadDocumentStore } from "../src/state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../src/state/cadUiStore";
import { evaluateNuiDocument } from "../mcp-server/src/documentEvaluation";
import x1 from "./fixtures/issue-1468/x1-profile.json";
import recipeReductions from "./fixtures/issue-1468/r2-r3.json";
import r1Neighbor from "./fixtures/issue-1468/r1-neighbor.json";
import reductions from "./fixtures/issue-1468/reductions.json";
import manifest from "./fixtures/issue-1468/visible-manifest.json";

type Shape = Record<string, unknown>;
type Checkpoint = (typeof manifest.units)[number]["checkpoints"][number];
const state = () => useCadDocumentStore.getState();
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const observations: Record<string, unknown>[] = [];
let directory: string;
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0;
let requests = 0;
let exports = 0;
const bounded = async <T,>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust.dispose(); reject(new Error("issue1468 request exceeded 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
};
const transport: RustEvaluationTransport = async input => {
  requests++;
  return await bounded(rust.request(input)) as EvaluationPayload;
};
beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  directory = mkdtempSync(join(tmpdir(), "nuinui-1468-"));
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args);
      // Register completion/error consumption before any request or dispose.
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1468_RECORD) writeFileSync(process.env.ISSUE1468_RECORD, JSON.stringify({ spawns, requests, exports, observations }, null, 2) + "\n");
  if (directory && !process.env.ISSUE1468_KEEP_ARTIFACTS) rmSync(directory, { recursive: true, force: true });
  if (rust) expect(spawns).toBe(1);
});
const compare = (actual: unknown, expected: unknown, tolerance = 1e-7, path = "") => {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs(Number(actual) - expected), `${path}: ${actual} != ${expected}`).toBeLessThanOrEqual(tolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, tolerance, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    for (const [k, v] of Object.entries(expected)) compare((actual as Shape)[k], v, tolerance, `${path}.${k}`);
  } else expect(actual, path).toEqual(expected);
};
const sourcePath = (doc: LastGoodDslDocument, index: number): string => {
  const s = doc.statements[index];
  const parent = s.enclosing?.statementIndex;
  return [parent === undefined ? "" : sourcePath(doc, parent), s.name ?? ""].filter(Boolean).join("::");
};
const runtimePath = (doc: LastGoodDslDocument, id: string): string => {
  const m = doc.moduleMaterialization?.executionStatements.find(s => s.runtimeElementId === id);
  if (m) return [m.parentGroupId ? runtimePath(doc, m.parentGroupId) : "", m.statement.name ?? ""].filter(Boolean).join("::");
  const e = doc.document.elements.find(e => e.id === id);
  if (!e) throw new Error(`No canonical runtime owner for ${id}`);
  return [e.parentGroupId ? runtimePath(doc, e.parentGroupId) : "", e.name].filter(Boolean).join("::");
};
const elementId = (path: string) => {
  const element = state().doc.document.elements.find(e => runtimePath(state().doc, e.id) === path);
  expect(element, path).toBeDefined();
  return element!.id;
};
const identities = () => new Map(state().doc.sourceLexicalNamespace!.allDeclarations.map(d => [sourcePath(state().doc, d.statementIndex), d.statementId]));
const sourceSnapshot = () => ({ normalizedSource: state().sourceText, sourceRevision: state().doc.statementMap.sourceRevision });
const diagnostics = () => [...state().diagnostics, ...state().bindingIssueDiagnostics].filter(d => d.severity === "error");
const evaluate = async (doc = state().doc, options = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: undefined })) => {
  const prepared = prepareRustEvaluation(doc.document.elements, options);
  expect(prepared.rustEligible, "normal persistent Rust eligibility").toBe(true);
  return evaluatePreparedRust(prepared, transport);
};
const assertGeometry = (doc: LastGoodDslDocument, result: EvaluationResult, oracle: Record<string, Shape>) => {
  expect(result.errors).toEqual([]);
  const paths = new Map([...result.computedGeometry].filter(([id]) => doc.document.elements.some(e => e.id === id)).map(([id, g]) => [runtimePath(doc, id), g]));
  for (const [path, shape] of Object.entries(oracle)) compare(paths.get(path), shape, 1e-7, path);
};
const commitSplices = (splices: readonly LineSplice[], createdElementIds?: readonly string[]) => {
  const before = state();
  const expected = applyLineSplices(before.sourceText, splices);
  expect(state().commitLineSplices(splices, { createdElementIds }).status).toBe("applied");
  expect(state().sourceText).toBe(expected);
  expect(state().sourceRevision).toBe(before.sourceRevision + 1);
};
// Simulates a real source edit using narrow physical-line patches, never a
// model serialization. Command-specific edits below use their actual planners.
const editSource = (next: string) => {
  const before = state().sourceText.split("\n");
  const after = next.split("\n");
  expect(after).toHaveLength(before.length);
  const splices = before.flatMap((line, i) => line === after[i] ? [] : [{ startLine: i + 1, endLine: i + 1, replacementLines: [after[i]] }]);
  commitSplices(splices);
};
const valueStep = (expected: string) => {
  const old = state().sourceText;
  let from = 0;
  while (old[from] === expected[from]) from++;
  const query = queryDslSourceValueStep({ source: sourceSnapshot(), semantic: { sourceRevision: sourceSnapshot().sourceRevision, compiled: state().doc }, selections: [{ start: from, end: from }], direction: 1 });
  expect(query).toBeDefined();
  const edit = query!.edit;
  expect(old.slice(edit.from, edit.to)).toBe(edit.expectedText);
  const next = old.slice(0, edit.from) + edit.newText + old.slice(edit.to);
  expect(next).toBe(expected);
  state().commitText(next, "editor");
};
const rename = () => {
  const compiled = state().doc;
  const occurrence = createDslSemanticOccurrenceIndex(compiled).occurrences.find(o => o.kind === "declaration" && state().sourceText.slice(o.from, o.to) === "width")!;
  const result = planDslRenameEditsResult({ source: sourceSnapshot(), semantic: { sourceRevision: sourceSnapshot().sourceRevision, compiled } }, occurrence.from, "bustWidth");
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  const projected = buildSourceSemanticRenameSplices(state().sourceText, compiled, result.plan.edits.map(e => ({
    statementIndex: compiled.statements.findIndex(s => s.physicalSpan.segments.some(p => e.from >= p.from && e.to <= p.to)),
    span: { start: 0, end: 0 }, physicalSpan: { segments: [{ from: e.from, to: e.to }], sourceRevision: result.plan.sourceRevision }, oldName: e.expectedText, newName: e.newText
  })));
  expect(projected.ok).toBe(true);
  if (!projected.ok) throw new Error(projected.reason);
  commitSplices(projected.splices);
};

const numbers = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const pathTokens = (s: string): (number | string)[] => (s.match(/[MLCZ]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(t => /^[MLCZ]$/i.test(t) ? t : Number(t));
const expectedPath = (g: Shape, map: (p: { x: number; y: number }) => number[]): (string | number)[] => {
  const p = (value: unknown) => map(value as { x: number; y: number });
  if (g.kind === "line") return ["M", ...p(g.start), "L", ...p(g.end)];
  if (g.kind === "bezierCurve") {
    const s = (g.segments as Shape[])[0];
    return ["M", ...p(s.start), "C", ...p(s.control1), ...p(s.control2), ...p(s.end)];
  }
  if (g.kind === "polyline") return (g.segments as Shape[]).flatMap((s, i) => [...(i ? [] : ["M", ...p(s.start)]), "L", ...p(s.end)]);
  throw new Error(`Unplanned artifact shape ${g.kind}`);
};
const compareTokens = (actual: (string | number)[], expected: (string | number)[], tolerance: number) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => compare(v, expected[i], tolerance, `encoded token ${i}`));
};
// The production PDF encoder uses uncompressed streams. Follow its actual xref
// and page-tree references so page count/units are checked from encoded bytes.
const parsePdf = (bytes: Buffer) => {
  const s = bytes.toString("latin1");
  const xref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)?.[1]);
  const table = /^xref\n0 (\d+)\n([\s\S]*?)trailer\n([\s\S]*?)startxref/.exec(s.slice(xref));
  expect(table).not.toBeNull();
  const entries = table![2].trim().split("\n");
  expect(entries).toHaveLength(Number(table![1]));
  const objects = new Map<number, string>();
  entries.slice(1).forEach((e, i) => {
    const offset = Number(e.slice(0, 10));
    const header = `${i + 1} 0 obj\n`;
    expect(s.slice(offset, offset + header.length)).toBe(header);
    objects.set(i + 1, s.slice(offset + header.length, s.indexOf("\nendobj", offset)));
  });
  const ref = (v: string, key: string) => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(v)?.[1]);
  const catalog = objects.get(ref(table![3], "Root"))!;
  const tree = objects.get(ref(catalog, "Pages"))!;
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map(m => Number(m[1]));
  expect(kids).toHaveLength(Number(/\/Count (\d+)/.exec(tree)?.[1]));
  return kids.map(id => {
    const page = objects.get(id)!;
    const stream = objects.get(ref(page, "Contents"))!;
    const content = /stream\n([\s\S]*)endstream$/.exec(stream)![1];
    expect(Buffer.byteLength(content, "latin1")).toBe(Number(/\/Length (\d+)/.exec(stream)![1]));
    const ops = [...content.matchAll(/([-+\d.eE ]+)\s+(m|l|c)\b/g)].map(m => ({ op: m[2], args: numbers(m[1]) }));
    return { box: numbers(/\/MediaBox \[([^\]]*)\]/.exec(page)![1]), content, ops };
  });
};
const expectedDrawOrder = (unit: string, cp: Checkpoint): string[] => {
  const keys = Object.keys(cp.output!.drawables);
  if (unit.startsWith("A")) return [...Array<string>(4).fill("path"), "BODICE", "path"];
  if (unit.startsWith("B")) return [...keys.map(() => "path"), "SLEEVE"];
  const front = keys.filter(k => k.startsWith("Front::")).length;
  return [...Array<string>(front).fill("path"), "FRONT", "path", "BACK"];
};
const checkArtifacts = async (unit: string, cp: Checkpoint, plan: OutputPlan, format: "svg" | "pdf") => {
  const oracle = cp.output!;
  const path = join(directory, `${unit}-${cp.sourceRevision}.${format}`);
  exports++;
  expect(await bounded(rust.exportOutput({ path, payload: plan.rustPayload }))).toEqual({ exported: true });
  const bytes = readFileSync(path);
  const shapes = Object.values(oracle.drawables) as Shape[];
  if (format === "svg") {
    const xml = new DOMParser().parseFromString(bytes.toString("utf8"), "image/svg+xml");
    expect(xml.querySelector("parsererror")).toBeNull();
    compare([parseFloat(xml.documentElement.getAttribute("width")!), parseFloat(xml.documentElement.getAttribute("height")!)], oracle.svgMm, 0.00051);
    expect(xml.documentElement.getAttribute("width")).toMatch(/mm$/);
    expect(xml.documentElement.getAttribute("height")).toMatch(/mm$/);
    compare(numbers(xml.documentElement.getAttribute("viewBox")!), [0, 0, ...oracle.svgMm], 0.00051);
    compare([...xml.querySelectorAll("path, text")].map(node => node.tagName === "path" ? "path" : node.textContent), expectedDrawOrder(unit, cp));
    const paths = [...xml.querySelectorAll("path")];
    expect(paths).toHaveLength(shapes.length);
    const expectedPaths = shapes.map(shape => expectedPath(shape, p => [p.x - oracle.bounds.minX + 3, oracle.bounds.maxY + 3 - p.y]));
    paths.forEach((p, i) => compareTokens(pathTokens(p.getAttribute("d")!), expectedPaths[i], .00051));
    const label = unit.startsWith("A") ? ["BODICE"] : unit.startsWith("B") ? ["SLEEVE"] : ["FRONT", "BACK"];
    for (const text of label) expect(xml.documentElement.textContent).toContain(text);
    // Deliberately wrong physical-unit and coordinate oracles must be rejected.
    expect(() => compare(parseFloat(xml.documentElement.getAttribute("width")!), oracle.svgMm[0] * 96 / 25.4, .00051)).toThrow();
    const corrupted = [...expectedPaths[0]]; corrupted[1] = Number(corrupted[1]) + 1;
    expect(() => compareTokens(pathTokens(paths[0].getAttribute("d")!), corrupted, .00051)).toThrow();
  } else {
    const pages = parsePdf(bytes);
    expect(pages).toHaveLength(oracle.columns * oracle.rows);
    const pt = 72 / 25.4;
    for (const [i, page] of pages.entries()) {
      compare(page.box, [0, 0, oracle.paperMm[0] * pt, oracle.paperMm[1] * pt], .00051);
      const origin = oracle.pageOrigins[i];
      const expectedOps = shapes.flatMap(shape => {
        const tokens = expectedPath(shape, p => [(p.x - origin[0]) * pt, (p.y - origin[1]) * pt]);
        const ops: typeof page.ops = [];
        for (let j = 0; j < tokens.length;) {
          const command = String(tokens[j++]);
          const count = command === "C" ? 6 : 2;
          ops.push({ op: command.toLowerCase(), args: tokens.slice(j, j + count) as number[] }); j += count;
        }
        return ops;
      });
      // Drawing/text order interleaves, but all path operators precede page guides.
      compare(page.ops.slice(0, expectedOps.length), expectedOps, .00051);
      expect(page.content).toContain("BT");
      expect(page.content).toContain("TJ");
      const drawingContent = page.content.slice(0, page.content.indexOf("\nQ\n"));
      const drawingOrder = [...drawingContent.matchAll(/\bm\b|\bBT\b([\s\S]*?)\bET\b/g)].map(match =>
        match[1] === undefined ? "path" : [...match[1].matchAll(/<([0-9a-f]{4})>/gi)].map(char => String.fromCharCode(parseInt(char[1], 16))).join(""));
      compare(drawingOrder, expectedDrawOrder(unit, cp));
      const guides = page.ops.slice(expectedOps.length);
      expect(guides.length).toBeGreaterThanOrEqual(8);
      // Four inset guides, physical x/y independent of page origin.
      const o = oracle.overlap, w = oracle.paperMm[0], h = oracle.paperMm[1];
      const guideSegments = [[o,0,o,h],[w-o,0,w-o,h],[0,o,w,o],[0,h-o,w,h-o]];
      for (const coords of guideSegments) {
        expect(guides.some((op,j) => op.op === "m" && guides[j+1]?.op === "l" &&
          [...op.args,...guides[j+1].args].every((n,k) => Math.abs(n-coords[k]*pt) <= .00051))).toBe(true);
      }
      expect(() => compare(page.box[2], oracle.paperMm[0], .00051)).toThrow();
    }
  }
  return { format, sha256: sha(bytes), byteLength: bytes.length, path };
};
const output = async (id: string, cp: Checkpoint) => {
  const oracle = cp.output!;
  const docs = state().doc;
  const records = [];
  for (const declaration of [docs.document.svgOutputs[0], docs.document.printOutputs[0]]) {
    const plan = await evaluateOutputPlan({ compiledDocument: docs, output: declaration, evaluate: (_elements, options) => evaluate(docs, options) });
    observations.at(-1)!.lastPlan = plan;
    compare(plan.renderedBounds, oracle.bounds);
    compare([plan.svg?.widthMm ?? oracle.svgMm[0], plan.svg?.heightMm ?? oracle.svgMm[1]], oracle.svgMm);
    const actual = plan.drawables.filter(d => d.kind !== "text");
    expect(actual).toHaveLength(Object.keys(oracle.drawables).length);
    for (const [i, [path, shape]] of Object.entries(oracle.drawables).entries()) {
      expect(actual[i].name).toBe(path.startsWith("Tick[") ? "Tick" : path.split("::").at(-1));
      const outputShape = shape.kind === "bezierCurve" ? { kind: "bezier", ...(shape.segments as Shape[])[0] } : shape;
      compare(actual[i], outputShape);
    }
    if (plan.print) {
      compare([plan.print.columns, plan.print.rows, plan.print.strideXmm, plan.print.strideYmm], [oracle.columns, oracle.rows, ...oracle.stride]);
      compare(plan.print.pages.map(p => [p.origin.x,p.origin.y]), oracle.pageOrigins);
    }
    records.push(await checkArtifacts(id, cp, plan, plan.svg ? "svg" : "pdf"));
  }
  return records;
};
const modulePreview = async (cp: Checkpoint) => {
  const doc = state().doc;
  const definition = doc.moduleSemanticAnalysis!.definitions.find(d => d.name === "Sleeve")!;
  const preview = compileModulePreviewRoot({ source: sourceSnapshot(), semantic: { sourceRevision: sourceSnapshot().sourceRevision, sourceText: state().sourceText, compiled: doc }, target: { definitionStatementId: definition.statementId, definitionStatementIndex: definition.statementIndex, name: definition.name }, arguments: [{ name: "span", expression: /Left = Sleeve\(span: (\d+)/.exec(cp.source)![1] }, { name: "lift", expression: /Left = Sleeve\(span: \d+, lift: (\d+)/.exec(cp.source)![1] }] });
  expect(preview).not.toBeNull();
  expect(preview!.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  observations.at(-1)!.canonicalTargets = [...doc.moduleGeometryRuntime!.geometryInputTargetsByRuntimeElementId].map(([id,values])=>[id,[...values]]);
  observations.at(-1)!.rootTargets = [...preview!.moduleGeometryRuntime.geometryInputTargetsByRuntimeElementId].map(([id,values])=>[id,[...values]]);
  const options = buildModulePreviewEvaluationOptions(preview!);
  const prepared = prepareRustEvaluation(preview!.compileResult.elements, options);
  observations.at(-1)!.previewInput = prepared.input;
  observations.at(-1)!.previewGeometryTargets = [...options.geometryInputTargetsByElementId ?? []].map(([id, values]) => [id,[...values]]);
  expect(prepared.rustEligible).toBe(true);
  const result = await evaluatePreparedRust(prepared, transport);
  expect(result.errors).toEqual([]);
  const targetGeometry = [...result.computedGeometry.values()].filter(g => preview!.targetRuntimeElementIds.includes(g.elementId));
  const cap = targetGeometry.filter(g => g.name === "Cap");
  expect(cap).toHaveLength(1);
  compare(cap[0], cp.geometry!["Sleeves::Left::Cap" as keyof typeof cp.geometry]);
  // The ephemeral preview excludes Right's outer move and unrelated generated ticks.
  expect(targetGeometry.some(g => g.name === "Tick")).toBe(false);
};
const savedMcp = async (cp: Checkpoint, invalid = false) => {
  const path = join(directory, "current.nui");
  writeFileSync(path, cp.source);
  const result = await evaluateNuiDocument(path, {}, { transport });
  expect(result.sourceIdentity.hash).toBe(cp.sha256);
  if (invalid) expect(["source-unavailable", "ineligible"]).toContain(result.status);
  else {
    expect(result.status).toBe("evaluated");
    expect(result.rustEligible).toBe(true);
    expect(result.evaluation!.errors).toEqual([]);
  }
  return result;
};
const staleLifecycle = async (before: LastGoodDslDocument, current: LastGoodDslDocument) => {
  let release: (() => void) | undefined;
  let started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  let gatedRequests = 0;
  const gated: RustEvaluationTransport = async input => {
    gatedRequests++;
    const hold = first; first = false;
    const payload = await transport(input);
    if (hold) { started = true; await gate; }
    return payload;
  };
  const opts = (d: LastGoodDslDocument) => buildEvaluationOptions({ compiledDocument: d, evaluationLimitIndex: undefined });
  const hook = renderHook(({ doc, revision, options }) => useEvaluationEngine(doc.document.elements, options, revision, gated), { initialProps: { doc: before, revision: 5, options: opts(before) } });
  try {
    await waitFor(() => expect(started).toBe(true));
    hook.rerender({ doc: current, revision: state().compiledDocumentRevision, options: opts(current) });
    expect(evaluationStateIsCurrentFor(hook.result.current, state().compiledDocumentRevision)).toBe(false);
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    expect(hook.result.current.source).toBe("rust");
    expect(hook.result.current.evaluationRevision).toBe(state().compiledDocumentRevision);
    const latest = hook.result.current.evaluation;
    await act(async () => { release!(); await gate; });
    expect(hook.result.current.evaluation).toBe(latest);
    expect(gatedRequests).toBe(2);
    expect(evaluationStateIsCurrentFor(hook.result.current, state().compiledDocumentRevision)).toBe(true);
  } finally { release?.(); hook.unmount(); }
};

describe("Issue #1468 sealed cumulative sewing-pattern production workflows", () => {
  for (const series of ["A", "B", "C"]) it(`${series}1–${series}4 ordered trace`, async () => {
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
    let previousEvaluation: EvaluationResult | undefined;
    let beforeInvalid: LastGoodDslDocument | undefined;
    for (const unit of manifest.units.filter(u => u.id.startsWith(series))) {
      for (const [index, cp] of unit.checkpoints.entries()) {
        const record: Record<string, unknown> = { id: unit.id, checkpoint: index, expectedSourceSha256: cp.sha256, action: cp.action, disposition: "UNRESOLVED" };
        observations.push(record);
        const oldIdentities = state().sourceRevision === 0 ? new Map<string, string>() : identities();
        try {
          expect(sha(cp.source)).toBe(cp.sha256);
          if (unit.id === "C4" && index === 0) {
            const path = join(directory,"reopened.nui");
            writeFileSync(path,state().sourceText);
            expect(readFileSync(path,"utf8")).toBe(cp.source);
            useCadDocumentStore.setState(initialCadDocumentState());
            state().commitText(readFileSync(path,"utf8"),"test");
          } else if (state().sourceRevision === 0) state().commitText(cp.source, "test");
          else if (unit.id === "A3" && index >= 2) state().undo();
          else if (unit.id === "A4" && index === 0) rename();
          else if ((unit.id === "A4" || unit.id === "C2" || unit.id === "C4") && index === 1) valueStep(cp.source);
          else if (unit.id === "C1" && index === 1) {
            const plan = planBakeGeometry({ mode: "current", compiled: state().doc, elements: state().doc.document.elements, evaluation: previousEvaluation!, selectedElementIds: [elementId("Front::Reference")] });
            expect(plan?.successfulTargetCount).toBe(1);
            expect(plan?.skippedTargets).toEqual([]);
            expect(applyLineSplices(state().sourceText,plan!.splices)).toBe(cp.source);
            expect(applyBakePlan(plan!).status).toBe("applied");
          } else if (unit.id === "C2" && index === 0) {
            const snapshot = { document: state(), evaluation: previousEvaluation! };
            const ids = [elementId("Front::Tip")];
            const base = coordinatePointConversionBaseCandidates({ snapshot, targetIds: ids }).find(b => b.sourceElementId === elementId("Front::Base"))!;
            const plan = planCoordinatePointConversion({ snapshot, targetIds: ids, base, mode: "xy" });
            expect(plan?.successfulTargetCount).toBe(1);
            expect(applyCoordinatePointConversionPlan(plan!, snapshot).status).toBe("applied");
            commitSplices(plan!.splices, [...plan!.successfulTargetIds]);
          } else if (unit.id === "B4") {
            if (index === 0) beforeInvalid = state().doc;
            state().commitText(cp.source, "editor");
          } else editSource(cp.source);
          record.actualSource = state().sourceText;
          record.actualRevision = state().sourceRevision;
          record.diagnostics = diagnostics();
          expect(state().sourceText).toBe(cp.source);
          expect(state().sourceRevision).toBe(cp.sourceRevision);
          for (const [name,id] of oldIdentities) {
            if (unit.id === "C4" && index === 0) continue;
            const renamed = unit.id === "A4" && name === "width" ? "bustWidth" : name;
            expect(identities().get(renamed), `stable statement ${name}`).toBe(id);
          }
          if (!cp.output) {
            expect(diagnostics().length).toBeGreaterThan(0);
            record.mcp = await savedMcp(cp, true);
            record.disposition = "EXPECTED_REJECTION";
            continue;
          }
          expect(diagnostics()).toEqual([]);
          expect(state().docText).toBe(cp.source);
          expect(state().doc.statementMap.sourceRevision).toBe(cp.sourceRevision - Number(unit.id === "B4" && index === 1));
          previousEvaluation = await evaluate();
          record.geometry = [...previousEvaluation.computedGeometry.values()];
          record.visibility = [...previousEvaluation.effectiveVisibleElementIds ?? []];
          record.rows = previousEvaluation.forGroupGeneratedRows;
          record.elements = state().doc.document.elements;
          assertGeometry(state().doc, previousEvaluation, cp.geometry as Record<string, Shape>);
          if (unit.id === "B2") {
            const ticks = previousEvaluation.forGroupGeneratedRows!.filter(row => row.templateElementId === elementId("Sleeves::Tick"));
            expect(ticks).toHaveLength(4);
            ticks.forEach((row, i) => compare(previousEvaluation!.computedGeometry.get(row.generatedElementId), { ...manifest.units.find(u=>u.id==="B2")!.checkpoints[index].output!.drawables[`Tick[${i}]` as keyof typeof cp.output.drawables], start: { x: i*10, y: -40 }, end: { x: i*10, y: -35 } }));
          }
          if (unit.id.startsWith("B")) await modulePreview(cp);
          if (unit.id === "B4" && index === 1) await staleLifecycle(beforeInvalid!, state().doc);
          if (unit.id === "C4") record.mcp = await savedMcp(cp);
          record.artifacts = await output(unit.id, cp);
          record.disposition = "PASS";
        } catch (error) {
          record.error = String(error);
          record.actualSource = state().sourceText;
          record.diagnostics = diagnostics();
          throw error;
        }
      }
    }
  }, 120000);
});


describe("Issue #1468 R1 source-scope Preview controls", () => {
  it.each([...reductions,...r1Neighbor])("$id/$variant", async row => {
    expect(sha(row.source)).toBe(row.sha256);
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
    state().commitText(row.source,"test");
    expect(diagnostics()).toEqual([]);
    const canonical = await evaluate();
    const q = [...canonical.computedGeometry.values()].find(g=>g.name==="Q");
    compare(q,row.expected.Q);
    const doc=state().doc;
    const definition=doc.moduleSemanticAnalysis!.definitions.find(d=>d.name==="Sleeve")!;
    const preview=compileModulePreviewRoot({source:sourceSnapshot(),semantic:{sourceRevision:1,sourceText:row.source,compiled:doc},target:{definitionStatementId:definition.statementId,definitionStatementIndex:definition.statementIndex,name:definition.name},arguments:[]});
    expect(preview).not.toBeNull();
    const runtime=preview!.moduleScalarRuntime;
    const record: Record<string, unknown>={id:row.id,variant:row.variant,sourceSha256:row.sha256,canonicalQ:q,scopeIds:[...runtime.bindingAnalysis.catalog.scopeIndex.scopes.keys()],controlScopeIds:[...runtime.controlByScopeId.keys()],disposition:"FAIL"};
    observations.push(record);
    try {
      const options=buildModulePreviewEvaluationOptions(preview!);
      const prepared=prepareRustEvaluation(preview!.compileResult.elements,options);
      expect(prepared.rustEligible).toBe(true);
      const result=await evaluatePreparedRust(prepared,transport);
      expect(result.errors).toEqual([]);
      compare([...result.computedGeometry.values()].find(g=>g.name==="P"),row.expected.P);
      compare([...result.computedGeometry.values()].find(g=>g.name==="Q"),row.expected.Q);
      record.disposition="PASS";
    } catch(error) {record.error=String(error);throw error;}
  });
});

// Independent first-owner discriminators. Frozen arithmetic does not call TS.
describe("Issue #1468 R2/R3 recipe ownership", () => {
  it.each(recipeReductions)("$id/$variant", async row => {
    expect(sha(row.source)).toBe(row.sha256);
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
    state().commitText(row.source,"test");
    expect(diagnostics()).toEqual([]);
    const doc=state().doc;
    const record: Record<string,unknown>={id:row.id,variant:row.variant,sourceSha256:row.sha256,disposition:"FAIL",recipes:doc.runtimeTransformationRecipes};
    observations.push(record);
    try {
      const canonical=await evaluate();
      expect(canonical.errors).toEqual([]);
      compare([...canonical.computedGeometry.values()].find(g=>g.name==="Edge"),row.expected);
      if(row.mode==="preview") {
        const definition=doc.moduleSemanticAnalysis!.definitions.find(d=>d.name==="Sleeve")!;
        const preview=compileModulePreviewRoot({source:sourceSnapshot(),semantic:{sourceRevision:1,sourceText:row.source,compiled:doc},target:{definitionStatementId:definition.statementId,definitionStatementIndex:definition.statementIndex,name:definition.name},arguments:[]})!;
        expect(preview).not.toBeNull();
        record.previewRecipes=preview.compileResult.runtimeTransformationRecipes;
        const options=buildModulePreviewEvaluationOptions(preview);
        const prepared=prepareRustEvaluation(preview.compileResult.elements,options);
        expect(prepared.rustEligible).toBe(true);
        const result=await evaluatePreparedRust(prepared,transport);
        expect(result.errors).toEqual([]);
        const geometry=[...result.computedGeometry.values()].find(g=>g.name==="Edge" && preview.targetRuntimeElementIds.includes(g.elementId));
        record.previewGeometry=geometry;
        compare(geometry,row.expected);
      }
      record.disposition="PASS";
    } catch(error){record.error=String(error);throw error;}
  });
});

describe("Issue #1468 X1 profile-only physical continuation", () => {
  it("retains geometry while profile fallback changes physical stroke bounds",async()=>{
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
    const original=x1.checkpoints[0];
    state().commitText(original.source,"test");
    const before=await evaluate();
    assertGeometry(state().doc,before,original.geometry as Record<string,Shape>);
    const ids=identities();
    const cp=x1.checkpoints[1];
    editSource(cp.source);
    expect(sha(state().sourceText)).toBe(cp.sha256);
    expect(state().sourceRevision).toBe(cp.sourceRevision);
    expect(identities()).toEqual(ids);
    const after=await evaluate();
    assertGeometry(state().doc,after,cp.geometry as Record<string,Shape>);
    expect(after.computedGeometry).toEqual(before.computedGeometry);
    const record: Record<string,unknown>={id:"X1",hypothesis:x1.hypothesis,disposition:"UNRESOLVED"};
    observations.push(record);
    record.artifacts=await output("X1",cp as Checkpoint);
    record.disposition="PASS";
  });
});
