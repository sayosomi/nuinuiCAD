import { sourceOwnerByRuntimeElementId } from "./sourceOwnership";
import type { CompiledDslDocument } from "./dslDocument";
import type { DslPhysicalSpan, SourceSnapshot } from "./logicalStatementSourceMap";
import type { ElementId } from "../types/geometry";

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

const singleSafePhysicalSegment = (
  source: SourceSnapshot,
  span: DslPhysicalSpan | null | undefined
): NormalizedSourceRange | null => {
  if (!span || span.sourceRevision !== source.sourceRevision || span.segments.length !== 1) return null;
  const [segment] = span.segments;
  if (!segment) return null;
  if (!Number.isInteger(segment.from) || !Number.isInteger(segment.to)) return null;
  if (segment.from < 0 || segment.to <= segment.from || segment.to > source.normalizedSource.length) return null;
  return { from: segment.from, to: segment.to };
};

const physicalSpanContains = (span: DslPhysicalSpan | undefined, position: number): boolean =>
  Boolean(span?.segments.some((segment) =>
    Number.isInteger(segment.from) &&
    Number.isInteger(segment.to) &&
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

  const owners = sourceOwnerByRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization
  });
  const owner = owners.get(runtimeElementId);
  if (!owner) return null;

  const statement = compiled.statements[owner.sourceStatementIndex];
  if (!statement || statement.sourceRevision !== source.sourceRevision) return null;
  return singleSafePhysicalSegment(
    source,
    statement.name ? statement.namePhysicalSpan : statement.keywordPhysicalSpan
  );
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
    physicalSpanContains(candidate.physicalSpan, position)
  );
  return statement ? { sourceStatementIndex: compiled.statements.indexOf(statement) } : null;
};
