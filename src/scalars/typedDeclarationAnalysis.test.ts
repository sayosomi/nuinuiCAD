import { describe, expect, it } from "vitest";
import { bindingIssuesToDiagnostics } from "./bindingIssueDiagnostics";
import { lowerScalarProgram } from "./scalarProgram";
import { typedDeclarationAnalysisFor } from "./testSupport/typedDeclarationAnalysisFixture";
import { geometryPropertiesIn, referencesIn } from "./typedDependencyGraph";

const bindingIdForName = (fixture: ReturnType<typeof typedDeclarationAnalysisFor>, name: string): string => {
  const binding = fixture.bindingAnalysis.catalog.bindings.find((candidate) => candidate.name === name);
  if (!binding) throw new Error(`Missing binding ${name}`);
  return binding.id;
};

const referencesInOccurrenceOrder = referencesIn;
const geometryPropertiesInOccurrenceOrder = geometryPropertiesIn;

describe("analyzeTypedDeclarations resolution buckets", () => {
  it("keeps multiple occurrences for one binding in source occurrence order", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "const first: number = 1",
      "const second: number = 2",
      "let total: number = @second + @first + @second"
    ].join("\n"));
    const totalId = bindingIdForName(fixture, "total");
    const typed = fixture.analysis.typedInitializerByBindingId.get(totalId)!;

    expect(referencesInOccurrenceOrder(typed).map((reference) => {
      if (reference.kind !== "reference") throw new Error("Expected a reference");
      return reference.bindingId;
    })).toEqual([
      bindingIdForName(fixture, "second"),
      bindingIdForName(fixture, "first"),
      bindingIdForName(fixture, "second")
    ]);
  });

  it("keeps interleaved references isolated by their originating binding", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "const first: number = 1",
      "const second: number = 2",
      "let left: number = @first + @second",
      "let right: number = @second + @first"
    ].join("\n"));
    const referencesFor = (name: string) => referencesInOccurrenceOrder(
      fixture.analysis.typedInitializerByBindingId.get(bindingIdForName(fixture, name))!
    ).map((reference) => {
      if (reference.kind !== "reference") throw new Error("Expected a reference");
      return reference.bindingId;
    });

    expect(referencesFor("left")).toEqual([bindingIdForName(fixture, "first"), bindingIdForName(fixture, "second")]);
    expect(referencesFor("right")).toEqual([bindingIdForName(fixture, "second"), bindingIdForName(fixture, "first")]);
  });

  it("preserves invalid reference diagnostics, binding IDs, exact spans, and order", () => {
    const source = [
      "nui 4",
      "const invalid: number = @later + @missing",
      "const later: number = 1"
    ].join("\n");
    const fixture = typedDeclarationAnalysisFor(source);
    const invalidId = bindingIdForName(fixture, "invalid");
    const diagnostics = bindingIssuesToDiagnostics(fixture.bindingAnalysis, fixture.statements, fixture.spans);
    const typed = fixture.analysis.typedInitializerByBindingId.get(invalidId)!;

    expect(referencesInOccurrenceOrder(typed).map((reference) => {
      if (reference.kind !== "reference") throw new Error("Expected a reference");
      return reference.bindingId;
    })).toEqual([null, null]);
    expect(diagnostics.map((diagnostic) => ({ code: diagnostic.code, bindingId: diagnostic.bindingId }))).toEqual([
      { code: "undefined-binding", bindingId: invalidId },
      { code: "forward-binding-reference", bindingId: invalidId }
    ]);
    expect(diagnostics.map((diagnostic) => {
      const [segment] = diagnostic.physicalSpan!.segments;
      return source.slice(segment.from, segment.to);
    })).toEqual(["@missing", "@later"]);
  });

  it("retains reference-free declarations in the compiled scalar program", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "const value: number = 42",
      "let copy: number = @value"
    ].join("\n"));
    const program = lowerScalarProgram(fixture.analysis);

    expect(program.statements.map((statement) => ({
      bindingId: statement.bindingId,
      bindingKind: statement.declaration.bindingKind,
      initializerKind: statement.declaration.initializer.kind
    }))).toEqual([
      { bindingId: bindingIdForName(fixture, "value"), bindingKind: "const", initializerKind: "numberLiteral" },
      { bindingId: bindingIdForName(fixture, "copy"), bindingKind: "let", initializerKind: "reference" }
    ]);
  });

  it("resolves scoped and local geometry properties inside a nested group", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "group 後ろ身頃 {",
      "  line 先に縫う = segment(start: (0, 0), end: (10, 0))",
      "  group 縫い代 {",
      "    group 縫い代写し {",
      "      line 脇コピー = segment(start: (0, 0), end: (5, 0))",
      "      const 角度: number = @後ろ身頃::先に縫う.endTangentAngleDeg - @脇コピー.endTangentAngleDeg",
      "    }",
      "  }",
      "}"
    ].join("\n"));
    const angle = fixture.analysis.typedInitializerByBindingId.get(bindingIdForName(fixture, "角度"));
    expect(angle).toBeDefined();
    const properties = geometryPropertiesInOccurrenceOrder(angle!);
    const first = fixture.elements.find((element) => element.name === "先に縫う");
    const second = fixture.elements.find((element) => element.name === "脇コピー");
    expect(properties.map((property) => ({
      elementName: property.elementName,
      elementId: property.elementId,
      property: property.property,
      targetSourceOrder: property.targetSourceOrder
    }))).toEqual([
      {
        elementName: "後ろ身頃::先に縫う",
        elementId: first?.id,
        property: "endTangentAngleDeg",
        targetSourceOrder: fixture.statements.findIndex((statement) => statement.kind === "element" && statement.name === "先に縫う")
      },
      {
        elementName: "脇コピー",
        elementId: second?.id,
        property: "endTangentAngleDeg",
        targetSourceOrder: fixture.statements.findIndex((statement) => statement.kind === "element" && statement.name === "脇コピー")
      }
    ]);
  });

  it("walks references and geometry properties inside builtin call arguments", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "const first: number = 1",
      "const second: number = 2",
      "line curve = segment(start: (0, 0), end: (10, 0))",
      "const result: number = round(max(@first, @second), 2) + @curve.length"
    ].join("\n"));
    const result = fixture.analysis.typedInitializerByBindingId.get(bindingIdForName(fixture, "result"));
    expect(result).toMatchObject({ kind: "binary", left: { kind: "call", name: "round" } });
    expect(referencesInOccurrenceOrder(result!).map((reference) => {
      if (reference.kind !== "reference") throw new Error("Expected a reference");
      return reference.name;
    })).toEqual(["first", "second"]);
    expect(geometryPropertiesInOccurrenceOrder(result!).map((property) => property.elementName)).toEqual(["curve"]);
  });
});
