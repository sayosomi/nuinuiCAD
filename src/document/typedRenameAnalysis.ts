// Task 37: thin CompiledDslDocument adapter for the pure typed-binding rename
// safety analysis in src/scalars/typedRenameAnalysis.ts. Mirrors the
// relationship src/model/typedDependencyQueries.ts already has to Task 36's
// src/scalars/typedDependencyGraph.ts - the algorithm stays decoupled from
// CompiledDslDocument, this file only adapts one to the other.
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { BindingId } from "../scalars/bindingCatalog";
import { buildElementLocalRangeIndexFromElements } from "../scalars/elementLocalRangeIndex";
import { analyzeTypedBindingRename, type TypedRenameAnalysis, type TypedRenameSpan } from "../scalars/typedRenameAnalysis";
import { buildTypedRenameSplices, type TypedRenameSpliceEntry } from "./typedRenameSplice";
import { applyLineSplices } from "./textPatch";
import { compileDslDocument } from "../dsl/dslDocument";
import { moduleSemanticStableFingerprint } from "./moduleSemanticRenameAnalysis";
import type { ModuleScalarExpressionSemantic, ModuleGeometryReferenceSemantic } from "../dsl/moduleSemanticTypes";

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
  const analysis = analyzeTypedBindingRename({
    catalog: compiled.bindingAnalysis.catalog,
    statements: compiled.statements,
    targetBindingId,
    newName,
    scalarProgram: compiled.scalarProgram,
    setStatements: compiled.setStatements,
    propertyBindings: compiled.propertyBindings,
    textTemplates: compiled.textTemplates,
    numericBindings: compiled.numericBindings,
    elementLocalRangeIndex: buildElementLocalRangeIndexFromElements(compiled.document?.elements ?? [])
  });
  if (analysis.verdict === "rejected" || !compiled.moduleSemanticAnalysis) return analysis;

  const moduleOccurrences = moduleBindingOccurrences(compiled, targetBindingId, newName);
  const combined = { ...analysis, occurrences: [...analysis.occurrences, ...moduleOccurrences] };
  const target = compiled.bindingAnalysis.catalog.bindingsById.get(targetBindingId);
  if (!target || !combined.declarationSpan) return combined;
  const spliceAnalysis = buildTypedRenameSplices(compiled.spans.sourceMap.source, compiled, [
    { statementIndex: target.statementIndex, span: combined.declarationSpan, oldName: target.name, newName },
    ...combined.occurrences
  ] as readonly TypedRenameSpliceEntry[]);
  if (!spliceAnalysis.ok) {
    return { verdict: "rejected", reason: "capture", detail: { kind: "module-semantic", span: combined.declarationSpan, name: target.name } };
  }
  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(compiled.spans.sourceMap.source, spliceAnalysis.splices);
  } catch {
    return { verdict: "rejected", reason: "capture", detail: { kind: "module-semantic", span: combined.declarationSpan, name: target.name } };
  }
  const after = compileDslDocument(candidateSource, { assignedStatementIds: compiled.statementMap?.statementIdByStatementIndex });
  if (after.diagnostics.length > 0 || moduleSemanticStableFingerprint(after) !== moduleSemanticStableFingerprint(compiled)) {
    return { verdict: "rejected", reason: "capture", detail: { kind: "module-semantic", span: combined.declarationSpan, name: target.name } };
  }
  return combined;
};

const moduleBindingOccurrences = (
  compiled: CompiledDslDocument,
  bindingId: BindingId,
  newName: string
) => {
  // The explicit local array below keeps this adapter's output type inferred
  // from the reviewed typed-rename span contract without introducing a second
  // Binding resolver for inert module bodies.
  const result: TypedRenameSpan[] = [];
  const seen = new Set<string>();
  const addExpression = (statementIndex: number, expression: ModuleScalarExpressionSemantic | null) => {
    if (!expression) return;
    for (const reference of expression.references) {
      if (reference.target?.kind !== "documentBinding" || reference.target.bindingId !== bindingId) continue;
      const key = `${statementIndex}:${reference.nameSpan.start}:${reference.nameSpan.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ kind: "module-semantic", statementIndex, span: reference.nameSpan, oldName: reference.name, newName });
    }
  };
  const addGeometry = (statementIndex: number, reference: ModuleGeometryReferenceSemantic) => {
    addExpression(statementIndex, reference.coordinate?.x ?? null);
    addExpression(statementIndex, reference.coordinate?.y ?? null);
  };
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return result;
  for (const definition of analysis.definitions) {
    for (const parameter of definition.parameters) addExpression(definition.statementIndex, parameter.defaultExpression);
    for (const body of definition.bodyStatements) {
      for (const site of body.scalarExpressions) addExpression(body.statementIndex, site.expression);
      for (const site of body.textTemplateHoles) addExpression(body.statementIndex, site.expression);
      for (const site of body.geometryReferences) addGeometry(body.statementIndex, site.reference);
    }
  }
  for (const instance of analysis.instances) {
    for (const binding of instance.parameterBindings) {
      if (binding.argumentIndex === null) continue;
      if (binding.value?.kind === "scalar") addExpression(instance.statementIndex, binding.value.expression);
      else if (binding.value?.kind === "geometry") addGeometry(instance.statementIndex, binding.value.reference);
    }
  }
  for (const [statementId, sites] of analysis.rootGeometryReferencesByStatementId) {
    const statement = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (statement === undefined) continue;
    for (const site of sites) addGeometry(statement, site.reference);
  }
  return result;
};
