import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import {
  afterStatement,
  beforeStatement,
  readBindingVersionAtPosition
} from "./bindingVersions";

const compileWithStableIds = (source: string, stableIds?: ReadonlyMap<number, string>) => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const assignedStatementIds = stableIds ?? new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]));
  return compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
};

describe("binding version graph", () => {
  it("keeps a recoverable invalid let as poisoned version 0 and connects a valid set", () => {
    const compiled = compileWithStableIds(["nui 4", "let broken: number = @missing", "set broken = 12"].join("\n"));
    const graph = compiled.bindingVersions!;
    expect(graph.versions).toHaveLength(2);
    const [declaration, set] = graph.versions;
    expect(declaration).toMatchObject({
      kind: "declare",
      id: "statement:test:1",
      bindingKind: "let",
      initialState: { kind: "poisoned", reason: "invalid-declaration" }
    });
    expect(set).toMatchObject({
      kind: "set",
      id: "statement:test:2",
      predecessorId: declaration.id,
      initialState: { kind: "uncomputed" }
    });
  });

  it("marks dependency-poisoned lets while allowing their later recovery set", () => {
    const compiled = compileWithStableIds([
      "nui 4",
      "let broken: number = @missing",
      "let dependent: number = @broken + 1",
      "set dependent = 8"
    ].join("\n"));
    const graph = compiled.bindingVersions!;
    expect(graph.versions.find((version) => version.id === "statement:test:2")).toMatchObject({
      initialState: { kind: "poisoned", reason: "invalid-dependency" }
    });
    expect(graph.versions.find((version) => version.id === "statement:test:3")).toMatchObject({
      predecessorId: "statement:test:2"
    });
  });

  it("uses explicit before/after statement boundaries without walking a version chain", () => {
    const compiled = compileWithStableIds(["nui 4", "let x: number = 1", "set x = 2", "set x = 3"].join("\n"));
    const graph = compiled.bindingVersions!;
    const bindingId = graph.versions[0].bindingId;
    expect(readBindingVersionAtPosition(graph, bindingId, beforeStatement(1))).toBeUndefined();
    expect(readBindingVersionAtPosition(graph, bindingId, afterStatement(1))?.id).toBe("statement:test:1");
    expect(readBindingVersionAtPosition(graph, bindingId, beforeStatement(2))?.id).toBe("statement:test:1");
    expect(readBindingVersionAtPosition(graph, bindingId, afterStatement(2))?.id).toBe("statement:test:2");
    expect(readBindingVersionAtPosition(graph, bindingId, beforeStatement(3))?.id).toBe("statement:test:2");
    expect(readBindingVersionAtPosition(graph, bindingId, afterStatement(3))?.id).toBe("statement:test:3");
  });

  it("keeps shadowed lets in separate chains and creates no const successor", () => {
    const compiled = compileWithStableIds([
      "nui 4",
      "const fixed: number = 1",
      "let x: number = 2",
      "group G {",
      "  let x: number = 3",
      "  set x = 4",
      "}",
      "set x = 5"
    ].join("\n"));
    const graph = compiled.bindingVersions!;
    const fixed = graph.versions.filter((version) => version.bindingId === "binding:statement:test:1");
    const outer = graph.versions.filter((version) => version.bindingId === "binding:statement:test:2");
    const inner = graph.versions.filter((version) => version.bindingId === "binding:statement:test:4");
    expect(fixed).toHaveLength(1);
    expect(outer.map((version) => version.id)).toEqual(["statement:test:2", "statement:test:7"]);
    expect(inner.map((version) => version.id)).toEqual(["statement:test:4", "statement:test:5"]);
  });

  it("preserves conditional and nested forGroup owner chains from lexical metadata", () => {
    const source = [
      "nui 4",
      "if (true) {",
      "  for i in range(from: 0, count: 2) {",
      "    let x: number = 1",
      "    set x = 2",
      "  }",
      "} else {",
      "  let y: number = 3",
      "}",
      "group Plain {",
      "  let z: number = 4",
      "}"
    ].join("\n");
    const stableIds = new Map([
      [0, "header"], [1, "if-choice"], [2, "for-repeat"], [3, "decl-x"], [4, "set-x"], [5, "end-for"],
      [6, "else"], [7, "decl-y"], [8, "end-if"], [9, "group-plain"], [10, "decl-z"], [11, "end-group"]
    ]);
    const compiled = compileWithStableIds(source, stableIds);
    const graph = compiled.bindingVersions!;
    const x = graph.versions.find((version) => version.id === "decl-x")!;
    const y = graph.versions.find((version) => version.id === "decl-y")!;
    const z = graph.versions.find((version) => version.id === "decl-z")!;
    expect(x.control).toMatchObject({
      scopeId: x.scopeId,
      kind: "forGroup",
      ownerChain: [
        { kind: "conditionalBranch", ownerStatementId: "if-choice", branch: "then", scopeId: expect.any(String) },
        { kind: "forGroup", ownerStatementId: "for-repeat", scopeId: x.scopeId }
      ]
    });
    expect(y.control).toMatchObject({
      kind: "conditionalBranch",
      ownerChain: [{ kind: "conditionalBranch", ownerStatementId: "if-choice", branch: "else" }]
    });
    expect(z.control).toMatchObject({ scopeId: z.scopeId, kind: "linear", ownerChain: [] });
  });

  it("retains control owner identities after an unrelated edit when reconciler identities are reused", () => {
    const baseline = regenerateCanonicalFromModel(emptyDocument(), 4);
    const source = [
      "nui 4",
      "if (true) {",
      "  for i in range(from: 0, count: 2) {",
      "    let x: number = 1",
      "    set x = 2",
      "  }",
      "}"
    ].join("\n");
    const first = compileCanonicalText(baseline, source);
    expect(first.status).toBe("valid");
    const edited = compileCanonicalText(first, source.replace("set x = 2", "set x = 3"));
    expect(edited.status).toBe("valid");
    expect(edited.doc.bindingVersions!.versions.map((version) => version.id)).toEqual(first.doc.bindingVersions!.versions.map((version) => version.id));
    expect(edited.doc.bindingVersions!.versions[0].control).toEqual(first.doc.bindingVersions!.versions[0].control);
  });
});
