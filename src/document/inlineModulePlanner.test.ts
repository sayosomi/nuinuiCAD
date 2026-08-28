import { describe, expect, it, vi } from "vitest";
import * as dslDocument from "../dsl/dslDocument";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createDslSemanticOccurrenceIndex, dslSemanticIdentityKey } from "../dsl/dslSemanticOccurrenceIndex";
import { applyLineSplices } from "./textPatch";
import {
  planInlineModule,
  type InlineModulePolicy,
  type InlineModuleTargetIdentity
} from "./inlineModulePlanner";

const REVISION = 167;
const DEFAULT_POLICY: InlineModulePolicy = {
  emitOmittedBranchComments: false,
  includeHiddenInstances: false,
  includeDisabledInstances: false
};

const compileCurrent = (source: string, prefix = "inline"): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`]));
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: REVISION,
    assignedElementIds: ids,
    assignedStatementIds: ids
  });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.bindingIssueDiagnostics?.filter((diagnostic) => diagnostic.severity === "error") ?? []).toEqual([]);
  expect(compiled.statementMap).not.toBeNull();
  expect(compiled.moduleSemanticAnalysis).toBeDefined();
  return compiled;
};

const targetFor = (compiled: CompiledDslDocument, name: string): InlineModuleTargetIdentity => {
  const index = compiled.statements.findIndex((statement) =>
    statement.kind === "moduleInstance" && statement.name === name
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(index);
  if (!statementId) throw new Error(`missing statement identity for ${name}`);
  return { documentKey: null, statementId };
};

const plan = (
  source: string,
  names: readonly string[],
  policy: Partial<InlineModulePolicy> = {}
) => {
  const compiled = compileCurrent(source);
  const result = planInlineModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    targets: names.map((name) => targetFor(compiled, name)),
    policy: { ...DEFAULT_POLICY, ...policy }
  });
  return { compiled, result };
};

describe("planInlineModule Checkpoint 1", () => {
  it("inlines a parameterless local instance as a same-named group and preserves source layout", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  /// Anchor documentation",
      "  // keep this body note",
      "",
      "  export point Anchor = coordinate(x: 0, y: 0)",
      "  point Other = offset(from: @Anchor, dx: 1, dy: 0)",
      "}",
      "instance Copy = Stamp() // keep instance note",
      "point User = offset(from: @Copy::Anchor, dx: 1, dy: 0)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.targets).toMatchObject([
      {
        status: "inlined",
        instanceName: "Copy",
        moduleDefinitionStatementId: "inline:1",
        activity: "visible",
        generatedGroupName: "Copy"
      }
    ]);
    expect(result.splices).toHaveLength(1);

    const next = applyLineSplices(source, result.splices);
    expect(next).toBe([
      "nui 4",
      "module Stamp() {",
      "  /// Anchor documentation",
      "  // keep this body note",
      "",
      "  export point Anchor = coordinate(x: 0, y: 0)",
      "  point Other = offset(from: @Anchor, dx: 1, dy: 0)",
      "}",
      "group Copy { // keep instance note",
      "  /// Anchor documentation",
      "  // keep this body note",
      "",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "  point Other = offset(from: @Anchor, dx: 1, dy: 0)",
      "}",
      "point User = offset(from: @Copy::Anchor, dx: 1, dy: 0)"
    ].join("\n"));
    expect(next.match(/export point Anchor/g)).toHaveLength(1);
  });

  it("skips hidden and disabled instances by default and preserves included activity", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Hidden(state: hidden) = Stamp()",
      "instance Disabled(state: disabled) = Stamp()"
    ].join("\n");

    const excluded = plan(source, ["Hidden", "Disabled"]).result;
    expect(excluded).toMatchObject({ status: "planned", splices: [] });
    if (excluded.status !== "planned") return;
    expect(excluded.targets.map((target) => target.status === "skipped" ? target.code : null)).toEqual([
      "hidden-excluded",
      "disabled-excluded"
    ]);

    const included = plan(source, ["Hidden", "Disabled"], {
      includeHiddenInstances: true,
      includeDisabledInstances: true
    }).result;
    expect(included.status).toBe("planned");
    if (included.status !== "planned") return;
    expect(included.splices).toHaveLength(2);
    const next = applyLineSplices(source, included.splices);
    expect(next).toContain("group Hidden(state: hidden) {");
    expect(next).toContain("group Disabled(state: disabled) {");
  });

  it("deduplicates targets and reports in deterministic authored order", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance First = Stamp()",
      "instance Second = Stamp()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const first = targetFor(compiled, "First");
    const second = targetFor(compiled, "Second");
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      targets: [second, first, second],
      policy: DEFAULT_POLICY
    });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.targets.map((target) => target.instanceName)).toEqual(["First", "Second"]);
    expect(result.splices.map((splice) => splice.startLine)).toEqual([5, 6]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("group First {");
    expect(next).toContain("group Second {");
  });

  it("rejects stale source snapshots before constructing a mutation", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Stamp()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planInlineModule({
      source: { normalizedSource: `${source}\n`, sourceRevision: REVISION + 1 },
      compiled,
      targets: [targetFor(compiled, "Copy")],
      policy: DEFAULT_POLICY
    });

    expect(result).toMatchObject({ status: "rejected", code: "stale-semantic-snapshot" });
    expect("splices" in result).toBe(false);
  });

  it("rejects a candidate compile failure without returning an applicable mutation", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Stamp()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const originalCompile = dslDocument.compileDslDocument;
    const compileSpy = vi.spyOn(dslDocument, "compileDslDocument").mockImplementationOnce((...args) => ({
      ...originalCompile(...args),
      diagnostics: [{ severity: "error", line: 1, column: 1, message: "forced candidate compile failure" }]
    }));

    try {
      const result = planInlineModule({
        source: { normalizedSource: source, sourceRevision: REVISION },
        compiled,
        targets: [targetFor(compiled, "Copy")],
        policy: DEFAULT_POLICY
      });

      expect(result).toMatchObject({ status: "rejected", code: "unsafe-rewrite" });
      expect("splices" in result).toBe(false);
    } finally {
      compileSpy.mockRestore();
    }
  });

  it("rejects invalid local authored identities and never guesses materialized or stale targets", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Stamp()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      targets: [{ documentKey: null, statementId: "materialized:Copy:P" }],
      policy: DEFAULT_POLICY
    });

    expect(result).toMatchObject({ status: "rejected", code: "invalid-target" });
    expect("splices" in result).toBe(false);
  });

  it("returns a structured skip for non-local document-qualified targets", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Stamp()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      targets: [{ documentKey: "library.nui", statementId: targetFor(compiled, "Copy").statementId }],
      policy: DEFAULT_POLICY
    });

    expect(result).toMatchObject({
      status: "planned",
      splices: [],
      targets: [{ status: "skipped", code: "non-local-target", statementIndex: null }]
    });
  });

  it("lowers required supplied scalar parameters in callee order and preserves authored types", () => {
    const source = [
      "nui 4",
      "module Scalars(width: number(max: 200, step: 5, min: 0), label: string, enabled: boolean, side: choice(right, left)) {",
      "  point P = coordinate(x: @width, y: 0)",
      "  const bodyLabel: string = @label",
      "  const bodyEnabled: boolean = @enabled",
      "  const bodySide: choice(right, left) = @side",
      "}",
      "instance Copy = Scalars(width: 10, label: \"front\", enabled: true, side: left)"
    ].join("\n");
    const planned = plan(source, ["Copy"]).result;
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    const nextSource = applyLineSplices(source, planned.splices);
    expect(nextSource).toContain("const width: number(max: 200, step: 5, min: 0) = 10");
    expect(nextSource).toContain("const label: string = \"front\"");
    expect(nextSource).toContain("const enabled: boolean = true");
    expect(nextSource).toContain("const side: choice(right, left) = left");
    const next = compileCurrent(nextSource, "inline-next");
    const groupIndex = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Copy");
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    const generated = next.statements.filter((statement) =>
      statement.kind === "typedDeclaration" && statement.enclosing?.statementIndex === groupIndex
    );
    expect(generated.slice(0, 4).map((statement) => statement.name)).toEqual([
      "width",
      "label",
      "enabled",
      "side"
    ]);
    const afterIndex = createDslSemanticOccurrenceIndex(next);
    for (const [bodyName, parameterName] of [["bodyLabel", "label"], ["bodyEnabled", "enabled"], ["bodySide", "side"]] as const) {
      const bodyIndex = next.statements.findIndex((statement) =>
        statement.name === bodyName && statement.enclosing?.statementIndex === groupIndex
      );
      const parameterIndex = generated.findIndex((statement) => statement.name === parameterName);
      expect(bodyIndex).toBeGreaterThanOrEqual(0);
      expect(parameterIndex).toBeGreaterThanOrEqual(0);
      const parameterStatement = generated[parameterIndex]!;
      const parameterDeclaration = afterIndex.occurrences.find((occurrence) =>
        occurrence.kind === "declaration" &&
        occurrence.from >= parameterStatement.documentRange.from &&
        occurrence.to <= parameterStatement.documentRange.to &&
        nextSource.slice(occurrence.from, occurrence.to) === parameterName
      );
      const bodyStatement = next.statements[bodyIndex]!;
      const bodyReferences = afterIndex.occurrences.filter((occurrence) =>
        occurrence.kind === "reference" &&
        occurrence.from >= bodyStatement.documentRange.from &&
        occurrence.to <= bodyStatement.documentRange.to &&
        nextSource.slice(occurrence.from, occurrence.to) === parameterName
      );
      expect(parameterDeclaration).toBeDefined();
      expect(bodyReferences.length).toBeGreaterThan(0);
      if (parameterDeclaration && bodyReferences.length > 0) {
        expect(bodyReferences.some((reference) =>
          dslSemanticIdentityKey(reference.identity) === dslSemanticIdentityKey(parameterDeclaration.identity)
        )).toBe(true);
      }
    }
  });

  it("lowers defaulted scalar parameters in parameter order and remaps earlier defaults to generated consts", () => {
    const source = [
      "nui 4",
      "module Defaults(width: number, depth: number = @width + 5) {",
      "  point P = coordinate(x: @width, y: @depth)",
      "}",
      "instance Copy = Defaults(width: 10)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const width: number = 10");
    expect(nextSource).toContain("const depth: number = @width + 5");
    expect(nextSource.indexOf("const width")).toBeLessThan(nextSource.indexOf("const depth"));
    const next = compileCurrent(nextSource, "inline-next");
    const groupIndex = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Copy");
    const declarations = next.statements.filter((statement) =>
      statement.kind === "typedDeclaration" && statement.enclosing?.statementIndex === groupIndex
    );
    const occurrenceIndex = createDslSemanticOccurrenceIndex(next);
    const declarationFor = (statement: typeof declarations[number]) => occurrenceIndex.occurrences.find((occurrence) =>
      occurrence.kind === "declaration" &&
      occurrence.from >= statement.documentRange.from &&
      occurrence.to <= statement.documentRange.to
    );
    const widthDeclaration = declarationFor(declarations.find((statement) => statement.name === "width")!);
    const depthDeclaration = declarationFor(declarations.find((statement) => statement.name === "depth")!);
    const depthStatement = declarations.find((statement) => statement.name === "depth")!;
    const depthReferences = occurrenceIndex.occurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      occurrence.from >= depthStatement.documentRange.from &&
      occurrence.to <= depthStatement.documentRange.to
    );
    const bodyIndex = next.statements.findIndex((statement) => statement.name === "P" && statement.enclosing?.statementIndex === groupIndex);
    const bodyReferences = occurrenceIndex.occurrences.filter((occurrence) =>
      occurrence.kind === "reference" &&
      occurrence.from >= next.statements[bodyIndex]!.documentRange.from &&
      occurrence.to <= next.statements[bodyIndex]!.documentRange.to
    );
    expect(widthDeclaration).toBeDefined();
    expect(depthDeclaration).toBeDefined();
    expect(depthReferences.some((occurrence) =>
      dslSemanticIdentityKey(occurrence.identity) === dslSemanticIdentityKey(widthDeclaration!.identity)
    )).toBe(true);
    expect(bodyReferences.some((occurrence) =>
      dslSemanticIdentityKey(occurrence.identity) === dslSemanticIdentityKey(depthDeclaration!.identity)
    )).toBe(true);
  });

  it("treats explicit and SAY-12 shorthand bindings equivalently and preserves safe same-name references", () => {
    const source = [
      "nui 4",
      "const width: number = 50",
      "module Box(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Explicit = Box(width: @width)",
      "instance Shorthand = Box(@width)"
    ].join("\n");
    const compiled = compileCurrent(source);
    const explicit = compiled.moduleSemanticAnalysis!.instances.find((instance) => instance.name === "Explicit")!;
    const shorthand = compiled.moduleSemanticAnalysis!.instances.find((instance) => instance.name === "Shorthand")!;
    expect(explicit.parameterBindings[0]).toMatchObject({ parameterIndex: 0, argumentIndex: 0, argumentLabel: "width" });
    expect(shorthand.parameterBindings[0]).toMatchObject({ parameterIndex: 0, argumentIndex: 0, argumentLabel: "width" });

    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      targets: [targetFor(compiled, "Explicit"), targetFor(compiled, "Shorthand")],
      policy: DEFAULT_POLICY
    });
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource.match(/const width: number = @width/g)).toHaveLength(2);
    const next = compileCurrent(nextSource, "inline-next");
    const rootWidth = createDslSemanticOccurrenceIndex(next).occurrences.find((occurrence) =>
      occurrence.kind === "declaration" && nextSource.slice(occurrence.from, occurrence.to) === "width" &&
      next.statements.find((statement) => statement.documentRange.from <= occurrence.from && occurrence.to <= statement.documentRange.to)?.enclosing === null
    );
    expect(rootWidth).toBeDefined();
    const nextIndex = createDslSemanticOccurrenceIndex(next);
    const generatedGroupIndexes = new Set(next.statements.flatMap((statement, statementIndex) =>
      statement.kind === "group" ? [statementIndex] : []
    ));
    const generatedWidths = next.statements.filter((statement) =>
      statement.kind === "typedDeclaration" && statement.name === "width" &&
      generatedGroupIndexes.has(statement.enclosing?.statementIndex ?? -1)
    );
    expect(generatedWidths).toHaveLength(2);
    if (rootWidth) {
      const rootWidthIdentity = dslSemanticIdentityKey(rootWidth.identity);
      for (const generated of generatedWidths) {
        expect(nextIndex.occurrences.some((occurrence) =>
          occurrence.kind === "reference" &&
          occurrence.from >= generated.documentRange.from &&
          occurrence.to <= generated.documentRange.to &&
          dslSemanticIdentityKey(occurrence.identity) === rootWidthIdentity
        )).toBe(true);
      }
    }
    expect(result.targets.filter((target) => target.status === "inlined")).toHaveLength(2);
  });

  it("canonicalizes only a moved cross-parameter reference captured by an earlier generated const", () => {
    const source = [
      "nui 4",
      "const a: number = 50",
      "module Pair(a: number, b: number) {",
      "  point P = coordinate(x: @a, y: @b)",
      "}",
      "instance Copy = Pair(a: 1, b: @a)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const a: number = 1");
    expect(nextSource).toContain("const b: number = @::a");
    expect(nextSource.match(/@::a/g)).toHaveLength(1);
    expect(nextSource).toContain("point P = coordinate(x: @a, y: @b)");

    const next = compileCurrent(nextSource, "inline-next");
    const nextIndex = createDslSemanticOccurrenceIndex(next);
    const groupIndex = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Copy");
    const generated = next.statements.filter((statement) =>
      statement.kind === "typedDeclaration" && statement.enclosing?.statementIndex === groupIndex
    );
    const generatedA = generated.find((statement) => statement.name === "a");
    const generatedB = generated.find((statement) => statement.name === "b");
    const copiedPoint = next.statements.find((statement) =>
      statement.kind === "element" && statement.name === "P" && statement.enclosing?.statementIndex === groupIndex
    );
    const rootA = next.statements.find((statement, statementIndex) =>
      statementIndex < groupIndex && statement.kind === "typedDeclaration" && statement.name === "a" && statement.enclosing === null
    );
    expect(generatedA).toBeDefined();
    expect(generatedB).toBeDefined();
    expect(copiedPoint).toBeDefined();
    expect(rootA).toBeDefined();
    if (!generatedA || !generatedB || !copiedPoint || !rootA) return;

    const typedDeclarationIdentity = (statement: typeof generatedA) => {
      const occurrence = nextIndex.occurrences.find((candidate) =>
        candidate.kind === "declaration" && candidate.identity.kind === "typed" &&
        candidate.from >= statement.documentRange.from && candidate.to <= statement.documentRange.to
      );
      return occurrence ? dslSemanticIdentityKey(occurrence.identity) : null;
    };
    const generatedAIdentity = typedDeclarationIdentity(generatedA);
    const generatedBIdentity = typedDeclarationIdentity(generatedB);
    const rootAIdentity = nextIndex.occurrences.find((candidate) =>
      candidate.kind === "declaration" && candidate.identity.kind === "typed" &&
      candidate.from >= rootA.documentRange.from && candidate.to <= rootA.documentRange.to
    );
    expect(generatedAIdentity).not.toBeNull();
    expect(generatedBIdentity).not.toBeNull();
    expect(rootAIdentity).toBeDefined();
    if (!generatedAIdentity || !generatedBIdentity || !rootAIdentity) return;

    const referencesIn = (statement: typeof copiedPoint) => nextIndex.occurrences.filter((candidate) =>
      candidate.kind === "reference" &&
      candidate.from >= statement.documentRange.from && candidate.to <= statement.documentRange.to
    );
    const bInitializerReferences = nextIndex.occurrences.filter((candidate) =>
      candidate.kind === "reference" &&
      candidate.from >= generatedB.documentRange.from && candidate.to <= generatedB.documentRange.to
    );
    const bodyReferences = referencesIn(copiedPoint);
    expect(bInitializerReferences.some((candidate) =>
      dslSemanticIdentityKey(candidate.identity) === dslSemanticIdentityKey(rootAIdentity.identity)
    )).toBe(true);
    expect(bodyReferences.some((candidate) => dslSemanticIdentityKey(candidate.identity) === generatedAIdentity)).toBe(true);
    expect(bodyReferences.some((candidate) => dslSemanticIdentityKey(candidate.identity) === generatedBIdentity)).toBe(true);
  });

  it("keeps default parameter remapping local for multiple instances of one Module", () => {
    const source = [
      "nui 4",
      "module Defaults(width: number, depth: number = @width + 5) {",
      "  point P = coordinate(x: @width, y: @depth)",
      "}",
      "instance First = Defaults(width: 10)",
      "instance Second = Defaults(width: 20)"
    ].join("\n");
    const { result } = plan(source, ["First", "Second"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.targets.filter((target) => target.status === "inlined")).toHaveLength(2);

    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("group First {");
    expect(nextSource).toContain("group Second {");
    expect(nextSource).toContain("const width: number = 10");
    expect(nextSource).toContain("const width: number = 20");
    expect(nextSource.match(/const depth: number = @width \+ 5/g)).toHaveLength(2);
    expect(nextSource).not.toContain("const depth: number = @::width + 5");

    const next = compileCurrent(nextSource, "inline-multi-target-default-next");
    const nextIndex = createDslSemanticOccurrenceIndex(next);
    const statementsForGroup = (name: string) => {
      const groupIndex = next.statements.findIndex(
        (statement) => statement.kind === "group" && statement.name === name
      );
      expect(groupIndex).toBeGreaterThanOrEqual(0);
      const group = next.statements[groupIndex];
      if (!group || group.kind !== "group") throw new Error(`Missing group ${name}`);

      const typedDeclarations = next.statements.filter((statement) =>
        statement.kind === "typedDeclaration" &&
        statement.enclosing?.statementIndex === groupIndex
      );
      const width = typedDeclarations.find((statement) => statement.name === "width");
      const depth = typedDeclarations.find((statement) => statement.name === "depth");
      const point = next.statements.find((statement) =>
        statement.kind === "element" &&
        statement.name === "P" &&
        statement.enclosing?.statementIndex === groupIndex
      );
      expect(width).toBeDefined();
      expect(depth).toBeDefined();
      expect(point).toBeDefined();
      if (
        !width || width.kind !== "typedDeclaration" ||
        !depth || depth.kind !== "typedDeclaration" ||
        !point || point.kind !== "element"
      ) {
        throw new Error(`Missing generated statements for ${name}`);
      }
      return { width, depth, point };
    };
    const typedDeclarationKey = (statement: (typeof next.statements)[number]) => {
      const occurrence = nextIndex.occurrences.find((candidate) =>
        candidate.kind === "declaration" &&
        candidate.identity.kind === "typed" &&
        candidate.from >= statement.documentRange.from &&
        candidate.to <= statement.documentRange.to
      );
      expect(occurrence).toBeDefined();
      if (!occurrence || occurrence.identity.kind !== "typed") {
        throw new Error(`Missing typed declaration identity for ${statement.name}`);
      }
      return dslSemanticIdentityKey(occurrence.identity);
    };
    const referenceKeys = (statement: (typeof next.statements)[number]) =>
      nextIndex.occurrences
        .filter((candidate) =>
          candidate.kind === "reference" &&
          candidate.from >= statement.documentRange.from &&
          candidate.to <= statement.documentRange.to
        )
        .map((candidate) => dslSemanticIdentityKey(candidate.identity));

    const first = statementsForGroup("First");
    const second = statementsForGroup("Second");
    const firstWidthKey = typedDeclarationKey(first.width);
    const firstDepthKey = typedDeclarationKey(first.depth);
    const secondWidthKey = typedDeclarationKey(second.width);
    const secondDepthKey = typedDeclarationKey(second.depth);

    const firstDepthReferences = referenceKeys(first.depth);
    const secondDepthReferences = referenceKeys(second.depth);
    expect(firstDepthReferences).toContain(firstWidthKey);
    expect(firstDepthReferences).not.toContain(secondWidthKey);
    expect(secondDepthReferences).toContain(secondWidthKey);
    expect(secondDepthReferences).not.toContain(firstWidthKey);

    const firstBodyReferences = referenceKeys(first.point);
    const secondBodyReferences = referenceKeys(second.point);
    expect(firstBodyReferences).toContain(firstWidthKey);
    expect(firstBodyReferences).toContain(firstDepthKey);
    expect(firstBodyReferences).not.toContain(secondWidthKey);
    expect(firstBodyReferences).not.toContain(secondDepthKey);
    expect(secondBodyReferences).toContain(secondWidthKey);
    expect(secondBodyReferences).toContain(secondDepthKey);
    expect(secondBodyReferences).not.toContain(firstWidthKey);
    expect(secondBodyReferences).not.toContain(firstDepthKey);
  });

  it("does not rewrite a caller expression whose owner remains valid after moving", () => {
    const source = [
      "nui 4",
      "const base: number = 50",
      "module Box(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "}",
      "instance Copy = Box(width: @base)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const width: number = @base");
    expect(nextSource).not.toContain("const width: number = @::base");
  });

  it.each([
    [
      "optional scalar",
      ["nui 4", "module Box(width?: number) {", "  point P = coordinate(x: 0, y: 0)", "}", "instance Copy = Box()"].join("\n")
    ],
    [
      "geometry parameter",
      ["nui 4", "point A = coordinate(x: 0, y: 0)", "module Box(anchor: point) {", "  point P = coordinate(x: 0, y: 0)", "}", "instance Copy = Box(anchor: @A)"].join("\n")
    ],
    [
      "record parameter",
      ["nui 4", "record Pair(x: number)", "module Box(settings: Pair) {", "  point P = coordinate(x: 0, y: 0)", "}", "instance Copy = Box(settings: Pair(x: 1))"].join("\n")
    ]
  ])("keeps %s outside this scalar lowering slice", (_label, source) => {
    const { result } = plan(source, ["Copy"]);
    expect(result).toMatchObject({
      status: "planned",
      splices: [],
      targets: [{ status: "skipped", code: "parameter-lowering-required" }]
    });
  });

  it("skips body structures whose binder/capture proof is deferred", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  group Inner {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "instance Copy = Stamp()"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);

    expect(result).toMatchObject({
      status: "planned",
      splices: [],
      targets: [{ status: "skipped", code: "nested-module-validation-required" }]
    });
  });

  it("preserves external instance-member resolution to the generated group member", () => {
    const source = [
      "nui 4",
      "module Stamp(width: number) {",
      "  export point Anchor = coordinate(x: @width, y: 0)",
      "}",
      "instance Copy = Stamp(width: 10)",
      "point User = offset(from: @Copy::Anchor, dx: 1, dy: 0)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const next = compileCurrent(nextSource, "inline-next");

    const afterIndex = createDslSemanticOccurrenceIndex(next);
    const statementRange = (statementIndex: number) => next.statements[statementIndex]!.documentRange;
    const occurrenceFor = (
      statementIndex: number,
      token: string,
      kind: "declaration" | "reference"
    ) => afterIndex.occurrences.find((occurrence) => {
      const range = statementRange(statementIndex);
      return occurrence.kind === kind &&
        nextSource.slice(occurrence.from, occurrence.to) === token &&
        occurrence.from >= range.from &&
        occurrence.to <= range.to;
    });

    const copyGroupIndex = next.statements.findIndex((statement) =>
      statement.kind === "group" && statement.name === "Copy"
    );
    const anchorIndex = next.statements.findIndex((statement) =>
      statement.name === "Anchor" && statement.enclosing?.statementIndex === copyGroupIndex
    );
    const userIndex = next.statements.findIndex((statement) => statement.name === "User");
    expect(copyGroupIndex).toBeGreaterThanOrEqual(0);
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeGreaterThanOrEqual(0);

    const copyDeclaration = occurrenceFor(copyGroupIndex, "Copy", "declaration");
    const anchorDeclaration = occurrenceFor(anchorIndex, "Anchor", "declaration");
    const copyReference = occurrenceFor(userIndex, "Copy", "reference");
    const anchorReference = occurrenceFor(userIndex, "Anchor", "reference");
    expect(copyDeclaration).toBeDefined();
    expect(anchorDeclaration).toBeDefined();
    expect(copyReference).toBeDefined();
    expect(anchorReference).toBeDefined();
    if (!copyDeclaration || !anchorDeclaration || !copyReference || !anchorReference) return;

    expect(dslSemanticIdentityKey(copyReference.identity)).toBe(dslSemanticIdentityKey(copyDeclaration.identity));
    expect(dslSemanticIdentityKey(anchorReference.identity)).toBe(dslSemanticIdentityKey(anchorDeclaration.identity));
    expect(result.targets[0]).toMatchObject({ status: "inlined", generatedGroupName: "Copy" });
  });

  it("fails closed when the supplied semantic callee is deliberately made to drift from authored source", () => {
    const source = [
      "nui 4",
      "module First() {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "module Second() {",
      "  point B = coordinate(x: 1, y: 0)",
      "}",
      "instance Copy = First()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const copyIndex = compiled.statements.findIndex((statement) => statement.name === "Copy");
    const secondIndex = compiled.statements.findIndex((statement) => statement.name === "Second");
    const copyId = compiled.statementMap!.statementIdByStatementIndex!.get(copyIndex)!;
    const secondId = compiled.statementMap!.statementIdByStatementIndex!.get(secondIndex)!;
    const second = compiled.moduleSemanticAnalysis!.definitionsByStatementId.get(secondId)!;
    const originalInstance = compiled.moduleSemanticAnalysis!.instancesByStatementId.get(copyId)!;
    const driftedInstance = {
      ...originalInstance,
      callee: { definitionStatementId: secondId, definitionStatementIndex: secondIndex, name: second.name }
    };
    const driftedInstances = new Map(compiled.moduleSemanticAnalysis!.instancesByStatementId);
    driftedInstances.set(copyId, driftedInstance);
    const driftedAnalysis = {
      ...compiled.moduleSemanticAnalysis!,
      instancesByStatementId: driftedInstances,
      instances: compiled.moduleSemanticAnalysis!.instances.map((instance) =>
        instance.statementId === copyId ? driftedInstance : instance
      )
    };
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled: { ...compiled, moduleSemanticAnalysis: driftedAnalysis },
      targets: [{ documentKey: null, statementId: copyId }],
      policy: DEFAULT_POLICY
    });

    expect(result).toMatchObject({ status: "planned", splices: [] });
    if (result.status !== "planned") return;
    expect(result.targets).toMatchObject([
      { status: "skipped", code: "unresolved-callee" }
    ]);
  });
});
