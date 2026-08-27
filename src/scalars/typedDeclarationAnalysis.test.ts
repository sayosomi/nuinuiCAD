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
  it("resolves geometry builtin calls without scalar dependency edges", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: @A, end: @B)",
      "const d: number = distance(@A, @B)",
      "const a: number = angle(@A, @B)",
      "const h: number = lineDistance(@A, @AB)"
    ].join("\n"));

    for (const name of ["d", "a", "h"]) {
      const initializer = fixture.analysis.typedInitializerByBindingId.get(bindingIdForName(fixture, name));
      expect(initializer).toMatchObject({ kind: "call", type: { kind: "number" } });
    }
    const expectedArguments = {
      d: [
        { expectedGeometryType: "point", statementIndex: 1, geometryType: "point" },
        { expectedGeometryType: "point", statementIndex: 2, geometryType: "point" }
      ],
      a: [
        { expectedGeometryType: "point", statementIndex: 1, geometryType: "point" },
        { expectedGeometryType: "point", statementIndex: 2, geometryType: "point" }
      ],
      h: [
        { expectedGeometryType: "point", statementIndex: 1, geometryType: "point" },
        { expectedGeometryType: "line", statementIndex: 3, geometryType: "line" }
      ]
    } as const;
    const typedArgumentsByName = new Map<string, unknown[]>();
    for (const name of ["d", "a", "h"] as const) {
      const initializer = fixture.analysis.typedInitializerByBindingId.get(bindingIdForName(fixture, name));
      if (initializer?.kind !== "call") throw new Error(`Expected builtin call for ${name}`);
      expect(initializer.target).toEqual({ kind: "builtin", name: name === "d" ? "distance" : name === "a" ? "angle" : "lineDistance" });
      expect(initializer.args).toEqual(expectedArguments[name].map((argument) => ({
        kind: "geometryReference",
        expectedGeometryType: argument.expectedGeometryType,
        target: {
          statementId: fixture.elementIdByStatementIndex.get(argument.statementIndex),
          statementIndex: argument.statementIndex,
          geometryType: argument.geometryType
        }
      })));
      expect(initializer.args.every((argument) => argument.kind === "geometryReference" && !("name" in argument))).toBe(true);
      typedArgumentsByName.set(name, [...initializer.args]);
    }
    const program = lowerScalarProgram(fixture.analysis);
    for (const name of ["d", "a", "h"] as const) {
      const bindingId = bindingIdForName(fixture, name);
      const statement = program.statements.find((candidate) => candidate.bindingId === bindingId);
      expect(statement?.declaration.initializer).toMatchObject({ args: typedArgumentsByName.get(name) });
    }
    expect(fixture.bindingAnalysis.graph.edgesByFromBindingId.get(bindingIdForName(fixture, "d"))).toBeUndefined();
    expect(fixture.bindingAnalysis.graph.edgesByFromBindingId.get(bindingIdForName(fixture, "a"))).toBeUndefined();
    expect(fixture.bindingAnalysis.graph.edgesByFromBindingId.get(bindingIdForName(fixture, "h"))).toBeUndefined();
  });

  it("reports geometry interface mismatches while keeping geometry arguments out of scalar dependencies", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: @A, end: @B)",
      "arc ArcA = arc(center: @A, radius: 10, start: 0, end: 90)",
      "const wrongPoint: number = distance(@AB, @A)",
      "const wrongLine: number = lineDistance(@A, @ArcA)"
    ].join("\n"), { expectNoDiagnostics: false });

    expect(fixture.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "builtin-geometry-type-mismatch",
      "builtin-geometry-type-mismatch"
    ]);
    expect(fixture.diagnostics.every((diagnostic) => diagnostic.code !== "scalar-namespace-type-mismatch")).toBe(true);
    expect(fixture.bindingAnalysis.graph.edgesByFromBindingId.get(bindingIdForName(fixture, "wrongPoint"))).toBeUndefined();
    expect(fixture.bindingAnalysis.graph.edgesByFromBindingId.get(bindingIdForName(fixture, "wrongLine"))).toBeUndefined();
  });

  it("reports wrong geometry builtin arity once without reclassifying the geometry child as scalar", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "point Origin = coordinate(x: 0, y: 0)",
      "const BadArity: number = distance(@Origin)"
    ].join("\n"), { expectNoDiagnostics: false });

    expect(fixture.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["function-arity-mismatch"]);
    expect(fixture.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("scalar-namespace-type-mismatch");
  });

  it("keeps an independent missing geometry child diagnostic during wrong-arity recovery", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "const BadArity: number = distance(@Missing)"
    ].join("\n"), { expectNoDiagnostics: false });
    const codes = fixture.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes.filter((code) => code === "function-arity-mismatch")).toHaveLength(1);
    expect(codes).toContain("builtin-geometry-argument-invalid");
    expect(codes).not.toContain("scalar-namespace-type-mismatch");
  });

  it("resolves derived point builtin operands without scalar or numeric geometry-property edges", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point C = coordinate(x: 0, y: 5)",
      "line AB = segment(start: @A, end: @C)",
      "const distanceValue: number = distance(@AB.start, @C)",
      "const angleValue: number = angle(@AB.end, @C)",
      "const lineValue: number = lineDistance(@AB.start, @AB)"
    ].join("\n"));

    for (const name of ["distanceValue", "angleValue", "lineValue"]) {
      const initializer = fixture.analysis.typedInitializerByBindingId.get(bindingIdForName(fixture, name));
      expect(initializer).toMatchObject({ kind: "call", type: { kind: "number" } });
      if (initializer?.kind !== "call") throw new Error(`Expected call for ${name}`);
      expect(initializer.args[0]).toMatchObject({
        kind: "geometryReference",
        expectedGeometryType: "point",
        target: { statementIndex: 3, geometryType: "point", pointKey: name === "angleValue" ? "end" : "start" }
      });
      expect(initializer.args.every((argument) => argument.kind === "geometryReference")).toBe(true);
      expect(fixture.bindingAnalysis.graph.edgesByFromBindingId.get(bindingIdForName(fixture, name))).toBeUndefined();
      expect(geometryPropertiesInOccurrenceOrder(initializer)).toEqual([]);
    }
  });

  it("keeps a geometry reference outside a geometry builtin as a scalar namespace mismatch", () => {
    const fixture = typedDeclarationAnalysisFor([
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "const x: number = @A"
    ].join("\n"), { expectNoDiagnostics: false });

    expect(fixture.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["scalar-namespace-type-mismatch"]);
  });

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
      targetSourceOrder: property.targetSourceOrder,
      type: property.type
    }))).toEqual([
      {
        elementName: "後ろ身頃::先に縫う",
        elementId: first?.id,
        property: "endTangentAngleDeg",
        targetSourceOrder: fixture.statements.findIndex((statement) => statement.kind === "element" && statement.name === "先に縫う"),
        type: { kind: "number" }
      },
      {
        elementName: "脇コピー",
        elementId: second?.id,
        property: "endTangentAngleDeg",
        targetSourceOrder: fixture.statements.findIndex((statement) => statement.kind === "element" && statement.name === "脇コピー"),
        type: { kind: "number" }
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
