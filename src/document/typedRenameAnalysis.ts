// Task 37: thin CompiledDslDocument adapter for the pure typed-binding rename
// safety analysis in src/scalars/typedRenameAnalysis.ts. Mirrors the
// relationship src/model/typedDependencyQueries.ts already has to Task 36's
// src/scalars/typedDependencyGraph.ts - the algorithm stays decoupled from
// CompiledDslDocument, this file only adapts one to the other.
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { BindingId } from "../scalars/bindingCatalog";
import { analyzeTypedBindingRename, type TypedRenameAnalysis } from "../scalars/typedRenameAnalysis";

export type { TypedRenameAnalysis, TypedRenameAnalysisRejected, TypedRenameSpan } from "../scalars/typedRenameAnalysis";

export type AnalyzeTypedBindingRenameInDocumentInput = {
  compiled: CompiledDslDocument;
  targetBindingId: BindingId;
  newName: string;
};

export const analyzeTypedBindingRenameInDocument = ({
  compiled,
  targetBindingId,
  newName
}: AnalyzeTypedBindingRenameInDocumentInput): TypedRenameAnalysis => {
  if (!compiled.bindingAnalysis) {
    return { verdict: "rejected", reason: "target-not-found", detail: { targetBindingId } };
  }
  return analyzeTypedBindingRename({
    catalog: compiled.bindingAnalysis.catalog,
    statements: compiled.statements,
    targetBindingId,
    newName,
    scalarProgram: compiled.scalarProgram,
    setStatements: compiled.setStatements,
    propertyBindings: compiled.propertyBindings,
    textTemplates: compiled.textTemplates
  });
};
