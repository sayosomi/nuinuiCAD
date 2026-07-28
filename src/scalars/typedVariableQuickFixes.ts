// Task 41: pure Quick Fix descriptor generation for typed-variable/version/
// choice diagnostics. See docs/typed-variables/tasks/41-typed-variable-quick-fixes.md.
//
// This module never mutates a live editor, never dispatches a CM transaction,
// and never re-resolves a binding. It only reads already-compiled
// `DslStatement`s (never `bindingAnalysis`/`BindingCatalog` - every fix here
// only needs fields already present on the statement itself: `nameSpan`,
// `declaredType`, `bindingKind`, `attrs`) plus the diagnostics array, and
// produces plain splice/action descriptors an editor adapter can apply
// verbatim. `diagnostic.line`/`diagnostic.code` are used only to *route* to
// the owning statement and fix kind - every actual offset is computed from
// the statement's own already-logical spans, projected to physical source
// offsets via `parseDslSnapshot`/`physicalSpanForLogicalRange` (the same
// "only bridge from parser logical offsets to editor physical offsets" Task
// 38's `buildTypedRenameSplices` established), never from a diagnostic's own
// `column`/`physicalSpan` (which is coarse - whole-keyword or whole-statement
// - for several of the diagnostic codes this module handles).
//
// Every descriptor carries the exact `sourceText` snapshot it was generated
// against. The editor adapter must reject (no-op) an action whose current
// live text no longer equals that snapshot byte-for-byte - this module only
// computes offsets; it never re-verifies them against a *different* text.

import { parseDslSnapshot } from "../dsl/dslParser";
import { commonExclusiveGroups, ELEMENT_STATE_CONFLICT_CODE } from "../dsl/dslCallParser";
import { MISSING_DECLARED_TYPE_CODE } from "../dsl/dslDeclarationParser";
import type { DslDiagnostic, DslSpan, DslStatement } from "../dsl/dslTypes";
import {
  physicalSpanForLogicalRange,
  type LogicalStatement,
  type LogicalStatementSourceMap
} from "../dsl/logicalStatementSourceMap";
import { TYPED_SYNTAX_REQUIRES_NUI3_CODE, type DslMajorVersion } from "../dsl/dslVersion";
import { IDENTIFIER_PATTERN } from "./literalScanner";

export type TypedVariableQuickFixSplice = {
  readonly kind: "splice";
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  /** The exact text expected at [from, to) in the generation-time `sourceSnapshot`. */
  readonly expectedOldText: string;
  /** Absolute cursor position to select after applying `insert`. */
  readonly selection: number;
};

export type TypedVariableQuickFixAction =
  | { readonly kind: "upgrade-major-version"; readonly target: DslMajorVersion }
  | TypedVariableQuickFixSplice;

export type TypedVariableQuickFixDescriptor = {
  readonly id: string;
  readonly label: string;
  /** Full source text this descriptor's offsets were computed against - the editor
   * adapter must reject applying this descriptor against any other live text. */
  readonly sourceSnapshot: string;
  readonly action: TypedVariableQuickFixAction;
};

const SCALAR_TYPE_MISMATCH_CODE = "scalar-type-mismatch";
const INVALID_CHOICE_LITERAL_CODE = "invalid-choice-literal";
const UNEXPECTED_TOKEN_CODE = "unexpected-token";

const lineStartOffsets = (source: string): number[] => {
  const starts = [0];
  for (const match of source.matchAll(/\r\n|\n|\r/g)) starts.push((match.index ?? 0) + match[0].length);
  return starts;
};

type StatementEntry = { statement: DslStatement; index: number };

/** First statement starting on a given physical line - typedDeclaration/set/element
 * statements' own diagnostics always report the statement's own start line. */
const buildLineIndex = (statements: readonly DslStatement[]): Map<number, StatementEntry> => {
  const map = new Map<number, StatementEntry>();
  statements.forEach((statement, index) => {
    if (!map.has(statement.line)) map.set(statement.line, { statement, index });
  });
  return map;
};

const buildLogicalIndex = (sourceMap: LogicalStatementSourceMap): Map<string, LogicalStatement> => {
  const map = new Map<string, LogicalStatement>();
  for (const logical of sourceMap.statements) map.set(`${logical.range.from}:${logical.range.to}`, logical);
  return map;
};

const logicalStatementFor = (
  index: Map<string, LogicalStatement>,
  statement: DslStatement
): LogicalStatement | undefined => index.get(`${statement.documentRange.from}:${statement.documentRange.to}`);

/**
 * Projects a logical range (relative to `logical`'s own logical text - the
 * same domain `nameSpan`/`attrs[].keyStart`/a typecheck diagnostic's own
 * `span` all live in) into an absolute splice, verifying the projection is a
 * single contiguous physical segment and recording the live text actually
 * found there. Returns `null` (no fix offered) on any non-contiguous or
 * out-of-range projection - this module never guesses across a projection
 * failure. Only for non-zero-width ranges - see `projectInsertionOffset` for
 * a pure insertion point.
 */
const projectSplice = (
  sourceText: string,
  sourceMap: LogicalStatementSourceMap,
  logical: LogicalStatement,
  range: DslSpan,
  insert: string,
  selectionOffsetFromStart: number
): TypedVariableQuickFixSplice | null => {
  const physical = physicalSpanForLogicalRange(sourceMap, logical, range);
  if (!physical || physical.segments.length !== 1) return null;
  const { from, to } = physical.segments[0];
  if (from < 0 || to > sourceText.length) return null;
  return {
    kind: "splice",
    from,
    to,
    insert,
    expectedOldText: sourceText.slice(from, to),
    selection: from + selectionOffsetFromStart
  };
};

/**
 * Projects a single logical *point* (not a range) to an absolute offset, for
 * pure insertions. `physicalSpanForLogicalRange` deliberately never emits a
 * segment for a zero-width range (a continuation separator has zero width
 * too, so a naive `{pos, pos}` query is ambiguous about which side of it the
 * point falls on) - this instead projects the single real character
 * immediately before `pos` (or immediately after, at logical-zero) and reads
 * the *near* edge of that segment, which is well-defined as long as `pos`
 * doesn't itself sit exactly on a continuation boundary (in which case this
 * returns `null` - no fix offered - rather than guess a side).
 */
const projectInsertionOffset = (
  sourceMap: LogicalStatementSourceMap,
  logical: LogicalStatement,
  pos: number
): number | null => {
  if (pos > 0) {
    const physical = physicalSpanForLogicalRange(sourceMap, logical, { start: pos - 1, end: pos });
    if (!physical || physical.segments.length !== 1) return null;
    return physical.segments[0].to;
  }
  if (logical.logicalText.length === 0) return null;
  const physical = physicalSpanForLogicalRange(sourceMap, logical, { start: 0, end: 1 });
  if (!physical || physical.segments.length !== 1) return null;
  return physical.segments[0].from;
};

const missingDeclaredTypeFix = (
  sourceText: string,
  sourceMap: LogicalStatementSourceMap,
  logicalIndex: Map<string, LogicalStatement>,
  entry: StatementEntry
): TypedVariableQuickFixDescriptor | null => {
  const { statement } = entry;
  if (statement.kind !== "typedDeclaration" || !statement.nameSpan) return null;
  const logical = logicalStatementFor(logicalIndex, statement);
  if (!logical) return null;
  const from = projectInsertionOffset(sourceMap, logical, statement.nameSpan.end);
  if (from === null || from > sourceText.length) return null;
  const insert = ": ";
  return {
    id: `missing-declared-type:${entry.index}`,
    label: "型注釈 (: 型) を追加",
    sourceSnapshot: sourceText,
    action: {
      kind: "splice",
      from,
      to: from,
      insert,
      expectedOldText: "",
      selection: from + insert.length
    }
  };
};

const choiceLiteralReplaceFixes = (
  sourceText: string,
  sourceMap: LogicalStatementSourceMap,
  logicalIndex: Map<string, LogicalStatement>,
  entry: StatementEntry,
  diagnostic: DslDiagnostic
): TypedVariableQuickFixDescriptor[] => {
  const { statement } = entry;
  if (statement.kind !== "typedDeclaration" || statement.declaredType?.kind !== "choice") return [];
  const logical = logicalStatementFor(logicalIndex, statement);
  if (!logical) return [];
  // `column` is `span.start + 1` for these diagnostics (typedDeclarationAnalysis.ts's
  // own `compileDiagnostic` threads the real AST node span through, unlike the
  // dslParser.ts-level wrapper other diagnostic families go through) - the exact
  // logical start of the invalid choice literal token.
  const logicalStart = diagnostic.column - 1;
  if (logicalStart < 0 || logicalStart > logical.logicalText.length) return [];
  const match = IDENTIFIER_PATTERN.exec(logical.logicalText.slice(logicalStart));
  if (!match) return [];
  const logicalEnd = logicalStart + match[0].length;
  const descriptors: TypedVariableQuickFixDescriptor[] = [];
  for (const option of statement.declaredType.options) {
    const splice = projectSplice(
      sourceText,
      sourceMap,
      logical,
      { start: logicalStart, end: logicalEnd },
      option,
      option.length
    );
    if (splice && splice.expectedOldText === match[0]) {
      descriptors.push({
        id: `choice-replace:${entry.index}:${option}`,
        label: `"${option}" に置き換え`,
        sourceSnapshot: sourceText,
        action: splice
      });
    }
  }
  return descriptors;
};

/**
 * Inserts a `set <name> = ` skeleton line right before whatever statement
 * follows this declaration in document order (including a block-closing
 * `}`, which is itself a statement - this keeps the inserted `set` inside
 * the same lexical block without any scope-aware logic), or at true EOF when
 * this is the last statement. Anchoring to the *next* statement's own line
 * start - rather than this statement's own line end - means the insertion
 * point is never on the same physical line as this declaration, so it can
 * never land before a same-line trailing comment or split a continuation;
 * physical line boundaries are pure string facts, so this needs no
 * logical->physical projection at all (unlike every other fix here).
 */
const setSkeletonRecoveryFix = (
  sourceText: string,
  lineStarts: readonly number[],
  statements: readonly DslStatement[],
  entry: StatementEntry
): TypedVariableQuickFixDescriptor | null => {
  const { statement } = entry;
  if (statement.kind !== "typedDeclaration" || statement.bindingKind !== "let" || statement.declaredType === null) {
    return null;
  }
  const declarationLineStart = lineStarts[statement.line - 1];
  if (declarationLineStart === undefined) return null;
  const indentMatch = /^[ \t]*/.exec(sourceText.slice(declarationLineStart));
  const indentation = indentMatch ? indentMatch[0] : "";

  const next = statements[entry.index + 1];
  const insertAt = next ? lineStarts[next.line - 1] : sourceText.length;
  if (insertAt === undefined) return null;

  const needsLeadingNewline = insertAt === sourceText.length && sourceText.length > 0 && !sourceText.endsWith("\n");
  const prefix = needsLeadingNewline ? "\n" : "";
  const setPrefix = `${indentation}set ${statement.name} = `;
  const insert = `${prefix}${setPrefix}\n`;

  return {
    id: `set-skeleton-recovery:${entry.index}`,
    label: `set ${statement.name} = ... で復旧`,
    sourceSnapshot: sourceText,
    action: {
      kind: "splice",
      from: insertAt,
      to: insertAt,
      insert,
      expectedOldText: "",
      selection: insertAt + prefix.length + setPrefix.length
    }
  };
};

const elementStateConflictFixes = (
  sourceText: string,
  sourceMap: LogicalStatementSourceMap,
  logicalIndex: Map<string, LogicalStatement>,
  entry: StatementEntry
): TypedVariableQuickFixDescriptor[] => {
  const { statement } = entry;
  if (statement.kind !== "element") return [];
  const logical = logicalStatementFor(logicalIndex, statement);
  if (!logical) return [];
  const attrs = statement.attrs;

  // Re-derive every legacy side actually in conflict directly from the
  // statement's own attrs (never from a diagnostic's own span - multiple
  // `element-state-conflict` diagnostics on the same line, e.g. state+visible
  // *and* state+enabled both present, would otherwise be indistinguishable
  // by code+line alone). The legacy side is always a group's own last entry.
  const legacyKeys = new Set(
    commonExclusiveGroups
      .filter((group) => group.every((key) => attrs.some((attr) => attr.key === key)))
      .map((group) => group[group.length - 1])
  );

  const descriptors: TypedVariableQuickFixDescriptor[] = [];
  attrs.forEach((attr, attrIndex) => {
    if (!legacyKeys.has(attr.key)) return;
    const rangeStart = attrIndex < attrs.length - 1 ? attr.keyStart : (attrs[attrIndex - 1]?.valueEnd ?? attr.keyStart);
    const rangeEnd = attrIndex < attrs.length - 1 ? attrs[attrIndex + 1].keyStart : attr.valueEnd;
    const splice = projectSplice(sourceText, sourceMap, logical, { start: rangeStart, end: rangeEnd }, "", 0);
    if (splice) {
      descriptors.push({
        id: `remove-legacy-state-arg:${entry.index}:${attr.key}`,
        label: `"${attr.key}" を削除 (state を維持)`,
        sourceSnapshot: sourceText,
        action: splice
      });
    }
  });
  return descriptors;
};

/**
 * One descriptor list per input `diagnostics` entry, same index alignment.
 * `rawSourceText` may carry any line-ending style (the production caller
 * passes `view.state.doc.toString()`, which CM always keeps LF-normalized
 * regardless of the on-disk format, but this module normalizes internally -
 * mirroring `buildTypedRenameSplices`'s own `sourceText.replace(/\r\n/g,
 * "\n")` step - so it never depends on the caller having done so). Every
 * computed offset, and every descriptor's `sourceSnapshot`, is relative to
 * the *normalized* text - the editor adapter must compare against
 * `view.state.doc.toString()`, which is always in that same LF form.
 */
export const typedVariableQuickFixes = (
  rawSourceText: string,
  statements: readonly DslStatement[],
  diagnostics: readonly DslDiagnostic[]
): readonly (readonly TypedVariableQuickFixDescriptor[])[] => {
  if (diagnostics.length === 0) return [];

  const sourceText = rawSourceText.replace(/\r\n|\r/g, "\n");
  const lineIndex = buildLineIndex(statements);
  const lineStarts = lineStartOffsets(sourceText);
  const parsed = parseDslSnapshot({ normalizedSource: sourceText, sourceRevision: 0 });
  const logicalIndex = buildLogicalIndex(parsed.sourceMap);

  return diagnostics.map((diagnostic) => {
    if (diagnostic.code === TYPED_SYNTAX_REQUIRES_NUI3_CODE) {
      return [
        {
          id: "upgrade-nui3",
          label: "nui 3 へアップグレード",
          sourceSnapshot: sourceText,
          action: { kind: "upgrade-major-version", target: 3 as DslMajorVersion }
        }
      ];
    }

    const entry = lineIndex.get(diagnostic.line);
    if (!entry) return [];

    if (diagnostic.code === MISSING_DECLARED_TYPE_CODE) {
      const fix = missingDeclaredTypeFix(sourceText, parsed.sourceMap, logicalIndex, entry);
      return fix ? [fix] : [];
    }

    if (diagnostic.code === ELEMENT_STATE_CONFLICT_CODE) {
      return elementStateConflictFixes(sourceText, parsed.sourceMap, logicalIndex, entry);
    }

    if (
      diagnostic.code === INVALID_CHOICE_LITERAL_CODE ||
      diagnostic.code === SCALAR_TYPE_MISMATCH_CODE ||
      diagnostic.code === UNEXPECTED_TOKEN_CODE
    ) {
      const descriptors: TypedVariableQuickFixDescriptor[] = [];
      if (diagnostic.code === INVALID_CHOICE_LITERAL_CODE) {
        descriptors.push(...choiceLiteralReplaceFixes(sourceText, parsed.sourceMap, logicalIndex, entry, diagnostic));
      }
      const recovery = setSkeletonRecoveryFix(sourceText, lineStarts, statements, entry);
      if (recovery) descriptors.push(recovery);
      return descriptors;
    }

    return [];
  });
};
