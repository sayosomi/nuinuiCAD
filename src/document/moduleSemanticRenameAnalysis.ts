import type { CompiledDslDocument } from "../dsl/dslDocument";
import { compileDslDocument } from "../dsl/dslDocument";
import { isBareDslIdentifierChar } from "../dsl/dslTokens";
import {
  createModuleSemanticRangeIndex,
  moduleSemanticDeclarationRange,
  moduleSemanticTargetKey,
  type ModuleSemanticTarget
} from "../dsl/moduleSemanticEditor";
import type { SourceSemanticRenameSpliceEntry } from "./typedRenameSplice";

export type ModuleRenameAnalysisRejected =
  | { verdict: "rejected"; reason: "target-not-found" | "stale" | "span-mismatch" | "invalid-name" | "same-scope-collision" | "capture" | "overlap"; detail?: string };

export type ModuleRenameAnalysis =
  | { verdict: "ok"; target: ModuleSemanticTarget; oldName: string; newName: string; entries: readonly SourceSemanticRenameSpliceEntry[] }
  | ModuleRenameAnalysisRejected;

const validIdentifier = (name: string) => {
  if (!name || ![...name].every(isBareDslIdentifierChar) || !/^[^0-9\s]/.test(name)) return false;
  return !new Set(["true", "false", "module", "export", "point", "line", "curve", "arc"]).has(name);
};

const statementIndexForOffset = (compiled: CompiledDslDocument, offset: number) => compiled.statements.findIndex((statement) =>
  statement.physicalSpan.segments.some((segment) => offset >= segment.from && offset <= segment.to)
);

const sameScopeCollision = (compiled: CompiledDslDocument, target: ModuleSemanticTarget, newName: string): boolean => {
  const analysis = compiled.moduleSemanticAnalysis;
  const namespace = compiled.sourceLexicalNamespace;
  if (!analysis || !namespace) return true;
  if (target.kind === "moduleParameter") {
    const definition = analysis.definitionsByStatementId.get(target.slot.definitionStatementId);
    if (!definition) return true;
    if (definition.parameters.some((parameter, index) => index !== target.slot.parameterIndex && parameter.name === newName)) return true;
    return (namespace.declarationsByScopeAndName.get(definition.bodyScopeId)?.get(newName) ?? []).length > 0;
  }
  const declaration = namespace.allDeclarations.find((candidate) => candidate.statementId === target.statementId);
  if (!declaration) return true;
  return (namespace.declarationsByScopeAndName.get(declaration.scopeId)?.get(newName) ?? [])
    .some((candidate) => candidate.statementId !== target.statementId);
};

const semanticFingerprint = (compiled: CompiledDslDocument) => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return null;
  const targetFingerprint = (target: unknown): unknown => {
    if (!target || typeof target !== "object") return target;
    const value = target as Record<string, unknown>;
    if (value.kind === "parameter") return { kind: value.kind, definitionStatementId: value.definitionStatementId, parameterIndex: value.parameterIndex };
    if (value.kind === "sourceGeometry" || value.kind === "sourceGeometryProperty" || value.kind === "moduleLocal" || value.kind === "elementLocalVariable" || value.kind === "iteration") {
      return { kind: value.kind, statementId: value.statementId };
    }
    if (value.kind === "deferredModuleExport" || value.kind === "deferredModuleExportProperty") {
      return { kind: value.kind, instanceStatementId: value.instanceStatementId };
    }
    return value.kind;
  };
  return JSON.stringify({
    definitions: analysis.definitions.map((definition) => ({ id: definition.statementId, body: definition.bodyStatementIds })),
    instances: analysis.instances.map((instance) => ({
      id: instance.statementId,
      callee: instance.callee?.definitionStatementId ?? null,
      bindings: instance.parameterBindings.map((binding) => ({ index: binding.parameterIndex, argument: binding.argumentIndex, target: targetFingerprint(binding.value) }))
    })),
    exports: analysis.definitions.flatMap((definition) => definition.exports.map((entry) => ({ owner: definition.statementId, id: entry.exportedStatementId, category: entry.category }))),
    bodies: analysis.definitions.flatMap((definition) => definition.bodyStatements.map((body) => ({
      id: body.statementId,
      scalar: body.scalarExpressions.flatMap((site) => site.expression.references.map((reference) => [reference.resolution, targetFingerprint(reference.target)])),
      geometry: body.geometryReferences.map((site) => [site.reference.resolution, targetFingerprint(site.reference.target)])
    }))),
    roots: [...analysis.rootGeometryReferencesByStatementId].map(([id, refs]) => [id, refs.map((site) => [site.reference.resolution, targetFingerprint(site.reference.target)])])
  });
};

const compileWithStableIds = (source: string, before: CompiledDslDocument) => compileDslDocument(source, {
  assignedStatementIds: before.statementMap?.statementIdByStatementIndex
});

export const analyzeModuleSemanticRename = (
  sourceText: string,
  compiled: CompiledDslDocument,
  target: ModuleSemanticTarget,
  newName: string
): ModuleRenameAnalysis => {
  if (!compiled.moduleSemanticAnalysis || !compiled.statementMap || !compiled.sourceLexicalNamespace) return { verdict: "rejected", reason: "stale" };
  if (sourceText.replace(/\r\n/g, "\n") !== compiled.spans.sourceMap.source) return { verdict: "rejected", reason: "stale" };
  if (!validIdentifier(newName)) return { verdict: "rejected", reason: "invalid-name", detail: "名前をDSL識別子として安全に表現できません。" };
  const index = createModuleSemanticRangeIndex(compiled);
  const declaration = moduleSemanticDeclarationRange(index, target);
  if (!declaration) return { verdict: "rejected", reason: "target-not-found" };
  const oldName = sourceText.slice(declaration.from, declaration.to);
  if (!oldName || !validIdentifier(oldName)) return { verdict: "rejected", reason: "span-mismatch" };
  if (newName === oldName) return { verdict: "ok", target, oldName, newName, entries: [] };
  if (sameScopeCollision(compiled, target, newName)) return { verdict: "rejected", reason: "same-scope-collision", detail: newName };
  const targetKey = moduleSemanticTargetKey(target);
  const entries: SourceSemanticRenameSpliceEntry[] = [];
  const seen = new Set<string>();
  for (const token of index.tokens) {
    if (moduleSemanticTargetKey(token.target) !== targetKey) continue;
    const statementIndex = statementIndexForOffset(compiled, token.from);
    if (statementIndex < 0 || token.to <= token.from || sourceText.slice(token.from, token.to) !== oldName) {
      return { verdict: "rejected", reason: "span-mismatch" };
    }
    const key = `${token.from}:${token.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ statementIndex, span: { start: 0, end: 0 }, oldName: sourceText.slice(token.from, token.to), newName, physicalSpan: {
      segments: [{ from: token.from, to: token.to }], sourceRevision: compiled.spans.sourceMap.sourceRevision
    }});
  }
  if (entries.length === 0) return { verdict: "rejected", reason: "target-not-found" };
  const replacements = [...entries].sort((a, b) => (a.physicalSpan!.segments[0].from - b.physicalSpan!.segments[0].from));
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index].physicalSpan!.segments[0].from < replacements[index - 1].physicalSpan!.segments[0].to) return { verdict: "rejected", reason: "overlap" };
  }
  const candidate = sourceText.replace(/\r\n/g, "\n");
  const edited = replacements.reduceRight((text, entry) => {
    const span = entry.physicalSpan!.segments[0];
    return `${text.slice(0, span.from)}${entry.newName}${text.slice(span.to)}`;
  }, candidate);
  const after = compileWithStableIds(edited, compiled);
  if (after.diagnostics.length > 0 || !after.moduleSemanticAnalysis || semanticFingerprint(after) !== semanticFingerprint(compiled)) {
    return { verdict: "rejected", reason: "capture" };
  }
  return { verdict: "ok", target, oldName, newName, entries };
};
