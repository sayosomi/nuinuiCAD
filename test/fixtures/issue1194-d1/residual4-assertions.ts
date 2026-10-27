import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import type { MultiDocumentImportGraph, MultiDocumentModuleSemanticAnalysis } from "@nuinuicad/nui-language/workspace";
import type { ResidualCell } from "./residual-model";
import { checkResidualCompiler } from "./residual-assertions";

export const checkFourthCompiler = (c: ResidualCell, compiled: LastGoodDslDocument, graph?: MultiDocumentImportGraph, semantics?: MultiDocumentModuleSemanticAnalysis) => {
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
  if (c.id === "M6" || c.id === "M0") {
    const records = compiled.moduleSemanticAnalysis!.rootRecordValuesByStatementId;
    const input = [...records.values()].find(value => value.value.name === "A")!;
    const chosen = [...records.values()].find(value => value.value.name === "Chosen")!.valueExpression;
    expect(chosen?.kind).toBe("collectionIndex");
    if (chosen?.kind === "collectionIndex") expect(chosen.reference.target).toMatchObject({
      kind: "recordCollectionIndex", typeIdentity: input.value.typeIdentity,
      members: [{ kind: "recordValue", statementId: input.value.statementId, typeIdentity: input.value.typeIdentity }]
    });
  }
  if (c.domain === "document") {
    expect(graph?.valid).toBe(true);
    expect(semantics?.valid).toBe(true);
    const foreign = semantics!.definitions.filter(value => value.name === "Make");
    expect(new Set(foreign.map(value => value.identity!.documentId)).size).toBe(c.id === "D4" ? 1 : 2);
    for (const instance of semantics!.root!.instances) expect(instance.callee?.definitionIdentity?.documentId).not.toBe("/issue1194/root.nui");
    if (c.id === "D4") {
      const paths = compiled.geometryValueProgram?.filter(value => value.construction.kind === "segment") ?? [];
      expect(paths).toHaveLength(2);
      expect(new Set(paths.map(value => JSON.stringify(value.occurrence.instancePath))).size).toBe(2);
      expect(paths.every(value => value.occurrence.instancePath.length === 2)).toBe(true);
      expect(new Set(paths.map(value => value.occurrence.sourceStatementId)).size).toBe(1);
    }
  }
};
