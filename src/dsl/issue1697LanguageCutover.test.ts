import { describe, expect, it } from "vitest";
import {
  compileDslDocument,
  parseDsl,
  parseDslModuleStatement,
  parseDslSnapshot,
  parseDslSourceReference,
  parseScalarExpression,
  queryDslDefinition,
  type CompiledDslDocument
} from "@nuinuicad/nui-language";
import { moduleSemanticStableFingerprint } from "@nuinuicad/nui-language/document";

const compileWithIds = (source: string, sourceRevision = 0): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `issue-1697:${index}`]))
  });
};

const parseExpression = (source: string) => parseScalarExpression(source, { start: 0, end: source.length });

const typedBinding = (compiled: CompiledDslDocument, name: string) =>
  compiled.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === name);

const typedInitializerFor = (compiled: CompiledDslDocument, name: string) => {
  const binding = typedBinding(compiled, name);
  return compiled.scalarProgram?.statements.find((statement) => statement.bindingId === binding?.id)?.declaration.initializer;
};

const queryDefinition = (source: string, compiled: CompiledDslDocument, token: string, from = 0) => {
  const start = source.indexOf(token, from);
  return queryDslDefinition({
    source: { normalizedSource: source, sourceRevision: 0 },
    position: start + 1,
    semantic: { sourceRevision: 0, compiled }
  });
};

describe("Issue #1697 nui 1 reference and choice cutover (RED contract checkpoint)", () => {
  it("RED 1a: parses a bare source reference with its exact path and source range", () => {
    const source = "  A  ";
    const parsed = parseDslSourceReference(source);

    expect(parsed).toMatchObject({
      kind: "valid",
      reference: {
        path: { absolute: false, segments: ["A"] },
        property: null,
        fullRange: { start: 2, end: 3 },
        pathRange: { start: 2, end: 3 }
      }
    });
    if (parsed.kind === "valid") {
      expect(source.slice(parsed.reference.fullRange.start, parsed.reference.fullRange.end)).toBe("A");
      expect(source.slice(parsed.reference.pathRange.start, parsed.reference.pathRange.end)).toBe("A");
    }
  });

  it("RED 1b: rejects old @A as a value reference", () => {
    expect(parseDslSourceReference("@A")).toMatchObject({ kind: "invalid" });
  });

  it("preserves both name spans in a bare file re-export", () => {
    const source = 'nui 1\nimport "./source.nui" as cloth\nexport cloth::Shape';
    const parsed = parseDsl(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements.at(-1)).toMatchObject({
      kind: "fileReExport",
      importAlias: "cloth",
      importAliasSpan: { start: 7, end: 12 },
      exportedName: "Shape",
      exportedNameSpan: { start: 14, end: 19 }
    });
    for (const invalid of ["@cloth::Shape", "cloth::Shape[0]", 'cloth::"Shape"']) {
      expect(parseDsl(`nui 1\nexport ${invalid}`).diagnostics).toContainEqual(
        expect.objectContaining({ code: "invalid-file-reexport" })
      );
    }
  });

  it("RED 2: retains qualified Japanese namespace and property boundaries without @", () => {
    const qualifiedSource = "前身頃::肩線.end";
    const qualified = parseDslSourceReference(qualifiedSource);
    expect(qualified).toMatchObject({
      kind: "valid",
      reference: {
        path: { absolute: false, segments: ["前身頃", "肩線"] },
        property: "end",
        fullRange: { start: 0, end: 11 },
        pathRange: { start: 0, end: 7 },
        propertyRange: { start: 8, end: 11 }
      }
    });
    if (qualified.kind === "valid") {
      expect(qualifiedSource.slice(qualified.reference.pathRange.start, qualified.reference.pathRange.end))
        .toBe("前身頃::肩線");
      expect(qualifiedSource.slice(qualified.reference.propertyRange!.start, qualified.reference.propertyRange!.end))
        .toBe("end");
    }

    const propertySource = "AB.length";
    const property = parseDslSourceReference(propertySource);
    expect(property).toMatchObject({
      kind: "valid",
      reference: {
        path: { absolute: false, segments: ["AB"] },
        property: "length",
        fullRange: { start: 0, end: 9 },
        pathRange: { start: 0, end: 2 },
        propertyRange: { start: 3, end: 9 }
      }
    });
    if (property.kind === "valid") {
      expect(propertySource.slice(property.reference.pathRange.start, property.reference.pathRange.end)).toBe("AB");
      expect(propertySource.slice(property.reference.propertyRange!.start, property.reference.propertyRange!.end)).toBe("length");
    }
  });

  it("RED 3a: parses width as a lexical reference rather than a choice token", () => {
    const source = "width";
    const parsed = parseExpression(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast).toMatchObject({
      kind: "reference",
      name: "width",
      span: { start: 0, end: 5 },
      nameSpan: { start: 0, end: 5 }
    });
  });

  it("RED 3b: parses @left as a choice literal rather than a lexical reference", () => {
    const source = "@left";
    const parsed = parseExpression(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast).toMatchObject({
      kind: "unresolvedChoiceLiteral",
      raw: "left",
      span: { start: 0, end: 5 }
    });
  });

  it("keeps the choice marker distinct from control-flow and named-call syntax", () => {
    expect(parseExpression("@none").ast).toEqual({
      kind: "unresolvedChoiceLiteral",
      raw: "none",
      span: { start: 0, end: 5 }
    });
    expect(compileWithIds("nui 1\nconst n: number? = @none").diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error" })
    );
    for (const source of ["@abs(1)", "abs(@value: 1)", "if (true) { 1 } @else { 2 }"]) {
      const parsed = parseExpression(source);
      expect(parsed.ast).toBeNull();
      expect(parsed.diagnostics).toHaveLength(1);
    }
  });

  it("resolves @some as a choice arm and rejects it as an optional arm", () => {
    const choice = compileWithIds([
      "nui 1",
      "const option: choice(some, other) = @some",
      "const result: number = match option { @some => 1 @other => 2 }"
    ].join("\n"));
    expect(choice.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const source = "nui 1\nconst option: number? = 3\nconst result: number = match option { none => 1 @some => 2 }";
    const marker = source.indexOf("@some");
    expect(compileWithIds(source).diagnostics).toContainEqual(expect.objectContaining({
      code: "optional-match-impossible-case",
      physicalSpan: { segments: [{ from: marker, to: marker + 5 }], sourceRevision: 0 }
    }));
  });

  it.each(["left", "right"])("RED 4a: resolves @%s only against the concrete choice type", (option) => {
    const source = [
      "nui 1",
      `const selected: choice(left, right) = @${option}`,
      `const selectedMatch: boolean = selected == @${option}`
    ].join("\n");
    const compiled = compileWithIds(source);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(typedInitializerFor(compiled, "selected")).toMatchObject({
      kind: "choiceLiteral",
      value: option,
      type: { kind: "choice", options: ["left", "right"] }
    });
  });

  it("RED 4b: rejects an untyped choice candidate inside string(@left)", () => {
    const source = [
      "nui 1",
      "module M(left: number) {",
      "  const untyped: string = string(@left)",
      "}"
    ].join("\n");
    const choiceStart = source.indexOf("@left");
    const compiled = compileWithIds(source);
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "module-invalid-choice-literal",
        physicalSpan: {
          segments: [{ from: choiceStart, to: choiceStart + "@left".length }],
          sourceRevision: 0
        }
      })
    ]));
  });

  it.each(["side == @right", "@right == side"])(
    "RED 4c: typechecks a choice comparison with the typed operand on either side (%s)",
    (comparison) => {
      const source = [
        "nui 1",
        "const side: choice(left, right) = @left",
        `const matches: boolean = ${comparison}`
      ].join("\n");
      const compiled = compileWithIds(source);
      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(compiled.document).not.toBeNull();
      expect(typedInitializerFor(compiled, "matches")).toMatchObject({
        kind: "binary",
        operator: "==",
        type: { kind: "boolean" }
      });
    }
  );

  it("RED 4 control: keeps ordinary scalar literals unchanged", () => {
    for (const [source, expected] of [
      ["12", { kind: "numberLiteral", value: 12 }],
      ['"hello"', { kind: "stringLiteral", value: "hello" }],
      ["true", { kind: "booleanLiteral", value: true }]
    ] as const) {
      const parsed = parseExpression(source);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.ast).toMatchObject(expected);
    }
  });

  it.each([
    "const pi: number = 2",
    "point pi = coordinate(x: 0, y: 0)",
    "module M(pi: number) {\n}",
    "const items: number[] = [1]\nfor pi in items {\n}",
    "const items: number[] = [1]\nconst mapped: number[] = for pi in items { pi }"
  ])("reports the exact reserved builtin name in %s", (declaration) => {
    const source = `nui 1\n${declaration}`;
    const start = source.indexOf("pi");
    expect(compileWithIds(source).diagnostics).toContainEqual(expect.objectContaining({
      code: "reserved-builtin-constant-name",
      physicalSpan: { segments: [{ from: start, to: start + 2 }], sourceRevision: 0 }
    }));
  });

  it.each([
    'group "A" {\n}',
    'module "A"() {\n}',
    'module M() {\n}\ninstance "A" = M()',
    'layout "A" {\n}'
  ])("rejects a quoted declaration name in %s", (declaration) => {
    const source = `nui 1\n${declaration}`;
    const start = source.indexOf('"A"');
    expect(compileWithIds(source).diagnostics).toContainEqual(expect.objectContaining({
      code: "quoted-identifier-not-allowed",
      physicalSpan: { segments: [{ from: start, to: start + 3 }], sourceRevision: 0 }
    }));
  });

  it("RED 5a: allows a numeric left binding and choice option left in the same scope", () => {
    const source = [
      "nui 1",
      "const left: number = 50",
      "const side: choice(left, right) = @left",
      "const copied: number = left"
    ].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
  });

  it("RED 5b: resolves bare left to the numeric binding beside the same-named choice option", () => {
    const source = [
      "nui 1",
      "const left: number = 50",
      "const side: choice(left, right) = @left",
      "const copied: number = left"
    ].join("\n");
    const compiled = compileWithIds(source);
    const numericLeft = typedBinding(compiled, "left");

    expect(numericLeft).toBeDefined();
    expect(typedInitializerFor(compiled, "copied")).toMatchObject({
      kind: "reference",
      name: "left",
      bindingId: numericLeft?.id,
      type: { kind: "number" }
    });
  });

  it("RED 6a: derives Module shorthand label and caller value from Pocket(width)", () => {
    const source = "instance pocket = Pocket(width)";
    const parsed = parseDslModuleStatement(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statement?.kind).toBe("moduleInstance");
    if (parsed.statement?.kind !== "moduleInstance") return;

    const argument = parsed.statement.arguments[0];
    expect(argument).toMatchObject({ label: "width", value: "width" });
    expect(source.slice(argument?.labelSpan?.start, argument?.labelSpan?.end)).toBe("width");
    expect(source.slice(argument?.valueSpan?.start, argument?.valueSpan?.end)).toBe("width");
  });

  it("RED 6b: gives Pocket(width) the same named binding as Pocket(width: width)", () => {
    const prefix = [
      "nui 1",
      "const width: number = 10",
      "module Pocket(width: number) {",
      "  const inside: number = width",
      "}"
    ];
    const shorthandSource = [...prefix, "instance pocket = Pocket(width)"].join("\n");
    const explicitSource = [...prefix, "instance pocket = Pocket(width: width)"].join("\n");
    const shorthand = compileWithIds(shorthandSource);
    const explicit = compileWithIds(explicitSource);

    expect(shorthand.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(explicit.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(moduleSemanticStableFingerprint(shorthand)).toBe(moduleSemanticStableFingerprint(explicit));
  });

  it.each(["@left", "front::width", "width.length", "1"])(
    "RED 6c: rejects %s as an unlabeled Module argument instead of positional shorthand",
    (argumentSource) => {
      const parsed = parseDslModuleStatement(`instance X = Pocket(${argumentSource})`);
      expect(parsed.diagnostics.length).toBeGreaterThan(0);
      expect(parsed.statement?.kind).toBe("moduleInstance");
      if (parsed.statement?.kind !== "moduleInstance") return;
      expect(parsed.statement.arguments[0]?.label).toBeNull();
    }
  );

  it("RED 7a: requires @ on choice match arms while retaining the option identity and range", () => {
    const source = "match side { @left => 10 @right => 20 }";
    const parsed = parseExpression(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast).not.toBeNull();
    if (parsed.ast?.kind !== "valueMatch") return;

    expect(parsed.ast.arms.map((arm) => arm.label)).toEqual(["left", "right"]);
    expect(source.slice(parsed.ast.arms[0]!.labelSpan.start, parsed.ast.arms[0]!.labelSpan.end)).toBe("@left");
    expect(source.slice(parsed.ast.arms[1]!.labelSpan.start, parsed.ast.arms[1]!.labelSpan.end)).toBe("@right");
  });

  it("RED 7 control: preserves optional none/some arm syntax", () => {
    const source = "match note { none => none some value => value }";
    const parsed = parseExpression(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast).toMatchObject({
      kind: "valueMatch",
      arms: [
        { label: "none" },
        { label: "some", binder: "value" }
      ]
    });
    if (parsed.ast?.kind === "valueMatch") {
      expect(source.slice(parsed.ast.arms[0]!.labelSpan.start, parsed.ast.arms[0]!.labelSpan.end)).toBe("none");
      expect(source.slice(parsed.ast.arms[1]!.labelSpan.start, parsed.ast.arms[1]!.labelSpan.end)).toBe("some");
    }
  });

  it("RED 8a: rejects a quoted declaration name at its exact source range", () => {
    const source = 'nui 1\npoint "A" = coordinate(x: 0, y: 0)';
    const quotedNameStart = source.indexOf('"A"');
    const diagnostics = parseDsl(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        physicalSpan: {
          segments: [{ from: quotedNameStart, to: quotedNameStart + '"A"'.length }],
          sourceRevision: 0
        }
      })
    ]));
  });

  it.each([
    ["point @A = coordinate(x: 0, y: 0)", "@A"],
    ["group A@B {\n}", "A@B"],
    ["module @M() {\n}", "@M"],
    ["module M(@width: number) {\n}", "@width"],
    ['import "./parts.nui" as @parts', "@parts"],
    ["record @R(x: number)", "@R"],
    ["layer @Pattern", "@Pattern"]
  ])("rejects a marked declaration in %s", (statement, name) => {
    const source = `nui 1\n${statement}`;
    const from = source.indexOf(name);
    expect(parseDsl(source).diagnostics).toContainEqual(expect.objectContaining({
      severity: "error", code: "marked-identifier-not-allowed",
      physicalSpan: { segments: [{ from, to: from + name.length }], sourceRevision: 0 }
    }));
  });

  it("independent control: rejects a quoted typed declaration name at its exact source range", () => {
    const source = 'nui 1\nconst "label": string = "hello"';
    const quotedNameStart = source.indexOf('"label"');
    const diagnostics = parseDsl(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        physicalSpan: {
          segments: [{ from: quotedNameStart, to: quotedNameStart + '"label"'.length }],
          sourceRevision: 0
        }
      })
    ]));
  });

  it("RED 8b control: rejects front::\"edge\" in bare-reference syntax", () => {
    const source = 'front::"edge"';
    const parsed = parseDslSourceReference(source);
    expect(parsed).toMatchObject({ kind: "invalid" });
  });

  it("RED 8c: rejects a quoted qualified path segment even with the legacy marker", () => {
    const source = '@front::"edge"';
    const parsed = parseDslSourceReference(source);
    expect(parsed).toMatchObject({ kind: "invalid" });
  });

  it("RED 8d: rejects a quoted choice-looking identifier", () => {
    const source = '@"left"';
    const parsed = parseExpression(source);
    expect(parsed.ast).toBeNull();
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ span: { start: 1, end: source.length } })
    ]));
  });

  it("RED 8 controls: keeps string values, quoted import paths, and unquoted Japanese names", () => {
    const source = [
      "nui 1",
      'import "./parts.nui" as parts',
      'const text: string = "hello"',
      "point 前身頃 = coordinate(x: 0, y: 0)"
    ].join("\n");
    const parsed = parseDsl(source);

    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(parsed.statements.find((statement) => statement.kind === "import")).toMatchObject({
      kind: "import",
      importPath: "./parts.nui"
    });
    expect(parsed.statements.find((statement) => statement.kind === "element" && statement.name === "前身頃"))
      .toBeDefined();
  });

  const representativeDocument = [
    "nui 1",
    "const left: number = 50",
    "const width: number = left",
    "const side: choice(left, right) = @left",
    "const copiedWidth: number = width",
    "point A = coordinate(x: 0, y: 0)",
    "point B = coordinate(x: width, y: 0)",
    "line AB = segment(start: A, end: B)",
    "const length: number = AB.length",
    "const isRight: boolean = side == @right",
    "const selected: number = match side { @left => 10 @right => 20 }"
  ].join("\n");

  it("RED 9a: compiles a complete nui 1 document with scalar, geometry, and choice references", () => {
    const compiled = compileWithIds(representativeDocument);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();

    const left = typedBinding(compiled, "left");
    expect(typedInitializerFor(compiled, "width")).toMatchObject({
      kind: "reference",
      name: "left",
      bindingId: left?.id,
      type: { kind: "number" }
    });
    expect(typedInitializerFor(compiled, "side")).toMatchObject({
      kind: "choiceLiteral",
      value: "left",
      type: { kind: "choice", options: ["left", "right"] }
    });
    expect(compiled.sourceElementsByStatementIndex.size).toBeGreaterThanOrEqual(3);
  });

  it("RED 9b: Definition on a bare geometry reference returns its exact source and declaration ranges", () => {
    const compiled = compileWithIds(representativeDocument);
    const referenceStart = representativeDocument.indexOf("A", representativeDocument.indexOf("segment(start:"));
    const result = queryDefinition(representativeDocument, compiled, "A", referenceStart);

    expect(result).not.toBeNull();
    expect(result?.referenceRange).toEqual({ from: referenceStart, to: referenceStart + 1 });
    expect(result?.declarationRange).toEqual({
      from: representativeDocument.indexOf("A", representativeDocument.indexOf("point A")),
      to: representativeDocument.indexOf("A", representativeDocument.indexOf("point A")) + 1
    });
    expect(representativeDocument.slice(result!.referenceRange.from, result!.referenceRange.to)).toBe("A");
    expect(representativeDocument.slice(result!.declarationRange.from, result!.declarationRange.to)).toBe("A");
  });

  it("RED 9 control: leaves ordinary string and numeric source values accepted", () => {
    const source = ["nui 1", 'const text: string = "pattern"', "const amount: number = 25"].join("\n");
    const compiled = compileWithIds(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
  });
});
