import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
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

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `inline:${index}`]));
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

const targetForInstance = (compiled: CompiledDslDocument, name: string): InlineModuleTargetIdentity => {
  const index = compiled.statements.findIndex((statement) => statement.kind === "moduleInstance" && statement.name === name);
  expect(index).toBeGreaterThanOrEqual(0);
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(index);
  if (!statementId) throw new Error(`missing statement id for instance ${name}`);
  return { documentKey: null, statementId };
};

const plan = (
  source: string,
  instanceNames: readonly string[],
  policy: Partial<InlineModulePolicy> = {}
) => {
  const compiled = compileCurrent(source);
  const result = planInlineModule({
    source: { normalizedSource: source, sourceRevision: REVISION },
    compiled,
    targets: instanceNames.map((name) => targetForInstance(compiled, name)),
    policy: { ...DEFAULT_POLICY, ...policy }
  });
  return { compiled, result };
};

describe("planInlineModule initial parameterless slice", () => {
  it("replaces one local instance with a group, strips direct Module export markers, and preserves authored body layout", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  export point Anchor = coordinate(x: 0, y: 0)",
      "  // keep body note",
      "",
      "  point Other = coordinate(x: 2, y: 0)",
      "}",
      "instance Copy = Stamp()",
      "point User = offset(from: @Copy::Anchor, dx: 1, dy: 0)"
    ].join("\n");
    const { result } = plan(source, ["Copy"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.targets).toMatchObject([
      {
        status: "inlined",
        instanceName: "Copy",
        activity: "visible",
        generatedGroupName: "Copy"
      }
    ]);
    expect(result.splices).toHaveLength(1);

    const next = applyLineSplices(source, result.splices);
    expect(next).toContain([
      "module Stamp() {",
      "  export point Anchor = coordinate(x: 0, y: 0)",
      "  // keep body note",
      "",
      "  point Other = coordinate(x: 2, y: 0)",
      "}"
    ].join("\n"));
    expect(next).toContain([
      "group Copy {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "  // keep body note",
      "",
      "  point Other = coordinate(x: 2, y: 0)",
      "}"
    ].join("\n"));
    expect(next).toContain("point User = offset(from: @Copy::Anchor, dx: 1, dy: 0)");
    expect(next.match(/export point Anchor/g)).toHaveLength(1);
  });

  it("skips hidden and disabled instances by policy, then preserves included activity on the generated group", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance Hidden(state: hidden) = Stamp()",
      "instance Disabled(state: disabled) = Stamp()"
    ].join("\n");

    const excluded = plan(source, ["Hidden", "Disabled"]).result;
    expect(excluded.status).toBe("planned");
    if (excluded.status !== "planned") return;
    expect(excluded.splices).toEqual([]);
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

  it("deduplicates requested authored identities and plans successful targets in deterministic source order", () => {
    const source = [
      "nui 4",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 0, y: 0)",
      "}",
      "instance First = Stamp()",
      "instance Second = Stamp()"
    ].join("\n");
    const compiled = compileCurrent(source);
    const first = targetForInstance(compiled, "First");
    const second = targetForInstance(compiled, "Second");
    const result = planInlineModule({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      targets: [second, first, second],
      policy: DEFAULT_POLICY
    });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.targets.map((target) => target.instanceName)).toEqual(["First", "Second"]);
    expect(result.splices.map((splice) => splice.startLine)).toEqual([...result.splices.map((splice) => splice.startLine)].sort((a, b) => a - b));
    const next = applyLineSplices(source, result.splices);
    expect(next).toContain("group First {");
    expect(next).toContain("group Second {");
  });

  it("keeps parameterized Modules as a structured known-ineligible result until semantic parameter lowering lands", () => {
    const source = [
      "nui 4",
      "module Shift(dx: number) {",
      "  point P = coordinate(x: @dx, y: 0)",
      "}",
      "instance Moved = Shift(dx: 10)"
    ].join("\n");
    const { result } = plan(source, ["Moved"]);

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.splices).toEqual([]);
    expect(result.targets).toMatchObject([
      { status: "skipped", instanceName: "Moved", code: "parameter-lowering-required" }
    ]);
  });

  it("rejects stale source/revision before returning any applicable mutation", () => {
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
      targets: [targetForInstance(compiled, "Copy")],
      policy: DEFAULT_POLICY
    });

    expect(result).toMatchObject({ status: "rejected", code: "stale-semantic-snapshot" });
    expect("splices" in result).toBe(false);
  });

  it("classifies a document-qualified target as an imported/multi-document v1 skip without guessing a local statement", () => {
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
      targets: [{ documentKey: "library.nui", statementId: "external:instance" }],
      policy: DEFAULT_POLICY
    });

    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.splices).toEqual([]);
    expect(result.targets).toMatchObject([
      { status: "skipped", code: "non-local-target", statementIndex: null }
    ]);
  });
});
