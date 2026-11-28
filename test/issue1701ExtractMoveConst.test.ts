import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeDslLintDiagnostics } from "@nuinuicad/nui-language";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { createRustStdioParityClient, fixtureFromSource, normalizeParityPayload, optionsFor } from "./evaluationParitySupport";

const kinds = ["ordinary line", "extract member", "transformCopy member"] as const;
type TargetKind = typeof kinds[number];
const line = "line L = segment(start: (0, 0), end: (20, 0))";
const scalar = "const angle: number = -45";
const point = "point P = coordinate(x: 0, y: 15)";
const member = (kind: TargetKind) => kind === "extract member"
  ? "extract C(source: L, parts: [copy: start..end])"
  : kind === "transformCopy member" ? "transformCopy C(startPoint: (0, 0), parts: [copy: L])" : "";
const recipe = (kind: TargetKind, expression: string) =>
  `move ${kind === "ordinary line" ? "L" : "C::copy"}(from: (0, 0), to: (0, 0), angleDeg: ${expression})`;

const sourceFor = (rows: string[]) => ["nui 1", ...rows.filter(Boolean)].join("\n");
const bodyFor = (kind: TargetKind, angleBefore: boolean) =>
  (angleBefore ? [scalar, line, member(kind)] : [line, member(kind), scalar]).concat(recipe(kind, "angle"));

const rootCases = kinds.flatMap(kind => ["-45", "angle"].flatMap(expression => {
  const declaration = member(kind);
  const move = recipe(kind, expression);
  const cases = [
    ["scalar before source", [scalar, line, declaration, move]],
    ["scalar before member", [line, scalar, declaration, move]],
    ["scalar after member", [line, declaration, scalar, move]],
    ["scalar after move", [line, declaration, move, scalar]],
    ["point before move", [line, declaration, scalar, point, move]],
    ["point after move", [line, declaration, scalar, move, point]],
    ["fixed label before move", [line, declaration, scalar, 'text Label = label(text: "probe", anchor: (0, 15), size: 3)', move]],
    ["const-to-const probe", [line, declaration, scalar, "const probe: number = angle", move]]
  ] as const;
  return cases.map(([layout, rows]) => ({
    kind, expression, layout, source: sourceFor([...rows]),
    unused: layout === "const-to-const probe" ? ["probe"] : expression === "-45" ? ["angle"] : []
  }));
}));

let rust: ReturnType<typeof createRustStdioParityClient> | undefined;
beforeAll(() => {
  if (import.meta.env.VITE_RUN_RUST_PARITY === "1") rust = createRustStdioParityClient(process.cwd());
}, 125_000);
afterAll(() => rust?.dispose());

const checkGeometry = async (source: string, kind: TargetKind, unused: string[]) => {
  const fixture = fixtureFromSource(source);
  expect(fixture.compiled!.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  const compiled = fixture.compiled!.currentCompiled;
  expect(analyzeDslLintDiagnostics(compiled)
    .filter(d => d.code === "unused-typed-declaration")
    .map(d => d.presentation?.parameters?.name)).toEqual(unused);
  const options = optionsFor(fixture);
  const reference = evaluateElementsReferencePayload(fixture.elements, options);
  if (rust) expect(normalizeParityPayload(await rust.evaluate(fixture.elements, options))).toEqual(normalizeParityPayload(reference));
  const result = evaluationPayloadToResult(reference);
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors ?? []).toEqual([]);
  const coordinates = (name: string, expected: readonly [number, number]) => {
    const elements = fixture.elements.filter(element => element.name === name);
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      const geometry = result.computedGeometry.get(element.id);
      if (!geometry || !("start" in geometry) || !("end" in geometry)) throw new Error(`Missing path geometry for ${name}`);
      expect(geometry.start).toMatchObject({ x: 0, y: 0 });
      expect(geometry.end?.x).toBeCloseTo(expected[0], 8);
      expect(geometry.end?.y).toBeCloseTo(expected[1], 8);
    }
  };
  const rotated = [14.1421356237, -14.1421356237] as const;
  coordinates("L", kind === "ordinary line" ? rotated : [20, 0]);
  if (kind !== "ordinary line") coordinates("copy", rotated);
};

describe("M1 canonical recipe scalar readiness", () => {
  it("counts equivalent ordinary-line layouts only once", () => {
    expect(rootCases).toHaveLength(48);
    expect(new Set(rootCases.map(test => test.source)).size).toBe(46);
  });

  it.each(rootCases)("$kind / $layout / $expression", async ({ kind, source, unused }) => {
    await checkGeometry(source, kind, unused);
  }, 20_000);
});

describe("M2 materialized path lexical scopes", () => {
  const cells = kinds.slice(1).flatMap(kind =>
    ["root", "Group", "Module"].flatMap(scope =>
      [true, false].map(angleBefore => ({ kind, scope, angleBefore }))));
  it.each(cells)("$kind / $scope / before source $angleBefore", async ({ kind, scope, angleBefore }) => {
    const body = bodyFor(kind, angleBefore);
    const nested = body.map(row => `  ${row}`);
    const rows = scope === "Group" ? ["group G {", ...nested, "}"]
      : scope === "Module" ? ["module Shape() {", ...nested, "}", "instance First = Shape()", "instance Second = Shape()"] : body;
    await checkGeometry(sourceFor(rows), kind, []);
  }, 20_000);
});

describe("M3 invalid recipe scalar inputs", () => {
  it.each(kinds.flatMap(kind => ["unresolved", "wrong type"].map(reason => ({ kind, reason }))))(
    "$kind / $reason", ({ kind, reason }) => {
      const rows = [line, member(kind), reason === "wrong type" ? 'const angle: string = "bad"' : "", recipe(kind, "angle")];
      const compiled = compileFreshCanonicalText(sourceFor(rows));
      expect(compiled.currentCompiled.document).toBeNull();
      expect(compiled.diagnostics.some(d => d.severity === "error" && (d.message.includes("angle") || d.message.includes("number")))).toBe(true);
    }
  );
});

describe("#1701 placement controls", () => {
  it.each([0, 1, 2])("unrelated point at %i", async (index) => {
    const rows = bodyFor("extract member", false);
    rows.splice(index, 0, point);
    await checkGeometry(sourceFor(rows), "extract member", []);
  }, 20_000);

  it("interpolating label still identifies the used declaration", async () => {
    const rows = bodyFor("extract member", false);
    rows.splice(3, 0, 'text Label = label(text: "${angle}", anchor: (0, 15), size: 3)');
    await checkGeometry(sourceFor(rows), "extract member", []);
  }, 20_000);
});

describe("#1701 runtime dependency failure", () => {
  it.each(kinds)("withholds invalid final geometry for a %s", async (kind) => {
    const rows = [line, member(kind), "const angle: number = 1 / 0", recipe(kind, "angle"),
      `point Dependent = offset(from: ${kind === "ordinary line" ? "L" : "C::copy"}.end, dx: 1, dy: 0)`];
    const fixture = fixtureFromSource(sourceFor(rows));
    expect(fixture.compiled!.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    const options = optionsFor(fixture);
    const reference = evaluateElementsReferencePayload(fixture.elements, options);
    if (rust) expect(normalizeParityPayload(await rust.evaluate(fixture.elements, options))).toEqual(normalizeParityPayload(reference));
    const result = evaluationPayloadToResult(reference);
    const id = (name: string) => fixture.elements.find(element => element.name === name)!.id;
    expect(result.errors).toContainEqual(expect.objectContaining({ elementName: "move" }));
    expect(result.computedGeometry.has(id(kind === "ordinary line" ? "L" : "copy"))).toBe(false);
    expect(result.computedGeometry.has(id("Dependent"))).toBe(false);
    if (kind !== "ordinary line") expect(result.computedGeometry.get(id("L"))).toMatchObject({ end: { x: 20, y: 0 } });
  }, 20_000);
});

it("#1701 withholds a result when a required move point is disabled", async () => {
  const source = sourceFor([
    line, member("extract member"),
    "point Off = coordinate(x: 0, y: 0, enabled: false)",
    "move C::copy(from: Off, to: (0, 0), angleDeg: -45)"
  ]);
  const fixture = fixtureFromSource(source);
  const options = optionsFor(fixture);
  const reference = evaluateElementsReferencePayload(fixture.elements, options);
  if (rust) expect(normalizeParityPayload(await rust.evaluate(fixture.elements, options))).toEqual(normalizeParityPayload(reference));
  const result = evaluationPayloadToResult(reference);
  const byName = (name: string) => fixture.elements.find(element => element.name === name)!.id;
  expect(result.errors).toContainEqual(expect.objectContaining({ elementName: "move", missingDependencyName: "Off" }));
  expect(result.computedGeometry.has(byName("copy"))).toBe(false);
  expect(result.computedGeometry.get(byName("L"))).toMatchObject({ end: { x: 20, y: 0 } });
}, 20_000);

it.each(["-45", "1 / 0"])("#1701 publishes a Module snapshot only after its final move settles (%s)", async angle => {
  const source = sourceFor([
    "module Shape() {",
    line, member("transformCopy member"), `const angle: number = ${angle}`, recipe("transformCopy member", "angle"),
    "}",
    "instance First = Shape()"
  ]);
  const fixture = fixtureFromSource(source);
  const options = optionsFor(fixture);
  const reference = evaluateElementsReferencePayload(fixture.elements, options);
  if (rust) expect(normalizeParityPayload(await rust.evaluate(fixture.elements, options))).toEqual(normalizeParityPayload(reference));
  const result = evaluationPayloadToResult(reference);
  const id = fixture.elements.find(element => element.name === "First")!.id;
  const snapshot = result.instanceBaseGeometry?.get(id);
  if (angle === "-45") {
    expect(result.errors).toEqual([]);
    expect(snapshot?.find(geometry => geometry.name === "copy")).toMatchObject({
      end: { x: expect.closeTo(14.1421356237, 8), y: expect.closeTo(-14.1421356237, 8) }
    });
    expect(snapshot?.find(geometry => geometry.name === "L")).toMatchObject({ end: { x: 20, y: 0 } });
  } else {
    expect(result.errors).toContainEqual(expect.objectContaining({ elementName: "move" }));
    expect(snapshot).toBeUndefined();
  }
}, 20_000);
