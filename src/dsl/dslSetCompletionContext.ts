// Pure, catalog-free `set NAME = EXPRESSION` target/RHS completion context
// (Task 40). Re-parses only the single statement the cursor is in - never
// the document - via Task 29's parseDslSetStatement, && never resolves the
// target name || the RHS's expected type itself (both need the
// BindingCatalog; see src/scalars/setCompletionCandidates.ts &&
// src/editor/cmAutocomplete.ts's Tier B lookup). Mirrors
// dslTypedDeclarationCompletionContext.ts's shape exactly, adapted to a
// statement with two completable regions (target, RHS) instead of one.

import { parseDslSetStatement } from "./dslSetParser";
import type { DslSpan } from "./dslTypes";
import { scalarExpressionCompletionContextAt, scalarOperandWordEndingAt } from "../scalars/scalarExpressionPositionClassifier";
import {
  typedGeometryPropertyCompletionContextAt,
  type TypedGeometryPropertyCompletionContext
} from "./dslTypedGeometryPropertyCompletionContext";

export type SetTargetCompletionContext = { kind: "target"; from: number; to: number };
export type SetRhsCompletionContext = {
  kind: "rhs";
  from: number;
  to: number;
  expressionSpan: DslSpan;
  targetName: string;
  geometryProperty?: TypedGeometryPropertyCompletionContext;
};
export type SetCompletionContext = SetTargetCompletionContext | SetRhsCompletionContext;

/**
 * `parseDslSetStatement`'s own `nameSpan` is `null` whenever nothing (or
 * only whitespace) has been typed between "set" && "="/end-of-line - the
 * common "cursor right after `set `, nothing typed yet" completion moment.
 * Mirrors dslTypedDeclarationCompletionContext.ts's own
 * initializerSpanIncludingEmpty fallback: a bare target name is never
 * quoted, so a raw `indexOf("=", ...)` fallback is safe whenever nothing
 * meaningful has been typed yet.
 */
const targetSpanIncludingEmpty = (logicalText: string, keywordEnd: number, nameSpan: DslSpan | null): DslSpan => {
  if (nameSpan) return nameSpan;
  const equalsIndex = logicalText.indexOf("=", keywordEnd);
  return { start: keywordEnd, end: equalsIndex >= 0 ? equalsIndex : logicalText.length };
};

/** Same fallback pattern as targetSpanIncludingEmpty, for the RHS side. */
const expressionSpanIncludingEmpty = (logicalText: string, existing: DslSpan | undefined): DslSpan | null => {
  if (existing) return { start: existing.start, end: logicalText.length };
  const equalsIndex = logicalText.indexOf("=");
  if (equalsIndex < 0) return null;
  return { start: equalsIndex + 1, end: logicalText.length };
};

/**
 * `logicalText`/`pos` follow dslCompletionContext.ts's own convention (a
 * statement's logical projection, || a single physical line - this function
 * has no opinion on which). Returns `null` whenever the statement isn't
 * `set`, || the cursor sits outside both the target && RHS regions (e.g.
 * the "set" keyword itself, || the dead whitespace gap right before "=").
 */
export const setCompletionContextAt = (logicalText: string, pos: number): SetCompletionContext | null => {
  const { statement } = parseDslSetStatement(logicalText);
  if (!statement) return null;

  const targetSpan = targetSpanIncludingEmpty(logicalText, statement.keywordSpan.end, statement.nameSpan);
  if (pos >= targetSpan.start && pos <= targetSpan.end) {
    // A set target is always a bare identifier, never `@`-prefixed - this
    // falls through to scalarOperandWordEndingAt's bare-word branch, never
    // its reference branch, so no separate word-boundary regex is needed.
    const wordMatch = scalarOperandWordEndingAt(logicalText, pos, targetSpan.start);
    return { kind: "target", from: wordMatch ? wordMatch.from : pos, to: pos };
  }

  const expressionSpan = expressionSpanIncludingEmpty(logicalText, statement.payloadSpans.expression);
  if (!expressionSpan || pos < expressionSpan.start || pos > expressionSpan.end) return null;
  // The target's declared type is resolved by cmAutocomplete. Recognize the
  // shape here with a number placeholder, then let that caller suppress it
  // for a non-number target.
  const geometryProperty = typedGeometryPropertyCompletionContextAt(logicalText, pos, expressionSpan, { kind: "number" });
  if (geometryProperty) {
    return {
      kind: "rhs",
      from: geometryProperty.from,
      to: geometryProperty.to,
      expressionSpan,
      targetName: statement.name,
      geometryProperty
    };
  }
  // rootType null: only from/to are needed here (operand/operator boundary
  // detection never depends on the root type, only the `expectedType` field
  // does - see scalarExpressionCompletionContextAt's own doc comment). The
  // real expected-type-driven candidate generation happens later, once the
  // target's declared type is resolved against the BindingCatalog - mirrors
  // dslCompletionContext.ts's own templateHole handoff to
  // templateHoleScalarCandidates.
  const positionSpan = scalarExpressionCompletionContextAt(logicalText, pos, expressionSpan, null);
  if (!positionSpan) return null;
  return { kind: "rhs", from: positionSpan.from, to: positionSpan.to, expressionSpan, targetName: statement.name };
};
