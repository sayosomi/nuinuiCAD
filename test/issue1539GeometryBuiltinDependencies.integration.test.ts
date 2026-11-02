import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument, geometryValueOccurrenceKey, moduleScalarBindingIdFor, resolveTypedDependencyGraphRuntime } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor,
  type EvaluationFixture
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
let rustStdio: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rustStdio = createRustStdioParityClient(repoRoot); }, 120_000);
afterAll(() => rustStdio?.dispose());

const bindingFor = (fixture: EvaluationFixture, name: string) => {
  const binding = fixture.compiled!.doc.bindingAnalysis!.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`Missing binding ${name}`);
  return binding;
};

const expectScalar = (fixture: EvaluationFixture, payload: EvaluationPayload, name: string, value: number) => {
  const scalar = evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingFor(fixture, name).id);
  expect(scalar, JSON.stringify(scalar)).toMatchObject({ status: "ok", value: { kind: "number", value: expect.closeTo(value, 8) } });
};

const evaluateBoth = async (fixture: EvaluationFixture) => {
  expect(fixture.compiled!.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(isRustEligibleFixture(fixture), "actual Rust production eligibility").toBe(true);
  const options = optionsFor(fixture);
  const ts = evaluateElementsReferencePayload(fixture.elements, options);
  const rust = await rustStdio.evaluate(fixture.elements, options);
  expect(normalizeParityPayload(rust), "complete persistent stdio payload parity").toEqual(normalizeParityPayload(ts));
  return [ts, rust];
};

const edgesFor = (fixture: EvaluationFixture, name: string) => fixture.compiled!.doc.typedDependencyGraph!.edges.filter(
  (edge) => edge.from.kind === "binding" && edge.from.id === bindingFor(fixture, name).id
);

const expectPoint = (fixture: EvaluationFixture, payload: EvaluationPayload, name: string, x: number, y: number) => {
  const element = fixture.elements.find((candidate) => candidate.name === name)!;
  expect(evaluationPayloadToResult(payload).computedGeometry.get(element.id))
    .toMatchObject({ kind: "point", x: expect.closeTo(x, 8), y: expect.closeTo(y, 8) });
};

const expectClean = (fixture: EvaluationFixture, payload: EvaluationPayload) => {
  const result = evaluationPayloadToResult(payload);
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors).toEqual([]);
  expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
};

// Verify the real compiler projection from each independently resolved operand,
// including immutable occurrence and selected stage identities.
const expectDirectOperands = (fixture: EvaluationFixture, name: string) => {
  const initializer = fixture.compiled!.doc.scalarProgram!.statements.find(
    (statement) => statement.bindingId === bindingFor(fixture, name).id
  )!.declaration.initializer;
  if (initializer.kind !== "call") throw new Error("Expected a measurement call");
  const edges = edgesFor(fixture, name);
  expect(initializer.args).toHaveLength(2);
  for (const argument of initializer.args) {
    if (argument.kind === "scalar" || !argument.target) throw new Error("Expected resolved geometry operand");
    const target = argument.target;
    if (target.kind === "geometryValue") {
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "geometry", requiredness: "required",
        to: expect.objectContaining({ kind: "geometry-value", id: geometryValueOccurrenceKey(target.occurrence) })
      }));
    } else {
      expect(target.kind ?? "drawable").toBe("drawable");
      expect(edges).toContainEqual(expect.objectContaining({
        kind: "geometry", requiredness: "required",
        to: expect.objectContaining({ kind: "geometry-stage", ownerId: target.statementId, stagePath: target.stagePath ?? ["final"] })
      }));
    }
  }
};

const unusedControls = [
  "",
  "const Unused: point = @B",
  "const Unused: point = coordinate(x: 7, y: 9)",
  "const Unused: point = polar(from: @B, angle: 90, distance: 10)",
  "const Unused: line = segment(start: @A, end: @B)"
];
const triggerControls = ["", "const Trigger: number = 0", "const Trigger: number = @A.x - @A.x"];

describe("Issue #1539 geometry measurement prerequisites", () => {
  it.each([
    ["distance(@A, @B)", 30],
    // B → A points west: atan2(0, -30) = 180 degrees in Y-up coordinates.
    ["angle(@B, @A)", 180]
  ] as const)("evaluates the Human baseline %s with complete production options", async (expression, expected) => {
    const fixture = fixtureFromSource(`nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 0)
const Unused: line = segment(start: @A, end: @B)
const d: number = ${expression}
point Probe = coordinate(x: @d, y: 20)`);
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", expected);
      const result = evaluationPayloadToResult(payload);
      expect(result.computedGeometry.get(fixture.elements.find((element) => element.name === "Probe")!.id))
        .toMatchObject({ kind: "point", x: expected, y: 20 });
      expect(result.errors).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
    }
  }, 120_000);

  it.each(unusedControls.flatMap((unused) => triggerControls.map((trigger) => [unused, trigger])))("projects both operands independently of unused geometry %s and Trigger %s", async (unused, trigger) => {
    const fixture = fixtureFromSource(`nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 0)
${unused}
${trigger}
const d: number = distance(@A, @B)
const a: number = angle(@B, @A)
point Probe = coordinate(x: @d, y: @a)`);
    expectDirectOperands(fixture, "d");
    expectDirectOperands(fixture, "a");
    const graph = fixture.compiled!.doc.typedDependencyGraph!;
    const projected = resolveTypedDependencyGraphRuntime(graph, new Map());
    const probe = fixture.elements.find((element) => element.name === "Probe")!;
    for (const name of ["A", "B"]) {
      const operand = fixture.elements.find((element) => element.name === name)!;
      expect(projected.evaluationOrder.indexOf(operand.id)).toBeLessThan(projected.evaluationOrder.indexOf(probe.id));
    }
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", 30);
      expectScalar(fixture, payload, "a", 180);
      expectPoint(fixture, payload, "Probe", 30, 180);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it.each(["drawable", "immutable"] as const)("measures %s × immutable points and reevaluates the dart dependency chain", async (firstKind) => {
    // (0,0) → (30,h): distance=hypot(30,h), closing angle=-atan2(h,30).
    // polar using that distance and closing angle must end at (30,-h).
    for (const height of [10, 40]) {
      const fixture = fixtureFromSource(`nui 1
${firstKind === "drawable" ? "point E" : "const E: point"} = coordinate(x: 0, y: 0)
const height: number = ${height}
point DartLeft = coordinate(x: 30, y: 0)
const DartRight: point = polar(from: @DartLeft, angle: 90, distance: @height)
const Unused: line = segment(start: @E, end: @DartLeft)
const closeAngle: number = angle(@E, @DartLeft) - angle(@E, @DartRight)
const dartRightDistance: number = distance(@E, @DartRight)
const drawnDistance: number = distance(@E, @DartLeft)
point Result = polar(from: @E, angle: @closeAngle, distance: @dartRightDistance)`);
      expectDirectOperands(fixture, "dartRightDistance");
      expectDirectOperands(fixture, "drawnDistance");
      for (const payload of await evaluateBoth(fixture)) {
        expectScalar(fixture, payload, "closeAngle", -Math.atan2(height, 30) * 180 / Math.PI);
        expectScalar(fixture, payload, "dartRightDistance", Math.hypot(30, height));
        expectScalar(fixture, payload, "drawnDistance", 30);
        expectPoint(fixture, payload, "Result", 30, -height);
        expectClean(fixture, payload);
      }
    }
  }, 120_000);

  it("reevaluates changed source coordinates with retained statement identities through downstream polar", async () => {
    const sourceFor = (x: number) => `nui 1
const A: point = coordinate(x: 2, y: 3)
const B: point = coordinate(x: ${x}, y: -5)
const Unused: point = coordinate(x: 0, y: 0)
const d: number = distance(@A, @B)
const a: number = angle(@A, @B)
point Probe = polar(from: @A, angle: @a, distance: @d)`;
    let fixture = fixtureFromSource(sourceFor(30));
    const bindingId = bindingFor(fixture, "d").id;
    for (const x of [30, -12]) {
      const compiled = compileCanonicalText(fixture.compiled!, sourceFor(x));
      fixture = { compiled, elements: compiled.doc.document.elements, evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex };
      expect(bindingFor(fixture, "d").id).toBe(bindingId);
      expectDirectOperands(fixture, "d");
      expectDirectOperands(fixture, "a");
      for (const payload of await evaluateBoth(fixture)) {
        expectScalar(fixture, payload, "d", Math.hypot(x - 2, -8));
        expectScalar(fixture, payload, "a", (Math.atan2(-8, x - 2) * 180 / Math.PI + 360) % 360);
        expectPoint(fixture, payload, "Probe", x, -5);
        expectClean(fixture, payload);
      }
    }
  }, 120_000);

  it("projects lineDistance and lineAngle prerequisites through the same mechanism", async () => {
    const fixture = fixtureFromSource(`nui 1
point P = coordinate(x: 30, y: 7)
line Axis = segment(start: (0, 0), end: (10, 0))
const Diagonal: line = segment(start: (0, 0), end: (10, 10))
const Unused: point = coordinate(x: 1, y: 2)
const d: number = lineDistance(@P, @Axis)
const a: number = lineAngle(@Axis.start, @Diagonal.end)
point Probe = coordinate(x: @d, y: @a)`);
    expectDirectOperands(fixture, "d");
    expectDirectOperands(fixture, "a");
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", 7);
      expectScalar(fixture, payload, "a", 45);
      expectPoint(fixture, payload, "Probe", 7, 45);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it.each([
    "if (true) { distance(@A, @B) } else { angle(@A, @Cycle) }",
    "if (@flag) { distance(@A, @B) } else { angle(@A, @Cycle) }",
    "match @side { left => distance(@A, @B) right => angle(@A, @Cycle) }",
    "if (@flag) { match @side { left => distance(@A, @B) right => angle(@A, @Bad) } } else { angle(@A, @Cycle) }",
    "if (@flag) { distance(@A, @B) } else { distance(@A, @Bad) }",
    "if (@flag) { distance(@A, @B) } else { distance(@A, @Failed) }"
  ])("retains lazy branch activation: %s", async (expression) => {
    const fixture = fixtureFromSource(`nui 1
const flag: boolean = true
const side: choice(left, right) = left
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 0)
point Bad = coordinate(x: 3, y: 4, enabled: false)
point Failed = coordinate(x: 1 / 0, y: 0)
const Unused: point = coordinate(x: 1, y: 2)
const d: number = ${expression}
point Cycle = coordinate(x: @d, y: 20)`);
    const edges = edgesFor(fixture, "d").filter((edge) => edge.kind === "geometry");
    expect(edges.length).toBeGreaterThanOrEqual(3);
    expect(edges.every((edge) => edge.requiredness === "conditional" && !!edge.activation?.guards.length)).toBe(true);
    expect(fixture.compiled!.doc.typedDependencyGraph!.cycles).toEqual([]);
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", 30);
      expectPoint(fixture, payload, "Cycle", 30, 20);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      // Failed is intentionally invalid; only its own drawable failure is allowed.
      expect(evaluationPayloadToResult(payload).errors.map((error) => error.elementId))
        .toEqual([fixture.elements.find((element) => element.name === "Failed")!.id]);
    }
  }, 120_000);

  it("retains Module instance and immutable geometry occurrence identities", async () => {
    const fixture = fixtureFromSource(`nui 1
module Draft(x: number) {
  export const A: point = coordinate(x: 0, y: 0)
  export const B: point = coordinate(x: @x, y: 4)
  export const d: number = distance(@A, @B)
  export const a: number = angle(@A, @B)
  point Probe = polar(from: @A, angle: @a, distance: @d)
}
instance One = Draft(x: 3)
instance Two = Draft(x: 30)
const dOne: number = distance(@One::A, @One::B)
const dTwo: number = distance(@Two::A, @Two::B)
const aOne: number = angle(@One::A, @One::B)
const aTwo: number = angle(@Two::A, @Two::B)
point OneProbe = polar(from: @One::A, angle: @aOne, distance: @dOne)
point TwoProbe = polar(from: @Two::A, angle: @aTwo, distance: @dTwo)`);
    for (const name of ["dOne", "dTwo", "aOne", "aTwo"]) expectDirectOperands(fixture, name);
    const oneTargets = edgesFor(fixture, "dOne").filter((edge) => edge.to.kind === "geometry-value").map((edge) => edge.to.id);
    const twoTargets = edgesFor(fixture, "dTwo").filter((edge) => edge.to.kind === "geometry-value").map((edge) => edge.to.id);
    expect(oneTargets).toHaveLength(2);
    expect(twoTargets).toHaveLength(2);
    expect(oneTargets.every((id) => !twoTargets.includes(id))).toBe(true);
    for (const payload of await evaluateBoth(fixture)) {
      for (const [suffix, x] of [["One", 3], ["Two", 30]] as const) {
        expectScalar(fixture, payload, `d${suffix}`, Math.hypot(x, 4));
        expectScalar(fixture, payload, `a${suffix}`, Math.atan2(4, x) * 180 / Math.PI);
        expectPoint(fixture, payload, `${suffix}Probe`, x, 4);
        const semantic = fixture.compiled!.doc.moduleSemanticAnalysis!;
        const instance = semantic.instances.find((candidate) => candidate.name === suffix)!;
        const definition = semantic.definitionsByStatementId.get(instance.callee!.definitionStatementId)!;
        for (const [name, value] of [["d", Math.hypot(x, 4)], ["a", Math.atan2(4, x) * 180 / Math.PI]] as const) {
          const scalar = definition.localScalars.find((candidate) => candidate.name === name)!;
          const id = moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId);
          expect(fixture.compiled!.doc.typedDependencyGraph!.edges.filter((edge) =>
            edge.from.kind === "binding" && edge.from.id === id && edge.to.kind === "geometry-value")).toHaveLength(2);
          expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(id))
            .toMatchObject({ status: "ok", value: { kind: "number", value: expect.closeTo(value, 8) } });
        }
      }
      expectClean(fixture, payload);
    }
  }, 120_000);

  it("reevaluates dynamic if and match selection including the alternate branches", async () => {
    const sourceFor = (selected: boolean) => `nui 1
const flag: boolean = ${selected}
const side: choice(left, right) = ${selected ? "left" : "right"}
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 0)
point C = coordinate(x: 30, y: 40)
const Unused: point = coordinate(x: 1, y: 2)
const d: number = if (@flag) { distance(@A, @B) } else { distance(@A, @C) }
const a: number = match @side { left => angle(@A, @B) right => angle(@A, @C) }
point Probe = coordinate(x: @d, y: @a)`;
    let fixture = fixtureFromSource(sourceFor(true));
    for (const selected of [true, false, true]) {
      const compiled = compileCanonicalText(fixture.compiled!, sourceFor(selected));
      fixture = { compiled, elements: compiled.doc.document.elements, evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex };
      const d = selected ? 30 : 50;
      const a = selected ? 0 : Math.atan2(40, 30) * 180 / Math.PI;
      for (const payload of await evaluateBoth(fixture)) {
        expectScalar(fixture, payload, "d", d);
        expectScalar(fixture, payload, "a", a);
        expectPoint(fixture, payload, "Probe", d, a);
        expectClean(fixture, payload);
      }
    }
  }, 120_000);

  it("retains exact selected geometry stages", async () => {
    const fixture = fixtureFromSource(`nui 1
line L = segment(start: (0, 0), end: (10, 0))
move L as shifted(from: (0, 0), to: (3, 4))
const Unused: point = coordinate(x: 1, y: 2)
const d: number = distance(@L.base.start, @L.shifted.end)
const a: number = angle(@L.base.start, @L.shifted.end)
point Probe = coordinate(x: @d, y: @a)`);
    expectDirectOperands(fixture, "d");
    expectDirectOperands(fixture, "a");
    expect(edgesFor(fixture, "d").filter((edge) => edge.to.kind === "geometry-stage").map((edge) => edge.to.kind === "geometry-stage" && edge.to.stagePath))
      .toEqual([["base"], ["shifted"]]);
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", Math.hypot(13, 4));
      expectScalar(fixture, payload, "a", Math.atan2(4, 13) * 180 / Math.PI);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it("retains the completed loop owner for escaped geometry carry operands", async () => {
    const fixture = fixtureFromSource(`nui 1
point Origin = coordinate(x: 0, y: 0)
const Seed: point = coordinate(x: 3, y: 4)
const steps: number[] = [1, 2]
for n in @steps carry p: point = @Seed {
  next p = @Seed
}
const Unused: line = segment(start: @Origin, end: @Seed)
const d: number = distance(@Origin, @p)
const a: number = angle(@Origin, @p)
point Probe = polar(from: @Origin, angle: @a, distance: @d)`);
    const owner = fixture.elements.find((element) => element.type === "forGroup")!;
    for (const name of ["d", "a"]) {
      expect(edgesFor(fixture, name)).toContainEqual(expect.objectContaining({
        kind: "geometry", to: expect.objectContaining({ kind: "element", id: owner.id })
      }));
    }
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", 5);
      expectScalar(fixture, payload, "a", Math.atan2(4, 3) * 180 / Math.PI);
      expectPoint(fixture, payload, "Probe", 3, 4);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it("preserves an indexed generated occurrence and its selected stage", async () => {
    // Reuse the #1394 occurrence/stage boundary: instance 1 has a 35° base
    // tangent and a 65° final tangent after the 30° rotation.
    const fixture = fixtureFromSource(`nui 1
line Axis = segment(start: (100, 40), end: (110, 40))
for i in range(min: 0, max: 1, step: 1) {
  line L = polar(start: (@i * 20, 0), angle: 25 + @i * 10, length: 10)
  move L as tilted(from: (0, 0), to: (0, 0), angleDeg: 30)
}
const occurrence: number = 1
const base: number = lineAngle(@L[@occurrence].base.start, @Axis.start)
const final: number = lineAngle(@L[@occurrence].start, @Axis.start)
point Probe = coordinate(x: @base, y: @final)`);
    const template = fixture.elements.find((element) => element.name === "L")!;
    const statement = fixture.compiled!.doc.scalarProgram!.statements.find((candidate) => candidate.bindingId === bindingFor(fixture, "base").id)!;
    expect(statement.declaration.initializer).toMatchObject({ kind: "call", args: [
      { kind: "geometryEndpoint", target: {
        kind: "forGroupOccurrence", templateElementId: template.id, stagePath: ["base"],
        index: { kind: "reference", bindingId: bindingFor(fixture, "occurrence").id }
      } }, { kind: "geometryEndpoint" }
    ] });
    expect(edgesFor(fixture, "base")).toContainEqual(expect.objectContaining({
      to: expect.objectContaining({ kind: "geometry-stage", ownerId: template.id, stagePath: ["base"] })
    }));
    expect(edgesFor(fixture, "base")).toContainEqual(expect.objectContaining({
      to: expect.objectContaining({ kind: "binding", id: bindingFor(fixture, "occurrence").id })
    }));
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "base", 35);
      expectScalar(fixture, payload, "final", 65);
      expectPoint(fixture, payload, "Probe", 35, 65);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it("keeps dynamic collection owners, index prerequisites and both endpoint operands", async () => {
    const fixture = fixtureFromSource(`nui 1
line Axis = segment(start: (0, 0), end: (10, 0))
line Diagonal = segment(start: (0, 0), end: (10, 10))
const Paths: path[] = [@Axis, @Diagonal]
const selectors: number[] = [1]
const selected: number = 0
module Forward(paths: path[]) {
  export const out: path[] = @paths
}
instance Use = Forward(paths: @Paths)
const Unused: point = coordinate(x: 1, y: 2)
const a: number = lineAngle(@Use::out[@selectors[@selected]].start, @Axis.end)
point Probe = coordinate(x: @a, y: 20)`);
    const edges = edgesFor(fixture, "a");
    expect(edges).toContainEqual(expect.objectContaining({ to: expect.objectContaining({ kind: "binding", id: bindingFor(fixture, "selected").id }) }));
    const call = fixture.compiled!.doc.scalarProgram!.statements.find((statement) => statement.bindingId === bindingFor(fixture, "a").id)!.declaration.initializer;
    const instance = fixture.compiled!.doc.moduleSemanticAnalysis!.instances.find((candidate) => candidate.name === "Use")!;
    expect(call).toMatchObject({ kind: "call", args: [
      { kind: "geometryEndpoint", target: {
        kind: "geometryCollectionIndex", collectionLength: null,
        collectionValueId: JSON.stringify(["module-array-export", instance.statementId, "out"]),
        index: { kind: "collectionIndex", index: { kind: "reference", bindingId: bindingFor(fixture, "selected").id } }
      } },
      { kind: "geometryEndpoint" }
    ] });
    const axis = fixture.elements.find((element) => element.name === "Axis")!;
    expect(edges).toContainEqual(expect.objectContaining({ to: expect.objectContaining({ kind: "geometry-stage", ownerId: axis.id }) }));
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "a", 45);
      expectPoint(fixture, payload, "Probe", 45, 20);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it.each([
    ["disabled", "point B = coordinate(x: 30, y: 0, enabled: false)"],
    ["failed", "point B = coordinate(x: 1 / 0, y: 0)"]
  ])("reports a %s geometry operand without fabricated coordinates", async (kind, declaration) => {
    const fixture = fixtureFromSource(`nui 1
point A = coordinate(x: 0, y: 0)
${declaration}
const Unused: point = coordinate(x: 1, y: 2)
const d: number = distance(@A, @B)
const a: number = angle(@A, @B)
point Probe = coordinate(x: @d, y: @a)`);
    const code = kind === "disabled" ? "evaluation-geometry-builtin-disabled" : "evaluation-geometry-builtin-unavailable";
    for (const payload of await evaluateBoth(fixture)) {
      const result = evaluationPayloadToResult(payload);
      for (const name of ["d", "a"]) {
        expect(result.computedScalarBindings?.get(bindingFor(fixture, name).id))
          .toMatchObject({ status: "error", issueCode: code });
      }
      expect(result.computedGeometry.has(fixture.elements.find((element) => element.name === "Probe")!.id)).toBe(false);
      expect(runtimeDiagnosticsFor(fixture, payload).map((diagnostic) => diagnostic.code))
        .toEqual([code, code]);
    }
  }, 120_000);

  it("retains actual geometry cycles as explicit compiler/runtime errors", async () => {
    const fixture = fixtureFromSource(`nui 1
const flag: boolean = true
point B = coordinate(x: 30, y: 0)
const Unused: point = coordinate(x: 1, y: 2)
const d: number = if (@flag) { distance(@A, @B) } else { 0 }
point A = coordinate(x: @d, y: 0)
point Probe = coordinate(x: @d, y: 20)`);
    expect(fixture.compiled!.doc.typedDependencyGraph!.cycles).toEqual([]);
    for (const payload of await evaluateBoth(fixture)) {
      const result = evaluationPayloadToResult(payload);
      expect(result.computedGeometry.has(fixture.elements.find((element) => element.name === "Probe")!.id)).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.map((error) => error.code)).toContain("dependency-cycle");
      expect(result.computedScalarBindings?.get(bindingFor(fixture, "d").id)).toMatchObject({ status: "error" });
    }
  }, 120_000);

  it.each([
    ["30", "@maybe ?? distance(@A, @Bad)", 30],
    ["none", "@maybe ?? distance(@A, @B)", 30],
    ["none", "if (distance(@A, @B) == 30) { angle(@B, @A) } else { distance(@A, @Bad) }", 180]
  ] as const)("retains measurement activation through optional/controller expressions: %s / %s", async (maybe, expression, expected) => {
    const fixture = fixtureFromSource(`nui 1
const maybe: number? = ${maybe}
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 30, y: 0)
point Bad = coordinate(x: 3, y: 4, enabled: false)
const Unused: point = coordinate(x: 1, y: 2)
const d: number = ${expression}
point Probe = coordinate(x: @d, y: 20)`);
    for (const payload of await evaluateBoth(fixture)) {
      expectScalar(fixture, payload, "d", expected);
      expectPoint(fixture, payload, "Probe", expected, 20);
      expectClean(fixture, payload);
    }
  }, 120_000);

  it.each([
    ["unresolved", `point A = coordinate(x: 0, y: 0)
const d: number = distance(@A, @Missing)`, "builtin-geometry-argument-invalid"],
    ["cyclic", `point A = coordinate(x: @d, y: 0)
point B = coordinate(x: 30, y: 0)
const d: number = distance(@A, @B)`, "dependency-cycle"]
  ])("fails closed at canonical compilation for %s geometry", (_kind, source, code) => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), `nui 1\n${source}`);
    expect(compiled.status).toBe("fatal");
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  });
});
