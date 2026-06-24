import type { ElementId } from "../types/geometry";
import { labelToProperty, propertyLabels } from "./numericExpressionProperties";
import type { NumericExpressionReference, NumericMeasurementKey } from "./numericExpressionTypes";

export type NumericExpressionFunctionName = "distance" | "angle" | "lineDistance";

export type Token =
  | { type: "number"; value: number }
  | { type: "reference"; elementId: ElementId; property: NumericMeasurementKey }
  | { type: "element"; elementId: ElementId }
  | { type: "localVariable"; variableId: string }
  | { type: "function"; name: NumericExpressionFunctionName }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "comma" }
  | { type: "leftParen" }
  | { type: "rightParen" };

const functionNames = new Map<string, NumericExpressionFunctionName>([
  ["distance", "distance"],
  ["距離", "distance"],
  ["angle", "angle"],
  ["角度", "angle"],
  ["lineDistance", "lineDistance"],
  ["点線距離", "lineDistance"]
]);

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

    const numberMatch = expression.slice(index).match(/^\d+(?:\.\d+)?|^\.\d+/);
    if (numberMatch) {
      tokens.push({ type: "number", value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const localVariableMatch = expression.slice(index).match(/^@([^\s()+*/.]+)/);
    if (localVariableMatch) {
      tokens.push({ type: "localVariable", variableId: localVariableMatch[1] });
      index += localVariableMatch[0].length;
      continue;
    }

    const functionMatch = expression.slice(index).match(/^([^\s(),+*/.]+)\s*(?=\()/);
    const functionName = functionMatch ? functionNames.get(functionMatch[1]) : undefined;
    if (functionMatch && functionName) {
      tokens.push({ type: "function", name: functionName });
      index += functionMatch[1].length;
      continue;
    }

    const referenceMatch = expression
      .slice(index)
      .match(/^([^\s()+*/.]+)\.([^\s()+*/.]+)/);
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

    const elementMatch = expression.slice(index).match(/^([^\s(),+*/]+)/);
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
      name: NumericExpressionFunctionName,
      args: ElementId[]
    ) => number
  ) {}

  parse() {
    const value = this.parseExpression();
    if (this.index < this.tokens.length) throw new Error("式の末尾を解釈できません。");
    return value;
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
      const value = this.parseExpression();
      if (this.consume()?.type !== "rightParen") throw new Error("閉じ括弧がありません。");
      return value;
    }
    throw new Error("数値、参照、または括弧が必要です。");
  }

  private parseFunctionCall(name: NumericExpressionFunctionName) {
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

  private peekOperator(value: "+" | "-" | "*" | "/") {
    const token = this.tokens[this.index];
    return token?.type === "operator" && token.value === value;
  }

  private consumeOperator() {
    const token = this.consume();
    if (token?.type !== "operator") throw new Error("演算子が必要です。");
    return token.value;
  }

  private consume() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}
