// AST/diagnostic types for typed scalar expressions (initializers, future
// `set` RHS, future conditions). Production-unconnected: see
// docs/typed-variables/tasks/14-ts-expression-parser.md. Consumed later by
// Task 15 (typecheck, adds binding IDs/types) and Task 17 (Rust payload
// schema validation) - this module defines the shared shape only, with no
// name resolution, typecheck, or evaluation logic of its own.
//
// `ScalarSpan` is reused directly from literalScanner.ts (Task 09) rather
// than redefined here - it is already the shared span shape across the
// scalar subsystem.

import type { ScalarSpan } from "./literalScanner";

export type { ScalarSpan };

export type ScalarUnaryOperator = "!" | "-" | "+";

export type ScalarBinaryOperator =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/";

export interface ScalarNumberLiteralNode {
  readonly kind: "numberLiteral";
  readonly span: ScalarSpan;
  readonly value: number;
}

export interface ScalarStringLiteralNode {
  readonly kind: "stringLiteral";
  readonly span: ScalarSpan;
  readonly value: string;
}

export interface ScalarBooleanLiteralNode {
  readonly kind: "booleanLiteral";
  readonly span: ScalarSpan;
  readonly value: boolean;
}

/**
 * A bare choice token with no expected type available to resolve it against
 * (this parser never branches on type). Task 15 resolves this against the
 * declared/expected choice type; until then it is kept as an explicit
 * "unresolved" node rather than guessed at.
 */
export interface ScalarUnresolvedChoiceLiteralNode {
  readonly kind: "unresolvedChoiceLiteral";
  readonly span: ScalarSpan;
  readonly raw: string;
}

/**
 * A single `@name` reference. `span` includes the leading `@`; `nameSpan`
 * covers only the identifier, since name-span exactness (including Unicode
 * names) is required independently of the sigil.
 */
export interface ScalarReferenceNode {
  readonly kind: "reference";
  readonly span: ScalarSpan;
  readonly nameSpan: ScalarSpan;
  readonly name: string;
}

export interface ScalarUnaryExpressionNode {
  readonly kind: "unary";
  readonly span: ScalarSpan;
  readonly operator: ScalarUnaryOperator;
  readonly operand: ScalarExpressionAst;
}

export interface ScalarBinaryExpressionNode {
  readonly kind: "binary";
  readonly span: ScalarSpan;
  readonly operator: ScalarBinaryOperator;
  readonly left: ScalarExpressionAst;
  readonly right: ScalarExpressionAst;
}

/** `span` includes both parenthesis characters. */
export interface ScalarGroupExpressionNode {
  readonly kind: "group";
  readonly span: ScalarSpan;
  readonly expression: ScalarExpressionAst;
}

export type ScalarExpressionAst =
  | ScalarNumberLiteralNode
  | ScalarStringLiteralNode
  | ScalarBooleanLiteralNode
  | ScalarUnresolvedChoiceLiteralNode
  | ScalarReferenceNode
  | ScalarUnaryExpressionNode
  | ScalarBinaryExpressionNode
  | ScalarGroupExpressionNode;

export type ScalarExpressionIssueCode =
  | "unexpected-token"
  | "missing-operand"
  | "unterminated-group"
  | "trailing-token"
  | "expression-depth-exceeded"
  | "chained-comparison-not-supported"
  | "unterminated-string"
  | "physical-newline-in-string"
  | "invalid-string-escape";

export interface ScalarExpressionDiagnostic {
  readonly message: string;
  readonly span: ScalarSpan;
  readonly code: ScalarExpressionIssueCode;
}

/**
 * Strictly exclusive success/failure contract:
 * - success: `ast` is non-null, `diagnostics` is empty.
 * - failure: `ast` is `null`, `diagnostics` has exactly one entry.
 *
 * There is no partial/leading-AST-plus-diagnostic case. Partial ASTs and
 * error recovery are out of scope for this parser; a future task can design
 * that explicitly if it turns out to be needed (e.g. for editor tooling).
 */
export interface ScalarExpressionParseResult {
  readonly ast: ScalarExpressionAst | null;
  readonly diagnostics: readonly ScalarExpressionDiagnostic[];
}
