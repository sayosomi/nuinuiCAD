import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { MultiDocumentImportGraph, MultiDocumentModuleSemanticAnalysis } from "@nuinuicad/nui-language/workspace";
import type { ResidualCell } from "./residual-model";
export const checkResidualCompiler = (c: ResidualCell, compiled: LastGoodDslDocument, graph?: MultiDocumentImportGraph, semantics?: MultiDocumentModuleSemanticAnalysis) => {
  expect(compiled.scalarProgram).toBeDefined();
  const collections = compiled.scalarProgram?.collectionValues ?? [];
  const ids = new Set(collections.map(value => value.valueId));
  expect(ids.size).toBe(collections.length);
  for (const value of collections) {
    if (value.kind === "alias") expect(ids.has(value.targetValueId), value.targetValueId).toBe(true);
    if (value.kind === "map" || value.kind === "recordMap" || value.kind === "recordField") expect(ids.has(value.sourceValueId), value.sourceValueId).toBe(true);
  }
  if (c.id === "G03") {
    const paths = compiled.geometryValueProgram?.filter(value => value.construction.kind === "polyline") ?? [];
    const instances = compiled.moduleSemanticAnalysis?.instances.filter(instance => ["One", "Two"].includes(instance.name)) ?? [];
    expect(paths).toHaveLength(2);
    expect(paths.map(value => value.occurrence.instancePath)).toEqual(instances.map(instance => [instance.statementId]));
    expect(new Set(paths.map(value => value.occurrence.sourceStatementId)).size).toBe(1);
  }
  if (c.domain !== "identity") return;
  expect(graph?.valid).toBe(true);
  expect(semantics?.valid).toBe(true);
  expect([...graph!.nodes.keys()].sort()).toEqual(["/issue1194/root.nui", ...Object.keys(c.saved!).map(p => `/issue1194/${p}`)].sort());
  const definitions = semantics!.definitions.filter(d => d.name === "Make");
  expect(definitions).toHaveLength(2);
  expect(definitions.map(d => d.identity?.documentId).sort()).toEqual(["/issue1194/left/library.nui", "/issue1194/right/library.nui"]);
  for (const instance of semantics!.root!.instances) {
    const side = ["A", "C", "RA", "RC"].includes(instance.name) ? "left" : "right";
    expect(instance.callee?.definitionIdentity?.documentId, instance.name).toBe(`/issue1194/${side}/library.nui`);
    if (!instance.name.startsWith("R")) continue;
    const argument = instance.parameterBindings[0]?.value;
    expect(argument?.kind).toBe("record");
    if (argument?.kind !== "record") continue;
    const target = argument.reference.target;
    expect(target?.kind).toBe("deferredModuleRecordExport");
    if (target?.kind !== "deferredModuleRecordExport") continue;
    expect(target.instanceName).toBe(instance.name.slice(1));
    expect(target.exportedIdentity?.documentId).toBe(`/issue1194/${side}/library.nui`);
    expect(argument.reference.typeIdentity).toBe(instance.callee?.definition?.parameters[0]?.recordTypeIdentity);
  }
};
