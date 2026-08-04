import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../src/dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../src/dsl/dslCompiler";
import { parseDsl } from "../src/dsl/dslParser";
import { buildLexicalScopeIndexFromStatements } from "../src/dsl/lexicalScopeIndexAdapter";
import { analyzeBindings, type InitializerReference } from "../src/scalars/bindingAnalysis";
import { buildBindingCatalog, type BindingId } from "../src/scalars/bindingCatalog";
import { resolveInitializerReferences, type BindingResolution } from "../src/scalars/bindingResolution";
import { parseScalarExpression } from "../src/scalars/expressionParser";
import { typecheckScalarExpression } from "../src/scalars/expressionTypecheck";
import { collectReferences } from "../src/scalars/typedDeclarationAnalysis";
import { PURE_NUI3_BINDING_SIZES, buildPureNui3BindingSource } from "./pureNui3BindingFixtures";

type Stage = "compiler" | "scope" | "adapter" | "catalog" | "resolver" | "analysis" | "typecheck";
type ParsedInitializer = {
  ast: NonNullable<ReturnType<typeof parseScalarExpression>["ast"]>;
  references: ReturnType<typeof collectReferences>;
};
type Profile = {
  stageSamples: Record<Stage, number[]>;
  calls: Record<Stage | "initializerParse" | "resolutionBucket" | "resolutionBucketItems", number>;
};

const [SMALL_SIZE, LARGE_SIZE] = PURE_NUI3_BINDING_SIZES;
const runProfile = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_BINDING_PROFILE === "1";
const describeProfile = runProfile ? describe : describe.skip;
const stages: readonly Stage[] = ["compiler", "scope", "adapter", "catalog", "resolver", "analysis", "typecheck"];

const median = (samples: readonly number[]) => {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const profileFor = (bindingCount: number): Profile => {
  const { source } = buildPureNui3BindingSource(bindingCount);
  const parsed = parseDsl(source);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("pure nui 3 binding profile fixture must parse without diagnostics");
  }
  const stableStatementIdByIndex = new Map(
    Array.from({ length: bindingCount }, (_, index) => [index + 1, `task50:profile:${index}`])
  );
  const profile: Profile = {
    stageSamples: Object.fromEntries(stages.map((stage) => [stage, []])) as Record<Stage, number[]>,
    calls: { compiler: 0, scope: 0, adapter: 0, catalog: 0, resolver: 0, analysis: 0, typecheck: 0, initializerParse: 0, resolutionBucket: 0, resolutionBucketItems: 0 }
  };
  const time = <T>(stage: Stage, run: () => T): T => {
    const started = performance.now();
    const value = run();
    profile.stageSamples[stage].push(performance.now() - started);
    profile.calls[stage] += 1;
    return value;
  };

  const runOnce = () => {
    const compiled = time("compiler", () => compileDslToElements(source, {
      elements: [],
      mode: "document",
      preparsed: parsed,
      assignedElementIds: stableStatementIdByIndex,
      majorVersion: 3
    }));
    const scopeIndex = time("scope", () => buildLexicalScopeIndexFromStatements(parsed.statements, stableStatementIdByIndex));
    const adapter = time("adapter", () => buildDslBindingAdapterSeeds({
      statements: parsed.statements,
      scopeIndex,
      stableStatementIdByIndex,
      reconciledContainers: {
        elements: compiled.elements,
        elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map()
      }
    }));
    const catalog = time("catalog", () => buildBindingCatalog({
      scopeIndex,
      stableStatementIdByIndex,
      iterationBindings: adapter.iterationBindings,
      containerIndex: adapter.containerIndex
    }));
    const parsedByBindingId = new Map<BindingId, ParsedInitializer>();
    for (const binding of catalog.bindings) {
      if (binding.kind !== "typed") continue;
      const statement = parsed.statements[binding.statementIndex];
      if (!statement || statement.kind !== "typedDeclaration") throw new Error("profile fixture lost a typed declaration");
      const initializerSpan = statement.payloadSpans.initializer;
      if (!initializerSpan) throw new Error("profile fixture lost an initializer span");
      const initializer = parseScalarExpression(" ".repeat(initializerSpan.start) + statement.initializer, initializerSpan);
      if (!initializer.ast) throw new Error("profile fixture initializer must parse");
      parsedByBindingId.set(binding.id, { ast: initializer.ast, references: collectReferences(initializer.ast) });
      profile.calls.initializerParse += 1;
    }
    const requests = catalog.bindings.flatMap((binding) => {
      if (binding.kind !== "typed") return [];
      const initializer = parsedByBindingId.get(binding.id)!;
      const scopeId = scopeIndex.scopeOfStatement.get(binding.statementIndex) ?? scopeIndex.rootScopeId;
      return initializer.references.map((reference, occurrenceIndex) => ({
        fromBindingId: binding.id,
        occurrenceIndex,
        name: reference.name,
        site: { scopeId, statementIndex: binding.statementIndex }
      }));
    });
    const resolved = time("resolver", () => resolveInitializerReferences(catalog, requests));
    const initializerReferences: InitializerReference[] = resolved.map((reference) => ({
      fromBindingId: reference.fromBindingId,
      occurrenceIndex: reference.occurrenceIndex,
      name: reference.name,
      span: parsedByBindingId.get(reference.fromBindingId)?.references[reference.occurrenceIndex]?.span ?? null,
      resolution: reference.resolution
    }));
    time("analysis", () => analyzeBindings({ catalog, initializerReferences }));
    time("typecheck", () => {
      const resolvedByBindingId = new Map<BindingId, BindingResolution[]>();
      profile.calls.resolutionBucket += 1;
      profile.calls.resolutionBucketItems += resolved.length;
      for (const reference of resolved) {
        const bucket = resolvedByBindingId.get(reference.fromBindingId);
        if (bucket) bucket.push(reference.resolution);
        else resolvedByBindingId.set(reference.fromBindingId, [reference.resolution]);
      }
      for (const binding of catalog.bindings) {
        if (binding.kind !== "typed") continue;
        const initializer = parsedByBindingId.get(binding.id)!;
        typecheckScalarExpression(initializer.ast, {
          expectedType: binding.declaredType,
          references: resolvedByBindingId.get(binding.id) ?? []
        });
      }
    });
  };

  for (let index = 0; index < 5; index += 1) runOnce();
  for (let index = 0; index < 11; index += 1) runOnce();
  return profile;
};

describeProfile("pure nui 3 binding analysis stage profile", () => {
  it("records stage medians and exact analysis call counts", () => {
    const small = profileFor(SMALL_SIZE);
    const large = profileFor(LARGE_SIZE);
    const stageMedians = (profile: Profile) => Object.fromEntries(
      stages.map((stage) => [stage, Number(median(profile.stageSamples[stage]).toFixed(3))])
    );
    console.log(`[Task50 binding-analysis profile] ${JSON.stringify({
      small: { stageMediansMs: stageMedians(small), calls: small.calls },
      large: { stageMediansMs: stageMedians(large), calls: large.calls }
    })}`);
    expect(small.calls.resolutionBucketItems).toBe(16 * (SMALL_SIZE - 1));
    expect(large.calls.resolutionBucketItems).toBe(16 * (LARGE_SIZE - 1));
  }, 150_000);
});
