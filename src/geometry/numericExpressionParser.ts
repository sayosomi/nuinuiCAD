import type { ElementId } from "../types/geometry";
import { labelToProperty, propertyLabels } from "./numericExpressionProperties";
import type { NumericExpressionReference, NumericMeasurementKey } from "./numericExpressionTypes";

export type NumericExpressionMeasurementFunctionName = "distance" | "angle" | "lineDistance";
export type NumericExpressionFunctionName = NumericExpressionMeasurementFunctionName | "sqrt";
type ArithmeticOperator = "+" | "-" | "*" | "/";
type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=";
type LogicalOperator = "&&" | "||";

export type Token =
  | { type: "number"; value: number }
  | { type: "reference"; elementId: ElementId; property: NumericMeasurementKey }
  | { type: "element"; elementId: ElementId }
  | { type: "localVariable"; variableId: string }
  | { type: "function"; name: NumericExpressionFunctionName }
  | { type: "operator"; value: ArithmeticOperator }
  | { type: "comparisonOperator"; value: ComparisonOperator }
  | { type: "logicalOperator"; value: LogicalOperator }
  | { type: "comma" }
  | { type: "leftParen" }
  | { type: "rightParen" };

const functionNames = new Map<string, NumericExpressionFunctionName>([
  ["distance", "distance"],
  ["距離", "distance"],
  ["angle", "angle"],
  ["角度", "angle"],
  ["lineDistance", "lineDistance"],
  ["点線距離", "lineDistance"],
  ["sqrt", "sqrt"]
]);

const piMatch = (expression: string, index: number) =>
  expression.slice(index).match(/^pi(?=$|[\s(),+*/<>!=&|])/);

export const tokenize = (expression: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    const logicalMatch = expression.slice(index).match(/^(&&|\|\|)/);
    if (logicalMatch) {
      tokens.push({ type: "logicalOperator", value: logicalMatch[0] as LogicalOperator });
      index += logicalMatch[0].length;
      continue;
    }
    const comparisonMatch = expression.slice(index).match(/^(>=|<=|==|!=|>|<)/);
    if (comparisonMatch) {
      tokens.push({ type: "comparisonOperator", value: comparisonMatch[0] as ComparisonOperator });
      index += comparisonMatch[0].length;
      continue;
    }

    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?|^\.\d+/);
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const localVariableMatch = expression.slice(index).match(/^@([^\s()+*/.<>!=&|]+)/);
    if (localVariableMatch) {
      tokens.push({ type: "localVariable", variableId: localVariableMatch[1] });
      index += localVariableMatch[0].length;
      continue;
    }

    const functionMatch = expression.slice(index).match(/^([^\s(),+*/.<>!=&|]+)\s*(?=\()/);
    const functionName = functionMatch ? functionNames.get(functionMatch[1]) : undefined;
    if (functionMatch && functionName) {
      tokens.push({ type: "function", name: functionName });
      index += functionMatch[1].length;
      continue;
    }

    const referenceMatch = expression
      .slice(index)
      .match(/^([^\s()+*/.<>!=&|]+)\.([^\s()+*/.<>!=&|]+)/);
    if (referenceMatch) {
      const property = labelToProperty.get(referenceMatch[2]) ?? referenceMatch[2];
      if (!(property in propertyLabels)) {
        throw new Error(`未対応の参照プロパティです: ${referenceMatch[2]}`);
      }
      tokens.push({
        type: "reference",
        elementId: referenceMatch[1],
        property: property as NumericMeasurementKey
      });
      index += referenceMatch[0].length;
      continue;
    }

    const constantMatch = piMatch(expression, index);
    if (constantMatch) {
      tokens.push({ type: "number", value: Math.PI });
      index += constantMatch[0].length;
      continue;
    }

    const elementMatch = expression.slice(index).match(/^([^\s(),+*/<>!=&|]+)/);
    if (elementMatch) {
      tokens.push({ type: "element", elementId: elementMatch[1] });
      index += elementMatch[0].length;
      continue;
    }

    throw new Error(`式を解釈できません: ${expression.slice(index)}`);
  }

  return tokens;
};

export class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly referenceValue: (reference: NumericExpressionReference) => number,
    private readonly localVariableValue: (variableId: string) => number,
    private readonly functionValue: (
      name: NumericExpressionMeasurementFunctionName,
      args: ElementId[]
    ) => number
  ) {}

  parse() {
    const value = this.parseLogicalOr();
    if (this.index < this.tokens.length) throw new Error("式の末尾を解釈できません。");
    return value;
  }

  private parseLogicalOr() {
    let value = this.parseLogicalAnd();
    while (this.peekLogicalOperator("||")) {
      this.consumeLogicalOperator();
      const right = this.parseLogicalAnd();
      value = value !== 0 || right !== 0 ? 1 : 0;
    }
    return value;
  }

  private parseLogicalAnd() {
    let value = this.parseComparison();
    while (this.peekLogicalOperator("&&")) {
      this.consumeLogicalOperator();
      const right = this.parseComparison();
      value = value !== 0 && right !== 0 ? 1 : 0;
    }
    return value;
  }

  private parseComparison() {
    const left = this.parseExpression();
    if (!this.peekComparisonOperator()) return left;

    const operator = this.consumeComparisonOperator();
    const right = this.parseExpression();
    const result =
      operator === ">" ? left > right :
      operator === ">=" ? left >= right :
      operator === "<" ? left < right :
      operator === "<=" ? left <= right :
      operator === "!=" ? left !== right :
      left === right;
    return result ? 1 : 0;
  }

  private parseExpression() {
    let value = this.parseTerm();
    while (this.peekOperator("+") || this.peekOperator("-")) {
      const operator = this.consumeOperator();
      const right = this.parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseTerm() {
    let value = this.parseFactor();
    while (this.peekOperator("*") || this.peekOperator("/")) {
      const operator = this.consumeOperator();
      const right = this.parseFactor();
      if (operator === "/" && right === 0) throw new Error("0で割ることはできません。");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private parseFactor(): number {
    const token = this.consume();
    if (!token) throw new Error("式が途中で終わっています。");
    if (token.type === "number") return token.value;
    if (token.type === "reference") return this.referenceValue(token);
    if (token.type === "localVariable") return this.localVariableValue(token.variableId);
    if (token.type === "function") return this.parseFunctionCall(token.name);
    if (token.type === "operator" && token.value === "+") return this.parseFactor();
    if (token.type === "operator" && token.value === "-") return -this.parseFactor();
    if (token.type === "leftParen") {
      const value = this.parseLogicalOr();
      if (this.consume()?.type !== "rightParen") throw new Error("閉じ括弧がありません。");
      return value;
    }
    throw new Error("数値、参照、または括弧が必要です。");
  }

  private parseFunctionCall(name: NumericExpressionFunctionName) {
    if (name === "sqrt") return this.parseSqrtFunctionCall();
    return this.parseMeasurementFunctionCall(name);
  }

  private parseSqrtFunctionCall() {
    if (this.consume()?.type !== "leftParen") throw new Error("関数の開始括弧がありません。");
    const value = this.parseLogicalOr();
    if (this.consume()?.type !== "rightParen") throw new Error("閉じ括弧がありません。");
    if (value < 0) throw new Error("sqrt の引数は0以上である必要があります。");
    return Math.sqrt(value);
  }

  private parseMeasurementFunctionCall(name: NumericExpressionMeasurementFunctionName) {
    if (this.consume()?.type !== "leftParen") throw new Error("関数の開始括弧がありません。");

    const args: ElementId[] = [];
    while (true) {
      const token = this.consume();
      if (token?.type !== "element") throw new Error("関数の引数には要素名または要素IDが必要です。");
      args.push(token.elementId);

      const separator = this.consume();
      if (separator?.type === "rightParen") break;
      if (separator?.type !== "comma") throw new Error("関数の引数はカンマで区切ってください。");
    }

    return this.functionValue(name, args);
  }

  private peekOperator(value: ArithmeticOperator) {
    const token = this.tokens[this.index];
    return token?.type === "operator" && token.value === value;
  }

  private consumeOperator() {
    const token = this.consume();
    if (token?.type !== "operator") throw new Error("演算子が必要です。");
    return token.value;
  }

  private peekComparisonOperator() {
    return this.tokens[this.index]?.type === "comparisonOperator";
  }

  private consumeComparisonOperator() {
    const token = this.consume();
    if (token?.type !== "comparisonOperator") throw new Error("比較演算子が必要です。");
    return token.value;
  }

  private peekLogicalOperator(value: LogicalOperator) {
    const token = this.tokens[this.index];
    return token?.type === "logicalOperator" && token.value === value;
  }

  private consumeLogicalOperator() {
    const token = this.consume();
    if (token?.type !== "logicalOperator") throw new Error("論理演算子が必要です。");
    return token.value;
  }

  private consume() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}
