import { isNumericExpression } from "../geometry/numericExpressions";
import { tokenize } from "../geometry/numericExpressionParser";
import type { ElementId, NumericValue } from "../types/geometry";

export type ReferenceValue = { id: ElementId; form: "expression" };

export const expressionReferences = (value: NumericValue): ReferenceValue[] => {
  if (!isNumericExpression(value)) return [];
  try {
    return tokenize(value.expression).flatMap((token) =>
      token.type === "reference" || token.type === "element"
        ? [{ id: token.elementId, form: "expression" as const }]
        : []
    );
  } catch {
    return [];
  }
};

export const nestedExpressionReferences = (value: unknown, seen = new Set<object>()): ReferenceValue[] => {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (isNumericExpression(value as NumericValue)) return expressionReferences(value as NumericValue);
  if (Array.isArray(value)) return value.flatMap((item) => nestedExpressionReferences(item, seen));
  return Object.values(value as Record<string, unknown>).flatMap((item) => nestedExpressionReferences(item, seen));
};

export const nestedVariableReferences = (
  value: unknown,
  localVariableIds: ReadonlySet<string>,
  seen = new Set<object>()
): ElementId[] => {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (isNumericExpression(value as NumericValue)) {
    try {
      return tokenize((value as Extract<NumericValue, { kind: "expression" }>).expression)
        .flatMap((token) => token.type === "localVariable" && !localVariableIds.has(token.variableId)
          ? [token.variableId]
          : []);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => nestedVariableReferences(item, localVariableIds, seen));
  return Object.values(value as Record<string, unknown>).flatMap((item) =>
    nestedVariableReferences(item, localVariableIds, seen)
  );
};

export const derivedReferenceIds = (value: unknown, seen = new Set<object>()): ElementId[] => {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const record = value as { mode?: unknown; elementId?: unknown };
  if (record.mode === "derived" && typeof record.elementId === "string") return [record.elementId];
  if (Array.isArray(value)) return value.flatMap((item) => derivedReferenceIds(item, seen));
  return Object.values(value as Record<string, unknown>).flatMap((item) => derivedReferenceIds(item, seen));
};

export const consumeReference = (counts: Map<string, number>, id: string) => {
  const count = counts.get(id) ?? 0;
  if (count <= 0) return false;
  counts.set(id, count - 1);
  return true;
};
