import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity
} from "./dslSemanticOccurrenceIndex";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import {
  analyzeTypedBindingRenameInDocument,
  type TypedRenameAnalysisRejected
} from "../document/typedRenameAnalysis";
import {
  projectTypedRenameEdits,
  type TypedRenameSpliceEntry
} from "../document/typedRenameSplice";
import {
  analyzeModuleSemanticRename,
  moduleSemanticStableFingerprint,
  type ModuleRenameAnalysisRejected
} from "../document/moduleSemanticRenameAnalysis";
import {
  analyzeRename,
  projectElementRenameEdits,
  validateElementRenameRequest,
  validateRenameReferenceStability,
  type RenameAnalysisRejected
} from "../document/renameAnalysis";
import { sourceOwnerForRuntimeElementId } from "./sourceOwnership";
import { formatDslName } from "./dslTokens";
import type { ElementId } from "../types/geometry";

export type DslRenameTarget = {
  sourceRevision: SourceRevision;
  oldName: string;
  range: { from: number; to: number };
};

export type DslRenameEdit = {
  from: number;
  to: number;
  expectedText: string;
  newText: string;
};

export type DslRenameEditPlan = {
  sourceRevision: SourceRevision;
  target: DslRenameTarget;
  edits: readonly DslRenameEdit[];
};

export type DslRenameRejection =
  | { reason: "invalid-name"; message: string }
  | { reason: "same-scope-collision"; conflictingName: string; conflictingLine?: number }
  | { reason: "reference-resolution-change"; family: "typed"; referencedName: string }
  | { reason: "reference-resolution-change"; family: "element"; line?: number }
  | { reason: "reference-resolution-change"; family: "module" }
  | { reason: "unavailable" };

export type DslRenameEditPlanResult =
  | { status: "ok"; plan: DslRenameEditPlan }
  | { status: "rejected"; rejection: DslRenameRejection };

export type DslRenameSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
  bindingAnalysis?: BindingAnalysis;
};

export type DslRenameSnapshot = {
  source: SourceSnapshot;
  semantic?: DslRenameSemanticSnapshot;
};

type RenameIdentity = DslSemanticIdentity;
type RenameCandidate = { from: number; to: number; identity: RenameIdentity };
type ExactSnapshot = { source: SourceSnapshot; compiled: CompiledDslDocument };

const identityKey = (identity: RenameIdentity) => dslSemanticIdentityKey(identity);

const semanticSourceText = (semantic: DslRenameSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const exactSnapshot = (snapshot: DslRenameSnapshot): ExactSnapshot | null => {
  const { source, semantic } = snapshot;
  if (
    source.normalizedSource.includes("\r") ||
    !semantic?.compiled ||
    semantic.sourceRevision !== source.sourceRevision ||
    semanticSourceText(semantic) !== source.normalizedSource
  ) return null;
  const compiled = semantic.bindingAnalysis && semantic.compiled.bindingAnalysis !== semantic.bindingAnalysis
    ? { ...semantic.compiled, bindingAnalysis: semantic.bindingAnalysis }
    : semantic.compiled;
  if (
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) return null;
  return { source, compiled };
};

const physicalRange = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number }
) => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  return physical?.segments.length === 1 ? physical.segments[0] ?? null : null;
};

const lineNumberAtOffset = (source: string, offset: number): number | undefined => {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return undefined;
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") line += 1;
  }
  return line;
};

const candidatesFor = (compiled: CompiledDslDocument): RenameCandidate[] =>
  createDslSemanticOccurrenceIndex(compiled).occurrences
    .filter((occurrence) => occurrence.identity.kind !== "module" || (
      occurrence.identity.target.kind !== "moduleIteration" &&
      occurrence.identity.target.kind !== "moduleElementLocalVariable"
    ))
    .map((occurrence) => ({
      from: occurrence.from,
      to: occurrence.to,
      identity: occurrence.identity
    }));

const candidateAt = (compiled: CompiledDslDocument, position: number): { candidate: RenameCandidate; target: DslRenameTarget } | null => {
  const candidates = candidatesFor(compiled)
    .filter((candidate) => position >= candidate.from && position < candidate.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from));
  if (candidates.length === 0) return null;
  const shortest = candidates[0]!.to - candidates[0]!.from;
  const shortestCandidates = candidates.filter((candidate) => candidate.to - candidate.from === shortest);
  const keys = new Set(shortestCandidates.map((candidate) => identityKey(candidate.identity)));
  if (keys.size !== 1) return null;
  const candidate = shortestCandidates[0]!;
  const oldName = compiled.spans.sourceMap.source.slice(candidate.from, candidate.to);
  if (!oldName) return null;
  return {
    candidate,
    target: {
      sourceRevision: compiled.spans.sourceMap.sourceRevision,
      oldName,
      range: { from: candidate.from, to: candidate.to }
    }
  };
};

const editsAreSafe = (edits: readonly DslRenameEdit[]) => {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.from < ordered[index - 1]!.to) return false;
  }
  const seen = new Set(ordered.map((edit) => `${edit.from}:${edit.to}`));
  return seen.size === ordered.length;
};

const mapsMatch = <Value>(before: ReadonlyMap<number, Value>, after: ReadonlyMap<number, Value>) =>
  before.size === after.size && [...before].every(([index, value]) => after.get(index) === value);

const unavailableRenameRejection = (): DslRenameRejection => ({ reason: "unavailable" });

const typedRenameRejection = (
  analysis: TypedRenameAnalysisRejected,
  compiled: CompiledDslDocument
): DslRenameRejection => {
  switch (analysis.reason) {
    case "invalid-name":
      return { reason: "invalid-name", message: analysis.detail.message };
    case "same-scope-collision": {
      const conflictingBinding = compiled.bindingAnalysis?.catalog.bindingsById.get(analysis.detail.conflictingBindingId);
      const conflictingPhysical = conflictingBinding?.nameSpan
        ? physicalRange(compiled, conflictingBinding.statementIndex, conflictingBinding.nameSpan)
        : null;
      const conflictingLine = conflictingPhysical
        ? lineNumberAtOffset(compiled.spans.sourceMap.source, conflictingPhysical.from)
        : undefined;
      return {
        reason: "same-scope-collision",
        conflictingName: analysis.detail.conflictingName,
        ...(conflictingLine === undefined ? {} : { conflictingLine })
      };
    }
    case "capture":
      return { reason: "reference-resolution-change", family: "typed", referencedName: analysis.detail.name };
    case "target-not-found":
      return unavailableRenameRejection();
  }
};

const moduleRenameRejection = (
  analysis: ModuleRenameAnalysisRejected,
  newName: string,
  compiled: CompiledDslDocument
): DslRenameRejection => {
  switch (analysis.reason) {
    case "invalid-name":
      return { reason: "invalid-name", message: analysis.detail ?? "名前をDSL識別子として安全に表現できません。" };
    case "same-scope-collision": {
      const conflictingLine = analysis.conflictingRange
        ? lineNumberAtOffset(compiled.spans.sourceMap.source, analysis.conflictingRange.from)
        : undefined;
      return {
        reason: "same-scope-collision",
        conflictingName: analysis.detail ?? newName,
        ...(conflictingLine === undefined ? {} : { conflictingLine })
      };
    }
    case "capture":
      return { reason: "reference-resolution-change", family: "module" };
    case "target-not-found":
    case "stale":
    case "span-mismatch":
    case "overlap":
      return unavailableRenameRejection();
  }
};

const elementRenameRejection = (analysis: RenameAnalysisRejected): DslRenameRejection => {
  switch (analysis.reason) {
    case "invalid-name":
      return { reason: "invalid-name", message: analysis.detail.message };
    case "same-scope-conflict":
      return {
        reason: "same-scope-collision",
        conflictingName: analysis.detail.conflictingElementName,
        conflictingLine: analysis.detail.conflictingLine
      };
    case "resolution-change":
      return {
        reason: "reference-resolution-change",
        family: "element",
        ...(analysis.detail.changes[0] ? { line: analysis.detail.changes[0].line } : {})
      };
    case "invalid-source":
    case "target-not-found":
    case "analysis-incomplete":
      return unavailableRenameRejection();
  }
};

const projectModuleElementRenameEdits = (
  sourceText: string,
  compiled: CompiledDslDocument,
  elementId: ElementId,
  candidateRanges: readonly RenameCandidate[],
  newName: string
): { ok: true; edits: readonly DslRenameEdit[] } | { ok: false; rejection: DslRenameRejection } => {
  if (!compiled.statementMap) return { ok: false, rejection: unavailableRenameRejection() };
  const owner = sourceOwnerForRuntimeElementId({ ...compiled, statementMap: compiled.statementMap }, elementId);
  if (!owner || owner.kind !== "ordinary") return { ok: false, rejection: unavailableRenameRejection() };
  const validation = validateElementRenameRequest({ compiled, targetElementId: elementId, newName });
  if (!validation.ok) return { ok: false, rejection: elementRenameRejection(validation.rejection) };

  const targetIdentifier = formatDslName(validation.target.name);
  const replacementIdentifier = formatDslName(validation.newName);
  if (targetIdentifier === replacementIdentifier) return { ok: true, edits: [] };

  const ranges = new Map<string, { from: number; to: number }>();
  for (const candidate of candidateRanges) {
    if (candidate.identity.kind !== "element" || candidate.identity.elementId !== elementId) continue;
    if (candidate.from < 0 || candidate.to <= candidate.from || candidate.to > sourceText.length) {
      return { ok: false, rejection: unavailableRenameRejection() };
    }
    if (sourceText.slice(candidate.from, candidate.to) !== targetIdentifier) continue;
    ranges.set(`${candidate.from}:${candidate.to}`, { from: candidate.from, to: candidate.to });
  }
  if (ranges.size === 0) return { ok: false, rejection: unavailableRenameRejection() };
  const declarationStatement = compiled.statements[owner.sourceStatementIndex];
  const declarationPhysical = declarationStatement?.nameSpan
    ? physicalRange(compiled, owner.sourceStatementIndex, declarationStatement.nameSpan)
    : null;
  if (!declarationPhysical || !ranges.has(`${declarationPhysical.from}:${declarationPhysical.to}`)) {
    return { ok: false, rejection: unavailableRenameRejection() };
  }

  const orderedRanges = [...ranges.values()].sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < orderedRanges.length; index += 1) {
    if (orderedRanges[index]!.from < orderedRanges[index - 1]!.to) {
      return { ok: false, rejection: unavailableRenameRejection() };
    }
  }
  const candidateSource = orderedRanges.reduceRight(
    (source, range) => `${source.slice(0, range.from)}${replacementIdentifier}${source.slice(range.to)}`,
    sourceText
  );
  const beforeStatementMap = compiled.statementMap;
  if (!beforeStatementMap || !compiled.sourceLexicalNamespace || !compiled.moduleSemanticAnalysis) {
    return { ok: false, rejection: unavailableRenameRejection() };
  }
  const after = compileDslDocument(candidateSource, {
    assignedElementIds: beforeStatementMap.elementIdByStatementIndex,
    assignedStatementIds: beforeStatementMap.statementIdByStatementIndex
  });
  if (
    after.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    !after.document ||
    !after.statementMap ||
    !after.sourceLexicalNamespace ||
    !after.moduleSemanticAnalysis ||
    !mapsMatch(beforeStatementMap.elementIdByStatementIndex, after.statementMap.elementIdByStatementIndex) ||
    (beforeStatementMap.statementIdByStatementIndex !== undefined &&
      (!after.statementMap.statementIdByStatementIndex ||
        !mapsMatch(beforeStatementMap.statementIdByStatementIndex, after.statementMap.statementIdByStatementIndex)))
  ) return { ok: false, rejection: unavailableRenameRejection() };

  const referenceStability = validateRenameReferenceStability({ before: compiled, after });
  if (referenceStability.verdict !== "ok") {
    return {
      ok: false,
      rejection: referenceStability.reason === "resolution-change"
        ? {
            reason: "reference-resolution-change",
            family: "element",
            ...(referenceStability.detail.changes[0] ? { line: referenceStability.detail.changes[0].line } : {})
          }
        : unavailableRenameRejection()
    };
  }
  const beforeFingerprint = moduleSemanticStableFingerprint(compiled);
  const afterFingerprint = moduleSemanticStableFingerprint(after);
  if (!beforeFingerprint || !afterFingerprint || beforeFingerprint !== afterFingerprint) {
    return { ok: false, rejection: unavailableRenameRejection() };
  }

  return {
    ok: true,
    edits: orderedRanges.map((range) => ({
      from: range.from,
      to: range.to,
      expectedText: sourceText.slice(range.from, range.to),
      newText: replacementIdentifier
    }))
  };
};

const projectSourceRenameEdits = (
  sourceText: string,
  compiled: CompiledDslDocument,
  statementId: string,
  newName: string
): { ok: true; edits: readonly DslRenameEdit[] } | { ok: false; rejection: DslRenameRejection } => {
  if (!newName.trim() || /[\r\n]/.test(newName)) {
    return { ok: false, rejection: { reason: "invalid-name", message: "名前は空行や改行を含めずに指定してください。" } };
  }
  const declaration = compiled.sourceLexicalNamespace?.allDeclarations.find(
    (candidate) => candidate.statementId === statementId && candidate.kind === "profile"
  );
  const beforeStatementMap = compiled.statementMap;
  if (!declaration || !beforeStatementMap) return { ok: false, rejection: unavailableRenameRejection() };
  const occurrenceIndex = createDslSemanticOccurrenceIndex(compiled);
  const identityKey = dslSemanticIdentityKey({ kind: "source", statementId });
  const occurrences = occurrenceIndex.occurrences.filter(
    (occurrence) => dslSemanticIdentityKey(occurrence.identity) === identityKey
  );
  const declarationRange = declaration.nameSpan
    ? physicalRange(compiled, declaration.statementIndex, declaration.nameSpan)
    : null;
  if (!declarationRange || !occurrences.some(
    (occurrence) => occurrence.kind === "declaration" && occurrence.from === declarationRange.from && occurrence.to === declarationRange.to
  )) return { ok: false, rejection: unavailableRenameRejection() };

  const replacementIdentifier = formatDslName(newName);
  const edits = occurrences.map((occurrence) => ({
    from: occurrence.from,
    to: occurrence.to,
    expectedText: sourceText.slice(occurrence.from, occurrence.to),
    newText: replacementIdentifier
  }));
  if (!editsAreSafe(edits)) return { ok: false, rejection: unavailableRenameRejection() };
  const candidateSource = [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((source, edit) => `${source.slice(0, edit.from)}${edit.newText}${source.slice(edit.to)}`, sourceText);
  const after = compileDslDocument(candidateSource, {
    assignedElementIds: beforeStatementMap.elementIdByStatementIndex,
    assignedStatementIds: beforeStatementMap.statementIdByStatementIndex
  });
  if (
    after.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    !after.document ||
    !after.statementMap ||
    !after.sourceLexicalNamespace ||
    (beforeStatementMap.statementIdByStatementIndex !== undefined &&
      (!after.statementMap.statementIdByStatementIndex ||
        !mapsMatch(beforeStatementMap.statementIdByStatementIndex, after.statementMap.statementIdByStatementIndex)))
  ) return { ok: false, rejection: unavailableRenameRejection() };
  return { ok: true, edits };
};

export const queryDslRenameTarget = (snapshot: DslRenameSnapshot, sourceOffset: number): DslRenameTarget | null => {
  const exact = exactSnapshot(snapshot);
  if (!exact || sourceOffset < 0 || sourceOffset >= exact.source.normalizedSource.length) return null;
  return candidateAt(exact.compiled, sourceOffset)?.target ?? null;
};

export const planDslRenameEditsResult = (
  snapshot: DslRenameSnapshot,
  sourceOffset: number,
  newName: string
): DslRenameEditPlanResult => {
  const exact = exactSnapshot(snapshot);
  if (!exact || sourceOffset < 0 || sourceOffset >= exact.source.normalizedSource.length) {
    return { status: "rejected", rejection: unavailableRenameRejection() };
  }
  const selected = candidateAt(exact.compiled, sourceOffset);
  if (!selected) return { status: "rejected", rejection: unavailableRenameRejection() };

  let edits: readonly DslRenameEdit[];
  const identity = selected.candidate.identity;
  if (identity.kind === "typed") {
    const analysis = analyzeTypedBindingRenameInDocument({ compiled: exact.compiled, targetBindingId: identity.bindingId, newName });
    if (analysis.verdict !== "ok") return { status: "rejected", rejection: typedRenameRejection(analysis, exact.compiled) };
    if (!analysis.declarationSpan) return { status: "rejected", rejection: unavailableRenameRejection() };
    const target = exact.compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
    if (!target) return { status: "rejected", rejection: unavailableRenameRejection() };
    const entries: TypedRenameSpliceEntry[] = [
      { statementIndex: target.statementIndex, span: analysis.declarationSpan, oldName: target.name, newName: analysis.newName },
      ...analysis.occurrences
    ];
    const projection = projectTypedRenameEdits(exact.source.normalizedSource, exact.compiled, entries);
    if (!projection.ok) return { status: "rejected", rejection: unavailableRenameRejection() };
    edits = projection.edits.map((edit) => ({ ...edit }));
  } else if (identity.kind === "module") {
    const analysis = analyzeModuleSemanticRename(exact.source.normalizedSource, exact.compiled, identity.target, newName);
    if (analysis.verdict !== "ok") return { status: "rejected", rejection: moduleRenameRejection(analysis, newName, exact.compiled) };
    const projection = projectTypedRenameEdits(exact.source.normalizedSource, exact.compiled, analysis.entries);
    if (!projection.ok) return { status: "rejected", rejection: unavailableRenameRejection() };
    edits = projection.edits.map((edit) => ({ ...edit }));
  } else if (identity.kind === "source") {
    const projected = projectSourceRenameEdits(
      exact.source.normalizedSource,
      exact.compiled,
      identity.statementId,
      newName
    );
    if (!projected.ok) return { status: "rejected", rejection: projected.rejection };
    edits = projected.edits;
  } else {
    const owner = sourceOwnerForRuntimeElementId({ ...exact.compiled, statementMap: exact.compiled.statementMap! }, identity.elementId);
    if (!owner || owner.kind !== "ordinary") return { status: "rejected", rejection: unavailableRenameRejection() };
    if (exact.compiled.moduleMaterialization) {
      const projected = projectModuleElementRenameEdits(
        exact.source.normalizedSource,
        exact.compiled,
        identity.elementId,
        candidatesFor(exact.compiled).filter((candidate) =>
          candidate.identity.kind === "element" && candidate.identity.elementId === identity.elementId
        ),
        newName
      );
      if (!projected.ok) return { status: "rejected", rejection: projected.rejection };
      edits = projected.edits;
    } else {
      const analysis = analyzeRename({ sourceText: exact.source.normalizedSource, compiled: exact.compiled, targetElementId: identity.elementId, newName });
      if (analysis.verdict !== "ok") return { status: "rejected", rejection: elementRenameRejection(analysis) };
      const projection = projectElementRenameEdits({ sourceText: exact.source.normalizedSource, compiled: exact.compiled, targetElementId: identity.elementId, analysis });
      if (!projection.ok) return { status: "rejected", rejection: unavailableRenameRejection() };
      edits = projection.edits.map((edit) => ({ ...edit }));
    }
  }

  if (!editsAreSafe(edits)) return { status: "rejected", rejection: unavailableRenameRejection() };
  return {
    status: "ok",
    plan: { sourceRevision: exact.source.sourceRevision, target: selected.target, edits }
  };
};

export const planDslRenameEdits = (
  snapshot: DslRenameSnapshot,
  sourceOffset: number,
  newName: string
): DslRenameEditPlan | null => {
  const result = planDslRenameEditsResult(snapshot, sourceOffset, newName);
  return result.status === "ok" ? result.plan : null;
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
