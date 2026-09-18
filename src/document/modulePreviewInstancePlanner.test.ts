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

    expect(result).toMatchObject({ status: "rejected", code: "target-not-visible" });
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

    expect(result).toMatchObject({ status: "rejected", code: "candidate-invalid" });
  });
});
