import type { CompiledDslDocument } from "../dsl/dslDocument";
import { compileDslDocument } from "../dsl/dslDocument";
import { createDslSemanticOccurrenceIndex, dslSemanticIdentityKey } from "../dsl/dslSemanticOccurrenceIndex";
import { parseGeometryArrayDeferredModuleExportId } from "../dsl/geometryArraySemanticAnalysis";
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

/** Optional boundary for callers whose exact candidate source needs the
 * already-established multi-document Module namespace during compile-after-
 * splice validation. The default remains compileWithStableIds below. */
export type ModuleRenameCandidateCompiler = (
  editedSource: string,
  before: CompiledDslDocument
) => CompiledDslDocument | null;

export type ModuleSemanticRenameOptions = {
  compileCandidate?: ModuleRenameCandidateCompiler;
};

export type RecordRenameTarget =
  | { kind: "recordType"; statementId: string }
  | { kind: "recordValue"; statementId: string }
  | { kind: "recordField"; field: { recordStatementId: string; fieldIndex: number } };

export type RecordRenameAnalysisRejected =
  | { verdict: "rejected"; reason: "target-not-found" | "stale" | "span-mismatch" | "invalid-name" | "capture" | "overlap"; detail?: string }
  | { verdict: "rejected"; reason: "same-scope-collision"; detail: string; conflictingRange?: { from: number; to: number } };

export type RecordRenameAnalysis =
  | { verdict: "ok"; target: RecordRenameTarget; oldName: string; newName: string; entries: readonly SourceSemanticRenameSpliceEntry[] }
  | RecordRenameAnalysisRejected;

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

const geometryArraySemanticOccurrences = (
  compiled: CompiledDslDocument,
  target: ModuleSemanticTarget
): {
  declaration: { from: number; to: number };
  tokens: readonly { from: number; to: number; target: ModuleSemanticTarget }[];
} | null => {
  if (
    target.kind !== "moduleSource" ||
    !compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.valuesByStatementId.has(target.statementId)
  ) return null;
  const key = dslSemanticIdentityKey({ kind: "module", target });
  const occurrences = createDslSemanticOccurrenceIndex(compiled).occurrences.filter((occurrence) =>
    dslSemanticIdentityKey(occurrence.identity) === key
  );
  const declaration = occurrences.find((occurrence) => occurrence.kind === "declaration");
  if (!declaration) return null;
  return {
    declaration: { from: declaration.from, to: declaration.to },
    tokens: occurrences.map((occurrence) => ({ from: occurrence.from, to: occurrence.to, target }))
  };
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
    if (value.kind === "parameter" || value.kind === "parameterProperty" || value.kind === "recordParameter") return { kind: value.kind, definitionStatementId: value.definitionStatementId, parameterIndex: value.parameterIndex };
    if (value.kind === "recordValue") return { kind: value.kind, statementId: value.statementId, typeIdentity: value.typeIdentity };
    if (value.kind === "recordField") return {
      kind: value.kind,
      record: targetFingerprint(value.record),
      field: value.field
    };
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
    if (value.kind === "deferredModuleRecordExport") {
      return {
        kind: value.kind,
        instanceStatementId: value.instanceStatementId,
        exportedStatementId: value.exportedStatementId,
        typeIdentity: value.typeIdentity
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
  const geometryArrayAnalysis = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis;
  const geometryArrayAliasTargetFingerprint = (targetValueId: string): unknown => {
    const deferred = parseGeometryArrayDeferredModuleExportId(targetValueId);
    if (!deferred) return targetValueId;
    const instance = analysis.instancesByStatementId.get(deferred.instanceStatementId);
    const definitionIndex = instance?.callee?.definitionStatementIndex;
    const exported = definitionIndex === undefined
      ? null
      : geometryArrayAnalysis?.values.find((value) =>
          value.ownerModuleDefinitionStatementIndex === definitionIndex &&
          value.exported &&
          value.name === deferred.exportName
        ) ?? null;
    return {
      kind: "deferredModuleArrayExport",
      instanceStatementId: deferred.instanceStatementId,
      exportedStatementId: exported?.statementId ?? null
    };
  };
  const geometryArrayTargetFingerprint = (target: unknown): unknown => {
    if (!target || typeof target !== "object") return target;
    const value = target as Record<string, unknown>;
    if (value.kind === "geometry") {
      return {
        kind: value.kind,
        statementId: value.statementId,
        interfaceType: value.interfaceType,
        pointKey: value.pointKey ?? null
      };
    }
    if (value.kind === "moduleParameter") {
      return {
        kind: value.kind,
        definitionStatementId: value.definitionStatementId,
        parameterIndex: value.parameterIndex,
        interfaceType: value.interfaceType,
        pointKey: value.pointKey ?? null
      };
    }
    if (value.kind === "coordinate") return { kind: value.kind, source: value.source };
    return value.kind;
  };
  return JSON.stringify({
    definitions: analysis.definitions.map((definition) => ({
      id: definition.statementId,
      body: definition.bodyStatementIds,
      parameters: definition.parameters.map((parameter) => ({ index: parameter.parameterIndex, type: parameter.type, recordTypeIdentity: parameter.recordTypeIdentity, default: expressionFingerprint(parameter.defaultExpression) })),
      locals: definition.localScalars.map((local) => ({ id: local.statementId, type: local.type, initializer: expressionFingerprint(local.initializer) })),
      records: definition.recordValues.map((record) => ({
        id: record.value.statementId,
        typeIdentity: record.value.typeIdentity,
        reference: record.value.reference?.targetTypeIdentity ?? null,
        constructor: record.value.constructor
          ? {
              typeIdentity: record.value.constructor.targetTypeIdentity,
              fields: record.value.constructor.fields.map((field) => [field.field, field.expectedType])
            }
          : null,
        target: targetFingerprint(record.target),
        fields: record.fields.map((field) => ({ field: field.field, expression: expressionFingerprint(field.expression) }))
      })),
      exports: definition.exports.map((entry) => entry.kind === "geometry"
        ? { id: entry.exportedStatementId, kind: entry.kind, category: entry.category }
        : entry.kind === "record"
          ? { id: entry.exportedStatementId, kind: entry.kind, typeIdentity: entry.typeIdentity }
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
          : binding.value?.kind === "record"
            ? {
                kind: "record",
                reference: {
                  resolution: binding.value.reference.resolution,
                  target: targetFingerprint(binding.value.reference.target),
                  typeIdentity: binding.value.reference.typeIdentity,
                  constructor: binding.value.reference.constructor
                    ? {
                        targetTypeIdentity: binding.value.reference.constructor.targetTypeIdentity,
                        fields: binding.value.reference.constructor.fields.map((field) => [field.field, field.expectedType, expressionFingerprint(field.expression)])
                      }
                    : null
                }
              }
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
    scalarRoots: [...analysis.rootScalarExpressionsByStatementId].map(([id, site]) => [id, expressionFingerprint(site.expression)]),
    geometryArrays: geometryArrayAnalysis ? {
      values: geometryArrayAnalysis.values.map((value) => ({
        id: value.statementId,
        type: value.type,
        owner: value.ownerModuleDefinitionStatementIndex === null
          ? null
          : compiled.statementMap?.statementIdByStatementIndex?.get(value.ownerModuleDefinitionStatementIndex) ?? value.ownerModuleDefinitionStatementIndex,
        exported: value.exported,
        value: value.value?.kind === "alias"
          ? { kind: "alias", type: value.value.type, target: geometryArrayAliasTargetFingerprint(value.value.targetValueId) }
          : value.value?.kind === "literal"
            ? {
                kind: "literal",
                type: value.value.type,
                members: value.value.members.map((member) => ({
                  interfaceType: member.interfaceType,
                  target: geometryArrayTargetFingerprint(member.target)
                }))
              }
            : null
      })),
      parameters: geometryArrayAnalysis.moduleParameters.map((parameter) => ({
        definitionStatementId: parameter.definitionStatementId,
        parameterIndex: parameter.parameterIndex,
        type: parameter.type,
        optional: parameter.optional
      }))
    } : null
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

export const shorthandLabelTargetKey = (
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

export const shorthandRenameReplacement = (
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
  newName: string,
  options: ModuleSemanticRenameOptions = {}
): ModuleRenameAnalysis => {
  if (!compiled.moduleSemanticAnalysis || !compiled.statementMap || !compiled.sourceLexicalNamespace) return { verdict: "rejected", reason: "stale" };
  if (sourceText.replace(/\r\n/g, "\n") !== compiled.spans.sourceMap.source) return { verdict: "rejected", reason: "stale" };
  if (!validIdentifier(newName)) return { verdict: "rejected", reason: "invalid-name", detail: "名前をDSL識別子として安全に表現できません。" };
  const index = createModuleSemanticRangeIndex(compiled);
  const geometryArrayOccurrences = geometryArraySemanticOccurrences(compiled, target);
  const declaration = moduleSemanticDeclarationRange(index, target) ?? geometryArrayOccurrences?.declaration;
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
  const tokens = geometryArrayOccurrences?.tokens ?? index.tokens;
  for (const token of tokens) {
    if (moduleSemanticTargetKey(token.target) !== targetKey) continue;
    const statementIndex = statementIndexForOffset(compiled, token.from);
    if (statementIndex < 0 || token.to <= token.from || sourceText.slice(token.from, token.to) !== oldName) {
      return { verdict: "rejected", reason: "span-mismatch" };
    }
    const replacement = geometryArrayOccurrences
      ? {
          from: token.from,
          to: token.to,
          oldName: sourceText.slice(token.from, token.to),
          newName
        }
      : shorthandRenameReplacement(sourceText, compiled, index, token, target, oldName, newName) ?? {
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
  const after = options.compileCandidate
    ? options.compileCandidate(edited, compiled)
    : compileWithStableIds(edited, compiled);
  if (!after || after.diagnostics.length > 0 || !after.moduleSemanticAnalysis || moduleSemanticStableFingerprint(after) !== moduleSemanticStableFingerprint(compiled)) {
    return { verdict: "rejected", reason: "capture" };
  }
  return { verdict: "ok", target, oldName, newName, entries };
};

const recordSemanticStableFingerprint = (compiled: CompiledDslDocument) => {
  const analysis = compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
  if (!analysis) return null;
  return JSON.stringify({
    definitions: [...analysis.definitionsByStatementId.values()].map((definition) => ({
      id: definition.statementId,
      fields: definition.fields.map((field) => ({ index: field.fieldIndex, type: field.type }))
    })),
    values: [...analysis.valuesByStatementId.values()].map((value) => ({
      id: value.statementId,
      typeIdentity: value.typeIdentity,
      typeReference: [value.typeReference.typeIdentity, value.typeReference.resolution],
      reference: value.reference?.targetTypeIdentity ?? null,
      constructor: value.constructor
        ? {
            targetTypeIdentity: value.constructor.targetTypeIdentity,
            fields: value.constructor.fields.map((field) => [field.field, field.expectedType])
          }
        : null
    })),
    parameters: analysis.moduleParameters.map((parameter) => ({
      definitionStatementId: parameter.definitionStatementId,
      parameterIndex: parameter.parameterIndex,
      typeIdentity: parameter.typeIdentity,
      typeReference: [parameter.typeReference.typeIdentity, parameter.typeReference.resolution]
    }))
  });
};

const recordRenameCollision = (
  compiled: CompiledDslDocument,
  target: RecordRenameTarget,
  newName: string,
  occurrenceIndex: ReturnType<typeof createDslSemanticOccurrenceIndex>
): ModuleRenameCollision | null => {
  const namespace = compiled.sourceLexicalNamespace;
  const records = namespace?.recordSemanticAnalysis;
  if (!namespace || !records) return { conflictingName: newName };
  if (target.kind === "recordField") {
    const definition = records.definitionsByStatementId.get(target.field.recordStatementId);
    const conflict = definition?.fields.find((field) => field.fieldIndex !== target.field.fieldIndex && field.name === newName);
    if (!conflict) return null;
    const identity = dslSemanticIdentityKey({ kind: "recordField", field: conflict.identity });
    const range = occurrenceIndex.occurrences.find((occurrence) =>
      occurrence.kind === "declaration" && dslSemanticIdentityKey(occurrence.identity) === identity
    );
    return { conflictingName: conflict.name, ...(range ? { conflictingRange: { from: range.from, to: range.to } } : {}) };
  }
  const declaration = namespace.allDeclarations.find((candidate) =>
    candidate.statementId === target.statementId &&
    (target.kind === "recordType" ? candidate.kind === "recordDefinition" : candidate.kind === "recordValue")
  );
  if (!declaration) return { conflictingName: newName };
  const conflict = (namespace.declarationsByScopeAndName.get(declaration.scopeId)?.get(newName) ?? [])
    .find((candidate) => candidate.statementId !== target.statementId);
  if (!conflict) return null;
  const range = conflict.nameSpan
    ? occurrenceIndex.occurrences.find((occurrence) => occurrence.kind === "declaration" && occurrence.from >= 0 && occurrence.to > occurrence.from &&
        occurrence.from === (conflict.statement.namePhysicalSpan?.segments[0]?.from ?? -1) &&
        occurrence.to === (conflict.statement.namePhysicalSpan?.segments[0]?.to ?? -1))
    : undefined;
  return { conflictingName: conflict.name, ...(range ? { conflictingRange: { from: range.from, to: range.to } } : {}) };
};

/** Safe source-semantic rename for nominal record identities. This deliberately
 * uses the same occurrence index, compile-after-splice, stable statement IDs,
 * and physical splice projection as Module rename. */
export const analyzeRecordSemanticRename = (
  sourceText: string,
  compiled: CompiledDslDocument,
  target: RecordRenameTarget,
  newName: string
): RecordRenameAnalysis => {
  if (!compiled.statementMap || !compiled.sourceLexicalNamespace) return { verdict: "rejected", reason: "stale" };
  if (sourceText.replace(/\r\n/g, "\n") !== compiled.spans.sourceMap.source) return { verdict: "rejected", reason: "stale" };
  if (!validIdentifier(newName)) return { verdict: "rejected", reason: "invalid-name", detail: "名前をDSL識別子として安全に表現できません。" };

  const occurrenceIndex = createDslSemanticOccurrenceIndex(compiled);
  const identityKey = dslSemanticIdentityKey(target);
  const occurrences = occurrenceIndex.occurrences.filter((occurrence) => dslSemanticIdentityKey(occurrence.identity) === identityKey);
  const declaration = occurrences.find((occurrence) => occurrence.kind === "declaration");
  if (!declaration || occurrences.filter((occurrence) => occurrence.kind === "declaration").length !== 1) {
    return { verdict: "rejected", reason: "target-not-found" };
  }
  const oldName = sourceText.slice(declaration.from, declaration.to);
  if (!oldName || !validIdentifier(oldName)) return { verdict: "rejected", reason: "span-mismatch" };
  if (newName === oldName) return { verdict: "ok", target, oldName, newName, entries: [] };
  const collision = recordRenameCollision(compiled, target, newName, occurrenceIndex);
  if (collision) return { verdict: "rejected", reason: "same-scope-collision", detail: collision.conflictingName, ...(collision.conflictingRange ? { conflictingRange: collision.conflictingRange } : {}) };

  const moduleIndex = createModuleSemanticRangeIndex(compiled);
  const entries: SourceSemanticRenameSpliceEntry[] = [];
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    if (occurrence.to <= occurrence.from || sourceText.slice(occurrence.from, occurrence.to) !== oldName) {
      return { verdict: "rejected", reason: "span-mismatch" };
    }
    let from = occurrence.from;
    let to = occurrence.to;
    let expectedText = oldName;
    let replacement = newName;
    if (target.kind === "recordValue") {
      const moduleTarget: ModuleSemanticTarget = { kind: "moduleSource", statementId: target.statementId };
      const moduleToken = moduleIndex.tokens.find((token) => token.from === occurrence.from && token.to === occurrence.to && moduleSemanticTargetKey(token.target) === moduleSemanticTargetKey(moduleTarget));
      if (moduleToken) {
        const shorthand = shorthandRenameReplacement(sourceText, compiled, moduleIndex, moduleToken, moduleTarget, oldName, newName);
        if (shorthand) {
          from = shorthand.from;
          to = shorthand.to;
          expectedText = shorthand.oldName;
          replacement = shorthand.newName;
        }
      }
    }
    const key = `${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      statementIndex: statementIndexForOffset(compiled, occurrence.from),
      span: { start: 0, end: 0 },
      oldName: expectedText,
      newName: replacement,
      physicalSpan: { segments: [{ from, to }], sourceRevision: compiled.spans.sourceMap.sourceRevision }
    });
  }
  if (entries.length === 0) return { verdict: "rejected", reason: "target-not-found" };
  const ordered = [...entries].sort((left, right) => left.physicalSpan!.segments[0]!.from - right.physicalSpan!.segments[0]!.from);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.physicalSpan!.segments[0]!.from < ordered[index - 1]!.physicalSpan!.segments[0]!.to) return { verdict: "rejected", reason: "overlap" };
  }
  const edited = ordered.reduceRight((text, entry) => {
    const span = entry.physicalSpan!.segments[0]!;
    return `${text.slice(0, span.from)}${entry.newName}${text.slice(span.to)}`;
  }, sourceText.replace(/\r\n/g, "\n"));
  const after = compileWithStableIds(edited, compiled);
  const afterRecords = after.sourceLexicalNamespace?.recordSemanticAnalysis;
  const targetStillNamed = target.kind === "recordType"
    ? afterRecords?.definitionsByStatementId.get(target.statementId)?.name === newName
    : target.kind === "recordValue"
      ? afterRecords?.valuesByStatementId.get(target.statementId)?.name === newName
      : afterRecords?.definitionsByStatementId.get(target.field.recordStatementId)?.fields[target.field.fieldIndex]?.name === newName;
  if (
    after.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    !after.sourceLexicalNamespace ||
    !afterRecords ||
    !targetStillNamed ||
    recordSemanticStableFingerprint(after) !== recordSemanticStableFingerprint(compiled) ||
    moduleSemanticStableFingerprint(after) !== moduleSemanticStableFingerprint(compiled)
  ) return { verdict: "rejected", reason: "capture" };
  return { verdict: "ok", target, oldName, newName, entries: ordered };
};
