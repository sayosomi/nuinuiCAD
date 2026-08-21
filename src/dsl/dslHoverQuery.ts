import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { elementTypeCategories, type CadElement, type ElementId } from "../types/geometry";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticOccurrenceAt
} from "./dslSemanticOccurrenceIndex";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import { sourceOwnerByRuntimeElementId, type SourceOwner } from "./sourceOwnership";

export type DslGeometryHoverRange = { from: number; to: number };

export type DslHoverSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
  bindingAnalysis?: BindingAnalysis;
};

export type DslGeometryHoverTarget = {
  range: DslGeometryHoverRange;
  elementId: ElementId;
};

export type DslGeometryHoverQueryInput = {
  source: SourceSnapshot;
  position: number;
  semantic?: DslHoverSemanticSnapshot;
};

const semanticSourceText = (semantic: DslHoverSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const semanticIsExact = (
  source: SourceSnapshot,
  semantic: DslHoverSemanticSnapshot | undefined
): semantic is DslHoverSemanticSnapshot & { compiled: CompiledDslDocument } => {
  if (!semantic?.compiled || semantic.sourceRevision !== source.sourceRevision) return false;
  if (source.normalizedSource.includes("\r") || semanticSourceText(semantic) !== source.normalizedSource) return false;
  if (semantic.compiled.spans.sourceMap.source !== source.normalizedSource) return false;
  if (semantic.compiled.spans.sourceMap.sourceRevision !== source.sourceRevision) return false;
  return semantic.compiled.statementMap?.sourceRevision === source.sourceRevision;
};

const isSupportedNamedGeometry = (element: CadElement | undefined): element is CadElement =>
  Boolean(
    element &&
    element.name.trim().length > 0 &&
    (elementTypeCategories[element.type] === "point" || elementTypeCategories[element.type] === "line")
  );

const isInsideGeneratedForGroup = (
  compiled: CompiledDslDocument,
  owner: SourceOwner
): boolean => {
  let enclosing = compiled.statements[owner.sourceStatementIndex]?.enclosing ?? null;
  while (enclosing) {
    const statement = compiled.statements[enclosing.statementIndex];
    if (!statement) return true;
    if (statement.kind === "element" && statement.type === "forGroup") return true;
    enclosing = statement.enclosing;
  }
  return false;
};

const uniqueRuntimeElement = (
  compiled: CompiledDslDocument,
  semanticElementId: ElementId
): CadElement | null => {
  if (!compiled.document || !compiled.statementMap) return null;
  const owners = sourceOwnerByRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization
  });
  const semanticOwner = owners.get(semanticElementId);
  if (!semanticOwner || isInsideGeneratedForGroup(compiled, semanticOwner)) return null;

  const runtimeIds = [...owners.values()]
    .filter((owner) => owner.sourceStatementId === semanticOwner.sourceStatementId)
    .map((owner) => owner.runtimeElementId);
  const uniqueIds = [...new Set(runtimeIds)];
  if (uniqueIds.length !== 1) return null;

  const element = compiled.document.elements.find((candidate) => candidate.id === uniqueIds[0]);
  return isSupportedNamedGeometry(element) ? element : null;
};

/**
 * Resolve a source identifier to the one exact current runtime geometry that a
 * native Hover consumer may inspect. This query is host-neutral and performs no
 * evaluation; ambiguous materialization/generation fails closed.
 */
export const queryDslGeometryHoverTarget = ({
  source,
  position,
  semantic
}: DslGeometryHoverQueryInput): DslGeometryHoverTarget | null => {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > source.normalizedSource.length ||
    !semanticIsExact(source, semantic)
  ) return null;

  const compiled = semantic.compiled;
  const occurrenceIndex = createDslSemanticOccurrenceIndex(
    compiled,
    semantic.bindingAnalysis ?? compiled.bindingAnalysis
  );
  const occurrence = dslSemanticOccurrenceAt(occurrenceIndex, position);
  if (!occurrence || occurrence.identity.kind !== "element") return null;
  if (
    occurrence.from < 0 ||
    occurrence.to <= occurrence.from ||
    occurrence.to > source.normalizedSource.length
  ) return null;

  const element = uniqueRuntimeElement(compiled, occurrence.identity.elementId);
  if (!element) return null;
  return {
    range: { from: occurrence.from, to: occurrence.to },
    elementId: element.id
  };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
