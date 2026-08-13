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
  if (target.kind === "documentBinding") return true;
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

/** Stable-resolution snapshot used by both module rename safety && its
 * compile-after-splice boundary. Names && export labels are intentionally
 * absent; source statement/parameter identities are the comparison keys. */
export const moduleSemanticStableFingerprint = (compiled: CompiledDslDocument) => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis) return null;
  const targetFingerprint = (target: unknown): unknown => {
    if (!target || typeof target !== "object") return target;
    const value = target as Record<string, unknown>;
    if (value.kind === "parameter" || value.kind === "parameterProperty") return { kind: value.kind, definitionStatementId: value.definitionStatementId, parameterIndex: value.parameterIndex };
    if (value.kind === "sourceGeometry" || value.kind === "sourceGeometryProperty" || value.kind === "moduleLocal" || value.kind === "elementLocalVariable" || value.kind === "iteration") return { kind: value.kind, statementId: value.statementId, variableIndex: value.variableIndex ?? null };
    if (value.kind === "documentBinding") return { kind: value.kind, bindingId: value.bindingId };
    if (value.kind === "deferredModuleScalarExport" || value.kind === "deferredModuleExport" || value.kind === "deferredModuleExportProperty") {
      const instance = analysis.instancesByStatementId.get(value.instanceStatementId as string);
      const definition = instance?.callee && analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
      const exported = definition?.exports.find((entry) => entry.name === value.exportName);
      return {
        kind: value.kind,
        instanceStatementId: value.instanceStatementId,
        exportedStatementId: value.exportedStatementId ?? exported?.exportedStatementId ?? null,
        property: value.property ?? null
      };
    }
    return value.kind;
  };
  const expressionFingerprint = (expression: { references: readonly { resolution: string; target: unknown }[]; geometryProperties: readonly { resolution: string; target: unknown }[] } | null) => expression && {
    references: expression.references.map((reference) => [reference.resolution, targetFingerprint(reference.target)]),
    geometryProperties: expression.geometryProperties.map((reference) => [reference.resolution, targetFingerprint(reference.target)])
  };
  const geometryFingerprint = (reference: { resolution: string; target: unknown; coordinate: { x: Parameters<typeof expressionFingerprint>[0]; y: Parameters<typeof expressionFingerprint>[0] } | null }) => ({
    resolution: reference.resolution,
    target: targetFingerprint(reference.target),
    coordinate: reference.coordinate ? { x: expressionFingerprint(reference.coordinate.x), y: expressionFingerprint(reference.coordinate.y) } : null
  });
  return JSON.stringify({
    definitions: analysis.definitions.map((definition) => ({
      id: definition.statementId,
      body: definition.bodyStatementIds,
      parameters: definition.parameters.map((parameter) => ({ index: parameter.parameterIndex, type: parameter.type, default: expressionFingerprint(parameter.defaultExpression) })),
      locals: definition.localScalars.map((local) => ({ id: local.statementId, type: local.type, initializer: expressionFingerprint(local.initializer) })),
      exports: definition.exports.map((entry) => entry.kind === "geometry"
        ? { id: entry.exportedStatementId, kind: entry.kind, category: entry.category }
        : { id: entry.exportedStatementId, kind: entry.kind, declaredType: entry.declaredType, bindingKind: entry.bindingKind })
    })),
    instances: analysis.instances.map((instance) => ({
      id: instance.statementId,
      callee: instance.callee?.definitionStatementId ?? null,
      resolution: instance.calleeResolution,
      bindings: instance.parameterBindings.map((binding) => ({
        index: binding.parameterIndex,
        argument: binding.argumentIndex,
        default: binding.usesDefault,
        value: binding.value?.kind === "scalar"
          ? { kind: "scalar", expression: expressionFingerprint(binding.value.expression) }
          : binding.value?.kind === "geometry"
            ? { kind: "geometry", reference: geometryFingerprint(binding.value.reference) }
            : null
      }))
    })),
    bodies: analysis.definitions.flatMap((definition) => definition.bodyStatements.map((body) => ({
      id: body.statementId,
      scalar: body.scalarExpressions.map((site) => [site.parameterKey, expressionFingerprint(site.expression)]),
      geometry: body.geometryReferences.map((site) => [site.parameterKey, geometryFingerprint(site.reference)]),
      templates: body.textTemplateHoles.map((site) => expressionFingerprint(site.expression)),
      scalarTarget: targetFingerprint(body.scalarTarget)
    }))),
    roots: [...analysis.rootGeometryReferencesByStatementId].map(([id, refs]) => [id, refs.map((site) => geometryFingerprint(site.reference))]),
    scalarRoots: [...analysis.rootScalarExpressionsByStatementId].map(([id, site]) => [id, expressionFingerprint(site.expression)])
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
  if (after.diagnostics.length > 0 || !after.moduleSemanticAnalysis || moduleSemanticStableFingerprint(after) !== moduleSemanticStableFingerprint(compiled)) {
    return { verdict: "rejected", reason: "capture" };
  }
  return { verdict: "ok", target, oldName, newName, entries };
};
