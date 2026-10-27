import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { emptyDocument, typedDependencyEndpointId } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel, type CanonicalDocumentValue, type TextCompileResult } from "@nuinuicad/nui-language/document";
import type { EvaluationResult } from "../src/types/geometry";
import manifest from "./fixtures/issue-1474/manifest.json";

export { manifest };
export type Checkpoint = typeof manifest.units[number]["checkpoints"][number];
export type Oracle = {
  scalars: Record<string, number>;
  geometry: Record<string, { type: "point"; x: number; y: number } | {
    type: "line"; start: { x: number; y: number }; end: { x: number; y: number }
  }>;
  dependencies: Record<string, string[]>;
  semanticV: number;
  semanticE: number;
};
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const initial = () => regenerateCanonicalFromModel(emptyDocument(), 1);
export function loadCheckpoint(checkpoint: Checkpoint) {
  const source = readFileSync(`test/fixtures/issue-1474/${checkpoint.file}`, "utf8");
  const oracleText = readFileSync(`test/fixtures/issue-1474/${checkpoint.oracle}`, "utf8");
  assert.equal(hash(source), checkpoint.sha256);
  assert.equal(hash(oracleText), checkpoint.oracleSha256);
  return { source, oracle: JSON.parse(oracleText) as Oracle };
}
export function compile(source: string, previous: CanonicalDocumentValue = initial()) {
  const compiled = compileCanonicalText(previous, source);
  assert.notEqual(compiled.status, "fatal", JSON.stringify(compiled.diagnostics));
  assert.deepEqual([...compiled.diagnostics, ...compiled.bindingIssueDiagnostics], []);
  assert.equal(compiled.sourceText, source);
  assert.equal(compiled.docText, source);
  assert.deepEqual(compiled.doc.typedDependencyGraph?.cycles, []);
  return compiled;
}
export function metrics(compiled: TextCompileResult) {
  const graph = compiled.doc.typedDependencyGraph!;
  const nodes = new Set<string>();
  const pairs = new Set<string>();
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const from = typedDependencyEndpointId(edge.from), to = typedDependencyEndpointId(edge.to);
    nodes.add(from); nodes.add(to); pairs.add(JSON.stringify([from, to]));
    if (!incoming.has(to)) incoming.set(to, new Set());
    if (!outgoing.has(from)) outgoing.set(from, new Set());
    incoming.get(to)!.add(from); outgoing.get(from)!.add(to);
  }
  return { V: nodes.size, E: pairs.size, edgeRecords: graph.edges.length,
    maxPrerequisites: Math.max(0, ...[...outgoing.values()].map(s => s.size)),
    maxDependents: Math.max(0, ...[...incoming.values()].map(s => s.size)),
    outputCount: compiled.doc.document.elements.length,
    bindingCount: compiled.doc.bindingAnalysis!.catalog.bindings.length,
    evaluationOrderCount: graph.evaluationOrder.length };
}
export function actualValues(compiled: TextCompileResult, result: EvaluationResult) {
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.geometryValueErrors ?? [], []);
  const scalars: Record<string, number> = {};
  for (const binding of compiled.doc.bindingAnalysis!.catalog.bindings) {
    const evaluation = result.computedScalarBindings?.get(binding.id);
    assert.equal(evaluation?.status, "ok", binding.name + JSON.stringify(evaluation));
    if (evaluation?.status !== "ok" || evaluation.value.kind !== "number") throw new Error(binding.name);
    scalars[binding.name] = evaluation.value.value;
  }
  const geometry: Oracle["geometry"] = {};
  for (const element of compiled.doc.document.elements) {
    const value = result.computedGeometry.get(element.id);
    assert.ok(value, element.name);
    if (value.type === "point") geometry[element.name] = { type: "point", x: value.x, y: value.y };
    else if (value.type === "line") geometry[element.name] = { type: "line", start: value.start, end: value.end };
    else throw new Error(`unexpected geometry ${element.name}:${value.type}`);
  }
  return { scalars, geometry };
}
export function checkValues(actual: ReturnType<typeof actualValues>, oracle: Oracle) {
  assert.deepEqual(actual.scalars, oracle.scalars);
  assert.deepEqual(actual.geometry, oracle.geometry);
}
export function sensitivity(actual: ReturnType<typeof actualValues>, oracle: Oracle) {
  const wrong = structuredClone(actual);
  const scalar = Object.keys(wrong.scalars)[0];
  if (scalar) wrong.scalars[scalar] += 1;
  else {
    const value = Object.values(wrong.geometry).find(v => v.type === "point")!;
    if (value.type === "point") value.x += 1;
  }
  assert.throws(() => checkValues(wrong, oracle), assert.AssertionError);
}
