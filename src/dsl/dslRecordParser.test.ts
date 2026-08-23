import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { parseDslRecordDefinitionStatement } from "./dslRecordParser";

const spanText = (source: string, span: { start: number; end: number } | null) =>
  span ? source.slice(span.start, span.end) : null;

const physicalText = (
  source: string,
  span: { segments: readonly { from: number; to: number }[] } | null | undefined
) => span ? span.segments.map((segment) => source.slice(segment.from, segment.to)).join("") : null;

describe("record definition parser", () => {
  it("parses scalar-only required fields with exact logical spans", () => {
    const source = "record Measurements(bust: number, note: string, active: boolean)";
    const parsed = parseDslRecordDefinitionStatement(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statement?.name).toBe("Measurements");
    expect(spanText(source, parsed.statement?.nameSpan ?? null)).toBe("Measurements");
    expect(parsed.statement?.fields.map((field) => ({
      name: field.name,
      nameText: spanText(source, field.nameSpan),
      typeText: spanText(source, field.typeSpan),
      typeKind: field.type?.kind
    }))).toEqual([
      { name: "bust", nameText: "bust", typeText: "number", typeKind: "number" },
      { name: "note", nameText: "note", typeText: "string", typeKind: "string" },
      { name: "active", nameText: "active", typeText: "boolean", typeKind: "boolean" }
    ]);
  });

  it("rejects v1 optional/default/geometry/nested/array fields and duplicates", () => {
    const parsed = parseDslRecordDefinitionStatement(
      "record Invalid(a?: number, b: number = 1, p: point, nested: Other, values: number[], a: string)"
    );
    const codes = parsed.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(expect.arrayContaining([
      "record-field-optional-unsupported",
      "record-field-default-unsupported",
      "record-field-geometry-unsupported",
      "record-field-nested-unsupported",
      "record-field-array-unsupported",
      "record-field-duplicate"
    ]));
  });

  it("projects multiline record name/field/type spans back to exact physical source", () => {
    const source = [
      "nui 4",
      "record Measurements(",
      "  bust: number,",
      "  note: string",
      ")"
    ].join("\n");
    const parsed = parseDsl(source);
    const record = parsed.statements.find((statement) => statement.kind === "recordDefinition");

    expect(parsed.diagnostics).toEqual([]);
    expect(record?.kind).toBe("recordDefinition");
    if (!record || record.kind !== "recordDefinition") throw new Error("record statement not parsed");
    expect(physicalText(source, record.namePhysicalSpan)).toBe("Measurements");
    expect(record.fields.map((field) => ({
      name: physicalText(source, field.namePhysicalSpan),
      type: physicalText(source, field.typePhysicalSpan)
    }))).toEqual([
      { name: "bust", type: "number" },
      { name: "note", type: "string" }
    ]);
  });

  it("keeps named record annotations separate from ScalarType in const and Module parameters", () => {
    const source = [
      "nui 4",
      "record Measurements(bust: number)",
      "const m: Measurements = Measurements(bust: 90)",
      "module Draft(input: Measurements) {",
      "}"
    ].join("\n");
    const parsed = parseDsl(source);
    const declaration = parsed.statements.find(
      (statement) => statement.kind === "typedDeclaration" && statement.name === "m"
    );
    const module = parsed.statements.find((statement) => statement.kind === "moduleDefinition");

    expect(parsed.diagnostics).toEqual([]);
    expect(declaration).toMatchObject({
      kind: "typedDeclaration",
      declaredType: null,
      recordTypeReference: { kind: "record", name: "Measurements" }
    });
    expect(module?.kind).toBe("moduleDefinition");
    if (!module || module.kind !== "moduleDefinition") throw new Error("module statement not parsed");
    expect(module.parameters[0]).toMatchObject({
      type: null,
      recordTypeReference: { kind: "record", name: "Measurements" }
    });
  });
});
