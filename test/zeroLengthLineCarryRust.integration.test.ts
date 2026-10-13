import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emptyDocument,
  moduleCarryBindingIdFor,
  moduleScalarBindingIdFor,
  unwrapModuleGeometrySourceTarget
} from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
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

const moduleDefinitionFor = (fixture: Fixture, instanceName: string) => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`Module instance "${instanceName}" not found`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  if (!definition) throw new Error(`Module definition for "${instanceName}" not found`);
  return definition;
};

const moduleOutputBindingIdFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const instance = fixture.compiled?.doc.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance) throw new Error(`Module instance "${instanceName}" not found`);
  const definition = moduleDefinitionFor(fixture, instanceName);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`Module output "${instanceName}::${outputName}" not found`);
  return moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId);
};

const lineAngleCallForBindingId = (fixture: Fixture, bindingId: string) => {
  const initializer = fixture.compiled?.doc.scalarProgram?.statements.find(
    (statement) => statement.bindingId === bindingId
  )?.declaration.initializer;
  if (initializer?.kind !== "call" || initializer.name !== "lineAngle") {
    throw new Error(`lineAngle initializer for binding "${bindingId}" not found`);
  }
  return initializer;
};

const rootLineAngleCallFor = (fixture: Fixture, name: string) =>
  lineAngleCallForBindingId(fixture, rootBindingFor(fixture, name).id);

const moduleLineAngleCallFor = (fixture: Fixture, instanceName: string, outputName: string) =>
  lineAngleCallForBindingId(fixture, moduleOutputBindingIdFor(fixture, instanceName, outputName));

const geometryCarriesFor = (fixture: Fixture) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const exportedGeometryCarryFor = (fixture: Fixture, instanceName: string, exportName: string) => {
  const exported = moduleDefinitionFor(fixture, instanceName).exports.find(
    (candidate) => candidate.kind === "geometry" && candidate.name === exportName
  );
  if (!exported?.backingTarget) throw new Error(`Module export "${instanceName}::${exportName}" has no source target`);
  const source = unwrapModuleGeometrySourceTarget(exported.backingTarget).target;
  if (source.kind !== "geometryCarry") throw new Error(`Module export "${instanceName}::${exportName}" is not backed by a geometry carry`);
  return source;
};

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

const geometryEndpointArgumentsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(geometryEndpointArgumentsIn);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.kind === "geometryEndpoint" ? [record] : []),
    ...Object.values(record).flatMap(geometryEndpointArgumentsIn)
  ];
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
      const zeroLengthDiagnostics = runtimeDiagnosticsFor(evaluated.fixture, payload).filter(
        (diagnostic) => diagnostic.code === "evaluation-zero-length-line"
      );
      expect(zeroLengthDiagnostics).toHaveLength(2);
      expect(zeroLengthDiagnostics.every((diagnostic) =>
        diagnostic.message.includes("lineDistance") && !diagnostic.message.includes("lineAngle")
      )).toBe(true);
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

  it("keeps endpoint identity through split, reversal, stages, occurrences, collections, and Module parameters", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (10, 0))",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "arc Quarter = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: counterclockwise)",
      "reverse Quarter ()",
      "const baseStartAngle: number = lineAngle(@Quarter.base.start, @Horizontal.start)",
      "const reversedStartAngle: number = lineAngle(@Quarter.final.start, @Horizontal.start)",
      "const reversedStartMatchesBaseEnd: number = lineAngle(@Quarter.final.start, @Quarter.base.end)",
      "point SplitTop = coordinate(x: 5, y: 22.5)",
      "curve SplitCurve = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 30, endAngle: 270, endLength: 30)",
      "line Split = split(source: @SplitCurve, at: @SplitTop)",
      "const splitEndpointAngle: number = lineAngle(@Split.start, @Split.end)",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  line Occurrence = segment(start: (0, 0), end: (10, @i * 10))",
      "}",
      "const occurrenceZeroAngle: number = lineAngle(@Occurrence[0].start, @Horizontal.start)",
      "const occurrenceOneAngle: number = lineAngle(@Occurrence[1].start, @Horizontal.start)",
      "const Paths: path[] = [@Horizontal, @Diagonal]",
      "const collectionAngle: number = lineAngle(@Paths[1].start, @Horizontal.start)",
      "module Measure(source: line) {",
      "  line Axis = segment(start: (0, 0), end: (10, 0))",
      "  export const parameterAngle: number = lineAngle(@source.start, @Axis.start)",
      "}",
      "instance MeasureDiagonal = Measure(source: @Diagonal)",
      "instance MeasureOccurrence = Measure(source: @Occurrence[1])",
      "const moduleParameterAngle: number = @MeasureDiagonal::parameterAngle",
      "const occurrenceModuleParameterAngle: number = @MeasureOccurrence::parameterAngle"
    ].join("\n"), "endpoint identity across selected geometry boundaries");

    const horizontal = evaluated.fixture.elements.find((element) => element.name === "Horizontal");
    const diagonal = evaluated.fixture.elements.find((element) => element.name === "Diagonal");
    const quarter = evaluated.fixture.elements.find((element) => element.name === "Quarter");
    const split = evaluated.fixture.elements.find((element) => element.name === "Split");
    const occurrence = evaluated.fixture.elements.find((element) => element.name === "Occurrence");
    expect(horizontal).toBeDefined();
    expect(diagonal).toBeDefined();
    expect(quarter).toBeDefined();
    expect(split).toBeDefined();
    expect(occurrence).toBeDefined();

    const baseCall = rootLineAngleCallFor(evaluated.fixture, "baseStartAngle");
    expect(baseCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: quarter?.id, stagePath: ["base"] }
    });
    const finalCall = rootLineAngleCallFor(evaluated.fixture, "reversedStartAngle");
    expect(finalCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: quarter?.id, stagePath: ["final"] }
    });
    const splitCall = rootLineAngleCallFor(evaluated.fixture, "splitEndpointAngle");
    expect(splitCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: split?.id }
    });
    const occurrenceCall = rootLineAngleCallFor(evaluated.fixture, "occurrenceOneAngle");
    expect(occurrenceCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: {
        kind: "forGroupOccurrence",
        templateElementId: occurrence?.id,
        index: { kind: "numberLiteral", value: 1 }
      }
    });
    const collectionCall = rootLineAngleCallFor(evaluated.fixture, "collectionAngle");
    expect(collectionCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: diagonal?.id }
    });

    const parameterCall = moduleLineAngleCallFor(evaluated.fixture, "MeasureDiagonal", "parameterAngle");
    expect(parameterCall.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: diagonal?.id, geometryType: "path" }
    });

    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      for (const [name, value] of [
        ["baseStartAngle", 90],
        ["reversedStartAngle", 0],
        ["reversedStartMatchesBaseEnd", 0],
        ["occurrenceZeroAngle", 0],
        ["occurrenceOneAngle", 45],
        ["collectionAngle", 45],
        ["moduleParameterAngle", 45],
        ["occurrenceModuleParameterAngle", 45]
      ] as const) {
        expectRootScalar(evaluated.fixture, payload, name, {
          status: "ok", value: { kind: "number", value }
        });
      }
      const splitResult = evaluationPayloadToResult(payload).computedScalarBindings?.get(
        rootBindingFor(evaluated.fixture, "splitEndpointAngle").id
      );
      expect(splitResult?.status).toBe("ok");
      if (splitResult?.status === "ok" && splitResult.value.kind === "number") {
        expect(splitResult.value.value).toBeCloseTo(90, 8);
      } else {
        throw new Error("split endpoint angle was not a number");
      }
      for (const [instanceName, outputName, value] of [
        ["MeasureDiagonal", "parameterAngle", 45],
        ["MeasureOccurrence", "parameterAngle", 45]
      ] as const) {
        expect(evaluationPayloadToResult(payload).computedScalarBindings?.get(
          moduleOutputBindingIdFor(evaluated.fixture, instanceName, outputName)
        )).toMatchObject({ status: "ok", value: { kind: "number", value } });
      }
    }
  }, 120_000);

  it("preserves Module geometry carry identity for endpoint targets", () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Diagonal = segment(start: (0, 0), end: (10, 10))",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  line Occurrence = segment(start: (0, 0), end: (10, @i * 10))",
      "}",
      "module Measure(source: line) {",
      "  line Axis = segment(start: (0, 0), end: (10, 0))",
      "  const one: number[] = [1]",
      "  for i in @one carry edge: line = @source {",
      "    next edge = @source",
      "  }",
      "  export const parameterAngle: number = lineAngle(@source.start, @Axis.start)",
      "  export const carriedAngle: number = lineAngle(@edge.start, @Axis.start)",
      "}",
      "instance MeasureDiagonal = Measure(source: @Diagonal)",
      "instance MeasureOccurrence = Measure(source: @Occurrence[1])"
    ].join("\n"));
    expectAccepted(fixture, "Module geometry carry endpoint identity");

    const carries = geometryCarriesFor(fixture);
    expect(carries).toHaveLength(2);
    const carryIds = carries.map((carry) => carry.bindingId);
    expect(new Set(carryIds).size).toBe(2);

    for (const instanceName of ["MeasureDiagonal", "MeasureOccurrence"] as const) {
      const sourceElement = fixture.elements.find((element) =>
        element.name === (instanceName === "MeasureDiagonal" ? "Diagonal" : "Occurrence")
      );
      const parameterCall = moduleLineAngleCallFor(fixture, instanceName, "parameterAngle");
      expect(parameterCall.args[0]).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey: "start",
        target: { statementId: sourceElement?.id, geometryType: "path" }
      });
      const carriedCall = moduleLineAngleCallFor(fixture, instanceName, "carriedAngle");
      expect(carriedCall.args[0]).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey: "start",
        target: { kind: "geometryCarry", bindingId: expect.any(String) }
      });
      const target = carriedCall.args[0];
      if (target.kind !== "geometryEndpoint" || target.target?.kind !== "geometryCarry") {
        throw new Error(`Module geometry carry target for "${instanceName}" was not retained`);
      }
      expect(carryIds).toContain(target.target.bindingId);
    }
    expect(new Set(["MeasureDiagonal", "MeasureOccurrence"].map((instanceName) => {
      const target = moduleLineAngleCallFor(fixture, instanceName, "carriedAngle").args[0];
      return target.kind === "geometryEndpoint" && target.target?.kind === "geometryCarry" ? target.target.bindingId : null;
    })).size).toBe(2);
  });

  it("lowers the exact exported path carry endpoint through the production payload", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "curve Curve = bezier(start: (0, 0), end: (20, 5), startAngle: 25, startLength: 12, endAngle: 145, endLength: 8)",
      "module Forward(source: path) {",
      "  const ticks: number[] = [1]",
      "  for i in @ticks carry edge: path = @source {",
      "    next edge = @source",
      "  }",
      "  export const out: path = @edge",
      "}",
      "instance Use = Forward(source: @Curve)",
      "const result: number = lineAngle(@Use::out.start, @Axis.start)"
    ].join("\n"));
    expectAccepted(fixture, "Issue #1380 minimal source");
    expect(isRustEligibleFixture(fixture), "Issue #1380 production-host Rust eligibility").toBe(true);

    const instance = fixture.compiled?.doc.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === "Use");
    const instanceElement = fixture.elements.find((element) => element.name === "Use");
    const carry = exportedGeometryCarryFor(fixture, "Use", "out");
    const materializedPath = fixture.compiled?.doc.moduleMaterialization?.instanceBaseGeometrySnapshots.find(
      (snapshot) => snapshot.instanceId === instanceElement?.id
    )?.instancePath;
    if (!instance || !instanceElement || !carry || !materializedPath) {
      throw new Error("Issue #1380 materialized Module carry identity was not available");
    }
    const expectedBindingId = moduleCarryBindingIdFor(materializedPath, carry.bindingId);
    const call = rootLineAngleCallFor(fixture, "result");
    expect(call.args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: {
        kind: "geometryCarry",
        bindingId: expectedBindingId,
        statementId: expectedBindingId,
        geometryType: "path"
      }
    });

    const options = optionsFor(fixture);
    const rustInput = buildRustEvaluationInput(fixture.elements, options);
    expect(geometryEndpointArgumentsIn(rustInput)).toContainEqual(call.args[0]);

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expectRootScalar(fixture, rustPayload, "result", {
      status: "ok", value: { kind: "number", value: 25 }
    });
    // Issue #1381 owns the independent TypeScript carry lookup defect. Keep
    // its current failure visible instead of treating this as Rust/TS parity.
    const tsResult = evaluationPayloadToResult(tsPayload).computedScalarBindings?.get(rootBindingFor(fixture, "result").id);
    expect(tsResult).toMatchObject({ status: "error", issueCode: "evaluation-geometry-builtin-unavailable" });
    expect(runtimeDiagnosticsFor(fixture, tsPayload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        origin: "runtime",
        severity: "error",
        code: "evaluation-geometry-builtin-unavailable",
        bindingId: rootBindingFor(fixture, "result").id
      })
    ]));
  }, 120_000);

  it("keeps exported carry identities independent across distinct Module instances", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "curve Curve = bezier(start: (0, 0), end: (20, 5), startAngle: 25, startLength: 12, endAngle: 145, endLength: 8)",
      "module Forward(source: path) {",
      "  const ticks: number[] = [1]",
      "  for i in @ticks carry edge: path = @source {",
      "    next edge = @source",
      "  }",
      "  export const out: path = @edge",
      "}",
      "instance First = Forward(source: @Curve)",
      "instance Second = Forward(source: @Curve)",
      "const firstAngle: number = lineAngle(@First::out.start, @Axis.start)",
      "const secondAngle: number = lineAngle(@Second::out.end, @Axis.start)"
    ].join("\n"));
    expectAccepted(fixture, "distinct exported carry instances");
    expect(isRustEligibleFixture(fixture), "distinct exported carry production eligibility").toBe(true);

    const carries = geometryCarriesFor(fixture);
    expect(carries).toHaveLength(2);
    const sourceCarry = exportedGeometryCarryFor(fixture, "First", "out");
    const expectedBindings = new Map<string, string>();
    for (const name of ["First", "Second"] as const) {
      const instance = fixture.compiled?.doc.moduleSemanticAnalysis?.instances.find((candidate) => candidate.name === name);
      const instanceElement = fixture.elements.find((element) => element.name === name);
      const materializedPath = fixture.compiled?.doc.moduleMaterialization?.instanceBaseGeometrySnapshots.find(
        (snapshot) => snapshot.instanceId === instanceElement?.id
      )?.instancePath;
      if (!instance || !instanceElement || !materializedPath) throw new Error(`missing materialized path for ${name}`);
      const expectedBindingId = moduleCarryBindingIdFor(materializedPath, sourceCarry.bindingId);
      expectedBindings.set(name, expectedBindingId);
    }
    expect(new Set(expectedBindings.values()).size).toBe(2);
    expect(new Set(expectedBindings.values())).toEqual(new Set(carries.map((carry) => carry.bindingId)));
    for (const [resultName, instanceName, endpointKey] of [
      ["firstAngle", "First", "start"],
      ["secondAngle", "Second", "end"]
    ] as const) {
      const argument = rootLineAngleCallFor(fixture, resultName).args[0];
      expect(argument).toMatchObject({
        kind: "geometryEndpoint",
        endpointKey,
        target: { kind: "geometryCarry", bindingId: expectedBindings.get(instanceName), geometryType: "path" }
      });
    }

    const rustPayload = await rustStdio!.evaluate(fixture.elements, optionsFor(fixture));
    for (const [name, value] of [["firstAngle", 25], ["secondAngle", 35]] as const) {
      expectRootScalar(fixture, rustPayload, name, {
        status: "ok", value: { kind: "number", value }
      });
    }
  }, 120_000);

  it("keeps qualified non-carry Module export forwarding as a drawable target", async () => {
    const evaluated = await evaluateBoth([
      "nui 1",
      "line Axis = segment(start: (30, 30), end: (40, 30))",
      "curve Curve = bezier(start: (0, 0), end: (20, 5), startAngle: 25, startLength: 12, endAngle: 145, endLength: 8)",
      "module Forward(source: path) {",
      "  export const out: path = @source",
      "}",
      "instance Use = Forward(source: @Curve)",
      "const result: number = lineAngle(@Use::out.start, @Axis.start)"
    ].join("\n"), "qualified non-carry Module export forwarding");
    const curve = evaluated.fixture.elements.find((element) => element.name === "Curve");
    expect(rootLineAngleCallFor(evaluated.fixture, "result").args[0]).toMatchObject({
      kind: "geometryEndpoint",
      endpointKey: "start",
      target: { statementId: curve?.id, geometryType: "path" }
    });
    for (const payload of [evaluated.tsPayload, evaluated.rustPayload]) {
      expectRootScalar(evaluated.fixture, payload, "result", {
        status: "ok", value: { kind: "number", value: 25 }
      });
    }
  }, 120_000);

  it("reports the removed lineAngle(line, line) form through canonical compilation", () => {
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
      "nui 1",
      "line First = segment(start: (0, 0), end: (10, 0))",
      "line Second = segment(start: (0, 0), end: (0, 10))",
      "const oldForm: number = lineAngle(@First, @Second)"
    ].join("\n"));
    expect(compiled.status).toBe("fatal");
    const errors = compiled.status === "fatal"
      ? compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      : compiled.doc.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const endpointErrors = errors.filter((diagnostic) => diagnostic.code === "builtin-geometry-argument-invalid");
    expect(endpointErrors).toHaveLength(2);
  });
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
