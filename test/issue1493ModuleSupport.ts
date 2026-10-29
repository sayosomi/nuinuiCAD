import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compileDslDocument, materializeModuleExecution, parseDsl } from "@nuinuicad/nui-language";
import { isLastGoodDslDocument } from "@nuinuicad/nui-language/document";

export type ModuleShape = "M1" | "M2" | "M3" | "M-control";
export const moduleCases = ["M1", "M2", "M3"].flatMap(shape =>
  [64, 128, 256, 512].map(count => ({ shape: shape as ModuleShape, count }))
).concat([{ shape: "M-control", count: 128 }, { shape: "M1", count: 2 }]);
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// The oracle is authored from these fixed topologies, before invoking the
// materializer. M3 has count/2 root calls and count/2 nested calls: count total
// instances and 2*count runtime entries, like M1.
export function moduleFixture(shape: ModuleShape, count: number) {
  const definitions = shape === "M3" ? [
    "module Inner() {", "  point P = coordinate(x: 1, y: -2)", "}",
    "module Outer() {", "  instance Nested = Inner()", "  point Q = coordinate(x: 3, y: -4)", "}"
  ] : shape === "M2" ? [
    "module M() {", "  group G {", "    point P = coordinate(x: 1, y: -2)",
    "    point Q = coordinate(x: 3, y: -4)", "    line L = segment(start: @P, end: @Q)", "  }", "}"
  ] : shape === "M1" ? ["module M() {", "  point P = coordinate(x: 1, y: -2)", "}"] : [];
  const roots = shape === "M3" ? count / 2 : count;
  const source = ["nui 1", ...definitions, ...Array.from({ length: roots }, (_, i) =>
    shape === "M-control" ? `point C${i} = coordinate(x: 1, y: -2)` : `instance I${i} = ${shape === "M3" ? "Outer" : "M"}()`
  )].join("\n");
  const parsed = parseDsl(source);
  assert.deepEqual(parsed.diagnostics, []);
  const ids = new Map(parsed.statements.map((_, i) => [i, `s:${i}`]));
  const indexOf = (name: string) => {
    const i = parsed.statements.findIndex(s => s.name === name);
    assert.ok(i >= 0, name);
    return i;
  };
  const runtimeId = (kind: "moduleInstance" | "moduleBody", path: string[]) =>
    `module-runtime:${[kind, ...path].map(s => `${s.length}:${s}`).join("")}`;
  type ExpectedEntry = { id: string; type: string; source: number; path: string[]; instancePath: string[]; parent?: string; definition?: number; caller: number | null; geometry?: object };
  const entries: ExpectedEntry[] = [];
  const snapshots: Array<{ instanceId: string; endRuntimeIndex: number; descendantIds: string[]; instancePath: string[] }> = [];
  const units: Array<{ sourceStatementIndex: number; runtimeStart: number; runtimeEnd: number }> = [];
  for (let i = 0; i < roots; i++) {
    const root = indexOf(`${shape === "M-control" ? "C" : "I"}${i}`);
    const start = entries.length;
    if (shape === "M-control") {
      entries.push({ id: ids.get(root)!, type: "freePoint", source: root, path: [], instancePath: [], caller: null, geometry: { kind: "point", x: 1, y: -2 } });
    } else {
      const path = [ids.get(root)!];
      const rootId = runtimeId("moduleInstance", path);
      const definition = indexOf(shape === "M3" ? "Outer" : "M");
      entries.push({ id: rootId, type: "moduleInstance", source: root, path, instancePath: path, definition, caller: null });
      const descendants: string[] = [];
      const body = (name: string, type: string, parent: string, instancePath: string[], def: number, caller: number | null, geometry?: object) => {
        const source = indexOf(name);
        const bodyPath = [...instancePath, ids.get(source)!];
        const id = runtimeId("moduleBody", bodyPath);
        entries.push({ id, type, source, path: bodyPath, instancePath, parent, definition: def, caller, geometry });
        if (geometry) descendants.push(id);
        return id;
      };
      if (shape === "M3") {
        const nestedSource = indexOf("Nested");
        const nestedPath = [...path, ids.get(nestedSource)!];
        const nestedId = runtimeId("moduleInstance", nestedPath);
        const inner = indexOf("Inner");
        entries.push({ id: nestedId, type: "moduleInstance", source: nestedSource, path: nestedPath, instancePath: nestedPath, parent: rootId, definition: inner, caller: definition });
        const p = body("P", "freePoint", nestedId, nestedPath, inner, definition, { kind: "point", x: 1, y: -2 });
        // Snapshot ordering is preorder, independently of completion order.
        snapshots.push({ instanceId: rootId, endRuntimeIndex: start + 3, descendantIds: descendants, instancePath: path });
        snapshots.push({ instanceId: nestedId, endRuntimeIndex: start + 2, descendantIds: [p], instancePath: nestedPath });
        body("Q", "freePoint", rootId, path, definition, null, { kind: "point", x: 3, y: -4 });
      } else if (shape === "M2") {
        const group = body("G", "group", rootId, path, definition, null);
        body("P", "freePoint", group, path, definition, null, { kind: "point", x: 1, y: -2 });
        body("Q", "freePoint", group, path, definition, null, { kind: "point", x: 3, y: -4 });
        body("L", "line", group, path, definition, null, { kind: "line", start: { x: 1, y: -2 }, end: { x: 3, y: -4 } });
      } else {
        body("P", "freePoint", rootId, path, definition, null, { kind: "point", x: 1, y: -2 });
      }
      if (shape !== "M3") snapshots.push({ instanceId: rootId, endRuntimeIndex: entries.length - 1, descendantIds: descendants, instancePath: path });
    }
    units.push({ sourceStatementIndex: root, runtimeStart: start, runtimeEnd: entries.length });
  }
  return { id: `${shape}-${count}`, source, sourceSha256: hash(source), ids, parsed, entries, snapshots, units };
}
export type ModuleFixture = ReturnType<typeof moduleFixture>;
export function compileModule(f: ModuleFixture) {
  const compiled = compileDslDocument(f.source, { preparsed: f.parsed, assignedStatementIds: f.ids, assignedElementIds: f.ids });
  assert.deepEqual(compiled.diagnostics, []);
  assert.ok(isLastGoodDslDocument(compiled));
  return compiled;
}
export function materializationInput(f: ModuleFixture, compiled = compileModule(f)) {
  return { statements: compiled.statements, stableStatementIdByIndex: f.ids, assignedElementIds: f.ids, moduleSemanticAnalysis: compiled.moduleSemanticAnalysis! };
}
export function assertMaterialization(f: ModuleFixture, m: ReturnType<typeof materializeModuleExecution>) {
  assert.deepEqual(m.executionStatements.map(e => e.runtimeElementId), f.entries.map(e => e.id));
  assert.deepEqual(m.sourceExecutionUnits, f.units);
  assert.deepEqual(m.instanceBaseGeometrySnapshots, f.snapshots);
  assert.equal(m.originByRuntimeElementId.size, f.entries.filter(e => e.path.length).length);
  assert.equal(m.runtimeIdentityByElementId.size, m.originByRuntimeElementId.size);
  assert.equal(m.sourceExecutionPositionByRuntimeElementId.size, m.originByRuntimeElementId.size);
  assert.deepEqual([...m.elementIdBySourceStatementIndex], f.entries.filter(e => !e.path.length).map(e => [e.source, e.id]));
  for (const [i, expected] of f.entries.entries()) {
    const actual = m.executionStatements[i];
    const unit = f.units.find(u => i >= u.runtimeStart && i < u.runtimeEnd)!;
    assert.equal(actual.sourceStatementIndex, expected.source);
    assert.equal(actual.sourceStatementId, f.ids.get(expected.source));
    assert.equal(actual.type, expected.type);
    assert.equal(actual.parentGroupId, expected.parent);
    assert.deepEqual(actual.instancePath, expected.instancePath);
    assert.equal(actual.executionUnitStatementIndex, unit.sourceStatementIndex);
    if (!expected.path.length) continue;
    const kind = expected.type === "moduleInstance" ? "moduleInstance" : "moduleBody";
    const runtimeIdentity = { kind, path: expected.path, key: expected.id.slice("module-runtime:".length) };
    assert.deepEqual(m.runtimeIdentityByElementId.get(expected.id), runtimeIdentity);
    assert.deepEqual(actual.runtimeIdentity, runtimeIdentity);
    assert.equal(m.sourceExecutionPositionByRuntimeElementId.get(expected.id), unit.sourceStatementIndex);
    assert.deepEqual(m.originByRuntimeElementId.get(expected.id), {
      kind,
      sourceStatementId: f.ids.get(expected.source), sourceStatementIndex: expected.source,
      moduleDefinitionStatementId: f.ids.get(expected.definition!),
      callerModuleDefinitionStatementId: expected.caller === null ? null : f.ids.get(expected.caller),
      instancePath: expected.instancePath,
      ...(expected.type !== "moduleInstance" ? { runtimeInstancePath: expected.instancePath } : {})
    });
    assert.deepEqual(actual.origin, m.originByRuntimeElementId.get(expected.id));
    assert.equal(actual.sourceBlockChild, Boolean(expected.parent && f.entries.find(e => e.id === expected.parent)?.type === "group"));
    assert.equal(actual.conditionalBranch, undefined);
  }
}

// Observe traversals of runtime-entry arrays, without modifying production
// code or adding a diagnostics API. Restore even when the operation throws.
export function runtimeArrayWork<T>(run: () => T) {
  let visits = 0;
  const descriptors = ["map", "filter"].map(key => [key, Object.getOwnPropertyDescriptor(Array.prototype, key)!] as const);
  try {
    for (const [key, descriptor] of descriptors) Object.defineProperty(Array.prototype, key, {
      ...descriptor,
      value: function (this: unknown[], ...args: unknown[]) {
        if (this.length && typeof this[0] === "object" && this[0] !== null && "runtimeElementId" in this[0]) visits += this.length;
        return Reflect.apply(descriptor.value, this, args);
      }
    });
    return { result: run(), visits: () => visits };
  } finally {
    for (const [key, descriptor] of descriptors) Object.defineProperty(Array.prototype, key, descriptor);
  }
}
