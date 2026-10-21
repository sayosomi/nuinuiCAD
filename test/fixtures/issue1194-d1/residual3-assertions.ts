import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { MultiDocumentImportGraph, MultiDocumentModuleSemanticAnalysis } from "@nuinuicad/nui-language/workspace";
import { recordValueCollectionIdFor } from "@nuinuicad/nui-language";
import type { ResidualCell } from "./residual-model";
import { checkResidualCompiler } from "./residual-assertions";

export const checkThirdCompiler = (c: ResidualCell, compiled: LastGoodDslDocument, graph?: MultiDocumentImportGraph, semantics?: MultiDocumentModuleSemanticAnalysis) => {
  checkResidualCompiler(c, compiled, graph, semantics);
  const records = compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
  expect(records).toBeDefined();
  const definitions = records!.definitionsByStatementId;
  const collections = compiled.scalarProgram?.collectionValues ?? [];
  for (const value of collections) {
    if (value.kind === "literal") for (const member of value.members) {
      if (member.kind === "record") expect(definitions.has(member.typeIdentity), member.typeIdentity).toBe(true);
    }
    if (value.kind === "recordMap") {
      expect(definitions.has(value.sourceTypeIdentity)).toBe(true);
      expect(definitions.has(value.resultTypeIdentity)).toBe(true);
    }
  }
  // A selected binder is an alias of the original nominal source, including
  // the different result type in Wrap(b: @held). It never invents a record.
  if (["R1", "R2", "R5", "R7"].includes(c.id)) {
    const input = [...records!.valuesByStatementId.values()].find(v => v.name === "B")!;
    const chosen = [...records!.valuesByStatementId.values()].find(v => v.name === "Chosen")!;
    const namedType = (name: string) => [...definitions.values()].find(d => d.name === name)!.statementId;
    expect(input.typeIdentity).toBe(namedType("Box"));
    expect(chosen.typeIdentity).toBe(namedType(c.id === "R7" ? "Wrap" : "Box"));
    const descriptor = collections.find(v => v.valueId === recordValueCollectionIdFor([], chosen.statementId));
    expect(descriptor?.kind).toBe("match");
    if (descriptor?.kind === "match") expect(descriptor.scrutinee).toMatchObject({
      kind: "optionalMember", target: { kind: "collectionLength", collectionValueId: recordValueCollectionIdFor([], input.statementId) }
    });
    const selected = collections.find(v => v.valueId === `${recordValueCollectionIdFor([], chosen.statementId)}:arm:some`);
    expect(selected).toMatchObject({ kind: "recordMap", resultTypeIdentity: chosen.typeIdentity });
  }
  if (c.id === "R3") {
    const definition = compiled.moduleSemanticAnalysis!.definitions.find(d => d.name === "Make")!;
    const input = definition.recordValues.find(v => v.value.name === "B")!;
    const chosen = definition.recordValues.find(v => v.value.name === "Chosen")!;
    const box = [...definitions.values()].find(d => d.name === "Box")!.statementId;
    expect(chosen.value.typeIdentity).toBe(box);
    const instances = compiled.moduleSemanticAnalysis!.instances.filter(i => ["One", "Two"].includes(i.name));
    expect(instances).toHaveLength(2);
    for (const instance of instances) {
      const path = [instance.statementId];
      const descriptor = collections.find(v => v.valueId === recordValueCollectionIdFor(path, chosen.value.statementId));
      expect(descriptor).toMatchObject({ kind: "match", scrutinee: { kind: "optionalMember", target: {
        collectionValueId: recordValueCollectionIdFor(path, input.value.statementId)
      } } });
    }
  }
  if (["O1", "O2", "O3", "O5", "O8"].includes(c.id)) {
    const box = [...definitions.values()].find(v => v.name === "Box")!;
    for (const definition of compiled.moduleSemanticAnalysis?.definitions ?? []) {
      for (const parameter of definition.parameters.filter(p => p.name === "b")) {
        expect(parameter.recordTypeIdentity).toBe(box.statementId);
        expect(parameter.valueType?.kind).toBe("optional");
      }
      for (const output of definition.exports.filter(e => e.kind === "record")) {
        if (output.kind !== "record") continue;
        expect(output.typeIdentity).toBe(box.statementId);
        expect(output.definition.statementId).toBe(box.statementId);
        if (["O3", "O5", "O8"].includes(c.id)) expect(output.valueType?.kind).toBe("optional");
      }
    }
  }
  if (["G2", "G7", "G8"].includes(c.id)) {
    const instances = compiled.moduleSemanticAnalysis!.instances.filter(i => ["One", "Two"].includes(i.name));
    expect(instances).toHaveLength(2);
    const names = c.id === "G2" ? ["P", "Q"] : ["A", "B"];
    for (const [index, name] of names.entries()) {
      const value = compiled.geometryValueProgram?.find(v => {
        const statement = compiled.statements[v.sourceStatementIndex];
        return v.occurrence.instancePath.length === 0 && statement?.kind === "typedDeclaration" && statement.name === name;
      });
      expect(value, name).toBeDefined();
      expect(value?.construction).toMatchObject({ kind: "reference", target: { kind: "geometryValue", occurrence: { instancePath: [instances[index].statementId] } } });
    }
  }
  if (c.id === "G3") {
    const stageIndex = compiled.statements.findIndex(s => s.kind === "typedDeclaration" && s.name === "Stage");
    const stage = compiled.geometryValueProgram?.find(v => v.sourceStatementIndex === stageIndex);
    expect(stage?.construction).toMatchObject({ kind: "reference", target: { stagePath: ["shifted"] } });
    const selected = compiled.geometryValueProgram?.find(v => v.construction.kind === "match");
    expect(selected?.construction).toMatchObject({ kind: "match", arms: expect.arrayContaining([
      { label: "some", expression: { kind: "reference", target: expect.objectContaining({ occurrence: stage!.occurrence }) } }
    ]) });
  }
};
