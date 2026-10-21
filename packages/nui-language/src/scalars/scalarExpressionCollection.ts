import type { ScalarProgramCollection } from "./scalarProgram";
import type { TypedScalarExpression } from "./typedExpressionAst";
import type { ScalarType } from "./types";

/** Reuse the lazy map descriptor for scalar literal members that are expressions.
 * The ordinal seed preserves cardinality/order without eagerly evaluating a body. */
export const scalarExpressionCollection = (
  valueId: string,
  expressions: readonly TypedScalarExpression[],
  elementType: ScalarType,
  sourceOrder: number
): ScalarProgramCollection[] => {
  if (expressions.length === 0) return [{ valueId, kind: "literal", members: [] }];
  const binderId = `${valueId}:literal-member`;
  const seedId = `${valueId}:literal-ordinals`;
  const numberType = { kind: "number" as const };
  let body = expressions.at(-1)!;
  for (let index = expressions.length - 2; index >= 0; index--) {
    const expression = expressions[index]!;
    const span = expression.span;
    body = {
      kind: "valueIf", span, type: elementType,
      condition: { kind: "binary", span, operator: "==", type: { kind: "boolean" },
        left: { kind: "reference", span, nameSpan: span, name: binderId, bindingId: binderId, type: numberType },
        right: { kind: "numberLiteral", span, value: index, type: numberType } },
      thenBranch: expression, elseBranch: body
    };
  }
  return [
    { valueId: seedId, kind: "literal", members: expressions.map((_, value) => ({ kind: "literal", type: numberType, value: { kind: "number", value } })) },
    { valueId, kind: "map", sourceValueId: seedId, sourceElementType: numberType, resultElementType: elementType, binderId, body, sourceOrder }
  ];
};
