import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { createRustStdioParityClient, fixtureFromSource, isRustEligibleFixture, optionsFor, runtimeDiagnosticsFor } from "./evaluationParitySupport";

type Geometry = "line" | "arc" | "bezier";
type Key = "start" | "end";
type PositiveCase = {
  id: string;
  source: string;
  expected: number;
  aKey: Key;
  bKey?: Key;
  aName?: string;
  aStage?: string;
  targetKind?: string;
  equivalentTo?: string;
  targetIndex?: number;
  baseline?: boolean;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const geometries: Geometry[] = ["line", "arc", "bezier"];
const keys: Key[] = ["start", "end"];
const rad = (degrees: number) => degrees * Math.PI / 180;
const deg = (radians: number) => radians * 180 / Math.PI;
const axisAngle = (a: number, b: number) => Math.acos(Math.min(1, Math.max(0,
  Math.abs(Math.cos(rad(a)) * Math.cos(rad(b)) + Math.sin(rad(a)) * Math.sin(rad(b)))
))) * 180 / Math.PI;

const shape = (geometry: Geometry, name: string, x: number): string => {
  if (geometry === "line") return `line ${name} = polar(start: (${x}, 0), angle: 23, length: 30)`;
  if (geometry === "arc") return `arc ${name} = arc(center: (${x}, 0), radius: 20, start: 281, end: 11, direction: counterclockwise)`;
  return `curve ${name} = bezier(start: (${x}, 0), end: (${x + 80}, 30), startAngle: 47, startLength: 30, endAngle: 151, endLength: 40)`;
};
const tangent = (geometry: Geometry, key: Key) => {
  if (geometry === "line") return 23;
  if (geometry === "arc") return key === "start" ? 11 : 101;
  return key === "start" ? 47 : 151;
};
const generatedShape = (geometry: Geometry) => {
  if (geometry === "line") return "line A = polar(start: (@i * 100, 0), angle: 23 + @i * 10, length: 30)";
  if (geometry === "arc") return "arc A = arc(center: (@i * 100, 0), radius: 20, start: 281 + @i * 10, end: 11 + @i * 10, direction: counterclockwise)";
  return "curve A = bezier(start: (@i * 100, 0), end: (@i * 100 + 80, 30), startAngle: 47 + @i * 10, startLength: 30, endAngle: 151 + @i * 10, endLength: 40)";
};
const parameterizedShape = (geometry: Geometry) => {
  if (geometry === "line") return "export line A = polar(start: (@x, 0), angle: 23 + @turn, length: 30)";
  if (geometry === "arc") return "export arc A = arc(center: (@x, 0), radius: 20, start: 281 + @turn, end: 11 + @turn, direction: counterclockwise)";
  return "export curve A = bezier(start: (@x, 0), end: (@x + 80, 30), startAngle: 47 + @turn, startLength: 30, endAngle: 151 + @turn, endLength: 40)";
};
const source = (...lines: string[]) => ["nui 1", ...lines, ""].join("\n");
const cubicPoints = (() => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 30 * Math.cos(rad(47)), y: 30 * Math.sin(rad(47)) };
  const p3 = { x: 80, y: 30 };
  const p2 = { x: 80 - 40 * Math.cos(rad(151)), y: 30 - 40 * Math.sin(rad(151)) };
  return [p0, p1, p2, p3] as const;
})();
const cubicMidpoint = {
  x: (cubicPoints[0].x + 3 * cubicPoints[1].x + 3 * cubicPoints[2].x + cubicPoints[3].x) / 8,
  y: (cubicPoints[0].y + 3 * cubicPoints[1].y + 3 * cubicPoints[2].y + cubicPoints[3].y) / 8
};
const cubicMidAxis = deg(Math.atan2(
  cubicPoints[1].y - cubicPoints[0].y + 2 * (cubicPoints[2].y - cubicPoints[1].y) + cubicPoints[3].y - cubicPoints[2].y,
  cubicPoints[1].x - cubicPoints[0].x + 2 * (cubicPoints[2].x - cubicPoints[1].x) + cubicPoints[3].x - cubicPoints[2].x
));

const endpointsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(endpointsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [...(record.kind === "geometryEndpoint" ? [record] : []), ...Object.values(record).flatMap(endpointsIn)];
};

const positiveCases: PositiveCase[] = [];
for (const a of geometries) for (const b of geometries) for (const aKey of keys) for (const bKey of keys) {
  positiveCases.push({
    id: `G-${a}-${b}-${aKey}-${bKey}`,
    source: source(shape(a, "A", 0), shape(b, "B", 150),
      `const result: number = lineAngle(@A.${aKey}, @B.${bKey})`),
    expected: axisAngle(tangent(a, aKey), tangent(b, bKey)), aKey, bKey, aName: "A", aStage: "final"
  });
}

const stageRoutes = ["direct-base", "direct-final", "direct-named", "alias-base", "alias-named", "module-base"] as const;
for (const geometry of geometries) for (const route of stageRoutes) for (const aKey of keys) {
  const moduleRoute = route === "module-base";
  const selected = route.endsWith("base") ? "base" : route.endsWith("named") ? "turned" : "final";
  const body = [shape(geometry, "A", 0),
    "move A as turned (from: (0, 0), to: (0, 0), angleDeg: 17)",
    "move A as turnedAgain (from: (0, 0), to: (0, 0), angleDeg: 29)"];
  const aReference = moduleRoute ? "@Use::selected"
    : route.startsWith("alias") ? "@Alias" : `@A.${selected}`;
  const declarations = moduleRoute
    ? ["module Provider() {", ...body.map((line) => `  ${line}`), "  export const selected: path = @A.base", "}", "instance Use = Provider()"]
    : [...body, ...(route.startsWith("alias") ? [`const Alias: path = @A.${selected}`] : [])];
  positiveCases.push({
    id: `S-${geometry}-${route}-${aKey}`,
    source: source(...declarations, "line Axis = segment(start: (150, 40), end: (160, 40))",
      `const result: number = lineAngle(${aReference}.${aKey}, @Axis.start)`),
    expected: axisAngle(tangent(geometry, aKey) + (selected === "base" ? 0 : selected === "turned" ? 17 : 46), 0),
    aKey, aName: "A", aStage: selected
  });
}

for (const carrier of ["root", "module"] as const) for (const indexKind of ["literal", "typed", "nested"] as const)
  for (const placement of ["before", "after"] as const) for (const aKey of keys) {
    const reference = carrier === "root" ? "@Paths" : "@Use::Paths";
    const index = indexKind === "literal" ? "0" : indexKind === "typed" ? "@index" : "@selectors[0]";
    const measurement = `const result: number = lineAngle(${reference}[${index}].${aKey}, @Axis.start)`;
    const carrierLines = carrier === "root"
      ? [shape("arc", "A", 0), "const Paths: path[] = [@A]"]
      : ["module Provider() {", `  ${shape("arc", "A", 0)}`, "  export const Paths: path[] = [@A]", "}", "instance Use = Provider()"];
    const declarations = ["line Axis = segment(start: (150, 40), end: (160, 40))", ...carrierLines,
      ...(indexKind === "typed" ? ["const index: number = 0"] : []),
      ...(indexKind === "nested" ? ["const selectors: number[] = [0]"] : [])];
    positiveCases.push({
      id: `C-${carrier}-${indexKind}-${placement}-${aKey}`,
      source: source(...(placement === "before" ? [measurement, ...declarations] : [...declarations, measurement])),
      expected: axisAngle(tangent("arc", aKey), 0), aKey
    });
  }

for (const geometry of geometries) for (const route of ["direct", "alias"] as const) {
  const reference = route === "direct" ? "@Paths" : "@AliasPaths";
  positiveCases.push({
    id: `C-stage-${geometry}-${route}`,
    source: source(shape(geometry, "A", 0), "move A as turned (from: (0, 0), to: (0, 0), angleDeg: 17)",
      "const Paths: path[] = [@A.base]", "const AliasPaths: path[] = @Paths",
      "line Axis = segment(start: (150, 40), end: (160, 40))",
      `const result: number = lineAngle(${reference}[0].start, @Axis.start)`),
    expected: axisAngle(tangent(geometry, "start"), 0), aKey: "start",
    equivalentTo: `C-stage-${geometry}`
  });
}

for (const geometry of geometries) for (const occurrence of [0, 1] as const)
  for (const stage of ["base", "final"] as const) for (const aKey of keys) {
    positiveCases.push({
      id: `F-${geometry}-${occurrence}-${stage}-${aKey}`,
      source: source("line Axis = segment(start: (300, 40), end: (310, 40))",
        "for i in range(min: 0, max: 1, step: 1) {",
        `  ${generatedShape(geometry)}`,
        "  move A as turned (from: (0, 0), to: (0, 0), angleDeg: 17)", "}",
        `const result: number = lineAngle(@A[${occurrence}].${stage}.${aKey}, @Axis.start)`),
      expected: axisAngle(tangent(geometry, aKey) + occurrence * 10 + (stage === "final" ? 17 : 0), 0),
      aKey, targetKind: "forGroupOccurrence", aStage: stage, targetIndex: occurrence
    });
  }

for (const geometry of geometries) for (const control of ["reverse", "stage-target"] as const) {
  const modifiers = control === "reverse"
    ? ["  reverse A ()"]
    : ["  move A as turned (from: (0, 0), to: (0, 0), angleDeg: 17)",
      "  move A.turned as second (from: (0, 0), to: (0, 0), angleDeg: 20)"];
  const aKey = "start";
  positiveCases.push({
    id: `F-${geometry}-${control}`,
    source: source("line Axis = segment(start: (300, 40), end: (310, 40))",
      "for i in range(min: 0, max: 1, step: 1) {", `  ${generatedShape(geometry)}`, ...modifiers, "}",
      `const result: number = lineAngle(@A[1]${control === "stage-target" ? ".turned.second" : ""}.${aKey}, @Axis.start)`),
    expected: axisAngle(tangent(geometry, control === "reverse" ? "end" : "start") + 10 +
      (control === "stage-target" ? 37 : 0), 0),
    aKey, targetKind: "forGroupOccurrence", targetIndex: 1
  });
}

for (const geometry of geometries) for (const instance of ["One", "Two"] as const)
  for (const route of ["export", "carry"] as const) for (const aKey of keys) {
    const ref = route === "export" ? `@${instance}::A` : `@${instance}::carried`;
    positiveCases.push({
      id: `M-${geometry}-${instance}-${route}-${aKey}`,
      source: source("module Provider(turn: number, x: number) {", `  ${parameterizedShape(geometry)}`,
        "  export const carried: path = @A", "}", "instance One = Provider(turn: 0, x: 0)",
        "instance Two = Provider(turn: 17, x: 150)",
        "line Axis = segment(start: (300, 40), end: (310, 40))",
        `const result: number = lineAngle(${ref}.${aKey}, @Axis.start)`),
      expected: axisAngle(tangent(geometry, aKey) + (instance === "Two" ? 17 : 0), 0), aKey
    });
  }

for (const geometry of geometries) for (const route of ["export", "alias", "nested"] as const) for (const aKey of keys) {
  const ref = route === "export" ? "@Use::carried" : route === "alias" ? "@Alias" : "@Nested";
  positiveCases.push({
    id: `M-carry-${geometry}-${route}-${aKey}`,
    source: source("module Provider() {", `  ${shape(geometry, "A", 0)}`,
      "  move A as turned (from: (0, 0), to: (0, 0), angleDeg: 17)",
      "  export const carried: path = @A.base", "}", "instance Use = Provider()",
      "const Alias: path = @Use::carried", "const Nested: path = @Alias",
      "line Axis = segment(start: (150, 40), end: (160, 40))",
      `const result: number = lineAngle(${ref}.${aKey}, @Axis.start)`),
    expected: axisAngle(tangent(geometry, aKey), 0), aKey
  });
}

for (const geometry of geometries) for (const transformation of ["swap", "reverse", "carry"] as const)
  for (const chosenKey of keys) for (const context of ["root", "module"] as const) {
    const opposite: Key = chosenKey === "start" ? "end" : "start";
    const inModule = context === "module";
    const geometryLines = [shape(geometry, "A", 0), ...(transformation === "reverse" ? ["reverse A ()"] : []),
      ...(transformation === "carry" && inModule ? ["export const carried: path = @A"] : [])];
    const declarations = inModule
      ? ["module Provider() {", ...geometryLines.map((line) => `  ${line.replace(/^(line|arc|curve) A/, "export $1 A")}`),
        "}", "instance Use = Provider()"]
      : [...geometryLines, ...(transformation === "carry" ? ["const Alias: path = @A"] : [])];
    const direct = inModule ? "@Use::A" : "@A";
    const carried = inModule ? "@Use::carried" : "@Alias";
    const baseline = transformation === "reverse" ? `${direct}.base.${chosenKey}` : `${direct}.${chosenKey}`;
    const changed = transformation === "reverse" ? `${direct}.${opposite}`
      : transformation === "carry" ? `${carried}.${chosenKey}` : `${direct}.${chosenKey}`;
    const axis = "@Axis.start";
    positiveCases.push({
      id: `V-${geometry}-${transformation}-${chosenKey}-${context}`,
      source: source(...declarations, "line Axis = segment(start: (150, 40), end: (160, 40))",
        `const baseline: number = lineAngle(${baseline}, ${axis})`,
        `const result: number = lineAngle(${transformation === "swap" ? `${axis}, ${changed}` : `${changed}, ${axis}`})`),
      expected: axisAngle(tangent(geometry, chosenKey), 0),
      aKey: transformation === "swap" ? "start" : transformation === "reverse" ? opposite : chosenKey,
      bKey: transformation === "swap" ? chosenKey : "start", baseline: true
    });
  }

for (const geometry of geometries) for (const transformation of ["base", "offset", "split", "reverse"] as const)
  for (const aKey of keys) for (const route of ["direct", "alias"] as const) {
    let declarations: string[];
    let tangentAngle = tangent(geometry, aKey);
    if (transformation === "offset") {
      declarations = [shape(geometry, "Source", 0),
        "line A = offset(sources: [@Source], distance: 2, side: right, closed: false, suppressTrimWarnings: false)"];
    } else if (transformation === "split") {
      const cut = geometry === "line"
        ? { x: 15 * Math.cos(rad(23)), y: 15 * Math.sin(rad(23)) }
        : geometry === "arc"
          ? { x: 20 * Math.cos(rad(326)), y: 20 * Math.sin(rad(326)) }
          : cubicMidpoint;
      declarations = [shape(geometry, "Source", 0),
        `point Cut = coordinate(x: ${cut.x}, y: ${cut.y})`, "line A = split(source: @Source, at: @Cut)"];
      if (geometry === "arc" && aKey === "start") tangentAngle = 56;
      if (geometry === "bezier" && aKey === "start") tangentAngle = cubicMidAxis;
    } else {
      declarations = [shape(geometry, "A", 0), ...(transformation === "reverse" ? ["reverse A ()"] : [])];
      if (transformation === "reverse") tangentAngle = tangent(geometry, aKey === "start" ? "end" : "start");
    }
    const reference = route === "direct" ? "@A" : "@Alias";
    positiveCases.push({
      id: `T-${geometry}-${transformation}-${aKey}-${route}`,
      source: source(...declarations, ...(route === "alias" ? ["const Alias: path = @A.final"] : []),
        "line Axis = segment(start: (200, 40), end: (210, 40))",
        `const result: number = lineAngle(${reference}.${aKey}, @Axis.start)`),
      expected: axisAngle(tangentAngle, 0), aKey, aName: "A", aStage: "final",
      equivalentTo: `T-${geometry}-${transformation}-${aKey}`
    });
  }

const nPositive = [
  { id: "N01-parallel", a: "line A = polar(start: (0, 0), angle: 23, length: 30)", axis: 23, start: 23, end: 23 },
  { id: "N02-antiparallel", a: "line A = polar(start: (0, 0), angle: 23, length: 30)", axis: 203, start: 23, end: 23 },
  { id: "N03-perpendicular", a: "line A = polar(start: (0, 0), angle: 23, length: 30)", axis: 113, start: 23, end: 23 },
  { id: "N04-obtuse-reduction", a: "line A = polar(start: (0, 0), angle: 135, length: 30)", axis: 0, start: 135, end: 135 },
  { id: "N05-near-parallel", a: "line A = polar(start: (0, 0), angle: 23, length: 30)", axis: 23.0001, start: 23, end: 23 },
  { id: "N06-near-perpendicular", a: "line A = polar(start: (0, 0), angle: 23, length: 30)", axis: 113.0001, start: 23, end: 23 },
  { id: "N07-short-unique", a: "line A = polar(start: (0, 0), angle: 23, length: 0.0000001)", axis: 0, start: 23, end: 23 },
  { id: "N08-zero-start-handle", a: "curve A = bezier(start: (0, 0), end: (80, 30), startAngle: 47, startLength: 0, endAngle: 151, endLength: 40)",
    axis: 0, start: deg(Math.atan2(cubicPoints[2].y, cubicPoints[2].x)), end: 151 },
  { id: "N09-zero-end-handle", a: "curve A = bezier(start: (0, 0), end: (80, 30), startAngle: 47, startLength: 30, endAngle: 151, endLength: 0)",
    axis: 0, start: 47, end: deg(Math.atan2(30 - cubicPoints[1].y, 80 - cubicPoints[1].x)) },
  { id: "N10-repeated-controls", a: "curve A = bezier(start: (0, 0), end: (40, 0), startAngle: 47, startLength: 0, endAngle: 0, endLength: 40)",
    axis: 23, start: 0, end: 0 }
] as const;
for (const scenario of nPositive) for (const aKey of keys) {
  positiveCases.push({
    id: `${scenario.id}-${aKey}`,
    source: source(scenario.a,
      `line Axis = polar(start: (150, 40), angle: ${scenario.axis}, length: 30)`,
      `const result: number = lineAngle(@A.${aKey}, @Axis.start)`),
    expected: axisAngle(scenario[aKey], scenario.axis), aKey, aName: "A", aStage: "final"
  });
}
// A closed corner has two one-sided tangent axes at the same spatial junction.
// The explicit endpoint key selects the ordered path's first or last usable axis.
for (const aKey of keys) positiveCases.push({
  id: `N13-closed-junction-${aKey}`,
  source: source("line First = segment(start: (0, 0), end: (10, 0))",
    "line Second = segment(start: (10, 0), end: (0, 10))",
    "line Third = segment(start: (0, 10), end: (0, 0))",
    "line A = join(paths: [@First, @Second, @Third], closed: true)",
    "line Axis = segment(start: (150, 40), end: (160, 40))",
    `const result: number = lineAngle(@A.${aKey}, @Axis.start)`),
  expected: aKey === "start" ? 0 : 90, aKey, aName: "A", aStage: "final"
});

type FailureCase = { id: string; source: string; issueCode?: string; diagnosticCode?: string };
const failureCases: FailureCase[] = [];
for (const key of keys) {
  const axis = "line Axis = segment(start: (150, 40), end: (160, 40))";
  const add = (id: string, declarations: string[], ref: string, issueCode?: string, diagnosticCode?: string) =>
    failureCases.push({ id: `${id}-${key}`, source: source(...declarations, axis,
      `const result: number = lineAngle(${ref}.${key}, @Axis.start)`), issueCode, diagnosticCode });
  add("N11-zero-line", ["line A = segment(start: (0, 0), end: (0, 0))"], "@A", "evaluation-geometry-endpoint-tangent-unavailable");
  add("N12-collapsed-curve", ["curve A = bezier(start: (0, 0), end: (0, 0), startAngle: 0, startLength: 0, endAngle: 0, endLength: 0)"],
    "@A", "evaluation-geometry-endpoint-tangent-unavailable");
  add("N14-nonfinite-geometry", ["line A = segment(start: (0, 0), end: (1 / 0, 0))"],
    "@A", "evaluation-geometry-builtin-unavailable");
  add("N15-disabled", ["line A = segment(start: (0, 0), end: (10, 0), enabled: false)"],
    "@A", "evaluation-geometry-builtin-disabled");
  add("N16-unresolved", [], "@Missing", undefined, "builtin-geometry-argument-invalid");
  add("N17-dynamic-absent", [shape("line", "A", 0), "const Paths: path[] = [@A]", "const index: number = 2"],
    "@Paths[@index]", "evaluation-collection-index-invalid");
}

type CompatibilityCase = { id: string; source: string; expected?: number; invalid?: boolean; properties?: boolean };
const compatibilityCases: CompatibilityCase[] = [];
const compatibilityGroups = [
  { name: "distance", declarations: ["point P = coordinate(x: 0, y: 0)", "point Q = coordinate(x: 3, y: 4)"], expression: "distance(@P, @Q)", expected: 5 },
  { name: "angle", declarations: ["point P = coordinate(x: 0, y: 0)", "point Q = coordinate(x: 3, y: 4)"], expression: "angle(@P, @Q)", expected: deg(Math.atan2(4, 3)) },
  { name: "lineDistance", declarations: ["line A = segment(start: (0, 0), end: (1, 0))", "point Q = coordinate(x: 10, y: 3)"], expression: "lineDistance(@Q, @A)", expected: 3 },
  { name: "spreadAngle", declarations: [], expression: "spreadAngle(length: 20, spread: 10)", expected: 2 * deg(Math.asin(0.25)) },
  { name: "properties", declarations: ["line A = polar(start: (0, 0), angle: 23, length: 30)"], expression: "@startObserved + @endObserved", expected: 226 }
] as const;
for (const group of compatibilityGroups) for (const context of ["root", "module"] as const) {
  const propertyLines = group.name === "properties"
    ? ["const startObserved: number = @A.startAngleDeg", "const endObserved: number = @A.endAngleDeg"] : [];
  const moduleBody = [...group.declarations, ...propertyLines,
    ...(group.name === "properties" ? [] : [`export const measured: number = ${group.expression}`])];
  compatibilityCases.push({
    id: `K-${group.name}-${context}`,
    source: context === "root"
      ? source(...group.declarations, ...propertyLines,
        ...(group.name === "properties" ? ["const startCheck: number = @startObserved", "const endCheck: number = @endObserved"] : []),
        `const result: number = ${group.expression}`)
      : source("module Measure() {", ...moduleBody.map((line) =>
        `  ${group.name === "properties" ? line.replace(/^const /, "export const ") : line}`), "}",
        "instance Use = Measure()",
        ...(group.name === "properties" ? ["const startCheck: number = @Use::startObserved", "const endCheck: number = @Use::endObserved"] : []),
        `const result: number = ${group.name === "properties"
          ? "@Use::startObserved + @Use::endObserved" : "@Use::measured"}`),
    expected: group.expected, properties: group.name === "properties"
  });
}

type HistoricalCase = { id: string; source: string; expected?: number; issueCode?: string };
const historicalCases: HistoricalCase[] = [
  {
    id: "H-q03-forward-root-nested",
    source: source("const result: number = lineAngle(@Paths[@selectors[0]].start, @Axis.end)",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]", "const selectors: number[] = [1]"),
    expected: 45
  },
  {
    id: "H-q03-late-root-nested-control",
    source: source("line Axis = segment(start: (30, 30), end: (40, 30))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "const Paths: path[] = [@Axis, @Diagonal]", "const selectors: number[] = [1]",
      "const result: number = lineAngle(@Paths[@selectors[0]].start, @Axis.end)"),
    expected: 45
  },
  {
    id: "H-s03-qualified-output-array",
    source: source("line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L as first (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "module Pass(source: path) {", "  export const out: path = @source", "}",
      "instance Use = Pass(source: @L.first)", "const Paths: path[] = [@Use::out]",
      "const result: number = lineAngle(@Paths[0].start, @Axis.start)"),
    expected: 15
  },
  {
    id: "H-s03-qualified-output-root-alias-control",
    source: source("line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L as first (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "module Pass(source: path) {", "  export const out: path = @source", "}",
      "instance Use = Pass(source: @L.first)", "const Alias: path = @Use::out",
      "const Paths: path[] = [@Alias]", "const result: number = lineAngle(@Paths[0].start, @Axis.start)"),
    expected: 15
  },
  {
    id: "H-exported-carry-immutable-alias",
    source: source("line Axis = segment(start: (30, 30), end: (40, 30))",
      "curve Curve = bezier(start: (0, 0), end: (20, 5), startAngle: 25, startLength: 12, endAngle: 145, endLength: 8)",
      "module Forward(source: path) {", "  const ticks: number[] = [1]",
      "  for i in @ticks carry edge: path = @source {", "    next edge = @source", "  }",
      "  export const out: path = @edge", "}", "instance Use = Forward(source: @Curve)",
      "const Alias: path = @Use::out", "const result: number = lineAngle(@Alias.start, @Axis.start)"),
    expected: 25
  },
  {
    id: "H-exported-carry-direct-control",
    source: source("line Axis = segment(start: (30, 30), end: (40, 30))",
      "curve Curve = bezier(start: (0, 0), end: (20, 5), startAngle: 25, startLength: 12, endAngle: 145, endLength: 8)",
      "module Forward(source: path) {", "  const ticks: number[] = [1]",
      "  for i in @ticks carry edge: path = @source {", "    next edge = @source", "  }",
      "  export const out: path = @edge", "}", "instance Use = Forward(source: @Curve)",
      "const result: number = lineAngle(@Use::out.start, @Axis.start)"),
    expected: 25
  },
  ...(["forward", "late"] as const).map((position): HistoricalCase => {
    const measurement = "const result: number = lineAngle(@Use::out[1].start, @Axis.start)";
    const definitions = ["line Axis = segment(start: (100, 40), end: (110, 40))",
      "line L = segment(start: (0, 0), end: (20, 0))",
      "move L as first (from: (0, 0), to: (0, 0), angleDeg: 15)",
      "move L as second (from: (0, 0), to: (0, 0), angleDeg: 30)",
      "const Paths: path[] = [@L.base, @L.first]", "module Pass(paths: path[]) {",
      "  const Local: path[] = @paths", "  export const out: path[] = @Local", "}",
      "instance Use = Pass(paths: @Paths)"];
    return { id: `H-1386-compound-${position}`, source: source(...(position === "forward"
      ? [measurement, ...definitions] : [...definitions, measurement])), expected: 15 };
  }),
  {
    id: "H-singular-arc-offset",
    source: source("line Axis = segment(start: (100, 40), end: (110, 40))",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 10, end: 100)",
      "const Offset: path = offset(sources: [@Arc], distance: 10, side: left, closed: false, suppressTrimWarnings: false)",
      "const result: number = lineAngle(@Offset.start, @Axis.start)"),
    issueCode: "evaluation-geometry-builtin-unavailable"
  },
  {
    id: "H-nearby-valid-arc-offset",
    source: source("line Axis = segment(start: (100, 40), end: (110, 40))",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 10, end: 100)",
      "const Offset: path = offset(sources: [@Arc], distance: 10, side: right, closed: false, suppressTrimWarnings: false)",
      "const result: number = lineAngle(@Offset.start, @Axis.start)"),
    expected: 80
  }
];
for (const invalid of ["old-overload", "point", "unqualified"] as const) for (const context of ["root", "module"] as const) {
  const expression = invalid === "old-overload" ? "lineAngle(@A, @B)"
    : invalid === "point" ? "lineAngle(@P, @Q)" : "lineAngle(A.start, B.start)";
  const declarations = ["line A = segment(start: (0, 0), end: (10, 0))",
    "line B = segment(start: (20, 0), end: (30, 0))",
    "point P = coordinate(x: 0, y: 0)", "point Q = coordinate(x: 10, y: 0)"];
  compatibilityCases.push({
    id: `K-invalid-${invalid}-${context}`,
    source: context === "root"
      ? source(...declarations, `const result: number = ${expression}`)
      : source("module Measure() {", ...declarations.map((line) => `  ${line}`),
        `  export const measured: number = ${expression}`, "}", "instance Use = Measure()",
        "const result: number = @Use::measured"),
    invalid: true
  });
}

describe("Issue #1406 lineAngle residual conformance", () => {
  let rust: ReturnType<typeof createRustStdioParityClient> | undefined;
  beforeAll(() => { rust = createRustStdioParityClient(root); }, 120_000);
  afterAll(() => rust?.dispose());

  const checkPositive = async (testCase: PositiveCase) => {
    const { id, source: program } = testCase;
    let fixture: ReturnType<typeof fixtureFromSource>;
    try { fixture = fixtureFromSource(program); } catch (error) {
      throw new Error(`${id}: compile threw: ${String(error)}\n${program}`, { cause: error });
    }
    const diagnostics = fixture.compiled?.diagnostics.filter((d) => d.severity === "error") ?? [];
    expect(diagnostics, `${id}\n${program}`).toEqual([]);
    const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((b) => b.kind === "typed" && b.name === "result");
    if (!binding) throw new Error(`${id}: missing result binding\n${program}`);
    const call = fixture.compiled?.doc.scalarProgram?.statements.find((s) => s.bindingId === binding.id)?.declaration.initializer;
    if (call?.kind !== "call" || call.name !== "lineAngle") throw new Error(`${id}: missing lineAngle call\n${program}`);
    const [a, b] = call.args;
    expect(a, id).toMatchObject({ kind: "geometryEndpoint", endpointKey: testCase.aKey });
    expect(b, id).toMatchObject({ kind: "geometryEndpoint", endpointKey: testCase.bKey ?? "start" });
    if (a?.kind !== "geometryEndpoint" || b?.kind !== "geometryEndpoint" || !a.target || !b.target) {
      throw new Error(`${id}: missing resolved geometry target`);
    }
    if (testCase.aName) {
      const element = fixture.elements.find((candidate) => candidate.name === testCase.aName);
      if (!element) throw new Error(`${id}: missing ${testCase.aName}`);
      expect(a.target, id).toMatchObject({ statementId: element.id, stagePath: [testCase.aStage ?? "final"] });
    }
    if (testCase.targetKind) expect(a.target.kind, `${id}: ${JSON.stringify(a.target)}`).toBe(testCase.targetKind);
    if (testCase.targetIndex !== undefined) expect(a.target, id).toMatchObject({
      index: { kind: "numberLiteral", value: testCase.targetIndex },
      ...(testCase.aStage ? { stagePath: [testCase.aStage] } : {})
    });
    expect(isRustEligibleFixture(fixture), id).toBe(true);
    const options = optionsFor(fixture);
    const input = buildRustEvaluationInput(fixture.elements, options);
    const transported = endpointsIn(input);
    expect(transported, `${id}: A transport`).toContainEqual(a);
    expect(transported, `${id}: B transport`).toContainEqual(b);
    const ts = evaluateElementsReferencePayload(fixture.elements, options);
    const production = await rust!.evaluate(fixture.elements, options);
    const read = (payload: EvaluationPayload) => {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors, `${id}\n${program}`).toEqual([]);
      const scalar = result.computedScalarBindings?.get(binding.id);
      if (scalar?.status !== "ok" || scalar.value.kind !== "number") {
        throw new Error(`${id}: scalar ${JSON.stringify(scalar)}\n${program}`);
      }
      return scalar.value.value;
    };
    const tsAngle = read(ts);
    const productionAngle = read(production);
    expect(Math.abs(tsAngle - testCase.expected), `${id}: TypeScript ${tsAngle} vs ${testCase.expected}\n${program}`).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(productionAngle - testCase.expected), `${id}: Rust ${productionAngle} vs ${testCase.expected}\n${program}`).toBeLessThanOrEqual(1e-6);
    if (testCase.baseline) {
      const baselineBinding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((candidate) =>
        candidate.kind === "typed" && candidate.name === "baseline");
      if (!baselineBinding) throw new Error(`${id}: missing baseline binding`);
      for (const payload of [ts, production]) {
        const value = evaluationPayloadToResult(payload).computedScalarBindings?.get(baselineBinding.id);
        if (value?.status !== "ok" || value.value.kind !== "number") throw new Error(`${id}: invalid baseline ${JSON.stringify(value)}`);
        expect(Math.abs(value.value.value - testCase.expected), `${id}: baseline oracle`).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(value.value.value - productionAngle), `${id}: metamorphic invariant`).toBeLessThanOrEqual(1e-6);
      }
    }
    return productionAngle;
  };

  const checkFailure = async (testCase: FailureCase) => {
    if (testCase.diagnosticCode) {
      const compilation = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), testCase.source);
      expect(compilation.diagnostics, `${testCase.id}\n${testCase.source}`).toContainEqual(expect.objectContaining({
        severity: "error", code: testCase.diagnosticCode, physicalSpan: expect.any(Object)
      }));
      return;
    }
    let fixture: ReturnType<typeof fixtureFromSource>;
    try { fixture = fixtureFromSource(testCase.source); } catch (error) {
      throw new Error(`${testCase.id}: ${String(error)}\n${testCase.source}`, { cause: error });
    }
    const diagnostics = fixture.compiled?.diagnostics.filter((d) => d.severity === "error") ?? [];
    expect(diagnostics, `${testCase.id}\n${testCase.source}`).toEqual([]);
    const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((b) => b.kind === "typed" && b.name === "result");
    if (!binding) throw new Error(`${testCase.id}: missing result binding`);
    const call = fixture.compiled?.doc.scalarProgram?.statements.find((s) => s.bindingId === binding.id)?.declaration.initializer;
    if (call?.kind !== "call" || call.name !== "lineAngle") throw new Error(`${testCase.id}: missing lineAngle call`);
    expect(call.args[0], testCase.id).toMatchObject({ kind: "geometryEndpoint", endpointKey: testCase.id.endsWith("start") ? "start" : "end" });
    expect(isRustEligibleFixture(fixture), testCase.id).toBe(true);
    const options = optionsFor(fixture);
    const wireEndpoints = endpointsIn(buildRustEvaluationInput(fixture.elements, options));
    expect(wireEndpoints, testCase.id).toContainEqual(call.args[0]);
    const ts = evaluateElementsReferencePayload(fixture.elements, options);
    const production = await rust!.evaluate(fixture.elements, options);
    for (const payload of [ts, production]) {
      const scalar = evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
      expect(scalar, `${testCase.id}\n${testCase.source}`).toMatchObject({ status: "error", issueCode: testCase.issueCode });
      expect(runtimeDiagnosticsFor(fixture, payload), testCase.id).toContainEqual(expect.objectContaining({
        origin: "runtime", severity: "error", code: testCase.issueCode, bindingId: binding.id
      }));
    }
  };

  const checkCompatibility = async (testCase: CompatibilityCase) => {
    const compilation = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), testCase.source);
    const errors = compilation.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (testCase.invalid) {
      expect(errors.length, `${testCase.id}: expected a compiler diagnostic\n${testCase.source}`).toBeGreaterThan(0);
      expect(errors[0], testCase.id).toMatchObject({ severity: "error", physicalSpan: expect.any(Object) });
      return;
    }
    expect(errors, `${testCase.id}\n${testCase.source}`).toEqual([]);
    const fixture = fixtureFromSource(testCase.source);
    expect(isRustEligibleFixture(fixture), testCase.id).toBe(true);
    const options = optionsFor(fixture);
    const ts = evaluateElementsReferencePayload(fixture.elements, options);
    const production = await rust!.evaluate(fixture.elements, options);
    const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((candidate) =>
      candidate.kind === "typed" && candidate.name === "result");
    if (!binding) throw new Error(`${testCase.id}: missing result binding`);
    for (const payload of [ts, production]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors, `${testCase.id}\n${testCase.source}`).toEqual([]);
      const scalar = result.computedScalarBindings?.get(binding.id);
      if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(`${testCase.id}: ${JSON.stringify(scalar)}`);
      expect(Math.abs(scalar.value.value - testCase.expected!), testCase.id).toBeLessThanOrEqual(1e-6);
      if (testCase.properties) for (const [name, expected] of [["startCheck", 23], ["endCheck", 203]] as const) {
        const propertyBinding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((candidate) =>
          candidate.kind === "typed" && candidate.name === name);
        if (!propertyBinding) throw new Error(`${testCase.id}: missing ${name}`);
        const property = result.computedScalarBindings?.get(propertyBinding.id);
        if (property?.status !== "ok" || property.value.kind !== "number") {
          throw new Error(`${testCase.id}: ${name} ${JSON.stringify(property)}`);
        }
        expect(Math.abs(property.value.value - expected), `${testCase.id}: ${name}`).toBeLessThanOrEqual(1e-6);
      }
    }
  };

  const checkHistorical = async (testCase: HistoricalCase) => {
    const compilation = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), testCase.source);
    expect(compilation.diagnostics.filter((d) => d.severity === "error"), `${testCase.id}\n${testCase.source}`).toEqual([]);
    const fixture = fixtureFromSource(testCase.source);
    expect(fixture.compiled?.diagnostics.filter((d) => d.severity === "error"), `${testCase.id}\n${testCase.source}`).toEqual([]);
    expect(isRustEligibleFixture(fixture), testCase.id).toBe(true);
    const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((candidate) =>
      candidate.kind === "typed" && candidate.name === "result");
    if (!binding) throw new Error(`${testCase.id}: missing result`);
    const call = fixture.compiled?.doc.scalarProgram?.statements.find((s) => s.bindingId === binding.id)?.declaration.initializer;
    if (call?.kind !== "call" || call.name !== "lineAngle") throw new Error(`${testCase.id}: missing call`);
    expect(call.args[0], testCase.id).toMatchObject({ kind: "geometryEndpoint", endpointKey: "start", target: expect.any(Object) });
    const options = optionsFor(fixture);
    expect(endpointsIn(buildRustEvaluationInput(fixture.elements, options)), testCase.id).toContainEqual(call.args[0]);
    for (const payload of [evaluateElementsReferencePayload(fixture.elements, options), await rust!.evaluate(fixture.elements, options)]) {
      const scalar = evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
      if (testCase.issueCode) {
        expect(scalar, `${testCase.id}\n${testCase.source}`).toMatchObject({ status: "error", issueCode: testCase.issueCode });
        expect(runtimeDiagnosticsFor(fixture, payload), testCase.id).toContainEqual(expect.objectContaining({
          origin: "runtime", severity: "error", code: testCase.issueCode, bindingId: binding.id
        }));
      } else {
        if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(`${testCase.id}: ${JSON.stringify(scalar)}\n${testCase.source}`);
        expect(Math.abs(scalar.value.value - testCase.expected!), `${testCase.id}\n${testCase.source}`).toBeLessThanOrEqual(1e-6);
      }
    }
  };

  it("G, T, S, C, F, M, V, and finite N: evaluates geometry and numerical routes", async () => {
    expect(positiveCases.length).toBe(280);
    const equivalent = new Map<string, number>();
    for (const testCase of positiveCases) {
      const actual = await checkPositive(testCase);
      if (testCase.equivalentTo) {
        const baseline = equivalent.get(testCase.equivalentTo);
        if (baseline === undefined) equivalent.set(testCase.equivalentTo, actual);
        else expect(Math.abs(actual - baseline), `${testCase.id}: equivalent collection source`).toBeLessThanOrEqual(1e-6);
      }
    }
  }, 600_000);

  it("N11, N12, and N14–N17: rejects undefined tangents and references with structured diagnostics", async () => {
    expect(failureCases.length).toBe(12);
    for (const testCase of failureCases) await checkFailure(testCase);
  }, 600_000);

  it("K: retains 16 neighboring builtin/property and legacy-call contracts", async () => {
    expect(compatibilityCases.length).toBe(16);
    for (const testCase of compatibilityCases) await checkCompatibility(testCase);
  }, 600_000);

  it("H: rechecks ten historical residual and nearby control sources", async () => {
    expect(historicalCases.length).toBe(10);
    for (const testCase of historicalCases) await checkHistorical(testCase);
    const privateAlias = source("line Axis = segment(start: (100, 40), end: (110, 40))",
      "module Provider() {", "  line A = segment(start: (0, 0), end: (10, 0))",
      "  const hidden: path = @A", "}", "instance Use = Provider()",
      "const Alias: path = @Use::hidden", "const result: number = lineAngle(@Alias.start, @Axis.start)");
    const privateCompilation = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), privateAlias);
    expect(privateCompilation.diagnostics, privateAlias).toContainEqual(expect.objectContaining({
      severity: "error", code: "module-private-member", line: 8, column: expect.any(Number)
    }));
  }, 600_000);
});
