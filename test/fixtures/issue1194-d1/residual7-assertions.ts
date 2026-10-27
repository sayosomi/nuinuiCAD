import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { MultiDocumentImportGraph, MultiDocumentModuleSemanticAnalysis } from "@nuinuicad/nui-language/workspace";
import type { ResidualCell } from "./residual-model";
import { checkResidualCompiler } from "./residual-assertions";

export const checkSeventhCompiler = (c: ResidualCell, compiled: LastGoodDslDocument, graph?: MultiDocumentImportGraph, semantics?: MultiDocumentModuleSemanticAnalysis) => {
  checkResidualCompiler(c, compiled, graph, semantics);
  const definitions = new Map(compiled.sourceLexicalNamespace?.recordSemanticAnalysis?.definitionsByStatementId);
  for (const node of graph?.nodes.values() ?? []) {
    for (const [id, definition] of node.artifact.sourceLexicalNamespace.recordSemanticAnalysis?.definitionsByStatementId ?? []) definitions.set(id, definition);
  }
  const collections = compiled.scalarProgram?.collectionValues ?? [];
  const ids = new Set(collections.map(value => value.valueId));
  for (const value of collections) {
    if (value.kind === "recordMap") {
      expect(definitions.has(value.sourceTypeIdentity)).toBe(true);
      expect(definitions.has(value.resultTypeIdentity)).toBe(true);
    }
    if (value.kind === "literal") for (const member of value.members) {
      if (member.kind === "record") expect(definitions.has(member.typeIdentity)).toBe(true);
    }
  }
  for (const value of collections) {
    if (value.kind === "if") { expect(ids.has(value.thenValueId), value.thenValueId).toBe(true); expect(ids.has(value.elseValueId), value.elseValueId).toBe(true); }
    if (value.kind === "coalesce") { expect(ids.has(value.leftValueId), value.leftValueId).toBe(true); expect(ids.has(value.rightValueId), value.rightValueId).toBe(true); }
    if (value.kind === "match") for (const arm of value.arms) expect(ids.has(arm.valueId), arm.valueId).toBe(true);
  }
  if (c.domain === "nested-geometry-collection" && !c.id.startsWith("A-min") && c.id !== "A-record-export") {
    const inputs = compiled.moduleSemanticAnalysis!.geometryValues;
    const idsByName = new Map(inputs.map(value => [value.name, value.statementId]));
    for (const instance of compiled.moduleSemanticAnalysis!.instances.filter(value => ["One", "Two"].includes(value.name))) {
      const definition = compiled.moduleRuntimeContext?.definitionFor(instance.callee?.definitionIdentity)
        ?? compiled.moduleSemanticAnalysis!.definitionsByStatementId.get(instance.callee!.definitionStatementId)!;
      const namespace = compiled.moduleRuntimeContext?.documentFor(instance.callee?.definitionIdentity?.documentId)?.sourceLexicalNamespace
        ?? compiled.sourceLexicalNamespace!;
      const local = namespace.geometryArraySemanticAnalysis?.values.find(value => value.name === "Local" && value.ownerModuleDefinitionStatementIndex === definition.statementIndex);
      if (!local) continue; // The adjacent direct field route has no named array.
      const aliases = compiled.moduleGeometryRuntime?.resolveGeometryArrayAliasesForValueId?.(local.statementId, [instance.statementId]);
      const expected = instance.name === "One" ? ["P", "Q"] : ["Q", "P", "Q"];
      expect(aliases?.map(alias => alias.kind === "value" ? alias.occurrence.sourceStatementId : null)).toEqual(expected.map(name => idsByName.get(name)));
      const outer = [...definitions.values()].find(value => value.name === "Outer" && value.statementId === definition.recordValues.find(value => value.value.name === "Whole")?.value.typeIdentity)!;
      expect(outer).toBeDefined();
      const innerType = outer.fields[0]!.type;
      expect(innerType.kind).toBe("record");
      if (innerType.kind === "record") expect(definitions.get(innerType.identity!)?.name).toBe("Inner");
    }
  }
  if (c.id.startsWith("B-") && c.id !== "B-poison-selected" && c.id !== "B-map-free-scalar-source") {
    const programs = compiled.geometryValueProgram!.filter(value => value.sourceStatementId.includes("record-field-geometry"));
    const owners = compiled.moduleSemanticAnalysis!.instances.filter(value => ["One", "Two"].includes(value.name));
    expect(programs.length).toBeGreaterThanOrEqual(owners.length);
    for (const owner of owners) expect(programs.some(value => value.occurrence.instancePath.length === 1 && value.occurrence.instancePath[0] === owner.statementId)).toBe(true);
    const occurrences = new Set(programs.map(value => JSON.stringify(value.occurrence)));
    expect(occurrences.size).toBe(programs.length);
    const visitOccurrences = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visitOccurrences); return; }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.kind === "geometryValue" && node.occurrence && JSON.stringify(node.occurrence).includes("record-field-geometry")) expect(occurrences.has(JSON.stringify(node.occurrence))).toBe(true);
      Object.values(node).forEach(visitOccurrences);
    };
    visitOccurrences(compiled.geometryValueProgram);
  }
  // A source-owned collection access must reach an actual producer. A typed
  // index with an empty/missing value ID is not independent semantic evidence.
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (["collectionIndex", "collectionLength"].includes(String(node.kind))) expect(ids.has(String(node.collectionValueId)), String(node.collectionValueId)).toBe(true);
    Object.values(node).forEach(visit);
  };
  visit(compiled.scalarProgram);
  if (graph) {
    expect(graph.valid).toBe(true);
    expect(semantics?.valid).toBe(true);
    for (const instance of semantics!.root!.instances) expect(instance.callee?.definitionIdentity?.documentId).toBe(instance.name === "Two" && Boolean(c.saved?.["right.nui"]) ? "/issue1194/right.nui" : "/issue1194/lib.nui");
  }
};
