import { isNumericExpression } from "../geometry/numericExpressions";
import { elementNameTokensForContext } from "../model/elementNames";
import type { ElementNameContext, ElementNameToken } from "../model/elementNames";
import type { CadElement, ElementId, NumericValue, NumericVariable } from "../types/geometry";

// DSL出力用の式フォーマッタ。内部式が持つ要素ID・変数IDを、
// normalizeNumericExpressionInput が同じ内部式へ戻せるトークンに変換する。
// formatNumericExpressionForDisplay と違い、プロパティキーは英語のまま出力し、
// 解決できないIDは生トークンのまま残す(絶対に例外を投げない)。

// elementNameTokensForContext はnamespace毎に同一配列インスタンスを返す
// (ElementNameContext.tokensByNamespaceKeyでキャッシュ済み)。ここではその
// 配列参照をキーに「要素ID→最短トークン」のMapをキャッシュし、シリアライズ時に
// 数値フィールド毎(=要素数×フィールド数回)発生していたMap再構築を避ける。
// contextなし呼び出しは毎回新規contextが作られるためキャッシュは効かず、
// 従来どおりの結果を返す(挙動不変)。
const shortestTokenCache = new WeakMap<readonly ElementNameToken[], Map<ElementId, string>>();

export const shortestDslTokensById = (
  elements: CadElement[],
  currentElement?: CadElement,
  context?: ElementNameContext
) => {
  const nameTokens = elementNameTokensForContext({ elements, currentElement, context });
  const cached = shortestTokenCache.get(nameTokens);
  if (cached) return cached;
  const tokenById = new Map<ElementId, string>();
  for (const { token, element } of nameTokens) {
    const existing = tokenById.get(element.id);
    if (!existing || token.length < existing.length) tokenById.set(element.id, token);
  }
  shortestTokenCache.set(nameTokens, tokenById);
  return tokenById;
};

export const formatNumericValueForDsl = (
  value: NumericValue,
  elements: CadElement[],
  localVariables: NumericVariable[] = [],
  currentElement?: CadElement,
  context?: ElementNameContext
): string => {
  if (!isNumericExpression(value)) return `${value}`;

  const tokenById = shortestDslTokensById(elements, currentElement, context);
  const elementsById = context?.elementsById ?? new Map(elements.map((element) => [element.id, element]));
  const localVariableNameCounts = new Map<string, number>();
  for (const variable of localVariables) {
    localVariableNameCounts.set(variable.name, (localVariableNameCounts.get(variable.name) ?? 0) + 1);
  }
  const localVariableTokenById = new Map(
    localVariables
      .filter((variable) => (localVariableNameCounts.get(variable.name) ?? 0) === 1)
      .map((variable) => [variable.id, variable.name])
  );

  return value.expression
    .replace(/&&/g, " and ")
    .replace(/\|\|/g, " or ")
    .replace(/!(?!=)/g, "not ")
    .replace(/@([^\s()+*/.<>!=&|]+)/g, (match, variableId: string) => {
      const localName = localVariableTokenById.get(variableId);
      if (localName) return `@${localName}`;
      return match;
    })
    .replace(/([\w-]+):(\w+)/g, (match, elementId: string, pointKey: string) => {
      const token = elementsById.has(elementId) ? tokenById.get(elementId) : undefined;
      return token ? `${token}:${pointKey}` : match;
    })
    .replace(
      /([^\s()+*/<>!=&|,@.]+)\.([^\s()+*/<>!=&|,@]+)/g,
      (match, elementId: string, property: string) => {
        const token = elementsById.has(elementId) ? tokenById.get(elementId) : undefined;
        return token ? `@${token}.${property}` : match;
      }
    )
    .replace(/(^|[(,]\s*)([\w-]+)(?=\s*[,)])/g, (match, prefix: string, elementId: string) => {
      const token = elementsById.has(elementId) ? tokenById.get(elementId) : undefined;
      return token ? `${prefix}${token}` : match;
    });
};
