import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import {
  recordFieldContentsCollectionValueIdFor,
  recordValueCollectionIdFor
} from "@nuinuicad/nui-language";
import type { ScalarProgramCollection } from "@nuinuicad/nui-language";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const scalarFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  payload: EvaluationPayload,
  name: string
) => {
  const binding = fixture.compiled?.doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === name
  );
  if (!binding) throw new Error(`typed binding ${name} not found`);
  return evaluationPayloadToResult(payload).computedScalarBindings?.get(binding.id);
};

const normalizePersistentParityPayload = (payload: EvaluationPayload): unknown => {
  const normalized = normalizeParityPayload(payload);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
  const record = normalized as Record<string, unknown>;
  const computedScalarBindings = record.computedScalarBindings;
  if (!Array.isArray(computedScalarBindings)) return normalized;
  return {
    ...record,
    computedScalarBindings: [...computedScalarBindings].sort((left, right) =>
      String((left as { bindingId?: unknown }).bindingId ?? "")
        .localeCompare(String((right as { bindingId?: unknown }).bindingId ?? ""))
    )
  };
};

const rootRecordFieldContentsIdFor = (
  fixture: ReturnType<typeof fixtureFromSource>,
  recordName: string,
  fieldName: string
) => {
  const recordValues = fixture.compiled?.doc.moduleSemanticAnalysis?.rootRecordValuesByStatementId;
  const recordValue = [...(recordValues?.values() ?? [])].find((candidate) => candidate.value.name === recordName);
  if (!recordValue) throw new Error(`root record value ${recordName} not found`);
  const recordAnalysis = fixture.compiled?.doc.sourceLexicalNamespace?.recordSemanticAnalysis;
  const definition = recordAnalysis?.definitionsByStatementId.get(recordValue.value.typeIdentity);
  if (!definition) throw new Error(`record definition for ${recordName} not found`);
  const field = definition.fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`record field ${recordName}.${fieldName} not found`);
  return recordFieldContentsCollectionValueIdFor(
    recordValueCollectionIdFor([], recordValue.value.statementId),
    [field.identity]
  );
};

const collectionAliasTerminalIdFor = (
  collections: readonly ScalarProgramCollection[],
  startValueId: string
): string | null => {
  const visited = new Set<string>();
  let valueId = startValueId;
  while (!visited.has(valueId)) {
    visited.add(valueId);
    const matches = collections.filter((collection) => collection.valueId === valueId);
    if (matches.length !== 1) return null;
    const collection = matches[0]!;
    if (collection.kind !== "alias") return valueId;
    valueId = collection.targetValueId;
  }
  return null;
};

const cases = [
  {
    name: "the exact named-root Packet forwarding reproducer",
    source: [
      "nui 1",
      "record Packet(xs: number[], tag: number)",
      "const Input: Packet = Packet(xs: [7, 19], tag: 101)",
      "module Forward(packet: Packet) {",
      "  export const out: Packet = @packet",
      "}",
      "instance Use = Forward(packet: @Input)",
      "const Length: number = @Use::out.xs.length",
      "const First: number = @Use::out.xs[0]",
      "const Tag: number = @Use::out.tag"
    ].join("\n"),
    expectedValues: { Length: 2, First: 7, Tag: 101 },
    rootArrays: [{ recordName: "Input", members: [7, 19] }]
  },
  {
    name: "asymmetric instances, direct and local aliases, inline and Module-local records",
    source: [
      "nui 1",
      "record Packet(xs: number[], tag: number)",
      "const Short: Packet = Packet(xs: [2], tag: 101)",
      "const Long: Packet = Packet(xs: [5, 7, 11], tag: 202)",
      "module Forward(packet: Packet) {",
      "  export const out: Packet = @packet",
      "}",
      "module LocalForward(packet: Packet) {",
      "  const local: Packet = @packet",
      "  export const out: Packet = @local",
      "}",
      "module Factory() {",
      "  const local: Packet = Packet(xs: [23, 29], tag: 404)",
      "  const alias: Packet = @local",
      "  export const out: Packet = @alias",
      "}",
      "instance ShortUse = Forward(packet: @Short)",
      "instance LongUse = Forward(packet: @Long)",
      "instance LocalUse = LocalForward(packet: @Short)",
      "instance InlineUse = Forward(packet: Packet(xs: [13, 17], tag: 303))",
      "instance FactoryUse = Factory()",
      "const shortLength: number = @ShortUse::out.xs.length",
      "const shortFirst: number = @ShortUse::out.xs[0]",
      "const shortTag: number = @ShortUse::out.tag",
      "const longLength: number = @LongUse::out.xs.length",
      "const longFirst: number = @LongUse::out.xs[0]",
      "const longSecond: number = @LongUse::out.xs[1]",
      "const longTag: number = @LongUse::out.tag",
      "const localLength: number = @LocalUse::out.xs.length",
      "const localFirst: number = @LocalUse::out.xs[0]",
      "const localTag: number = @LocalUse::out.tag",
      "const inlineLength: number = @InlineUse::out.xs.length",
      "const inlineFirst: number = @InlineUse::out.xs[0]",
      "const inlineTag: number = @InlineUse::out.tag",
      "const factoryLength: number = @FactoryUse::out.xs.length",
      "const factoryFirst: number = @FactoryUse::out.xs[0]",
      "const factoryTag: number = @FactoryUse::out.tag",
      "record TagOnly(tag: number)",
      "const Scalar: TagOnly = TagOnly(tag: 505)",
      "const ScalarAlias: TagOnly = @Scalar",
      "module ScalarForward(input: TagOnly) {",
      "  export const out: TagOnly = @input",
      "}",
      "instance ScalarUse = ScalarForward(input: @ScalarAlias)",
      "const scalarOnlyTag: number = @ScalarUse::out.tag",
      "const standalone: number[] = [4, 4, 8]",
      "const standaloneAlias: number[] = @standalone",
      "const standaloneLength: number = @standaloneAlias.length",
      "const standaloneDuplicate: number = @standaloneAlias[1]"
    ].join("\n"),
    expectedValues: {
      shortLength: 1, shortFirst: 2, shortTag: 101,
      longLength: 3, longFirst: 5, longSecond: 7, longTag: 202,
      localLength: 1, localFirst: 2, localTag: 101,
      inlineLength: 2, inlineFirst: 13, inlineTag: 303,
      factoryLength: 2, factoryFirst: 23, factoryTag: 404,
      scalarOnlyTag: 505, standaloneLength: 3, standaloneDuplicate: 4
    },
    rootArrays: [{ recordName: "Short", members: [2] }, { recordName: "Long", members: [5, 7, 11] }]
  },
  {
    name: "empty and duplicate collection members",
    source: [
      "nui 1",
      "record Packet(xs: number[], tag: number)",
      "const Empty: Packet = Packet(xs: [], tag: 61)",
      "const Repeated: Packet = Packet(xs: [3, 3, 5, 3], tag: 72)",
      "module Forward(packet: Packet) {",
      "  export const out: Packet = @packet",
      "}",
      "instance EmptyUse = Forward(packet: @Empty)",
      "instance RepeatedUse = Forward(packet: @Repeated)",
      "const emptyLength: number = @EmptyUse::out.xs.length",
      "const emptyTag: number = @EmptyUse::out.tag",
      "const repeatedLength: number = @RepeatedUse::out.xs.length",
      "const repeatedFirst: number = @RepeatedUse::out.xs[0]",
      "const repeatedThird: number = @RepeatedUse::out.xs[2]",
      "const repeatedLast: number = @RepeatedUse::out.xs[3]",
      "const repeatedTag: number = @RepeatedUse::out.tag"
    ].join("\n"),
    expectedValues: {
      emptyLength: 0, emptyTag: 61,
      repeatedLength: 4, repeatedFirst: 3, repeatedThird: 5,
      repeatedLast: 3, repeatedTag: 72
    },
    rootArrays: [{ recordName: "Empty", members: [] }, { recordName: "Repeated", members: [3, 3, 5, 3] }]
  }
];

describe("Issue #1376 root record collection fields through production Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 120_000);

  afterAll(() => rustStdio?.dispose());

  it.each(cases)("$name", async (testCase) => {
    const fixture = fixtureFromSource(testCase.source);
    const compiled = fixture.compiled?.doc;
    if (!compiled) throw new Error(`${testCase.name}: expected a compiled fixture`);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error"), testCase.name).toEqual([]);
    expect(isRustEligibleFixture(fixture), testCase.name).toBe(true);

    const collections = compiled.scalarProgram?.collectionValues ?? [];
    const rootFieldContentsIds = testCase.rootArrays.map(({ recordName, members }) => {
      const valueId = rootRecordFieldContentsIdFor(fixture, recordName, "xs");
      const producers = collections.filter((collection) => collection.valueId === valueId);
      expect(producers, `${testCase.name}: ${recordName}.xs producer count`).toHaveLength(1);
      expect(producers[0], `${testCase.name}: ${recordName}.xs producer`).toMatchObject({
        kind: "literal",
        members: members.map((member) => ({
          kind: "literal",
          type: { kind: "number" },
          value: { kind: "number", value: member }
        }))
      });
      return valueId;
    });

    const parameterFieldAliases = collections.filter((collection) =>
      collection.kind === "alias" &&
      collection.valueId.startsWith("record-field-contents:") &&
      collection.valueId.includes("module-record-parameter:")
    );
    expect(new Set(parameterFieldAliases.map((collection) => collection.targetValueId)), testCase.name).toEqual(
      new Set(rootFieldContentsIds)
    );

    const fieldContentsAliases = collections.filter((collection) =>
      collection.kind === "alias" && collection.valueId.startsWith("record-field-contents:")
    );
    for (const alias of fieldContentsAliases) {
      expect(collectionAliasTerminalIdFor(collections, alias.valueId), `${testCase.name}: ${alias.valueId}`).not.toBeNull();
    }
    for (const valueId of rootFieldContentsIds) {
      expect(
        fieldContentsAliases.filter((alias) => collectionAliasTerminalIdFor(collections, alias.valueId) === valueId).length,
        `${testCase.name}: forwarding aliases for ${valueId}`
      ).toBeGreaterThanOrEqual(2);
    }

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, options);
    expect(normalizePersistentParityPayload(rustPayload), testCase.name).toEqual(
      normalizePersistentParityPayload(tsPayload)
    );

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors, testCase.name).toEqual([]);
      expect(result.computedScalarBindings, testCase.name).toBeDefined();
      for (const [name, value] of Object.entries(testCase.expectedValues)) {
        expect(scalarFor(fixture, payload, name), `${testCase.name}: ${name}`).toMatchObject({
          status: "ok",
          value: { kind: "number", value }
        });
      }
    }
  }, 60_000);
});
