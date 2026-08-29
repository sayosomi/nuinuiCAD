import { describe, expect, it, vi } from "vitest";
import * as dslDocument from "../dsl/dslDocument";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createDslSemanticOccurrenceIndex, dslSemanticIdentityKey } from "../dsl/dslSemanticOccurrenceIndex";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
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

const geometryTargetIds = (expression: TypedScalarExpression): string[] => {
  switch (expression.kind) {
    case "group":
    case "unary":
      return geometryTargetIds(expression.kind === "group" ? expression.expression : expression.operand);
    case "binary":
      return [...geometryTargetIds(expression.left), ...geometryTargetIds(expression.right)];
    case "call":
      return expression.args.flatMap((argument) => argument.kind === "geometryReference"
        ? argument.target ? [argument.target.statementId] : []
        : geometryTargetIds(argument.expression));
    default:
      return [];
  }
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

  it("specializes optional presence independently for multiple targets and lowers only supplied values", () => {
    const source = [
      "nui 4",
      "module Presence(value?: number, enabled: boolean = hasValue(@value)) {",
      "  const present: boolean = hasValue(@value)",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Present = Presence(value: 12)",
      "instance Absent = Presence()"
    ].join("\n");
    const { result } = plan(source, ["Present", "Absent"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("group Present {");
    expect(nextSource).toContain("const value: number = 12");
    expect(nextSource).toContain("const enabled: boolean = true");
    expect(nextSource).toContain("const present: boolean = true");
    expect(nextSource).toContain("group Absent {");
    const absent = nextSource.slice(nextSource.indexOf("group Absent {"));
    expect(absent).not.toContain("const value: number");
    expect(nextSource).toContain("const enabled: boolean = false");
    expect(nextSource).toContain("const present: boolean = false");
    expect(nextSource.slice(nextSource.indexOf("group Present {"))).not.toContain("hasValue(@value)");
  });

  it("uses validated presence metadata instead of a boolean placeholder in the semantic AST", () => {
    const source = [
      "nui 4",
      "module Presence(value?: number) {",
      "  const present: boolean = hasValue(@value)",
      "}",
      "instance Present = Presence(value: 12)",
      "instance Absent = Presence()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const analysis = compiled.moduleSemanticAnalysis!;
    const definition = analysis.definitions[0]!;
    const body = definition.bodyStatements[0]!;
    const site = body.scalarExpressions[0];
    expect(site).toBeDefined();
    if (!site) return;
    const placeholder = { kind: "booleanLiteral" as const, span: site.expression.ast.span, value: false };
    const updatedBody = {
      ...body,
      scalarExpressions: body.scalarExpressions.map((candidate) => candidate === site
        ? { ...candidate, expression: { ...candidate.expression, ast: placeholder } }
        : candidate)
    };
    const updatedDefinition = {
      ...definition,
      bodyStatements: definition.bodyStatements.map((candidate) => candidate === body ? updatedBody : candidate)
    };
    const definitionsByStatementId = new Map(analysis.definitionsByStatementId);
    definitionsByStatementId.set(updatedDefinition.statementId, updatedDefinition);
    const modifiedCompiled: CompiledDslDocument = {
      ...compiled,
      moduleSemanticAnalysis: {
        ...analysis,
        definitions: analysis.definitions.map((candidate) => candidate === definition ? updatedDefinition : candidate),
        definitionsByStatementId
      }
    };
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled: modifiedCompiled,
      targets: ["Present", "Absent"].map((name) => targetFor(modifiedCompiled, name)),
      policy: DEFAULT_POLICY
    });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const present: boolean = true");
    expect(nextSource).toContain("const present: boolean = false");
  });

  it("proves references eliminated by a false guarded body expression", () => {
    const source = [
      "nui 4",
      "module M(value?: number) {",
      "  const positive: boolean = hasValue(@value) and @value > 0",
      "}",
      "instance Use = M()"
    ].join("\n");
    const { result } = plan(source, ["Use"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const generated = nextSource.slice(nextSource.indexOf("group Use {"));
    expect(generated).toContain("const positive: boolean = false");
    expect(generated).not.toContain("hasValue(@value)");
    expect(generated).not.toContain("@value");
    expect(compileCurrent(nextSource, "inline-guarded-body-next").diagnostics).toEqual([]);
  });

  it("proves references eliminated by a false guarded default initializer", () => {
    const source = [
      "nui 4",
      "module M(value?: number, enabled: number, positive: boolean = hasValue(@value) and @enabled > 0) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Use = M(enabled: 1)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const generated = nextSource.slice(nextSource.indexOf("group Use {"));
    expect(generated).not.toContain("const value: number");
    expect(generated).toContain("const positive: boolean = false");
    expect(generated).not.toContain("hasValue(@value)");
    expect(generated).not.toContain("@value");
    expect(compileCurrent(nextSource, "inline-guarded-default-next").diagnostics).toEqual([]);
  });

  it("supports optional number, string, boolean, and choice parameters", () => {
    const source = [
      "nui 4",
      "module Scalars(n?: number, text?: string, flag?: boolean, side?: choice(right, left)) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Present = Scalars(n: 1, text: \"front\", flag: true, side: left)",
      "instance Absent = Scalars()"
    ].join("\n");
    const { result } = plan(source, ["Present", "Absent"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const n: number = 1");
    expect(nextSource).toContain("const text: string = \"front\"");
    expect(nextSource).toContain("const flag: boolean = true");
    expect(nextSource).toContain("const side: choice(right, left) = left");
    const absent = nextSource.slice(nextSource.indexOf("group Absent {"));
    expect(absent).not.toContain("const n:");
    expect(absent).not.toContain("const text:");
    expect(absent).not.toContain("const flag:");
    expect(absent).not.toContain("const side:");
  });

  it("partially simplifies presence conditions while preserving the dynamic operand owner", () => {
    const source = [
      "nui 4",
      "module Conditional(value?: number, enabled: boolean) {",
      "  if (hasValue(@value) and @enabled) {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "instance Present = Conditional(value: 2, enabled: true)",
      "instance Absent = Conditional(enabled: true)"
    ].join("\n");
    const { result } = plan(source, ["Present", "Absent"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const present = nextSource.slice(nextSource.indexOf("group Present {"));
    expect(present).toContain("if (@enabled) {");
    expect(present).not.toContain("if (hasValue(@value)");
    const absent = nextSource.slice(nextSource.indexOf("group Absent {"));
    expect(absent).not.toContain("if (");
    expect(absent).not.toContain("point P");

    const next = compileCurrent(nextSource, "inline-presence-condition-next");
    const nextIndex = createDslSemanticOccurrenceIndex(next);
    const presentGroup = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Present");
    const enabled = next.statements.find((statement) =>
      statement.kind === "typedDeclaration" && statement.name === "enabled" && statement.enclosing?.statementIndex === presentGroup
    );
    const conditional = next.statements.find((statement) =>
      statement.kind === "element" && statement.type === "conditionalGroup" && statement.enclosing?.statementIndex === presentGroup
    );
    expect(enabled).toBeDefined();
    expect(conditional).toBeDefined();
    if (!enabled || !conditional) return;
    const enabledDeclaration = nextIndex.occurrences.find((occurrence) =>
      occurrence.kind === "declaration" && occurrence.from >= enabled.documentRange.from && occurrence.to <= enabled.documentRange.to
    );
    const conditionReferences = nextIndex.occurrences.filter((occurrence) =>
      occurrence.kind === "reference" && occurrence.from >= conditional.documentRange.from && occurrence.to <= conditional.documentRange.to
    );
    expect(enabledDeclaration).toBeDefined();
    expect(conditionReferences.some((occurrence) =>
      enabledDeclaration && dslSemanticIdentityKey(occurrence.identity) === dslSemanticIdentityKey(enabledDeclaration.identity)
    )).toBe(true);
  });

  it("lifts the branch selected by negated optional presence and remaps supplied references", () => {
    const source = [
      "nui 4",
      "module Conditional(value?: number) {",
      "  if (not hasValue(@value)) {",
      "    point Missing = coordinate(x: 0, y: 0)",
      "  } else {",
      "    point Present = coordinate(x: @value, y: 0)",
      "  }",
      "}",
      "instance Supplied = Conditional(value: 4)",
      "instance Omitted = Conditional()"
    ].join("\n");
    const { result } = plan(source, ["Supplied", "Omitted"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("group Supplied {\n  const value: number = 4\n  point Present = coordinate(x: @value, y: 0)\n}");
    expect(nextSource).toContain("group Omitted {\n  point Missing = coordinate(x: 0, y: 0)\n}");
    expect(nextSource.slice(nextSource.indexOf("group Supplied {"))).not.toContain("if (not hasValue");

    const next = compileCurrent(nextSource, "inline-negated-presence-next");
    const nextIndex = createDslSemanticOccurrenceIndex(next);
    const groupIndex = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Supplied");
    const value = next.statements.find((statement) =>
      statement.kind === "typedDeclaration" && statement.name === "value" && statement.enclosing?.statementIndex === groupIndex
    );
    const point = next.statements.find((statement) =>
      statement.kind === "element" && statement.name === "Present" && statement.enclosing?.statementIndex === groupIndex
    );
    expect(value).toBeDefined();
    expect(point).toBeDefined();
    if (!value || !point) return;
    const valueDeclaration = nextIndex.occurrences.find((occurrence) =>
      occurrence.kind === "declaration" && occurrence.from >= value.documentRange.from && occurrence.to <= value.documentRange.to
    );
    const pointReferences = nextIndex.occurrences.filter((occurrence) =>
      occurrence.kind === "reference" && occurrence.from >= point.documentRange.from && occurrence.to <= point.documentRange.to
    );
    expect(valueDeclaration).toBeDefined();
    expect(pointReferences.some((occurrence) =>
      valueDeclaration && dslSemanticIdentityKey(occurrence.identity) === dslSemanticIdentityKey(valueDeclaration.identity)
    )).toBe(true);
  });

  it("comments omitted branch source only when the policy enables it", () => {
    const source = [
      "nui 4",
      "module Conditional(value?: number) {",
      "  if (hasValue(@value)) {",
      "    point P = coordinate(x: @value, y: 0)",
      "  }",
      "}",
      "instance Omitted = Conditional()"
    ].join("\n");
    const off = plan(source, ["Omitted"]).result;
    expect(off.status).toBe("planned");
    if (off.status !== "planned") return;
    const offSource = applyLineSplices(source, off.splices);
    expect(offSource).toContain("group Omitted {\n}");
    const offGenerated = offSource.slice(offSource.indexOf("group Omitted {"));
    expect(offGenerated).not.toContain("Inline omitted");
    expect(offGenerated).not.toContain("hasValue(@value)");

    const on = plan(source, ["Omitted"], { emitOmittedBranchComments: true }).result;
    expect(on.status).toBe("planned");
    if (on.status !== "planned") return;
    const onSource = applyLineSplices(source, on.splices);
    expect(onSource).toContain("// Inline omitted: condition resolved to false");
    expect(onSource).toContain("// if (hasValue(@value)) {");
    expect(onSource).toContain("//   point P = coordinate(x: @value, y: 0)");
    const next = compileCurrent(onSource, "inline-omitted-comments-next");
    const group = next.statements.find((statement) => statement.kind === "group" && statement.name === "Omitted");
    expect(group).toBeDefined();
    if (!group) return;
    const index = createDslSemanticOccurrenceIndex(next);
    expect(index.occurrences.some((occurrence) =>
      occurrence.from >= group.documentRange.from && occurrence.to <= group.documentRange.to &&
      occurrence.identity.kind === "module" && occurrence.identity.target.kind === "moduleParameter"
    )).toBe(false);
  });

  it("comments the complete omitted else branch, including its closing brace", () => {
    const source = [
      "nui 4",
      "module Conditional(value?: number) {",
      "  if (hasValue(@value)) {",
      "    point Kept = coordinate(x: 0, y: 0)",
      "  } else {",
      "    point Removed = coordinate(x: 1, y: 0)",
      "  }",
      "}",
      "instance Use = Conditional(value: 1)"
    ].join("\n");
    const { result } = plan(source, ["Use"], { emitOmittedBranchComments: true });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const generated = nextSource.slice(nextSource.indexOf("group Use {"));
    expect(generated).toContain("point Kept = coordinate(x: 0, y: 0)");
    expect(generated).toContain("// Inline omitted: condition resolved to true");
    expect(generated).toContain("// } else {");
    expect(generated).toContain("//   point Removed = coordinate(x: 1, y: 0)");
    expect(generated).toContain("// }");
    expect(generated).not.toContain("\n  point Removed =");
    expect(generated.trimEnd().endsWith("}")).toBe(true);
    expect(compileCurrent(nextSource, "inline-true-else-comments-next").diagnostics).toEqual([]);
  });

  it("specializes hasValue inside a text-template scalar hole", () => {
    const source = [
      "nui 4",
      "module Label(value?: number) {",
      "  text Label = label(text: \"present=${hasValue(@value)}\", anchor: none, size: 3)",
      "}",
      "instance Supplied = Label(value: 1)",
      "instance Omitted = Label()"
    ].join("\n");
    const { result } = plan(source, ["Supplied", "Omitted"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const generated = nextSource.slice(nextSource.indexOf("group Supplied {"));
    expect(generated).toContain("text Label = label(text: \"present=${true}\"");
    expect(generated).toContain("text Label = label(text: \"present=${false}\"");
    expect(generated).not.toContain("hasValue(@value)");
  });

  it("rejects an omitted optional reference that could otherwise capture an outer same-name binding", () => {
    const source = [
      "nui 4",
      "const value: number = 99",
      "module Unsafe(value?: number) {",
      "  point P = coordinate(x: @value, y: 0)",
      "}",
      "instance Omitted = Unsafe()"
    ].join("\n");
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
    const ids = new Map(parsed.statements.map((_, index) => [index, `inline-unsafe:${index}`]));
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      sourceRevision: REVISION,
      assignedElementIds: ids,
      assignedStatementIds: ids
    });
    const cleanSource = source.replace("coordinate(x: @value, y: 0)", "coordinate(x: 0, y: 0)");
    const cleanParsed = parseDslSnapshot({ normalizedSource: cleanSource, sourceRevision: REVISION });
    const cleanCompiled = compileDslDocument(cleanSource, {
      preparsed: cleanParsed,
      sourceRevision: REVISION,
      assignedElementIds: ids,
      assignedStatementIds: ids
    });
    expect(cleanCompiled.statementMap).not.toBeNull();
    const analysis = compiled.moduleSemanticAnalysis!;
    const cleanAnalysis = { ...analysis, diagnostics: [] };
    const omittedIndex = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance" && statement.name === "Omitted");
    const target = { documentKey: null, statementId: ids.get(omittedIndex)! } satisfies InlineModuleTargetIdentity;
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled: {
        ...compiled,
        diagnostics: [],
        bindingIssueDiagnostics: [],
        statementMap: cleanCompiled.statementMap,
        moduleSemanticAnalysis: cleanAnalysis
      },
      targets: [target],
      policy: DEFAULT_POLICY
    });

    expect(result).toMatchObject({ status: "rejected", code: "unsafe-rewrite" });
    expect("splices" in result).toBe(false);
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

  it("supports a singular point parameter without a geometry alias const", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "module Box(anchor: point) {",
      "  point P = offset(from: @anchor, dx: 1, dy: 0)",
      "}",
      "instance Copy = Box(anchor: @A)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.targets).toMatchObject([{ status: "inlined" }]);
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("point P = offset(from: @A, dx: 1, dy: 0)");
    expect(next).not.toContain("const anchor");
    const compiledNext = compileCurrent(next, "inline-point-next");
    const point = compiledNext.statements.find((statement) => statement.kind === "element" && statement.name === "P");
    expect(point).toBeDefined();
    if (!point) return;
    const pointIndex = compiledNext.statements.indexOf(point);
    const resolved = resolveSourceLexicalPath(compiledNext.sourceLexicalNamespace!, pointIndex, {
      absolute: false,
      segments: ["A"]
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    expect(resolved.declaration.statementId).toBe("inline-point-next:1");
  });

  it("keeps record parameters outside this singular geometry lowering slice", () => {
    const source = [
      "nui 4",
      "record Pair(x: number)",
      "module Box(settings: Pair) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Box(settings: Pair(x: 1))"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);
    expect(result).toMatchObject({
      status: "planned",
      splices: [],
      targets: [{ status: "skipped", code: "parameter-lowering-required" }]
    });
  });

  it("substitutes repeated direct uses of one singular geometry parameter independently", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "module Box(anchor: point) {",
      "  line L = segment(start: @anchor, end: @anchor)",
      "}",
      "instance Copy = Box(anchor: @A)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("line L = segment(start: @A, end: @A)");
    expect(compileCurrent(next, "inline-repeated-geometry-next").diagnostics).toEqual([]);
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

  it("substitutes geometry builtin operands with exact caller targets", () => {
    const source = [
      "nui 4",
      "point Origin = coordinate(x: 0, y: 0)",
      "point P = coordinate(x: 3, y: 4)",
      "line Baseline = segment(start: (0, 0), end: (10, 0))",
      "module Measures(origin: point, p: point, baseline: line) {",
      "  const radius: number = distance(@origin, @p)",
      "  const direction: number = angle(@origin, @p)",
      "  const height: number = lineDistance(@p, @baseline)",
      "}",
      "instance Use = Measures(origin: @Origin, p: @P, baseline: @Baseline)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const next = compileCurrent(nextSource, "inline-builtins-next");
    const targetsFor = (name: string) => {
      const binding = next.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === name);
      const statement = binding
        ? next.scalarProgram?.statements.find((candidate) => candidate.bindingId === binding.id)
        : undefined;
      return statement ? geometryTargetIds(statement.declaration.initializer) : [];
    };
    expect(targetsFor("radius")).toEqual(["inline-builtins-next:1", "inline-builtins-next:2"]);
    expect(targetsFor("direction")).toEqual(["inline-builtins-next:1", "inline-builtins-next:2"]);
    expect(targetsFor("height")).toEqual(["inline-builtins-next:2", "inline-builtins-next:3"]);
    expect(nextSource).toContain("distance(@Origin, @P)");
    expect(nextSource).toContain("angle(@Origin, @P)");
    expect(nextSource).toContain("lineDistance(@P, @Baseline)");
  });

  it("substitutes a line geometry property without evaluating it", () => {
    const source = [
      "nui 4",
      "line Baseline = segment(start: (0, 0), end: (10, 0))",
      "module Measure(lineA: line) {",
      "  const length: number = @lineA.length",
      "}",
      "instance Use = Measure(lineA: @Baseline)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const length: number = @Baseline.length");
    const next = compileCurrent(nextSource, "inline-property-next");
    const binding = next.bindingAnalysis?.catalog.bindings.find((candidate) => candidate.name === "length");
    const declaration = binding
      ? next.scalarProgram?.statements.find((candidate) => candidate.bindingId === binding.id)?.declaration.initializer
      : undefined;
    expect(declaration?.kind).toBe("geometryProperty");
    if (declaration?.kind !== "geometryProperty") return;
    expect(declaration.elementId).toBe("inline-property-next:1");
  });

  it("canonicalizes only a substituted geometry reference captured by a copied local", () => {
    const source = [
      "nui 4",
      "point Input = coordinate(x: 1, y: 2)",
      "module M(anchor: point) {",
      "  point Input = coordinate(x: 9, y: 9)",
      "  point Copy = offset(from: @anchor, dx: 1, dy: 0)",
      "}",
      "instance Use = M(anchor: @Input)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const generated = nextSource.slice(nextSource.indexOf("group Use {"));
    expect(generated).toContain("point Copy = offset(from: @::Input, dx: 1, dy: 0)");
    expect(generated).not.toContain("point Copy = offset(from: @Input, dx: 1, dy: 0)");
    expect(compileCurrent(nextSource, "inline-capture-next").diagnostics).toEqual([]);
  });

  it("specializes supplied optional geometry presence and substitutes its body use", () => {
    const source = [
      "nui 4",
      "point Input = coordinate(x: 1, y: 2)",
      "module Optional(anchor?: point) {",
      "  if (hasValue(@anchor)) {",
      "    point P = offset(from: @anchor, dx: 1, dy: 0)",
      "  }",
      "}",
      "instance Use = Optional(anchor: @Input)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const generated = nextSource.slice(nextSource.indexOf("group Use {"));
    expect(generated).toContain("point P = offset(from: @Input, dx: 1, dy: 0)");
    expect(generated).not.toContain("hasValue(@anchor)");
    expect(generated).not.toContain("const anchor");
  });

  it("removes omitted optional geometry only through guarded-source provenance", () => {
    const source = [
      "nui 4",
      "point Input = coordinate(x: 1, y: 2)",
      "module Optional(anchor?: point) {",
      "  if (hasValue(@anchor)) {",
      "    point P = offset(from: @anchor, dx: 1, dy: 0)",
      "  }",
      "}",
      "instance Omitted = Optional()"
    ].join("\n");
    const off = plan(source, ["Omitted"]).result;
    expect(off.status).toBe("planned");
    if (off.status !== "planned") return;
    const offSource = applyLineSplices(source, off.splices);
    const offGenerated = offSource.slice(offSource.indexOf("group Omitted {"));
    expect(offGenerated).not.toContain("@anchor");
    expect(offGenerated).not.toContain("point P");

    const on = plan(source, ["Omitted"], { emitOmittedBranchComments: true }).result;
    expect(on.status).toBe("planned");
    if (on.status !== "planned") return;
    const onSource = applyLineSplices(source, on.splices);
    const onGenerated = onSource.slice(onSource.indexOf("group Omitted {"));
    expect(onGenerated).toContain("// if (hasValue(@anchor)) {");
    expect(onGenerated).toContain("//   point P = offset(from: @anchor, dx: 1, dy: 0)");
    expect(compileCurrent(onSource, "inline-optional-geometry-comments-next").diagnostics).toEqual([]);
  });

  it("preserves a coordinate geometry argument in a supported direct geometry role", () => {
    const source = [
      "nui 4",
      "module M(anchor: point) {",
      "  point P = offset(from: @anchor, dx: 1, dy: 0)",
      "}",
      "instance Use = M(anchor: (0, 0))"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("point P = offset(from: (0, 0), dx: 1, dy: 0)");
    const generated = nextSource.slice(nextSource.indexOf("group Use {"));
    expect(generated).not.toContain("@anchor");
    expect(nextSource).not.toContain("const anchor");
    expect(compileCurrent(nextSource, "inline-coordinate-next").diagnostics).toEqual([]);
  });

  it("fails closed when a coordinate argument would need an unsynthesized property source", () => {
    const source = [
      "nui 4",
      "module M(anchor: point) {",
      "  const x: number = @anchor.x",
      "}",
      "instance Use = M(anchor: (0, 0))"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result).toMatchObject({ status: "rejected", code: "unsafe-rewrite" });
    expect("splices" in result).toBe(false);
  });

  it("keeps public path parameters path-typed while using the broad line runtime source", () => {
    const source = [
      "nui 4",
      "arc A = arc(center: (0, 0), radius: 5, start: 0, end: 90)",
      "module M(path: path) {",
      "  point P = onLine(from: @path.end, ratio: 0.5)",
      "}",
      "instance Use = M(path: @A)"
    ].join("\n");
    const { compiled, result } = plan(source, ["Use"]);
    const definition = compiled.moduleSemanticAnalysis?.definitions.find((candidate) => candidate.name === "M");
    expect(definition?.parameters[0]?.type?.kind).toBe("path");
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("point P = onLine(from: @A.end, ratio: 0.5)");
    expect(nextSource).not.toContain("const path");
    expect(compileCurrent(nextSource, "inline-path-next").diagnostics).toEqual([]);
  });

  it("lowers mixed scalar and singular geometry parameters independently", () => {
    const source = [
      "nui 4",
      "point Input = coordinate(x: 1, y: 2)",
      "module Mixed(width: number, anchor: point) {",
      "  point P = offset(from: @anchor, dx: @width, dy: 0)",
      "}",
      "instance Use = Mixed(width: 3, anchor: @Input)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const width: number = 3");
    expect(nextSource).toContain("point P = offset(from: @Input, dx: @width, dy: 0)");
    expect(nextSource).not.toContain("const anchor");
    expect(compileCurrent(nextSource, "inline-mixed-next").diagnostics).toEqual([]);
  });

  it("keeps two instances of one Module geometry-local to their own caller targets", () => {
    const source = [
      "nui 4",
      "point FirstInput = coordinate(x: 1, y: 0)",
      "point SecondInput = coordinate(x: 2, y: 0)",
      "module M(anchor: point) {",
      "  point P = offset(from: @anchor, dx: 1, dy: 0)",
      "}",
      "instance First = M(anchor: @FirstInput)",
      "instance Second = M(anchor: @SecondInput)"
    ].join("\n");
    const { result } = plan(source, ["First", "Second"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const first = nextSource.slice(nextSource.indexOf("group First {"), nextSource.indexOf("group Second {"));
    const second = nextSource.slice(nextSource.indexOf("group Second {"));
    expect(first).toContain("from: @FirstInput");
    expect(first).not.toContain("from: @SecondInput");
    expect(second).toContain("from: @SecondInput");
    expect(second).not.toContain("from: @FirstInput");
    expect(compileCurrent(nextSource, "inline-multi-next").diagnostics).toEqual([]);
  });
});

describe("planInlineModule Checkpoint 5 geometry-array parameters", () => {
  it("lowers a required point[] literal to one exact typed local const", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "module Outline(points: point[]) {",
      "  line P = polyline(points: @points, closed: false)",
      "}",
      "instance Use = Outline(points: [@A, @B])"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("const points: point[] = [@A, @B]");
    expect(next.match(/const points: point\[\]/g)).toHaveLength(1);
    expect(next).toContain("line P = polyline(points: @points, closed: false)");
    expect(next).not.toContain("polyline(points: [@A, @B]");
    expect(compileCurrent(next, "inline-array-point-next").diagnostics).toEqual([]);
  });

  it("preserves a required line[] source-array reference and its authored type", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const sourceLines: line[] = [@A]",
      "module Outline(lines: line[]) {",
      "  line P = offset(sources: @lines, distance: 1, side: left, closed: false)",
      "}",
      "instance Use = Outline(lines: @sourceLines)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("const lines: line[] = @sourceLines");
    expect(next).toContain("offset(sources: @lines, distance: 1");
    expect(next).not.toContain("const lines: line[] = [@A]");
    expect(compileCurrent(next, "inline-array-line-next").diagnostics).toEqual([]);
  });

  it("preserves line[] to path[] covariance through the existing array semantics", () => {
    const source = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "const lines: line[] = [@A]",
      "module Outline(paths: path[]) {",
      "  line P = offset(sources: @paths, distance: 1, side: left, closed: false)",
      "}",
      "instance Use = Outline(paths: @lines)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("const paths: path[] = @lines");
    expect(compileCurrent(next, "inline-array-path-next").diagnostics).toEqual([]);
  });

  it("preserves a whole geometry-array export through an earlier Module instance", () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  line Edge = segment(start: (0, 0), end: (10, 0))",
      "  export const exportedPaths: path[] = [@Edge]",
      "}",
      "module Consumer(paths: path[]) {",
      "}",
      "instance producer = Producer()",
      "instance Use = Consumer(paths: @producer::exportedPaths)"
    ].join("\n");
    const { compiled, result } = plan(source, ["Use"]);
    const exported = compiled.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.values.find((value) =>
      value.name === "exportedPaths" && value.exported
    );
    expect(exported?.type.elementType).toBe("path");
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;

    const nextSource = applyLineSplices(source, result.splices);
    expect(nextSource).toContain("const paths: path[] = @producer::exportedPaths");
    expect(nextSource.match(/const paths: path\[\] = @producer::exportedPaths/g)).toHaveLength(1);
    const next = compileCurrent(nextSource, "inline-array-export-next");
    const groupIndex = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Use");
    const generated = next.statements.find((statement) =>
      statement.kind === "typedDeclaration" &&
      statement.name === "paths" &&
      statement.enclosing?.statementIndex === groupIndex
    );
    expect(generated).toBeDefined();
    if (!generated) return;
    const arrayValue = next.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.valuesByStatementIndex.get(
      next.statements.indexOf(generated)
    );
    expect(arrayValue?.type.elementType).toBe("path");
    expect(arrayValue?.value?.kind).toBe("alias");
    if (!arrayValue?.value || arrayValue.value.kind !== "alias") return;
    const producerIndex = next.statements.findIndex((statement) =>
      statement.kind === "moduleInstance" && statement.name === "producer"
    );
    const producerId = next.statementMap?.statementIdByStatementIndex?.get(producerIndex);
    expect(producerId).toBeDefined();
    expect(arrayValue.value.targetValueId).toBe(JSON.stringify(["module-array-export", producerId, "exportedPaths"]));
    const producer = producerId
      ? next.moduleSemanticAnalysis?.instancesByStatementId.get(producerId)
      : undefined;
    const resolvedExport = producer?.callee
      ? next.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.values.find((value) =>
          value.ownerModuleDefinitionStatementIndex === producer.callee?.definitionStatementIndex &&
          value.exported &&
          value.name === "exportedPaths"
        )
      : undefined;
    expect(resolvedExport?.statementId).toBeDefined();
    expect(resolvedExport?.type.elementType).toBe("path");
  });

  it("specializes supplied optional geometry-array presence and emits one local const", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "module Optional(points?: point[]) {",
      "  if (hasValue(@points)) {",
      "    line P = polyline(points: @points, closed: false)",
      "  }",
      "}",
      "instance Use = Optional(points: [@A])"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    const generated = next.slice(next.indexOf("group Use {"));
    expect(generated).toContain("const points: point[] = [@A]");
    expect(generated.match(/const points: point\[\]/g)).toHaveLength(1);
    expect(generated).toContain("line P = polyline(points: @points, closed: false)");
    expect(generated).not.toContain("hasValue(@points)");
    expect(compileCurrent(next, "inline-array-optional-present-next").diagnostics).toEqual([]);
  });

  it("omits an optional geometry-array const and prunes its unreachable body reference", () => {
    const source = [
      "nui 4",
      "module Optional(points?: point[]) {",
      "  if (hasValue(@points)) {",
      "    line P = polyline(points: @points, closed: false)",
      "  }",
      "}",
      "instance Omitted = Optional()"
    ].join("\n");
    const off = plan(source, ["Omitted"]).result;
    expect(off.status).toBe("planned");
    if (off.status !== "planned") return;
    const offSource = applyLineSplices(source, off.splices);
    const offGenerated = offSource.slice(offSource.indexOf("group Omitted {"));
    expect(offGenerated).not.toContain("const points: point[]");
    expect(offGenerated).not.toContain("line P = polyline");
    expect(offGenerated).not.toContain("@points");

    const on = plan(source, ["Omitted"], { emitOmittedBranchComments: true }).result;
    expect(on.status).toBe("planned");
    if (on.status !== "planned") return;
    const onSource = applyLineSplices(source, on.splices);
    const onGenerated = onSource.slice(onSource.indexOf("group Omitted {"));
    expect(onGenerated).not.toContain("const points: point[]");
    expect(onGenerated).toContain("// if (hasValue(@points)) {");
    expect(onGenerated).toContain("//   line P = polyline(points: @points, closed: false)");
    expect(compileCurrent(onSource, "inline-array-optional-omitted-next").diagnostics).toEqual([]);
  });

  it("canonicalizes only a capture-changing source-array reference", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 1, y: 2)",
      "const points: point[] = [@A]",
      "module M(points: point[]) {",
      "  line P = polyline(points: @points, closed: false)",
      "}",
      "instance Use = M(points: @points)"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("const points: point[] = @::points");
    expect(next).not.toContain("const points: point[] = @points");
    expect(compileCurrent(next, "inline-array-capture-next").diagnostics).toEqual([]);
  });

  it("fails closed when candidate geometry-array ownership cannot be proven", () => {
    const source = [
      "nui 4",
      "point Input = coordinate(x: 1, y: 2)",
      "module M(points: point[]) {",
      "  point Input = coordinate(x: 9, y: 9)",
      "  line P = polyline(points: @points, closed: false)",
      "}",
      "instance Use = M(points: [@Input])"
    ].join("\n");
    const compiled = compileCurrent(source);
    const originalCompile = dslDocument.compileDslDocument;
    const compileSpy = vi.spyOn(dslDocument, "compileDslDocument").mockImplementationOnce((...args) => ({
      ...originalCompile(...args),
      diagnostics: [{ severity: "error", line: 1, column: 1, message: "forced array candidate ownership failure" }]
    }));
    try {
      const result = planInlineModule({
        source: { normalizedSource: source, sourceRevision: REVISION },
        compiled,
        targets: [targetFor(compiled, "Use")],
        policy: DEFAULT_POLICY
      });
      expect(result).toMatchObject({ status: "rejected", code: "unsafe-rewrite" });
      expect("splices" in result).toBe(false);
    } finally {
      compileSpy.mockRestore();
    }
  });

  it("lowers mixed scalar, singular geometry, and geometry-array parameters in callee order", () => {
    const source = [
      "nui 4",
      "point Anchor = coordinate(x: 1, y: 2)",
      "point A = coordinate(x: 3, y: 4)",
      "module Mixed(width: number, anchor: point, points: point[]) {",
      "  line P = polyline(points: @points, closed: false)",
      "  point Q = offset(from: @anchor, dx: @width, dy: 0)",
      "}",
      "instance Use = Mixed(width: 3, anchor: @Anchor, points: [@A])"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    expect(next.indexOf("const width: number = 3")).toBeLessThan(next.indexOf("const points: point[] = [@A]"));
    expect(next).toContain("const points: point[] = [@A]");
    expect(next).toContain("polyline(points: @points, closed: false)");
    expect(next).toContain("offset(from: @Anchor, dx: @width, dy: 0)");
    expect(next).not.toContain("const anchor");
    expect(compileCurrent(next, "inline-array-mixed-next").diagnostics).toEqual([]);
  });

  it("keeps geometry-array locals and caller sources target-local for multiple instances", () => {
    const source = [
      "nui 4",
      "point FirstPoint = coordinate(x: 1, y: 0)",
      "point SecondPoint = coordinate(x: 2, y: 0)",
      "module M(points: point[]) {",
      "  line P = polyline(points: @points, closed: false)",
      "}",
      "instance First = M(points: [@FirstPoint])",
      "instance Second = M(points: [@SecondPoint])"
    ].join("\n");
    const { result } = plan(source, ["First", "Second"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const next = applyLineSplices(source, result.splices);
    const first = next.slice(next.indexOf("group First {"), next.indexOf("group Second {"));
    const second = next.slice(next.indexOf("group Second {"));
    expect(first).toContain("const points: point[] = [@FirstPoint]");
    expect(first).not.toContain("SecondPoint");
    expect(second).toContain("const points: point[] = [@SecondPoint]");
    expect(second).not.toContain("FirstPoint");
    expect(compileCurrent(next, "inline-array-multi-next").diagnostics).toEqual([]);
  });

  it("proves generated array locals and copied body references through semantic owners", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "module M(points: point[]) {",
      "  line P = polyline(points: @points, closed: false)",
      "}",
      "instance Use = M(points: [@A])"
    ].join("\n");
    const { result } = plan(source, ["Use"]);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const next = compileCurrent(nextSource, "inline-array-proof-next");
    const groupIndex = next.statements.findIndex((statement) => statement.kind === "group" && statement.name === "Use");
    const generated = next.statements.find((statement) =>
      statement.kind === "typedDeclaration" &&
      statement.name === "points" &&
      statement.enclosing?.statementIndex === groupIndex
    );
    const bodyIndex = next.statements.findIndex((statement) =>
      statement.kind === "element" && statement.name === "P" && statement.enclosing?.statementIndex === groupIndex
    );
    expect(generated).toBeDefined();
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    if (!generated || bodyIndex < 0) return;
    const arrayValue = next.sourceLexicalNamespace?.geometryArraySemanticAnalysis?.valuesByStatementIndex.get(next.statements.indexOf(generated));
    expect(arrayValue?.type.elementType).toBe("point");
    const resolved = resolveSourceLexicalPath(next.sourceLexicalNamespace!, bodyIndex, {
      absolute: false,
      segments: ["points"]
    });
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    expect(resolved.declaration.statementId).toBe(next.statementMap?.statementIdByStatementIndex?.get(next.statements.indexOf(generated)));
  });
});
