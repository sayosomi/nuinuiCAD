import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { propertyBindingOccurrenceKey } from "./propertyBindingCompiler";
import { evaluateScalarProgram } from "./declarationEvaluator";

const compileCanonical = (source: string) => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return result.doc;
};

const statementIndexNamed = (
  compiled: ReturnType<typeof compileCanonical>,
  name: string
) => compiled.statements.findIndex((statement) => statement.name === name);

const statementIndexOfElementType = (
  compiled: ReturnType<typeof compileCanonical>,
  type: string
) => compiled.statements.findIndex((statement) => statement.kind === "element" && statement.type === type);

describe("SAY-128 record scalar integration", () => {
  it("lowers constructor fields once, reuses them through aliases, and preserves source program order", () => {
    const compiled = compileCanonical([
      "nui 1",
      "record Config(amount: number, label: string, enabled: boolean)",
      'const config: Config = Config(enabled: true, label: "ok", amount: 12)',
      "const alias: Config = @config",
      "const width: number = @alias.amount + 1"
    ].join("\n"));

    const catalog = compiled.bindingAnalysis!.catalog;
    const byName = new Map(catalog.bindings.map((binding) => [binding.name, binding] as const));
    const amount = byName.get("config.amount")!;
    const label = byName.get("config.label")!;
    const enabled = byName.get("config.enabled")!;
    const width = byName.get("width")!;

    expect(amount).toMatchObject({ declaredType: { kind: "number" }, resolutionMode: "preResolvedOnly", catalogOrder: "source" });
    expect(label).toMatchObject({ declaredType: { kind: "string" }, resolutionMode: "preResolvedOnly", catalogOrder: "source" });
    expect(enabled).toMatchObject({ declaredType: { kind: "boolean" }, resolutionMode: "preResolvedOnly", catalogOrder: "source" });
    expect(byName.has("alias.amount")).toBe(false);
    expect(byName.has("alias.label")).toBe(false);
    expect(byName.has("alias.enabled")).toBe(false);

    expect(compiled.scalarProgram!.statements.map((statement) => catalog.bindingsById.get(statement.bindingId)?.name)).toEqual([
      "config.amount",
      "config.label",
      "config.enabled",
      "width"
    ]);
    expect(compiled.scalarProgram!.statements.find((statement) => statement.bindingId === width.id)?.declaration.initializer).toMatchObject({
      kind: "binary",
      left: { kind: "reference", name: "alias.amount", bindingId: amount.id }
    });

    const evaluated = evaluateScalarProgram(compiled.scalarProgram!);
    expect(evaluated.resultsByBindingId.get(amount.id)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 12 }
    });
    expect(evaluated.resultsByBindingId.get(label.id)).toEqual({
      status: "ok",
      type: { kind: "string" },
      value: { kind: "string", value: "ok" }
    });
    expect(evaluated.resultsByBindingId.get(enabled.id)).toEqual({
      status: "ok",
      type: { kind: "boolean" },
      value: { kind: "boolean", value: true }
    });
    expect(evaluated.resultsByBindingId.get(width.id)).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 13 }
    });
  });

  it("uses record scalar fields in property, condition, text, construction, layout, and output contexts", () => {
    const compiled = compileCanonical([
      "nui 1",
      "record Config(amount: number, label: string, enabled: boolean)",
      'const config: Config = Config(amount: 12, label: "ok", enabled: true)',
      "const alias: Config = @config",
      "point P = coordinate(x: @alias.amount, y: 0)",
      "for i in range(from: 0, count: 1, showGenerated: @alias.enabled) {",
      "}",
      "if (@alias.enabled) {",
      '  text T = label(text: "label ${@alias.label}", anchor: none, size: 3)',
      "}",
      "layout L(scale: @alias.amount) {",
      "}",
      "print Paper(layout: @L, paper: a4, overlap: @alias.amount)",
      "svg Vector(layout: @L, margin: @alias.amount)"
    ].join("\n"));

    const catalog = compiled.bindingAnalysis!.catalog;
    const byName = new Map(catalog.bindings.map((binding) => [binding.name, binding] as const));
    const amount = byName.get("config.amount")!;
    const label = byName.get("config.label")!;
    const enabled = byName.get("config.enabled")!;

    const forIndex = statementIndexOfElementType(compiled, "forGroup");
    expect(compiled.propertyBindings?.get(propertyBindingOccurrenceKey(forIndex, "showGenerated"))).toMatchObject({
      kind: "expression",
      type: { kind: "boolean" },
      expression: { kind: "reference", name: "alias.enabled", bindingId: enabled.id }
    });

    const ifIndex = statementIndexOfElementType(compiled, "conditionalGroup");
    expect(compiled.conditionalGroupConditions?.get(propertyBindingOccurrenceKey(ifIndex, "condition"))).toMatchObject({
      kind: "reference",
      name: "alias.enabled",
      bindingId: enabled.id,
      type: { kind: "boolean" }
    });

    const textIndex = statementIndexNamed(compiled, "T");
    const template = compiled.textTemplates?.get(propertyBindingOccurrenceKey(textIndex, "text"));
    const hole = template?.segments.find((segment) => segment.kind === "hole");
    expect(hole).toMatchObject({
      kind: "hole",
      holeKind: "string",
      expression: { kind: "reference", name: "alias.label", bindingId: label.id, type: { kind: "string" } }
    });
    expect(template?.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ bindingId: label.id, name: "alias.label" })
    ]));

    const pointIndex = statementIndexNamed(compiled, "P");
    const layoutIndex = statementIndexNamed(compiled, "L");
    const printIndex = statementIndexNamed(compiled, "Paper");
    const svgIndex = statementIndexNamed(compiled, "Vector");
    for (const [statementIndex, key] of [
      [pointIndex, "x"],
      [layoutIndex, "scale"],
      [printIndex, "overlap"],
      [svgIndex, "margin"]
    ] as const) {
      expect(compiled.numericBindings?.get(propertyBindingOccurrenceKey(statementIndex, key))?.typedExpression).toMatchObject({
        kind: "reference",
        name: "alias.amount",
        bindingId: amount.id,
        type: { kind: "number" }
      });
    }
  });

  it.each([
    ["unknown field", "@config.missing"],
    ["chained record access", "@config.amount.more"]
  ])("rejects %s without falling through to geometry property resolution", (_label, expression) => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
    const result = compileCanonicalText(baseline, [
      "nui 1",
      "record Config(amount: number)",
      "const config: Config = Config(amount: 12)",
      `const width: number = ${expression}`
    ].join("\n"));

    expect(result.status).toBe("fatal");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("record-field-"))).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "geometry-property-invalid")).toBe(false);
  });
});