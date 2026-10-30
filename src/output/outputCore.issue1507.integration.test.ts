import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../geometry/evaluationPayload";
import { prepareRustEvaluation } from "../geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../node/rustEvaluationProcess";
import type { EvaluationResult } from "../types/geometry";
import { buildOutputPlan, type OutputPlan } from "./outputCore";
import { compare } from "../../test/patternArtifactAssertions";
import { parsePdf, type PdfOp } from "../../test/pdfArtifactInspector";

type Point = { x: number; y: number };
type Identity = { template: string; instances: string[]; path: [string, number][] };
type Shape = { kind: string; start?: Point; end?: Point; length?: number; x?: number; y?: number };
type Row = Identity & { geometry: Shape; color: string; visible: boolean };
type Line = Identity & { placement: number; name: string; kind: "line"; start: Point; end: Point; length: number; width: number; color: string };
type Oracle = {
  rows: Row[]; static: Row[]; hidden: Row[]; disabled: string[];
  placements: { group: string; at: Point; origin: Point; angle: number; scale: number; mirror: boolean }[];
  drawables: Line[]; bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  margin: number; svgMm: number[]; paperMm: number[]; overlap: number; stride: number[];
  columns: number; rowsOfPages: number; pageOrigins: Point[]; profile: string; diagnostics: [];
};
type Checkpoint = { source: string; sha256: string; oracle: Oracle; oracleSha256: string };
type Unit = { id: string; oracleDerivation: string; checkpoints: Checkpoint[] };
const fixturePath = "test/fixtures/issue-1507/manifest.json";
const manifest = JSON.parse(readFileSync(fixturePath, "utf8")) as { base: string; units: Unit[]; extensions: Unit[]; reducers: Unit[] };
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const units = [...manifest.units, ...manifest.extensions, ...manifest.reducers];
const validateOnly = process.env.ISSUE1507_VALIDATE_ONLY === "1";
const observations: Record<string, unknown>[] = [];
const counts = { spawns: 0, evaluations: 0, exports: 0, inspections: 0 };
let rust: RustEvaluationProcess;
let directory: string;
let closed: Promise<void> | undefined;
let closure: { code: number | null; signal: string | null } | undefined;
let resourceError: Error | undefined;
let binary: { path: string; sha256: string } | undefined;
const bounded = async <T,>(p: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1507 Rust operation exceeded 15s")); }, 15000);
  })]); } finally { clearTimeout(timer); }
};
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "nuinui-1507-"));
  if (validateOnly) return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  const path = resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
  binary = { path, sha256: sha(readFileSync(path)) }; // Missing Cargo product fails here.
  rust = new RustEvaluationProcess(path, { spawnProcess: ((...args: Parameters<typeof spawn>) => {
    expect(args[0]).toBe(path);
    counts.spawns++;
    const child = spawn(...args);
    const memory = setInterval(() => {
      try {
        const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 }));
        if (rss > 512 * 1024) { resourceError = new Error("#1507 Rust child exceeded 512MiB RSS"); rust.dispose(); }
      } catch { /* Child may have exited before close. */ }
    }, 100);
    // Completion/error observers exist before the first request or teardown.
    closed = new Promise<void>(done => {
      child.once("close", (code, signal) => { clearInterval(memory); closure = { code, signal }; done(); });
      child.once("error", () => clearInterval(memory));
    });
    return child;
  }) as typeof spawn });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1507_RECORD) writeFileSync(process.env.ISSUE1507_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    fixtureSha256: sha(readFileSync(fixturePath)), testSha256: sha(readFileSync("src/output/outputCore.issue1507.integration.test.ts")),
    validateOnly, directory, counts, binary, closure, observations
  }, null, 2) + "\n");
  if (directory && !process.env.ISSUE1507_KEEP_ARTIFACTS) rmSync(directory, { recursive: true, force: true });
  expect(resourceError).toBeUndefined();
  if (!validateOnly) { expect(counts.spawns).toBe(1); expect(closure).toBeDefined(); }
});

// Normalize only identities supplied by the compiler/runtime, never generated ID text.
function owners(c: TextCompileResult) {
  const doc = c.currentCompiled;
  const sourceName = (index: number): string => {
    const s = doc.statements[index];
    if (!s) throw new Error(`Missing statement ${index}`);
    const name = s.kind === "element" && s.type === "forGroup" ? s.attrs.find(a => a.key === "variable")!.value : s.kind === "element" && s.type === "conditionalGroup" ? "if" : s.name || s.kind;
    return s.enclosing ? `${sourceName(s.enclosing.statementIndex)}/${name}` : name;
  };
  const byId = new Map([...doc.statementMap?.statementIdByStatementIndex ?? []].map(([i, id]) => [id, sourceName(i)]));
  const element = (id: string): Omit<Identity, "path"> => {
    const origin = c.doc.moduleMaterialization?.originByRuntimeElementId.get(id);
    if (origin) return { template: byId.get(origin.sourceStatementId)!, instances: origin.instancePath.map(i => byId.get(i)!) };
    const statement = c.doc.statementMap.byElementId.get(id);
    if (!statement) throw new Error(`Missing compiler owner ${id}`);
    return { template: sourceName(statement.statementIndex), instances: [] };
  };
  return { element };
}
function normalized(c: TextCompileResult, result: EvaluationResult) {
  const n = owners(c);
  const generated = (result.forGroupGeneratedRows ?? []).map(r => ({
    ...n.element(r.templateElementId),
    path: r.occurrencePath.map(p => [n.element(p.templateForGroupId).template, p.iterationIndex] as [string, number]),
    id: r.generatedElementId, geometry: result.computedGeometry.get(r.generatedElementId)
  }));
  const byId = new Map(generated.map(r => [r.id, r]));
  const identity = (id: string): Identity => {
    const r = byId.get(id);
    return r ? { template: r.template, instances: r.instances, path: r.path } : { ...n.element(id), path: [] };
  };
  return { generated, identity };
}
const identityOf = (r: Identity): Identity => ({ template: r.template, instances: r.instances, path: r.path });
function checkGeometry(c: TextCompileResult, result: EvaluationResult, oracle: Oracle) {
  expect(result.errors).toEqual([]); expect(result.warnings).toEqual([]); expect(result.geometryValueErrors ?? []).toEqual([]);
  const n = normalized(c, result);
  // Runtime rows can be dependency-ordered; occurrence order per template is fixed.
  const key = (r: Identity) => JSON.stringify(identityOf(r));
  expect(n.generated.map(key).sort()).toEqual(oracle.rows.map(key).sort());
  for (const expected of oracle.rows) {
    const r = n.generated.find(r => key(r) === key(expected))!;
    compare(r.geometry, expected.geometry);
    expect(result.effectiveVisibleElementIds?.has(r.id)).toBe(expected.visible);
  }
  for (const template of new Set(oracle.rows.map(r => r.template))) {
    expect(n.generated.filter(r => r.template === template).map(r => r.path)).toEqual(oracle.rows.filter(r => r.template === template).map(r => r.path));
  }
  for (const expected of [...oracle.static, ...oracle.hidden]) {
    const element = c.doc.document.elements.find(e => n.identity(e.id).template === expected.template)!;
    compare(result.computedGeometry.get(element.id), expected.geometry);
    expect(result.effectiveVisibleElementIds?.has(element.id)).toBe(expected.visible);
  }
  for (const template of oracle.disabled) {
    const e = c.doc.document.elements.find(e => n.identity(e.id).template === template)!;
    expect(result.computedGeometry.has(e.id)).toBe(false);
  }
  return n;
}
function checkPlan(plan: OutputPlan, c: TextCompileResult, result: EvaluationResult, o: Oracle) {
  const n = normalized(c, result);
  compare(plan.renderedBounds, o.bounds);
  expect(plan.drawables).toHaveLength(o.drawables.length);
  expect(plan.placements).toHaveLength(o.placements.length);
  plan.placements.forEach((p, i) => {
    expect(n.identity(p.groupId).template).toBe(o.placements[i].group);
    compare(p, { at: o.placements[i].at, origin: o.placements[i].origin, scale: o.placements[i].scale, angleDeg: o.placements[i].angle, mirror: o.placements[i].mirror });
    const wanted = o.drawables.filter(d => d.placement === i);
    expect(p.drawables.map(d => n.identity(d.elementId))).toEqual(wanted.map(identityOf));
  });
  plan.drawables.forEach((d, i) => {
    const e = o.drawables[i];
    compare(d, { kind: "line", name: e.name, start: e.start, end: e.end, stroke: { widthMm: e.width, colorHex: e.color, style: "solid" } });
    expect("fill" in d ? d.fill : undefined).toBeUndefined();
    if (d.kind === "line") compare(Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y), e.length);
  });
  if (plan.svg) compare([plan.svg.widthMm, plan.svg.heightMm], o.svgMm);
  if (plan.print) {
    compare([plan.print.paperWidthMm, plan.print.paperHeightMm], o.paperMm);
    compare([plan.print.columns, plan.print.rows, plan.print.strideXmm, plan.print.strideYmm, plan.print.overlapMm], [o.columns, o.rowsOfPages, ...o.stride, o.overlap]);
    compare(plan.print.pages.map(p => p.origin), o.pageOrigins);
  }
}
const nums = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
function checkArtifact(bytes: Buffer, format: "svg" | "pdf", o: Oracle) {
  if (format === "svg") {
    const doc = new DOMParser().parseFromString(bytes.toString("utf8"), "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const svg = doc.documentElement;
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    for (const attr of ["width", "height"]) expect(svg.getAttribute(attr)).toMatch(/mm$/);
    compare([parseFloat(svg.getAttribute("width")!), parseFloat(svg.getAttribute("height")!)], o.svgMm, .00051);
    compare(nums(svg.getAttribute("viewBox")!), [0, 0, ...o.svgMm], .00051);
    expect(svg.children).toHaveLength(o.drawables.length);
    const paths = [...svg.children].map((p, i) => {
      const l = o.drawables[i];
      expect(p.tagName).toBe("path");
      expect(p.getAttribute("d")).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/);
      const points = [l.start.x - o.bounds.minX + o.margin, o.bounds.maxY + o.margin - l.start.y,
        l.end.x - o.bounds.minX + o.margin, o.bounds.maxY + o.margin - l.end.y];
      compare(nums(p.getAttribute("d")!), points, .00051);
      compare(Number(p.getAttribute("stroke-width")), l.width, .00051);
      expect(p.getAttribute("stroke")).toBe(l.color); expect(p.getAttribute("fill")).toBe("none");
      return { path: p.getAttribute("d"), color: l.color, width: p.getAttribute("stroke-width") };
    });
    return { mm: o.svgMm, paths };
  }
  const pt = 72 / 25.4, parsed = parsePdf(bytes);
  expect(parsed.pages).toHaveLength(o.columns * o.rowsOfPages);
  return parsed.pages.map((page, index) => {
    compare(page.box, [0, 0, ...o.paperMm.map(n => n * pt)], .00051);
    const drawing: PdfOp[] = [], guides: PdfOp[] = [];
    let depth = 0, inDrawing = true;
    for (const op of page.ops) {
      if (op.op === "q") depth++;
      (inDrawing ? drawing : guides).push(op);
      if (op.op === "Q" && --depth === 0) inDrawing = false;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(drawing.slice(0, 4).map(op => op.op)).toEqual(["q", "re", "W", "n"]);
    compare(drawing[1].args, [0, 0, ...o.paperMm.map(n => n * pt)], .00051);
    const origin = o.pageOrigins[index];
    const pathOps = drawing.filter(op => ["m", "l", "c", "h", "S", "B", "f"].includes(op.op));
    const expected = o.drawables.flatMap(l => [
      { op: "m", args: [(l.start.x - origin.x) * pt, (l.start.y - origin.y) * pt] },
      { op: "l", args: [(l.end.x - origin.x) * pt, (l.end.y - origin.y) * pt] }, { op: "S", args: [] }
    ]);
    compare(pathOps, expected, .00051);
    compare(drawing.filter(op => op.op === "w").map(op => op.args), o.drawables.map(l => [l.width * pt]), .00051);
    compare(drawing.filter(op => op.op === "RG").map(op => op.args), o.drawables.map(l => [1, 3, 5].map(i => parseInt(l.color.slice(i, i + 2), 16) / 255)), .00051);
    const expectedGuides = o.overlap ? [
      [o.overlap, 0, o.overlap, o.paperMm[1]], [o.paperMm[0] - o.overlap, 0, o.paperMm[0] - o.overlap, o.paperMm[1]],
      [0, o.overlap, o.paperMm[0], o.overlap], [0, o.paperMm[1] - o.overlap, o.paperMm[0], o.paperMm[1] - o.overlap]
    ].flatMap(v => [{ op: "m", args: v.slice(0, 2).map(n => n * pt) }, { op: "l", args: v.slice(2).map(n => n * pt) }, { op: "S", args: [] }]) : [];
    compare(guides.filter(op => ["m", "l", "S"].includes(op.op)), expectedGuides, .00051);
    // Shared global paths on each sheet are correct only inside this page clip.
    return { box: page.box, origin, clip: drawing[1].args, pathOps, guides: expectedGuides.length };
  });
}

describe("#1507 frozen source revisions through persistent Rust to physical artifacts", () => {
  it("seals the complete closed 12x4 matrix before observation", () => {
    expect(manifest.units.map(u => u.id)).toEqual(["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4", "P1", "P2", "P3", "P4"]);
    expect(manifest.extensions.length).toBeLessThanOrEqual(6); expect(manifest.reducers.length).toBeLessThanOrEqual(6);
    for (const unit of units) {
      expect(unit.checkpoints).toHaveLength(4);
      expect(unit.checkpoints[3].source).toBe(unit.checkpoints[0].source);
      for (const cp of unit.checkpoints) { expect(sha(cp.source)).toBe(cp.sha256); expect(sha(JSON.stringify(cp.oracle))).toBe(cp.oracleSha256); }
    }
  });
  it.each(units)("$id incremental/fresh x TS/Rust x SVG/PDF", async unit => {
    let current: TextCompileResult | undefined;
    const failures: string[] = [];
    const initialArtifacts = new Map<string, unknown>();
    for (const [index, cp] of unit.checkpoints.entries()) {
      const record: Record<string, unknown> = { id: unit.id, index, sourceSha256: cp.sha256, oracleSha256: cp.oracleSha256, results: [] };
      observations.push(record);
      current = current ? compileCanonicalText(current, cp.source) : compileFreshCanonicalText(cp.source);
      const fresh = compileFreshCanonicalText(cp.source);
      for (const [mode, c] of [["incremental", current], ["fresh", fresh]] as const) {
        try {
          expect(c.sourceText).toBe(cp.source); expect(c.docText).toBe(cp.source); expect(c.status).not.toBe("fatal");
          expect([...c.diagnostics, ...c.bindingIssueDiagnostics]).toEqual([]);
          expect(c.doc.statementMap.sourceRevision).toBe(c.currentCompiled.spans.sourceMap.sourceRevision);
          if (validateOnly) continue;
          for (const format of ["svg", "pdf"] as const) {
            const output = (format === "svg" ? c.doc.document.svgOutputs : c.doc.document.printOutputs).find(o => o.name === (format === "svg" ? "Vector" : "Paper"))!;
            expect(output).toBeDefined();
            const options = buildEvaluationOptions({ compiledDocument: c.doc, evaluationLimitIndex: undefined, selectedDrawingProfileId: output.profileId });
            const prepared = prepareRustEvaluation(c.doc.document.elements, options);
            expect(prepared.rustEligible).toBe(true);
            const reference = evaluateElementsReference(c.doc.document.elements, options);
            counts.evaluations++;
            const actual = evaluationPayloadToResult(await bounded(rust.request(prepared.input)) as EvaluationPayload);
            for (const result of [reference, actual]) {
              checkGeometry(c, result, cp.oracle);
              checkPlan(buildOutputPlan({ compiledDocument: c.doc, output, evaluation: result }), c, result, cp.oracle);
            }
            const plan = buildOutputPlan({ compiledDocument: c.doc, output, evaluation: actual });
            const path = join(directory, `${unit.id}-${index}-${mode}.${format}`);
            expect(existsSync(path)).toBe(false);
            counts.exports++;
            expect(await bounded(rust.exportOutput({ path, payload: plan.rustPayload }))).toEqual({ exported: true });
            expect(statSync(path).size).toBeLessThan(1024 * 1024);
            const bytes = readFileSync(path), contents = checkArtifact(bytes, format, cp.oracle);
            counts.inspections++;
            const artifactKey = `${mode}/${format}`;
            if (index === 0) initialArtifacts.set(artifactKey, contents);
            if (index === 3) expect(contents).toEqual(initialArtifacts.get(artifactKey));
            (record.results as unknown[]).push({ mode, format, path, bytes: bytes.length, sha256: sha(bytes), count: plan.drawables.length, pages: plan.print?.pages.length, contents });
          }
        } catch (error) { failures.push(`${unit.id}/${index}/${mode}: ${error instanceof Error ? error.stack : String(error)}`); }
      }
      record.disposition = failures.some(f => f.startsWith(`${unit.id}/${index}/`)) ? "FAIL" : validateOnly ? "COMPILE_VALID" : "PASS";
    }
    expect(failures).toEqual([]);
  }, 120000);
});
