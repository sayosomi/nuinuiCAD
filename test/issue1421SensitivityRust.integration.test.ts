import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { createRustStdioParityClient, optionsFor } from "./evaluationParitySupport";
import regressions from "./fixtures/issue1419/regressions.json";
import { matrix, pair } from "./fixtures/issue-stage4/model";

const evidence = process.env.ISSUE1421_EVIDENCE;
const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
let client: ReturnType<typeof createRustStdioParityClient>;
const counts = { compiler: 0, reference: 0, production: 0 };
const started = Date.now();
const observations: unknown[] = [];
beforeAll(() => { client = createRustStdioParityClient(process.cwd()); }, 130_000);
afterAll(() => {
  client?.dispose();
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, "sensitivity.json"), JSON.stringify({ started, ended: Date.now(), elapsedMs: Date.now() - started, counts, observations }, null, 2) + "\n");
  }
});

it("F04 holdout removes only Module-loop frame-owned lazy scheduling; ownership oracle and literal control", async () => {
  const regression = regressions.find(r => r.id === "F04-unexecuted-Module-frame-value")!;
  for (const [kind, source] of [["control", regression.control], ["holdout", regression.source]]) {
    counts.compiler++;
    const compiled = compileCanonicalText(initial, source);
    expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
    const fixture = { compiled, elements: compiled.doc.document.elements }, options = optionsFor(fixture);
    const prepared = prepareRustEvaluation(fixture.elements, options);
    expect(prepared.rustEligible).toBe(true);
    const owned = (prepared.input.geometryValueProgram ?? []).filter(p => {
      const instance = prepared.input.moduleMaterialization?.instances.find(i => JSON.stringify(i.instancePath) === JSON.stringify(p.occurrence.instancePath));
      let parent = fixture.elements.find(e => e.id === instance?.instanceId)?.parentGroupId;
      while (parent) {
        const owner = fixture.elements.find(e => e.id === parent);
        if (owner?.type === "forGroup") return true;
        parent = owner?.parentGroupId;
      }
      return false;
    });
    const checkOwnership = (program: typeof prepared.input.geometryValueProgram) => {
      for (const original of owned) expect(program?.find(p => JSON.stringify(p.occurrence) === JSON.stringify(original.occurrence))?.lazy, "Module value at lexical loop call site must retain frame-owned lazy scheduling").toBe(true);
    };
    checkOwnership(prepared.input.geometryValueProgram);
    expect(owned.length).toBe(kind === "holdout" ? 1 : 0);
    const negative = structuredClone(prepared.input);
    // Stage 3 F04's first loss was the missing lazy flag on the Module's
    // immutable value at a lexical loop call site. Mutate test data only.
    for (const entry of negative.geometryValueProgram ?? []) if (owned.some(p => JSON.stringify(p.occurrence) === JSON.stringify(entry.occurrence))) entry.lazy = false;
    if (kind === "holdout") expect(() => checkOwnership(negative.geometryValueProgram)).toThrow("Module value at lexical loop call site");
    else checkOwnership(negative.geometryValueProgram);
    counts.reference += 2; counts.production += 2;
    const reference = evaluateElementsReferencePayload(fixture.elements, options);
    const actual = await client.evaluateInput(prepared.input);
    const negativeReference = evaluateElementsReferencePayload(fixture.elements, { ...options, geometryValueProgram: negative.geometryValueProgram });
    const negativeActual = await client.evaluateInput(negative);
    for (const payload of [reference, actual]) {
      expect(payload.computedGeometry).toEqual([]); expect(payload.errors).toEqual([]); expect(payload.geometryValueErrors ?? []).toEqual([]);
    }
    for (const payload of [negativeReference, negativeActual]) {
      expect(payload.computedGeometry).toEqual([]);
      if (kind === "control") expect(payload.geometryValueErrors ?? []).toEqual([]);
    }
    observations.push({ referenceDetected: Boolean(negativeReference.geometryValueErrors?.length), productionDetected: Boolean(negativeActual.geometryValueErrors?.length), id: "F04", kind, source, input: prepared.input, negativeInput: negative, reference, actual, negativeReference, negativeActual, status: kind === "holdout" ? "BOUNDARY_DETECTED; output oracle masked by remaining dependency/owner gates" : "PASS control", newFamilies: 0 });
  }
}, 30_000);

it("records actual pilot exposure without treating absent holdout boundaries as coverage", () => {
  const exposure = [];
  for (const id of matrix.filter(id => Number(id.split("-")[2]) < 2)) for (const c of pair(id)) {
    counts.compiler++;
    const compiled = compileCanonicalText(initial, c.program.source);
    expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
    const elements = compiled.doc.document.elements;
    const loopModule = elements.filter(e => e.type === "moduleInstance").some(e => {
      let parent = e.parentGroupId;
      while (parent) {
        const owner = elements.find(e => e.id === parent);
        if (owner?.type === "forGroup") return true;
        parent = owner?.parentGroupId;
      }
      return false;
    });
    const rows = c.program.geometry.filter(g => /InnerTrace$/.test(g.name));
    const nested = c.stratum === "C" && c.method !== "B" && rows.length > 0;
    // Frozen oracle has two inner rows in the one active outer iteration;
    // the original pilot's passing result establishes that this frame ran.
    expect(nested ? rows.length : 0).toBe(nested ? 2 : 0);
    expect(loopModule).toBe(false);
    exposure.push({ id, member: c.member, F01: nested ? "ACTIVATED; nested source uses outer-frame selector/member" : "NOT_COVERED", F04: "NOT_COVERED; no Module call in a statement-for", innerRows: rows.length });
  }
  observations.push({ pilotExposure: exposure, note: "F01 semantic fault sensitivity is separately executed in the cfg(test) Rust resolver holdout, not an arm-wide mutation score." });
});

it.each([
  "nui 1\nconst Values: number[] = [7]\npoint Observed = coordinate(x: @Values[0] + @Missing, y: 0)\n",
  "nui 1\nconst Values: boolean[] = [true]\npoint Observed = coordinate(x: @Values[0], y: 0)\n",
  "nui 1\nconst Values: number[] = [7]\npoint Observed = coordinate(x: @Values[true], y: 0)\n"
])("retains rejection of invalid numeric collection construction: %s", source => {
  counts.compiler++;
  const compiled = compileCanonicalText(initial, source);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    appendFileSync(join(evidence, "invalid-field-attempts.ndjson"), JSON.stringify({ source, sha256: createHash("sha256").update(source).digest("hex"), status: compiled.status, diagnostics: compiled.diagnostics, expected: "fatal", method: "B", stratum: "C", purpose: "numeric-field error-control regression" }) + "\n");
  }
  expect(compiled.status).toBe("fatal");
  expect(compiled.diagnostics.some(d => d.severity === "error")).toBe(true);
});
