import { MapMode, Text, type ChangeDesc } from "@codemirror/state";
import type { StatementInfo, StatementMap } from "../dsl/dslDocument";
import { argNameForParameter } from "../dsl/dslConstructions";
import type { DslPhysicalSegment } from "../dsl/logicalStatementSourceMap";
import type { DslStatement } from "../dsl/dslTypes";
import type { FoldTarget } from "../model/groups";
import type { ElementId } from "../types/geometry";
import { bindingIdForStableStatementId, type BindingId } from "../scalars/bindingCatalog";
import type { LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";
import type { TextTemplateAst } from "../scalars/textTemplate";

type FoldAnchor = { from: number; to: number };

/** A single presentation branch, captured from one synchronized CM snapshot. */
export type StatementFoldTarget = FoldTarget & {
  /** Physical row on which CodeMirror renders the gutter marker. */
  gutterLineFrom: number;
  /** CM replacement range; deliberately independent from gutterLineFrom. */
  foldFrom: number;
  foldTo: number;
  /** Editing any structural delimiter disables this target until a valid compile refreshes it. */
  anchors: readonly FoldAnchor[];
};

export type StatementRange = {
  elementId: ElementId;
  statement: StatementInfo;
  from: number;
  to: number;
  /** Fold positions are captured from a synchronized CM document and thereafter mapped, never re-derived from stale lines. */
  foldTargets: readonly StatementFoldTarget[];
};

export type StatementRangeIndex = ReadonlyMap<ElementId, StatementRange>;

/** Builds CM logical-document positions only while the matching statementMap is current. */
export const createStatementRangeIndex = (doc: Text, statementMap: StatementMap): StatementRangeIndex => {
  const ranges = new Map<ElementId, StatementRange>();
  for (const [elementId, statement] of statementMap.byElementId) {
    if (statement.line < 1 || statement.line > doc.lines) continue;
    const line = doc.line(statement.line);
    const statementEndLine = statement.endLine <= doc.lines ? doc.line(statement.endLine) : null;
    const closeLine = statement.closeBraceLine && statement.closeBraceLine <= doc.lines ? doc.line(statement.closeBraceLine) : null;
    const openLine = statement.openBraceLine && statement.openBraceLine <= doc.lines ? doc.line(statement.openBraceLine) : null;
    // A block may open on the final physical header row (the canonical form)
    // or on a following standalone brace row. Never fall back to the first
    // header row: multi-line handwritten headers must keep their continuation
    // rows visible when folded.
    const braceLine = openLine ?? (closeLine ? statementEndLine : null);
    const elseLine = statement.elseBraceLine && statement.elseBraceLine <= doc.lines ? doc.line(statement.elseBraceLine) : null;
    const foldTargets: StatementFoldTarget[] = [];
    // Ordinary multiline statements (for example `point A = offset(`) get
    // their own presentation target. Keep the opening header and final close
    // row visible so the folded statement still reads naturally as `… )`.
    // Block statements use their brace targets below instead, avoiding two
    // competing gutter controls on a single structural header.
    if (!closeLine && statement.line < statement.endLine && statementEndLine && line.to < statementEndLine.from) {
      foldTargets.push({
        elementId,
        branch: "statement",
        gutterLineFrom: line.from,
        foldFrom: line.to,
        foldTo: statementEndLine.from,
        anchors: [
          { from: line.from, to: line.to },
          { from: statementEndLine.from, to: statementEndLine.to }
        ]
      });
    }
    if (braceLine && closeLine && braceLine.number < closeLine.number) {
      const foldTo = elseLine ? elseLine.from - 1 : closeLine.from;
      if (foldTo > braceLine.to) {
        foldTargets.push({
          elementId,
          branch: "primary",
          gutterLineFrom: braceLine.from,
          foldFrom: braceLine.to,
          foldTo,
          anchors: [
            { from: braceLine.from, to: braceLine.to },
            { from: (elseLine ?? closeLine).from, to: (elseLine ?? closeLine).to }
          ]
        });
      }
    }
    if (elseLine && closeLine && elseLine.number < closeLine.number && closeLine.from > elseLine.to) {
      foldTargets.push({
        elementId,
        branch: "else",
        gutterLineFrom: elseLine.from,
        foldFrom: elseLine.to,
        foldTo: closeLine.from,
        anchors: [
          { from: elseLine.from, to: elseLine.to },
          { from: closeLine.from, to: closeLine.to }
        ]
      });
    }
    ranges.set(elementId, {
      elementId,
      statement,
      from: line.from,
      to: statementEndLine?.to ?? line.to,
      foldTargets
    });
  }
  return ranges;
};

/**
 * Keeps last-known-good element ranges aligned with an uncommitted or fatal CM buffer.
 * A statement line deleted wholesale loses its identity until a valid compile replaces it.
 */
export const mapStatementRangeIndex = (
  ranges: StatementRangeIndex,
  changes: ChangeDesc
): StatementRangeIndex => {
  const mapped = new Map<ElementId, StatementRange>();
  for (const [elementId, range] of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    // A value at the statement's final character is still part of that
    // statement. TrackBefore would drop the whole range when that value is
    // replaced, so map the end after its replacement while the start keeps the
    // stricter identity guard below.
    const to = changes.mapPos(range.to, 1, MapMode.Simple);
    if (from === null || to === null || to < from) continue;
    const foldTargets = range.foldTargets.flatMap((target): StatementFoldTarget[] => {
      // Structural delimiter rows are the snapshot's identity anchors. A
      // changed anchor is intentionally unavailable while the buffer is dirty
      // rather than being guessed from stale StatementInfo line numbers.
      if (target.anchors.some((anchor) => changes.touchesRange(anchor.from, anchor.to) !== false)) return [];
      const foldFrom = changes.mapPos(target.foldFrom, 1, MapMode.TrackAfter);
      const foldTo = changes.mapPos(target.foldTo, -1, MapMode.TrackBefore);
      const gutterLineFrom = changes.mapPos(target.gutterLineFrom, 1, MapMode.TrackAfter);
      const anchors = target.anchors.map((anchor) => ({
        from: changes.mapPos(anchor.from, 1, MapMode.TrackAfter),
        to: changes.mapPos(anchor.to, -1, MapMode.TrackBefore)
      }));
      if (
        foldFrom === null || foldTo === null || foldTo <= foldFrom || gutterLineFrom === null ||
        anchors.some((anchor) => anchor.from === null || anchor.to === null || anchor.to < anchor.from)
      ) return [];
      return [{
        ...target,
        foldFrom,
        foldTo,
        gutterLineFrom,
        anchors: anchors as FoldAnchor[]
      }];
    });
    mapped.set(elementId, {
      ...range,
      from,
      to,
      foldTargets
    });
  }
  return mapped;
};

export const elementIdAtCursor = (ranges: StatementRangeIndex, head: number): ElementId | null => {
  for (const [elementId, range] of ranges) {
    if (head >= range.from && head <= range.to) return elementId;
  }
  return null;
};

export const statementRangeAtLine = (ranges: StatementRangeIndex, lineFrom: number): StatementRange | null => {
  for (const range of ranges.values()) {
    if (range.from === lineFrom) return range;
  }
  return null;
};

export type PrintLayoutRange = { printLayoutId: string; from: number; to: number };
export type PrintLayoutRangeIndex = ReadonlyMap<string, PrintLayoutRange>;

/**
 * Mirrors createStatementRangeIndex for printLayout block-opening lines.
 * statementMap.byKey entries keyed `printLayout:<id>` never appear in the
 * element-keyed StatementRangeIndex (printLayout/place/layoutVar produce no
 * CadElement), so `@variable` completion for printLayout-block attributes
 * needs this separate live-line -> committed-id index. Only valid while the
 * matching statementMap is current, same contract as createStatementRangeIndex.
 */
export const createPrintLayoutRangeIndex = (doc: Text, statementMap: StatementMap): PrintLayoutRangeIndex => {
  const ranges = new Map<string, PrintLayoutRange>();
  for (const [key, info] of statementMap.byKey) {
    if (!key.startsWith("printLayout:")) continue;
    if (info.line < 1 || info.line > doc.lines) continue;
    const printLayoutId = key.slice("printLayout:".length);
    const line = doc.line(info.line);
    ranges.set(printLayoutId, { printLayoutId, from: line.from, to: line.to });
  }
  return ranges;
};

/**
 * Mirrors mapStatementRangeIndex: re-projects each printLayout block-opening
 * line's last-known-good position through a CM ChangeDesc. No fold ranges are
 * tracked here (unlike StatementRange) since this index exists only for live
 * @variable completion identity lookup, not decoration/gutter positioning.
 */
export const mapPrintLayoutRangeIndex = (ranges: PrintLayoutRangeIndex, changes: ChangeDesc): PrintLayoutRangeIndex => {
  const mapped = new Map<string, PrintLayoutRange>();
  for (const [printLayoutId, range] of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(range.to, 1, MapMode.Simple);
    if (from === null || to === null || to < from) continue;
    mapped.set(printLayoutId, { printLayoutId, from, to });
  }
  return mapped;
};

export type AtStopRange = { from: number; to: number };

/**
 * Mirrors createStatementRangeIndex for the single non-element "@stop" line: only
 * valid while the matching statementMap is current (docText === sourceText).
 */
export const createAtStopRange = (doc: Text, statementMap: StatementMap): AtStopRange | null => {
  const statement = statementMap.byKey.get("atStop");
  if (!statement || statement.line < 1 || statement.line > doc.lines) return null;
  const line = doc.line(statement.line);
  return { from: line.from, to: line.to };
};

/**
 * Mirrors mapStatementRangeIndex: re-projects the last-known-good "@stop" position
 * through a CM ChangeDesc. Returns null once the position becomes unrecoverable
 * (fully covered by an edit), rather than ever falling back to a raw stale line number.
 */
export const mapAtStopRange = (range: AtStopRange | null, changes: ChangeDesc): AtStopRange | null => {
  if (!range) return null;
  // Unlike element statements, @stop has no runtime identity to retain through an
  // in-place edit. Any touch can change or remove the directive, so wait for a
  // successful compile rather than leaving a marker on an unrelated line.
  if (changes.touchesRange(range.from, range.to) !== false) return null;
  const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
  const to = changes.mapPos(range.to, -1, MapMode.TrackBefore);
  return from === null || to === null || to < from ? null : { from, to };
};

export type TypedDeclarationRange = { bindingId: BindingId; from: number; to: number };
export type TypedDeclarationRangeIndex = ReadonlyMap<BindingId, TypedDeclarationRange>;

/**
 * Mirrors createPrintLayoutRangeIndex for `const`/`let` typed declaration
 * statements (Task 39): a live-line -> stable binding identity index used only
 * for typed value completion's cursor -> BindingCatalog bridge, never for
 * fold/gutter presentation. Keyed by the same `binding:<stableStatementId>`
 * BindingId bindingCatalog.ts itself derives (`bindingIdForStableStatementId`),
 * so a caller can look the range's own bindingId straight up in
 * `BindingAnalysis.catalog.bindingsById` with no re-derivation. Absent
 * `statementIdByStatementIndex` (no typed declarations in this document, or a
 * failed compile) yields an empty index, same as printLayout's own map when
 * unavailable.
 */
export const createTypedDeclarationRangeIndex = (doc: Text, statementMap: StatementMap): TypedDeclarationRangeIndex => {
  const ranges = new Map<BindingId, TypedDeclarationRange>();
  const statementIdByStatementIndex = statementMap.statementIdByStatementIndex;
  if (!statementIdByStatementIndex) return ranges;
  for (const info of statementMap.statements) {
    if (info.kind !== "typedDeclaration") continue;
    const stableStatementId = statementIdByStatementIndex.get(info.statementIndex);
    if (stableStatementId === undefined) continue;
    if (info.line < 1 || info.line > doc.lines) continue;
    const line = doc.line(info.line);
    const endLine = info.endLine >= info.line && info.endLine <= doc.lines ? doc.line(info.endLine) : line;
    const bindingId = bindingIdForStableStatementId(stableStatementId);
    ranges.set(bindingId, { bindingId, from: line.from, to: endLine.to });
  }
  return ranges;
};

/**
 * Mirrors mapPrintLayoutRangeIndex: keeps last-known-good typed declaration
 * ranges aligned with an uncommitted or fatal CM buffer via CM's own
 * ChangeDesc position mapping. Only a change fully replacing the tracked
 * range end-to-end (`touchesRange(...) === "cover"`) drops it - an ordinary
 * edit anywhere inside the statement (including every keystroke typed into
 * its own initializer, well before the next compile debounce fires) maps
 * through and keeps the range alive, so typed value completion keeps
 * resolving the same binding across a dirty, uncommitted burst of edits.
 */
export const mapTypedDeclarationRangeIndex = (ranges: TypedDeclarationRangeIndex, changes: ChangeDesc): TypedDeclarationRangeIndex => {
  const mapped = new Map<BindingId, TypedDeclarationRange>();
  for (const [bindingId, range] of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(range.to, 1, MapMode.Simple);
    if (from === null || to === null || to < from) continue;
    mapped.set(bindingId, { bindingId, from, to });
  }
  return mapped;
};

/** Mirrors elementIdAtCursor for the typed declaration range index. */
export const typedDeclarationBindingIdAtCursor = (ranges: TypedDeclarationRangeIndex, head: number): BindingId | null => {
  for (const [bindingId, range] of ranges) {
    if (head >= range.from && head <= range.to) return bindingId;
  }
  return null;
};

/** A physical span is only usable for direct CM selection when it is a single
 * contiguous segment (mirrors dslStatementProjection.ts's singlePhysicalSegment
 * contract). Discontiguous/absent spans are dropped, never guessed at. */
const onlyPhysicalSegment = (span: { segments: readonly DslPhysicalSegment[] } | null | undefined): DslPhysicalSegment | null =>
  span && span.segments.length === 1 ? span.segments[0] : null;

export type TypedDeclarationFieldSpans = {
  name: DslPhysicalSegment | null;
  type: DslPhysicalSegment | null;
  initializer: DslPhysicalSegment | null;
};
export type TypedDeclarationFieldRangeIndex = ReadonlyMap<BindingId, TypedDeclarationFieldSpans>;

/**
 * Task 43: sub-statement spans for a `const`/`let` declaration's own name,
 * type annotation, and initializer, keyed the same way as
 * createTypedDeclarationRangeIndex. Reads only `namePhysicalSpan`/
 * `payloadPhysicalSpans.type`/`.initializer`, already computed once by the
 * parser in the same pass that produced `statements` - no re-parse, no new
 * projection call.
 */
export const createTypedDeclarationFieldRangeIndex = (
  statementMap: StatementMap,
  statements: readonly DslStatement[]
): TypedDeclarationFieldRangeIndex => {
  const fields = new Map<BindingId, TypedDeclarationFieldSpans>();
  const statementIdByStatementIndex = statementMap.statementIdByStatementIndex;
  if (!statementIdByStatementIndex) return fields;
  for (const info of statementMap.statements) {
    if (info.kind !== "typedDeclaration") continue;
    const stableStatementId = statementIdByStatementIndex.get(info.statementIndex);
    if (stableStatementId === undefined) continue;
    const statement = statements[info.statementIndex];
    if (!statement || statement.kind !== "typedDeclaration") continue;
    const bindingId = bindingIdForStableStatementId(stableStatementId);
    fields.set(bindingId, {
      name: onlyPhysicalSegment(statement.namePhysicalSpan),
      type: onlyPhysicalSegment(statement.payloadPhysicalSpans?.type),
      initializer: onlyPhysicalSegment(statement.payloadPhysicalSpans?.initializer)
    });
  }
  return fields;
};

/** Mirrors mapTypedDeclarationRangeIndex for each tracked sub-span independently. */
export const mapTypedDeclarationFieldRangeIndex = (
  fields: TypedDeclarationFieldRangeIndex,
  changes: ChangeDesc
): TypedDeclarationFieldRangeIndex => {
  const mapSegment = (segment: DslPhysicalSegment | null): DslPhysicalSegment | null => {
    if (!segment) return null;
    if (changes.touchesRange(segment.from, segment.to) === "cover") return null;
    const from = changes.mapPos(segment.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(segment.to, -1, MapMode.TrackBefore);
    return from === null || to === null || to < from ? null : { from, to };
  };
  const mapped = new Map<BindingId, TypedDeclarationFieldSpans>();
  for (const [bindingId, spans] of fields) {
    mapped.set(bindingId, {
      name: mapSegment(spans.name),
      type: mapSegment(spans.type),
      initializer: mapSegment(spans.initializer)
    });
  }
  return mapped;
};

export type SetStatementRange = { statementId: string; from: number; to: number };
export type SetStatementRangeIndex = ReadonlyMap<string, SetStatementRange>;

/**
 * Mirrors createTypedDeclarationRangeIndex for `set` statements: a live-line
 * -> stable statement identity index used for cursor-in-a-set-line detection
 * (Task 43 Tab/value navigation). Unlike typed declarations, the key is the
 * raw reconciler-issued statementId itself - `set` has no BindingId of its
 * own (it targets an existing binding, it does not declare one).
 */
export const createSetStatementRangeIndex = (doc: Text, statementMap: StatementMap): SetStatementRangeIndex => {
  const ranges = new Map<string, SetStatementRange>();
  const statementIdByStatementIndex = statementMap.statementIdByStatementIndex;
  if (!statementIdByStatementIndex) return ranges;
  for (const info of statementMap.statements) {
    if (info.kind !== "set") continue;
    const statementId = statementIdByStatementIndex.get(info.statementIndex);
    if (statementId === undefined) continue;
    if (info.line < 1 || info.line > doc.lines) continue;
    const line = doc.line(info.line);
    const endLine = info.endLine >= info.line && info.endLine <= doc.lines ? doc.line(info.endLine) : line;
    ranges.set(statementId, { statementId, from: line.from, to: endLine.to });
  }
  return ranges;
};

/** Mirrors mapTypedDeclarationRangeIndex. */
export const mapSetStatementRangeIndex = (ranges: SetStatementRangeIndex, changes: ChangeDesc): SetStatementRangeIndex => {
  const mapped = new Map<string, SetStatementRange>();
  for (const [statementId, range] of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(range.to, 1, MapMode.Simple);
    if (from === null || to === null || to < from) continue;
    mapped.set(statementId, { statementId, from, to });
  }
  return mapped;
};

/** Mirrors elementIdAtCursor for the set statement range index. */
export const setStatementIdAtCursor = (ranges: SetStatementRangeIndex, head: number): string | null => {
  for (const [statementId, range] of ranges) {
    if (head >= range.from && head <= range.to) return statementId;
  }
  return null;
};

export type SetStatementFieldSpans = { target: DslPhysicalSegment | null; expression: DslPhysicalSegment | null };
export type SetStatementFieldRangeIndex = ReadonlyMap<string, SetStatementFieldSpans>;

/**
 * Task 43 sibling to createTypedDeclarationFieldRangeIndex: a `set`
 * statement's own target (`nameSpan`/`namePhysicalSpan`, reused verbatim by
 * SetStatementAnalysis.targetSpan) and RHS expression
 * (`payloadPhysicalSpans.expression`, reused verbatim by
 * SetStatementAnalysis.expressionSpan). Built from the raw parsed statement
 * alone - works even when bindingAnalysis/setStatements resolution failed,
 * exactly like legacy element value spans stay Tab/click-reachable
 * regardless of dependency validity.
 */
export const createSetStatementFieldRangeIndex = (
  statementMap: StatementMap,
  statements: readonly DslStatement[]
): SetStatementFieldRangeIndex => {
  const fields = new Map<string, SetStatementFieldSpans>();
  const statementIdByStatementIndex = statementMap.statementIdByStatementIndex;
  if (!statementIdByStatementIndex) return fields;
  for (const info of statementMap.statements) {
    if (info.kind !== "set") continue;
    const statementId = statementIdByStatementIndex.get(info.statementIndex);
    if (statementId === undefined) continue;
    const statement = statements[info.statementIndex];
    if (!statement || statement.kind !== "set") continue;
    fields.set(statementId, {
      target: onlyPhysicalSegment(statement.namePhysicalSpan),
      expression: onlyPhysicalSegment(statement.payloadPhysicalSpans?.expression)
    });
  }
  return fields;
};

/** Mirrors mapTypedDeclarationFieldRangeIndex. */
export const mapSetStatementFieldRangeIndex = (
  fields: SetStatementFieldRangeIndex,
  changes: ChangeDesc
): SetStatementFieldRangeIndex => {
  const mapSegment = (segment: DslPhysicalSegment | null): DslPhysicalSegment | null => {
    if (!segment) return null;
    if (changes.touchesRange(segment.from, segment.to) === "cover") return null;
    const from = changes.mapPos(segment.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(segment.to, -1, MapMode.TrackBefore);
    return from === null || to === null || to < from ? null : { from, to };
  };
  const mapped = new Map<string, SetStatementFieldSpans>();
  for (const [statementId, spans] of fields) {
    mapped.set(statementId, { target: mapSegment(spans.target), expression: mapSegment(spans.expression) });
  }
  return mapped;
};

export type TemplateHoleRange = { occurrenceKey: string; holeIndex: number; from: number; to: number };
export type TemplateHoleRangeIndex = ReadonlyMap<string, readonly TemplateHoleRange[]>;

/** `propertyBindingOccurrenceKey`'s own format (`${statementIndex}:${parameterKey}`); parsed
 * back here rather than re-exported, since only this index needs the statementIndex half. */
const statementIndexFromOccurrenceKey = (occurrenceKey: string): number | null => {
  const separator = occurrenceKey.indexOf(":");
  if (separator < 0) return null;
  const statementIndex = Number(occurrenceKey.slice(0, separator));
  return Number.isInteger(statementIndex) ? statementIndex : null;
};

/**
 * Task 43: per-occurrence hole spans for `label(text: "...")` templates
 * (Task 26), in source order. Each hole's physical position is derived by
 * pure arithmetic against the owning attribute's own already-projected
 * `physicalSpan` (a single-segment offset shift, since every
 * TextTemplateAst span/contentSpan shares the same statement-logical
 * coordinate system as `attr.valueStart` - see propertyBindingCompiler.ts's
 * identical convention) - no new logical-to-physical projection call, no
 * re-parse. An attribute value split across a continuation line (more than
 * one physical segment) is skipped entirely, matching this file's other
 * fail-closed span handling.
 */
export const createTemplateHoleRangeIndex = (
  statementMap: StatementMap,
  statements: readonly DslStatement[],
  textTemplates: ReadonlyMap<string, TextTemplateAst> | undefined
): TemplateHoleRangeIndex => {
  const ranges = new Map<string, TemplateHoleRange[]>();
  if (!textTemplates) return ranges;
  for (const [occurrenceKey, ast] of textTemplates) {
    const statementIndex = statementIndexFromOccurrenceKey(occurrenceKey);
    if (statementIndex === null) continue;
    const statement = statements[statementIndex];
    if (!statement || statement.kind !== "element" || !statement.type) continue;
    const argName = argNameForParameter(statement.type, "text");
    const attr = argName ? statement.attrs.find((candidate) => candidate.key === argName) : undefined;
    const segment = attr ? onlyPhysicalSegment(attr.physicalSpan) : null;
    if (!attr || !segment) continue;
    const holes: TemplateHoleRange[] = [];
    let holeIndex = 0;
    for (const templateSegment of ast.segments) {
      if (templateSegment.kind !== "hole") continue;
      const from = segment.from + (templateSegment.contentSpan.start - attr.valueStart);
      const to = segment.from + (templateSegment.contentSpan.end - attr.valueStart);
      if (to >= from) holes.push({ occurrenceKey, holeIndex, from, to });
      holeIndex += 1;
    }
    if (holes.length > 0) ranges.set(occurrenceKey, holes);
  }
  return ranges;
};

/** Mirrors mapTypedDeclarationRangeIndex per hole; a hole whose own span is
 * fully covered by an edit drops just that hole, not the whole occurrence. */
export const mapTemplateHoleRangeIndex = (ranges: TemplateHoleRangeIndex, changes: ChangeDesc): TemplateHoleRangeIndex => {
  const mapped = new Map<string, TemplateHoleRange[]>();
  for (const [occurrenceKey, holes] of ranges) {
    const mappedHoles = holes.flatMap((hole): TemplateHoleRange[] => {
      if (changes.touchesRange(hole.from, hole.to) === "cover") return [];
      const from = changes.mapPos(hole.from, 1, MapMode.TrackAfter);
      const to = changes.mapPos(hole.to, -1, MapMode.TrackBefore);
      return from === null || to === null || to < from ? [] : [{ ...hole, from, to }];
    });
    if (mappedHoles.length > 0) mapped.set(occurrenceKey, mappedHoles);
  }
  return mapped;
};

/** The narrowest tracked hole containing `pos`, for click precision inside a
 * text template attribute value. Half-open, mirroring findDslValueSpanAt. */
export const templateHoleAtPosition = (ranges: TemplateHoleRangeIndex, occurrenceKey: string, pos: number): TemplateHoleRange | null =>
  (ranges.get(occurrenceKey) ?? []).find((hole) => pos >= hole.from && pos < hole.to) ?? null;

export type ScopeBodyRange = { scopeId: ScopeId; from: number; to: number; depth: number };
export type ScopeBodyRangeIndex = readonly ScopeBodyRange[];

/**
 * Task 40: live body-range tracking for every non-root lexical scope
 * (`group`/`then`/`else`/`forGroup`), purely structural - independent of
 * which (if any) `set` statement lives inside a scope's body. Set target/RHS
 * completion (src/scalars/setCompletionCandidates.ts) uses this to resolve
 * "which scope contains the live cursor" the same way for a brand-new,
 * never-yet-compiled `set` line as for an already-compiled one - unlike
 * TypedDeclarationRangeIndex above, entries here are keyed by structural
 * position, never by a specific statement's own stable identity, so a scope
 * whose body has not yet had any successful `set`/declaration compile inside
 * it is still resolvable as long as the scope itself (its opening/closing
 * braces) survived the last successful compile.
 */
export const createScopeBodyRangeIndex = (
  doc: Text,
  statementMap: StatementMap,
  scopeIndex: LexicalScopeIndex
): ScopeBodyRangeIndex => {
  const ranges: ScopeBodyRange[] = [];
  for (const [scopeId, scope] of scopeIndex.scopes) {
    if (scopeId === scopeIndex.rootScopeId || scope.openingStatementIndex === null) continue;
    const openingInfo = statementMap.statements[scope.openingStatementIndex];
    if (!openingInfo) continue;
    // Mirrors createStatementRangeIndex's own "brace line, or the header's
    // own last line when unopened on its own row" fallback.
    const braceLine = openingInfo.openBraceLine ?? openingInfo.endLine;
    if (braceLine < 1 || braceLine > doc.lines) continue;
    const bodyFrom = doc.line(braceLine).to;
    let bodyTo: number;
    if (scope.exitStatementIndex < statementMap.statements.length) {
      const closingInfo = statementMap.statements[scope.exitStatementIndex];
      if (!closingInfo || closingInfo.line < 1 || closingInfo.line > doc.lines) continue;
      bodyTo = doc.line(closingInfo.line).from;
    } else {
      // Unclosed (or root, already skipped above): the body extends to the
      // end of the document, exactly like lexicalScopeIndex.ts's own
      // `exitStatementIndex = statements.length` sentinel.
      bodyTo = doc.length;
    }
    if (bodyTo < bodyFrom) continue;
    const depth = scopeIndex.scopeMetadataById.get(scopeId)?.depth ?? 0;
    ranges.push({ scopeId, from: bodyFrom, to: bodyTo, depth });
  }
  return ranges;
};

/**
 * Mirrors mapTypedDeclarationRangeIndex: an edit anywhere inside a tracked
 * scope body (including every keystroke typed into a brand-new `set` line
 * inside it) maps through and keeps the entry alive; only a change fully
 * replacing the body end-to-end drops it. A change to the scope's own
 * opening/closing brace *line* outside the tracked `[from, to)` interior is
 * not specially detected here - like every other Tier B range index in this
 * file, that staleness is accepted until the next successful compile
 * refreshes the index (see dslSetCompletionContext.ts's own Tier A reparse,
 * which independently guards the `set` statement's own shape on every
 * keystroke).
 */
export const mapScopeBodyRangeIndex = (ranges: ScopeBodyRangeIndex, changes: ChangeDesc): ScopeBodyRangeIndex => {
  const mapped: ScopeBodyRange[] = [];
  for (const range of ranges) {
    if (changes.touchesRange(range.from, range.to) === "cover") continue;
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    const to = changes.mapPos(range.to, -1, MapMode.TrackBefore);
    if (from === null || to === null || to < from) continue;
    mapped.push({ ...range, from, to });
  }
  return mapped;
};

/**
 * Deepest (most nested) scope whose live body contains `pos`, defaulting to
 * `rootScopeId` when none matches. Since a nested scope's live body range is
 * always a subset of its ancestor's (brace nesting), the greatest `depth`
 * among containing ranges is always the innermost one - no tie-breaking
 * beyond that is possible.
 */
export const deepestContainingScopeId = (index: ScopeBodyRangeIndex, pos: number, rootScopeId: ScopeId): ScopeId => {
  let best: ScopeBodyRange | null = null;
  for (const range of index) {
    if (pos < range.from || pos > range.to) continue;
    if (!best || range.depth > best.depth) best = range;
  }
  return best?.scopeId ?? rootScopeId;
};
