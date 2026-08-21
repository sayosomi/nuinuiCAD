import type { LastGoodDslDocument } from "../document/canonicalDocument";
import { exactPhysicalSpan } from "../dsl/dslDiagnosticSpan";
import type { NormalizedSourceRange } from "../dsl/dslNavigationQuery";
import { coordinateComponent } from "../dsl/dslParameterSpanScanner";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticDeclarationRange,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import type { DslPhysicalSpan, LogicalStatement } from "../dsl/logicalStatementSourceMap";
import type { DslSpan, DslStatement } from "../dsl/dslTypes";
import type { OutputDrawable, OutputPlan, OutputPoint } from "./outputCore";

export type OutputPlaceReferenceNavigation = {
  /** Exact authored reference identifier range, excluding the `@` sigil. */
  sourceRange: NormalizedSourceRange;
  /** Exact compiler-resolved declaration identifier range. */
  targetRange: NormalizedSourceRange;
};

export type OutputPlaceAuthoredValue = {
  /** Exact authored logical spelling for presentation; never reconstructed from the model. */
  text: string;
  /** Exact physical source span. Null means source projection was unsafe and callers must fail closed. */
  sourceSpan: DslPhysicalSpan | null;
  /** Every safely compiler-resolved reference contained by this value. */
  references: readonly OutputPlaceReferenceNavigation[];
};

export type OutputPlaceAuthoredAt = OutputPlaceAuthoredValue & {
  x: OutputPlaceAuthoredValue | null;
  y: OutputPlaceAuthoredValue | null;
};

export type OutputPlaceDragIssue = {
  axis: "x" | "y";
  reason: "source-unavailable" | "not-direct-numeric-literal" | "non-finite-numeric-literal";
};

export type OutputPlaceDragability =
  | {
      draggable: true;
      literals: { x: number; y: number };
    }
  | {
      draggable: false;
      reason: {
        code: "at-not-direct-finite-numeric-literals";
        issues: readonly OutputPlaceDragIssue[];
      };
    };

export type OutputPlaceProjection = {
  /** Reconciler-owned authored `place` statement identity. */
  placeId: string;
  sourceRevision: number;
  layoutId: string;
  layoutName: string;
  groupId: string;
  groupName: string;
  /** The selected source origin after placement transform; this is the Preview handle position. */
  transformedOrigin: OutputPoint;
  /** Output-plan-owned geometry for this one placement. */
  drawables: readonly OutputDrawable[];
  /** Exact authored place statement range in the normalized source snapshot. */
  statementRange: NormalizedSourceRange;
  authored: {
    group: OutputPlaceAuthoredValue & { targetRange: NormalizedSourceRange | null };
    at: OutputPlaceAuthoredAt;
    origin?: OutputPlaceAuthoredValue & { targetRange: NormalizedSourceRange | null };
    scale?: OutputPlaceAuthoredValue;
    angle?: OutputPlaceAuthoredValue;
    mirror?: OutputPlaceAuthoredValue;
  };
  dragability: OutputPlaceDragability;
};

const DIRECT_NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const classifyCoordinate = (axis: "x" | "y", source: string | null) => {
  if (source === null) {
    return { issue: { axis, reason: "source-unavailable" as const } };
  }
  const trimmed = source.trim();
  if (!DIRECT_NUMERIC_LITERAL.test(trimmed)) {
    return { issue: { axis, reason: "not-direct-numeric-literal" as const } };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { issue: { axis, reason: "non-finite-numeric-literal" as const } };
  }
  return { value };
};

/** Classifies exactly the source-authored `at` coordinate spellings; resolved runtime values never make an expression draggable. */
export const classifyOutputPlaceAtDragability = (
  xSource: string | null,
  ySource: string | null
): OutputPlaceDragability => {
  const x = classifyCoordinate("x", xSource);
  const y = classifyCoordinate("y", ySource);
  const issues = [x.issue, y.issue].filter((issue): issue is OutputPlaceDragIssue => Boolean(issue));
  if (issues.length) {
    return {
      draggable: false,
      reason: { code: "at-not-direct-finite-numeric-literals", issues }
    };
  }
  return { draggable: true, literals: { x: x.value!, y: y.value! } };
};

const occurrenceIsInside = (
  span: DslPhysicalSpan,
  occurrence: { from: number; to: number }
) => span.segments.some((segment) => occurrence.from >= segment.from && occurrence.to <= segment.to);

const referencesInPhysicalSpan = (
  index: DslSemanticOccurrenceIndex,
  span: DslPhysicalSpan | null
): OutputPlaceReferenceNavigation[] => {
  if (!span) return [];
  const seen = new Set<string>();
  const result: OutputPlaceReferenceNavigation[] = [];
  for (const occurrence of index.occurrences) {
    if (occurrence.kind !== "reference" || !occurrenceIsInside(span, occurrence)) continue;
    const targetRange = dslSemanticDeclarationRange(index, occurrence.identity);
    if (!targetRange) continue;
    const key = `${occurrence.from}:${occurrence.to}:${targetRange.from}:${targetRange.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      sourceRange: { from: occurrence.from, to: occurrence.to },
      targetRange: { from: targetRange.from, to: targetRange.to }
    });
  }
  return result;
};

const authoredValue = ({
  compiledDocument,
  statement,
  logical,
  span,
  semanticIndex
}: {
  compiledDocument: LastGoodDslDocument;
  statement: DslStatement;
  logical: LogicalStatement;
  span: DslSpan;
  semanticIndex: DslSemanticOccurrenceIndex;
}): OutputPlaceAuthoredValue => {
  const sourceSpan = exactPhysicalSpan(compiledDocument.spans, statement, span);
  return {
    text: logical.logicalText.slice(span.start, span.end),
    sourceSpan,
    references: referencesInPhysicalSpan(semanticIndex, sourceSpan)
  };
};

const payloadValue = (
  compiledDocument: LastGoodDslDocument,
  statement: DslStatement,
  logical: LogicalStatement,
  key: string,
  semanticIndex: DslSemanticOccurrenceIndex
): OutputPlaceAuthoredValue | null => {
  const span = statement.payloadSpans[key];
  return span ? authoredValue({ compiledDocument, statement, logical, span, semanticIndex }) : null;
};

const finalReferenceTarget = (value: OutputPlaceAuthoredValue): NormalizedSourceRange | null =>
  value.references.at(-1)?.targetRange ?? null;

const statementIndexById = (compiledDocument: LastGoodDslDocument) => {
  const result = new Map<string, number>();
  for (const [index, id] of compiledDocument.statementMap.statementIdByStatementIndex ?? []) result.set(id, index);
  for (const [index, id] of compiledDocument.layoutIdsByStatementIndex ?? []) result.set(id, index);
  for (const [index, id] of compiledDocument.outputIdsByStatementIndex ?? []) result.set(id, index);
  return result;
};

const safeStatementRange = (
  compiledDocument: LastGoodDslDocument,
  statement: DslStatement
): NormalizedSourceRange | null => {
  const { from, to, sourceRevision } = statement.documentRange;
  const source = compiledDocument.spans.sourceMap.source;
  if (
    sourceRevision !== compiledDocument.statementMap.sourceRevision ||
    statement.sourceRevision !== compiledDocument.statementMap.sourceRevision ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to <= from ||
    to > source.length
  ) return null;
  return { from, to };
};

/**
 * Project current authored `place` declarations onto one already-resolved OutputPlan.
 * The projection is read-only and host-neutral: no VS Code types, source mutation,
 * gesture state, or second reference resolver live here.
 */
export const projectOutputPlaces = ({
  compiledDocument,
  plan
}: {
  compiledDocument: LastGoodDslDocument;
  plan: OutputPlan;
}): readonly OutputPlaceProjection[] => {
  if (
    compiledDocument.statementMap.sourceRevision !== compiledDocument.spans.sourceMap.sourceRevision ||
    compiledDocument.spans.sourceMap.source.includes("\r")
  ) return [];

  const layout = compiledDocument.document.layouts.find((candidate) => candidate.id === plan.layoutId);
  if (!layout) return [];
  const placementById = new Map(layout.placements.map((placement) => [placement.id, placement]));
  const sourceIndexById = statementIndexById(compiledDocument);
  const semanticIndex = createDslSemanticOccurrenceIndex(compiledDocument, compiledDocument.bindingAnalysis);
  const elementsById = new Map(compiledDocument.document.elements.map((element) => [element.id, element]));
  const projections: OutputPlaceProjection[] = [];

  for (const resolved of plan.placements) {
    const placement = placementById.get(resolved.id);
    const statementIndex = sourceIndexById.get(resolved.id);
    const statement = statementIndex === undefined ? undefined : compiledDocument.statements[statementIndex];
    const logical = statement ? compiledDocument.spans.logicalStatementByRangeFrom.get(statement.documentRange.from) : undefined;
    const statementRange = statement ? safeStatementRange(compiledDocument, statement) : null;
    if (!placement || !statement || statement.kind !== "place" || !logical || !statementRange) continue;

    const group = payloadValue(compiledDocument, statement, logical, "group", semanticIndex);
    const atSpan = statement.payloadSpans.at;
    const at = atSpan ? authoredValue({ compiledDocument, statement, logical, span: atSpan, semanticIndex }) : null;
    if (!group || !at || !atSpan) continue;
    const xSpan = coordinateComponent(logical.logicalText, atSpan, "x");
    const ySpan = coordinateComponent(logical.logicalText, atSpan, "y");
    const x = xSpan ? authoredValue({ compiledDocument, statement, logical, span: xSpan, semanticIndex }) : null;
    const y = ySpan ? authoredValue({ compiledDocument, statement, logical, span: ySpan, semanticIndex }) : null;
    const origin = payloadValue(compiledDocument, statement, logical, "origin", semanticIndex);
    const scale = payloadValue(compiledDocument, statement, logical, "scale", semanticIndex);
    const angle = payloadValue(compiledDocument, statement, logical, "angle", semanticIndex);
    const mirror = payloadValue(compiledDocument, statement, logical, "mirror", semanticIndex);
    const groupName = elementsById.get(placement.groupId)?.name ?? placement.groupId;

    projections.push({
      placeId: placement.id,
      sourceRevision: compiledDocument.statementMap.sourceRevision,
      layoutId: layout.id,
      layoutName: layout.name,
      groupId: placement.groupId,
      groupName,
      transformedOrigin: { ...resolved.at },
      drawables: resolved.drawables,
      statementRange,
      authored: {
        group: { ...group, targetRange: finalReferenceTarget(group) },
        at: { ...at, x, y },
        ...(origin ? { origin: { ...origin, targetRange: finalReferenceTarget(origin) } } : {}),
        ...(scale ? { scale } : {}),
        ...(angle ? { angle } : {}),
        ...(mirror ? { mirror } : {})
      },
      dragability: classifyOutputPlaceAtDragability(x?.text ?? null, y?.text ?? null)
    });
  }

  return projections;
};
