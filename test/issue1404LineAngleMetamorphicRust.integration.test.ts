import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import {
  createRustStdioParityClient,
  isRustEligibleFixture,
  optionsFor,
  fixtureFromSource
} from "./evaluationParitySupport";

type Geometry = "line" | "arc" | "bezier";
type Route = "direct" | "alias" | "module";
type Key = "start" | "end";
type Variant = "BASE" | "T1" | "T2" | "T3" | "O1" | "O2" | "R1";
const geometries: Geometry[] = ["line", "arc", "bezier"];
const routes: Route[] = ["direct", "alias", "module"];
const keys: Key[] = ["start", "end"];
const variants: Variant[] = ["BASE", "T1", "T2", "T3", "O1", "O2", "R1"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const degrees = (angle: number) => angle * Math.PI / 180;
const axisAngle = (a: number, b: number) => {
  const dot = Math.cos(degrees(a)) * Math.cos(degrees(b)) + Math.sin(degrees(a)) * Math.sin(degrees(b));
  return Math.acos(Math.min(1, Math.max(0, Math.abs(dot)))) * 180 / Math.PI;
};

const baseAxis = (geometry: Geometry, key: Key) => {
  if (geometry === "line") return 135;
  if (geometry === "arc") return key === "start" ? 0 : 90;
  // The cubic's endAngle points from its end toward its control handle; its tangent axis is 145°.
  return key === "start" ? 25 : 145;
};

const endpointArgumentsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(endpointArgumentsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "geometryEndpoint" ? [record] : []),
    ...Object.values(record).flatMap(endpointArgumentsIn)
  ];
};

const program = (geometry: Geometry, route: Route, aKey: Key, bKey: Key, variant: Variant) => {
  const aShift = variant === "T1" || variant === "T3" ? [17, -11] : [0, 0];
  const bShift = variant === "T2" || variant === "T3" ? [-13, 19] : [0, 0];
  const [ax, ay] = aShift;
  const [bx, by] = bShift;
  const aName = variant === "R1" && route === "direct" ? "RenamedA" : "A";
  const aliasName = variant === "R1" && route === "alias" ? "RenamedAlias" : "Alias";
  const instanceName = variant === "R1" && route === "module" ? "RenamedUse" : "Use";
  const outputName = variant === "R1" && route === "module" ? "renamedOut" : "out";
  const construction = geometry === "line"
    ? `line ${aName} = polar(start: (${ax}, ${ay}), angle: 135, length: 20)`
    : geometry === "arc"
      ? `arc ${aName} = arc(center: (${ax}, ${ay}), radius: 30, start: 270, end: 360, direction: counterclockwise)`
      : `curve ${aName} = bezier(start: (${ax}, ${ay}), end: (${ax + 80}, ${ay + 25}), startAngle: 25, startLength: 40, endAngle: 145, endLength: 30)`;
  const aBlock = route === "module"
    ? ["module Provider() {", `  ${construction}`, `  move ${aName} as tilted (from: (0, 0), to: (0, 0), angleDeg: 17)`, `  export const ${outputName}: path = @${aName}.base`, "}", `instance ${instanceName} = Provider()`]
    : [construction, `move ${aName} as tilted (from: (0, 0), to: (0, 0), angleDeg: 17)`, ...(route === "alias" ? [`const ${aliasName}: path = @${aName}.base`] : [])];
  const bBlock = [`line Axis = segment(start: (${100 + bx}, ${40 + by}), end: (${110 + bx}, ${40 + by}))`];
  const aRef = route === "direct" ? `@${aName}` : route === "alias" ? `@${aliasName}` : `@${instanceName}::${outputName}`;
  const ordered = variant === "O2" ? [...bBlock, ...aBlock] : [...aBlock, ...bBlock];
  const source = ["nui 1", ...ordered, ...(variant === "O1" ? ["const Unrelated: number = 41"] : []),
    `const measured: number = lineAngle(${aRef}.${aKey}, @Axis.${bKey})`, ""].join("\n");
  const expected = axisAngle(baseAxis(geometry, aKey) + (route === "direct" ? 17 : 0), 0);
  return { source, expected, aName, aRef, instanceName, outputName };
};

describe("Issue #1404 lineAngle translation, source-order, and renaming invariants", () => {
  let rust: ReturnType<typeof createRustStdioParityClient> | undefined;
  beforeAll(() => { rust = createRustStdioParityClient(root); }, 120_000);
  afterAll(() => rust?.dispose());

  it("checks the analytic result, selected identity, and production parity in every cell", async () => {
    const baselines = new Map<string, number>();
    let checked = 0;
    for (const geometry of geometries) for (const route of routes) for (const aKey of keys) for (const bKey of keys) for (const variant of variants) {
      const id = `${geometry}-${route}-${aKey}-${bKey}-${variant}`;
      const { source, expected, aName } = program(geometry, route, aKey, bKey, variant);
      let fixture: ReturnType<typeof fixtureFromSource>;
      try { fixture = fixtureFromSource(source); } catch (error) {
        throw new Error(`${id}: compile failed: ${String(error)}\n${source}`, { cause: error });
      }
      const diagnostics = fixture.compiled?.diagnostics.filter((d) => d.severity === "error") ?? [];
      expect(diagnostics, `${id}\n${source}`).toEqual([]);
      const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find((b) => b.kind === "typed" && b.name === "measured");
      if (!binding) throw new Error(`${id}: missing measured binding`);
      const call = fixture.compiled?.doc.scalarProgram?.statements.find((s) => s.bindingId === binding.id)?.declaration.initializer;
      if (call?.kind !== "call" || call.name !== "lineAngle") throw new Error(`${id}: missing lineAngle call`);
      const a = call.args[0];
      const b = call.args[1];
      expect(a, `${id}\n${source}`).toMatchObject({ kind: "geometryEndpoint", endpointKey: aKey });
      expect(b, `${id}\n${source}`).toMatchObject({ kind: "geometryEndpoint", endpointKey: bKey });
      if (a?.kind !== "geometryEndpoint" || b?.kind !== "geometryEndpoint" || !a.target || !b.target) throw new Error(`${id}: missing resolved target`);
      const aElement = fixture.elements.find((e) => e.name === aName);
      const axisElement = fixture.elements.find((e) => e.name === "Axis");
      if (!aElement || !axisElement) throw new Error(`${id}: missing fixture element`);
      expect(a.target, `${id}\n${source}`).toMatchObject({
        statementId: aElement.id,
        stagePath: route === "direct" ? ["final"] : ["base"]
      });
      expect(b.target, id).toMatchObject({ statementId: axisElement.id });
      expect(isRustEligibleFixture(fixture), id).toBe(true);
      const options = optionsFor(fixture);
      const input = buildRustEvaluationInput(fixture.elements, options);
      const transportedEndpoints = endpointArgumentsIn(input);
      expect(transportedEndpoints, `${id} A transport`).toContainEqual(a);
      expect(transportedEndpoints, `${id} B transport`).toContainEqual(b);
      const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
      const rustPayload = await rust!.evaluate(fixture.elements, options);
      const read = (payload: typeof tsPayload) => {
        const result = evaluationPayloadToResult(payload);
        expect(result.errors, id).toEqual([]);
        const scalar = result.computedScalarBindings?.get(binding.id);
        if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(`${id}: scalar ${JSON.stringify(scalar)}`);
        return scalar.value.value;
      };
      const ts = read(tsPayload);
      const production = read(rustPayload);
      expect(Math.abs(ts - expected), `${id} TypeScript\n${source}`).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(production - expected), `${id} production Rust\n${source}`).toBeLessThanOrEqual(1e-6);
      const baselineKey = `${geometry}-${route}-${aKey}-${bKey}`;
      if (variant === "BASE") baselines.set(baselineKey, production);
      else expect(Math.abs(production - baselines.get(baselineKey)!), `${id} invariant`).toBeLessThanOrEqual(1e-6);
      checked++;
    }
    expect(checked).toBe(252);
  }, 600_000);
});
