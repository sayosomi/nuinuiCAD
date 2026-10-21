import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { MultiDocumentImportGraph, MultiDocumentModuleSemanticAnalysis } from "@nuinuicad/nui-language/workspace";
import type { ResidualCell } from "./residual-model";
import { checkResidualCompiler } from "./residual-assertions";

export const checkSixthCompiler = (c: ResidualCell, compiled: LastGoodDslDocument, graph?: MultiDocumentImportGraph, semantics?: MultiDocumentModuleSemanticAnalysis) => {
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
  if (["G-module", "G-unselected-member", "G-constant"].includes(c.id)) {
    const fields = compiled.geometryValueProgram!.filter(value => value.sourceStatementId.includes("record-field-geometry"));
    expect(fields).toHaveLength(c.id === "G-module" ? 2 : 1);
    expect(fields.every(value => value.construction.kind === "segment")).toBe(true);
    if (c.id === "G-module") {
      const instances = compiled.moduleSemanticAnalysis!.instances.filter(value => ["One", "Two"].includes(value.name));
      expect(fields.map(value => value.occurrence.instancePath)).toEqual(instances.map(value => [value.statementId]));
    }
    const shape = [...definitions.values()].find(value => value.name === "Shape")!;
    const mapped = collections.filter(value => value.kind === "recordMap" && value.resultTypeIdentity === shape.statementId);
    expect(mapped.length).toBeGreaterThan(0);
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
    for (const instance of semantics!.root!.instances) expect(instance.callee?.definitionIdentity?.documentId).toBe("/issue1194/lib.nui");
  }
};
