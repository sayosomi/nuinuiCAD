import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
type Fixture = ReturnType<typeof fixtureFromSource>;

const rootBindingFor = (fixture: Fixture, name: string) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding || binding.kind !== "typed") throw new Error(`typed binding ${name} not found`);
  return binding;
};

const moduleOutputFor = (fixture: Fixture, instanceName: string, outputName: string) => {
  const semantic = fixture.compiled?.doc.moduleSemanticAnalysis;
  const instance = semantic?.instances.find((candidate) => candidate.name === instanceName);
  if (!instance?.callee) throw new Error(`Module instance ${instanceName} not found`);
  const definition = semantic?.definitionsByStatementId.get(instance.callee.definitionStatementId);
  const scalar = definition?.localScalars.find((candidate) => candidate.name === outputName);
  if (!definition || !scalar) throw new Error(`Module output ${instanceName}::${outputName} not found`);
  return {
    definition,
    scalar,
    bindingId: moduleScalarBindingIdFor([instance.statementId], definition.statementId, scalar.statementId)
  };
};

const scalarInitializerFor = (fixture: Fixture, bindingId: string) =>
  fixture.compiled?.doc.scalarProgram?.statements.find((statement) => statement.bindingId === bindingId)
    ?.declaration.initializer;

const moduleCarryPropertyTargetFor = (
  fixture: Fixture,
  instanceName: string,
  outputName: string,
  property: string,
  pointKey?: "start" | "end"
) => {
  const output = moduleOutputFor(fixture, instanceName, outputName);
  const reference = output.scalar.initializer?.geometryProperties.find((candidate) =>
    candidate.property === property || (
      candidate.target?.kind === "geometryCarry" &&
      candidate.target.property === property &&
      candidate.target.pointKey === pointKey
    )
  );
  expect(reference?.resolution, `${instanceName}::${outputName} property resolution`).toBe("resolved");
  expect(reference?.target).toMatchObject({
    kind: "geometryCarry",
    property,
    ...(pointKey ? { pointKey } : {})
  });
  if (!pointKey) expect(reference?.target).not.toHaveProperty("pointKey");
  if (reference?.target?.kind !== "geometryCarry") {
    throw new Error(`Module output ${instanceName}::${outputName} did not resolve to a geometry carry`);
  }
  const compiledScalar = scalarInitializerFor(fixture, output.bindingId);
  expect(compiledScalar).toMatchObject({
    kind: "geometryProperty",
    property,
    geometryCarryBindingId: expect.any(String),
    ...(pointKey ? { geometryCarryPointKey: pointKey } : {})
  });
  if (compiledScalar?.kind !== "geometryProperty" || !compiledScalar.geometryCarryBindingId) {
    throw new Error(`Module output ${instanceName}::${outputName} has no compiled geometry carry binding`);
  }

  const doc = fixture.compiled?.doc;
  const runtimeCarryOwners = fixture.elements.flatMap((element) => {
    if (element.type !== "forGroup") return [];
    const owner = doc?.moduleForGroupExecutionOwnerByElementId?.get(element.id);
    if (!owner) return [];
    const plan = doc.bindingVersions?.immutableForGroups?.get(owner.ownerStatementId);
    const carry = plan?.geometryCarries?.find((candidate) =>
      candidate.bindingId === compiledScalar.geometryCarryBindingId
    );
    return carry ? [{ element, owner, plan, carry }] : [];
  });
  expect(runtimeCarryOwners, `${instanceName}::${outputName} runtime carry owner`).toHaveLength(1);
  const runtimeCarryOwner = runtimeCarryOwners[0];
  if (!runtimeCarryOwner) {
    throw new Error(`Module output ${instanceName}::${outputName} has no compiler-owned geometry carry plan`);
  }
  expect(runtimeCarryOwner.owner).toMatchObject({
    kind: "forGroup",
    elementId: runtimeCarryOwner.element.id,
    ownerStatementId: runtimeCarryOwner.plan.ownerStatementId
  });
  expect(runtimeCarryOwner.carry).toMatchObject({
    bindingId: compiledScalar.geometryCarryBindingId,
    declaredType: { kind: reference.target.geometryKind }
  });
  return { ...output, reference, target: reference.target };
};

const geometryCarriesFor = (fixture: Fixture) =>
  [...(fixture.compiled?.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
    .flatMap((plan) => plan.geometryCarries ?? []);

const expectNumber = (payload: EvaluationPayload, bindingId: string, expected: number, label: string) => {
  const evaluation = evaluationPayloadToResult(payload).computedScalarBindings?.get(bindingId);
  expect(evaluation, label).toMatchObject({ status: "ok", value: { kind: "number" } });
  if (evaluation?.status !== "ok" || evaluation.value.kind !== "number") {
    throw new Error(`${label} did not evaluate to a number`);
  }
  expect(evaluation.value.value, label).toBeCloseTo(expected, 10);
};

const expectRootNumber = (fixture: Fixture, payload: EvaluationPayload, name: string, expected: number) =>
  expectNumber(payload, rootBindingFor(fixture, name).id, expected, `root scalar ${name}`);

const expectModuleNumber = (
  fixture: Fixture,
  payload: EvaluationPayload,
  instanceName: string,
  outputName: string,
  expected: number
) => expectNumber(
  payload,
  moduleOutputFor(fixture, instanceName, outputName).bindingId,
  expected,
  `Module scalar ${instanceName}::${outputName}`
);

const expectAcceptedFixture = (fixture: Fixture, name: string) => {
  expect(fixture.compiled?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), name).toEqual([]);
};

describe("SAY-507 TypeScript geometry carry angles through persistent Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  const evaluateCase = async (name: string, source: string, expectedRustEligibility?: boolean) => {
    const fixture = fixtureFromSource(source);
    expectAcceptedFixture(fixture, name);
    const options = optionsFor(fixture);
    const rustEligible = isRustEligibleFixture(fixture);
    if (expectedRustEligibility !== undefined) {
      expect(rustEligible, `${name}: normal-host Rust eligibility`).toBe(expectedRustEligibility);
    }

    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    if (!rustEligible) return { fixture, tsPayload, rustPayload: undefined, payloads: [tsPayload] };

    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizeParityPayload(rustPayload), name).toEqual(normalizeParityPayload(tsPayload));
    return { fixture, tsPayload, rustPayload, payloads: [tsPayload, rustPayload] };
  };

  const expectSuccessfulPayloads = (fixture: Fixture, payloads: readonly EvaluationPayload[]) => {
    for (const payload of payloads) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
    }
  };

  it("evaluates public line angles for empty Module carries, drawable inputs, direct inputs, and root carries", async () => {
    const acceptanceSource = [
      "nui 1",
      "const seed: line = segment(start: (0, 0), end: (3, 4))",
      "module M(input: line) {",
      "  const empty: number[] = []",
      "  for n in @empty carry l: line = @input {",
      "    next l = @l",
      "  }",
      "  export const angle: number = @l.startAngleDeg",
      "}",
      "instance A = M(input: @seed)",
      "const result: number = @A::angle"
    ].join("\n");

    const cases = [
      {
        name: "SAY-507 acceptance source",
        source: acceptanceSource,
        module: [{ instance: "A", name: "angle", property: "startAngleDeg", carry: true, expected: 53.13010235415595 }],
        root: { result: 53.13010235415595 }
      },
      {
        name: "vertical Module carry end angle",
        source: [
          "nui 1",
          "const seed: line = segment(start: (2, 3), end: (2, 13))",
          "module M(input: line) {",
          "  const empty: number[] = []",
          "  for n in @empty carry l: line = @input {",
          "    next l = @l",
          "  }",
          "  export const start: number = @l.startAngleDeg",
          "  export const end: number = @l.endAngleDeg",
          "}",
          "instance A = M(input: @seed)",
          "const startResult: number = @A::start",
          "const endResult: number = @A::end"
        ].join("\n"),
        module: [
          { instance: "A", name: "start", property: "startAngleDeg", carry: true, expected: 90 },
          { instance: "A", name: "end", property: "endAngleDeg", carry: true, expected: 270 }
        ],
        root: { startResult: 90, endResult: 270 }
      },
      {
        name: "drawable line Module input",
        source: [
          "nui 1",
          "line seed = segment(start: (0, 0), end: (3, 4))",
          "module M(input: line) {",
          "  const empty: number[] = []",
          "  for n in @empty carry l: line = @input {",
          "    next l = @l",
          "  }",
          "  export const start: number = @l.startAngleDeg",
          "  export const end: number = @l.endAngleDeg",
          "  export const length: number = @l.length",
          "}",
          "instance A = M(input: @seed)",
          "const startResult: number = @A::start",
          "const endResult: number = @A::end",
          "const lengthResult: number = @A::length"
        ].join("\n"),
        module: [
          { instance: "A", name: "start", property: "startAngleDeg", carry: true, expected: 53.13010235415595 },
          { instance: "A", name: "end", property: "endAngleDeg", carry: true, expected: 233.13010235415595 },
          { instance: "A", name: "length", property: "length", carry: true, expected: 5 }
        ],
        root: { startResult: 53.13010235415595, endResult: 233.13010235415595, lengthResult: 5 }
      },
      {
        name: "no-carry Module input baseline",
        source: [
          "nui 1",
          "const seed: line = segment(start: (0, 0), end: (3, 4))",
          "module M(input: line) {",
          "  export const angle: number = @input.startAngleDeg",
          "}",
          "instance A = M(input: @seed)",
          "const result: number = @A::angle"
        ].join("\n"),
        module: [{ instance: "A", name: "angle", property: "startAngleDeg", carry: false, expected: 53.13010235415595 }],
        root: { result: 53.13010235415595 }
      },
      {
        name: "root materialized line carry angles and endpoint projection",
        source: [
          "nui 1",
          "const seed: line = segment(start: (0, 0), end: (3, 4))",
          "const empty: number[] = []",
          "for n in @empty carry l: line = @seed {",
          "  next l = @l",
          "}",
          "const start: number = @l.startAngleDeg",
          "const end: number = @l.endAngleDeg",
          "const length: number = @l.length",
          "const startX: number = @l.start.x",
          "const endY: number = @l.end.y"
        ].join("\n"),
        module: [] as { instance: string; name: string; property: string; carry: boolean; expected: number }[],
        root: {
          start: 53.13010235415595,
          end: 233.13010235415595,
          length: 5,
          startX: 0,
          endY: 4
        }
      }
    ];

    for (const testCase of cases) {
      const evaluated = await evaluateCase(testCase.name, testCase.source, true);
      expectSuccessfulPayloads(evaluated.fixture, evaluated.payloads);
      const moduleBindingIds = testCase.module.map((output) => {
        const resolved = moduleOutputFor(evaluated.fixture, output.instance, output.name);
        if (output.carry) {
          moduleCarryPropertyTargetFor(
            evaluated.fixture,
            output.instance,
            output.name,
            output.property
          );
        }
        return resolved.bindingId;
      });
      const rootBindingIds = Object.keys(testCase.root).map((name) => rootBindingFor(evaluated.fixture, name).id);
      expect(new Set([...moduleBindingIds, ...rootBindingIds]).size).toBe(moduleBindingIds.length + rootBindingIds.length);

      for (const payload of evaluated.payloads) {
        for (const output of testCase.module) {
          expectModuleNumber(evaluated.fixture, payload, output.instance, output.name, output.expected);
        }
        for (const [name, value] of Object.entries(testCase.root)) {
          expectRootNumber(evaluated.fixture, payload, name, value);
        }
      }

      if (testCase.name === "root materialized line carry angles and endpoint projection") {
        const carries = geometryCarriesFor(evaluated.fixture);
        expect(carries).toHaveLength(1);
        const carry = carries[0];
        if (!carry) throw new Error("missing root line carry");
        for (const [name, property, pointKey] of [
          ["start", "startAngleDeg", undefined],
          ["end", "endAngleDeg", undefined],
          ["length", "length", undefined],
          ["startX", "x", "start"],
          ["endY", "y", "end"]
        ] as const) {
          expect(scalarInitializerFor(evaluated.fixture, rootBindingFor(evaluated.fixture, name).id)).toMatchObject({
            kind: "geometryProperty",
            geometryCarryBindingId: carry.bindingId,
            property,
            ...(pointKey ? { geometryCarryPointKey: pointKey } : {})
          });
        }
      } else if (testCase.name === "no-carry Module input baseline") {
        expect(geometryCarriesFor(evaluated.fixture)).toEqual([]);
      }
    }
  }, 120_000);

  it("preserves line, path, and point properties across an empty heterogeneous Module carry", async () => {
    const source = [
      "nui 1",
      "const lineSeed: line = segment(start: (1, 2), end: (4, 6))",
      "const pathSeed: path = polyline(points: [(10, 11), (14, 11), (14, 16)], closed: false)",
      "const pointSeed: point = coordinate(x: -4, y: 9)",
      "module M(lineInput: line, pathInput: path, pointInput: point) {",
      "  const empty: number[] = []",
      "  for n in @empty carry lineValue: line = @lineInput carry pathValue: path = @pathInput carry pointValue: point = @pointInput {",
      "    next lineValue = @lineValue",
      "    next pathValue = @pathValue",
      "    next pointValue = @pointValue",
      "  }",
      "  export const lineLength: number = @lineValue.length",
      "  export const lineStartX: number = @lineValue.start.x",
      "  export const lineEndY: number = @lineValue.end.y",
      "  export const pathLength: number = @pathValue.length",
      "  export const pathStartY: number = @pathValue.start.y",
      "  export const pathEndX: number = @pathValue.end.x",
      "  export const pathEndY: number = @pathValue.end.y",
      "  export const pointX: number = @pointValue.x",
      "  export const pointY: number = @pointValue.y",
      "}",
      "instance A = M(lineInput: @lineSeed, pathInput: @pathSeed, pointInput: @pointSeed)",
      "const lineLengthResult: number = @A::lineLength",
      "const lineStartXResult: number = @A::lineStartX",
      "const lineEndYResult: number = @A::lineEndY",
      "const pathLengthResult: number = @A::pathLength",
      "const pathStartYResult: number = @A::pathStartY",
      "const pathEndXResult: number = @A::pathEndX",
      "const pathEndYResult: number = @A::pathEndY",
      "const pointXResult: number = @A::pointX",
      "const pointYResult: number = @A::pointY"
    ].join("\n");
    const evaluated = await evaluateCase("heterogeneous Module carries", source);
    expectSuccessfulPayloads(evaluated.fixture, evaluated.payloads);

    const expected = {
      lineLength: 5,
      lineStartX: 1,
      lineEndY: 6,
      pathLength: 9,
      pathStartY: 11,
      pathEndX: 14,
      pathEndY: 16,
      pointX: -4,
      pointY: 9
    };
    for (const [name, value] of Object.entries(expected)) {
      const property = name.endsWith("Length") ? "length"
        : name === "lineStartX" ? "x"
          : name === "lineEndY" ? "y"
            : name === "pathStartY" ? "y"
              : name === "pathEndX" ? "x"
                : name === "pathEndY" ? "y"
                  : name === "pointX" ? "x" : "y";
      const pointKey = name.includes("Start") ? "start" : name.includes("End") ? "end" : undefined;
      moduleCarryPropertyTargetFor(evaluated.fixture, "A", name, property, pointKey);
      for (const payload of evaluated.payloads) {
        expectModuleNumber(evaluated.fixture, payload, "A", name, value);
        expectRootNumber(evaluated.fixture, payload, `${name}Result`, value);
      }
    }
    expect(geometryCarriesFor(evaluated.fixture)).toHaveLength(3);
  }, 120_000);

  it("keeps nonempty carry snapshots and selected transformation stages", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  line First = segment(start: (1, 2), end: (4, 6))",
      "  line Second = segment(start: (30, 40), end: (30, 45))",
      "  move First as shifted (from: (1, 2), to: (10, 20))",
      "  const one: number[] = [1]",
      "  for n in @one carry a: line = @First carry b: line = @Second {",
      "    next a = @b",
      "    next b = @First.shifted",
      "  }",
      "  export const aAngle: number = @a.startAngleDeg",
      "  export const aEndY: number = @a.end.y",
      "  export const bAngle: number = @b.startAngleDeg",
      "  export const bStartX: number = @b.start.x",
      "  export const bEndX: number = @b.end.x",
      "  export const bEndY: number = @b.end.y",
      "  export const bLength: number = @b.length",
      "}",
      "instance A = M()",
      "const aAngleResult: number = @A::aAngle",
      "const aEndYResult: number = @A::aEndY",
      "const bAngleResult: number = @A::bAngle",
      "const bStartXResult: number = @A::bStartX",
      "const bEndXResult: number = @A::bEndX",
      "const bEndYResult: number = @A::bEndY",
      "const bLengthResult: number = @A::bLength"
    ].join("\n");
    const evaluated = await evaluateCase("nonempty snapshot and selected stage", source, true);
    expectSuccessfulPayloads(evaluated.fixture, evaluated.payloads);

    const values = {
      aAngle: 90,
      aEndY: 45,
      bAngle: 53.13010235415595,
      bStartX: 10,
      bEndX: 13,
      bEndY: 24,
      bLength: 5
    };
    for (const [name, value] of Object.entries(values)) {
      for (const payload of evaluated.payloads) {
        expectModuleNumber(evaluated.fixture, payload, "A", name, value);
        expectRootNumber(evaluated.fixture, payload, `${name}Result`, value);
      }
    }

    const carries = geometryCarriesFor(evaluated.fixture);
    expect(carries).toHaveLength(2);
    expect(new Set(carries.map((carry) => carry.bindingId)).size).toBe(2);
    const stagedTarget = carries.map((carry) => carry.nextTarget).find((target) =>
      "stagePath" in target && target.stagePath?.[0] === "shifted"
    );
    expect(stagedTarget).toMatchObject({ stagePath: ["shifted"] });
    const snapshotTarget = carries.find((carry) => carry.nextTarget.kind === "geometryCarry")?.nextTarget;
    if (snapshotTarget?.kind !== "geometryCarry") throw new Error("missing geometry carry snapshot target");
    expect(carries.some((candidate) => candidate.bindingId === snapshotTarget.bindingId)).toBe(true);
    for (const [name, property, pointKey] of [
      ["aAngle", "startAngleDeg", undefined],
      ["aEndY", "y", "end"],
      ["bAngle", "startAngleDeg", undefined],
      ["bStartX", "x", "start"],
      ["bEndX", "x", "end"],
      ["bEndY", "y", "end"],
      ["bLength", "length", undefined]
    ] as const) {
      moduleCarryPropertyTargetFor(evaluated.fixture, "A", name, property, pointKey);
    }
  }, 120_000);

  it("keeps distinct Module instance geometry owners separate", async () => {
    const source = [
      "nui 1",
      "const first: line = segment(start: (0, 0), end: (3, 4))",
      "const second: line = segment(start: (8, 9), end: (8, 14))",
      "module M(input: line) {",
      "  const empty: number[] = []",
      "  for n in @empty carry l: line = @input {",
      "    next l = @l",
      "  }",
      "  export const start: number = @l.startAngleDeg",
      "  export const end: number = @l.endAngleDeg",
      "  export const length: number = @l.length",
      "}",
      "instance A = M(input: @first)",
      "instance B = M(input: @second)",
      "const startA: number = @A::start",
      "const endA: number = @A::end",
      "const lengthA: number = @A::length",
      "const startB: number = @B::start",
      "const endB: number = @B::end",
      "const lengthB: number = @B::length"
    ].join("\n");
    const evaluated = await evaluateCase("asymmetric Module line carry instances", source, true);
    expectSuccessfulPayloads(evaluated.fixture, evaluated.payloads);

    const expected = {
      startA: 53.13010235415595,
      endA: 233.13010235415595,
      lengthA: 5,
      startB: 90,
      endB: 270,
      lengthB: 5
    };
    const moduleBindingIds = [
      ...["start", "end", "length"].map((name) => moduleOutputFor(evaluated.fixture, "A", name).bindingId),
      ...["start", "end", "length"].map((name) => moduleOutputFor(evaluated.fixture, "B", name).bindingId)
    ];
    const rootBindingIds = Object.keys(expected).map((name) => rootBindingFor(evaluated.fixture, name).id);
    expect(new Set(moduleBindingIds).size).toBe(6);
    expect(new Set(rootBindingIds).size).toBe(6);
    expect(new Set([...moduleBindingIds, ...rootBindingIds]).size).toBe(12);

    for (const [name, value] of Object.entries(expected)) {
      const instance = name.endsWith("A") ? "A" : "B";
      const outputName = name.startsWith("start") ? "start" : name.startsWith("end") ? "end" : "length";
      const property = outputName === "start" ? "startAngleDeg" : outputName === "end" ? "endAngleDeg" : "length";
      moduleCarryPropertyTargetFor(evaluated.fixture, instance, outputName, property);
      for (const payload of evaluated.payloads) {
        expectModuleNumber(evaluated.fixture, payload, instance, outputName, value);
        expectRootNumber(evaluated.fixture, payload, name, value);
      }
    }

    const carries = geometryCarriesFor(evaluated.fixture);
    expect(carries).toHaveLength(2);
    expect(new Set(carries.map((carry) => carry.bindingId)).size).toBe(2);
  }, 120_000);

  it("reports unavailable angle for a degenerate carried line without fabricating a number", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "const seed: line = segment(start: (2, 2), end: (2, 2))",
      "const empty: number[] = []",
      "for n in @empty carry l: line = @seed {",
      "  next l = @l",
      "}",
      "const angle: number = @l.startAngleDeg",
      "const length: number = @l.length"
    ].join("\n"));
    expectAcceptedFixture(fixture, "degenerate root carry");
    const options = optionsFor(fixture);
    const rustEligible = isRustEligibleFixture(fixture);
    expect(rustEligible, "degenerate root carry: normal-host Rust eligibility").toBe(true);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);

    const angleBinding = rootBindingFor(fixture, "angle");
    const lengthBinding = rootBindingFor(fixture, "length");
    const carries = geometryCarriesFor(fixture);
    expect(carries).toHaveLength(1);
    const carry = carries[0];
    if (!carry) throw new Error("missing degenerate root line carry");
    expect(carry.declaredType).toEqual({ kind: "line" });
    expect(scalarInitializerFor(fixture, angleBinding.id)).toMatchObject({
      kind: "geometryProperty",
      property: "startAngleDeg",
      geometryCarryBindingId: carry.bindingId
    });
    expect(scalarInitializerFor(fixture, lengthBinding.id)).toMatchObject({
      kind: "geometryProperty",
      property: "length",
      geometryCarryBindingId: carry.bindingId
    });

    // SAY-508: Rust carry initialization still rejects zero-length line materialization; exclude only this carried-length parity field.
    const withoutDegenerateCarryLength = (payload: EvaluationPayload): EvaluationPayload => ({
      ...payload,
      computedScalarBindings: payload.computedScalarBindings?.filter(({ bindingId }) => bindingId !== lengthBinding.id),
      computedScalarBindingVersions: payload.computedScalarBindingVersions?.filter(({ bindingId }) => bindingId !== lengthBinding.id)
    });
    expect(normalizeParityPayload(withoutDegenerateCarryLength(rustPayload))).toEqual(
      normalizeParityPayload(withoutDegenerateCarryLength(tsPayload))
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.computedScalarBindings?.get(angleBinding.id)).toMatchObject({
        status: "error",
        issueCode: "evaluation-geometry-property-unavailable"
      });
      const retainedLine = payload.computedGeometryValues?.find((entry) => entry.value.kind === "line")?.value;
      expect(retainedLine).toMatchObject({
        kind: "line",
        start: { x: 2, y: 2 },
        end: { x: 2, y: 2 },
        length: 0,
        startAngleDeg: null,
        endAngleDeg: null,
        startTangentAngleDeg: null,
        endTangentAngleDeg: null
      });
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          origin: "runtime",
          severity: "error",
          code: "evaluation-geometry-property-unavailable",
          bindingId: angleBinding.id
        })
      ]));
    }
    expectRootNumber(fixture, tsPayload, "length", 0);
  }, 120_000);
});
