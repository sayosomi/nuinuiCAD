import { describe, expect, it } from "vitest";
import {
  addToNumericValue,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "./numericExpressions";
import type { CadElement } from "../types/geometry";

const expression = (value: string) => ({ kind: "expression" as const, expression: value });

describe("addToNumericValue", () => {
  it("folds repeated increments into a trailing numeric offset", () => {
    let value = expression("line-ab.length + 10");

    for (let index = 0; index < 7; index += 1) {
      value = addToNumericValue(value, 1) as typeof value;
    }

    expect(value).toEqual(expression("line-ab.length + 17"));
  });

  it("keeps a negative trailing numeric offset when the folded value becomes negative", () => {
    expect(addToNumericValue(expression("line-ab.length + 10"), -12)).toEqual(
      expression("line-ab.length - 2")
    );
  });

  it("removes the trailing numeric offset when the folded value becomes zero", () => {
    expect(addToNumericValue(expression("line-ab.length + 10"), -10)).toEqual(
      expression("line-ab.length")
    );
  });

  it("wraps non-offset expressions once and then folds subsequent increments", () => {
    let value = addToNumericValue(expression("line-ab.length * 2"), 1);
    expect(value).toEqual(expression("(line-ab.length * 2) + 1"));

    value = addToNumericValue(value, 1);
    expect(value).toEqual(expression("(line-ab.length * 2) + 2"));

    value = addToNumericValue(value, 1);
    expect(value).toEqual(expression("(line-ab.length * 2) + 3"));
  });

  it("does not accumulate parentheses when dragging back and forth across zero offset", () => {
    let value = expression("line-bc.startAngleDeg");

    value = addToNumericValue(value, -30) as typeof value;
    expect(value).toEqual(expression("line-bc.startAngleDeg - 30"));

    value = addToNumericValue(value, 30) as typeof value;
    expect(value).toEqual(expression("line-bc.startAngleDeg"));

    value = addToNumericValue(value, -30) as typeof value;
    expect(value).toEqual(expression("line-bc.startAngleDeg - 30"));
  });
});

describe("makeNumericExpression", () => {
  it("normalizes blank numeric input to zero", () => {
    expect(makeNumericExpression("")).toBe(0);
    expect(makeNumericExpression("   ")).toBe(0);
  });
});

describe("normalizeNumericExpressionInput", () => {
  it("normalizes Japanese curve length references", () => {
    const elements: CadElement[] = [
      {
        id: "curve-ac",
        name: "曲線AC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ];

    expect(normalizeNumericExpressionInput("曲線AC.長さ + 5", elements)).toBe(
      "curve-ac.length + 5"
    );
  });

  it("normalizes Japanese curve handle references and local variable references", () => {
    const elements: CadElement[] = [
      {
        id: "curve-ac",
        name: "曲線AC",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        numericVariables: [{ id: "shared", name: "共通長", value: 30 }],
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ];

    expect(
      normalizeNumericExpressionInput(
        "曲線AC.始点ハンドル長 + @共通長",
        elements,
        elements[0].type === "bezierCurve" ? elements[0].numericVariables ?? [] : []
      )
    ).toBe("curve-ac.startHandleLength + @shared");
  });
});
