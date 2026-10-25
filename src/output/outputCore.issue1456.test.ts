// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../geometry/rustEvaluationRunner";
import { evaluationPayloadToResult, type EvaluationPayload } from "../geometry/evaluationPayload";
import { buildOutputPlan, evaluateOutputPlan, type OutputPlan } from "./outputCore";

const root = "test/fixtures/issue-1456/";

type Frozen = { id: string; variant: string; source: string; elementIds?: Record<string, string>; evaluatedIds?: string[]; drawableIds?: string[]; expected: Record<string, unknown> };
const cases: Frozen[] = JSON.parse(readFileSync(`${root}cases.json`, "utf8"));
const unitOrder = (id: string) => createHash("sha256").update(`1456:${id}`).digest("hex");
const executionCases = [...cases].sort((a, b) => unitOrder(a.id).localeCompare(unitOrder(b.id)));
const rust = process.env.ISSUE1456_RUST === "1";
const evidence = process.env.ISSUE1456_EVIDENCE;
const compile = (c: Frozen) => {
  const result = compileFreshCanonicalText(c.source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  expect(result.doc.diagnostics.filter(d => d.severity === "error"), `${c.id}/${c.variant} compiler`).toEqual([]);
  return result.doc;
};
// Compare independent frozen numeric values, never outputDrawableBounds or planner-derived expectations.
const agrees = (actual: unknown, expected: unknown, path = "root"): void => {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs((actual as number) - expected), path).toBeLessThan(1e-8);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((x, i) => agrees((actual as unknown[])[i], x, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected)) agrees((actual as Record<string, unknown>)?.[key], value, `${path}.${key}`);
  } else expect(actual, path).toEqual(expected);
};
const projected = (plan: OutputPlan) => ({
  drawables: plan.drawables,
  placements: plan.placements.map(p => ({ ...p, target: undefined })),
  renderedBounds: plan.renderedBounds, bounds: plan.bounds, svg: plan.svg,
  contentOrigin: plan.rustPayload.kind === "svg" ? plan.rustPayload.contentOrigin : undefined,
  print: plan.print && { ...plan.print, pages: plan.print.pages.map(p => ({ ...p, guides: p.guides.map(g => ({ ...g, label: g.label ?? null })) })) }
});
const check = (plan: OutputPlan, c: Frozen) => {
  const { critical: _critical, placements, error: _error, ...expected } = c.expected;
  void _critical; void _error;
  agrees(projected(plan), expected);
  for (const [i, p] of (placements as Record<string, unknown>[]).entries()) {
    const { target, ...transform } = p;
    agrees(plan.placements[i], transform);
    expect(plan.placements[i].groupId).toBe(c.elementIds![String(target).split("::").at(-1)!]);
    expect(plan.placements[i].drawables.map(d => d.elementId)).toEqual(
      c.drawableIds!.slice(i * plan.placements[i].drawables.length, (i + 1) * plan.placements[i].drawables.length)
    );
  }
  expect(new Set(plan.placements.map(p => p.id)).size).toBe(plan.placements.length);
  agrees(plan.rustPayload.bounds, c.expected.renderedBounds);
  expect(plan.rustPayload.drawables).toEqual(plan.drawables);
  if (plan.rustPayload.kind === "svg") agrees(plan.rustPayload, { widthMm: plan.svg!.widthMm, heightMm: plan.svg!.heightMm, contentOrigin: c.expected.contentOrigin });
  else {
    agrees(plan.rustPayload.paper, { widthMm: plan.print!.paperWidthMm, heightMm: plan.print!.paperHeightMm });
    agrees(plan.rustPayload.stride, { x: plan.print!.strideXmm, y: plan.print!.strideYmm });
    expect(plan.rustPayload.pages).toEqual(plan.print!.pages);
  }
};
// Deliberately corrupt copies of observed plans: each listed contract must reject a plausible fault.
const sensitivities = (plan: OutputPlan, c: Frozen) => {
  const detected: string[] = [];
  const reject = (name: string, fault: (copy: OutputPlan) => void) => {
    const copy = structuredClone(plan);
    fault(copy);
    expect(() => check(copy, c), name).toThrow();
    detected.push(name);
  };
  if (c.id === "O1") {
    reject("rotation before mirror", p => { if (p.drawables[0].kind === "line") p.drawables[0].start = { x: 53, y: -19 }; });
    reject("omitted half-stroke", p => { p.renderedBounds.minX += 25.4 / 96; });
  }
  if (c.id === "O2" && c.variant === "positive") reject("missing swept arc cardinal", p => {
    const [arc] = c.expected.drawables as { center: { y: number }; radius: number; startAngleDeg: number; sweepAngleDeg: number }[];
    const endpoints = [arc.startAngleDeg, arc.startAngleDeg + arc.sweepAngleDeg];
    p.renderedBounds.maxY = arc.center.y + arc.radius * Math.max(...endpoints.map(a => Math.sin(a * Math.PI / 180))) + 25.4 / 96;
  });
  if (c.id === "O4") reject("reversed joined segments", p => { if (p.drawables[0].kind === "joinedPath") p.drawables[0].segments.reverse(); });
  if (c.id === "O7") reject("lost text reflection", p => { if (p.drawables[0].kind === "text") p.drawables[0].mirrorX = false; });
  if (c.id === "O3") reject("endpoint-only cubic bounds", p => {
    const d = c.expected.drawables as { start: { x: number; y: number }; end: { x: number; y: number } }[];
    p.renderedBounds.maxY = Math.max(d[0].start.y, d[0].end.y) + 25.4 / 96;
  });
  if (c.id === "O6") {
    reject("hidden profile drawable leakage", p => { p.drawables.push(structuredClone(p.drawables[0])); });
    reject("physical stroke scaled twice", p => { const d = p.drawables[0]; if (d.kind !== "text") d.stroke.widthMm *= 3; });
  }
  if (c.id === "O8") {
    reject("margin omitted from dimensions", p => { p.svg!.widthMm -= 14; });
    reject("margin omitted from content origin", p => { if (p.rustPayload.kind === "svg") p.rustPayload.contentOrigin.x += 7; });
  }
  if (c.id === "O9" && c.variant.endsWith("crossing")) reject("floor page count", p => { p.print!.columns = 1; p.print!.pages.length = 1; });
  if (c.id === "O10" && c.variant.endsWith("overlap10")) {
    reject("tile origin missing inset", p => { p.print!.pages[0].origin.x += 10; });
    reject("single-inset overlap stride", p => { p.print!.strideXmm += 10; });
    reject("unmatched neighboring labels", p => { p.print!.pages[1].guides[0].label!.text = "wrong"; });
    reject("noncoincident shared guides", p => { p.print!.pages[0].guides[1].positionMm += 1; });
    const pr = plan.print!;
    expect(pr.paperWidthMm - pr.strideXmm).toBe(20);
    expect(pr.paperHeightMm - pr.strideYmm).toBe(20);
    for (const page of pr.pages) {
      if (page.column < pr.columns - 1) {
        const neighbor = pr.pages[page.index + 1];
        expect(page.origin.x + page.guides[1].positionMm).toBeCloseTo(neighbor.origin.x + neighbor.guides[0].positionMm, 10);
        expect(page.guides[1].label!.text).toBe(neighbor.guides[0].label!.text);
      }
      if (page.row < pr.rows - 1) {
        const neighbor = pr.pages[page.index + pr.columns];
        expect(page.origin.y + page.guides[3].positionMm).toBeCloseTo(neighbor.origin.y + neighbor.guides[2].positionMm, 10);
        expect(page.guides[3].label!.text).toBe(neighbor.guides[2].label!.text);
      }
    }
  }
  return detected;
};
const date = vi.spyOn(Date, "now").mockReturnValue(1792886400000);
afterAll(() => date.mockRestore());
const compiled = new Map<Frozen, ReturnType<typeof compile>>();
beforeAll(() => {
  // Compile the entire frozen matrix before any observation, so identities also
  // remain deterministic when a single regression is selected with -t.
  for (const c of cases) {
    const doc = compile(c);
    expect(Object.fromEntries(doc.document.elements.map(e => [e.name, e.id]))).toEqual(c.elementIds);
    compiled.set(c, doc);
  }
  if (rust) execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--example", "evaluate_fixture"], { timeout: 120000, stdio: "inherit" });
}, 125000);

describe("Issue 1456 frozen compound physical output matrix", () => {
  for (const c of executionCases) it(`${c.id}/${c.variant}`, async () => {
    const doc = compiled.get(c)!;
    const output = doc.document.svgOutputs[0] ?? doc.document.printOutputs[0];
    const opts = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: doc.document.evaluationLimitIndex, selectedDrawingProfileId: output.profileId });
    const ts = evaluateElementsReference(doc.document.elements, opts);
    expect(ts.errors).toEqual([]);
    expect([...ts.computedGeometry.keys()].sort()).toEqual([...c.evaluatedIds!].sort());
    const prepared = prepareRustEvaluation(doc.document.elements, opts);
    const observations: Record<string, unknown>[] = [];
    const failures: string[] = [];
    for (const engine of rust && prepared.rustEligible ? ["TS", "Rust"] : ["TS"]) {
      const evaluation = engine === "TS" ? ts : evaluationPayloadToResult(JSON.parse(execFileSync(
        "rust-evaluator/target/debug/examples/evaluate_fixture", [],
        { input: JSON.stringify(prepared.input), encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }
      )) as EvaluationPayload);
      expect(evaluation.errors).toEqual([]);
      if (c.id === "O6") {
        const commonOptions = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: doc.document.evaluationLimitIndex });
        const commonPrepared = prepareRustEvaluation(doc.document.elements, commonOptions);
        expect(commonPrepared.rustEligible).toBe(true);
        const common = engine === "TS" ? evaluateElementsReference(doc.document.elements, commonOptions) : evaluationPayloadToResult(JSON.parse(execFileSync(
          "rust-evaluator/target/debug/examples/evaluate_fixture", [],
          { input: JSON.stringify(commonPrepared.input), encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }
        )) as EvaluationPayload);
        expect(common.errors).toEqual([]);
        expect(common.computedGeometry).toEqual(evaluation.computedGeometry);
        const hiddenId = c.elementIds!.HiddenEdge;
        expect(evaluation.computedGeometry.get(hiddenId)).toMatchObject({ kind: "line", start: { x: -1000, y: -1000 }, end: { x: 1000, y: 1000 } });
        expect(common.effectiveVisibleElementIds!.has(hiddenId)).toBe(true);
        expect(evaluation.effectiveVisibleElementIds!.has(hiddenId)).toBe(false);
      }
      expect([...evaluation.computedGeometry.keys()].sort()).toEqual([...c.evaluatedIds!].sort());
      let plan: OutputPlan | undefined; let error: string | undefined;
      try { plan = await evaluateOutputPlan({ compiledDocument: doc, output, evaluate: () => evaluation }); }
      catch (e) { error = String(e); }
      observations.push({ engine, rustEligible: prepared.rustEligible, sourceGeometry: [...evaluation.computedGeometry], plan, error });
      try {
        if (c.expected.error) expect(error).toContain(String(c.expected.error));
        else {
          expect(error).toBeUndefined();
          check(plan!, c);
          observations.at(-1)!.sensitivity = sensitivities(plan!, c);
          expect(buildOutputPlan({ compiledDocument: doc, output, evaluation })).toEqual(plan);
          if (["O5", "R1", "R2"].includes(c.id)) {
            const reordered = { ...evaluation, computedGeometry: new Map([...evaluation.computedGeometry].reverse()) };
            expect(buildOutputPlan({ compiledDocument: doc, output, evaluation: reordered })).toEqual(plan);
          }
        }
      } catch (e) { failures.push(`${engine}: ${String(e)}`); }
    }
    if (evidence) writeFileSync(`${evidence}/${c.id}-${c.variant}.json`, JSON.stringify({ id: c.id, variant: c.variant, observations, failures }, null, 2) + "\n");
    expect(failures).toEqual([]);
  }, 65000);
});
