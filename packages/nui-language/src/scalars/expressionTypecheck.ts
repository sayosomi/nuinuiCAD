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
import type { ScalarSpan } from "./expressionAst";
import type { BindingResolution } from "./bindingResolution";
import {
  formatBuiltinCallingStyleMismatch,
  getBuiltinFunctionDefinition,
  isScalarBuiltinParameterType,
  type BuiltinScalarParameterType
} from "./builtinFunctions";
import type {
  ScalarExpressionResolvedGeometryTarget,
  ScalarExpressionResolvedGeometryProperty,
  ScalarExpressionResolvedCollectionIndex,
  ScalarExpressionResolvedReference,
  ScalarExpressionTypecheckContext,
  ScalarExpressionTypecheckDiagnostic,
  ScalarExpressionTypecheckResult,
  TypedBuiltinArgument,
  TypedScalarExpression
} from "./typedExpressionAst";
import { isChoiceOptionMember, isScalarTypeAssignable } from "./scalarAssignability";
import { scalarTypeOfDslValueType } from "../dsl/dslValueTypes";
import { isChoiceScalarType, type ChoiceScalarType, type ScalarType } from "./types";
import { isModuleGeometryInterfaceAssignable } from "../dsl/moduleGeometryInterfaces";

const NUMBER_TYPE: Extract<ScalarType, { kind: "number" }> = { kind: "number" };
const BOOLEAN_TYPE: Extract<ScalarType, { kind: "boolean" }> = { kind: "boolean" };

interface TraversalState {
  readonly references: readonly (BindingResolution | ScalarExpressionResolvedReference)[];
  readonly geometryBuiltinArguments?: ReadonlyMap<number, ScalarExpressionResolvedGeometryTarget | null>;
  readonly geometryPropertyReferences?: ReadonlyMap<number, ScalarExpressionResolvedGeometryProperty | null>;
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

/**
 * Validate the closed-world cases of a choice match without depending on the
 * typed scalar tree. Geometry-valued expressions use the same parser envelope
 * but deliberately keep their branch values outside TypedScalarExpression;
 * this helper keeps the exhaustiveness contract shared by both owners.
 */
export const validateChoiceMatchExhaustiveness = ({
  scrutineeType,
  scrutineeSpan,
  matchSpan,
  arms,
  addDiagnostic: emit
}: {
  scrutineeType: ScalarType | null;
  scrutineeSpan: ScalarSpan;
  matchSpan: ScalarSpan;
  arms: readonly { label: string; labelSpan: ScalarSpan }[];
  addDiagnostic: (diagnostic: ScalarExpressionTypecheckDiagnostic) => void;
}): { scrutineeIsChoice: boolean; exhaustive: boolean } => {
  if (scrutineeType === null) return { scrutineeIsChoice: false, exhaustive: false };
  if (!isChoiceScalarType(scrutineeType)) {
    emit({
      code: "non-choice-match-scrutinee",
      span: scrutineeSpan,
      message: `match のscrutineeはchoice(...)型である必要があります(実際: ${describeScalarType(scrutineeType)})。`,
      presentation: {
        key: "diagnostic.non-choice-match-scrutinee",
        parameters: { actual: describeScalarType(scrutineeType) }
      },
      actualType: scrutineeType
    });
    return { scrutineeIsChoice: false, exhaustive: false };
  }

  const seen = new Set<string>();
  for (const arm of arms) {
    if (!scrutineeType.options.includes(arm.label)) {
      emit({
        code: "impossible-match-case",
        span: arm.labelSpan,
        message: `match ケース「${arm.label}」はscrutineeのchoice(${scrutineeType.options.join(", ")})には存在しません。`,
        presentation: {
          key: "diagnostic.impossible-match-case",
          parameters: { option: arm.label, expected: describeScalarType(scrutineeType) }
        },
        expectedType: scrutineeType
      });
      continue;
    }
    if (seen.has(arm.label)) {
      emit({
        code: "duplicate-match-case",
        span: arm.labelSpan,
        message: `match ケース「${arm.label}」が重複しています。`,
        presentation: {
          key: "diagnostic.duplicate-match-case",
          parameters: { option: arm.label }
        }
      });
      continue;
    }
    seen.add(arm.label);
  }

  const missing = scrutineeType.options.filter((option) => !seen.has(option));
  if (missing.length > 0) {
    emit({
      code: "missing-match-case",
      span: matchSpan,
      message: `match に必要なchoiceケースがありません: ${missing.join(", ")}。`,
      presentation: {
        key: "diagnostic.missing-match-case",
        parameters: { options: missing.join(", ") }
      },
      expectedType: scrutineeType
    });
  }
  return { scrutineeIsChoice: true, exhaustive: missing.length === 0 };
};

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
    presentation: {
      key: "diagnostic.scalar-type-mismatch",
      parameters: { expected: describeScalarType(requiredType), actual: describeScalarType(operand.type) }
    },
    expectedType: requiredType,
    actualType: operand.type
  });
  return false;
};

/** Builtin-only matcher for constraints that are intentionally broader than a concrete ScalarType. */
const checkBuiltinOperandType = (
  state: TraversalState,
  operand: TypedScalarExpression,
  requiredType: BuiltinScalarParameterType
): boolean => {
  if (requiredType.kind !== "anyChoice") return checkOperandType(state, operand, requiredType);
  if (operand.type === null) return false;
  if (operand.type.kind === "choice") return true;
  addDiagnostic(state, {
    code: "scalar-type-mismatch",
    span: operand.span,
    message: `型が一致しません(期待: choice(...), 実際: ${describeScalarType(operand.type)})。`,
    presentation: {
      key: "diagnostic.scalar-type-mismatch",
      parameters: { expected: "choice(...)" , actual: describeScalarType(operand.type) }
    },
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
        presentation: {
          key: "diagnostic.scalar-type-mismatch",
          parameters: { expected: describeScalarType(left.type), actual: describeScalarType(right.type) }
        },
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
        presentation: {
          key: "diagnostic.invalid-choice-literal",
          parameters: { value: node.raw, expected: choiceHintType ? describeScalarType(choiceHintType) : "choice" }
        },
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
      const declaredType = scalarTypeOfDslValueType(binding.declaredType);
      const type = binding.kind === "typed" ? declaredType : (declaredType ?? NUMBER_TYPE);
      return { kind: "reference", span: node.span, nameSpan: node.nameSpan, name: node.name, bindingId: binding.id, type };
    }

    case "collectionIndex": {
      const resolution = nextReferenceResolution(state, node.name, node.span.start);
      const index = checkNode(node.index, NUMBER_TYPE, state);
      const indexOk = checkOperandType(state, index, NUMBER_TYPE);
      const collection = resolution.kind === "resolvedCollectionIndex"
        ? resolution as ScalarExpressionResolvedCollectionIndex
        : null;
      return {
        kind: "collectionIndex",
        span: node.span,
        nameSpan: node.nameSpan,
        name: node.name,
        collectionValueId: collection?.collectionValueId ?? null,
        collectionLength: collection?.collectionLength ?? null,
        targetSourceOrder: collection?.targetSourceOrder ?? null,
        index,
        type: collection && indexOk ? collection.type : null
      };
    }

    case "geometryProperty": {
      const resolved = state.geometryPropertyReferences?.get(node.span.start) ?? null;
      const occurrenceIndex = node.occurrenceIndex
        ? checkNode(node.occurrenceIndex, NUMBER_TYPE, state)
        : null;
      const occurrenceIndexOk = occurrenceIndex === null || checkOperandType(state, occurrenceIndex, NUMBER_TYPE);
      return {
        kind: "geometryProperty",
        span: node.span,
        elementNameSpan: node.elementNameSpan,
        propertySpan: node.propertySpan,
        elementName: node.elementName,
        elementId: resolved && "elementId" in resolved ? resolved.elementId : null,
        ...(resolved?.kind === "collection" ? {
          collectionValueId: resolved.collectionValueId,
          collectionLength: resolved.collectionLength
        } : {}),
        ...(resolved && resolved.kind === "geometryValue" ? { geometryValueOccurrence: resolved.occurrence } : {}),
        ...(resolved && resolved.kind === "geometryValue" && resolved.pointKey ? { geometryValuePointKey: resolved.pointKey } : {}),
        ...(resolved?.kind === "geometryValueForBinder" ? { geometryValueBinderId: resolved.binderId } : {}),
        ...(resolved?.kind === "forGroupOccurrence" ? {
          forGroupOccurrenceTemplateElementId: resolved.templateElementId,
          forGroupOccurrenceIndex: occurrenceIndex,
          ...(resolved.pointKey ? { forGroupOccurrencePointKey: resolved.pointKey } : {})
        } : {}),
        property: resolved?.kind === "collection" ? node.property : resolved?.property ?? node.property,
        targetSourceOrder: resolved?.targetSourceOrder ?? null,
        type: occurrenceIndexOk ? resolved?.type ?? null : null
      };
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

    case "valueIf": {
      const condition = checkNode(node.condition, BOOLEAN_TYPE, state);
      const conditionOk = checkOperandType(state, condition, BOOLEAN_TYPE);
      const thenBranch = checkNode(node.thenBranch, expectedType, state);
      const elseBranch = checkNode(node.elseBranch, expectedType, state);
      let type: ScalarType | null = null;
      if (expectedType !== null) {
        const thenOk = checkOperandType(state, thenBranch, expectedType);
        const elseOk = checkOperandType(state, elseBranch, expectedType);
        if (conditionOk && thenOk && elseOk) type = expectedType;
      } else if (thenBranch.type !== null && elseBranch.type !== null) {
        if (isScalarTypeAssignable(thenBranch.type, elseBranch.type)) type = thenBranch.type;
        else {
          addDiagnostic(state, {
            code: "scalar-type-mismatch",
            span: node.span,
            message: `value-ifの両ブランチの型が一致しません(${describeScalarType(thenBranch.type)} vs ${describeScalarType(elseBranch.type)})。`,
            presentation: {
              key: "diagnostic.scalar-type-mismatch",
              parameters: { expected: describeScalarType(thenBranch.type), actual: describeScalarType(elseBranch.type) }
            },
            expectedType: thenBranch.type,
            actualType: elseBranch.type
          });
        }
      }
      return { kind: "valueIf", span: node.span, condition, thenBranch, elseBranch, type };
    }

    case "valueMatch": {
      const scrutinee = checkNode(node.scrutinee, null, state);
      const { scrutineeIsChoice, exhaustive } = validateChoiceMatchExhaustiveness({
        scrutineeType: scrutinee.type,
        scrutineeSpan: node.scrutinee.span,
        matchSpan: node.span,
        arms: node.arms,
        addDiagnostic: (diagnostic) => addDiagnostic(state, diagnostic)
      });

      const armResults = node.arms.map((arm) => ({
        arm,
        expression: checkNode(arm.expression, expectedType, state)
      }));
      let armResultsValid = armResults.every(({ expression }) => expression.type !== null);
      let type: ScalarType | null = null;
      if (expectedType !== null) {
        for (const { expression } of armResults) {
          if (!checkOperandType(state, expression, expectedType)) armResultsValid = false;
        }
        if (armResultsValid) type = expectedType;
      } else {
        const firstTyped = armResults.find(({ expression }) => expression.type !== null)?.expression.type ?? null;
        if (firstTyped !== null) {
          type = firstTyped;
          for (const { arm, expression } of armResults) {
            if (expression.type === null) {
              armResultsValid = false;
              continue;
            }
            if (!isScalarTypeAssignable(expression.type, firstTyped)) {
              armResultsValid = false;
              addDiagnostic(state, {
                code: "scalar-type-mismatch",
                span: arm.expression.span,
                message: `match ケースの型が一致しません(期待: ${describeScalarType(firstTyped)}, 実際: ${describeScalarType(expression.type)})。`,
                presentation: {
                  key: "diagnostic.scalar-type-mismatch",
                  parameters: { expected: describeScalarType(firstTyped), actual: describeScalarType(expression.type) }
                },
                expectedType: firstTyped,
                actualType: expression.type
              });
            }
          }
        } else {
          armResultsValid = false;
        }
      }
      if (!scrutineeIsChoice || !exhaustive || !armResultsValid || scrutinee.type === null) type = null;
      return {
        kind: "valueMatch",
        span: node.span,
        scrutinee,
        arms: armResults.map(({ arm, expression }) => ({ ...arm, expression })),
        type
      };
    }

    case "call": {
      const definition = getBuiltinFunctionDefinition(node.name);
      if (definition === null) {
        const args: TypedBuiltinArgument[] = node.args.map((arg) => ({ kind: "scalar", expression: checkNode(arg.expression, null, state) }));
        addDiagnostic(state, {
          code: "unknown-function",
          span: node.nameSpan,
          message: `未知の組み込み関数「${node.name}」です。`,
          presentation: { key: "diagnostic.unknown-function", parameters: { name: node.name } }
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
          if (sourceArgument.kind === "reference" || sourceArgument.kind === "collectionIndex" || sourceArgument.kind === "geometryProperty") {
            const resolution = sourceArgument.kind === "geometryProperty"
              ? null
              : nextReferenceResolution(state, sourceArgument.name, sourceArgument.span.start);
            let target = sourceArgument.kind === "geometryProperty"
              ? state.geometryBuiltinArguments?.get(sourceArgument.span.start) ?? null
              : resolution?.kind === "resolvedGeometry" ? resolution.target : null;
            if (sourceArgument.kind === "collectionIndex") {
              const index = checkNode(sourceArgument.index, NUMBER_TYPE, state);
              checkOperandType(state, index, NUMBER_TYPE);
              if (target?.kind === "forGroupOccurrence") target = { ...target, index };
            } else if (sourceArgument.kind === "geometryProperty" && sourceArgument.occurrenceIndex) {
              const index = checkNode(sourceArgument.occurrenceIndex, NUMBER_TYPE, state);
              checkOperandType(state, index, NUMBER_TYPE);
              if (target?.kind === "forGroupOccurrence") target = { ...target, index };
            }
            return {
              kind: "geometryReference",
              expectedGeometryType: parameterType,
              target
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
          message: `組み込み関数「${node.name}」の引数の数が一致しません(期待: ${arityText}, 実際: ${args.length})。`,
          presentation: { key: "diagnostic.function-arity-mismatch", parameters: { name: node.name, expected: arityText, actual: args.length } }
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
              message: `組み込み関数「${node.name}」の引数「${nodeArgument.name}」が重複しています。`,
              presentation: { key: "diagnostic.duplicate-function-argument", parameters: { name: node.name, argument: nodeArgument.name } }
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
              message: `組み込み関数「${node.name}」に引数「${nodeArgument.name}」はありません。`,
              presentation: { key: "diagnostic.unknown-function-argument", parameters: { name: node.name, argument: nodeArgument.name } }
            });
            continue;
          }
          const parameterType = signature.parameters[parameterIndex].type;
          if (isScalarBuiltinParameterType(parameterType)) {
            if (!checkBuiltinOperandType(state, expression, parameterType)) argumentsAreValid = false;
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
            message: `組み込み関数「${node.name}」の引数「${parameter.name}」が不足しています。`,
            presentation: { key: "diagnostic.missing-function-argument", parameters: { name: node.name, parameter: parameter.name } }
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
          if (!checkBuiltinOperandType(state, argument, parameterType)) argumentsAreValid = false;
          continue;
        }

        let target: ScalarExpressionResolvedGeometryTarget | null = null;
        const sourceArgument = nodeArgument.expression;
        if (sourceArgument.kind === "reference" || sourceArgument.kind === "collectionIndex" || sourceArgument.kind === "geometryProperty") {
          const resolution = sourceArgument.kind === "geometryProperty"
            ? null
            : nextReferenceResolution(state, sourceArgument.name, sourceArgument.span.start);
          target = sourceArgument.kind === "geometryProperty"
            ? state.geometryBuiltinArguments?.get(sourceArgument.span.start) ?? null
            : resolution?.kind === "resolvedGeometry" ? resolution.target : null;
          if (sourceArgument.kind === "collectionIndex") {
            const index = checkNode(sourceArgument.index, NUMBER_TYPE, state);
            if (!checkOperandType(state, index, NUMBER_TYPE)) argumentsAreValid = false;
            if (target?.kind === "forGroupOccurrence") target = { ...target, index };
          } else if (sourceArgument.kind === "geometryProperty" && sourceArgument.occurrenceIndex) {
            const index = checkNode(sourceArgument.occurrenceIndex, NUMBER_TYPE, state);
            if (!checkOperandType(state, index, NUMBER_TYPE)) argumentsAreValid = false;
            if (target?.kind === "forGroupOccurrence") target = { ...target, index };
          }
          if ((sourceArgument.kind === "geometryProperty" && target === null) ||
            (sourceArgument.kind !== "geometryProperty" && (resolution?.kind !== "resolvedGeometry" || resolution.target === null))) {
            argumentsAreValid = false;
          } else if (target && !isModuleGeometryInterfaceAssignable(target.geometryType, parameterType)) {
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
    geometryPropertyReferences: context.geometryPropertyReferences,
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
      presentation: {
        key: "diagnostic.scalar-type-mismatch",
        parameters: { expected: describeScalarType(context.expectedType), actual: describeScalarType(type) }
      },
      expectedType: context.expectedType,
      actualType: type
    });
    type = null;
  }

  return { typed, diagnostics: state.diagnostics, type };
};
