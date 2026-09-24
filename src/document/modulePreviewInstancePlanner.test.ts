import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { planModulePreviewInstance } from "@nuinuicad/nui-language/document";

const REVISION = 41;

const compileCurrent = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: REVISION });
  const ids = new Map(parsed.statements.map((_, index) => [index, `module-preview:${index}`]));
  const compiled = compileDslDocument(source, {
    preparsed: parsed,
    sourceRevision: REVISION,
    assignedStatementIds: ids
  });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(compiled.statementMap).not.toBeNull();
  return compiled;
};

const targetFor = (compiled: CompiledDslDocument, name: string) => {
  const index = compiled.statements.findIndex((statement) => statement.kind === "moduleDefinition" && statement.name === name);
  if (index < 0) throw new Error(`missing module ${name}`);
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(index);
  if (!statementId) throw new Error(`missing module identity ${name}`);
  return { statementId, statementIndex: index, name };
};

describe("planModulePreviewInstance", () => {
  it("plans one exact-source instance insertion using only explicit target values", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point, offset: number = 2) {",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@Top" }]
    });

    expect(result).toMatchObject({
      status: "planned",
      instanceName: "PocketInstance",
      splice: { startLine: 5, endLine: 4, replacementLines: ["instance PocketInstance = Pocket(anchor: @Top)"] }
    });
    if (result.status !== "planned") return;
    expect(result.expectedPatchedSource).toBe([
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point, offset: number = 2) {",
      "}",
      "instance PocketInstance = Pocket(anchor: @Top)",
      ""
    ].join("\n"));
    expect(result.expectedPatchedSource.slice(result.insertedNameRange.from, result.insertedNameRange.to)).toBe("PocketInstance");
  });

  it("uses a deterministic suffix for an existing generated name", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "instance PocketInstance = Pocket(anchor: @Top)",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@Top" }]
    });

    expect(result).toMatchObject({
      status: "planned",
      instanceName: "PocketInstance2",
      splice: { replacementLines: ["instance PocketInstance2 = Pocket(anchor: @Top)"] }
    });
  });

  it("suffixes a generated name that conflicts with the caller Module parameter overlay", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "module Caller(anchor: point, PocketInstance: number) {",
      "  point Existing = coordinate(x: 0, y: 0)",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.indexOf("point Existing"),
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@anchor" }]
    });

    expect(result).toMatchObject({
      status: "planned",
      instanceName: "PocketInstance2",
      splice: { replacementLines: ["  instance PocketInstance2 = Pocket(anchor: @anchor)"] }
    });
  });

  it("suffixes a generated name that conflicts with a forGroup iteration binding", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "for PocketInstance in range(min: 0, max: 1, step: 1) {",
      "  point Existing = coordinate(x: @PocketInstance, y: 0)",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.indexOf("point Existing"),
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@Top" }]
    });

    expect(result).toMatchObject({
      status: "planned",
      instanceName: "PocketInstance2",
      splice: { replacementLines: ["  instance PocketInstance2 = Pocket(anchor: @Top)"] }
    });
  });

  it("keeps suffix selection deterministic across ordinary declarations and binding conflicts", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "instance PocketInstance = Pocket(anchor: @Top)",
      "instance PocketInstance2 = Pocket(anchor: @Top)",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const input = {
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@Top" }]
    };
    const first = planModulePreviewInstance(input);
    const second = planModulePreviewInstance(input);

    expect(first).toMatchObject({ status: "planned", instanceName: "PocketInstance3" });
    expect(second).toEqual(first);
  });

  it("inserts after the statement containing the caret and before the next statement", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      "point Before = coordinate(x: 1, y: 0)",
      "point After = coordinate(x: 2, y: 0)"
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.indexOf("point Before") + "point Before".length,
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@Top" }]
    });

    expect(result).toMatchObject({
      status: "planned",
      splice: { startLine: 6, endLine: 5, replacementLines: ["instance PocketInstance = Pocket(anchor: @Top)"] }
    });
    if (result.status !== "planned") return;
    expect(result.expectedPatchedSource.split("\n")[5]).toBe("instance PocketInstance = Pocket(anchor: @Top)");
    expect(result.expectedPatchedSource.split("\n")[6]).toBe("point After = coordinate(x: 2, y: 0)");
  });

  it("inserts a nested target at a legal caller site with the caller indentation", () => {
    const source = [
      "nui 1",
      "module Outer() {",
      "  module Inner() {",
      "  }",
      "  point Existing = coordinate(x: 0, y: 0)",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.indexOf("point Existing"),
      target: targetFor(compiled, "Inner"),
      explicitArguments: []
    });

    expect(result).toMatchObject({
      status: "planned",
      instanceName: "InnerInstance",
      splice: { replacementLines: ["  instance InnerInstance = Inner()"] }
    });
  });

  it("rejects a target that is not visible at the insertion position", () => {
    const source = [
      "nui 1",
      "module Outer() {",
      "  module Inner() {",
      "  }",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: targetFor(compiled, "Inner"),
      explicitArguments: []
    });

    expect(result).toMatchObject({ status: "rejected", code: "target-not-visible", reason: "target-not-visible" });
  });

  it("rejects a same-name target with the wrong stable identity", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const target = targetFor(compiled, "Pocket");
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: { ...target, statementId: "module-preview:wrong" },
      explicitArguments: [{ name: "anchor", expression: "@Top" }]
    });

    expect(result).toMatchObject({ status: "rejected", code: "target-unavailable", reason: "target-not-exact-current" });
  });

  it("distinguishes missing semantic definitions from non-current target identities under target-unavailable", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const semanticAnalysis = compiled.moduleSemanticAnalysis!;
    const withoutDefinition = {
      ...compiled,
      moduleSemanticAnalysis: {
        ...semanticAnalysis,
        definitionsByStatementId: new Map()
      }
    } as CompiledDslDocument;
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled: withoutDefinition,
      insertionOffset: source.length,
      target: targetFor(compiled, "Pocket"),
      explicitArguments: []
    });

    expect(result).toMatchObject({
      status: "rejected",
      code: "target-unavailable",
      reason: "target-semantic-definition-missing"
    });
  });

  it("distinguishes malformed and undeclared arguments under invalid-argument", () => {
    const source = [
      "nui 1",
      "point Top = coordinate(x: 0, y: 0)",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const input = {
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: targetFor(compiled, "Pocket")
    };
    const malformed = planModulePreviewInstance({
      ...input,
      explicitArguments: [{ name: "anchor", expression: "" }]
    });
    const undeclared = planModulePreviewInstance({
      ...input,
      explicitArguments: [{ name: "other", expression: "@Top" }]
    });

    expect(malformed).toMatchObject({ status: "rejected", code: "invalid-argument", reason: "invalid-explicit-argument" });
    expect(undeclared).toMatchObject({ status: "rejected", code: "invalid-argument", reason: "undeclared-argument" });
  });

  it("rejects a generated call whose explicit expression fails semantic validation", () => {
    const source = [
      "nui 1",
      "module Pocket(anchor: point) {",
      "}",
      ""
    ].join("\n");
    const compiled = compileCurrent(source);
    const result = planModulePreviewInstance({
      source: { normalizedSource: source, sourceRevision: REVISION },
      compiled,
      insertionOffset: source.length,
      target: targetFor(compiled, "Pocket"),
      explicitArguments: [{ name: "anchor", expression: "@Missing" }]
    });

    expect(result).toMatchObject({ status: "rejected", code: "candidate-invalid", reason: "candidate-invalid" });
  });
});
