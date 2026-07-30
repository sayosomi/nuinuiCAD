import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createElementNameContext } from "../model/elementNames";
import {
  addToNumericValue,
  formatNumericExpressionForDisplay,
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
  it("resolves duplicate names from the current group namespace and qualified paths", () => {
    const elements: CadElement[] = [
      {
        id: "front",
        name: "前身頃",
        type: "group",
        visible: true,
        enabled: true,
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "back",
        name: "後身頃",
        type: "group",
        visible: true,
        enabled: true,
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "front-line",
        name: "脇線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "front",
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "b" }
      },
      {
        id: "back-line",
        name: "脇線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "back",
        startPoint: { mode: "reference", pointId: "c" },
        endPoint: { mode: "reference", pointId: "d" }
      }
    ];

    expect(normalizeNumericExpressionInput("脇線.長さ", elements, [], elements[2])).toBe(
      "front-line.length"
    );
    expect(normalizeNumericExpressionInput("後身頃::脇線.長さ", elements, [], elements[2])).toBe(
      "back-line.length"
    );
  });

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
    expect(normalizeNumericExpressionInput("曲線AC.長さ > 0", elements)).toBe(
      "curve-ac.length > 0"
    );
    expect(normalizeNumericExpressionInput("曲線AC.長さ >= 100 || 曲線AC.長さ == 0", elements)).toBe(
      "curve-ac.length >= 100 || curve-ac.length == 0"
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

  it("formats Bezier intermediate point references with their point index", () => {
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

  it("normalizes qualified local variables and global variable display names", () => {
    const variable: CadElement = {
      id: "base-variable",
      name: "基準寸法",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 20,
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };
    const point: CadElement = {
      id: "point-a",
      name: "袖",
      type: "freePoint",
      visible: true,
      enabled: true,
      numericVariables: [{ id: "local-width", name: "寸法", value: 30 }],
      x: 0,
      y: 0
    };
    const elements = [variable, point];

    expect(
      normalizeNumericExpressionInput(
        "@袖.寸法 + @基準寸法",
        elements,
        point.numericVariables ?? [],
        point
      )
    ).toBe("@local-width + @base-variable");
  });

  it("normalizes the nui 3 sigil form of an element property reference (Task 51)", () => {
    const elements: CadElement[] = [
      {
        id: "line-ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];

    expect(normalizeNumericExpressionInput("@AB.length + 5", elements)).toBe("line-ab.length + 5");
    expect(normalizeNumericExpressionInput("AB.length + 5", elements)).toBe(
      normalizeNumericExpressionInput("@AB.length + 5", elements)
    );
  });

  it("normalizes the nui 3 sigil form of a Japanese-label element property reference", () => {
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

    expect(normalizeNumericExpressionInput("@曲線AC.長さ + 5", elements)).toBe("curve-ac.length + 5");
    expect(normalizeNumericExpressionInput("@曲線AC.長さ >= 100 || @曲線AC.長さ == 0", elements)).toBe(
      "curve-ac.length >= 100 || curve-ac.length == 0"
    );
  });

  it("normalizes a multi-segment sigil property path (startPoint.x)", () => {
    const elements: CadElement[] = [
      {
        id: "line-ab",
        name: "AB",
        type: "line",
        visible: true,
        enabled: true,
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];

    expect(normalizeNumericExpressionInput("@AB.startPoint.x", elements)).toBe("line-ab.startPoint.x");
  });

  it("does not normalize @Self.property when Self has no matching local variable (leaves it for dangling-reference diagnostics)", () => {
    const point: CadElement = {
      id: "point-a",
      name: "袖",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 0,
      y: 0
    };

    expect(normalizeNumericExpressionInput("@袖.length", [point], [], point)).toBe("@袖.length");
  });

  it("resolves an element-property reference even when a same-named binding exists elsewhere", () => {
    const point: CadElement = {
      id: "point-ab",
      name: "AB",
      type: "freePoint",
      visible: true,
      enabled: true,
      x: 0,
      y: 0
    };
    const line: CadElement = {
      id: "line-cd",
      name: "CD",
      type: "line",
      visible: true,
      enabled: true,
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

  it("does not normalize ambiguous local variable display names", () => {
    const point: CadElement = {
      id: "point-a",
      name: "袖",
      type: "freePoint",
      visible: true,
      enabled: true,
      numericVariables: [
        { id: "local-width-1", name: "寸法", value: 30 },
        { id: "local-width-2", name: "寸法", value: 40 }
      ],
      x: 0,
      y: 0
    };

    expect(
      normalizeNumericExpressionInput(
        "@袖.寸法",
        [point],
        point.numericVariables ?? [],
        point
      )
    ).toBe("@袖.寸法");
  });

  it("normalizes element names inside numeric measurement functions", () => {
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      },
      {
        id: "line-ab",
        name: "直線AB",
        type: "line",
        visible: true,
        enabled: true,
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
        visible: true,
        enabled: true,
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "line-front",
        name: "脇線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "front",
        numericVariables: [{ id: "local-width", name: "寸法", value: 30 }],
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "curve-front",
        name: "曲線",
        type: "bezierCurve",
        visible: true,
        enabled: true,
        parentGroupId: "front",
        startPoint: { mode: "reference", pointId: "point-a" },
        startHandleAngleDeg: 0,
        startHandleLength: 20,
        intermediatePoints: [],
        endPoint: { mode: "reference", pointId: "point-b" },
        endHandleAngleDeg: 0,
        endHandleLength: 20
      },
      {
        id: "variable-front",
        name: "基準寸法",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 20,
        point1: { mode: "reference", pointId: "point-a" },
        point2: { mode: "reference", pointId: "point-b" },
        point: { mode: "reference", pointId: "point-a" },
        lineId: "line-front"
      }
    ];
    const context = createElementNameContext(elements);
    const current = elements[1];
    const locals = current.numericVariables ?? [];

    for (const source of [
      "脇線.長さ + @寸法",
      "@脇線.寸法 + @基準寸法",
      "distance(\"前身頃::脇線\":start, 前身頃::脇線:end)",
      "曲線.始点ハンドル長 + 曲線.終点ハンドル長",
      "42",
      "unrelated + 1"
    ]) {
      expect(normalizeNumericExpressionInput(source, elements, locals, current, context)).toBe(
        normalizeNumericExpressionInput(source, elements, locals, current)
      );
    }
  });

  it("keeps generated normalization inputs equivalent with and without a prebuilt name context", () => {
    const elements: CadElement[] = [
      {
        id: "group-front",
        name: "前身頃",
        type: "group",
        visible: true,
        enabled: true,
        printEnabled: false,
        printAnchor: { mode: "coordinate", x: 0, y: 0 }
      },
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "group-front",
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        parentGroupId: "group-front",
        x: 10,
        y: 0
      },
      {
        id: "line-ab",
        name: "脇線",
        type: "line",
        visible: true,
        enabled: true,
        parentGroupId: "group-front",
        numericVariables: [{ id: "local-width", name: "寸法", value: 30 }],
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "variable-base",
        name: "基準寸法",
        type: "variable",
        visible: true,
        enabled: true,
        scope: "global",
        valueMode: "expression",
        expression: 20,
        point1: { mode: "reference", pointId: "point-a" },
        point2: { mode: "reference", pointId: "point-b" },
        point: { mode: "reference", pointId: "point-a" },
        lineId: "line-ab"
      }
    ];
    const current = elements[3];
    const context = createElementNameContext(elements);
    const locals = current.numericVariables ?? [];
    const fragments = [
      "脇線", "前身頃::脇線", "\"前身頃::脇線\"", "点A", "点B",
      ".長さ", ".length", ":start", ":end", "@寸法", "@脇線.寸法", "@基準寸法",
      "distance(", "点線距離(", ", ", ") + ", " + ", " - ", " * 2", "42", " "
    ];

    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...fragments), { minLength: 1, maxLength: 12 }).map((parts) => parts.join("")),
        (source) => {
          expect(normalizeNumericExpressionInput(source, elements, locals, current, context)).toBe(
            normalizeNumericExpressionInput(source, elements, locals, current)
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
        visible: true,
        enabled: true,
        x: 0,
        y: 0
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        visible: true,
        enabled: true,
        x: 10,
        y: 0
      }
    ];

    expect(formatNumericExpressionForDisplay(expression("距離(point-a, point-b)"), elements)).toBe(
      "距離(点A, 点B)"
    );
  });

  it("formats local and global variable ids for display", () => {
    const variable: CadElement = {
      id: "base-variable",
      name: "基準寸法",
      type: "variable",
      visible: true,
      enabled: true,
      scope: "global",
      valueMode: "expression",
      expression: 20,
      point1: { mode: "reference", pointId: "point-a" },
      point2: { mode: "reference", pointId: "point-b" },
      point: { mode: "reference", pointId: "point-a" },
      lineId: "line-ab"
    };
    const point: CadElement = {
      id: "point-a",
      name: "袖",
      type: "freePoint",
      visible: true,
      enabled: true,
      numericVariables: [{ id: "local-width", name: "寸法", value: 30 }],
      x: { kind: "expression", expression: "@local-width + @base-variable" },
      y: 0
    };

    expect(
      formatNumericExpressionForDisplay(
        expression("@local-width + @base-variable"),
        [variable, point],
        point.numericVariables ?? [],
        point
      )
    ).toBe("@袖.寸法 + @基準寸法");
  });

  it("falls back to local variable ids when display names are ambiguous", () => {
    const point: CadElement = {
      id: "point-a",
      name: "袖",
      type: "freePoint",
      visible: true,
      enabled: true,
      numericVariables: [
        { id: "local-width-1", name: "寸法", value: 30 },
        { id: "local-width-2", name: "寸法", value: 40 }
      ],
      x: 0,
      y: 0
    };

    expect(
      formatNumericExpressionForDisplay(
        expression("@local-width-1 + @local-width-2"),
        [point],
        point.numericVariables ?? [],
        point
      )
    ).toBe("@local-width-1 + @local-width-2");
  });
});
