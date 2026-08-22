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

type ModuleRenameCollision = {
  conflictingName: string;
  conflictingRange?: { from: number; to: number };
};

export type ModuleRenameAnalysisRejected =
  | { verdict: "rejected"; reason: "same-scope-collision"; detail: string; conflictingRange?: { from: number; to: number } }
  | { verdict: "rejected"; reason: "target-not-found" | "stale" | "span-mismatch" | "invalid-name" | "capture" | "overlap"; detail?: string };

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

const declarationNameRange = (declaration: { statement: CompiledDslDocument["statements"][number] }) => {
  const physical = declaration.statement.namePhysicalSpan;
  return physical?.segments.length === 1 ? physical.segments[0] : undefined;
};

const sameScopeCollision = (
  compiled: CompiledDslDocument,
  rangeIndex: ReturnType<typeof createModuleSemanticRangeIndex>,
  target: ModuleSemanticTarget,
  newName: string
): ModuleRenameCollision | null => {
  const analysis = compiled.moduleSemanticAnalysis;
  const namespace = compiled.sourceLexicalNamespace;
  const unavailable = (): ModuleRenameCollision => ({ conflictingName: newName });
  if (!analysis || !namespace) return unavailable();
  if (target.kind === "documentBinding") return unavailable();
  if (target.kind === "moduleParameter") {
    const definition = analysis.definitionsByStatementId.get(target.slot.definitionStatementId);
    if (!definition) return unavailable();
    const conflictingParameter = definition.parameters.find((parameter, index) =>
      index !== target.slot.parameterIndex && parameter.name === newName
    );
    if (conflictingParameter) {
      const conflictingRange = moduleSemanticDeclarationRange(rangeIndex, {
        kind: "moduleParameter",
        slot: {
          definitionStatementId: definition.statementId,
          parameterIndex: conflictingParameter.parameterIndex
        }
      });
      return { conflictingName: conflictingParameter.name, ...(conflictingRange ? { conflictingRange } : {}) };
    }
    const conflictingDeclaration = (namespace.declarationsByScopeAndName.get(definition.bodyScopeId)?.get(newName) ?? [])[0];
    if (conflictingDeclaration) {
      const conflictingRange = declarationNameRange(conflictingDeclaration);
      return { conflictingName: conflictingDeclaration.name, ...(conflictingRange ? { conflictingRange } : {}) };
    }
    return null;
  }
  const declaration = namespace.allDeclarations.find((candidate) => candidate.statementId === target.statementId);
  if (!declaration) return unavailable();
  const conflictingDeclaration = (namespace.declarationsByScopeAndName.get(declaration.scopeId)?.get(newName) ?? [])
    .find((candidate) => candidate.statementId !== target.statementId);
  if (!conflictingDeclaration) return null;
  const conflictingRange = declarationNameRange(conflictingDeclaration);
  return { conflictingName: conflictingDeclaration.name, ...(conflictingRange ? { conflictingRange } : {}) };
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
    if (value.kind === "sourceGeometry" || value.kind === "sourceGeometryProperty" || value.kind === "moduleLocal" || value.kind === "iteration") return { kind: value.kind, statementId: value.statementId, variableIndex: value.variableIndex ?? null };
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
  const expressionFingerprint = (expression: { references: readonly { resolution: string; target: unknown }[]; geometryProperties: readonly { resolution: string; target: unknown }[] } | null) => expression && ({
    references: expression.references.map((reference) => [reference.resolution, targetFingerprint(reference.target)]),
    geometryProperties: expression.geometryProperties.map((reference) => [reference.resolution, targetFingerprint(reference.target)])
  });
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

type RenameReplacement = {
  from: number;
  to: number;
  oldName: string;
  newName: string;
};

const shorthandLabelTargetKey = (
  compiled: CompiledDslDocument,
  from: number,
  to: number
): string | null => {
  const statementIndex = statementIndexForOffset(compiled, from);
  const statement = compiled.statements[statementIndex];
  const instance = compiled.moduleSemanticAnalysis?.instances.find((candidate) => candidate.statementIndex === statementIndex);
  if (statement?.kind !== "moduleInstance" || !instance?.callee) return null;
  const argumentIndex = statement.arguments.findIndex((argument) => {
    const physical = argument.labelPhysicalSpan?.segments;
    return physical?.length === 1 && physical[0]?.from === from && physical[0]?.to === to;
  });
  if (argumentIndex < 0) return null;
  const binding = instance.parameterBindings.find((candidate) => candidate.argumentIndex === argumentIndex);
  if (!binding) return null;
  return moduleSemanticTargetKey({
    kind: "moduleParameter",
    slot: {
      definitionStatementId: instance.callee.definitionStatementId,
      parameterIndex: binding.parameterIndex
    }
  });
};

const shorthandRenameReplacement = (
  sourceText: string,
  compiled: CompiledDslDocument,
  index: ReturnType<typeof createModuleSemanticRangeIndex>,
  token: ReturnType<typeof createModuleSemanticRangeIndex>["tokens"][number],
  target: ModuleSemanticTarget,
  oldName: string,
  newName: string
): RenameReplacement | null => {
  if (token.from <= 0 || sourceText[token.from - 1] !== "@" || sourceText.slice(token.from, token.to) !== oldName) return null;
  const labelTargetKey = shorthandLabelTargetKey(compiled, token.from, token.to);
  if (!labelTargetKey) return null;
  const overlappingKeys = new Set(
    index.tokens
      .filter((candidate) => candidate.from === token.from && candidate.to === token.to)
      .map((candidate) => moduleSemanticTargetKey(candidate.target))
  );
  const targetKey = moduleSemanticTargetKey(target);
  if (!overlappingKeys.has(labelTargetKey) || !overlappingKeys.has(targetKey) || overlappingKeys.size < 2) return null;
  return targetKey === labelTargetKey
    ? { from: token.from - 1, to: token.to, oldName: `@${oldName}`, newName: `${newName}: @${oldName}` }
    : { from: token.from - 1, to: token.to, oldName: `@${oldName}`, newName: `${oldName}: @${newName}` };
};

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
  const collision = sameScopeCollision(compiled, index, target, newName);
  if (collision) {
    return {
      verdict: "rejected",
      reason: "same-scope-collision",
      detail: collision.conflictingName,
      ...(collision.conflictingRange ? { conflictingRange: collision.conflictingRange } : {})
    };
  }
  const targetKey = moduleSemanticTargetKey(target);
  const entries: SourceSemanticRenameSpliceEntry[] = [];
  const seen = new Set<string>();
  for (const token of index.tokens) {
    if (moduleSemanticTargetKey(token.target) !== targetKey) continue;
    const statementIndex = statementIndexForOffset(compiled, token.from);
    if (statementIndex < 0 || token.to <= token.from || sourceText.slice(token.from, token.to) !== oldName) {
      return { verdict: "rejected", reason: "span-mismatch" };
    }
    const replacement = shorthandRenameReplacement(sourceText, compiled, index, token, target, oldName, newName) ?? {
      from: token.from,
      to: token.to,
      oldName: sourceText.slice(token.from, token.to),
      newName
    };
    const key = `${replacement.from}:${replacement.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ statementIndex, span: { start: 0, end: 0 }, oldName: replacement.oldName, newName: replacement.newName, physicalSpan: {
      segments: [{ from: replacement.from, to: replacement.to }], sourceRevision: compiled.spans.sourceMap.sourceRevision
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