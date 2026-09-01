import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createElementNameContext } from "../model/elementNames";
import {
  addToNumericValue,
  evaluateNumericValue,
  formatNumericExpressionForDisplay,
  makeNumericExpression,
  normalizeNumericExpressionInput
} from "./numericExpressions";
import type { CadElement } from "../types/geometry";
import { evaluateElements } from "./evaluate";
import { propertyLabels } from "./numericExpressionProperties";

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
  it("resolves duplicate names from the current group namespace and qualified paths", () => {
    const elements: CadElement[] = [
      {
        id: "front",
        name: "前身頃",
        type: "group",
        activity: "visible",
      },
      {
        id: "back",
        name: "後身頃",
        type: "group",
        activity: "visible",
      },
      {
        id: "front-line",
        name: "脇線",
        type: "line",
        activity: "visible",
        parentGroupId: "front",
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "back-line",
        name: "脇線",
        type: "line",
        activity: "visible",
        parentGroupId: "back",
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      }
    ];

    expect(normalizeNumericExpressionInput("脇線.長さ", elements, elements[2])).toBe(
      "front-line.length"
    );
    expect(normalizeNumericExpressionInput("後身頃::脇線.長さ", elements, elements[2])).toBe(
      "back-line.length"
    );
  });

  it("restores only unaffected Japanese property-input aliases and evaluates them", () => {
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        x: 100,
        y: 0
      },
      {
        id: "curve-ac",
        name: "曲線AC",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "point-b" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ];

    expect(normalizeNumericExpressionInput("曲線AC.始点ハンドル長", elements)).toBe(
      "curve-ac.startHandleLength"
    );
    expect(normalizeNumericExpressionInput("曲線AC.終点ハンドル長", elements)).toBe(
      "curve-ac.endHandleLength"
    );
    const evaluation = evaluateElements(elements);
    const evaluated = evaluateNumericValue({
      value: makeNumericExpression(
        normalizeNumericExpressionInput(
          "曲線AC.始点ハンドル長 + 曲線AC.終点ハンドル長",
          elements
        )
      ),
      computedGeometry: evaluation.computedGeometry,
      elementsById: new Map(elements.map((element) => [element.id, element])),
      elements
    });
    expect(evaluated).toEqual({ value: 40 });

    expect(normalizeNumericExpressionInput("曲線AC.長さ + 5", elements)).toBe(
      "curve-ac.length + 5"
    );
    expect(normalizeNumericExpressionInput("曲線AC.長さ > 0", elements)).toBe(
      "curve-ac.length > 0"
    );
    expect(normalizeNumericExpressionInput("曲線AC.長さ >= 100  or  曲線AC.長さ == 0", elements)).toBe(
      "curve-ac.length >= 100  or  curve-ac.length == 0"
    );
  });

  it("does not infer input aliases from presentation labels or restore removed angle spellings", () => {
    const curve: CadElement = {
      id: "curve-ac",
      name: "曲線AC",
      type: "bezierCurve",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "a" },
      startHandleAngleDeg: 0,
      startHandleLength: 20,
      intermediatePoints: [],
      endPoint: { mode: "reference", pointId: "b" },
      endHandleAngleDeg: 0,
      endHandleLength: 20
    };
    const removedAliases = [
      "始角度",
      "終角度",
      "始接線角度",
      "終接線角度",
      "始点接線角度",
      "終点接線角度",
      "始点角度",
      "終点角度",
      "始点ハンドル角度",
      "終点ハンドル角度"
    ];

    expect(normalizeNumericExpressionInput(`曲線AC.${propertyLabels.startAngleDeg}`, [curve])).toBe(
      `curve-ac.${propertyLabels.startAngleDeg}`
    );
    for (const alias of removedAliases) {
      expect(normalizeNumericExpressionInput(`曲線AC.${alias}`, [curve])).toBe(`curve-ac.${alias}`);
    }
  });

  it("formats Bezier intermediate point references with their point index", () => {
    const elements: CadElement[] = [
      {
        id: "curve-ac",
        name: "曲線AC",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [
          {
            id: "mid-a",
            point: { mode: "coordinate", x: 10, y: 10 },
            handleAngleDeg: 45,
            incomingHandleLength: 10,
            outgoingHandleLength: 10
          },
          {
            id: "mid-b",
            point: { mode: "coordinate", x: 20, y: 10 },
            handleAngleDeg: 45,
            incomingHandleLength: 10,
            outgoingHandleLength: 10
          }
        ],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ];

    expect(
      formatNumericExpressionForDisplay(
        makeNumericExpression("distance(curve-ac:intermediate:mid-b, curve-ac:end)"),
        elements
      )
    ).toBe("distance(曲線AC.中間点2, 曲線AC.終点)");
  });

  it("normalizes the nui 1 sigil form of an element property reference (Task 51)", () => {
    const elements: CadElement[] = [
      {
        id: "line-ab",
        name: "AB",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];

    expect(normalizeNumericExpressionInput("@AB.length + 5", elements)).toBe("line-ab.length + 5");
    expect(normalizeNumericExpressionInput("AB.length + 5", elements)).toBe(
      normalizeNumericExpressionInput("@AB.length + 5", elements)
    );
  });

  it("keeps Japanese-label properties unchanged in the nui 1 sigil form", () => {
    const elements: CadElement[] = [
      {
        id: "curve-ac",
        name: "曲線AC",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "c" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ];

    expect(normalizeNumericExpressionInput("@曲線AC.長さ + 5", elements)).toBe("curve-ac.length + 5");
    expect(normalizeNumericExpressionInput("@曲線AC.長さ >= 100  or  @曲線AC.長さ == 0", elements)).toBe(
      "curve-ac.length >= 100  or  curve-ac.length == 0"
    );
  });

  it("normalizes a multi-segment sigil property path (startPoint.x)", () => {
    const elements: CadElement[] = [
      {
        id: "line-ab",
        name: "AB",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];

    expect(normalizeNumericExpressionInput("@AB.startPoint.x", elements)).toBe("line-ab.startPoint.x");
  });

  it("normalizes @Self.property as an element-property reference (Rule R review fix)", () => {
    const point: CadElement = {
      id: "point-a",
      name: "袖",
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    };

    // The sigil is dropped and the token resolves as an ordinary
    // (self-referencing) element-property IR rather
    // than being left as an unconverted `@袖.length`. Evaluation, not
    // normalize, is what later rejects the self-reference.
    expect(normalizeNumericExpressionInput("@袖.length", [point], point)).toBe("point-a.length");
  });

  it("resolves an element-property reference even when a same-named binding exists elsewhere", () => {
    const point: CadElement = {
      id: "point-ab",
      name: "AB",
      type: "freePoint",
      activity: "visible",
      x: 0,
      y: 0
    };
    const line: CadElement = {
      id: "line-cd",
      name: "CD",
      type: "line",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "point-ab" },
      endPoint: { mode: "reference", pointId: "point-ab" }
    };
    const elements = [point, line];

    // `@AB` (no dot) stays a plain reference token (resolved elsewhere as a
    // binding/variable name); `@AB.length`... here AB is a freePoint with no
    // length property recognized by the measurable/nameTokens loops for a
    // point type specifically other than via the generic dot form, which
    // still lowers to the bare id form regardless of property validity -
    // downstream evaluation is what rejects an unrecognized property.
    expect(normalizeNumericExpressionInput("@CD.length", elements)).toBe("line-cd.length");
  });

  it("keeps a self-referencing Japanese property label out of source aliases", () => {
    const curve: CadElement = {
      id: "curve-ac",
      name: "曲線AC",
      type: "bezierCurve",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "a" },
      startHandleAngleDeg: 0,
      startHandleLength: 20,
      intermediatePoints: [],
      endPoint: { mode: "reference", pointId: "c" },
      endHandleAngleDeg: 0,
      endHandleLength: 20
    };

    // The unaffected length label remains an explicit input alias, even on a
    // self-reference; changed presentation labels remain display-only.
    expect(
      normalizeNumericExpressionInput("@曲線AC.長さ", [curve], curve)
    ).toBe("curve-ac.length");
  });

  it("falls through to the element-property arm for a self-referencing multi-segment property path", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "AB",
      type: "line",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };

    expect(
      normalizeNumericExpressionInput("@AB.startPoint.x", [line], line)
    ).toBe("line-ab.startPoint.x");
  });

  it("normalizes element names inside numeric measurement functions", () => {
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        x: 10,
        y: 0
      },
      {
        id: "line-ab",
        name: "直線AB",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];

    expect(normalizeNumericExpressionInput("distance(点A, 点B) + 点線距離(点B, 直線AB)", elements)).toBe(
      "distance(point-a, point-b) + 点線距離(point-b, line-ab)"
    );
  });

  it("keeps fixed normalization cases equivalent with and without a prebuilt name context", () => {
    const elements: CadElement[] = [
      {
        id: "front",
        name: "前身頃",
        type: "group",
        activity: "visible",
      },
      {
        id: "line-front",
        name: "脇線",
        type: "line",
        activity: "visible",
        parentGroupId: "front",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "curve-front",
        name: "曲線",
        type: "bezierCurve",
        activity: "visible",
        parentGroupId: "front",
        startPoint: { mode: "reference", pointId: "point-a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "point-b" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      }
    ];
    const context = createElementNameContext(elements);
    const current = elements[1];

    for (const source of [
      "distance(\"前身頃::脇線\":start, 前身頃::脇線:end)",
      "曲線.始点ハンドル長 + 曲線.終点ハンドル長",
      "42",
      "unrelated + 1"
    ]) {
      expect(normalizeNumericExpressionInput(source, elements, current, context)).toBe(
        normalizeNumericExpressionInput(source, elements, current)
      );
    }
  });

  it("keeps generated normalization inputs equivalent with and without a prebuilt name context", () => {
    const elements: CadElement[] = [
      {
        id: "group-front",
        name: "前身頃",
        type: "group",
        activity: "visible",
      },
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "group-front",
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "group-front",
        x: 10,
        y: 0
      },
      {
        id: "line-ab",
        name: "脇線",
        type: "line",
        activity: "visible",
        parentGroupId: "group-front",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];
    const current = elements[3];
    const context = createElementNameContext(elements);
    const fragments = [
      "脇線", "前身頃::脇線", "\"前身頃::脇線\"", "点A", "点B",
      ".長さ", ".length", ":start", ":end",
      "distance(", "点線距離(", ", ", ") + ", " + ", " - ", " * 2", "42", " "
    ];

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...fragments), { minLength: 1, maxLength: 12 }).map((parts) => parts.join("")),
        (source) => {
          expect(normalizeNumericExpressionInput(source, elements, current, context)).toBe(
            normalizeNumericExpressionInput(source, elements, current)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("formats numeric measurement function element ids for display", () => {
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        x: 10,
        y: 0
      }
    ];

    expect(formatNumericExpressionForDisplay(expression("距離(point-a, point-b)"), elements)).toBe(
      "距離(点A, 点B)"
    );
  });

});
