import { sourceOwnerByRuntimeElementId, sourceOwnerForRuntimeElementId } from "./sourceOwnership";
import type { CompiledDslDocument } from "./dslDocument";
import type { DslPhysicalSpan, SourceSnapshot } from "./logicalStatementSourceMap";
import type { ElementId } from "../types/geometry";
import {
  sourceIdentityOf,
  type DocumentSourceIdentity,
  type MultiDocumentSourceSnapshot
} from "../document/multiDocumentPrimitives";

export type NormalizedSourceRange = { from: number; to: number };

export type DslCanvasSourceDefinitionInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  runtimeElementId: ElementId;
};

export type DslCanvasSourceTargetInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  position: number;
};

/** Internal source target. Statement identity never crosses a host boundary. */
export type DslCanvasSourceTarget = {
  sourceStatementIndex: number;
};

export type DslCanvasSourceDefinitionTarget = {
  source: DocumentSourceIdentity;
  sourceStatementIndex: number;
  range: NormalizedSourceRange;
};

const sourceAndCompiledMatch = (
  source: SourceSnapshot,
  compiled: CompiledDslDocument
): boolean => {
  if (source.normalizedSource.includes("\r")) return false;
  if (compiled.spans.sourceMap.source !== source.normalizedSource) return false;
  if (compiled.spans.sourceMap.sourceRevision !== source.sourceRevision) return false;
  if (compiled.statementMap?.sourceRevision !== source.sourceRevision) return false;
  return true;
};

const safePhysicalSegments = (
  source: SourceSnapshot,
  span: DslPhysicalSpan | null | undefined
): readonly DslPhysicalSpan["segments"][number][] | null => {
  if (!span || span.sourceRevision !== source.sourceRevision || !Array.isArray(span.segments)) return null;
  if (span.segments.some((segment) =>
    !segment ||
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to <= segment.from ||
    segment.to > source.normalizedSource.length
  )) return null;
  return span.segments;
};

const singleSafePhysicalSegment = (
  source: SourceSnapshot,
  span: DslPhysicalSpan | null | undefined
): NormalizedSourceRange | null => {
  const segments = safePhysicalSegments(source, span);
  if (!segments || segments.length !== 1) return null;
  const [segment] = segments;
  return { from: segment.from, to: segment.to };
};

const singleSafePhysicalSegmentForDocument = (
  source: MultiDocumentSourceSnapshot,
  span: DslPhysicalSpan | null | undefined
): NormalizedSourceRange | null => {
  if (!span || !Array.isArray(span.segments)) return null;
  const expectedRevision = source.kind === "root-current" ? source.sourceRevision : 0;
  if (span.sourceRevision !== expectedRevision || span.segments.length !== 1) return null;
  const [segment] = span.segments;
  if (
    !segment ||
    !Number.isInteger(segment.from) ||
    !Number.isInteger(segment.to) ||
    segment.from < 0 ||
    segment.to <= segment.from ||
    segment.to > source.normalizedSource.length
  ) return null;
  return { from: segment.from, to: segment.to };
};

const physicalSpanContains = (
  source: SourceSnapshot,
  span: DslPhysicalSpan | undefined,
  position: number
): boolean =>
  Boolean(safePhysicalSegments(source, span)?.some((segment) =>
    segment.from <= position &&
    position < segment.to
  ));

/**
 * Resolve a selected runtime element to the exact authored identifier (or
 * keyword for an unnamed element). Runtime and statement identities remain
 * entirely inside this query and are never part of the returned range.
 */
export const queryDslCanvasSourceDefinition = ({
  source,
  compiled,
  runtimeElementId
}: DslCanvasSourceDefinitionInput): NormalizedSourceRange | null => {
  if (!sourceAndCompiledMatch(source, compiled) || !compiled.statementMap) return null;
  const owner = sourceOwnerForRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization,
    moduleRuntimeContext: compiled.moduleRuntimeContext
  }, runtimeElementId);
  if (!owner) return null;
  if (owner.source && owner.source.kind !== "root-current") return null;
  const statement = compiled.statements[owner.sourceStatementIndex];
  if (!statement || statement.sourceRevision !== source.sourceRevision) return null;
  return singleSafePhysicalSegment(
    source,
    statement.name ? statement.namePhysicalSpan : statement.keywordPhysicalSpan
  );
};

/**
 * Resolve Canvas source ownership across the exact Module runtime context.
 * The returned source identity is document-qualified and is safe to hand to a
 * host adapter only after that adapter revalidates the source itself.
 */
export const queryDslCanvasSourceDefinitionQualified = ({
  source,
  compiled,
  runtimeElementId
}: DslCanvasSourceDefinitionInput): DslCanvasSourceDefinitionTarget | null => {
  if (!sourceAndCompiledMatch(source, compiled) || !compiled.statementMap) return null;
  const rootDocumentId = compiled.moduleRuntimeContext?.rootDocumentId;
  if (!rootDocumentId) return null;
  const owner = sourceOwnerForRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization,
    moduleRuntimeContext: compiled.moduleRuntimeContext
  }, runtimeElementId);
  if (!owner) return null;

  const rootSourceIdentity = sourceIdentityOf({
    kind: "root-current",
    documentId: rootDocumentId,
    normalizedSource: source.normalizedSource,
    sourceRevision: source.sourceRevision
  });
  const targetDocument = owner.sourceDocumentId
    ? compiled.moduleRuntimeContext?.documentFor(owner.sourceDocumentId)
    : undefined;
  const targetSource = owner.source ?? rootSourceIdentity;
  const targetStatements = targetDocument?.statements ?? compiled.statements;
  const targetStatement = targetStatements[owner.sourceStatementIndex];
  if (!targetStatement || targetStatement.sourceRevision !== (
    targetSource.kind === "root-current" ? targetSource.sourceRevision : 0
  )) return null;
  if (targetDocument && (
    targetDocument.documentId !== owner.sourceDocumentId ||
    targetDocument.sourceIdentity.kind !== targetSource.kind ||
    targetDocument.sourceIdentity.documentId !== targetSource.documentId ||
    (targetSource.kind === "root-current"
      ? targetDocument.sourceIdentity.kind !== "root-current" ||
        targetDocument.sourceIdentity.sourceRevision !== targetSource.sourceRevision
      : targetDocument.sourceIdentity.kind !== "dependency-saved" ||
        targetDocument.sourceIdentity.savedSourceFingerprint !== targetSource.savedSourceFingerprint)
  )) return null;
  const targetSourceSnapshot: MultiDocumentSourceSnapshot = targetDocument?.source ?? {
    kind: "root-current",
    documentId: rootDocumentId,
    normalizedSource: source.normalizedSource,
    sourceRevision: source.sourceRevision
  };
  const range = singleSafePhysicalSegmentForDocument(
    targetSourceSnapshot,
    targetStatement.name ? targetStatement.namePhysicalSpan : targetStatement.keywordPhysicalSpan
  );
  return range
    ? { source: targetSource, sourceStatementIndex: owner.sourceStatementIndex, range }
    : null;
};

/** Resolve an exact authored runtime-bearing statement at a normalized cursor. */
export const queryDslCanvasSourceTarget = ({
  source,
  compiled,
  position
}: DslCanvasSourceTargetInput): DslCanvasSourceTarget | null => {
  if (
    !sourceAndCompiledMatch(source, compiled) ||
    !compiled.statementMap ||
    !Number.isInteger(position) ||
    position < 0 ||
    position > source.normalizedSource.length
  ) return null;

  const owners = sourceOwnerByRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization
  });
  const runtimeStatementIndexes = new Set(
    [...owners.values()].map((owner) => owner.sourceStatementIndex)
  );
  const statement = compiled.statements.find((candidate, statementIndex) =>
    runtimeStatementIndexes.has(statementIndex) &&
    candidate.sourceRevision === source.sourceRevision &&
    physicalSpanContains(source, candidate.physicalSpan, position)
  );
  return statement ? { sourceStatementIndex: compiled.statements.indexOf(statement) } : null;
};
