import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { geometryPropertiesIn } from "@nuinuicad/nui-language";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const pathSource = [
  "const source_path: path = polyline(",
  "  points: [(0, 0), (30, 0), (30, 40)],",
  "  closed: false,",
  ")"
].join("\n");

const cases: { name: string; cells?: string[]; declarations: string; expected: Record<string, number | null> }[] = [
  {
    name: "A1/A2/C4: present path property is ready before a label requests it (#1606)",
    cells: ["A1", "A2", "C4"],
    declarations: [pathSource,
      "const ordinary: number = @source_path.length",
      "const maybe_path: path? = @source_path",
      "const optional: number? = @maybe_path?.length",
      "const result: number = @optional ?? 0"
    ].join("\n"),
    expected: { ordinary: 70, optional: 70, result: 70 }
  },
  {
    name: "A3/C3: forward aliases retain geometry prerequisites independent of source order",
    cells: ["A3", "C3"],
    declarations: [
      "const result: number = @optional ?? 0",
      "const optional: number? = @alias?.length",
      "const alias: path? = @maybe_path",
      "const maybe_path: path? = @source_path",
      pathSource
    ].join("\n"),
    expected: { optional: 70, result: 70 }
  },
  {
    name: "A4: absent path skips the property read",
    cells: ["A4"],
    declarations: "const maybe_path: path? = none\nconst optional: number? = @maybe_path?.length\nconst result: number = @optional ?? 17",
    expected: { optional: null, result: 17 }
  },
  {
    name: "A5: present zero-length path remains some zero",
    cells: ["A5"],
    declarations: [
      "const source_path: path = polyline(points: [(0, 0), (0, 0)], closed: false)",
      "const maybe_path: path? = @source_path",
      "const optional: number? = @maybe_path?.length",
      "const result: number = @optional ?? 17"
    ].join("\n"),
    expected: { optional: 0, result: 0 }
  },
  {
    name: "point coordinate and line endpoint property families keep their prerequisites",
    declarations: [
      "const p: point = coordinate(x: 30, y: 40)",
      "const maybe_point: point? = @p",
      "const x: number? = @maybe_point?.x",
      "const y: number? = @maybe_point?.y",
      "const l: line = segment(start: (0, 0), end: @p)",
      "const maybe_line: line? = @l",
      "const length: number? = @maybe_line?.length",
      "const end_y: number? = @maybe_line?.end.y",
      "const result: number = (@x ?? 0) + (@y ?? 0) + (@length ?? 0) + (@end_y ?? 0)"
    ].join("\n"),
    expected: { x: 30, y: 40, length: 50, end_y: 40, result: 160 }
  },
  {
    name: "drawable optional line uses the canonical stage prerequisite",
    declarations: [
      "line Base = segment(start: (0, 0), end: (30, 40))",
      "const maybe_line: line? = @Base",
      "const optional: number? = @maybe_line?.length",
      "const result: number = @optional ?? 0"
    ].join("\n"),
    expected: { optional: 50, result: 50 }
  },
  {
    name: "unselected optional geometry property retains lazy activation",
    declarations: [
      pathSource,
      "const maybe_path: path? = @source_path",
      "const result: number = if (false) { @maybe_path?.length ?? 0 } else { 17 }"
    ].join("\n"),
    expected: { result: 17 }
  },
  ...[true, false].map(enabled => ({
    name: `dynamic optional geometry property activation (${enabled})`,
    declarations: [
      pathSource,
      `const enabled: boolean = ${enabled}`,
      "const maybe_path: path? = @source_path",
      "const result: number = if (@enabled) { @maybe_path?.length ?? 0 } else { 17 }"
    ].join("\n"),
    expected: { result: enabled ? 70 : 17 }
  })),
  {
    name: "D1/D2: optional collection scalar and record neighbors remain correct",
    cells: ["D1", "D2"],
    declarations: [
      "record R(value: number)",
      "const r: R? = R(value: 7)",
      "const field: number? = @r?.value",
      "const scalar: number? = 3",
      "const points: point[]? = []",
      "const count: number? = @points?.length",
      "const absent: number[]? = none",
      "const fallback: number = @absent?.length ?? 17",
      "const result: number = (@field ?? 0) + (@scalar ?? 0) + (@count ?? 99) + @fallback"
    ].join("\n"),
    expected: { field: 7, scalar: 3, count: 0, fallback: 17, result: 27 }
  },
  {
    name: "A6: optional path property in a numeric construction input",
    cells: ["A6"],
    declarations: [pathSource,
      "const maybe_path: path? = @source_path",
      "point Probe = coordinate(x: @maybe_path?.length ?? 0, y: 0)",
      "const result: number = @Probe.x"
    ].join("\n"),
    expected: { result: 70 }
  },
  ...[true, false].flatMap((enabled, index) => [
    ...["ordinary", "alias", "optional"].map((kind, family) => ({
      name: `B${family * 2 + index + 1}: dynamic path selection (${kind}, ${enabled})`,
      cells: [`B${family * 2 + index + 1}`],
      declarations: [
        `const enabled: boolean = ${enabled}`,
        "const first: path = polyline(points: [(0, 0), (30, 0), (30, 40)], closed: false)",
        "const second: path = polyline(points: [(0, 0), (10, 0)], closed: false)",
        `const selected: path${kind === "optional" ? "?" : ""} = if (@enabled) { @first } else { @second }`,
        ...(kind === "alias" ? ["const alias: path = @selected"] : []),
        `const result: number = ${kind === "optional" ? "@selected?.length ?? 17" : kind === "alias" ? "@alias.length" : "@selected.length"}`
      ].join("\n"),
      expected: { result: enabled ? 70 : 10 }
    })),
    {
      name: `B${index + 7}: unselected invalid path stays lazy (${enabled})`,
      cells: [`B${index + 7}`],
      declarations: [
        `const enabled: boolean = ${enabled}`,
        `const selected: path = if (@enabled) { ${enabled ? 'polyline(points: [(0, 0), (30, 0), (30, 40)], closed: false)' : 'polyline(points: [(0, 0), (1 / 0, 0)], closed: false)'} } else { ${enabled ? 'polyline(points: [(0, 0), (1 / 0, 0)], closed: false)' : 'polyline(points: [(0, 0), (30, 0), (30, 40)], closed: false)'} }`,
        "const result: number = @selected.length"
      ].join("\n"),
      expected: { result: 70 }
    }
  ]),
  ...[true, false].map((forward, index) => ({
    name: `C${index + 1}: ordinary path property with ${forward ? "forward" : "backward"} reference`,
    cells: forward ? ["C1"] : ["C2", "D3"],
    declarations: (forward
      ? ["const result: number = @source_path.length", pathSource]
      : [pathSource, "const result: number = @source_path.length"]).join("\n"),
    expected: { result: 70 }
  })),
  {
    name: "D4: lazy collection conditional length preserves its selected value",
    cells: ["D4"],
    declarations: [
      "const enabled: boolean = false",
      "const values: number[] = if (@enabled) { [1 / 0] } else { [3, 4] }",
      "const result: number = @values.length"
    ].join("\n"),
    expected: { result: 2 }
  }
];

describe("optional geometry property production dependencies", () => {
  let client: ReturnType<typeof createRustStdioParityClient>;
  beforeAll(() => {
    client = createRustStdioParityClient(join(dirname(fileURLToPath(import.meta.url)), ".."));
  }, 30000);
  afterAll(() => client?.dispose());

  it("projects required and unselected optional reads through the canonical graph", () => {
    for (const lazy of [false, true]) {
      const fixture = fixtureFromSource([
        "nui 1", pathSource,
        "const maybe_path: path? = @source_path",
        `const result: number = ${lazy ? "if (false) { @maybe_path?.length ?? 0 } else { 17 }" : "@maybe_path?.length ?? 0"}`
      ].join("\n"));
      const binding = fixture.compiled!.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === "result")!;
      const statement = fixture.compiled!.doc.scalarProgram!.statements.find(s => s.bindingId === binding.id)!;
      const properties = geometryPropertiesIn(statement.declaration.initializer);
      expect(properties).toHaveLength(1);
      expect(properties[0].geometryValueOccurrence).toBeDefined();
      expect(Boolean(properties[0].lazy)).toBe(lazy);
      const edge = fixture.compiled!.doc.typedDependencyGraph!.edges.find(e =>
        e.from.kind === "binding" && e.from.id === statement.bindingId && e.to.kind === "geometry-value");
      expect(edge?.requiredness).toBe(lazy ? "conditional" : "required");
      if (lazy) expect(edge?.activation?.guards).toContainEqual(expect.objectContaining({ branch: "then", staticSelection: "unselected" }));
    }
  });

  it("evaluates the ordinary dynamic-if Base reproducer through production stdio", async () => {
    const fixture = fixtureFromSource(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/issue-1606/dynamic-ordinary.nui"), "utf8"));
    const options = optionsFor(fixture);
    const rust = await client.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rust)).toEqual(normalizeParityPayload(evaluateElementsReferencePayload(fixture.elements, options)));
    expect(rust.errors).toEqual([]);
    expect(rust.computedGeometry.find(g => g.kind === "text")).toMatchObject({ text: "length = 70 mm" });
  });

  it.each([true, false])("preserves selected invalid-path diagnostics (%s)", async enabled => {
    const valid = "polyline(points: [(0, 0), (30, 0), (30, 40)], closed: false)";
    const invalid = "polyline(points: [(0, 0), (1 / 0, 0)], closed: false)";
    const fixture = fixtureFromSource([
      "nui 1",
      `const enabled: boolean = ${enabled}`,
      `const selected: path = if (@enabled) { ${enabled ? invalid : valid} } else { ${enabled ? valid : invalid} }`,
      "const result: number = @selected.length",
      'text = label(text: "result = ${@result}", anchor: (0, 55), size: 6)'
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const ts = evaluateElementsReferencePayload(fixture.elements, options);
    const rust = await client.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rust)).toEqual(normalizeParityPayload(ts));
    for (const payload of [rust, ts]) {
      expect(payload.geometryValueErrors).toHaveLength(1);
      expect(payload.errors.length).toBeGreaterThan(0);
      expect(payload.computedGeometry.some(g => g.kind === "text")).toBe(false);
      const resultBinding = fixture.compiled!.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === "result")!;
      expect(payload.computedScalarBindings?.find(b => b.bindingId === resultBinding.id)?.evaluation).toMatchObject({
        status: "error", issueCode: "evaluation-geometry-property-unavailable"
      });
    }
  });

  it("covers all 22 authorized geometry-property dependency cells", () => {
    const covered = new Set(cases.flatMap(c => c.cells ?? []));
    const expected = [["A", 6], ["B", 8], ["C", 4], ["D", 4]].flatMap(([prefix, count]) =>
      Array.from({ length: Number(count) }, (_, index) => `${prefix}${index + 1}`));
    expect([...covered].sort()).toEqual(expected.sort());
  });

  it.each(cases)("$name", async ({ declarations, expected }) => {
    // A drawable consumer forces evaluation during document execution, rather
    // than only in the final scalar sweep after all geometry has completed.
    const fixture = fixtureFromSource([
      "nui 1", declarations,
      'text = label(text: "result = ${@result}", anchor: (0, 55), size: 6)'
    ].join("\n"));
    expect(fixture.compiled?.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(isRustEligibleFixture(fixture)).toBe(true);
    const options = optionsFor(fixture);
    const ts = evaluateElementsReferencePayload(fixture.elements, options);
    const rust = await client.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rust)).toEqual(normalizeParityPayload(ts));
    for (const payload of [rust, ts]) {
      expect(payload.errors).toEqual([]);
      expect(payload.geometryValueErrors ?? []).toEqual([]);
      expect(payload.computedGeometry.find(g => g.kind === "text")).toMatchObject({
        kind: "text", text: `result = ${expected.result}`
      });
      for (const [name, value] of Object.entries(expected)) {
        const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(b => b.kind === "typed" && b.name === name);
        expect(binding, name).toBeDefined();
        const evaluation = payload.computedScalarBindings?.find(b => b.bindingId === binding!.id)?.evaluation;
        expect(evaluation, name).toMatchObject({
          status: "ok", value: value === null ? { kind: "none" } : { kind: "number", value }
        });
        if (name === "optional") expect(evaluation?.type).toEqual({ kind: "optional", valueType: { kind: "number" } });
      }
    }
  }, 30000);
});
