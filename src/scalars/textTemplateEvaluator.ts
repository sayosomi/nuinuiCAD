// Task 27: evaluates Task 26's compiled TextTemplateAst by walking its
// already-scanned/typechecked segments - never re-scans || re-parses the raw
// template source. Geometry-agnostic: numeric-expression holes && number formatting are
// injected by the caller (src/geometry/textTemplateRuntime.ts) so this module
// never imports anything geometry-specific, per plan.md's src/scalars/ file
// organization policy.

import type { ScalarSpan } from "./literalScanner";
import type { TextTemplateAst } from "./textTemplate";
import { evaluateTypedExpression, type ScalarEvaluationEnvironment } from "./expressionEvaluator";

export type EvaluateNumericExpressionHoleResult =
  | { ok: true; text: string }
  | { ok: false; message: string; dependencyId?: string; dependencyName?: string };

/** Evaluates one numeric-expression hole's raw content (the existing numeric-expression
 * grammar, untouched) - the caller supplies this so this module never
 * depends on geometry state. */
export type EvaluateNumericExpressionHole = (raw: string) => EvaluateNumericExpressionHoleResult;

export type TextTemplateEvaluationError = {
  readonly holeSpan: ScalarSpan;
  readonly origin: "numeric" | "typed";
  readonly message: string;
  readonly dependencyId?: string;
  readonly dependencyName?: string;
};

export type TextTemplateEvaluationResult =
  | { status: "ok"; text: string }
  | { status: "error"; error: TextTemplateEvaluationError };

const typedHoleError = (
  holeSpan: ScalarSpan,
  message: string,
  bindingId?: string
): TextTemplateEvaluationResult => ({
  status: "error",
  error: { holeSpan, origin: "typed", message, dependencyId: bindingId }
});

/**
 * Evaluates a compiled template against a scalar binding environment (Task
 * 16), a numeric-expression-hole callback, && a number formatter. Fails closed on the
 * first failing hole in source order - a deliberate simplification of the
 * old regex evaluator's "last error overwrites firstError" quirk, only
 * observable when multiple holes in one string fail simultaneously.
 */
export const evaluateTextTemplate = (
  ast: TextTemplateAst,
  scalarEnvironment: ScalarEvaluationEnvironment,
  evaluateNumericExpressionHole: EvaluateNumericExpressionHole,
  formatNumber: (value: number) => string
): TextTemplateEvaluationResult => {
  let text = "";

  for (const segment of ast.segments) {
    if (segment.kind === "literal") {
      text += segment.cooked;
      continue;
    }

    if (segment.holeKind === "numeric") {
      const result = evaluateNumericExpressionHole(segment.raw);
      if (!result.ok) {
        return {
          status: "error",
          error: {
            holeSpan: segment.span,
            origin: "numeric",
            message: result.message,
            dependencyId: result.dependencyId,
            dependencyName: result.dependencyName
          }
        };
      }
      text += result.text;
      continue;
    }

    const evaluation = evaluateTypedExpression(segment.expression, scalarEnvironment);
    if (evaluation.status !== "ok") {
      return typedHoleError(
        segment.span,
        `テキスト埋め込みに紐づく変数の評価に失敗しました(${evaluation.issueCode})。`,
        evaluation.bindingId
      );
    }

    if (segment.holeKind === "string") {
      if (evaluation.value.kind !== "string") {
        return typedHoleError(segment.span, "テキスト埋め込みの値がstring型ではありません。");
      }
      text += evaluation.value.value;
      continue;
    }

    if (evaluation.value.kind !== "number") {
      return typedHoleError(segment.span, "テキスト埋め込みの値がnumber型ではありません。");
    }
    text += formatNumber(evaluation.value.value);
  }

  return { status: "ok", text };
};
