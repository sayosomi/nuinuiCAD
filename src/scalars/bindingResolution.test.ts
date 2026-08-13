import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import { buildBindingCatalog } from "./bindingCatalog";
import { buildElementLocalRangeIndex, type ElementLocalBinding, type ElementLocalRangeIndex } from "./elementLocalRangeIndex";
import { buildLexicalScopeIndex } from "./lexicalScopeIndex";
import {
  resolveBindingReferenceForTests,
  resolveInitializerReferences,
  resolveInitializerReferencesWithTraceForTests
} from "./bindingResolution";

const catalogFor = (source: string) => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const stableStatementIdByIndex = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
  const scopeIndex = buildLexicalScopeIndex(parsed.statements, (index) => stableStatementIdByIndex.get(index)!);
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 4 });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const adapter = buildDslBindingAdapterSeeds({
    statements: parsed.statements,
    scopeIndex,
    stableStatementIdByIndex,
    reconciledContainers: { elements: compiled.elements, elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map() }
  });
  return buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex
  });
};

/** Neutral local-resolution owner: groups a flat list of element-local
 * bindings by owner/name && builds the range index, entirely independent of
 * BindingCatalog (see elementLocalRangeIndex.ts's module comment). */
const indexFor = (locals: readonly ElementLocalBinding[]): ElementLocalRangeIndex => {
  const byOwnerAndName = new Map<string, Map<string, ElementLocalBinding[]>>();
  for (const local of locals) {
    const names = byOwnerAndName.get(local.ownerId) ?? new Map<string, ElementLocalBinding[]>();
    const bucket = names.get(local.name) ?? [];
    bucket.push(local);
    names.set(local.name, bucket);
    byOwnerAndName.set(local.ownerId, names);
  }
  return buildElementLocalRangeIndex(byOwnerAndName);
};

describe("nui 4 binding resolution", () => {
  it("resolves an earlier typed declaration and reports a later declaration as forward", () => {
    const catalog = catalogFor(["nui 4", "const earlier: number = 1", "const later: number = 2"].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "earlier", { scopeId: "root", statementIndex: 2 }))
      .toMatchObject({ kind: "resolved", binding: { name: "earlier", kind: "typed" } });
    expect(resolveBindingReferenceForTests(catalog, "later", { scopeId: "root", statementIndex: 1 }))
      .toMatchObject({ kind: "forward" });
  });

  it("keeps the forGroup iteration slot in its lexical scope", () => {
    const catalog = catalogFor([
      "nui 4",
      "for i in range(from: 0, count: 2) {",
      "  const step: number = @i",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "i", { scopeId: "for:stable-1", statementIndex: 2 }))
      .toMatchObject({ kind: "resolved", binding: { kind: "iteration", name: "i" } });
  });
});

describe("nui 4 element-local binding resolution (elementLocalRangeIndex.ts, outside BindingCatalog)", () => {
  it("gives element-local precedence over iteration, and iteration precedence over a document typed binding of the same name", () => {
    const local: ElementLocalBinding = { id: "binding:local:point-1:i", name: "i", ownerId: "point-1", startOrder: 0, endOrder: Number.MAX_SAFE_INTEGER };
    const index = indexFor([local]);
    const catalog = catalogFor([
      "nui 4",
      "const i: number = 99",
      "for i in range(from: 0, count: 2) {",
      "  const body: number = 0",
      "}",
      "const after: number = 0"
    ].join("\n"));

    // Element-local wins when the site names its owning element.
    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "for:stable-2",
      statementIndex: 3,
      elementLocal: { ownerId: "point-1", order: 1 }
    }, undefined, index)).toMatchObject({ kind: "resolvedLocal", local: { id: local.id } });

    // Iteration wins over the outer document typed binding once inside the loop scope, absent an element-local match.
    expect(resolveBindingReferenceForTests(catalog, "i", { scopeId: "for:stable-2", statementIndex: 3 }, undefined, index))
      .toMatchObject({ kind: "resolved", binding: { kind: "iteration" } });

    // Outside the loop scope, with no element-local site, the document typed binding resolves.
    expect(resolveBindingReferenceForTests(catalog, "i", { scopeId: "root", statementIndex: 5 }, undefined, index))
      .toMatchObject({ kind: "resolved", binding: { kind: "typed", name: "i" } });
  });

  it("returns an element-local duplicate without falling back to document or iteration bindings", () => {
    const locals: ElementLocalBinding[] = [
      { id: "binding:local:point-1:i-1", name: "i", ownerId: "point-1", startOrder: 0, endOrder: Number.MAX_SAFE_INTEGER },
      { id: "binding:local:point-1:i-2", name: "i", ownerId: "point-1", startOrder: 0, endOrder: Number.MAX_SAFE_INTEGER }
    ];
    const index = indexFor(locals);
    const catalog = catalogFor([
      "nui 4",
      "const i: number = 99",
      "for i in range(from: 0, count: 2) {",
      "  const body: number = 0",
      "}"
    ].join("\n"));

    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "for:stable-2",
      statementIndex: 3,
      elementLocal: { ownerId: "point-1", order: 1 }
    }, undefined, index)).toEqual({
      kind: "duplicate",
      name: "i",
      scopeId: "for:stable-2",
      statementIndex: 3,
      bindingIds: locals.map((local) => local.id)
    });
  });

  it("uses only the site owner's element-local candidates", () => {
    const pointOne: ElementLocalBinding = { id: "binding:local:point-1:i", name: "i", ownerId: "point-1", startOrder: 0, endOrder: Number.MAX_SAFE_INTEGER };
    const pointTwo: ElementLocalBinding = { id: "binding:local:point-2:i", name: "i", ownerId: "point-2", startOrder: 0, endOrder: Number.MAX_SAFE_INTEGER };
    const index = indexFor([pointOne, pointTwo]);
    const catalog = catalogFor(["nui 4", "const document: number = 0"].join("\n"));

    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "root",
      statementIndex: 2,
      elementLocal: { ownerId: "point-1", order: 1 }
    }, undefined, index)).toMatchObject({ kind: "resolvedLocal", local: { id: pointOne.id } });
    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "root",
      statementIndex: 2,
      elementLocal: { ownerId: "point-2", order: 1 }
    }, undefined, index)).toMatchObject({ kind: "resolvedLocal", local: { id: pointTwo.id } });
  });

  it("joins non-overlapping element-local ranges without inspecting invisible locals per request", () => {
    const count = 64;
    const source = ["nui 4", ...Array.from({ length: count }, (_, index) => `const Use${index}: number = @x`)].join("\n");
    const locals: ElementLocalBinding[] = Array.from({ length: count }, (_, index) => ({
      id: `,binding:,local:,owner:,x:${index}`,
      name: "x",
      ownerId: "owner",
      startOrder: index,
      endOrder: index
    }));
    const index = indexFor(locals);
    const catalog = catalogFor(source);
    const requests = catalog.bindings
      .filter((binding) => binding.kind === "typed")
      .map((binding, order) => ({
        fromBindingId: binding.id,
        occurrenceIndex: 0,
        name: "x",
        site: { scopeId: "root", statementIndex: binding.statementIndex, elementLocal: { ownerId: "owner", order } }
      }));

    const { references, trace } = resolveInitializerReferencesWithTraceForTests(catalog, requests, index);
    expect(references.map((reference) =>
      reference.resolution.kind === "resolvedLocal" ? reference.resolution.local.id : reference.resolution.kind
    )).toEqual(locals.map((local) => local.id));
    expect(trace.candidateInspectionCount).toBe(count);
    expect(trace.candidateVisitsByVisibilityKind.get("elementLocal")).toBe(count);
    expect(trace.emittedCandidateCount).toBe(count);
  });

  it("fails fast on element-local range && site orders outside the safe-integer contract", () => {
    const invalidLocal: ElementLocalBinding = { id: "binding:local:owner:x", name: "x", ownerId: "owner", startOrder: 0.5, endOrder: 1 };
    expect(() => indexFor([invalidLocal])).toThrow(/non-negative safe integer/);

    const validLocal: ElementLocalBinding = { ...invalidLocal, startOrder: 0 };
    const index = indexFor([validLocal]);
    const catalog = catalogFor(["nui 4", "const use: number = @x"].join("\n"));
    expect(() => resolveInitializerReferences(catalog, [{
      fromBindingId: "binding:stable-1",
      occurrenceIndex: 0,
      name: "x",
      site: { scopeId: "root", statementIndex: 1, elementLocal: { ownerId: "owner", order: Number.MAX_SAFE_INTEGER + 1 } }
    }], index)).toThrow(/non-negative safe integer/);
  });
});
