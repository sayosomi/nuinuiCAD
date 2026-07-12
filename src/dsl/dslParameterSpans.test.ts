import { describe, expect, it } from "vitest";
import { compileDslToElements } from "./dslCompiler";
import { resolveParameterKeyForValueSpan, resolveParameterValueSpan } from "./dslParameterSpans";
import { flatRefs, serializeElementStatement } from "./dslSerializer";
import { createCadElement } from "../model/elementFactory";
import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import { elementTypeLabels, type CadElement } from "../types/geometry";

const compiled = (source: string) => {
  const result = compileDslToElements(source, { elements: [] });
  return result.elements.at(-1)!;
};

const selectedText = (source: string, element: ReturnType<typeof compiled>, key: string) => {
  const span = resolveParameterValueSpan(source, element, key);
  expect(span).not.toBeNull();
  return source.slice(span!.start, span!.end);
};

describe("resolveParameterValueSpan", () => {
  it("covers every current element type against its serializer output", () => {
    const elements: CadElement[] = [];
    const refs = flatRefs({ includeIds: false });
    for (const type of Object.keys(elementTypeLabels) as Array<keyof typeof elementTypeLabels>) {
      const element = createCadElement(type, elements, { createId: (kind) => `${kind}-id` });
      elements.push(element);
      const line = serializeElementStatement(element, refs);
      for (const definition of getParameterDefinitions(element)) {
        const span = resolveParameterValueSpan(line, element, definition.key);
        if (!span) continue; // serializer-default and mode-only parameters intentionally have no value span.
        expect(line.slice(span.start, span.end)).not.toBe("");
      }
    }
  });

  it("uses serializer spellings while accepting parser-normalized positional and alias attributes", () => {
    const source = "line lower = split Base at=P";
    const element = compiled(source);
    expect(selectedText(source, element, "baseLineId")).toBe("Base");
    expect(selectedText(source, element, "splitPoint")).toBe("P");
  });

  it("selects name tokens separately from the legacy value spans", () => {
    const source = "point \"named point\" = (0, 0)";
    const element = compiled(source);
    expect(selectedText(source, element, "name")).toBe('"named point"');
  });

  it("narrows coordinate child parameters without changing the parent anchor span", () => {
    const source = "line L = (-(a + 1), 20) -> B";
    const element = compiled(source);
    expect(selectedText(source, element, "startPoint")).toBe("(-(a + 1), 20)");
    expect(selectedText(source, element, "startPoint:x")).toBe("-(a + 1)");
    expect(selectedText(source, element, "startPoint:y")).toBe("20");
  });

  it("maps dynamic local-variable and intermediate record fields", () => {
    const source = "curve C = A -> B startAngle=0 startLength=1 endAngle=2 endLength=3 vars=[d:1 + 2] intermediates=[(4,5):45:6:7]";
    const element = compiled(source);
    const variable = element.numericVariables![0];
    const intermediate = (element as Extract<typeof element, { type: "bezierCurve" }>).intermediatePoints[0];
    expect(selectedText(source, element, `variable:${variable.id}:value`)).toBe("1 + 2");
    expect(selectedText(source, element, `intermediate:${intermediate.id}:point:x`)).toBe("4");
    expect(selectedText(source, element, `intermediate:${intermediate.id}:outgoingHandleLength`)).toBe("7");
  });

  it("returns null for omitted/default and mode-only parameters", () => {
    const group = compiled("group G");
    expect(resolveParameterValueSpan("group G", group, "printEnabled")).toBeNull();
    const division = compiled("point M = between A B ratio=0.5");
    expect(resolveParameterValueSpan("point M = between A B ratio=0.5", division, "placementMode")).toBeNull();
  });

  it("provides an exact reverse mapping for future editor commands", () => {
    const source = "arc C center=A radius=10 start=20 end=30";
    const element = compiled(source);
    const span = resolveParameterValueSpan(source, element, "startAngleDeg")!;
    expect(resolveParameterKeyForValueSpan(source, element, span)).toBe("startAngleDeg");
  });
});
