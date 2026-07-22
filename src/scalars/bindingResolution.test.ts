import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { buildBindingCatalog, type BindingSeed } from "./bindingCatalog";
import { buildLexicalScopeIndex } from "./lexicalScopeIndex";
import { resolveBindingReferenceForTests, resolveInitializerReferences, visibleBindingsAt } from "./bindingResolution";

const parsedStatements = (source: string): readonly DslStatement[] => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return parsed.statements;
};

const catalogFor = (source: string, elementLocalBindings: readonly BindingSeed[] = []) => {
  const statements = parsedStatements(source);
  // Test-only injected identities. Production callers must use reconciliation
  // identities; the catalog never creates these from statement positions.
  const stableIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
  const scopeIndex = buildLexicalScopeIndex(statements, (index) => stableIds.get(index)!);
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex: stableIds });
  return {
    catalog: buildBindingCatalog({
      scopeIndex,
      stableStatementIdByIndex: stableIds,
      legacyBindings: adapter.legacyBindings,
      iterationBindings: adapter.iterationBindings,
      elementLocalBindings
    }),
    statements,
    scopeIndex
  };
};

describe("binding name resolution", () => {
  it("normalizes shuffled initializer requests by binding rank and keeps earlier same-scope candidates in self initialization", () => {
    const { catalog } = catalogFor([
      "const x: number = 1",
      "const x: number = @x",
      "const later: number = @missing"
    ].join("\n"));
    const requests = [
      { fromBindingId: "binding:stable-2", occurrenceIndex: 0, name: "missing", site: { scopeId: "root", statementIndex: 2 } },
      { fromBindingId: "binding:stable-1", occurrenceIndex: 0, name: "x", site: { scopeId: "root", statementIndex: 1 } }
    ];
    const resolved = resolveInitializerReferences(catalog, requests);
    expect(resolved.map((item) => item.fromBindingId)).toEqual(["binding:stable-1", "binding:stable-2"]);
    expect(resolved[0].resolution).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
    expect(() => resolveInitializerReferences(catalog, [{ ...requests[0], fromBindingId: "binding:missing" }])).toThrow(/unknown typed binding/);
    expect(() => resolveInitializerReferences(catalog, [{ ...requests[0], occurrenceIndex: 1 }])).toThrow(/sparse occurrenceIndex/);
  });

  it("resolves before an inner declaration to the visible outer binding", () => {
    const { catalog, scopeIndex } = catalogFor([
      "const x: number = 1",
      "group G {",
      "  const before: number = 0",
      "  const x: number = 2",
      "}"
    ].join("\n"));
    const result = resolveBindingReferenceForTests(catalog, "x", { scopeId: "group:stable-1", statementIndex: 2 });
    expect(result).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
    expect(scopeIndex.scopes.has("group:stable-1")).toBe(true);
  });

  it("shadows the outer binding after the inner declaration, and returns forward only when no outer exists", () => {
    const withOuter = catalogFor([
      "const x: number = 1",
      "group G {",
      "  const before: number = 0",
      "  const x: number = 2",
      "  const after: number = @x",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(withOuter.catalog, "x", { scopeId: "group:stable-1", statementIndex: 4 }))
      .toMatchObject({ kind: "resolved", binding: { id: "binding:stable-3" } });

    const withoutOuter = catalogFor([
      "group G {",
      "  const before: number = 0",
      "  const x: number = 2",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(withoutOuter.catalog, "x", { scopeId: "group:stable-0", statementIndex: 1 }))
      .toMatchObject({ kind: "forward", bindingIds: ["binding:stable-2"] });
  });

  it("resolves an inner initializer to its visible outer binding, otherwise to self", () => {
    const withOuter = catalogFor(["const x: number = 1", "group G {", "  const x: number = @x", "}"].join("\n"));
    expect(resolveBindingReferenceForTests(withOuter.catalog, "x", { scopeId: "group:stable-1", statementIndex: 2 }, "binding:stable-2"))
      .toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });

    const withoutOuter = catalogFor("const x: number = @x");
    expect(resolveBindingReferenceForTests(withoutOuter.catalog, "x", { scopeId: "root", statementIndex: 0 }, "binding:stable-0"))
      .toEqual({ kind: "self", name: "x", scopeId: "root", statementIndex: 0, bindingId: "binding:stable-0" });
  });

  it("does not leak a then declaration into its sibling else scope", () => {
    const { catalog } = catalogFor([
      "const x: number = 1",
      "if Branch (1) {",
      "  const x: number = 2",
      "} else {",
      "  const useElse: number = @x",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "x", { scopeId: "if:stable-1:else", statementIndex: 4 }))
      .toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
  });

  it.each([
    ["typed/typed", ["const x: number = 1", "let x: number = 2", "const use: number = @x"].join("\n")],
    ["typed/legacy", ["const x: number = 1", "var x = 2"].join("\n")],
    ["legacy/legacy", [
      "var x = expression(value: 1 id: legacy-x-1)",
      "var x = expression(value: 2 id: legacy-x-2)", "const use: number = @x"
    ].join("\n")]
  ])("returns duplicate for same-effective-scope %s collisions", (_label, source) => {
    const { catalog } = catalogFor(source);
    const result = resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 2 });
    expect(result.kind).toBe("duplicate");
    if (result.kind === "duplicate") expect(result.bindingIds).toHaveLength(2);
  });

  it("keeps legacy visibility separate from typed declaration order", () => {
    const { catalog } = catalogFor(["const before: number = 0", "var legacy = 1"].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "legacy", { scopeId: "root", statementIndex: 0 }))
      .toMatchObject({ kind: "resolved", binding: { kind: "legacy", id: "binding:stable-1" } });
  });

  it("matches legacy group visibility for descendants but not sibling groups", () => {
    const { catalog } = catalogFor([
      "group Outer {",
      "  var scoped = expression(value: 1 scope: group)",
      "  group Inner {",
      "    const inside: number = 0",
      "  }",
      "}",
      "group Other {",
      "  const outside: number = 0",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "scoped", { scopeId: "group:stable-2", statementIndex: 3 }))
      .toMatchObject({ kind: "resolved", binding: { kind: "legacy" } });
    expect(resolveBindingReferenceForTests(catalog, "scoped", { scopeId: "group:stable-6", statementIndex: 7 }))
      .toMatchObject({ kind: "undefined" });
  });

  it("gives adapter-scoped element locals precedence over iteration and document bindings", () => {
    const local: BindingSeed = {
      id: "binding:local:point-1:i",
      kind: "elementLocal",
      name: "i",
      nameSpan: null,
      statementIndex: 1,
      sourceOrder: 0,
      effectiveScopeId: "for:stable-1",
      visibility: { kind: "elementLocal", ownerId: "point-1", startOrder: 0, endOrder: 2 }
    };
    const { catalog } = catalogFor([
      "const i: number = 99",
      "for Loop (i from: 0 count: 2) {",
      "  const body: number = 0",
      "}"
    ].join("\n"), [local]);
    const result = resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "for:stable-1",
      statementIndex: 2,
      elementLocal: { ownerId: "point-1", order: 1 }
    });
    expect(result).toMatchObject({ kind: "resolved", binding: { id: local.id } });
    expect(visibleBindingsAt(catalog, { scopeId: "for:stable-1", statementIndex: 2, elementLocal: { ownerId: "point-1", order: 1 } })
      .find((binding) => binding.name === "i")?.id).toBe(local.id);
    expect(resolveBindingReferenceForTests(catalog, "i", { scopeId: "for:stable-1", statementIndex: 2 }))
      .toMatchObject({ kind: "resolved", binding: { id: "binding:iteration:stable-1" } });
  });

  it("returns an element-local duplicate without falling back to document or iteration bindings", () => {
    const locals: BindingSeed[] = [
      {
        id: "binding:local:point-1:i-1",
        kind: "elementLocal",
        name: "i",
        nameSpan: null,
        statementIndex: 1,
        sourceOrder: 0,
        effectiveScopeId: "for:stable-1",
        visibility: { kind: "elementLocal", ownerId: "point-1", startOrder: 0, endOrder: 2 }
      },
      {
        id: "binding:local:point-1:i-2",
        kind: "elementLocal",
        name: "i",
        nameSpan: null,
        statementIndex: 1,
        sourceOrder: 1,
        effectiveScopeId: "for:stable-1",
        visibility: { kind: "elementLocal", ownerId: "point-1", startOrder: 0, endOrder: 2 }
      }
    ];
    const { catalog } = catalogFor([
      "const i: number = 99",
      "for Loop (i from: 0 count: 2) {",
      "  const body: number = 0",
      "}"
    ].join("\n"), locals);

    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "for:stable-1",
      statementIndex: 2,
      elementLocal: { ownerId: "point-1", order: 1 }
    })).toEqual({
      kind: "duplicate",
      name: "i",
      scopeId: "for:stable-1",
      statementIndex: 2,
      bindingIds: locals.map((local) => local.id)
    });
  });

  it("uses only the site owner's element-local candidates", () => {
    const pointOne: BindingSeed = {
      id: "binding:local:point-1:i",
      kind: "elementLocal",
      name: "i",
      nameSpan: null,
      statementIndex: 0,
      sourceOrder: 0,
      effectiveScopeId: "root",
      visibility: { kind: "elementLocal", ownerId: "point-1", startOrder: 0, endOrder: 2 }
    };
    const pointTwo: BindingSeed = {
      ...pointOne,
      id: "binding:local:point-2:i",
      sourceOrder: 1,
      visibility: { kind: "elementLocal", ownerId: "point-2", startOrder: 0, endOrder: 2 }
    };
    const { catalog } = catalogFor("const document: number = 0", [pointOne, pointTwo]);

    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "root",
      statementIndex: 1,
      elementLocal: { ownerId: "point-1", order: 1 }
    })).toMatchObject({ kind: "resolved", binding: { id: pointOne.id } });
    expect(resolveBindingReferenceForTests(catalog, "i", {
      scopeId: "root",
      statementIndex: 1,
      elementLocal: { ownerId: "point-2", order: 1 }
    })).toMatchObject({ kind: "resolved", binding: { id: pointTwo.id } });
  });

  it("keeps a typed binding id when the caller preserves its injected stable identity across insertion", () => {
    const before = parsedStatements("const retained: number = 1");
    const after = parsedStatements(["const padding: number = 0", "const retained: number = 1"].join("\n"));
    const beforeIds = new Map([[0, "statement-retained"]]);
    const afterIds = new Map([[0, "statement-padding"], [1, "statement-retained"]]);
    const beforeIndex = buildLexicalScopeIndex(before, (index) => beforeIds.get(index)!);
    const afterIndex = buildLexicalScopeIndex(after, (index) => afterIds.get(index)!);
    const beforeCatalog = buildBindingCatalog({ scopeIndex: beforeIndex, stableStatementIdByIndex: beforeIds });
    const afterCatalog = buildBindingCatalog({ scopeIndex: afterIndex, stableStatementIdByIndex: afterIds });
    expect(beforeCatalog.bindingsById.has("binding:statement-retained")).toBe(true);
    expect(afterCatalog.bindingsById.has("binding:statement-retained")).toBe(true);
  });
});

describe("resolveInitializerReferences owner contract (batch API called directly)", () => {
  it("resolves a self-named initializer to self with no owner-carrying site field", () => {
    const { catalog } = catalogFor("const x: number = @x");
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-0", occurrenceIndex: 0, name: "x", site: { scopeId: "root", statementIndex: 0 } }
    ]);
    expect(resolved.resolution).toEqual({ kind: "self", name: "x", scopeId: "root", statementIndex: 0, bindingId: "binding:stable-0" });
  });

  it("resolves a self-named initializer to an earlier same-scope declaration", () => {
    const { catalog } = catalogFor(["const x: number = 1", "const x: number = @x"].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-1", occurrenceIndex: 0, name: "x", site: { scopeId: "root", statementIndex: 1 } }
    ]);
    expect(resolved.resolution).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
  });

  it("resolves a self-named initializer to duplicate when multiple earlier same-scope declarations exist", () => {
    const { catalog } = catalogFor(["const x: number = 1", "const x: number = 2", "const x: number = @x"].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-2", occurrenceIndex: 0, name: "x", site: { scopeId: "root", statementIndex: 2 } }
    ]);
    expect(resolved.resolution).toMatchObject({ kind: "duplicate", bindingIds: ["binding:stable-0", "binding:stable-1"] });
  });

  it("resolves a self-named initializer to a visible ancestor binding", () => {
    const { catalog } = catalogFor(["const x: number = 1", "group G {", "  const x: number = @x", "}"].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-2", occurrenceIndex: 0, name: "x", site: { scopeId: "group:stable-1", statementIndex: 2 } }
    ]);
    expect(resolved.resolution).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
  });

  it("keeps a self initializer as self even when a later same-scope declaration of the same name exists", () => {
    const { catalog } = catalogFor(["const x: number = @x", "const x: number = 2"].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-0", occurrenceIndex: 0, name: "x", site: { scopeId: "root", statementIndex: 0 } }
    ]);
    expect(resolved.resolution).toEqual({ kind: "self", name: "x", scopeId: "root", statementIndex: 0, bindingId: "binding:stable-0" });
  });

  it("fails fast when a request's site statementIndex disagrees with fromBindingId's own declaration", () => {
    const { catalog } = catalogFor(["const x: number = 1", "const y: number = @x"].join("\n"));
    expect(() => resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-1", occurrenceIndex: 0, name: "x", site: { scopeId: "root", statementIndex: 0 } }
    ])).toThrow(/does not match/);
  });

  it("returns multiple forward candidates in catalog rank order", () => {
    const { catalog } = catalogFor(["const a: number = @b", "const b: number = 1", "const b: number = 2"].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-0", occurrenceIndex: 0, name: "b", site: { scopeId: "root", statementIndex: 0 } }
    ]);
    expect(resolved.resolution).toMatchObject({ kind: "forward", bindingIds: ["binding:stable-1", "binding:stable-2"] });
  });

  it("keeps forward candidate order identical when the request batch is shuffled", () => {
    const { catalog } = catalogFor([
      "const a: number = @b",
      "const c: number = @b",
      "const b: number = 1",
      "const b: number = 2"
    ].join("\n"));
    const requestA = { fromBindingId: "binding:stable-0", occurrenceIndex: 0, name: "b", site: { scopeId: "root", statementIndex: 0 } };
    const requestC = { fromBindingId: "binding:stable-1", occurrenceIndex: 0, name: "b", site: { scopeId: "root", statementIndex: 1 } };
    const inOrder = resolveInitializerReferences(catalog, [requestA, requestC]);
    const shuffled = resolveInitializerReferences(catalog, [requestC, requestA]);
    expect(inOrder.map((item) => item.resolution)).toEqual(shuffled.map((item) => item.resolution));
    expect(inOrder[0].resolution).toMatchObject({ kind: "forward", bindingIds: ["binding:stable-2", "binding:stable-3"] });
  });
});
