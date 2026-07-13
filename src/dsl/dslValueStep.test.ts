import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { resolveDslValueStep, stepDslNumericLiteral } from "./dslValueStep";
import type { CadElement } from "../types/geometry";

const compileElement = (source: string) => compileDslToElements(source, { elements: [] }).elements.at(-1)!;

const stepAt = (
  source: string,
  element: CadElement,
  token: string,
  direction: 1 | -1,
  committedLineText = source
) => {
  const start = source.indexOf(token);
  expect(start).toBeGreaterThanOrEqual(0);
  return resolveDslValueStep(source, element, { start, end: start }, direction, { committedLineText });
};

describe("stepDslNumericLiteral", () => {
  it("uses fixed decimal arithmetic and normalizes signs and zero", () => {
    expect(stepDslNumericLiteral("0.1", 0.2, 1)).toBe("0.3");
    expect(stepDslNumericLiteral(".2", 0.1, 1)).toBe("0.3");
    expect(stepDslNumericLiteral("-0.1", 0.1, 1)).toBe("0");
    expect(stepDslNumericLiteral("+1.50", 0.25, -1)).toBe("1.25");
    expect(stepDslNumericLiteral("-1", 10, 1)).toBe("9");
    expect(stepDslNumericLiteral("9", 1, 1)).toBe("10");
    expect(stepDslNumericLiteral("0", 10, -1)).toBe("-10");
    expect(stepDslNumericLiteral("0", 100, 1)).toBe("100");
  });

  it("rejects expressions, units, and exponent syntax", () => {
    for (const value of ["a + 1", "10mm", "1e3", '"1"']) {
      expect(stepDslNumericLiteral(value, 1, 1)).toBeNull();
    }
  });
});

describe("resolveDslValueStep", () => {
  it("uses the 3a target resolver for normal, dirty coordinate, and configured numeric values", () => {
    const pointSource = "point A = (0.1, 2)";
    const point = { ...compileElement(pointSource), numericParameterSteps: { x: 0.2 } };
    expect(stepAt(pointSource, point, "0.1", 1)).toMatchObject({ parameterKey: "x", insert: "0.3" });

    const committed = "line L = A -> B";
    const line = compileElement(committed);
    const dirty = "line L = (1, 2) -> B";
    expect(stepAt(dirty, line, "1", 1, committed)).toMatchObject({ parameterKey: "startPoint:x", insert: "2" });
  });

  it("uses the current configured ratio and angle step without adding level switching", () => {
    const divisionSource = "point M = between A B ratio=0.25";
    const division = { ...compileElement(divisionSource), numericParameterSteps: { ratio: 0.01 } };
    expect(stepAt(divisionSource, division, "0.25", 1)).toMatchObject({ parameterKey: "ratio", insert: "0.26" });

    const arcSource = "arc Arc center=A radius=10 start=15 end=90";
    const arc = { ...compileElement(arcSource), numericParameterSteps: { startAngleDeg: 15 } };
    expect(stepAt(arcSource, arc, "start=15".slice(-2), 1)).toMatchObject({ parameterKey: "startAngleDeg", insert: "30" });
  });

  it("steps only the selected numeric literal inside expressions, including quoted expressions", () => {
    const variableSource = "var 変数1 = 13 + 1";
    const variable = compileElement(variableSource);
    expect(stepAt(variableSource, variable, "13", 1)).toMatchObject({
      parameterKey: "expression", from: variableSource.indexOf("13"), to: variableSource.indexOf("13") + 2, insert: "14"
    });
    const trailingOne = variableSource.lastIndexOf("1");
    expect(resolveDslValueStep(variableSource, variable, { start: trailingOne, end: trailingOne }, 1)).toMatchObject({
      parameterKey: "expression", from: variableSource.lastIndexOf("1"), to: variableSource.length, insert: "2"
    });

    const offsetSource = 'point B = offset A dx="@変数1 * 2" dy=0';
    const offset = { ...compileElement(offsetSource), numericParameterSteps: { dx: 0.25 } };
    expect(stepAt(offsetSource, offset, "2", 1)).toMatchObject({
      parameterKey: "dx", from: offsetSource.lastIndexOf("2"), to: offsetSource.lastIndexOf("2") + 1, insert: "2.25"
    });
  });

  it("uses the default step for synthetic coordinates and preserves signed literal selection", () => {
    const committed = "line L = A -> B";
    const line = compileElement(committed);
    const dirty = "line L = (-0.5 + 1, 2) -> B";
    const start = dirty.indexOf("-0.5");
    expect(resolveDslValueStep(dirty, line, { start, end: start }, 1, { committedLineText: committed })).toMatchObject({
      parameterKey: "startPoint:x", from: start, to: start + 4, insert: "0.5",
      selection: { start, end: start + 3 }
    });
  });

  it("rejects expression-wide and partial selections, terminal carets before another token, and non-literals", () => {
    const source = "point B = offset A dx=12+3 dy=0";
    const element = compileElement(source);
    const expressionStart = source.indexOf("12+3");
    expect(resolveDslValueStep(source, element, { start: expressionStart, end: expressionStart + 4 }, 1)).toBeNull();
    expect(resolveDslValueStep(source, element, { start: expressionStart, end: expressionStart + 1 }, 1)).toBeNull();
    expect(resolveDslValueStep(source, element, { start: expressionStart + 2, end: expressionStart + 2 }, 1)).toBeNull();

    for (const expression of ["1e3", "10mm", "version 2", "@value1"]) {
      const live = `point B = offset A dx=${expression} dy=0`;
      const start = live.indexOf(expression);
      expect(resolveDslValueStep(live, element, { start, end: start }, 1)).toBeNull();
    }

    const textSource = 'text Label = "version 2" at=A size=4';
    const text = compileElement(textSource);
    const textStart = textSource.indexOf("2");
    expect(resolveDslValueStep(textSource, text, { start: textStart, end: textStart }, 1)).toBeNull();
  });

  it("toggles booleans and cycles choices, but leaves other parameter kinds untouched", () => {
    const booleanSource = "point A = (0, 0) locked=true";
    const point = compileElement(booleanSource);
    expect(stepAt(booleanSource, point, "true", 1)).toMatchObject({ parameterKey: "locked", insert: "false" });
    expect(stepAt(booleanSource, point, "true", -1)).toMatchObject({ parameterKey: "locked", insert: "false" });

    const choiceSource = "var V = 1 scope=global";
    const variable = compileElement(choiceSource);
    expect(stepAt(choiceSource, variable, "global", 1)).toMatchObject({ parameterKey: "scope", insert: "group" });
    expect(stepAt(choiceSource, variable, "global", -1)).toMatchObject({ parameterKey: "scope", insert: "group" });
    const wrappedChoiceSource = "var V = 1 scope=group";
    const wrappedVariable = compileElement(wrappedChoiceSource);
    expect(stepAt(wrappedChoiceSource, wrappedVariable, "group", 1)).toMatchObject({ parameterKey: "scope", insert: "global" });
    expect(stepAt(wrappedChoiceSource, wrappedVariable, "group", -1)).toMatchObject({ parameterKey: "scope", insert: "global" });

    const textSource = 'text Label = "true" at=A size=4';
    const text = compileElement(textSource);
    expect(stepAt(textSource, text, "true", 1)).toBeNull();

    const lineSource = "line L = A -> B";
    const line = compileElement(lineSource);
    expect(stepAt(lineSource, line, "A", 1)).toBeNull();
    expect(stepAt(lineSource, line, "line", 1)).toBeNull();

    const coloredLineSource = "line L = A -> B color=red";
    const coloredLine = compileElement(coloredLineSource);
    expect(stepAt(coloredLineSource, coloredLine, "red", 1)).toBeNull();
  });

  it("accepts a caret at a target start or end, and exact target selection, never a partial selection", () => {
    const source = "point A = (12, 0)";
    const point = compileElement(source);
    const start = source.indexOf("12");
    expect(resolveDslValueStep(source, point, { start, end: start + 2 }, 1)).toMatchObject({ insert: "13" });
    expect(resolveDslValueStep(source, point, { start, end: start + 1 }, 1)).toBeNull();
    expect(resolveDslValueStep(source, point, { start: start + 2, end: start + 2 }, 1)).toMatchObject({ insert: "13" });
  });

  it("keeps the updated literal selected across digit, sign, and decimal changes", () => {
    const cases: Array<{ source: string; direction: 1 | -1; expected: string }> = [
      { source: "point B = offset A dx=130 dy=9", direction: 1, expected: "10" },
      { source: "point B = offset A dx=130 dy=99", direction: 1, expected: "100" },
      { source: "point B = offset A dx=130 dy=10", direction: -1, expected: "9" },
      { source: "point B = offset A dx=130 dy=-1", direction: -1, expected: "-2" },
      { source: "point B = offset A dx=130 dy=-0.5", direction: 1, expected: "0.5" }
    ];
    for (const { source, direction, expected } of cases) {
      const element = compileElement(source);
      const start = source.lastIndexOf("dy=") + 3;
      const result = resolveDslValueStep(source, element, { start: source.length, end: source.length }, direction);
      expect(result).toMatchObject({ parameterKey: "dy", insert: expected });
      expect(result?.selection).toEqual({ start, end: start + expected.length });
    }
  });
});
