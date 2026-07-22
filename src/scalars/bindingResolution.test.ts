import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { variableIsInScope } from "../geometry/variableScope";
import type { CadElement, VariableElement } from "../types/geometry";
import { buildBindingCatalog, type BindingSeed } from "./bindingCatalog";
import { buildLexicalScopeIndex } from "./lexicalScopeIndex";
import {
  resolveBindingReferenceForTests,
  resolveInitializerReferences,
  resolveInitializerReferencesWithTraceForTests,
  visibleBindingsAt,
  visibleBindingsAtWithTraceForTests
} from "./bindingResolution";

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
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 3 });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const reconciledContainers = { elements: compiled.elements, elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map() };
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex: stableIds, reconciledContainers });
  return {
    catalog: buildBindingCatalog({
      scopeIndex,
      stableStatementIdByIndex: stableIds,
      legacyBindings: adapter.legacyBindings,
      iterationBindings: adapter.iterationBindings,
      elementLocalBindings,
      containerIndex: adapter.containerIndex
    }),
    statements,
    scopeIndex,
    elements: compiled.elements
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
    ["typed/legacy", ["const x: number = 1", "var x = 2", "const use: number = @x"].join("\n")],
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

  it("does not expose a legacy binding before its declaration statement", () => {
    const { catalog } = catalogFor(["const before: number = 0", "var legacy = 1"].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "legacy", { scopeId: "root", statementIndex: 0 }))
      .toMatchObject({ kind: "undefined" });
  });

  it("activates global and outside-groups legacy lanes only after their root declaration", () => {
    const { catalog } = catalogFor([
      "const beforeGlobal: number = @GlobalLater",
      "var GlobalLater = expression(value: 1 scope: global)",
      "const afterGlobal: number = @GlobalLater",
      "const beforeOutside: number = @OutsideLater",
      "var OutsideLater = expression(value: 2 scope: group)",
      "const afterOutside: number = @OutsideLater"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "GlobalLater", { scopeId: "root", statementIndex: 0 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "GlobalLater", { scopeId: "root", statementIndex: 2 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-1" } });
    expect(resolveBindingReferenceForTests(catalog, "OutsideLater", { scopeId: "root", statementIndex: 3 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "OutsideLater", { scopeId: "root", statementIndex: 5 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-4" } });
  });

  it("activates a group-scoped legacy lane inside an already-entered group", () => {
    const { catalog } = catalogFor([
      "group G (id: g) {",
      "  const before: number = @GroupLater",
      "  var GroupLater = expression(value: 1 scope: group)",
      "  const after: number = @GroupLater",
      "}"
    ].join("\n"));
    const scopeId = "group:stable-0";
    expect(resolveBindingReferenceForTests(catalog, "GroupLater", { scopeId, statementIndex: 1 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "GroupLater", { scopeId, statementIndex: 3 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-2" } });
    expect(visibleBindingsAt(catalog, { scopeId, statementIndex: 1 }).some((binding) => binding.name === "GroupLater")).toBe(false);
    expect(visibleBindingsAt(catalog, { scopeId, statementIndex: 3 }).find((binding) => binding.name === "GroupLater")?.id).toBe("binding:stable-2");
  });

  it("persists a conditional container lane from then into the later else branch", () => {
    const { catalog } = catalogFor([
      "if Branch (1 id: conditional) {",
      "  const before: number = @Shared",
      "  var Shared = expression(value: 1 scope: group)",
      "  const afterThen: number = @Shared",
      "} else {",
      "  const afterElse: number = @Shared",
      "}",
      "const outside: number = @Shared"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "Shared", { scopeId: "if:stable-0:then", statementIndex: 1 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "Shared", { scopeId: "if:stable-0:then", statementIndex: 3 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-2" } });
    expect(resolveBindingReferenceForTests(catalog, "Shared", { scopeId: "if:stable-0:else", statementIndex: 5 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-2" } });
    expect(resolveBindingReferenceForTests(catalog, "Shared", { scopeId: "root", statementIndex: 7 })).toMatchObject({ kind: "undefined" });
  });

  it("keeps for-body group scope inside its reconciled forGroup container", () => {
    const { catalog } = catalogFor([
      "for Loop (i from: 0 count: 2 id: loop) {",
      "  const before: number = @LoopLocal",
      "  var LoopLocal = expression(value: 1 scope: group)",
      "  const after: number = @LoopLocal",
      "}",
      "const outside: number = @LoopLocal"
    ].join("\n"));
    const scopeId = "for:stable-0";
    expect(resolveBindingReferenceForTests(catalog, "LoopLocal", { scopeId, statementIndex: 1 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "LoopLocal", { scopeId, statementIndex: 3 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-2" } });
    expect(resolveBindingReferenceForTests(catalog, "LoopLocal", { scopeId: "root", statementIndex: 5 })).toMatchObject({ kind: "undefined" });
  });

  it("uses an explicit reconciled parent as the group-scoped legacy owner", () => {
    const { catalog } = catalogFor([
      "var ParentLocal = expression(value: 1 scope: group parent: target)",
      "const outside: number = @ParentLocal",
      "group Target (id: target) {",
      "  const inside: number = @ParentLocal",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "ParentLocal", { scopeId: "root", statementIndex: 1 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "ParentLocal", { scopeId: "group:stable-2", statementIndex: 3 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
  });

  it("does not use a later legacy declaration as forward or to suppress self and outer fallback", () => {
    const self = catalogFor(["const x: number = @x", "var x = 1"].join("\n"));
    expect(resolveInitializerReferences(self.catalog, [{
      fromBindingId: "binding:stable-0",
      occurrenceIndex: 0,
      name: "x",
      site: { scopeId: "root", statementIndex: 0 }
    }])[0].resolution).toMatchObject({ kind: "self", bindingId: "binding:stable-0" });

    const undefinedLater = catalogFor(["const use: number = @later", "var later = 1"].join("\n"));
    expect(resolveInitializerReferences(undefinedLater.catalog, [{
      fromBindingId: "binding:stable-0",
      occurrenceIndex: 0,
      name: "later",
      site: { scopeId: "root", statementIndex: 0 }
    }])[0].resolution).toMatchObject({ kind: "undefined" });

    const outer = catalogFor([
      "const x: number = 1",
      "group G {",
      "  const x: number = @x",
      "  var x = expression(value: 2 scope: group)",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(outer.catalog, "x", { scopeId: "group:stable-1", statementIndex: 2 }, "binding:stable-2"))
      .toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
  });

  it("matches legacy group visibility for descendants but not sibling groups", () => {
    const { catalog } = catalogFor([
      "group Outer (id: outer) {",
      "  var scoped = expression(value: 1 scope: group)",
      "  group Inner (id: inner) {",
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

  it("returns every same-name global lane candidate as a duplicate", () => {
    const { catalog } = catalogFor([
      "var x = expression(value: 1 id: global-x-1 scope: global)",
      "var x = expression(value: 2 id: global-x-2 scope: global)",
      "const use: number = @x"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 2 }))
      .toMatchObject({ kind: "duplicate", bindingIds: ["binding:stable-0", "binding:stable-1"] });
  });

  it("returns every same-name outside-groups lane candidate at a root site", () => {
    const { catalog } = catalogFor([
      "var x = expression(value: 1 id: outside-x-1 scope: group)",
      "var x = expression(value: 2 id: outside-x-2 scope: group)",
      "const use: number = @x"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 2 }))
      .toMatchObject({ kind: "duplicate", bindingIds: ["binding:stable-0", "binding:stable-1"] });
  });

  it("keeps outside-groups bindings out of group and nested-group lookup lanes", () => {
    const { catalog } = catalogFor([
      "var x = expression(value: 1 scope: group)",
      "group Outer (id: outer) {",
      "  const inOuter: number = @x",
      "  group Inner (id: inner) {",
      "    const inInner: number = @x",
      "  }",
      "}",
      "const atRoot: number = @x"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(catalog, "x", { scopeId: "group:stable-1", statementIndex: 2 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "x", { scopeId: "group:stable-3", statementIndex: 4 })).toMatchObject({ kind: "undefined" });
    expect(resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 7 })).toMatchObject({ kind: "resolved", binding: { id: "binding:stable-0" } });
  });

  it("matches compact legacy lanes to variableIsInScope across root, group, nested, and sibling sites", () => {
    const { catalog } = catalogFor([
      "var Outside = expression(value: 1 id: outside scope: group)",
      "var Global = expression(value: 1 id: global scope: global)",
      "group Outer (id: outer) {",
      "  var Scoped = expression(value: 1 id: scoped scope: group)",
      "  group Inner (id: inner) {",
      "    const nested: number = @Global",
      "  }",
      "}",
      "group Sibling (id: sibling) {",
      "  const sibling: number = @Global",
      "}"
    ].join("\n"));
    const elementsById = new Map<string, CadElement>([
      ["outer", { id: "outer", name: "outer", type: "group", visible: true, enabled: true } as CadElement],
      ["inner", { id: "inner", name: "inner", type: "group", visible: true, enabled: true, parentGroupId: "outer" } as CadElement],
      ["sibling", { id: "sibling", name: "sibling", type: "group", visible: true, enabled: true } as CadElement]
    ]);
    const visibility = (name: string, scopeId: string, statementIndex: number) =>
      resolveBindingReferenceForTests(catalog, name, { scopeId, statementIndex }).kind === "resolved";
    const legacyVisible = (scope: VariableElement["scope"], parentGroupId: string | undefined, consumerParentGroupId: string | undefined) =>
      variableIsInScope({ variable: { scope, parentGroupId }, consumer: { parentGroupId: consumerParentGroupId }, elementsById });

    expect(visibility("Outside", "root", 1)).toBe(legacyVisible("group", undefined, undefined));
    expect(visibility("Outside", "group:stable-2", 3)).toBe(legacyVisible("group", undefined, "outer"));
    expect(visibility("Outside", "group:stable-4", 5)).toBe(legacyVisible("group", undefined, "inner"));
    expect(visibility("Global", "root", 2)).toBe(legacyVisible("global", undefined, undefined));
    expect(visibility("Global", "group:stable-2", 3)).toBe(legacyVisible("global", undefined, "outer"));
    expect(visibility("Global", "group:stable-4", 5)).toBe(legacyVisible("global", undefined, "inner"));
    expect(visibility("Scoped", "group:stable-2", 4)).toBe(legacyVisible("group", "outer", "outer"));
    expect(visibility("Scoped", "group:stable-4", 5)).toBe(legacyVisible("group", "outer", "inner"));
    expect(visibility("Scoped", "group:stable-8", 9)).toBe(legacyVisible("group", "outer", "sibling"));
  });

  it("matches variableIsInScope for conditional, forGroup, and explicit-parent containers", () => {
    const prepared = catalogFor([
      "if Branch (1 id: conditional) {",
      "  var ConditionalLocal = expression(value: 1 scope: group)",
      "  const thenUse: number = @ConditionalLocal",
      "} else {",
      "  const elseUse: number = @ConditionalLocal",
      "}",
      "const conditionalOutside: number = @ConditionalLocal",
      "for Loop (i from: 0 count: 2 id: loop) {",
      "  var LoopLocal = expression(value: 1 scope: group)",
      "  const loopUse: number = @LoopLocal",
      "}",
      "const loopOutside: number = @LoopLocal",
      "var ParentLocal = expression(value: 1 scope: group parent: target)",
      "const parentOutside: number = @ParentLocal",
      "group Target (id: target) {",
      "  const parentInside: number = @ParentLocal",
      "}"
    ].join("\n"));
    const elementsById = new Map(prepared.elements.map((element) => [element.id, element]));
    const variableByName = new Map(prepared.elements
      .filter((element): element is VariableElement => element.type === "variable")
      .map((variable) => [variable.name, variable]));
    const parity = (name: string, scopeId: string, statementIndex: number, consumerParentGroupId: string | undefined) => {
      const variable = variableByName.get(name)!;
      const resolverVisible = resolveBindingReferenceForTests(prepared.catalog, name, { scopeId, statementIndex }).kind === "resolved";
      const legacyVisible = variableIsInScope({ variable, consumer: { parentGroupId: consumerParentGroupId }, elementsById });
      expect(resolverVisible).toBe(legacyVisible);
    };
    parity("ConditionalLocal", "if:stable-0:then", 2, "conditional");
    parity("ConditionalLocal", "if:stable-0:else", 4, "conditional");
    parity("ConditionalLocal", "root", 6, undefined);
    parity("LoopLocal", "for:stable-7", 9, "loop");
    parity("LoopLocal", "root", 11, undefined);
    parity("ParentLocal", "root", 13, undefined);
    parity("ParentLocal", "group:stable-14", 15, "target");
  });

  it("merges same-namespace lanes in catalog order and stops before shadowed outer lanes", () => {
    const merged = catalogFor([
      "const x: number = 0",
      "var x = expression(value: 1 id: merged-x-1 scope: global)",
      "var x = expression(value: 2 id: merged-x-2 scope: global)",
      "const use: number = @x"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(merged.catalog, "x", { scopeId: "root", statementIndex: 3 }))
      .toMatchObject({ kind: "duplicate", bindingIds: ["binding:stable-0", "binding:stable-1", "binding:stable-2"] });

    const outerCount = 40;
    const source = [
      ...Array.from({ length: outerCount }, (_, index) => `var x = expression(value: ${index} id: outer-x-${index} scope: global)`),
      "group Inner {",
      "  const x: number = 1",
      "  const use: number = @x",
      "}"
    ].join("\n");
    const { catalog, scopeIndex } = catalogFor(source);
    const owner = catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "use")!;
    const result = resolveInitializerReferencesWithTraceForTests(catalog, [{
      fromBindingId: owner.id,
      occurrenceIndex: 0,
      name: "x",
      site: { scopeId: scopeIndex.scopeOfStatement.get(owner.statementIndex)!, statementIndex: owner.statementIndex }
    }]);
    expect(result.references[0].resolution).toMatchObject({ kind: "resolved", binding: { id: `binding:stable-${outerCount + 1}` } });
    expect(result.trace.candidateVisitsByVisibilityKind.get("global") ?? 0).toBe(0);
    expect(result.trace.emittedCandidateCount).toBe(1);
  });

  it("returns same-lane group-subtree and iteration candidates as duplicates", () => {
    const group = catalogFor([
      "group Outer {",
      "  var x = expression(value: 1 id: group-x-1 scope: group)",
      "  var x = expression(value: 2 id: group-x-2 scope: group)",
      "  const use: number = @x",
      "}"
    ].join("\n"));
    expect(resolveBindingReferenceForTests(group.catalog, "x", { scopeId: "group:stable-0", statementIndex: 3 }))
      .toMatchObject({ kind: "duplicate", bindingIds: ["binding:stable-1", "binding:stable-2"] });

    const statements = parsedStatements(["group Outer {", "  const use: number = @i", "}"].join("\n"));
    const stableIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
    const scopeIndex = buildLexicalScopeIndex(statements, (index) => stableIds.get(index)!);
    const iterationScopeId = "group:stable-0";
    const iterations: BindingSeed[] = [0, 1].map((sourceOrder) => ({
      id: `binding:iteration:synthetic-${sourceOrder}`,
      kind: "iteration",
      name: "i",
      nameSpan: null,
      statementIndex: 0,
      sourceOrder,
      effectiveScopeId: iterationScopeId,
      visibility: { kind: "iteration", rootScopeId: iterationScopeId }
    }));
    const catalog = buildBindingCatalog({ scopeIndex, stableStatementIdByIndex: stableIds, iterationBindings: iterations });
    expect(resolveBindingReferenceForTests(catalog, "i", { scopeId: iterationScopeId, statementIndex: 1 }))
      .toMatchObject({ kind: "duplicate", bindingIds: iterations.map((binding) => binding.id) });
  });

  it("never visits root outside-groups candidates from group requests", () => {
    const bindingCount = 40;
    const referencesPerGroup = 6;
    const groupCount = 3;
    const source = [
      ...Array.from({ length: bindingCount }, (_, index) => `var outside = expression(value: ${index} id: outside-${index} scope: group)`),
      ...Array.from({ length: groupCount }, (_, groupIndex) => [
        `group G${groupIndex} {`,
        ...Array.from({ length: referencesPerGroup }, (_, referenceIndex) => `  const Use${groupIndex}_${referenceIndex}: number = @outside`),
        "}"
      ].join("\n"))
    ].join("\n");
    const { catalog, scopeIndex } = catalogFor(source);
    const requests = catalog.bindings
      .filter((binding) => binding.kind === "typed" && binding.name.startsWith("Use"))
      .map((binding) => ({
        fromBindingId: binding.id,
        occurrenceIndex: 0,
        name: "outside",
        site: { scopeId: scopeIndex.scopeOfStatement.get(binding.statementIndex)!, statementIndex: binding.statementIndex }
      }));
    const { references, trace } = resolveInitializerReferencesWithTraceForTests(catalog, requests);
    expect(references.every((reference) => reference.resolution.kind === "undefined")).toBe(true);
    expect(trace.candidateVisitsByVisibilityKind.get("outsideGroups") ?? 0).toBe(0);
    expect(trace.registeredBindingCount).toBe(catalog.bindings.length);
    expect(trace.requestCount).toBe(requests.length);
    expect(trace.emittedCandidateCount).toBe(0);
  });

  it("does not inspect inactive future legacy candidates per reference", () => {
    const source = [
      "const use: number = @later",
      ...Array.from({ length: 100 }, (_, index) => `var later = expression(value: ${index} id: later-${index} scope: global)`)
    ].join("\n");
    const { catalog } = catalogFor(source);
    const { references, trace } = resolveInitializerReferencesWithTraceForTests(catalog, [{
      fromBindingId: "binding:stable-0",
      occurrenceIndex: 0,
      name: "later",
      site: { scopeId: "root", statementIndex: 0 }
    }]);
    expect(references[0].resolution).toMatchObject({ kind: "undefined" });
    expect(trace.candidateVisitsByVisibilityKind.get("global") ?? 0).toBe(0);
    expect(trace.candidateInspectionCount).toBe(0);
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

  it("joins non-overlapping element-local ranges without inspecting invisible locals per request", () => {
    const count = 64;
    const source = Array.from({ length: count }, (_, index) => `const Use${index}: number = @x`).join("\n");
    const locals: BindingSeed[] = Array.from({ length: count }, (_, index) => ({
      id: `binding:local:owner:x:${index}`,
      kind: "elementLocal",
      name: "x",
      nameSpan: null,
      statementIndex: 0,
      sourceOrder: index,
      effectiveScopeId: "root",
      visibility: { kind: "elementLocal", ownerId: "owner", startOrder: index, endOrder: index }
    }));
    const { catalog } = catalogFor(source, locals);
    const requests = catalog.bindings
      .filter((binding) => binding.kind === "typed")
      .map((binding, order) => ({
        fromBindingId: binding.id,
        occurrenceIndex: 0,
        name: "x",
        site: { scopeId: "root", statementIndex: binding.statementIndex, elementLocal: { ownerId: "owner", order } }
      }));

    const { references, trace } = resolveInitializerReferencesWithTraceForTests(catalog, requests);
    expect(references.map((reference) =>
      reference.resolution.kind === "resolved" ? reference.resolution.binding.id : reference.resolution.kind
    )).toEqual(locals.map((local) => local.id));
    expect(trace.candidateInspectionCount).toBe(count);
    expect(trace.candidateVisitsByVisibilityKind.get("elementLocal")).toBe(count);
    expect(trace.emittedCandidateCount).toBe(count);
  });

  it("fails fast on element-local range and site orders outside the safe-integer contract", () => {
    const invalidLocal: BindingSeed = {
      id: "binding:local:owner:x",
      kind: "elementLocal",
      name: "x",
      nameSpan: null,
      statementIndex: 0,
      sourceOrder: 0,
      effectiveScopeId: "root",
      visibility: { kind: "elementLocal", ownerId: "owner", startOrder: 0.5, endOrder: 1 }
    };
    expect(() => catalogFor("const use: number = @x", [invalidLocal])).toThrow(/non-negative safe integer/);

    const validLocal = {
      ...invalidLocal,
      visibility: { kind: "elementLocal" as const, ownerId: "owner", startOrder: 0, endOrder: 1 }
    };
    const { catalog } = catalogFor("const use: number = @x", [validLocal]);
    expect(() => resolveInitializerReferences(catalog, [{
      fromBindingId: "binding:stable-0",
      occurrenceIndex: 0,
      name: "x",
      site: { scopeId: "root", statementIndex: 0, elementLocal: { ownerId: "owner", order: Number.MAX_SAFE_INTEGER + 1 } }
    }])).toThrow(/non-negative safe integer/);
  });

  it("returns bulk visibility in catalog order with the same shadow, duplicate, and local precedence as resolution", () => {
    const locals: BindingSeed[] = [
      {
        id: "binding:local:owner:global",
        kind: "elementLocal",
        name: "global",
        nameSpan: null,
        statementIndex: 0,
        sourceOrder: 0,
        effectiveScopeId: "root",
        visibility: { kind: "elementLocal", ownerId: "owner", startOrder: 0, endOrder: 2 }
      },
      {
        id: "binding:local:other:global",
        kind: "elementLocal",
        name: "global",
        nameSpan: null,
        statementIndex: 0,
        sourceOrder: 1,
        effectiveScopeId: "root",
        visibility: { kind: "elementLocal", ownerId: "other", startOrder: 0, endOrder: 2 }
      }
    ];
    const { catalog } = catalogFor([
      "const root: number = 1",
      "var global = expression(value: 2 scope: global)",
      "var outside = expression(value: 3 scope: group)",
      "var duplicate = expression(value: 4 id: duplicate-1 scope: global)",
      "var duplicate = expression(value: 5 id: duplicate-2 scope: global)",
      "group Outer {",
      "  var scoped = expression(value: 6 scope: group)",
      "  const root: number = 7",
      "  group Inner {",
      "    const use: number = @root",
      "  }",
      "}"
    ].join("\n"), locals);
    const use = catalog.bindings.find((binding) => binding.name === "use")!;
    const site = {
      scopeId: "group:stable-8",
      statementIndex: use.statementIndex,
      elementLocal: { ownerId: "owner", order: 1 }
    };
    const expectedIds = new Set<string>();
    const checkedNames = new Set<string>();
    for (const binding of catalog.bindings) {
      if (checkedNames.has(binding.name)) continue;
      checkedNames.add(binding.name);
      const resolution = resolveBindingReferenceForTests(catalog, binding.name, site);
      if (resolution.kind === "resolved") expectedIds.add(resolution.binding.id);
    }
    const expected = catalog.bindings.filter((binding) => expectedIds.has(binding.id));
    const actual = visibleBindingsAt(catalog, site);

    expect(actual).toEqual(expected);
    expect(actual.find((binding) => binding.name === "global")?.id).toBe("binding:local:owner:global");
    expect(actual.some((binding) => binding.name === "outside")).toBe(false);
    expect(actual.some((binding) => binding.name === "duplicate")).toBe(false);
    expect(actual.find((binding) => binding.name === "root")?.id).toBe("binding:stable-7");
  });

  it.each([250, 1_000])("traverses a bulk visibility site once for %i names", (count) => {
    const { catalog } = catalogFor(Array.from({ length: count }, (_, index) => `const V${index}: number = ${index}`).join("\n"));
    const { bindings, trace } = visibleBindingsAtWithTraceForTests(catalog, { scopeId: "root", statementIndex: count - 1 });
    expect(bindings).toHaveLength(count - 1);
    expect(trace.siteTraversalCount).toBe(1);
    expect(trace.requestCount).toBe(1);
    expect(trace.candidateInspectionCount).toBe(count - 1);
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

  it("does not treat a later declaration in an ancestor scope as a forward candidate", () => {
    const { catalog } = catalogFor([
      "group G {",
      "  const use: number = @x",
      "}",
      "const x: number = 1"
    ].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-1", occurrenceIndex: 0, name: "x", site: { scopeId: "group:stable-0", statementIndex: 1 } }
    ]);
    expect(resolved.resolution).toEqual({ kind: "undefined", name: "x", scopeId: "group:stable-0", statementIndex: 1 });
  });

  it("still returns later declarations from the exact same nested scope as forward candidates", () => {
    const { catalog } = catalogFor([
      "group G {",
      "  const use: number = @x",
      "  const x: number = 1",
      "  const x: number = 2",
      "}"
    ].join("\n"));
    const [resolved] = resolveInitializerReferences(catalog, [
      { fromBindingId: "binding:stable-1", occurrenceIndex: 0, name: "x", site: { scopeId: "group:stable-0", statementIndex: 1 } }
    ]);
    expect(resolved.resolution).toMatchObject({ kind: "forward", bindingIds: ["binding:stable-2", "binding:stable-3"] });
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
