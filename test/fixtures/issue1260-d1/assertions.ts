import { expect } from "vitest";
import type { TextCompileResult } from "@nuinuicad/nui-language/document";
import type { ResidualCell } from "../issue1194-d1/residual-model";
import type { EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import { evaluationPayloadToResult } from "../../../src/geometry/evaluationPayload";
import { geometryProof, nameFor } from "../issue-stage7/assertions";
import { runtimeDiagnosticsFor } from "../../evaluationParitySupport";
export type Cell = ResidualCell & {
  historical?: boolean;
  deferred?: string;
  geometry?: ReturnType<typeof geometryProof>;
  errors?: string[];
  instances?: string[];
  limitThrough?: string;
};
export function checkCampaign(c: Cell, compiled: TextCompileResult, payload: EvaluationPayload) {
  const doc = compiled.doc, result = evaluationPayloadToResult(payload);
  const binding = (name: string) => doc.bindingAnalysis!.catalog.bindings.find(b => b.name === name && b.kind === "typed" && b.resolutionMode !== "preResolvedOnly")!;
  for (const [name, value] of Object.entries(c.expected)) expect(result.computedScalarBindings?.get(binding(name)?.id), name)
    .toMatchObject({ status: "ok", value: { kind: "number", value } });
  for (const [name, issueCode] of Object.entries(c.expectedIssues ?? {})) expect(result.computedScalarBindings?.get(binding(name)?.id), name)
    .toMatchObject({ status: "error", issueCode });
  // Carry snapshots may share cached geometry identities with a drawable.
  // Observe authored/generated outputs, excluding evaluator-private cache keys.
  const outputIds = new Set([...doc.document.elements.map(e => e.id), ...(payload.forGroupGeneratedRows ?? []).map(row => row.generatedElementId)]);
  const geometry = geometryProof(compiled, { ...payload, computedGeometry: [...new Map(payload.computedGeometry.filter(g => outputIds.has(g.elementId)).map(g => [g.elementId, g])).values()] }), key = (g: { owner: string; at?: number[] }) => `${g.owner}[${g.at ?? ""}]`;
  expect(geometry.map(key).sort(), "exact emitted owners and occurrence paths").toEqual((c.geometry ?? []).map(key).sort());
  for (const expected of c.geometry ?? []) {
    const actual = geometry.find(g => key(g) === key(expected))!;
    if (expected.shape.kind === "point") expect(actual.shape).toEqual(expected.shape);
    else {
      expect(actual.shape).toMatchObject({ kind: expected.shape.kind, vertices: expected.shape.vertices });
      expect("length" in actual.shape ? actual.shape.length : undefined).toBeCloseTo(expected.shape.length, 7);
    }
  }
  expect(payload.errors.map(e => nameFor(compiled, e.elementId, payload)).sort(), "independent error owners").toEqual([...(c.errors ?? [])].sort());
  expect(payload.geometryValueErrors ?? [], "no unselected/disabled immutable errors").toEqual([]);
  const diagnostics = runtimeDiagnosticsFor({ compiled, elements: doc.document.elements }, payload);
  const scalarDiagnostics = diagnostics.filter(d => d.bindingId).map(d => [doc.bindingAnalysis!.catalog.bindingsById.get(d.bindingId!)?.name, d.code]).sort();
  expect(scalarDiagnostics, "stable attributed diagnostic set, no invented total order").toEqual(Object.entries(c.expectedIssues ?? {}).sort());
  for (const diagnostic of diagnostics) if (diagnostic.bindingId) expect(diagnostic.navigationTarget).toEqual({ kind: "binding", bindingId: diagnostic.bindingId });
  if (c.instances) expect((payload.instanceBaseGeometry ?? []).map(snapshot => nameFor(compiled, snapshot.instanceId)).sort()).toEqual([...c.instances].sort());
}
