import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  queryDslCompletion,
  type DslCompletionQueryResult
} from "./dslCompletionQuery";
import { createLanguageAnalysisSession } from "../../vscode-extension/src/languageAnalysisSession";

const compileWithIds = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `completion-test:${index}`]))
  });
};

const exactQuery = (
  source: string,
  marker: string,
  offset = marker.length
): DslCompletionQueryResult | null => {
  const sourceRevision = 7;
  const compiled = compileWithIds(source, sourceRevision);
  const position = source.indexOf(marker) + offset;
  return queryDslCompletion({
    source: { normalizedSource: source, sourceRevision },
    position,
    semantic: { sourceRevision, compiled }
  });
};

const labels = (result: DslCompletionQueryResult | null) => result?.candidates.map((candidate) => candidate.label) ?? [];

const queryIncomplete = (source: string, position = source.length) => queryDslCompletion({
  source: { normalizedSource: source, sourceRevision: 1 },
  position
});

describe("queryDslCompletion", () => {
  it("returns keyword, declaration type, module parameter type, construction, and argument candidates", () => {
    expect(labels(queryIncomplete("poi", 3))).toContain("point");
    expect(labels(queryIncomplete("const value: cho"))).toEqual([
      "number", "string", "boolean", "choice", "point[]", "line[]", "path[]"
    ]);
    expect(labels(queryIncomplete("nui 1\nmodule M(input: pa"))).toContain("path");
    expect(labels(queryIncomplete("point P = co"))).toContain("coordinate");
    const lineConstructions = labels(queryIncomplete("line L = tran"));
    expect(lineConstructions).toContain("transformCopy");
    expect(lineConstructions).not.toContain("copy");
    const transformCopyArguments = labels(queryIncomplete("line L = transformCopy("));
    expect(transformCopyArguments).toEqual(expect.arrayContaining([
      "startPoint", "endPoint", "scale", "angleDeg", "mirrorX", "baseLines"
    ]));
    const argument = queryIncomplete("point P = offset(\n  d");
    expect(argument?.category).toBe("argument");
    expect(labels(argument)).toEqual(expect.arrayContaining(["dx", "dy"]));
    expect(argument?.candidates.every((candidate) => candidate.kind === "argumentName")).toBe(true);
  });

  it("completes the next argument name after a comma in an incomplete call", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(",
      "  from: @A,",
      "  d",
      ")"
    ].join("\n");
    const position = source.indexOf("\n  d") + "\n  d".length;
    const result = queryIncomplete(source, position);

    expect(result?.category).toBe("argument");
    expect(labels(result)).toEqual(expect.arrayContaining(["dx", "dy"]));
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("d");
  });

  it("uses the builtin argument owner, including spreadAngle's named arguments", () => {
    const source = "nui 1\nconst value: number = spreadAngle(";
    const result = queryIncomplete(source);
    expect(result?.category).toBe("typedInitializer");
    expect(labels(result)).toEqual(["length", "spread"]);
    expect(result?.candidates.every((candidate) => candidate.kind === "argumentName")).toBe(true);
  });

  it("keeps construction and builtin completion active across a blank line", () => {
    const construction = "nui 1\npoint P = coordinate(\n  \n)";
    const constructionPosition = construction.indexOf("  \n") + 2;
    const constructionResult = queryIncomplete(construction, constructionPosition);
    expect(constructionResult?.category).toBe("argument");
    expect(labels(constructionResult)).toEqual(expect.arrayContaining(["x", "y"]));
    expect(constructionResult && construction.slice(constructionResult.replacementRange.from, constructionResult.replacementRange.to)).toBe("");
    expect(constructionResult?.replacementRange.from).toBe(constructionPosition);

    const builtin = "nui 1\nconst a: number = spreadAngle(\n  \n)";
    const builtinPosition = builtin.indexOf("  \n") + 2;
    const builtinResult = queryIncomplete(builtin, builtinPosition);
    expect(builtinResult?.category).toBe("typedInitializer");
    expect(labels(builtinResult)).toEqual(["length", "spread"]);
    expect(builtinResult?.replacementRange).toEqual({ from: builtinPosition, to: builtinPosition });
  });

  it("keeps a later in-call argument out of the blank-line construction slot", () => {
    const source = [
      "nui 1",
      "point P = coordinate(",
      "",
      "y: 20",
      ")"
    ].join("\n");
    const position = source.indexOf("\n\n") + 1;
    const result = queryIncomplete(source, position);

    expect(result?.category).toBe("argument");
    expect(labels(result)).toContain("x");
    expect(labels(result)).not.toContain("y");
    expect(result?.replacementRange).toEqual({ from: position, to: position });
  });

  it("recovers tolerant Module labels only when the current callee keeps its identity", () => {
    const lastGoodSource = [
      "nui 1",
      "module M(",
      "  value: number,",
      "  optional?: number,",
      ") {",
      "  if (hasValue(@optional)) {",
      "    const probe: number = @optional",
      "  }",
      "}",
      "instance Use = M(value: 1)"
    ].join("\n");
    const liveSource = lastGoodSource.replace("instance Use = M(value: 1)", "instance Use = M(\n  \n)");
    const session = createLanguageAnalysisSession(lastGoodSource);
    session.replaceSource(liveSource);
    const sourceRevision = session.getSourceRevision();
    const position = liveSource.indexOf("  \n") + 2;
    const source = { normalizedSource: liveSource, sourceRevision };

    const result = queryDslCompletion({
      source,
      position,
      semantic: session.completionSemanticSnapshot(source),
      recovery: session.completionRecoverySnapshot(source)
    });
    expect(result?.category).toBe("moduleArgumentLabel");
    expect(labels(result)).toEqual(expect.arrayContaining(["value", "optional"]));

    const changedCallee = liveSource.replace("instance Use = M(\n", "instance Use = Other(\n");
    session.replaceSource(changedCallee);
    const changedSource = { normalizedSource: changedCallee, sourceRevision: session.getSourceRevision() };
    const changedPosition = changedCallee.indexOf("  \n") + 2;
    const changed = queryDslCompletion({
      source: changedSource,
      position: changedPosition,
      semantic: session.completionSemanticSnapshot(changedSource),
      recovery: session.completionRecoverySnapshot(changedSource)
    });
    expect(labels(changed)).not.toContain("value");
    expect(labels(changed)).not.toContain("optional");
  });

  it("offers current-source Module labels on a cold-open incomplete call", () => {
    const source = [
      "nui 1",
      "",
      "module M(",
      "value: number,",
      "optional?: number,",
      ") {",
      "}",
      "",
      "instance Use = M(",
      "",
      ")"
    ].join("\n");
    const session = createLanguageAnalysisSession(source);
    const sourceSnapshot = { normalizedSource: source, sourceRevision: session.getSourceRevision() };
    const position = source.indexOf("instance Use = M(\n") + "instance Use = M(\n".length;
    const result = queryDslCompletion({
      source: sourceSnapshot,
      position,
      semantic: session.completionSemanticSnapshot(sourceSnapshot),
      recovery: session.completionRecoverySnapshot(sourceSnapshot)
    });

    expect(result?.category).toBe("moduleArgumentLabel");
    expect(labels(result)).toEqual(["value", "optional"]);

    const sameLinePosition = source.indexOf("instance Use = M(") + "instance Use = M(".length;
    const sameLine = queryDslCompletion({
      source: sourceSnapshot,
      position: sameLinePosition,
      semantic: session.completionSemanticSnapshot(sourceSnapshot),
      recovery: session.completionRecoverySnapshot(sourceSnapshot)
    });
    expect(sameLine?.category).toBe("moduleArgumentLabel");
    expect(labels(sameLine)).toEqual(["value", "optional"]);
    expect(sameLine?.replacementRange).toEqual({ from: sameLinePosition, to: sameLinePosition });

    const unresolvedSource = source.replace("instance Use = M(\n", "instance Use = Other(\n");
    const unresolvedSession = createLanguageAnalysisSession(unresolvedSource);
    const unresolvedSnapshot = { normalizedSource: unresolvedSource, sourceRevision: unresolvedSession.getSourceRevision() };
    const unresolvedPosition = unresolvedSource.indexOf("instance Use = Other(\n") + "instance Use = Other(\n".length;
    const unresolved = queryDslCompletion({
      source: unresolvedSnapshot,
      position: unresolvedPosition,
      semantic: unresolvedSession.completionSemanticSnapshot(unresolvedSnapshot),
      recovery: unresolvedSession.completionRecoverySnapshot(unresolvedSnapshot)
    });

    expect(unresolved?.category).toBe("moduleArgumentLabel");
    expect(labels(unresolved)).not.toContain("value");
    expect(labels(unresolved)).not.toContain("optional");

    const unresolvedSameLinePosition = unresolvedSource.indexOf("instance Use = Other(") + "instance Use = Other(".length;
    const unresolvedSameLine = queryDslCompletion({
      source: unresolvedSnapshot,
      position: unresolvedSameLinePosition,
      semantic: unresolvedSession.completionSemanticSnapshot(unresolvedSnapshot),
      recovery: unresolvedSession.completionRecoverySnapshot(unresolvedSnapshot)
    });
    expect(unresolvedSameLine?.category).toBe("moduleArgumentLabel");
    expect(labels(unresolvedSameLine)).not.toContain("value");
    expect(labels(unresolvedSameLine)).not.toContain("optional");
  });

  it("uses current-source Module parameters instead of stale last-good labels", () => {
    const lastGoodSource = [
      "nui 1",
      "module M(old: number) {",
      "}",
      "instance Use = M(old: 1)"
    ].join("\n");
    const liveSource = [
      "nui 1",
      "module M(new: number) {",
      "}",
      "instance Use = M(",
      "",
      ")"
    ].join("\n");
    const session = createLanguageAnalysisSession(lastGoodSource);
    session.replaceSource(liveSource);
    const source = { normalizedSource: liveSource, sourceRevision: session.getSourceRevision() };
    const position = liveSource.indexOf("\n\n") + 1;
    const result = queryDslCompletion({
      source,
      position,
      semantic: session.completionSemanticSnapshot(source),
      recovery: session.completionRecoverySnapshot(source)
    });

    expect(result?.category).toBe("moduleArgumentLabel");
    expect(labels(result)).toEqual(["new"]);
    expect(labels(result)).not.toContain("old");
  });

  it("tracks current Module parameter additions and removals during tolerant recovery", () => {
    const lastGoodSource = [
      "nui 1",
      "module M(old: number) {",
      "}",
      "instance Use = M(old: 1)"
    ].join("\n");
    const cases = [
      { signature: "old: number, added: number", expected: ["old", "added"] },
      { signature: "removed: number", expected: ["removed"] },
      { signature: "", expected: [] }
    ];

    const session = createLanguageAnalysisSession(lastGoodSource);
    for (const { signature, expected } of cases) {
      const liveSource = [
        "nui 1",
        `module M(${signature}) {`,
        "}",
        "instance Use = M(",
        "",
        ")"
      ].join("\n");
      session.replaceSource(liveSource);
      const source = { normalizedSource: liveSource, sourceRevision: session.getSourceRevision() };
      const position = liveSource.indexOf("\n\n") + 1;
      const result = queryDslCompletion({
        source,
        position,
        semantic: session.completionSemanticSnapshot(source),
        recovery: session.completionRecoverySnapshot(source)
      });

      expect(result?.category).toBe("moduleArgumentLabel");
      expect(labels(result)).toEqual(expected);
    }
  });

  it("returns typed scalar syntax candidates for numeric, boolean, string, and choice expressions", () => {
    const number = queryIncomplete("nui 1\nconst value: number = ");
    expect(labels(number)).toContain("abs");
    expect(labels(number)).toContain("pi");
    expect(number?.candidates.some((candidate) => candidate.kind === "builtin")).toBe(true);

    const boolean = queryIncomplete("nui 1\nconst value: boolean = ");
    expect(labels(boolean)).toEqual(expect.arrayContaining(["true", "false"]));
    expect(labels(boolean)).not.toContain("0");

    const string = queryIncomplete("nui 1\nconst value: string = ");
    expect(labels(string)).toContain('""');

    const choice = queryIncomplete("nui 1\nconst value: choice(left, right) = ");
    expect(labels(choice)).toEqual(expect.arrayContaining(["left", "right"]));
  });

  it("offers pi in a numeric construction field and Module scalar argument", () => {
    const construction = exactQuery(
      "nui 1\npoint P = coordinate(x: @, y: 0)",
      "coordinate(x: @",
      "coordinate(x: @".length
    );
    expect(construction?.category).toBe("parameter");
    expect(labels(construction)).toContain("pi");
    expect(construction?.candidates.find((candidate) => candidate.label === "pi")).toMatchObject({ kind: "literal" });

    const module = exactQuery(
      "nui 1\nmodule M(value: number) {\n}\ninstance Use = M(value: )",
      "instance Use = M(value: ",
      "instance Use = M(value: ".length
    );
    expect(module?.category).toBe("moduleArgumentValue");
    expect(labels(module)).toContain("pi");
    expect(module?.candidates.find((candidate) => candidate.label === "pi")).toMatchObject({ kind: "literal" });
  });

  it("returns visible typed bindings and keeps the @ marker outside the replacement range", () => {
    const source = "nui 1\nconst width: number = 10\nconst value: number = @width";
    const result = exactQuery(source, "@width");
    expect(result?.category).toBe("typedInitializer");
    expect(labels(result)).toContain("width");
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("width");
    expect(result?.candidates.find((candidate) => candidate.label === "width")?.kind).toBe("binding");
  });

  it("returns typed builtins, numeric operators, and array/list references without filtering or truncation", () => {
    const points = Array.from({ length: 12 }, (_, index) => `point P${index} = coordinate(x: ${index}, y: 0)`);
    const source = ["nui 1", ...points, "line L = segment(start: @P0, end: @P1)"].join("\n");
    const result = exactQuery(source, "@P0");
    expect(result?.category).toBe("parameter");
    expect(labels(result).filter((label) => /^P\d+$/.test(label))).toHaveLength(12);
    expect(labels(result)).toContain("P11");
    expect(result?.candidates.some((candidate) => candidate.kind === "operator")).toBe(false);

    const listSource = [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 0), end: (20, 0))",
      "line L = offset(sources: [@A], distance: 1, side: left)"
    ].join("\n");
    const list = exactQuery(listSource, "@A");
    expect(list?.category).toBe("parameter");
    expect(labels(list)).toContain("A");
    expect(list?.replacementRange.from).toBe(listSource.indexOf("@A") + 1);
  });

  it("uses source geometry semantics for @ references and . properties without runtime evaluation", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: @A, end: @A)",
      "const value: number = @AB.length"
    ].join("\n");
    const reference = exactQuery(source, "@AB");
    expect(reference?.category).toBe("typedInitializer");
    const property = exactQuery(source, "@AB.le", 6);
    expect(property?.category).toBe("elementParameter");
    expect(labels(property)).toContain("length");
    expect(property && source.slice(property.replacementRange.from, property.replacementRange.to)).toBe("le");
    expect(property?.replacementRange.from).toBe(source.indexOf("@AB.le") + "@AB.".length);
  });

  it("offers only exactly assignable choice geometry properties", () => {
    const source = [
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "const direction: choice(counterclockwise, clockwise) = @A."
    ].join("\n");
    const property = exactQuery(source, "@A.", 3);
    expect(property?.category).toBe("elementParameter");
    expect(labels(property)).toEqual(["direction"]);

    const wrongType = source.replace("choice(counterclockwise, clockwise)", "choice(left, right)");
    expect(labels(exactQuery(wrongType, "@A.", 3))).toEqual([]);
  });

  it("uses the same typed choice-property lane for another schema choice", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point D = between(start: @A, end: @B, ratio: 0.5)",
      "const mode: choice(distance, ratio) = @D."
    ].join("\n");
    const result = exactQuery(source, "@D.", 3);
    expect(result?.category).toBe("elementParameter");
    expect(labels(result)).toEqual(["placementMode"]);
  });

  it("resolves set RHS geometry properties using the target's exact type", () => {
    const source = [
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "let direction: choice(counterclockwise, clockwise) = clockwise",
      "set direction = @A."
    ].join("\n");
    const choiceResult = exactQuery(source, "@A.", 3);
    expect(choiceResult?.category).toBe("setRhs");
    expect(labels(choiceResult)).toEqual(["direction"]);

    const numericSource = source.replace(
      "let direction: choice(counterclockwise, clockwise) = clockwise",
      "let length: number = 1"
    ).replace("set direction", "set length");
    const numericResult = exactQuery(numericSource, "@A.", 3);
    expect(labels(numericResult)).toContain("length");
  });

  it("completes qualified members in the ordinary CAD namespace", () => {
    const source = [
      "nui 1",
      "group 前身頃 {",
      "  point か = coordinate(x: 0, y: 0)",
      "}",
      "point 使用 = offset(from: @前身頃::か, dx: 0, dy: 0)"
    ].join("\n");
    const result = exactQuery(source, "@前身頃::か");
    expect(result?.category).toBe("moduleQualifiedMember");
    expect(labels(result)).toContain("か");
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("か");
    expect(result?.replacementRange.from).toBe(source.indexOf("@前身頃::か") + "@前身頃::".length);
  });

  it("filters ordinary CAD qualified members by the point reference parameter kind", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "  line L = segment(start: @P, end: @P)",
      "}",
      "point X = offset(from: @G::, dx: 0, dy: 0)"
    ].join("\n");
    const result = exactQuery(source, "@G::", "@G::".length);
    expect(result?.context).toMatchObject({ expectedGeometryKind: "point" });
    expect(labels(result)).toEqual(["P"]);
  });

  it("filters ordinary CAD qualified members by the line reference parameter kind", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "  line L = segment(start: @P, end: @P)",
      "}",
      "point X = intersection(line1: @G::, line2: @G::, index: 0, extensions: false)"
    ].join("\n");
    const result = exactQuery(source, "@G::", "@G::".length);
    expect(result?.context).toMatchObject({ expectedGeometryKind: "lineReference" });
    expect(labels(result)).toEqual(["L"]);
  });

  it("uses the canonical typed-scalar geometry property vocabulary", () => {
    const source = [
      "nui 1",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "const value: number = @Arc.ra"
    ].join("\n");
    const result = exactQuery(source, "@Arc.ra");
    expect(result?.category).toBe("elementParameter");
    expect(labels(result)).toEqual(expect.arrayContaining(["radius", "startPoint.x", "centerPoint.x"]));
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("ra");
  });

  it("returns choice literals and mutable set targets only", () => {
    const source = [
      "nui 1",
      "let target: number = 1",
      "const fixed: number = 2",
      "set ta = @target"
    ].join("\n");
    const set = exactQuery(source, "set ta", "set ta".length);
    expect(set?.category).toBe("setTarget");
    expect(labels(set)).toContain("target");
    expect(labels(set)).not.toContain("fixed");
    expect(set?.candidates.every((candidate) => candidate.kind === "binding")).toBe(true);

    const choiceSource = "nui 1\nline L = offset(sources: [A], distance: 1, side: le)";
    const choicePosition = choiceSource.indexOf("side: le") + "side: le".length;
    const choice = queryIncomplete(choiceSource, choicePosition);
    expect(choice?.category).toBe("parameter");
    expect(labels(choice)).toEqual(expect.arrayContaining(["left", "right"]));
  });

  it("returns template-hole scalar expressions and maps multiline ranges back to physical source", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "text Label = label(text: \"width=${@width}\", anchor: (0, 0))"
    ].join("\n");
    const template = exactQuery(source, "@width");
    expect(template?.category).toBe("templateHole");
    expect(labels(template)).toContain("width");
    expect(template && source.slice(template.replacementRange.from, template.replacementRange.to)).toBe("width");

    const multiline = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(",
      "  from: @A",
      "  d",
      ")"
    ].join("\n");
    const position = multiline.indexOf("\n  d") + "\n  d".length;
    const result = queryIncomplete(multiline, position);
    expect(result?.category).toBe("argument");
    expect(result && multiline.slice(result.replacementRange.from, result.replacementRange.to)).toBe("d");
    expect(result?.replacementRange.from).toBe(position - 1);
  });

  it("preserves a specific Module template-hole context inside an enclosing construction call", () => {
    const source = [
      "nui 1",
      "const outer: number = 10",
      "module M(width: number, caption: string) {",
      "  const local: number = 1",
      "  text Label = label(text: \"width=${@width}\", anchor: (0, 0))",
      "  text Local = label(text: \"local=${@loc}\", anchor: (0, 0))",
      "}"
    ].join("\n");
    const position = source.indexOf("${@width}") + 3;
    const result = exactQuery(source, "${@width}", 3);

    expect(result?.category).toBe("templateHole");
    expect(result?.candidates.map((candidate) => candidate.label)).toEqual(expect.arrayContaining(["width", "local"]));
    expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("outer");
    expect(result?.replacementRange).toEqual({ from: position, to: position });

    const partialPosition = source.indexOf("${@loc}") + "${@loc".length;
    const partial = exactQuery(source, "${@loc}", "${@loc".length);
    expect(partial?.category).toBe("templateHole");
    expect(partial?.candidates.map((candidate) => candidate.label)).toEqual(expect.arrayContaining(["local"]));
    expect(partial?.candidates.map((candidate) => candidate.label)).not.toContain("outer");
    expect(partial?.replacementRange).toEqual({ from: partialPosition - 3, to: partialPosition });
  });

  it("supports Module callee, argument labels, typed filtering, geometry interfaces, and qualified members", () => {
    const source = [
      "nui 1",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "module Producer() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "module Strict(input: line, width: number) {",
      "}",
      "module Broad(input: path, width: number, optional: number = 0) {",
      "}",
      "instance Source = Producer()",
      "instance Use = Strict(input: @)",
      "instance Call = Broad(input: @L, )"
    ].join("\n");

    const calleeSource = source.replace("instance Call = Broad(input: @L,", "instance Call = Br");
    const callee = exactQuery(calleeSource, "= Br", "= Br".length);
    expect(callee?.category).toBe("moduleCallee");
    expect(labels(callee)).toContain("Broad");

    const argument = exactQuery(source, "Broad(input: @L, ", "Broad(input: @L, ".length);
    expect(argument?.category).toBe("moduleArgumentLabel");
    expect(labels(argument)).toContain("width");

    const lineArgument = exactQuery(source, "@)", 1);
    expect(lineArgument?.category).toBe("moduleArgumentValue");
    expect(labels(lineArgument)).toContain("L");
    expect(labels(lineArgument)).not.toContain("P");

    const qualifiedSource = source.replace("instance Call = Broad(input: @L, )", "point X = offset(from: @Source::Public, dx: 1, dy: 0)");
    const qualified = exactQuery(qualifiedSource, "@Source::", "@Source::".length);
    expect(qualified?.category).toBe("moduleQualifiedMember");
    expect(labels(qualified)).toEqual(["Public"]);
    expect(qualified?.replacementRange.from).toBe(qualifiedSource.indexOf("@Source::") + "@Source::".length);
  });

  it("completes visible nominal record types, values, constructors, and fields", () => {
    const source = [
      "nui 1",
      "record Pair(x: number, label: string)",
      "record Other(x: number, label: string)",
      'const settings: Pair = Pair(x: 3, label: "root")',
      'const otherValue: Other = Other(x: 4, label: "other")',
      'const pending: Pair = Pair(x: 1, label: "pending")',
      'const alias: Pair = @settings',
      "const field: number = @settings.x"
    ].join("\n");

    const type = exactQuery(source, "const pending: Pair", "const pending: Pa".length);
    expect(type?.category).toBe("declaredType");
    expect(labels(type)).toEqual(expect.arrayContaining(["Pair", "Other"]));

    const whole = exactQuery(source, "const pending: Pair = Pair", "const pending: Pair = ".length);
    expect(whole?.category).toBe("recordInitializer");
    expect(labels(whole)).toEqual(expect.arrayContaining(["settings", "Pair"]));
    expect(labels(whole)).not.toContain("otherValue");

    const value = exactQuery(source, "const alias: Pair = @settings", "const alias: Pair = @".length);
    expect(value?.category).toBe("recordInitializer");
    expect(labels(value)).toEqual(expect.arrayContaining(["settings", "pending"]));
    expect(labels(value)).not.toContain("otherValue");

    const fields = exactQuery(source, 'const pending: Pair = Pair(x: 1, label: "pending")', "const pending: Pair = Pair(x: 1, ".length);
    expect(fields?.category).toBe("recordInitializer");
    expect(labels(fields)).toEqual(["label"]);
    expect(fields?.candidates[0]?.kind).toBe("argumentName");

    const property = exactQuery(source, "@settings.x");
    expect(property?.category).toBe("elementParameter");
    expect(labels(property)).toEqual(["x", "label"]);
  });

  it("completes Module record parameters, guarded optional records, inline constructors, and exports", () => {
    const source = [
      "nui 1",
      "record Pair(x: number, label: string)",
      'const input: Pair = Pair(x: 1, label: "root")',
      "module Inner(input: Pair, optional?: Pair) {",
      "  const copy: Pair = @input",
      "  const member: number = @input.x",
      "  if (hasValue(@optional)) {",
      "    const guarded: Pair = @optional",
      "    const guardedField: number = @optional.x",
      "  }",
      '  export const output: Pair = @copy',
      "}",
      'instance Use = Inner(input: Pair(x: 5, label: "inline"))',
      "const exportedField: number = @Use::output.x"
    ].join("\n");

    const bodyValue = exactQuery(source, "const copy: Pair = @input", "const copy: Pair = @".length);
    expect(bodyValue?.category).toBe("recordInitializer");
    expect(labels(bodyValue)).toEqual(expect.arrayContaining(["input", "Pair"]));

    const bodyField = exactQuery(source, "@input.x");
    expect(bodyField?.category).toBe("elementParameter");
    expect(labels(bodyField)).toEqual(["x", "label"]);

    const optionalValue = exactQuery(source, "const guarded: Pair = @optional", "const guarded: Pair = @".length);
    expect(labels(optionalValue)).toContain("optional");
    const optionalField = exactQuery(source, "@optional.x");
    expect(labels(optionalField)).toEqual(["x", "label"]);

    const inlineFields = exactQuery(source, 'input: Pair(x: 5, label: "inline")', "input: Pair(x: 5, ".length);
    expect(inlineFields?.category).toBe("moduleArgumentValue");
    expect(labels(inlineFields)).toEqual(["label"]);

    const exportedField = exactQuery(source, "@Use::output.x");
    expect(exportedField?.category).toBe("elementParameter");
    expect(labels(exportedField)).toEqual(["x", "label"]);
  });

  it("applies the existing Module optional-presence proof to record fields", () => {
    const source = [
      "nui 1",
      "record Pair(x: number, label: string)",
      'const root: Pair = Pair(x: 1, label: "root")',
      "module Inner(required: Pair, optional?: Pair) {",
      "  if (hasValue(@optional)) {",
      "    const guarded: number = @optional.x",
      "  }",
      "  const requiredField: number = @required.x",
      "  export const output: Pair = @required",
      "}",
      "const rootField: number = @root.x",
      "instance Use = Inner(required: @root)",
      "const qualifiedField: number = @Use::output.x"
    ].join("\n");

    const unguardedSource = [
      "nui 1",
      "record Pair(x: number, label: string)",
      "module Inner(optional?: Pair) {",
      "  const unguarded: number = @optional.x",
      "}",
      "instance Use = Inner()"
    ].join("\n");
    const unguarded = exactQuery(unguardedSource, "const unguarded: number = @optional.x", "const unguarded: number = @optional.".length);
    expect(unguarded?.category).toBe("elementParameter");
    expect(labels(unguarded)).toEqual([]);

    const guarded = exactQuery(source, "const guarded: number = @optional.x", "const guarded: number = @optional.".length);
    expect(labels(guarded)).toEqual(["x", "label"]);

    const required = exactQuery(source, "const requiredField: number = @required.x", "const requiredField: number = @required.".length);
    expect(labels(required)).toEqual(["x", "label"]);

    const root = exactQuery(source, "const rootField: number = @root.x", "const rootField: number = @root.".length);
    expect(labels(root)).toEqual(["x", "label"]);

    const qualified = exactQuery(source, "@Use::output.x");
    expect(labels(qualified)).toEqual(["x", "label"]);
  });

  it("completes only compatible whole-record Module exports in a record declaration", () => {
    const source = [
      "nui 1",
      "record Pair(x: number, label: string)",
      "record Other(x: number, label: string)",
      "module Inner(input: Pair) {",
      "  export const output: Pair = @input",
      '  export const wrong: Other = Other(x: 2, label: "other")',
      "}",
      'instance Use = Inner(input: Pair(x: 5, label: "inline"))',
      "const copy: Pair = @Use::output"
    ].join("\n");

    const qualifiedRecord = exactQuery(source, "const copy: Pair = @Use::output", "const copy: Pair = @Use::".length);
    expect(qualifiedRecord?.category).toBe("moduleQualifiedMember");
    expect(labels(qualifiedRecord)).toEqual(["output"]);
    expect(qualifiedRecord?.candidates[0]?.kind).toBe("record");
  });

  it("offers same-name record shorthand only for exact nominal matches", () => {
    const compatible = [
      "nui 1",
      "record Pair(x: number)",
      "const input: Pair = Pair(x: 1)",
      "module Inner(input: Pair) {",
      "}",
      "instance Use = Inner()"
    ].join("\n");
    const compatibleResult = exactQuery(compatible, "Inner()", "Inner(".length);
    expect(compatibleResult?.category).toBe("moduleArgumentLabel");
    expect(labels(compatibleResult)).toEqual(["@input", "input"]);

    const incompatible = [
      "nui 1",
      "record Pair(x: number)",
      "record Other(x: number)",
      "const input: Other = Other(x: 1)",
      "module Inner(input: Pair) {",
      "}",
      "instance Use = Inner()"
    ].join("\n");
    const incompatibleResult = exactQuery(incompatible, "Inner()", "Inner(".length);
    expect(incompatibleResult?.category).toBe("moduleArgumentLabel");
    expect(labels(incompatibleResult)).toEqual(["input"]);
  });

  it("supports Japanese source identifiers and fails closed for stale semantic snapshots", () => {
    const source = [
      "nui 1",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "line 身頃線 = segment(start: @前身頃, end: @前身頃)",
      "point 後身頃 = offset(from: @前身頃, dx: 1, dy: 0)"
    ].join("\n");
    const japanese = exactQuery(source, "@前身頃");
    expect(labels(japanese)).toContain("前身頃");

    const oldSource = "nui 1\nconst old: number = 1\nconst value: number = @old";
    const oldCompiled = compileWithIds(oldSource, 3);
    const liveSource = "nui 1\nconst renamed: number = 1\nconst value: number = @ren";
    const stale = queryDslCompletion({
      source: { normalizedSource: liveSource, sourceRevision: 4 },
      position: liveSource.length,
      semantic: { sourceRevision: 3, compiled: oldCompiled }
    });
    expect(stale?.category).toBe("typedInitializer");
    expect(labels(stale)).not.toContain("old");
    expect(stale?.candidates.some((candidate) => candidate.kind === "binding")).toBe(false);

    const syntax = queryIncomplete("nui 1\nconst value: number = ");
    expect(labels(syntax)).toContain("abs");
  });

  it("returns null for unsupported CRLF input while keeping absolute LF ranges host-neutral", () => {
    expect(queryDslCompletion({
      source: { normalizedSource: "nui 1\r\npoi", sourceRevision: 1 },
      position: 9
    })).toBeNull();
  });
});
