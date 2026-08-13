// Precedence-climbing parser for typed scalar expressions. Builds on
// expressionTokenizer.ts (Task 09-backed literal tokens + this module's own
// operator/paren/@name tokens). Production-unconnected: see
// docs/typed-variables/tasks/14-ts-expression-parser.md.
//
// Fixed precedence, loosest to tightest (docs/typed-variables/plan.md D09):
//   ||  &&  ==/!=  </<=/>/>=  +/-  * /   then unary (!, -, +), then primary.
// This differs from the local numeric parser (src/geometry/numericExpressionParser.ts,
// not imported here), which conflates comparison+equality into a single
// non-chained tier - this parser splits them into two tiers per plan.md, and
// keeps both non-chaining: a second comparison/equality operator applied
// directly to the result of the first (e.g. `1 < 2 < 3`) is rejected with
// `chained-comparison-not-supported` rather than silently producing an AST
// that Task 15's typecheck would always reject anyway. `||`, `&&`, `+`/`-`,
// `*`/`/` all chain left-associatively; unary operators are right-associative
// via recursion.
//
// BINARY_PRECEDENCE_TIERS is the single source of truth for this ordering -
// the generic parseTier() below is the only code that consumes it, so
// precedence/associativity is never redefined elsewhere.

import {
  type ScalarBinaryOperator,
  type ScalarExpressionAst,
  type ScalarExpressionDiagnostic,
  type ScalarExpressionIssueCode,
  type ScalarExpressionParseResult,
  type ScalarSpan,
  type ScalarUnaryOperator
} from "./expressionAst";
import { containsScalarWordOperator, tokenizeScalarExpression, type ScalarExpressionToken } from "./expressionTokenizer";
import type { ScalarLiteralToken } from "./literalScanner";

/**
 * Bounds recursion depth for parenthesis nesting and unary-prefix chains -
 * the two constructs that grow the real call stack proportionally to user
 * input (the fixed 6-tier precedence ladder and same-tier chaining loops do
 * not, so wide flat expressions are unaffected). Kept comfortably below
 * typical JS stack limits: each nested level costs roughly one call through
 * the full tier ladder (~8-9 frames), and this parser may run inside a
 * Tauri-bundled webview whose default stack can be shallower than Node's.
 */
export const MAX_SCALAR_EXPRESSION_DEPTH = 128;

/**
 * Returns whether a property value should be offered to the shared typed
 * expression frontend. Literal-only values remain owned by the normal model
 * lowering path; this predicate only identifies expression-shaped input,
 * including the nui4 word spellings and the migration-era symbolic aliases.
 */
export const isScalarExpressionCandidateSource = (source: string): boolean => {
  const trimmed = source.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) return false;
  if (trimmed.startsWith("@") || trimmed.startsWith("(") || trimmed.startsWith("!")) return true;
  return containsScalarWordOperator(trimmed) || /&&|\|\||==|!=|<=|>=|[<>]/.test(trimmed);
};

class ParseFailure extends Error {
  constructor(readonly diagnostic: ScalarExpressionDiagnostic) {
    super(diagnostic.message);
  }
}

const fail = (code: ScalarExpressionIssueCode, span: ScalarSpan, message: string): never => {
  throw new ParseFailure({ code, span, message });
};

const literalToNode = (literal: ScalarLiteralToken): ScalarExpressionAst => {
  if (literal.kind === "number") return { kind: "numberLiteral", span: literal.span, value: literal.value };
  if (literal.kind === "string") return { kind: "stringLiteral", span: literal.span, value: literal.cooked };
  if (literal.kind === "boolean") return { kind: "booleanLiteral", span: literal.span, value: literal.value };
  return { kind: "unresolvedChoiceLiteral", span: literal.span, raw: literal.raw };
};

// Every ScalarExpressionToken variant carries a span, but "literal" nests
// its own span one level deeper (inside its wrapped ScalarLiteralToken)
// rather than duplicating it - this reads it back out uniformly for the one
// call site (trailing-token detection) that needs a span from an
// un-narrowed token.
const tokenSpan = (token: ScalarExpressionToken): ScalarSpan => (token.kind === "literal" ? token.literal.span : token.span);

const UNARY_OPERATORS: readonly ScalarUnaryOperator[] = ["!", "-", "+"];

interface BinaryTier {
  readonly operators: readonly ScalarBinaryOperator[];
  /** true: left-associative chain (while-loop). false: single application only. */
  readonly chain: boolean;
}

const BINARY_PRECEDENCE_TIERS: readonly BinaryTier[] = [
  { operators: ["||"], chain: true },
  { operators: ["&&"], chain: true },
  { operators: ["==", "!="], chain: false },
  { operators: ["<", "<=", ">", ">="], chain: false },
  { operators: ["+", "-"], chain: true },
  { operators: ["*", "/"], chain: true }
];

type OperatorToken = Extract<ScalarExpressionToken, { kind: "operator" }>;

interface OperatorMatch {
  readonly token: OperatorToken;
  readonly operator: ScalarBinaryOperator;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly ScalarExpressionToken[],
    private readonly boundaryEnd: number
  ) {}

  parse(): ScalarExpressionAst {
    const expression = this.parseTier(0);
    const trailing = this.peek();
    if (trailing) return fail("trailing-token", tokenSpan(trailing), "式の末尾に余分なトークンがあります。");
    return expression;
  }

  private parseTier(tierIndex: number): ScalarExpressionAst {
    if (tierIndex >= BINARY_PRECEDENCE_TIERS.length) return this.parseUnary();

    const tier = BINARY_PRECEDENCE_TIERS[tierIndex];
    let left = this.parseTier(tierIndex + 1);

    for (;;) {
      const match = this.peekBinaryOperator(tier.operators);
      if (!match) return left;

      this.consume();
      const right = this.parseTier(tierIndex + 1);
      left = {
        kind: "binary",
        operator: match.operator,
        span: { start: left.span.start, end: right.span.end },
        left,
        right
      };

      if (!tier.chain) {
        const again = this.peekBinaryOperator(tier.operators);
        if (again) {
          return fail(
            "chained-comparison-not-supported",
            again.token.span,
            "比較・equality演算子は連続して適用できません。括弧で明示してください。"
          );
        }
        return left;
      }
    }
  }

  private parseUnary(): ScalarExpressionAst {
    const token = this.peek();
    if (token?.kind === "operator" && (UNARY_OPERATORS as readonly string[]).includes(token.value)) {
      this.enterNesting(token.span);
      this.consume();
      const operand = this.parseUnary();
      this.depth -= 1;
      return {
        kind: "unary",
        operator: token.value as ScalarUnaryOperator,
        span: { start: token.span.start, end: operand.span.end },
        operand
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ScalarExpressionAst {
    const token = this.peek();
    if (!token) return fail("missing-operand", { start: this.boundaryEnd, end: this.boundaryEnd }, "式が必要です。");

    if (token.kind === "literal") {
      this.consume();
      return literalToNode(token.literal);
    }

    if (token.kind === "reference") {
      this.consume();
      return { kind: "reference", span: token.span, nameSpan: token.nameSpan, name: token.name };
    }

    if (token.kind === "geometryProperty") {
      this.consume();
      return { kind: "geometryProperty", span: token.span, elementNameSpan: token.elementNameSpan, propertySpan: token.propertySpan, elementName: token.elementName, property: token.property };
    }

    if (token.kind === "leftParen") {
      this.enterNesting(token.span);
      this.consume();
      const expression = this.parseTier(0);
      const closing = this.peek();
      if (!closing || closing.kind !== "rightParen") {
        return fail("unterminated-group", token.span, "閉じ括弧 ')' がありません。");
      }
      this.consume();
      this.depth -= 1;
      return { kind: "group", span: { start: token.span.start, end: closing.span.end }, expression };
    }

    return fail("missing-operand", token.span, "式が必要です。");
  }

  private enterNesting(span: ScalarSpan): void {
    this.depth += 1;
    if (this.depth > MAX_SCALAR_EXPRESSION_DEPTH) {
      fail("expression-depth-exceeded", span, `式のネストが深すぎます(上限 ${MAX_SCALAR_EXPRESSION_DEPTH})。`);
    }
  }

  private peek(): ScalarExpressionToken | undefined {
    return this.tokens[this.index];
  }

  private peekBinaryOperator(operators: readonly ScalarBinaryOperator[]): OperatorMatch | undefined {
    const token = this.peek();
    if (token?.kind !== "operator") return undefined;
    const operator = operators.find((candidate) => candidate === token.value);
    return operator ? { token, operator } : undefined;
  }

  private consume(): ScalarExpressionToken {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}

/**
 * Parses exactly the range `[span.start, span.end)` of `source` as a typed
 * scalar expression. Mirrors scanScalarLiteral's absolute-offset convention:
 * a future caller passes the full statement/document text plus the
 * initializer's span (e.g. `parseScalarExpression(logicalText, declaration.payloadSpans.initializer)`).
 *
 * Strictly exclusive result: on success `ast` is non-null and `diagnostics`
 * is empty; on any failure `ast` is `null` and `diagnostics` has exactly one
 * entry. There is no partial-AST-plus-diagnostic case - error recovery is
 * out of scope for this parser.
 */
export const parseScalarExpression = (source: string, span: ScalarSpan): ScalarExpressionParseResult => {
  const tokenized = tokenizeScalarExpression(source, span);
  if (tokenized.error) {
    const { code, span: errorSpan, message } = tokenized.error;
    return { ast: null, diagnostics: [{ code, span: errorSpan, message }] };
  }

  try {
    const ast = new Parser(tokenized.tokens, span.end).parse();
    return { ast, diagnostics: [] };
  } catch (error) {
    if (error instanceof ParseFailure) return { ast: null, diagnostics: [error.diagnostic] };
    throw error;
  }
};
