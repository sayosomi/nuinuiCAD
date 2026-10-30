import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { TextCompileResult } from "@nuinuicad/nui-language/document";
import type { EvaluationResult } from "../src/types/geometry";

export type Checkpoint = {
  file: string; sha256: string; sourceRevision: number; docRevision: number; invalid: boolean;
  expected: Record<string, unknown>; scalars: Record<string, number>;
};
export type Unit = { id: string; count: number; instances: number; checkpoints: Checkpoint[] };
export const directory = "test/fixtures/issue-1515";
export const manifest = JSON.parse(gunzipSync(readFileSync(`${directory}/manifest.json.gz`)).toString("utf8")) as {
  base: string; coordinateTolerance: number; lengthTolerance: number; units: Unit[];
};
export const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export function sourceFor(cp: Checkpoint) {
  const source = readFileSync(`${directory}/${cp.file}`, "utf8");
  assert.equal(hash(source), cp.sha256, cp.file);
  return source;
}
export function declarationNames(c: TextCompileResult) {
  const d = c.doc;
  const nameAt = (i: number): string => {
    const s = d.statements[i];
    return [s.enclosing ? nameAt(s.enclosing.statementIndex) : "", "name" in s ? s.name : s.kind].filter(Boolean).join("::");
  };
  return new Map([...d.statementMap.statementIdByStatementIndex ?? []].map(([i, id]) => [id, nameAt(i)]));
}
export function runtimeOwners(c: TextCompileResult) {
  const names = declarationNames(c);
  const m = c.doc.moduleMaterialization!;
  return new Map(c.doc.document.elements.map(e => {
    const o = m.originByRuntimeElementId.get(e.id);
    const name = [...o?.instancePath.map(id => names.get(id)) ?? [], e.name].join("::");
    return [name, { id: e.id, source: o ? names.get(o.sourceStatementId) : names.get(e.id), path: o?.instancePath.map(id => names.get(id)) ?? [], type: e.type }];
  }));
}
export function dependencyOwners(c: TextCompileResult) {
  const names = declarationNames(c);
  const owners = new Map([...runtimeOwners(c)].map(([name, e]) => [e.id, name]));
  const endpoint = (n: NonNullable<TextCompileResult["typedDependencyGraph"]>["edges"][number]["from"]) => ({
    kind: n.kind, owner: owners.get(n.id) ?? names.get(n.id) ?? c.doc.statements[n.statementIndex]?.kind,
    ...(n.kind === "geometry-stage" ? { stagePath: n.stagePath } : {})
  });
  return (c.typedDependencyGraph?.edges ?? []).map(e => JSON.stringify({ from: endpoint(e.from), to: endpoint(e.to), kind: e.kind, reason: e.reason, requiredness: e.requiredness })).sort();
}
export function compare(actual: unknown, expected: unknown, path = "oracle") {
  if (typeof expected === "number") {
    assert.equal(typeof actual, "number", path);
    const tolerance = path.endsWith("length") || path.endsWith("Length") ? manifest.lengthTolerance : manifest.coordinateTolerance;
    assert.ok(Math.abs(Number(actual) - expected) <= tolerance, `${path}: ${actual} != ${expected} ± ${tolerance}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, path);
    expected.forEach((v, i) => compare(actual[i], v, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", path);
    for (const [k, v] of Object.entries(expected)) compare((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else assert.deepEqual(actual, expected, path);
}
export function assertCompiled(c: TextCompileResult, fresh: TextCompileResult, cp: Checkpoint, unit: Unit, previous?: TextCompileResult) {
  assert.equal(c.sourceText, sourceFor(cp));
  assert.equal(c.currentCompiled.spans.sourceMap.sourceRevision, cp.sourceRevision);
  assert.equal(c.doc.statementMap.sourceRevision, cp.docRevision);
  assert.equal(c.currentCompiled.spans.sourceMap.source, sourceFor(cp));
  const diagnostics = (d: TextCompileResult) => [...d.diagnostics, ...d.bindingIssueDiagnostics];
  const normalized = (d: TextCompileResult) => diagnostics(d).map(x => ({ code: x.code, severity: x.severity, line: x.line, column: x.column, segments: x.physicalSpan?.segments }));
  assert.deepEqual(normalized(c), normalized(fresh));
  for (const d of diagnostics(c)) assert.equal(d.physicalSpan?.sourceRevision ?? d.sourceRevision, cp.sourceRevision);
  if (cp.invalid) {
    assert.equal(c.status, "fatal");
    assert.ok(diagnostics(c).some(d => d.severity === "error"));
    assert.equal(c.doc, previous!.doc);
    assert.equal(c.docText, previous!.docText);
    return;
  }
  assert.notEqual(c.status, "fatal");
  assert.deepEqual(diagnostics(c), []);
  assert.equal(c.docText, c.sourceText);
  assert.equal(c.doc.document.elements.filter(e => e.type !== "moduleInstance").length, unit.count);
  assert.equal(c.doc.document.elements.filter(e => e.type === "moduleInstance").length, unit.instances);
  assert.equal(c.doc.moduleMaterialization!.instanceBaseGeometrySnapshots.length, unit.instances);
  assert.deepEqual(dependencyOwners(c), dependencyOwners(fresh));
  const semanticOwners = (d: TextCompileResult) => [...runtimeOwners(d)].map(([name, e]) => [name, { ...e, id: undefined }]);
  assert.deepEqual(semanticOwners(c), semanticOwners(fresh));
  if (previous) {
    assert.deepEqual(declarationNames(c), declarationNames(previous), "source identities");
    assert.deepEqual(runtimeOwners(c), runtimeOwners(previous), "runtime identities/origins");
  }
  for (const [name, o] of runtimeOwners(c)) {
    if (!name.includes("::")) continue;
    const [owner, member] = name.split("::");
    assert.deepEqual(o.path, [owner]);
    assert.equal(o.source, o.type === "moduleInstance" ? owner : `Panel::${member}`);
  }
}
export function assertResult(c: TextCompileResult, result: EvaluationResult, cp: Checkpoint, unit: Unit) {
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.geometryValueErrors ?? [], []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.computedGeometry.size, unit.count);
  const owners = new Map([...runtimeOwners(c)].map(([name, e]) => [e.id, name]));
  const geometries = Object.fromEntries([...result.computedGeometry].map(([id, g]) => [owners.get(id)!, g]));
  assert.deepEqual(Object.keys(geometries).sort(), Object.keys(cp.expected).sort());
  compare(geometries, cp.expected);
  const names = declarationNames(c);
  const scalars: Record<string, unknown> = {};
  for (const [id, value] of result.computedScalarBindings ?? []) {
    const binding = c.doc.bindingAnalysis?.catalog.bindingsById.get(id);
    if (binding) scalars[names.get(c.doc.statementMap.statementIdByStatementIndex?.get(binding.statementIndex) ?? "") ?? binding.name] = value;
  }
  // Root scalar measurements are independent runtime observations. Per-instance
  // measurements are also checked through every actual seam/curve geometry.
  for (const key of ["width", "ControlseamLength", "ControlcurveLength"]) {
    compare(scalars[key], cp.scalars[key], key);
  }
  for (const s of c.doc.moduleMaterialization!.instanceBaseGeometrySnapshots) {
    assert.equal(s.descendantIds.length, 8);
    assert.deepEqual(result.instanceBaseGeometry?.get(s.instanceId), s.descendantIds.map(id => result.computedGeometry.get(id)));
  }
  return { geometryCount: result.computedGeometry.size, geometrySha256: hash(JSON.stringify(cp.expected)), scalarObservations: scalars };
}
