import { describe, expect, it } from "vitest";
import { buildSourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import { parseDsl } from "../dsl/dslParser";
import type { SourceLexicalNamespaceIndex } from "../dsl/sourceLexicalNamespaceIndex";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import type { BindingResolution } from "./bindingResolution";
import { parseScalarExpression } from "./expressionParser";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import {
  resolveBuiltinGeometryArguments,
  type ResolveBuiltinGeometryArgumentsResult
} from "./builtinGeometryArgumentResolution";

const documentSource = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 3, y: 4)",
  "line AB = segment(start: @A, end: @B)",
  "arc ArcA = arc(center: @A, radius: 10, start: 0, end: 90)",
  "curve CurveA = bezier(start: @A, end: @B)",
  "group Group {",
  "  point Inner = coordinate(x: 1, y: 1)",
  "}",
  "point C = coordinate(x: 0, y: 5)",
  "line OtherLine = segment(start: (0, 0), end: (0, 10))",
  "line PolarLine = polar(start: (0, 0), angle: 45, length: 10)"
].join("\n");

const parsed = parseDsl(documentSource);
if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  throw new Error("geometry builtin test document must parse without errors");
}
const stableStatementIdByIndex = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
const sourceNamespace = buildSourceLexicalNamespaceIndex(parsed.statements, stableStatementIdByIndex);
const sourceDeclarationsByStatementId = new Map(sourceNamespace.allDeclarations.map((declaration) => [declaration.statementId, declaration]));

const astFor = (source: string) => {
  const result = parseScalarExpression(source, { start: 0, end: source.length });
  if (!result.ast) throw new Error(`expected a successful parse of ${source}`);
  return result.ast;
};

const sourceGeometryResolution = (name: string, namespace: SourceLexicalNamespaceIndex): BindingResolution => {
  const declaration = namespace.allDeclarations.find((candidate) => candidate.name === name);
  if (!declaration) throw new Error(`missing source declaration ${name}`);
  return {
    kind: "namespace",
    name,
    scopeId: declaration.scopeId,
    statementIndex: 100,
    reason: "incompatible",
    declarationKind: "geometry",
    statementId: declaration.statementId
  };
};

const resolve = (
  source: string,
  scalarReferenceResolutions: readonly BindingResolution[]
): ResolveBuiltinGeometryArgumentsResult => resolveBuiltinGeometryArguments({
  ast: astFor(source),
  statementIndex: 100,
  scalarReferenceResolutions,
  sourceDeclarationsByStatementId,
  resolveSourceGeometryPath: (elementName) => resolveSourceLexicalPath(sourceNamespace, 9, parseDslReferenceToken(elementName))
});

const targetOf = (result: ResolveBuiltinGeometryArgumentsResult, index: number) => {
  const reference = result.references[index];
  if (reference.kind !== "resolvedGeometry") throw new Error("expected resolved geometry sidecar");
  return reference.target;
};

describe("resolveBuiltinGeometryArguments", () => {
  it("resolves distance point arguments to stable geometry targets", () => {
    const result = resolve("distance(@A, @B)", [sourceGeometryResolution("A", sourceNamespace), sourceGeometryResolution("B", sourceNamespace)]);

    expect(result.issues).toEqual([]);
    expect([...result.claimedReferenceOccurrenceIndexes]).toEqual([0, 1]);
    expect([targetOf(result, 0), targetOf(result, 1)]).toEqual([
      { statementId: "stable-1", statementIndex: 1, geometryType: "point" },
      { statementId: "stable-2", statementIndex: 2, geometryType: "point" }
    ]);
  });

  it("uses the same resolution path for angle and lineDistance", () => {
    const angle = resolve("angle(@A, @B)", [sourceGeometryResolution("A", sourceNamespace), sourceGeometryResolution("B", sourceNamespace)]);
    const lineDistance = resolve("lineDistance(@A, @AB)", [sourceGeometryResolution("A", sourceNamespace), sourceGeometryResolution("AB", sourceNamespace)]);

    expect(angle.issues).toEqual([]);
    expect(lineDistance.issues).toEqual([]);
    expect(targetOf(lineDistance, 1)).toMatchObject({ statementId: "stable-3", statementIndex: 3, geometryType: "line" });
  });

  it("claims geometry references during wrong-arity recovery without adding a geometry diagnostic", () => {
    const result = resolve("distance(@A)", [sourceGeometryResolution("A", sourceNamespace)]);

    expect(result.issues).toEqual([]);
    expect([...result.claimedReferenceOccurrenceIndexes]).toEqual([0]);
    expect(targetOf(result, 0)).toEqual({ statementId: "stable-1", statementIndex: 1, geometryType: "point" });
  });

  it("resolves lineAngle positional line arguments to stable strict-line targets", () => {
    const result = resolve("lineAngle(@AB, @OtherLine)", [
      sourceGeometryResolution("AB", sourceNamespace),
      sourceGeometryResolution("OtherLine", sourceNamespace)
    ]);

    expect(result.issues).toEqual([]);
    expect([targetOf(result, 0), targetOf(result, 1)]).toEqual([
      { statementId: "stable-3", statementIndex: 3, geometryType: "line" },
      { statementId: "stable-10", statementIndex: 10, geometryType: "line" }
    ]);
  });

  it("accepts a polar strict line through the same lineAngle resolution path", () => {
    const result = resolve("lineAngle(@AB, @PolarLine)", [
      sourceGeometryResolution("AB", sourceNamespace),
      sourceGeometryResolution("PolarLine", sourceNamespace)
    ]);

    expect(result.issues).toEqual([]);
    expect(targetOf(result, 1)).toEqual({ statementId: "stable-11", statementIndex: 11, geometryType: "line" });
  });

  it.each([
    ["distance(@AB, @A)", ["AB", "A"], "point", "line"],
    ["lineDistance(@A, @ArcA)", ["A", "ArcA"], "line", "path"],
    ["lineDistance(@A, @CurveA)", ["A", "CurveA"], "line", "path"],
    ["lineAngle(@AB, @ArcA)", ["AB", "ArcA"], "line", "path"],
    ["lineAngle(@AB, @CurveA)", ["AB", "CurveA"], "line", "path"]
  ])("retains the actual target and reports %s interface mismatch", (source, names, expected, actual) => {
    const result = resolve(source, names.map((name) => sourceGeometryResolution(name, sourceNamespace)));

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "builtin-geometry-type-mismatch",
        expectedGeometryType: expected,
        actualGeometryType: actual,
        presentation: {
          key: "diagnostic.builtin-geometry-type-mismatch",
          parameters: { expected, actual }
        }
      })
    ]);
    expect(result.references.every((reference) => reference.kind === "resolvedGeometry")).toBe(true);
    expect(result.issues[0]?.occurrenceIndex).toBe(source.startsWith("distance") ? 0 : 1);
  });

  it("reports undefined and forward references as invalid geometry arguments", () => {
    const undefinedResult = resolve("distance(@Missing, @A)", [
      { kind: "undefined", name: "Missing", scopeId: "root", statementIndex: 100 },
      sourceGeometryResolution("A", sourceNamespace)
    ]);
    const forwardResult = resolve("distance(@Later, @A)", [
      { kind: "namespace", name: "Later", scopeId: "root", statementIndex: 100, reason: "forward", declarationKind: "geometry" },
      sourceGeometryResolution("A", sourceNamespace)
    ]);

    expect(undefinedResult.issues[0]).toMatchObject({ code: "builtin-geometry-argument-invalid" });
    expect(undefinedResult.issues[0]?.presentation).toEqual({
      key: "diagnostic.builtin-geometry-argument-invalid-reference",
      parameters: { reference: "@Missing" }
    });
    expect(undefinedResult.issues[0]?.message).toContain("未定義");
    expect(forwardResult.issues[0]).toMatchObject({ code: "builtin-geometry-argument-invalid" });
    expect(forwardResult.issues[0]?.message).toContain("後で宣言");
    expect([...undefinedResult.claimedReferenceOccurrenceIndexes]).toEqual([0, 1]);
  });

  it("reports an ambiguous source namespace geometry reference as an invalid claimed operand", () => {
    const result = resolve("distance(@Ambiguous, @A)", [
      {
        kind: "namespace",
        name: "Ambiguous",
        scopeId: "root",
        statementIndex: 100,
        reason: "ambiguous",
        declarationKind: "geometry"
      },
      sourceGeometryResolution("A", sourceNamespace)
    ]);

    expect(targetOf(result, 0)).toBeNull();
    expect(result.issues[0]).toMatchObject({
      code: "builtin-geometry-argument-invalid",
      occurrenceIndex: 0,
      message: expect.stringContaining("一意に解決できません")
    });
    expect(result.claimedReferenceOccurrenceIndexes).toEqual(new Set([0, 1]));
  });

  it("resolves a qualified geometry reference from the canonical declaration identity", () => {
    const result = resolve("distance(@Group::Inner, @A)", [
      sourceGeometryResolution("Inner", sourceNamespace),
      sourceGeometryResolution("A", sourceNamespace)
    ]);

    expect(result.issues).toEqual([]);
    expect(targetOf(result, 0)).toEqual({ statementId: "stable-7", statementIndex: 7, geometryType: "point" });
  });

  it("rejects non-reference geometry arguments while preserving nested reference traversal", () => {
    const result = resolve("distance(@A + 1, @B)", [sourceGeometryResolution("A", sourceNamespace), sourceGeometryResolution("B", sourceNamespace)]);

    expect(result.references).toHaveLength(2);
    expect(result.claimedReferenceOccurrenceIndexes).toEqual(new Set([1]));
    expect(result.issues[0]).toMatchObject({ code: "builtin-geometry-argument-invalid", occurrenceIndex: null });
    expect(targetOf(result, 1)).toMatchObject({ statementId: "stable-2", geometryType: "point" });
  });

  it("resolves existing derived point members as point geometry targets", () => {
    const distance = resolve("distance(@AB.start, @C)", [sourceGeometryResolution("C", sourceNamespace)]);
    const angle = resolve("angle(@AB.end, @C)", [sourceGeometryResolution("C", sourceNamespace)]);
    const lineDistance = resolve("lineDistance(@AB.start, @AB)", [sourceGeometryResolution("AB", sourceNamespace)]);

    expect(distance.issues).toEqual([]);
    expect(angle.issues).toEqual([]);
    expect(lineDistance.issues).toEqual([]);
    expect(distance.geometryPropertyTargets.get(9)).toEqual({ statementId: "stable-3", statementIndex: 3, geometryType: "point", pointKey: "start" });
    expect(angle.geometryPropertyTargets.get(6)).toEqual({ statementId: "stable-3", statementIndex: 3, geometryType: "point", pointKey: "end" });
    expect(lineDistance.geometryPropertyTargets.get(13)).toEqual({ statementId: "stable-3", statementIndex: 3, geometryType: "point", pointKey: "start" });
    expect(distance.claimedReferenceOccurrenceIndexes).toEqual(new Set([0]));
  });

  it.each([
    ["distance(@AB.length, @C)", ["C"]],
    ["distance(@A.start, @C)", ["C"]],
    ["lineDistance(@A, @AB.start)", ["A"]]
  ])("rejects invalid derived point geometry operands in %s", (source, names) => {
    const result = resolve(source, names.map((name) => sourceGeometryResolution(name, sourceNamespace)));

    expect(result.issues[0]).toMatchObject({ code: "builtin-geometry-argument-invalid", occurrenceIndex: null });
    expect([...result.claimedReferenceOccurrenceIndexes]).toEqual(names.map((_, index) => index));
  });
});
