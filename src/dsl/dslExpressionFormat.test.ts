import { describe, expect, it } from "vitest";
import { normalizeNumericExpressionInput } from "../geometry/numericExpressions";
import { createElementNameContext } from "../model/elementNames";
import type { NumericVariable } from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { formatNumericValueForDsl } from "./dslExpressionFormat";

const buildElements = () => {
  const result = compileDslToElements(
    [
      "group G (id: g1) {",
      "}",
      "point A = coordinate(x: 0, y: 0, id: p1)",
      "point \"前 上\" = coordinate(x: 0, y: 1, id: p10)",
      "point X = coordinate(x: 3, y: 3, id: p2)",
      "point X = coordinate(x: 4, y: 4, id: p3, parent: @g1)",
      "line AB = segment(start: @A, end: @\"前 上\", id: l1)"
    ].join("\n"),
    { elements: [] }
  );
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return result.elements;
};

const elements = buildElements();

const roundTrip = (expression: string, localVariables: NumericVariable[] = []) =>
  normalizeNumericExpressionInput(
    formatNumericValueForDsl({ kind: "expression", expression }, elements, localVariables),
    elements,
    localVariables
  );

describe("formatNumericValueForDsl", () => {
  it("formats plain numbers like the serializer", () => {
    expect(formatNumericValueForDsl(42, elements)).toBe("42");
    expect(formatNumericValueForDsl(-1.5, elements)).toBe("-1.5");
  });

  it("round-trips element-local numeric variable references", () => {
    const localVariables: NumericVariable[] = [{ id: "v1", name: "bust", value: 840 }];
    expect(formatNumericValueForDsl({ kind: "expression", expression: "@v1 / 4" }, elements, localVariables)).toBe("@bust / 4");
    expect(roundTrip("@v1 / 4", localVariables)).toBe("@v1 / 4");
  });

  it("round-trips measurement property references with English keys", () => {
    expect(formatNumericValueForDsl({ kind: "expression", expression: "l1.length + 20" }, elements)).toBe("@AB.length + 20");
    expect(roundTrip("l1.length + 20")).toBe("l1.length + 20");
  });

  it("round-trips bare ids in function arguments", () => {
    expect(formatNumericValueForDsl({ kind: "expression", expression: "distance(p1, l1)" }, elements)).toBe("distance(A, AB)");
    expect(roundTrip("distance(p1, l1)")).toBe("distance(p1, l1)");
  });

  it("round-trips derived point references in function arguments", () => {
    expect(formatNumericValueForDsl({ kind: "expression", expression: "distance(l1:start, p1)" }, elements)).toBe("distance(AB:start, A)");
    expect(roundTrip("distance(l1:start, p1)")).toBe("distance(l1:start, p1)");
  });

  it("uses qualified tokens for shadowed names in other scopes", () => {
    const formatted = formatNumericValueForDsl({ kind: "expression", expression: "distance(p2, p3)" }, elements);
    expect(formatted).toBe("distance(X, G::X)");
    expect(roundTrip("distance(p2, p3)")).toBe("distance(p2, p3)");
  });

  it("round-trips names that contain spaces", () => {
    expect(roundTrip("distance(p10, p1)")).toBe("distance(p10, p1)");
    expect(roundTrip("p10.x + 1")).toBe("p10.x + 1");
  });

  it("emits the nui4 sigil for a measurement property reference", () => {
    expect(
      formatNumericValueForDsl({ kind: "expression", expression: "l1.length + 20" }, elements)
    ).toBe("@AB.length + 20");
  });

  it("correctly locates the element head for a multi-segment property path (fixes a pre-Task-51 greedy-match bug)", () => {
    expect(
      formatNumericValueForDsl({ kind: "expression", expression: "l1.startPoint.x" }, elements)
    ).toBe("@AB.startPoint.x");
  });

  it("round-trips the nui 4 sigil form through normalize", () => {
    const asV4 = formatNumericValueForDsl({ kind: "expression", expression: "l1.length + 20" }, elements);
    expect(normalizeNumericExpressionInput(asV4, elements)).toBe("l1.length + 20");
  });

  it("keeps unresolvable ids as raw tokens without throwing", () => {
    expect(formatNumericValueForDsl({ kind: "expression", expression: "@variable-missing + 5" }, elements)).toBe("@variable-missing + 5");
    expect(formatNumericValueForDsl({ kind: "expression", expression: "missing-id.length" }, elements)).toBe("missing-id.length");
  });

  it("round-trips local variables such as layout variables", () => {
    const locals: NumericVariable[] = [{ id: "print-variable-1", name: "余白", value: 20 }];
    expect(
      formatNumericValueForDsl({ kind: "expression", expression: "@print-variable-1 * 2" }, elements, locals)
    ).toBe("@余白 * 2");
    expect(roundTrip("@print-variable-1 * 2", locals)).toBe("@print-variable-1 * 2");
  });

  it("keeps ambiguous local variable names as raw ids", () => {
    const locals: NumericVariable[] = [
      { id: "print-variable-1", name: "n", value: 1 },
      { id: "print-variable-2", name: "n", value: 2 }
    ];
    expect(
      formatNumericValueForDsl({ kind: "expression", expression: "@print-variable-1 + 1" }, elements, locals)
    ).toBe("@print-variable-1 + 1");
  });

  it("keeps formatting equivalent with and without a prebuilt name context", () => {
    const context = createElementNameContext(elements);
    const locals: NumericVariable[] = [{ id: "print-variable-1", name: "余白", value: 20 }];

    for (const value of [
      { kind: "expression" as const, expression: "@v1 / 4" },
      { kind: "expression" as const, expression: "distance(p1, l1) + l1.length" },
      { kind: "expression" as const, expression: "distance(p2, p3)" },
      { kind: "expression" as const, expression: "@print-variable-1 * 2" },
      42
    ]) {
      expect(formatNumericValueForDsl(value, elements, locals, undefined, context)).toBe(
        formatNumericValueForDsl(value, elements, locals)
      );
    }
  });
});
