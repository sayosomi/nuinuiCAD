import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  normalizeParityPayload,
  optionsFor,
  runtimeDiagnosticsFor
} from "./evaluationParitySupport";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("SAY-468 root value-for analysis-only binders over Rust stdio", () => {
  let rustStdio: ReturnType<typeof createRustStdioParityClient> | undefined;

  beforeAll(() => {
    rustStdio = createRustStdioParityClient(repoRoot);
  }, 30000);

  afterAll(() => rustStdio?.dispose());

  const checkMapFixture = async (
    source: string,
    expected?: number,
    config: { requireCatalogBinder?: boolean } = {}
  ) => {
    const fixture = fixtureFromSource(source);
    const compiled = fixture.compiled?.doc;
    if (!compiled) throw new Error("expected a compiled value-for fixture");
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect((compiled.bindingIssueDiagnostics ?? []).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const map = compiled.scalarProgram?.collectionValues?.find((value) => value.kind === "map");
    if (!map || map.kind !== "map") throw new Error("expected a compiled value-for map");
    const binder = compiled.bindingAnalysis?.catalog.bindingsById.get(map.binderId);
    if ((config.requireCatalogBinder ?? true) && !binder) {
      throw new Error("expected the root value-for binder to remain in the binding catalog");
    }
    if (binder) expect(binder.resolutionMode).toBe("preResolvedOnly");
    expect(compiled.bindingVersions?.versions.some((version) => version.bindingId === map.binderId)).toBe(false);

    const evaluationOptions = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, evaluationOptions);
    const rustPayload = await rustStdio!.evaluate(fixture.elements, evaluationOptions);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    for (const payload of [tsPayload, rustPayload]) {
      const result = evaluationPayloadToResult(payload);
      expect(result.errors).toEqual([]);
      expect(runtimeDiagnosticsFor(fixture, payload)).toEqual([]);
      expect(result.computedScalarBindings?.has(map.binderId) ?? false).toBe(false);
      expect([...(result.computedScalarBindingVersions?.values() ?? [])]
        .some((history) => history.bindingId === map.binderId)).toBe(false);

      if (expected !== undefined) {
        const resultBinding = compiled.bindingAnalysis?.catalog.bindings.find(
          (binding) => binding.kind === "typed" && binding.name === "result"
        );
        if (!resultBinding) throw new Error("expected a typed result binding");
        expect(result.computedScalarBindings?.get(resultBinding.id)).toMatchObject({
          status: "ok",
          value: { kind: "number", value: expected }
        });
      }
    }
  };

  it("keeps the reduced indexed root map lexical and evaluates it cleanly", async () => {
    await checkMapFixture([
      "nui 1",
      "const xs: number[] = [1]",
      "const mapped: number[] = for x in @xs { @x }",
      "const result: number = @mapped[0]"
    ].join("\n"), 1);
  }, 30000);

  it("evaluates a constant-body root map without materializing its binder", async () => {
    await checkMapFixture([
      "nui 1",
      "const xs: number[] = [1]",
      "const mapped: number[] = for x in @xs { 2 }",
      "const result: number = @mapped[0]"
    ].join("\n"), 2);
  }, 30000);

  it("keeps harmless comments, blank lines, and scalar padding from poisoning a root map", async () => {
    await checkMapFixture([
      "nui 1",
      "const xs: number[] = [1]",
      "// harmless padding",
      "",
      "const unrelated: number = 9",
      "const mapped: number[] = for x in @xs { @x }",
      "const result: number = @mapped[0]"
    ].join("\n"), 1);
  }, 30000);

  it("keeps root maps clean when only their length is consumed", async () => {
    await checkMapFixture([
      "nui 1",
      "const xs: number[] = [1]",
      "const mapped: number[] = for x in @xs { @x }",
      "const result: number = @mapped.length"
    ].join("\n"), 1);
  }, 30000);

  it("keeps an unused root map binder out of executable state", async () => {
    await checkMapFixture([
      "nui 1",
      "const xs: number[] = [1]",
      "const mapped: number[] = for x in @xs { @x }"
    ].join("\n"));
  }, 30000);

  it("preserves Module-local indexed-map scalar evaluation", async () => {
    await checkMapFixture([
      "nui 1",
      "const xs: number[] = [1]",
      "module Mapper(items: number[]) {",
      "  const mapped: number[] = for x in @items { @x }",
      "  export const selected: number = @mapped[0]",
      "}",
      "instance I = Mapper(items: @xs)",
      "const result: number = @I::selected"
    ].join("\n"), 1, { requireCatalogBinder: false });
  }, 30000);
});
