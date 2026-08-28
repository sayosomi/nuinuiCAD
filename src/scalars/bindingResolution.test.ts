import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import { buildBindingCatalog } from "./bindingCatalog";
import { buildLexicalScopeIndex } from "./lexicalScopeIndex";
import {
  resolveBindingReferenceForTests
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

  it("accepts rooted source lookup but rejects a stale lookup during virtual rename", () => {
    const catalog = catalogFor(["nui 4", "const width: number = 50", "const later: number = 1"].join("\n"));
    const rootBinding = catalog.bindings.find((binding) =>
      binding.kind === "typed" && binding.name === "width" && binding.statementIndex === 1
    );
    expect(rootBinding).toBeDefined();
    if (!rootBinding) return;

    const sourceNamespaceBindingResolver = (name: string) =>
      name === "::width" ? { kind: "resolved" as const, bindingId: rootBinding.id } : null;
    const rootedCatalog = { ...catalog, sourceNamespaceBindingResolver };
    const site = { scopeId: "root", statementIndex: 2 };
    expect(resolveBindingReferenceForTests(rootedCatalog, "::width", site))
      .toMatchObject({ kind: "resolved", binding: { id: rootBinding.id, name: "width", kind: "typed" } });

    const renamedBinding = { ...rootBinding, name: "renamed" };
    const virtualBindings = rootedCatalog.bindings.map((binding) =>
      binding.id === rootBinding.id ? renamedBinding : binding
    );
    const virtualBindingsById = new Map(rootedCatalog.bindingsById);
    virtualBindingsById.set(rootBinding.id, renamedBinding);
    const virtualCatalog = {
      ...rootedCatalog,
      bindings: virtualBindings,
      bindingsById: virtualBindingsById
    };
    const staleResolution = resolveBindingReferenceForTests(virtualCatalog, "::width", site);
    expect(staleResolution.kind).not.toBe("resolved");
    expect(staleResolution).not.toMatchObject({ kind: "resolved", binding: { id: rootBinding.id, name: "renamed" } });
  });
});
