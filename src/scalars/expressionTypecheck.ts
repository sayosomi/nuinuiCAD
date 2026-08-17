// Static typechecker for typed scalar expressions. Consumes a parsed
// ScalarExpressionAst plus already-resolved BindingResolution values &&
// produces a typed AST with per-node types, resolved choice literals, &&
// reference binding IDs.
//
// This module never re-resolves a binding name && never re-derives the
// cross-binding diagnostics (undefined/forward/self/duplicate/cycle):
// it only reacts to the BindingResolution it is handed, marking a node
// invalid (`type: null`) without adding a new diagnostic when that
// resolution isn't "resolved", || when it resolves to a typed binding whose
// declaredType is itself null (a malformed type annotation already diagnosed).
// Every other type-vs-type comparison goes through isScalarTypeAssignable - an
// exact match - never the property choice-subset rule used by property binding.

import {
  type ScalarBinaryExpressionNode,
  type ScalarExpressionAst
} from "./expressionAst";
import type { BindingResolution } from "./bindingResolution";
import {
  formatBuiltinCallingStyleMismatch,
  getBuiltinFunctionDefinition,
  isScalarBuiltinParameterType
} from "./builtinFunctions";
import type {
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedReference,
  ScalarExpressionTypecheckContext,
  ScalarExpressionTypecheckDiagnostic,
  ScalarExpressionTypecheckResult,
  TypedBuiltinArgument,
  TypedScalarExpression
} from "./typedExpressionAst";
import { isChoiceOptionMember, isScalarTypeAssignable } from "./scalarAssignability";
import { isChoiceScalarType, type ChoiceScalarType, type ScalarType } from "./types";
import { isModuleGeometryInterfaceAssignable } from "../dsl/moduleGeometryInterfaces";

const NUMBER_TYPE: Extract<ScalarType, { kind: "number" }> = { kind: "number" };
const BOOLEAN_TYPE: Extract<ScalarType, { kind: "boolean" }> = { kind: "boolean" };

interface TraversalState {
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  readonly geometryBuiltinArguments?: ReadonlyMap<number, ScalarExpressionResolvedGeometryTarget | null>;
  cursor: number;
  readonly diagnostics: ScalarExpressionTypecheckDiagnostic[];
  readonly resolveChoiceLiteral?: ScalarExpressionTypecheckContext["resolveChoiceLiteral"];
}

type ScalarCallArgumentStyle = "positional" | "named" | "mixed";

const scalarCallArgumentStyle = (args: readonly { kind: "positional" | "named" }[]): ScalarCallArgumentStyle => {
  const hasPositional = args.some((argument) => argument.kind === "positional");
  const hasNamed = args.some((argument) => argument.kind === "named");
  return hasPositional && hasNamed ? "mixed" : hasNamed ? "named" : "positional";
};

/** Exported for reuse by other diagnostic-message producers (e.g. the
 * property binding compiler) that need the same type description text -
 * kept as one implementation rather than a duplicated formatter. */
export const describeScalarType = (type: ScalarType): string =>
  type.kind === "choice" ? `choice(${type.options.join(", ")})` : type.kind;

const addDiagnostic = (state: TraversalState, diagnostic: ScalarExpressionTypecheckDiagnostic): void => {
  state.diagnostics.push(diagnostic);
};

const nextReferenceResolution = (
  state: TraversalState,
  name: string,
  offset: number
): BindingResolution | ScalarExpressionResolvedReference => {
  if (state.cursor >= state.references.length) {
    throw new Error(`expressionTypecheck: no BindingResolution supplied for reference "@${name}" at offset ${offset}`);
  }
  const resolution = state.references[state.cursor];
  state.cursor += 1;
  return resolution;
};

/**
 * Shared operand-vs-required-kind check for unary && non-equality binary
 * operators. A null operand type (already invalid - unresolved reference ||
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
  "%": { requiredType: NUMBER_TYPE, resultType: NUMBER_TYPE },
  "^": { requiredType: NUMBER_TYPE, resultType: NUMBER_TYPE },
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
      const resolvedByFrontend = state.resolveChoiceLiteral?.(node.raw, expectedType, node.span);
      if (resolvedByFrontend !== undefined) {
        if (resolvedByFrontend !== null) {
          return { kind: "choiceLiteral", span: node.span, value: node.raw, type: resolvedByFrontend.kind === "choice" ? resolvedByFrontend : null };
        }
        return { kind: "choiceLiteral", span: node.span, value: node.raw, type: null };
      }
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
      if (resolution.kind === "resolvedGeometry") {
        return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: null, type: null };
      }
      if (resolution.kind === "resolvedType") {
        return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: resolution.bindingId, type: resolution.type };
      }
      if (resolution.kind !== "resolved") {
        return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: null, type: null };
      }
      const binding = resolution.binding;
      const type = binding.kind === "typed" ? binding.declaredType : (binding.declaredType ?? NUMBER_TYPE);
      return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: binding.id, type };
    }

    case "geometryProperty":
      return {
        kind: "geometryProperty",
        span: node.span,
        elementNameSpan: node.elementNameSpan,
        propertySpan: node.propertySpan,
        elementName: node.elementName,
        elementId: null,
        property: node.property,
        targetSourceOrder: null,
        type: NUMBER_TYPE
      };

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

    case "call": {
      const definition = getBuiltinFunctionDefinition(node.name);
      if (definition === null) {
        const args: TypedBuiltinArgument[] = node.args.map((arg) => ({ kind: "scalar", expression: checkNode(arg.expression, null, state) }));
        addDiagnostic(state, {
          code: "unknown-function",
          span: node.nameSpan,
          message: `未知の組み込み関数「${node.name}」です。`
        });
        return { kind: "call", span: node.span, nameSpan: node.nameSpan, name: node.name, target: null, args, type: null };
      }

      const sourceStyle = scalarCallArgumentStyle(node.args);
      const hasNamedSignature = definition.signatures.some((candidate) => candidate.callingStyle === "named");
      const effectiveStyle = node.args.length === 0 && hasNamedSignature ? "named" : sourceStyle;
      const positionalRecoverySignature = definition.signatures.find((candidate) => candidate.callingStyle === "positional");
      const recoverInvalidCallArguments = (): TypedBuiltinArgument[] => node.args.map((arg, argumentIndex) => {
        const parameterType = positionalRecoverySignature?.parameters[argumentIndex]?.type;
        const sourceArgument = arg.expression;
        if (
          arg.kind === "positional" &&
          (parameterType === "point" || parameterType === "line")
        ) {
          if (sourceArgument.kind === "reference") {
            const resolution = nextReferenceResolution(state, sourceArgument.name, sourceArgument.span.start);
            return {
              kind: "geometryReference",
              expectedGeometryType: parameterType,
              target: resolution.kind === "resolvedGeometry" ? resolution.target : null
            };
          }
          if (sourceArgument.kind === "geometryProperty" && parameterType === "point") {
            return {
              kind: "geometryReference",
              expectedGeometryType: parameterType,
              target: state.geometryBuiltinArguments?.get(sourceArgument.span.start) ?? null
            };
          }
          checkNode(sourceArgument, null, state);
          return { kind: "geometryReference", expectedGeometryType: parameterType, target: null };
        }
        return { kind: "scalar", expression: checkNode(sourceArgument, null, state) };
      });
      const styleMatches = effectiveStyle !== "mixed" && definition.signatures.some((candidate) => candidate.callingStyle === effectiveStyle);
      if (!styleMatches) {
        const args = recoverInvalidCallArguments();
        addDiagnostic(state, {
          code: "function-call-style-mismatch",
          span: node.nameSpan,
          message: formatBuiltinCallingStyleMismatch(definition)
        });
        return {
          kind: "call",
          span: node.span,
          nameSpan: node.nameSpan,
          name: node.name,
          target: { kind: "builtin", name: definition.name },
          args,
          type: null
        };
      }

      const signature = effectiveStyle === "named"
        ? definition.signatures.find((candidate) => candidate.callingStyle === "named")
        : definition.signatures.find((candidate) => candidate.callingStyle === "positional" && candidate.parameters.length === node.args.length);
      if (signature === undefined) {
        const acceptedArities = definition.signatures
          .filter((candidate) => candidate.callingStyle === "positional")
          .map((candidate) => candidate.parameters.length);
        const arityText = acceptedArities.length === 1 ? `${acceptedArities[0]}` : acceptedArities.join("または");
        const args = recoverInvalidCallArguments();
        addDiagnostic(state, {
          code: "function-arity-mismatch",
          span: node.nameSpan,
          message: `組み込み関数「${node.name}」の引数の数が一致しません(期待: ${arityText}, 実際: ${args.length})。`
        });
        return {
          kind: "call",
          span: node.span,
          nameSpan: node.nameSpan,
          name: node.name,
          target: { kind: "builtin", name: definition.name },
          args,
          type: null
        };
      }

      if (signature.callingStyle === "named") {
        const sourceArgs: TypedBuiltinArgument[] = [];
        const argumentByParameter = new Map<number, TypedBuiltinArgument>();
        const argumentNames = new Set<string>();
        let argumentsAreValid = true;

        for (const nodeArgument of node.args) {
          if (nodeArgument.kind !== "named") continue;
          const expression = checkNode(nodeArgument.expression, null, state);
          sourceArgs.push({ kind: "scalar", expression });
          if (argumentNames.has(nodeArgument.name)) {
            argumentsAreValid = false;
            addDiagnostic(state, {
              code: "duplicate-function-argument",
              span: nodeArgument.nameSpan,
              message: `組み込み関数「${node.name}」の引数「${nodeArgument.name}」が重複しています。`
            });
            continue;
          }
          argumentNames.add(nodeArgument.name);
          const parameterIndex = signature.parameters.findIndex((parameter) => parameter.name === nodeArgument.name);
          if (parameterIndex < 0) {
            argumentsAreValid = false;
            addDiagnostic(state, {
              code: "unknown-function-argument",
              span: nodeArgument.nameSpan,
              message: `組み込み関数「${node.name}」に引数「${nodeArgument.name}」はありません。`
            });
            continue;
          }
          const parameterType = signature.parameters[parameterIndex].type;
          if (isScalarBuiltinParameterType(parameterType)) {
            if (!checkOperandType(state, expression, parameterType)) argumentsAreValid = false;
          } else {
            argumentsAreValid = false;
          }
          argumentByParameter.set(parameterIndex, { kind: "scalar", expression });
        }

        for (const [parameterIndex, parameter] of signature.parameters.entries()) {
          if (argumentByParameter.has(parameterIndex)) continue;
          argumentsAreValid = false;
          addDiagnostic(state, {
            code: "missing-function-argument",
            span: node.span,
            message: `組み込み関数「${node.name}」の引数「${parameter.name}」が不足しています。`
          });
        }

        const canonicalArgs = signature.parameters.flatMap((_parameter, index) => {
          const argument = argumentByParameter.get(index);
          return argument ? [argument] : [];
        });
        return {
          kind: "call",
          span: node.span,
          nameSpan: node.nameSpan,
          name: node.name,
          target: { kind: "builtin", name: definition.name },
          args: argumentsAreValid ? canonicalArgs : sourceArgs,
          type: argumentsAreValid ? signature.returnType : null
        };
      }

      const args: TypedBuiltinArgument[] = [];
      let argumentsAreValid = true;
      for (const [index, nodeArgument] of node.args.entries()) {
        const parameterType = signature.parameters[index]?.type;
        if (!parameterType) {
          argumentsAreValid = false;
          args.push({ kind: "scalar", expression: checkNode(nodeArgument.expression, null, state) });
          continue;
        }
        if (isScalarBuiltinParameterType(parameterType)) {
          const argument = checkNode(nodeArgument.expression, null, state);
          args.push({ kind: "scalar", expression: argument });
          if (!checkOperandType(state, argument, parameterType)) argumentsAreValid = false;
          continue;
        }

        let target: ScalarExpressionResolvedGeometryTarget | null = null;
        const sourceArgument = nodeArgument.expression;
        if (sourceArgument.kind === "reference") {
          const resolution = nextReferenceResolution(state, sourceArgument.name, sourceArgument.span.start);
          if (resolution.kind === "resolvedGeometry") target = resolution.target;
          if (resolution.kind !== "resolvedGeometry" || resolution.target === null) {
            argumentsAreValid = false;
          } else if (!isModuleGeometryInterfaceAssignable(resolution.target.geometryType, parameterType)) {
            argumentsAreValid = false;
          }
        } else if (sourceArgument.kind === "geometryProperty" && parameterType === "point") {
          target = state.geometryBuiltinArguments?.get(sourceArgument.span.start) ?? null;
          if (target === null || !isModuleGeometryInterfaceAssignable(target.geometryType, parameterType)) {
            argumentsAreValid = false;
          }
        } else {
          checkNode(sourceArgument, null, state);
          argumentsAreValid = false;
        }
        args.push({ kind: "geometryReference", expectedGeometryType: parameterType, target });
      }
      return {
        kind: "call",
        span: node.span,
        nameSpan: node.nameSpan,
        name: node.name,
        target: { kind: "builtin", name: definition.name },
        args,
        type: argumentsAreValid ? signature.returnType : null
      };
    }
  }
};

export const typecheckScalarExpression = (
  ast: ScalarExpressionAst,
  context: ScalarExpressionTypecheckContext
): ScalarExpressionTypecheckResult => {
  const state: TraversalState = {
    references: context.references,
    geometryBuiltinArguments: context.geometryBuiltinArguments,
    cursor: 0,
    diagnostics: [],
    resolveChoiceLiteral: context.resolveChoiceLiteral
  };
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
