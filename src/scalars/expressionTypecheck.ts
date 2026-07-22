// Static typechecker for typed scalar expressions. Consumes a parsed
// ScalarExpressionAst (Task 14) plus already-resolved BindingResolution
// values (Task 12) and produces a typed AST with per-node types, resolved
// choice literals, and reference binding IDs. Production-unconnected: see
// docs/typed-variables/tasks/15-ts-expression-typechecker.md.
//
// This module never re-resolves a binding name and never re-derives Task
// 13's cross-binding diagnostics (undefined/forward/self/duplicate/cycle):
// it only reacts to the BindingResolution it is handed, marking a node
// invalid (`type: null`) without adding a new diagnostic when that
// resolution isn't "resolved", or when it resolves to a typed binding whose
// declaredType is itself null (a malformed type annotation Task 10 already
// diagnosed). Every other type-vs-type comparison goes through
// isScalarTypeAssignable - an exact match (D01/D07) - never the property
// choice-subset rule, which is Task 22's concern only.

import {
  type ScalarBinaryExpressionNode,
  type ScalarExpressionAst
} from "./expressionAst";
import type { BindingResolution } from "./bindingResolution";
import type {
  ScalarExpressionTypecheckContext,
  ScalarExpressionTypecheckDiagnostic,
  ScalarExpressionTypecheckResult,
  TypedScalarExpression
} from "./typedExpressionAst";
import { isChoiceOptionMember, isScalarTypeAssignable } from "./scalarAssignability";
import { isChoiceScalarType, type ChoiceScalarType, type ScalarType } from "./types";

const NUMBER_TYPE: Extract<ScalarType, { kind: "number" }> = { kind: "number" };
const BOOLEAN_TYPE: Extract<ScalarType, { kind: "boolean" }> = { kind: "boolean" };

interface TraversalState {
  readonly references: readonly BindingResolution[];
  cursor: number;
  readonly diagnostics: ScalarExpressionTypecheckDiagnostic[];
}

const describeScalarType = (type: ScalarType): string =>
  type.kind === "choice" ? `choice(${type.options.join(", ")})` : type.kind;

const addDiagnostic = (state: TraversalState, diagnostic: ScalarExpressionTypecheckDiagnostic): void => {
  state.diagnostics.push(diagnostic);
};

const nextReferenceResolution = (
  state: TraversalState,
  name: string,
  offset: number
): BindingResolution => {
  if (state.cursor >= state.references.length) {
    throw new Error(`expressionTypecheck: no BindingResolution supplied for reference "@${name}" at offset ${offset}`);
  }
  const resolution = state.references[state.cursor];
  state.cursor += 1;
  return resolution;
};

/**
 * Shared operand-vs-required-kind check for unary and non-equality binary
 * operators. A null operand type (already invalid - unresolved reference or
 * an already-mismatched subexpression) is silently treated as "not ok"
 * without adding a diagnostic - this is the cascade-suppression rule: one
 * root cause, not a diagnostic per ancestor.
 */
const checkOperandType = (state: TraversalState, operand: TypedScalarExpression, requiredType: ScalarType): boolean => {
  if (operand.type === null) return false;
  if (isScalarTypeAssignable(operand.type, requiredType)) return true;
  addDiagnostic(state, {
    code: "scalar-type-mismatch",
    span: operand.span,
    message: `型が一致しません(期待: ${describeScalarType(requiredType)}, 実際: ${describeScalarType(operand.type)})。`,
    expectedType: requiredType,
    actualType: operand.type
  });
  return false;
};

type SimpleBinaryOperator = Exclude<ScalarBinaryExpressionNode["operator"], "==" | "!=">;

const SIMPLE_BINARY_RULES: Record<SimpleBinaryOperator, { requiredType: ScalarType; resultType: ScalarType }> = {
  "+": { requiredType: NUMBER_TYPE, resultType: NUMBER_TYPE },
  "-": { requiredType: NUMBER_TYPE, resultType: NUMBER_TYPE },
  "*": { requiredType: NUMBER_TYPE, resultType: NUMBER_TYPE },
  "/": { requiredType: NUMBER_TYPE, resultType: NUMBER_TYPE },
  "<": { requiredType: NUMBER_TYPE, resultType: BOOLEAN_TYPE },
  "<=": { requiredType: NUMBER_TYPE, resultType: BOOLEAN_TYPE },
  ">": { requiredType: NUMBER_TYPE, resultType: BOOLEAN_TYPE },
  ">=": { requiredType: NUMBER_TYPE, resultType: BOOLEAN_TYPE },
  "&&": { requiredType: BOOLEAN_TYPE, resultType: BOOLEAN_TYPE },
  "||": { requiredType: BOOLEAN_TYPE, resultType: BOOLEAN_TYPE }
};

/** Non-null only when `type` is a concrete choice type - used as an
 * equality-operand hint for a bare choice literal on the opposite side. */
const choiceHint = (type: ScalarType | null): ScalarType | null => (type !== null && isChoiceScalarType(type) ? type : null);

/**
 * `==`/`!=` typecheck. When exactly one side is a bare (unresolved) choice
 * literal, the *other* side is checked first so its resolved type can hint
 * the literal - safe because a bare choice literal is always a leaf with no
 * `reference` descendants, so reordering it never perturbs the reference
 * cursor for the rest of the tree. `left`/`right` below are always assigned
 * to match the original AST positions regardless of evaluation order.
 */
const checkEqualityBinary = (
  node: ScalarBinaryExpressionNode,
  state: TraversalState,
  checkNode: (node: ScalarExpressionAst, expectedType: ScalarType | null, state: TraversalState) => TypedScalarExpression
): TypedScalarExpression => {
  const leftIsBareChoice = node.left.kind === "unresolvedChoiceLiteral";
  const rightIsBareChoice = node.right.kind === "unresolvedChoiceLiteral";

  let left: TypedScalarExpression;
  let right: TypedScalarExpression;
  if (leftIsBareChoice && !rightIsBareChoice) {
    right = checkNode(node.right, null, state);
    left = checkNode(node.left, choiceHint(right.type), state);
  } else if (rightIsBareChoice && !leftIsBareChoice) {
    left = checkNode(node.left, null, state);
    right = checkNode(node.right, choiceHint(left.type), state);
  } else {
    left = checkNode(node.left, null, state);
    right = checkNode(node.right, null, state);
  }

  let type: ScalarType | null = null;
  if (left.type !== null && right.type !== null) {
    if (isScalarTypeAssignable(left.type, right.type)) {
      type = BOOLEAN_TYPE;
    } else {
      addDiagnostic(state, {
        code: "scalar-type-mismatch",
        span: node.span,
        message: `equality演算子の両辺の型が一致しません(${describeScalarType(left.type)} vs ${describeScalarType(right.type)})。`,
        expectedType: left.type,
        actualType: right.type
      });
    }
  }
  return { kind: "binary", span: node.span, operator: node.operator, left, right, type };
};

const checkNode = (
  node: ScalarExpressionAst,
  expectedType: ScalarType | null,
  state: TraversalState
): TypedScalarExpression => {
  switch (node.kind) {
    case "numberLiteral":
      return { kind: "numberLiteral", span: node.span, value: node.value, type: NUMBER_TYPE };

    case "stringLiteral":
      return { kind: "stringLiteral", span: node.span, value: node.value, type: { kind: "string" } };

    case "booleanLiteral":
      return { kind: "booleanLiteral", span: node.span, value: node.value, type: BOOLEAN_TYPE };

    case "unresolvedChoiceLiteral": {
      if (expectedType !== null && isChoiceScalarType(expectedType) && isChoiceOptionMember(expectedType, node.raw)) {
        return { kind: "choiceLiteral", span: node.span, value: node.raw, type: expectedType };
      }
      const choiceHintType: ChoiceScalarType | null =
        expectedType !== null && isChoiceScalarType(expectedType) ? expectedType : null;
      addDiagnostic(state, {
        code: "invalid-choice-literal",
        span: node.span,
        message:
          choiceHintType !== null
            ? `choice literal "${node.raw}" はchoice(${choiceHintType.options.join(", ")})の要素ではありません。`
            : `choice literal "${node.raw}" を解決できるchoice型の文脈がありません。`,
        ...(choiceHintType !== null ? { expectedType: choiceHintType } : {})
      });
      return { kind: "choiceLiteral", span: node.span, value: node.raw, type: null };
    }

    case "reference": {
      const resolution = nextReferenceResolution(state, node.name, node.span.start);
      if (resolution.kind !== "resolved") {
        return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: null, type: null };
      }
      const binding = resolution.binding;
      const type = binding.kind === "typed" ? binding.declaredType : (binding.declaredType ?? NUMBER_TYPE);
      return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: binding.id, type };
    }

    case "unary": {
      const requiredType = node.operator === "!" ? BOOLEAN_TYPE : NUMBER_TYPE;
      const operand = checkNode(node.operand, null, state);
      const ok = checkOperandType(state, operand, requiredType);
      return { kind: "unary", span: node.span, operator: node.operator, operand, type: ok ? requiredType : null };
    }

    case "binary": {
      if (node.operator === "==" || node.operator === "!=") return checkEqualityBinary(node, state, checkNode);
      const rule = SIMPLE_BINARY_RULES[node.operator as SimpleBinaryOperator];
      const left = checkNode(node.left, null, state);
      const right = checkNode(node.right, null, state);
      const leftOk = checkOperandType(state, left, rule.requiredType);
      const rightOk = checkOperandType(state, right, rule.requiredType);
      return { kind: "binary", span: node.span, operator: node.operator, left, right, type: leftOk && rightOk ? rule.resultType : null };
    }

    case "group": {
      const expression = checkNode(node.expression, expectedType, state);
      return { kind: "group", span: node.span, expression, type: expression.type };
    }
  }
};

export const typecheckScalarExpression = (
  ast: ScalarExpressionAst,
  context: ScalarExpressionTypecheckContext
): ScalarExpressionTypecheckResult => {
  const state: TraversalState = { references: context.references, cursor: 0, diagnostics: [] };
  const typed = checkNode(ast, context.expectedType, state);
  if (state.cursor !== state.references.length) {
    throw new Error(
      `expressionTypecheck: ${state.references.length - state.cursor} unconsumed reference resolution(s) supplied to typecheckScalarExpression`
    );
  }

  let type = typed.type;
  if (type !== null && context.expectedType !== null && !isScalarTypeAssignable(type, context.expectedType)) {
    state.diagnostics.push({
      code: "scalar-type-mismatch",
      span: ast.span,
      message: `宣言された型と一致しません(期待: ${describeScalarType(context.expectedType)}, 実際: ${describeScalarType(type)})。`,
      expectedType: context.expectedType,
      actualType: type
    });
    type = null;
  }

  return { typed, diagnostics: state.diagnostics, type };
};
