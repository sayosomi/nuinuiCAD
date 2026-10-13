import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moduleScalarBindingIdFor } from "@nuinuicad/nui-language";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Fixture = ReturnType<typeof fixtureFromSource>;

const rootBindingFor = (fixture: Fixture, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding || binding.kind !== "typed") throw new Error(`typed binding "${name}" not found`);
  return binding;
};

const moduleOutputBindingIdFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`Module instance "${instanceName}" not found`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`Module output "${instanceName}::${outputName}" not found`);
  return moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId);
};

const geometryCarriesFor = (fixture: Fixture) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const expectAccepted = (fixture: Fixture, label: string) => {
  expect(
    fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    `${label}: compiler acceptance`
  ).toEqual([]);
};

const expectRootScalar = (
  fixture: Fixture,
  payload: EvaluationPayload,
  name: string,
  expected: { status: "ok"; value: { kind: "number"; value: number } } |
    { status: "error"; issueCode: string }
) => {
  const binding = rootBindingFor(fixture, name);
  expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id), `scalar ${name}`)
    .toMatchObject(expected);
};

const expectNoZeroLengthDiagnostic = (fixture: Fixture, payload: EvaluationPayload) => {
  expect(runtimeDiagnosticsFor(fixture, payload).filter(
    (diagnostic) => diagnostic.code === "evaluation-zero-length-line"
  )).toEqual([]);
};

describe("SAY-508 zero-length immutable geometry carries through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateBoth = async (source: string, label: string) => {
    const fixture = fixtureFromSource(source);
    expectAccepted(fixture, label);
    expect(isRustEligibleFixture(fixture), `${label}: production-host Rust eligibility`).toBe(true);
    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), `${label}: normalized persistent-stdio parity`).toEqual(
      normalizeParityPayload(tsPayload)
    );
    return { fixture, tsPayload, rustPayload };
  };

  it("preserves the exact root empty-loop initializer and leaves direction unavailable", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const seed: line = segment(start: (2, 2), end: (2, 2))",
      "const empty: number[] = []",
      "for n in @empty carry l: line = @seed {",
      "  next l = @l",
      "}",
      "const angle: number = @l.startAngleDeg",
      "const startX: number = @l.start.x",
      "const startY: number = @l.start.y",
      "const endX: number = @l.end.x",
      "const endY: number = @l.end.y",
      "const length: number = @l.length"
    ].join("\n"), "exact root empty-loop reproduction");

    const carries = geometryCarriesFor(evaluated.fixture);
    expect(carries).toHaveLength(1);
    const carry = carries[0];
    if (!carry) throw new Error("missing root zero-length line carry plan");
    expect(carry).toMatchObject({ bindingId: expect.any(String), declaredType: { kind: "line" } });
    expect(carry.initializerTarget).toMatchObject({ kind: "geometryValue", geometryType: "line" });
    expect(evaluated.fixture.compiled?.doc.scalarProgram?.statements.find(
      (statement) => statement.bindingId === rootBindingFor(evaluated.fixture, "angle").id
    )?.declaration.initializer).toMatchObject({
      kind: "geometryProperty",
      property: "startAngleDeg",
      geometryCarryBindingId: carry.bindingId
    });
    expect(evaluated.fixture.compiled?.doc.scalarProgram?.statements.find(
      (statement) => statement.bindingId === rootBindingFor(evaluated.fixture, "length").id
    )?.declaration.initializer).toMatchObject({
      kind: "geometryProperty",
      property: "length",
      geometryCarryBindingId: carry.bindingId
    });

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const name of ["startX", "startY", "endX", "endY", "length"]) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "ok", value: { kind: "number", value: name === "length" ? 0 : 2 }
        });
      }
      expectRootScalar(evaluated.fixture, payload, "length", {
        status: "ok", value: { kind: "number", value: 0 }
      });
      expectRootScalar(evaluated.fixture, payload, "angle", {
        status: "error", issueCode: "evaluation-geometry-property-unavailable"
      });
      expect(runtimeDiagnosticsFor(evaluated.fixture, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          origin: "runtime",
          severity: "error",
          code: "evaluation-geometry-property-unavailable",
          bindingId: rootBindingFor(evaluated.fixture, "angle").id
        })
      ]));
      expectNoZeroLengthDiagnostic(evaluated.fixture, payload);
    }
  }, 120_000);

  it("materializes zero-length drawable geometry into an empty-loop carry", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line seed = segment(start: (4, 6), end: (4, 6))",
      "const empty: number[] = []",
      "for n in @empty carry edge: line = @seed {",
      "  next edge = @seed",
      "}",
      "const startX: number = @edge.start.x",
      "const startY: number = @edge.start.y",
      "const endX: number = @edge.end.x",
      "const endY: number = @edge.end.y",
      "const length: number = @edge.length"
    ].join("\n"), "drawable zero-length initializer");

    const carry = geometryCarriesFor(evaluated.fixture)[0];
    if (!carry) throw new Error("missing drawable zero-length line carry plan");
    const seedElement = evaluated.fixture.elements.find((element) => element.name === "seed");
    expect(seedElement).toBeDefined();
    expect(carry.initializerTarget).toMatchObject({
      statementId: seedElement?.id,
      geometryType: "line"
    });
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const [name, value] of Object.entries({ startX: 4, startY: 6, endX: 4, endY: 6, length: 0 })) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "ok", value: { kind: "number", value }
        });
      }
      expectNoZeroLengthDiagnostic(evaluated.fixture, payload);
    }
  }, 120_000);

  it("keeps module-local empty geometry carries separate for each instance", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const first: line = segment(start: (2, 3), end: (2, 3))",
      "const second: line = segment(start: (7, 9), end: (7, 9))",
      "module M(input: line) {",
      "  const empty: number[] = []",
      "  for n in @empty carry edge: line = @input {",
      "    next edge = @edge",
      "  }",
      "  export const startX: number = @edge.start.x",
      "  export const endY: number = @edge.end.y",
      "  export const length: number = @edge.length",
      "}",
      "instance A = M(input: @first)",
      "instance B = M(input: @second)",
      "const aStartX: number = @A::startX",
      "const aEndY: number = @A::endY",
      "const aLength: number = @A::length",
      "const bStartX: number = @B::startX",
      "const bEndY: number = @B::endY",
      "const bLength: number = @B::length"
    ].join("\n"), "separate Module instances");

    const carries = geometryCarriesFor(evaluated.fixture);
    expect(carries).toHaveLength(2);
    expect(new Set(carries.map((carry) => carry.bindingId)).size).toBe(2);
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const [instanceName, outputName, value] of [
        ["A", "startX", 2], ["A", "endY", 3], ["A", "length", 0],
        ["B", "startX", 7], ["B", "endY", 9], ["B", "length", 0]
      ] as const) {
        expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(
          moduleOutputBindingIdFor(evaluated.fixture, instanceName, outputName)
        )).toMatchObject({ status: "ok", value: { kind: "number", value } });
      }
      for (const [name, value] of Object.entries({
        aStartX: 2, aEndY: 3, aLength: 0, bStartX: 7, bEndY: 9, bLength: 0
      })) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "ok", value: { kind: "number", value }
        });
      }
      expectNoZeroLengthDiagnostic(evaluated.fixture, payload);
    }
  }, 120_000);

  it("resolves zero-length next values through selected stages and iteration snapshots", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line initialA = segment(start: (20, 30), end: (21, 30))",
      "line initialB = segment(start: (10, 12), end: (13, 16))",
      "line stagedSeed = segment(start: (40, 50), end: (43, 54))",
      "move stagedSeed as shifted (from: (40, 50), to: (45, 57))",
      "const zero: line = segment(start: (5, 7), end: (5, 7))",
      "const one: number[] = [1]",
      "for n in @one carry a: line = @initialA carry b: line = @initialB carry z: line = @initialA carry g: line = @initialA {",
      "  line Generated = segment(start: (9, 10), end: (9, 10))",
      "  next a = @b",
      "  next b = @stagedSeed.shifted",
      "  next z = @zero",
      "  next g = @Generated",
      "}",
      "const aStartX: number = @a.start.x",
      "const aStartY: number = @a.start.y",
      "const aEndX: number = @a.end.x",
      "const aEndY: number = @a.end.y",
      "const aLength: number = @a.length",
      "const bStartX: number = @b.start.x",
      "const bStartY: number = @b.start.y",
      "const bEndX: number = @b.end.x",
      "const bEndY: number = @b.end.y",
      "const bLength: number = @b.length",
      "const zStartX: number = @z.start.x",
      "const zStartY: number = @z.start.y",
      "const zEndX: number = @z.end.x",
      "const zEndY: number = @z.end.y",
      "const zLength: number = @z.length",
      "const zAngle: number = @z.startAngleDeg",
      "const gStartX: number = @g.start.x",
      "const gStartY: number = @g.start.y",
      "const gEndX: number = @g.end.x",
      "const gEndY: number = @g.end.y",
      "const gLength: number = @g.length"
    ].join("\n"), "selected-stage next value, zero-length next value, and snapshot");

    const carries = geometryCarriesFor(evaluated.fixture);
    expect(carries).toHaveLength(4);
    const carryA = carries.find((carry) => carry.bindingId ===
      fixtureCarryBindingIdFor(evaluated.fixture, "aStartX"));
    const carryB = carries.find((carry) => carry.bindingId ===
      fixtureCarryBindingIdFor(evaluated.fixture, "bStartX"));
    const carryZ = carries.find((carry) => carry.bindingId ===
      fixtureCarryBindingIdFor(evaluated.fixture, "zStartX"));
    const carryG = carries.find((carry) => carry.bindingId ===
      fixtureCarryBindingIdFor(evaluated.fixture, "gStartX"));
    if (!carryA || !carryB || !carryZ || !carryG) throw new Error("missing snapshot geometry carries");
    expect(carryA.nextTarget).toMatchObject({ kind: "geometryCarry", bindingId: carryB.bindingId });
    expect(carryB.nextTarget).toMatchObject({
      statementId: evaluated.fixture.elements.find((element) => element.name === "stagedSeed")?.id,
      geometryType: "line",
      stagePath: ["shifted"]
    });
    expect(carryZ.nextTarget).toMatchObject({ kind: "geometryValue", geometryType: "line" });
    expect(carryG.nextTarget).toMatchObject({
      statementId: evaluated.fixture.elements.find((element) => element.name === "Generated")?.id,
      geometryType: "line"
    });

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const [name, value] of Object.entries({
        aStartX: 10, aStartY: 12, aEndX: 13, aEndY: 16, aLength: 5,
        bStartX: 45, bStartY: 57, bEndX: 48, bEndY: 61, bLength: 5,
        zStartX: 5, zStartY: 7, zEndX: 5, zEndY: 7, zLength: 0,
        gStartX: 9, gStartY: 10, gEndX: 9, gEndY: 10, gLength: 0
      })) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "ok", value: { kind: "number", value }
        });
      }
      expectRootScalar(evaluated.fixture, payload, "zAngle", {
        status: "error", issueCode: "evaluation-geometry-property-unavailable"
      });
      const generatedTemplateId = evaluated.fixture.elements.find((element) => element.name === "Generated")?.id;
      const generatedRow = payload.forGroupGeneratedRows?.find((row) => row.templateElementId === generatedTemplateId);
      expect(generatedRow).toBeDefined();
      expect(evaluationPayloadToResult(payload).computedGeometry.get(generatedRow?.generatedElementId ?? ""))
        .toMatchObject({ kind: "line", start: { x: 9, y: 10 }, end: { x: 9, y: 10 } });
      expectNoZeroLengthDiagnostic(evaluated.fixture, payload);
    }
  }, 120_000);

  it("leaves missing and disabled geometry unavailable while carrying", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "point probe = coordinate(x: 0, y: 0)",
      "line missing = segment(start: (0, 0), end: (1 / 0, 0))",
      "line disabled = segment(start: (8, 9), end: (10, 12), enabled: false)",
      "const empty: number[] = []",
      "for n in @empty carry missingCarry: line = @missing carry disabledCarry: line = @disabled {",
      "  next missingCarry = @missingCarry",
      "  next disabledCarry = @disabledCarry",
      "}",
      "const missingCarryLength: number = @missingCarry.length",
      "const disabledCarryLength: number = @disabledCarry.length",
      "const missingBuiltin: number = lineDistance(@probe, @missing)",
      "const disabledBuiltin: number = lineDistance(@probe, @disabled)"
    ].join("\n"), "missing and disabled targets");

    const carries = geometryCarriesFor(evaluated.fixture);
    expect(carries).toHaveLength(2);
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expectRootScalar(evaluated.fixture, payload, "missingCarryLength", {
        status: "error", issueCode: "evaluation-geometry-property-unavailable"
      });
      expectRootScalar(evaluated.fixture, payload, "disabledCarryLength", {
        status: "error", issueCode: "evaluation-geometry-property-unavailable"
      });
      expectRootScalar(evaluated.fixture, payload, "missingBuiltin", {
        status: "error", issueCode: "evaluation-geometry-builtin-unavailable"
      });
      expectRootScalar(evaluated.fixture, payload, "disabledBuiltin", {
        status: "error", issueCode: "evaluation-geometry-builtin-disabled"
      });
      const carryIds = new Set(carries.map((carry) => carry.bindingId));
      expect((payload.computedGeometryValues ?? []).some((entry) =>
        carryIds.has(entry.occurrence.sourceStatementId)
      )).toBe(false);
      expectNoZeroLengthDiagnostic(evaluated.fixture, payload);
    }
  }, 120_000);

  it("keeps lineDistance and lineAngle strict for zero-length pure and drawable lines", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "const pureZero: line = segment(start: (1, 1), end: (1, 1))",
      "line drawableZero = segment(start: (3, 4), end: (3, 4))",
      "line valid = segment(start: (0, 0), end: (5, 0))",
      "point probe = coordinate(x: 2, y: 3)",
      "const pureDistance: number = lineDistance(@probe, @pureZero)",
      "const drawableDistance: number = lineDistance(@probe, @drawableZero)",
      "const pureAngle: number = lineAngle(@pureZero.start, @valid.end)",
      "const drawableAngle: number = lineAngle(@valid.start, @drawableZero.end)"
    ].join("\n"), "strict zero-length geometry builtins");

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const name of ["pureDistance", "drawableDistance"]) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "error", issueCode: "evaluation-zero-length-line"
        });
      }
      for (const name of ["pureAngle", "drawableAngle"]) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "error", issueCode: "evaluation-geometry-endpoint-tangent-unavailable"
        });
      }
      expect(runtimeDiagnosticsFor(evaluated.fixture, payload).filter(
        (diagnostic) => diagnostic.code === "evaluation-zero-length-line"
      )).toHaveLength(2);
      expect(runtimeDiagnosticsFor(evaluated.fixture, payload).filter(
        (diagnostic) => diagnostic.code === "evaluation-geometry-endpoint-tangent-unavailable"
      )).toHaveLength(2);
    }
  }, 120_000);

  it("measures endpoint tangents for arcs, Beziers, offsets, mirrors, and geometry values", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (10, 0))",
      "const Arc: path = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 0, startLength: 0, endAngle: 180, endLength: 0)",
      "const Offset: path = offset(sources: [@Curve], distance: 1, side: right, closed: false, suppressTrimWarnings: false)",
      "const Reversed: path = mirrorCopy(axis1: (0, 0), axis2: (0, 10), baseLines: [@Curve])",
      "const lineArc: number = lineAngle(@Horizontal.start, @Arc.start)",
      "const arcEnds: number = lineAngle(@Arc.start, @Arc.end)",
      "const zeroHandleBezier: number = lineAngle(@Curve.start, @Curve.end)",
      "const offsetArc: number = lineAngle(@Offset.end, @Arc.start)",
      "const reversedArc: number = lineAngle(@Reversed.start, @Arc.end)"
    ].join("\n"), "endpoint tangent path families and geometry values");

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const [name, value] of [
        ["lineArc", 90],
        ["arcEnds", 90],
        ["zeroHandleBezier", 0],
        ["offsetArc", 90],
        ["reversedArc", 0]
      ] as const) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "ok", value: { kind: "number", value }
        });
      }
    }
  }, 120_000);
});

const fixtureCarryBindingIdFor = (fixture: Fixture, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding || binding.kind !== "typed") throw new Error(`typed carry binding "${name}" not found`);
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === binding.id
  )?.declaration.initializer;
  if (!initializer || initializer.kind !== "geometryProperty" || !initializer.geometryCarryBindingId) {
    throw new Error(`typed property ${name} has no geometry carry reference`);
  }
  return initializer.geometryCarryBindingId;
};
