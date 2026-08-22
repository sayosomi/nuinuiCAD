import type { ScalarBinaryOperator, ScalarSpan, ScalarUnaryOperator } from "./expressionAst";
import { evaluateTypedExpression, type ScalarEvaluationEnvironment } from "./expressionEvaluator";
import { parseScalarEvaluationJson, parseScalarValueJson } from "./scalarJson";
import type { ScalarEvaluation, ScalarValue } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";

export type ConditionEvaluationTraceChildRole = "operand" | "left" | "right" | "expression" | "argument";

export type ConditionEvaluationTraceChild = {
  role: ConditionEvaluationTraceChildRole;
  nodeIndex: number;
  argumentIndex?: number;
};

export type ConditionEvaluationTraceNode = {
  kind: TypedScalarExpression["kind"];
  span: ScalarSpan;
  evaluation: ScalarEvaluation;
  children: ConditionEvaluationTraceChild[];
  operator?: ScalarUnaryOperator | ScalarBinaryOperator;
  comparisonOperands?: {
    left?: ScalarValue;
    right?: ScalarValue;
  };
};

/**
 * Flat, post-order condition trace. Child indices always point backward into
 * `nodes`, so deeply left-nested expressions retain the evaluator's bounded
 * native stack behavior instead of constructing a second recursive tree.
 * Short-circuited children have no node and therefore no edge.
 */
export type ConditionEvaluationTrace = {
  rootNodeIndex: number;
  finalEvaluation: ScalarEvaluation;
  nodes: ConditionEvaluationTraceNode[];
};

type TraceEnvironment = Omit<ScalarEvaluationEnvironment, "onExpressionEvaluated">;

const COMPARISON_OPERATORS = new Set<ScalarBinaryOperator>(["==", "!=", "<", "<=", ">", ">="]);

const reachedChild = (
  nodeIndexByNode: WeakMap<TypedScalarExpression, number>,
  role: ConditionEvaluationTraceChildRole,
  child: TypedScalarExpression,
  argumentIndex?: number
): ConditionEvaluationTraceChild | undefined => {
  const nodeIndex = nodeIndexByNode.get(child);
  if (nodeIndex === undefined) return undefined;
  return {
    role,
    nodeIndex,
    ...(argumentIndex !== undefined ? { argumentIndex } : {})
  };
};

const childrenForNode = (
  node: TypedScalarExpression,
  nodeIndexByNode: WeakMap<TypedScalarExpression, number>
): ConditionEvaluationTraceChild[] => {
  switch (node.kind) {
    case "unary":
      return [reachedChild(nodeIndexByNode, "operand", node.operand)].filter(
        (child): child is ConditionEvaluationTraceChild => child !== undefined
      );
    case "binary":
      return [
        reachedChild(nodeIndexByNode, "left", node.left),
        reachedChild(nodeIndexByNode, "right", node.right)
      ].filter((child): child is ConditionEvaluationTraceChild => child !== undefined);
    case "group":
      return [reachedChild(nodeIndexByNode, "expression", node.expression)].filter(
        (child): child is ConditionEvaluationTraceChild => child !== undefined
      );
    case "call":
      return node.args.flatMap((argument, argumentIndex) => {
        if (argument.kind !== "scalar") return [];
        const child = reachedChild(nodeIndexByNode, "argument", argument.expression, argumentIndex);
        return child ? [child] : [];
      });
    default:
      return [];
  }
};

const comparisonOperandsForNode = (
  node: TypedScalarExpression,
  evaluationByNode: WeakMap<TypedScalarExpression, ScalarEvaluation>
): ConditionEvaluationTraceNode["comparisonOperands"] => {
  if (node.kind !== "binary" || !COMPARISON_OPERATORS.has(node.operator)) return undefined;
  const left = evaluationByNode.get(node.left);
  const right = evaluationByNode.get(node.right);
  const operands = {
    ...(left?.status === "ok" ? { left: left.value } : {}),
    ...(right?.status === "ok" ? { right: right.value } : {})
  };
  return Object.keys(operands).length > 0 ? operands : undefined;
};

/**
 * Evaluates through the production typed-expression evaluator exactly once
 * while observing only nodes that evaluator actually reaches.
 */
export const evaluateConditionExpressionWithTrace = (
  expression: TypedScalarExpression,
  environment: TraceEnvironment
): { evaluation: ScalarEvaluation; trace: ConditionEvaluationTrace } => {
  const nodeIndexByNode = new WeakMap<TypedScalarExpression, number>();
  const evaluationByNode = new WeakMap<TypedScalarExpression, ScalarEvaluation>();
  const nodes: ConditionEvaluationTraceNode[] = [];

  const evaluation = evaluateTypedExpression(expression, {
    ...environment,
    onExpressionEvaluated: (node, nodeEvaluation) => {
      const comparisonOperands = comparisonOperandsForNode(node, evaluationByNode);
      const traceNode: ConditionEvaluationTraceNode = {
        kind: node.kind,
        span: node.span,
        evaluation: nodeEvaluation,
        children: childrenForNode(node, nodeIndexByNode),
        ...(node.kind === "unary" || node.kind === "binary" ? { operator: node.operator } : {}),
        ...(comparisonOperands ? { comparisonOperands } : {})
      };
      const nodeIndex = nodes.length;
      nodes.push(traceNode);
      nodeIndexByNode.set(node, nodeIndex);
      evaluationByNode.set(node, nodeEvaluation);
    }
  });

  const rootNodeIndex = nodeIndexByNode.get(expression);
  if (rootNodeIndex === undefined) {
    throw new Error("condition trace observer did not receive the root expression");
  }
  return {
    evaluation,
    trace: { rootNodeIndex, finalEvaluation: evaluation, nodes }
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const failTrace = (message: string): never => {
  throw new Error(`invalid condition evaluation trace: ${message}`);
};

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], context: string) => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) failTrace(`${context} has unexpected field ${key}`);
  }
};

const NODE_KINDS = new Set<TypedScalarExpression["kind"]>([
  "numberLiteral",
  "stringLiteral",
  "booleanLiteral",
  "choiceLiteral",
  "reference",
  "geometryProperty",
  "unary",
  "binary",
  "group",
  "call"
]);
const CHILD_ROLES = new Set<ConditionEvaluationTraceChildRole>(["operand", "left", "right", "expression", "argument"]);
const UNARY_OPERATORS = new Set<ScalarUnaryOperator>(["!", "+", "-"]);
const BINARY_OPERATORS = new Set<ScalarBinaryOperator>([
  "||", "&&", "==", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%", "^"
]);

const parseSpan = (value: unknown, context: string): ScalarSpan => {
  if (!isPlainObject(value)) return failTrace(`${context} span must be an object`);
  exactKeys(value, ["start", "end"], `${context} span`);
  if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || (value.start as number) < 0 || (value.end as number) < (value.start as number)) {
    return failTrace(`${context} span must contain ordered non-negative integer offsets`);
  }
  return { start: value.start as number, end: value.end as number };
};

const parseChild = (value: unknown, currentIndex: number, context: string): ConditionEvaluationTraceChild => {
  if (!isPlainObject(value)) return failTrace(`${context} child must be an object`);
  exactKeys(value, ["role", "nodeIndex", "argumentIndex"], `${context} child`);
  if (typeof value.role !== "string" || !CHILD_ROLES.has(value.role as ConditionEvaluationTraceChildRole)) {
    return failTrace(`${context} child has invalid role`);
  }
  if (!Number.isInteger(value.nodeIndex) || (value.nodeIndex as number) < 0 || (value.nodeIndex as number) >= currentIndex) {
    return failTrace(`${context} child must reference an earlier trace node`);
  }
  if (value.role === "argument") {
    if (!Number.isInteger(value.argumentIndex) || (value.argumentIndex as number) < 0) {
      return failTrace(`${context} argument child requires a non-negative argumentIndex`);
    }
  } else if (value.argumentIndex !== undefined) {
    return failTrace(`${context} non-argument child cannot carry argumentIndex`);
  }
  return {
    role: value.role as ConditionEvaluationTraceChildRole,
    nodeIndex: value.nodeIndex as number,
    ...(value.argumentIndex !== undefined ? { argumentIndex: value.argumentIndex as number } : {})
  };
};

const parseComparisonOperands = (value: unknown, context: string): NonNullable<ConditionEvaluationTraceNode["comparisonOperands"]> => {
  if (!isPlainObject(value)) return failTrace(`${context} comparisonOperands must be an object`);
  exactKeys(value, ["left", "right"], `${context} comparisonOperands`);
  if (value.left === undefined && value.right === undefined) return failTrace(`${context} comparisonOperands cannot be empty`);
  return {
    ...(value.left !== undefined ? { left: parseScalarValueJson(value.left) } : {}),
    ...(value.right !== undefined ? { right: parseScalarValueJson(value.right) } : {})
  };
};

export const parseConditionEvaluationTraceJson = (value: unknown): ConditionEvaluationTrace => {
  if (!isPlainObject(value)) return failTrace("trace must be an object");
  exactKeys(value, ["rootNodeIndex", "finalEvaluation", "nodes"], "trace");
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) return failTrace("nodes must be a non-empty array");

  const nodes = value.nodes.map((rawNode, nodeIndex): ConditionEvaluationTraceNode => {
    if (!isPlainObject(rawNode)) return failTrace(`node ${nodeIndex} must be an object`);
    exactKeys(rawNode, ["kind", "span", "evaluation", "children", "operator", "comparisonOperands"], `node ${nodeIndex}`);
    if (typeof rawNode.kind !== "string" || !NODE_KINDS.has(rawNode.kind as TypedScalarExpression["kind"])) {
      return failTrace(`node ${nodeIndex} has invalid kind`);
    }
    if (!Array.isArray(rawNode.children)) return failTrace(`node ${nodeIndex} children must be an array`);
    const kind = rawNode.kind as TypedScalarExpression["kind"];
    let operator: ScalarUnaryOperator | ScalarBinaryOperator | undefined;
    if (kind === "unary") {
      if (typeof rawNode.operator !== "string" || !UNARY_OPERATORS.has(rawNode.operator as ScalarUnaryOperator)) {
        return failTrace(`node ${nodeIndex} has invalid unary operator`);
      }
      operator = rawNode.operator as ScalarUnaryOperator;
    } else if (kind === "binary") {
      if (typeof rawNode.operator !== "string" || !BINARY_OPERATORS.has(rawNode.operator as ScalarBinaryOperator)) {
        return failTrace(`node ${nodeIndex} has invalid binary operator`);
      }
      operator = rawNode.operator as ScalarBinaryOperator;
    } else if (rawNode.operator !== undefined) {
      return failTrace(`node ${nodeIndex} cannot carry operator`);
    }
    if (rawNode.comparisonOperands !== undefined &&
      (kind !== "binary" || operator === undefined || !COMPARISON_OPERATORS.has(operator as ScalarBinaryOperator))) {
      return failTrace(`node ${nodeIndex} comparisonOperands requires a comparison operator`);
    }
    return {
      kind,
      span: parseSpan(rawNode.span, `node ${nodeIndex}`),
      evaluation: parseScalarEvaluationJson(rawNode.evaluation),
      children: rawNode.children.map((child) => parseChild(child, nodeIndex, `node ${nodeIndex}`)),
      ...(operator !== undefined ? { operator } : {}),
      ...(rawNode.comparisonOperands !== undefined
        ? { comparisonOperands: parseComparisonOperands(rawNode.comparisonOperands, `node ${nodeIndex}`) }
        : {})
    };
  });

  if (!Number.isInteger(value.rootNodeIndex) || value.rootNodeIndex !== nodes.length - 1) {
    return failTrace("rootNodeIndex must reference the final post-order node");
  }
  const finalEvaluation = parseScalarEvaluationJson(value.finalEvaluation);
  if (JSON.stringify(finalEvaluation) !== JSON.stringify(nodes[value.rootNodeIndex as number]!.evaluation)) {
    return failTrace("finalEvaluation must match the root node evaluation");
  }
  return { rootNodeIndex: value.rootNodeIndex as number, finalEvaluation, nodes };
};
