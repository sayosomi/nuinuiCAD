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

  it("keeps parameterized Modules fail-closed as a structured non-applicable result", () => {
    const source = [
      "nui 4",
      "module Shift(dx: number) {",
      "  point P = coordinate(x: @dx, y: 0)",
      "}",
      "instance Moved = Shift(dx: 10)"
    ].join("\n");
    const { result } = plan(source, ["Moved"]);

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
      "module Stamp() {",
      "  export point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Copy = Stamp()",
      "point User = offset(from: @Copy::Anchor, dx: 1, dy: 0)"
    ].join("\n");
    const { compiled, result } = plan(source, ["Copy"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    const nextSource = applyLineSplices(source, result.splices);
    const next = compileCurrent(nextSource, "inline-next");
    const userBefore = compiled.statements.findIndex((statement) => statement.name === "User");
    const userAfter = next.statements.findIndex((statement) => statement.name === "User");
    const beforeOwners = createDslSemanticOccurrenceIndex(compiled).occurrences
      .filter((occurrence) => occurrence.kind === "reference" && occurrence.from >= compiled.statements[userBefore]!.documentRange.from)
      .map((occurrence) => dslSemanticIdentityKey(occurrence.identity));
    const afterOwners = createDslSemanticOccurrenceIndex(next).occurrences
      .filter((occurrence) => occurrence.kind === "reference" && occurrence.from >= next.statements[userAfter]!.documentRange.from)
      .map((occurrence) => dslSemanticIdentityKey(occurrence.identity));
    expect(beforeOwners).toHaveLength(2);
    expect(afterOwners).toHaveLength(2);
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
