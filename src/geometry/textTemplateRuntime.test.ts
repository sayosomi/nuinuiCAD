import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import type { ScalarValueSource } from "../scalars/propertyBindingCompiler";
import type { TextTemplateAst, TextTemplateSegment } from "../scalars/textTemplate";
import type { ScalarEvaluation } from "../scalars/types";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { evaluateElements } from "./evaluate";
import {
  buildTextPropertyBindingRuntimeEntries,
  buildTextTemplateEntriesByElementId,
  evaluateElementTextTemplate,
  toRustTextTemplateSegments
} from "./textTemplateRuntime";

const span = (start: number, end: number) => ({ start, end });

const literalSegment = (cooked: string): TextTemplateSegment => ({
  kind: "literal",
  span: span(0, cooked.length),
  cookedRange: span(0, cooked.length),
  cooked
});

const numericHoleSegment = (raw: string): TextTemplateSegment => ({
  kind: "hole",
  holeKind: "numeric",
  span: span(0, raw.length),
  contentSpan: span(0, raw.length),
  cookedInsertOffset: 0,
  raw
});

const stringHoleSegment = (bindingId: string): TextTemplateSegment => ({
  kind: "hole",
  holeKind: "string",
  span: span(0, 1),
  contentSpan: span(0, 1),
  cookedInsertOffset: 0,
  expression: {
    kind: "reference",
    span: span(0, 0),
    nameSpan: span(0, 0),
    name: bindingId,
    bindingId,
    type: { kind: "string" }
  } satisfies TypedScalarExpression
});

const templateOf = (segments: readonly TextTemplateSegment[]): TextTemplateAst => ({
  span: span(0, 0),
  quote: '"',
  raw: "",
  segments,
  dependencies: []
});

describe("buildTextTemplateEntriesByElementId", () => {
  it("re-keys statementIndex:text occurrences to elementId", () => {
    const ast = templateOf([literalSegment("hi")]);
    const result = buildTextTemplateEntriesByElementId({
      textTemplates: new Map([["2:text", ast]]),
      elementIdByStatementIndex: new Map([[2, "text-1"]])
    });
    expect(result.get("text-1")).toBe(ast);
    expect(result.size).toBe(1);
  });

  it("drops occurrences whose statement never produced an element", () => {
    const ast = templateOf([literalSegment("hi")]);
    const result = buildTextTemplateEntriesByElementId({
      textTemplates: new Map([["2:text", ast]]),
      elementIdByStatementIndex: new Map()
    });
    expect(result.size).toBe(0);
  });
});

describe("toRustTextTemplateSegments", () => {
  it("projects only compiled evaluation data", () => {
    expect(toRustTextTemplateSegments(templateOf([
      literalSegment("hi"),
      numericHoleSegment("@AB.length"),
      stringHoleSegment("binding:x")
    ]))).toEqual([
      { kind: "literal", cooked: "hi" },
      { kind: "hole", holeKind: "numeric", raw: "@AB.length" },
      expect.objectContaining({ kind: "hole", holeKind: "string" })
    ]);
  });
});

describe("buildTextPropertyBindingRuntimeEntries", () => {
  const textElement: CadElement = {
    id: "text-1",
    name: "注記",
    type: "text",
    activity: "visible",
    text: "",
    anchor: null,
    fontSize: 3
  };

  it("re-keys a bound bare @binding text.text source into an entry", () => {
    const binding: ScalarValueSource = {
      kind: "binding",
      bindingId: "binding:label",
      type: { kind: "string" },
      span: span(0, 0),
      nameSpan: span(0, 0),
      name: "ラベル"
    };
    const entries = buildTextPropertyBindingRuntimeEntries(
      { propertyBindings: new Map([["0:text", binding]]), elementIdByStatementIndex: new Map([[0, "text-1"]]) },
      [textElement]
    );
    expect(entries).toEqual([{ elementId: "text-1", parameterKey: "text", bindingId: "binding:label", expectedType: { kind: "string" } }]);
  });

  it("ignores a literal (unbound) source", () => {
    const entries = buildTextPropertyBindingRuntimeEntries(
      { propertyBindings: new Map([["0:text", { kind: "literal" }]]), elementIdByStatementIndex: new Map([[0, "text-1"]]) },
      [textElement]
    );
    expect(entries).toEqual([]);
  });

  it("ignores property bindings on element types outside TEXT_PROPERTY_TARGETS", () => {
    const nonTextElement: CadElement = { id: "line-1", name: "線", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } };
    const binding: ScalarValueSource = {
      kind: "binding",
      bindingId: "binding:x",
      type: { kind: "string" },
      span: span(0, 0),
      nameSpan: span(0, 0),
      name: "x"
    };
    const entries = buildTextPropertyBindingRuntimeEntries(
      { propertyBindings: new Map([["0:text", binding]]), elementIdByStatementIndex: new Map([[0, "line-1"]]) },
      [nonTextElement]
    );
    expect(entries).toEqual([]);
  });
});

describe("evaluateElementTextTemplate", () => {
  const currentElement: CadElement = { id: "text-1", name: "注記", type: "text", activity: "visible", text: "", anchor: null, fontSize: 3 };
  const resolveBinding = (values: Record<string, ScalarEvaluation>) => (bindingId: string): ScalarEvaluation => {
    const value = values[bindingId];
    if (!value) throw new Error(`unexpected lookupBinding("${bindingId}")`);
    return value;
  };

  it("evaluates a compiled numeric-expression hole through the local numeric evaluator", () => {
    const points: CadElement[] = [
      { id: "a", name: "点A", type: "freePoint", activity: "visible", x: 10, y: 20 },
      { id: "b", name: "点B", type: "offsetPoint", activity: "visible", fromPointId: "a", dx: 30, dy: 5 },
      { id: "ab", name: "直線AB", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } }
    ];
    const evaluated = evaluateElements(points);
    expect(evaluated.errors).toHaveLength(0);

    const ast = templateOf([literalSegment("前中心 "), numericHoleSegment("@直線AB.length")]);
    const result = evaluateElementTextTemplate(
      ast,
      {
        computedGeometry: evaluated.computedGeometry,
        elementsById: new Map(points.map((element) => [element.id, element])),
        currentElement,
        elements: points
      },
      resolveBinding({})
    );
    expect(result).toEqual({ text: "前中心 30.414" });
  });

  it("fails closed for a missing numeric-expression dependency", () => {
    const ast = templateOf([numericHoleSegment("@missing.length")]);
    const result = evaluateElementTextTemplate(
      ast,
      { computedGeometry: new Map(), elementsById: new Map(), currentElement, elements: [] },
      resolveBinding({})
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error?.dependencyId).toBeDefined();
      expect(result.error?.message).toBeTruthy();
    }
  });

  it("evaluates a typed string hole and reports a poisoned typed hole against the element's own id", () => {
    const ast = templateOf([stringHoleSegment("binding:label")]);
    const ok = evaluateElementTextTemplate(
      ast,
      { computedGeometry: new Map(), elementsById: new Map(), currentElement, elements: [] },
      resolveBinding({ "binding:label": { status: "ok", type: { kind: "string" }, value: { kind: "string", value: "前身頃" } } })
    );
    expect(ok).toEqual({ text: "前身頃" });

    const poisoned = evaluateElementTextTemplate(
      ast,
      { computedGeometry: new Map(), elementsById: new Map(), currentElement, elements: [] },
      resolveBinding({ "binding:label": { status: "error", type: { kind: "string" }, issueCode: "poisoned-binding", bindingId: "binding:label" } })
    );
    expect(poisoned.error?.dependencyId).toBe("text-1");
    expect(poisoned.error?.dependencyName).toBe("注記");
  });
});
