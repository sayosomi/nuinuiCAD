import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import type { Cell } from "./model";

export const checkCompiler = (c: Cell, compiled: LastGoodDslDocument) => {
  if (!c.id.startsWith("A")) return;
  const collections = compiled.scalarProgram?.collectionValues ?? [];
  const sequences = collections.filter(value => value.kind === "literal" && value.valueId.startsWith("record-field-contents:")).map(value =>
    value.kind === "literal" ? value.members.map(member => member.kind === "literal" && member.value.kind === "number" ? member.value.value : null) : []);
  expect(sequences).toContainEqual([7, 19, 31]);
  if (c.axes[2]) expect(sequences).toContainEqual([37, 43]);
  for (const value of collections) {
    if (value.kind !== "alias" || !value.valueId.startsWith("record-field-contents:")) continue;
    expect(collections.some(candidate => candidate.valueId === value.targetValueId), value.targetValueId).toBe(true);
  }
};

export const checkPayload = (c: Cell, compiled: LastGoodDslDocument, payload: EvaluationPayload) => {
  const decoded = evaluationPayloadToResult(payload);
  expect(decoded.errors).toEqual([]);
  expect(payload.geometryValueErrors ?? []).toEqual([]);
  const bindingFor = (name: string) => {
    const binding = compiled.bindingAnalysis?.catalog.bindings.find(b => b.name === name && b.kind === "typed" && b.resolutionMode !== "preResolvedOnly");
    expect(binding, name).toBeDefined();
    return binding!;
  };
  for (const [name, value] of Object.entries(c.expected)) expect(decoded.computedScalarBindings?.get(bindingFor(name).id), name)
    .toMatchObject({ status: "ok", value: { kind: "number", value } });
  for (const [name, issueCode] of Object.entries(c.expectedIssues ?? {})) expect(decoded.computedScalarBindings?.get(bindingFor(name).id), name)
    .toMatchObject({ status: "error", issueCode });
  for (const name of c.expectedNone ?? []) expect(decoded.computedScalarBindings?.get(bindingFor(name).id), name)
    .toMatchObject({ status: "ok", value: { kind: "none" } });
  for (const [id, value] of decoded.computedScalarBindings ?? []) {
    if (value.status !== "error") continue;
    const name = compiled.bindingAnalysis?.catalog.bindingsById.get(id)?.name;
    expect(name && c.expectedIssues?.[name], `unexpected scalar diagnostic ${id}: ${JSON.stringify(value)}`).toBe(value.issueCode);
  }
};
