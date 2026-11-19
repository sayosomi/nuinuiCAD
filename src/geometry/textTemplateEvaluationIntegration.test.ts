// End-to-end coverage for compileDslDocument -> the shared evaluation builders
// used by production routing. Covers escapes, typed holes, geometry graph
// prerequisites, TypeScript reference evaluation, and Rust payload projection.
import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  geometryPropertiesIn,
  parseScalarExpression,
  resolveGeometryPropertyMetadata,
  typecheckScalarExpression
} from "@nuinuicad/nui-language";
import { canUseRustEvaluationForElements } from "./rustEvaluationEligibility";
import { evaluateElements, type EvaluateElementsOptions } from "./evaluate";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { buildTextPropertyBindingRuntimeEntries, buildTextTemplateEntriesByElementId, toRustTextTemplateSegments } from "./textTemplateRuntime";

/** Mirrors the production evaluation-options wiring exactly - the same entry
 * builders and conditional spreads - so this test exercises the real shared
 * evaluation shape, not a hand-rolled substitute. */
const productionEvaluationOptions = (compiled: ReturnType<typeof compileDslDocument>): EvaluateElementsOptions => {
  const elementIdByStatementIndex = compiled.statementMap?.elementIdByStatementIndex ?? new Map();
  const textTemplateEntriesByElementId = compiled.textTemplates
    ? buildTextTemplateEntriesByElementId({ textTemplates: compiled.textTemplates, elementIdByStatementIndex })
    : undefined;
  const propertyBindingEntries =
    compiled.scalarProgram && compiled.propertyBindings
      ? buildPropertyBindingRuntimeEntries(
          { propertyBindings: compiled.propertyBindings, elementIdByStatementIndex },
          compiled.document?.elements ?? []
        )
      : undefined;
  const textPropertyBindingEntries =
    compiled.scalarProgram && compiled.propertyBindings
      ? buildTextPropertyBindingRuntimeEntries(
          { propertyBindings: compiled.propertyBindings, elementIdByStatementIndex },
          compiled.document?.elements ?? []
        )
      : undefined;
  return {
    ...(compiled.scalarProgram ? { scalarProgram: compiled.scalarProgram } : {}),
    ...(propertyBindingEntries?.length ? { propertyBindingEntries } : {}),
    ...(textTemplateEntriesByElementId?.size ? { textTemplateEntriesByElementId } : {}),
    ...(textPropertyBindingEntries?.length ? { textPropertyBindingEntries } : {})
  };
};

const evaluateSource = (source: string, assignedStatementIds?: Map<number, string>) => {
  const compiled = compileDslDocument(source, assignedStatementIds ? { assignedStatementIds } : undefined);
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.document).not.toBeNull();
  const elements = compiled.document!.elements;
  const options = productionEvaluationOptions(compiled);
  // Element ids are auto-generated unless assignedStatementIds supplies one
  // for that statement - look the text element up by type/name instead of
  // guessing its id, mirroring how the app itself never assumes a fixed id.
  const textElementId = elements.find((element) => element.type === "text" && element.name === "T")?.id;
  return { compiled, elements, options, textElementId, result: evaluateElements(elements, options) };
};

describe("Task 27 production routing: compileDslDocument -> evaluateElements/canUseRustEvaluationForElements", () => {
  it("前身頃を2枚カット: a typed string hole evaluates via the AST path", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 1", 'const ラベル: string = "前身頃"', 'text T = label(text: "${@ラベル}を2枚カット", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "前身頃を2枚カット" });
  });

  it("nui 1 numeric interpolation: a typed number hole formats to max 3 decimals", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 1", "const 寸法: number = 12.3456", 'text T = label(text: "寸法=${@寸法}mm", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:size"]])
    );
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "寸法=12.346mm" });
  });

  it("resolves a group-qualified geometry property into the text hole, graph edge, and Rust payload", () => {
    const source = [
      "nui 1",
      "group G {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      "}",
      'text T = label(text: "${@G::L.length}", anchor: (0, 10), size: 3)'
    ].join("\n");
    const { compiled, elements, result, textElementId } = evaluateSource(source);
    const line = elements.find((element) => element.type === "line" && element.name === "L");
    const textElement = elements.find((element) => element.id === textElementId);
    const template = compiled.textTemplates?.values().next().value;
    const hole = template?.segments.find((segment) => segment.kind === "hole");
    if (!line || !textElement || !textElementId || !template || !hole) {
      throw new Error("Expected the fixture to compile a line, text element, and text-template hole.");
    }

    const elementIdByStatementIndex = compiled.statementMap?.elementIdByStatementIndex ?? new Map<number, string>();
    const sourceOrderByElementId = new Map([...elementIdByStatementIndex].map(([index, elementId]) => [elementId, index]));
    const textSourceOrder = sourceOrderByElementId.get(textElement.id);
    const lineSourceOrder = sourceOrderByElementId.get(line.id);
    if (textSourceOrder === undefined || lineSourceOrder === undefined) {
      throw new Error("Expected source-order positions for both the line and text element.");
    }
    const expressionText = "@G::L.length";
    const parsed = parseScalarExpression(expressionText, { start: 0, end: expressionText.length });
    if (!parsed.ast) throw new Error("Expected the geometry property expression to parse.");
    const resolution = resolveGeometryPropertyMetadata(parsed.ast, elements, sourceOrderByElementId, {
      currentElement: textElement,
      currentSourceOrder: textSourceOrder
    });
    const typed = typecheckScalarExpression(parsed.ast, {
      expectedType: null,
      references: [],
      geometryPropertyReferences: resolution.geometryPropertyReferences
    });
    const canonicalProperty = {
      elementId: line.id,
      property: "length",
      stagePath: ["final"],
      targetSourceOrder: lineSourceOrder,
      type: { kind: "number" }
    };
    const typedProperties = geometryPropertiesIn(typed.typed);
    const targetEdges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.from.kind === "element" &&
      edge.from.id === textElement.id &&
      ((edge.to.kind === "element" && edge.to.id === line.id) ||
        (edge.to.kind === "geometry-stage" && edge.to.ownerId === line.id))
    ) ?? [];
    const rustPayload = toRustTextTemplateSegments(template);

    expect.soft(resolution.issues).toEqual([]);
    expect.soft(resolution.geometryPropertyReferences.get(parsed.ast.span.start)).toMatchObject(canonicalProperty);
    expect.soft(typed.diagnostics).toEqual([]);
    expect.soft(typedProperties).toEqual([expect.objectContaining(canonicalProperty)]);
    expect.soft(hole).toMatchObject({
      kind: "hole",
      holeKind: "number",
      expression: expect.objectContaining({ kind: "geometryProperty", ...canonicalProperty })
    });
    expect.soft(targetEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "geometry-property",
        from: expect.objectContaining({ kind: "element", id: textElement.id }),
        to: expect.objectContaining({ kind: "geometry-stage", ownerId: line.id, stagePath: ["final"] }),
        requiredness: "required"
      })
    ]));
    expect.soft(rustPayload).toEqual([
      expect.objectContaining({
        kind: "hole",
        holeKind: "number",
        expression: expect.objectContaining({ kind: "geometryProperty", ...canonicalProperty })
      })
    ]);
    expect.soft(result.errors.filter((error) => error.elementId === textElement.id)).toEqual([]);
    expect.soft(result.computedGeometry.get(textElement.id)).toMatchObject({ kind: "text", text: "10" });
  });

  it("evaluates same-group, root, and cross-group geometry properties to 10", () => {
    const { compiled, elements, result } = evaluateSource([
      "nui 1",
      "group G {",
      "  line L = segment(start: (0, 0), end: (10, 0))",
      '  text Same = label(text: "${@L.length}", anchor: (0, 10), size: 3)',
      "}",
      'text Root = label(text: "${@G::L.length}", anchor: (0, 20), size: 3)',
      "group Test {",
      '  text Cross = label(text: "${@G::L.length}", anchor: (0, 30), size: 3)',
      "}"
    ].join("\n"));
    const line = elements.find((element) => element.type === "line" && element.name === "L");
    if (!line) throw new Error("Expected the source group to compile its line.");

    for (const name of ["Same", "Root", "Cross"]) {
      const textElement = elements.find((element) => element.type === "text" && element.name === name);
      if (!textElement) throw new Error(`Expected text element ${name}.`);
      expect(result.errors.filter((error) => error.elementId === textElement.id)).toEqual([]);
      expect(result.computedGeometry.get(textElement.id)).toMatchObject({ kind: "text", text: "10" });
      if (name !== "Same") expect(compiled.typedDependencyGraph?.edges).toContainEqual(expect.objectContaining({
          kind: "geometry-property",
          from: expect.objectContaining({ kind: "element", id: textElement.id }),
          to: expect.objectContaining({ kind: "geometry-stage", ownerId: line.id, stagePath: ["final"] }),
          requiredness: "required"
        }));
    }
  });

  it("escaped braces are literal, not holes, even though the cooked element.text would fool the old regex evaluator", () => {
    const { result, textElementId } = evaluateSource(["nui 1", 'text T = label(text: "cost \\{5\\} yen", anchor: none, size: 3)'].join("\n"));
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "cost {5} yen" });
  });

  it("\\n escape produces a real newline in the evaluated text", () => {
    const { result, textElementId } = evaluateSource(["nui 1", 'text T = label(text: "line1\\nline2", anchor: none, size: 3)'].join("\n"));
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "line1\nline2" });
  });

  it("poison: a hole referencing a binding whose initializer fails evaluates to a fail-closed error, no computed geometry", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 1", "const 割り算: number = 1 / 0", 'text T = label(text: "${@割り算}", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:divide"]])
    );
    expect(result.computedGeometry.get(textElementId!)).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].elementId).toBe(textElementId);
  });

  it("multi-hole order: the first failing hole in source order is the one reported", () => {
    const { result, textElementId } = evaluateSource(
      [
        "nui 1",
        "const 割り算: number = 1 / 0",
        "const 有効: number = 5",
        'text T = label(text: "first=${@割り算} second=${@有効}", anchor: none, size: 3)'
      ].join("\n"),
      new Map([
        [1, "test:divide"],
        [2, "test:valid"]
      ])
    );
    expect(result.computedGeometry.get(textElementId!)).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("評価できません");
  });

  it("bare @binding text.text materializes the bound string, evaluated through the (holeless) AST path", () => {
    const { result, textElementId } = evaluateSource(
      ["nui 1", 'const ラベル: string = "前身頃"', "text T = label(text: @ラベル, anchor: none, size: 3)"].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(result.errors).toHaveLength(0);
    expect(result.computedGeometry.get(textElementId!)).toMatchObject({ kind: "text", text: "前身頃" });
  });

  it("evaluates the declarations/templates fixture while retaining typed template dependencies", () => {
    const { compiled, elements, options, result } = evaluateSource([
      "nui 1",
      "const length: number = 12.3456",
      'const label: string = "前身頃"',
      "const printed: boolean = true",
      "const side: choice(right, left) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: @length, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      'text Label = label(text: "\\{draft\\} ${@label} ${@length}\\n", anchor: none, size: 3)',
      "text Bare = label(text: @label, anchor: none, size: 3)"
    ].join("\n"), new Map([
      [1, "fixture:length"],
      [2, "fixture:label"],
      [3, "fixture:printed"],
      [4, "fixture:side"]
    ]));
    const label = elements.find((element) => element.type === "text" && element.name === "Label")!;
    const bare = elements.find((element) => element.type === "text" && element.name === "Bare")!;
    const templateEdges = compiled.typedDependencyGraph?.edges.filter((edge) =>
      edge.kind === "template-hole" && edge.from.kind === "element" && edge.from.id === label.id
    ) ?? [];
    const templateBindingNames = templateEdges.map((edge) => {
      if (edge.to.kind !== "binding") {
        throw new Error(`Expected template dependency to target a binding, received ${edge.to.kind}.`);
      }
      return edge.to.name;
    });

    expect(result.errors.filter((error) => error.elementId === label.id || error.elementId === bare.id)).toEqual([]);
    expect(result.computedGeometry.get(label.id)).toMatchObject({ kind: "text", text: "{draft} 前身頃 12.346\n" });
    expect(result.computedGeometry.get(bare.id)).toMatchObject({ kind: "text", text: "前身頃" });
    expect(templateBindingNames.sort()).toEqual(["label", "length"]);
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });

  it("makes a nui 1 document with a typed text hole Rust-eligible", () => {
    const { elements, options } = evaluateSource(
      ["nui 1", 'const ラベル: string = "前身頃"', 'text T = label(text: "${@ラベル}を2枚カット", anchor: none, size: 3)'].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });

  it("makes a nui 1 document with a bare @binding text.text property Rust-eligible", () => {
    const { elements, options } = evaluateSource(
      ["nui 1", 'const ラベル: string = "前身頃"', "text T = label(text: @ラベル, anchor: none, size: 3)"].join("\n"),
      new Map([[1, "test:label"]])
    );
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });

  it("makes literal-only nui 1 text Rust-eligible without a scalar program", () => {
    const { elements, options } = evaluateSource(["nui 1", 'text T = label(text: "plain text", anchor: none, size: 3)'].join("\n"));
    expect(options.scalarProgram).toBeUndefined();
    expect(canUseRustEvaluationForElements(elements, options)).toBe(true);
  });
});
