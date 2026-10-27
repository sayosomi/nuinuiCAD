import { expect } from "vitest";
import type { TextCompileResult } from "@nuinuicad/nui-language/document";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import type { EvaluateDocumentInput } from "../../../src/geometry/rustEvaluationInput";
import { runtimeDiagnosticsFor } from "../../evaluationParitySupport";
import { json, type Geometry, type Program } from "./model";

export const recordsIn = (v: unknown): Record<string, unknown>[] => !v || typeof v !== "object" ? [] :
  Array.isArray(v) ? v.flatMap(recordsIn) : [v as Record<string, unknown>, ...Object.values(v).flatMap(recordsIn)];

export function checkCompiler(p: Program, compiled: TextCompileResult, input: EvaluateDocumentInput) {
  const doc = compiled.doc, analysis = doc.bindingAnalysis!;
  expect(analysis.issues).toEqual([]); expect(doc.typedDependencyGraph!.cycles).toEqual([]);
  const binding = (name: string) => {
    const matches = analysis.catalog.bindings.filter(b => b.name === name);
    expect(matches, `canonical binding ${name}`).toHaveLength(1); return matches[0];
  };
  for (const name of Object.keys(p.scalars)) expect(binding(name)).toBeDefined();
  const wire = JSON.parse(JSON.stringify(input)) as EvaluateDocumentInput;
  const plans = wire.bindingVersions?.immutableForGroups ?? [];
  const carries = plans.flatMap(g => [...g.carries, ...(g.collectionCarries ?? []), ...(g.geometryCarries ?? []), ...(g.geometryCollectionCarries ?? [])]);
  const carryIds = new Set(carries.map(c => c.bindingId));
  // Source names locate canonical declaration identities; consumers must retain
  // those identities, not merely agree numerically between two runtimes.
  for (const name of p.carries) {
    const owners = doc.document.elements.filter(e => e.type === "forGroup" && e.carries?.some(c => c.name === name));
    expect(owners.length, `source carry ${name}`).toBeGreaterThan(0);
    expect(carries.some(c => c.bindingId.endsWith(`:${name}`)), `runtime carry owner ${name}`).toBe(true);
  }
  if (p.paths.some(path => path.startsWith("simultaneous-"))) {
    const [left, right] = p.carries;
    const resolveAlias = (id: string): string => {
      const seen = new Set<string>();
      while (!seen.has(id)) {
        seen.add(id);
        const node = wire.bindingVersions?.collectionValues?.find(c => c.valueId === id);
        if (node?.kind !== "alias") return id;
        id = node.targetValueId;
      }
      throw new Error("cyclic generated carry alias");
    };
    const numeric = plans.flatMap(p => p.collectionCarries ?? []), geometry = plans.flatMap(p => p.geometryCollectionCarries ?? []);
    for (const [name, other] of [[left, right], [right, left]]) {
      const carry = [...numeric, ...geometry].find(c => c.bindingId.endsWith(`:${name}`))!;
      const target = [...numeric, ...geometry].find(c => c.bindingId.endsWith(`:${other}`))!;
      const next = "nextValueId" in carry ? resolveAlias(carry.nextValueId) : (carry.next as { kind: string; valueId: string }).valueId;
      expect(next, "simultaneous next retains the other incoming collection identity").toBe(target.collectionValueId);
    }
  }
  for (const target of recordsIn(wire).filter(r => r.kind === "geometryCarry")) expect(carryIds.has(String(target.bindingId)), "geometry carry reference owns a real plan").toBe(true);
  const occurrences = new Set(wire.geometryValueProgram?.map(entry => JSON.stringify(entry.occurrence)));
  for (const target of recordsIn(wire).filter(r => r.kind === "geometryValue" && r.occurrence)) {
    if (occurrences.has(JSON.stringify(target.occurrence))) continue;
    const occurrence = target.occurrence as { instancePath: string[] };
    // Disabled Module bodies deliberately have no executable value programs.
    // The retained reference must still point into exactly that disabled owner.
    expect(p.paths).toContain("dependent-consumer-unavailable");
    const instance = wire.moduleMaterialization?.instances.find(i => i.instancePath?.length === 1 && i.instancePath[0] === occurrence.instancePath[0]);
    const root = wire.elements.find(e => e.id === instance?.instanceId);
    expect(root).toMatchObject({ type: "moduleInstance", enabled: false });
  }
  const collectionIds = new Set([...(wire.bindingVersions?.collectionValues ?? wire.scalarProgram?.collectionValues ?? []).map(c => c.valueId), ...carries.flatMap(c => "collectionValueId" in c ? [c.collectionValueId] : [])]);
  for (const node of wire.bindingVersions?.collectionValues ?? []) if (node.kind === "alias") expect(collectionIds.has(node.targetValueId), "collection alias target identity").toBe(true);
  for (const plan of plans) {
    const sourcePlan = doc.bindingVersions?.immutableForGroups?.get(plan.ownerStatementId);
    expect(sourcePlan, "wire plan has canonical compiled owner").toBeDefined();
    expect(wire.bindingVersions?.forGroupOwners.some(o => o.ownerStatementId === plan.ownerStatementId), "wire execution owner").toBe(true);
    for (const carry of plan.carries) {
      const next = analysis.catalog.bindingsById.get(carry.nextBindingId!);
      if (next) {
        const initial = analysis.catalog.bindingsById.get(carry.bindingId)!;
        expect(next.effectiveScopeId, "next cannot directly target an outer carry").toBe(initial.effectiveScopeId);
      }
    }
  }
  if (p.paths.some(path => path.includes("staged-path") || path.includes("deferred-Module"))) {
    const geometry = plans.flatMap(g => g.geometryCarries ?? []);
    expect(geometry.some(c => (c.initializerTarget as { stagePath?: string[] }).stagePath?.join(".") === "shifted")).toBe(true);
    expect(geometry.some(c => (c.initializerTarget as { stagePath?: string[] }).stagePath?.join(".") === "base")).toBe(true);
    if (p.paths.some(path => path.includes("deferred-Module"))) {
      expect(wire.moduleMaterialization!.instances.filter(i => i.instancePath?.length === 2)).toHaveLength(2);
      expect(new Set(geometry.map(c => c.bindingId)).size).toBe(4);
    }
  }
  if (p.paths.some(path => path.includes("selected-occurrences")) && p.carries.length) {
    const chosen = binding(Object.keys(p.diagnosticBindings).find(n => n.endsWith("Chosen")) ?? (p.source.includes("RenamedChosen") ? "RenamedChosen" : "Chosen"));
    for (const edges of [doc.typedDependencyGraph!.edges, wire.scalarExpressionPayload!.conditionalDependencyGraph!.edges]) {
      const branches = edges.filter(e => e.from.kind === "binding" && e.from.id === chosen.id && e.requiredness === "conditional");
      expect(branches.some(e => e.activation?.guards.some(g => g.branch === "then"))).toBe(true);
      expect(branches.some(e => e.activation?.guards.some(g => g.branch === "else"))).toBe(true);
    }
  }
  return { binding, wire };
}

export function checkValues(p: Program, compiled: TextCompileResult, payload: EvaluationPayload) {
  const result = evaluationPayloadToResult(payload), elements = compiled.doc.document.elements;
  const bindings = compiled.doc.bindingAnalysis!.catalog.bindings;
  const binding = (name: string) => bindings.find(b => b.name === name && b.kind === "typed") ?? bindings.find(b => b.name === name);
  for (const [name, value] of Object.entries(p.scalars)) {
    const actual = result.computedScalarBindings?.get(binding(name)!.id);
    expect(actual, `independent scalar ${name}`).toMatchObject(typeof value === "bigint" ? { status: "ok", value: { kind: "number", value: Number(value) } } : { status: "error", issueCode: value });
  }
  const match = (actual: unknown, expected: Geometry) => expect(actual).toMatchObject("start" in expected ? { kind: "line", ...expected } : { kind: "point", ...expected });
  for (const observation of p.geometry) {
    if (!observation.at) {
      const owners = elements.filter(e => e.name === observation.name); expect(owners).toHaveLength(1);
      match(result.computedGeometry.get(owners[0].id), observation.value);
    } else {
      const instance = observation.instance ? elements.find(e => e.name === observation.instance && e.type === "moduleInstance") : undefined;
      const descendants = instance ? compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots.find(i => i.instanceId === instance.id)!.descendantIds : undefined;
      const templates = elements.filter(e => e.name === observation.name && (!descendants || descendants.includes(e.id))).map(e => e.id);
      const rows = (result.forGroupGeneratedRows ?? []).filter(r => templates.includes(r.templateElementId) && json(r.occurrencePath.map(s => s.iterationIndex)) === json(observation.at));
      expect(rows, `incoming snapshot ${observation.name} at ${observation.at}`).toHaveLength(1);
      match(result.computedGeometry.get(rows[0].generatedElementId), observation.value);
    }
  }
  const templateIds = new Set(elements.filter(e => p.templates.includes(e.name)).map(e => e.id));
  expect((result.forGroupGeneratedRows ?? []).filter(row => templateIds.has(row.templateElementId)), "complete per-iteration snapshot row count").toHaveLength(p.geometry.filter(o => o.at).length + p.failedGeometry.length);
  for (const expected of p.failedGeometry) {
    const rows = (result.forGroupGeneratedRows ?? []).filter(row => elements.find(e => e.id === row.templateElementId)?.name === expected.name && json(row.occurrencePath.map(s => s.iterationIndex)) === json(expected.at));
    expect(rows, "exact poisoned incoming occurrence").toHaveLength(1);
    expect(result.computedGeometry.has(rows[0].generatedElementId)).toBe(false);
    expect(result.errors.find(error => error.elementId === rows[0].generatedElementId)).toMatchObject({ missingDependencyId: expected.dependency });
  }
  for (const name of p.absent) for (const element of elements.filter(e => e.name === name)) expect(result.computedGeometry.has(element.id), `unavailable ${name}`).toBe(false);
  const errors = result.errors.map(e => {
    const row = result.forGroupGeneratedRows?.find(row => row.generatedElementId === e.elementId);
    return row ? `${elements.find(owner => owner.id === row.templateElementId)?.name}[${row.occurrencePath.map(s => s.iterationIndex).join(",")}]` : elements.find(owner => owner.id === e.elementId)?.name ?? e.elementId;
  }).sort();
  expect(errors, "independent geometry diagnostic owners").toEqual([...p.errors].sort());
  for (const [name, instanceName] of Object.entries(p.errorInstances)) {
    const instance = elements.find(e => e.name === instanceName && e.type === "moduleInstance")!;
    const descendants = compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots.find(i => i.instanceId === instance.id)!.descendantIds;
    expect(result.errors.filter(e => elements.find(owner => owner.id === e.elementId)?.name === name).every(e => descendants.includes(e.elementId)), "exact failed Module source owner").toBe(true);
  }
  const valueErrors = (payload.geometryValueErrors ?? []).map(error => {
    const index = [...compiled.doc.statementMap.statementIdByStatementIndex!].find(([, id]) => id === error.occurrence.sourceStatementId)?.[0];
    const statement = index === undefined ? undefined : compiled.doc.statements[index];
    expect(error.occurrence.instancePath, "generated unselected/disabled values produce no stray Module errors").toEqual([]);
    return { name: statement && "name" in statement ? statement.name : error.occurrence.sourceStatementId, message: error.message };
  });
  expect(valueErrors, "exact immutable value diagnostic source owners").toEqual(p.valueErrors);
  const fixture = { compiled, elements };
  const diagnostics = runtimeDiagnosticsFor(fixture, payload);
  const actual = diagnostics.map(d => [bindingById(d.bindingId), d.code]).sort();
  function bindingById(id: string | undefined) { return bindings.find(b => b.id === id)?.name ?? id; }
  expect(actual, "exact runtime diagnostic codes and binding owners").toEqual(Object.entries(p.diagnosticBindings).sort());
  for (const diagnostic of diagnostics) if (diagnostic.bindingId) expect(diagnostic.navigationTarget).toEqual({ kind: "binding", bindingId: diagnostic.bindingId });
}
