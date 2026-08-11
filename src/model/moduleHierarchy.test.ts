import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { buildModuleHierarchy, moduleHierarchyNodeMatches } from "./moduleHierarchy";

const compile = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `hierarchy:${index}`] as const))
  });
};

describe("moduleHierarchy", () => {
  it("uses runtime origin metadata to distinguish instance, private, and exported children", () => {
    const compiled = compile([
      "nui 3",
      "module M() {",
      "  point Private = coordinate(x: 0, y: 0)",
      "  export line Public = segment(start: (0, 0), end: (10, 0))",
      "}",
      "group Outer {",
      "  module Call = M()",
      "}"
    ].join("\n"));
    expect(compiled.document).not.toBeNull();

    const roots = buildModuleHierarchy({
      elements: compiled.document!.elements,
      moduleMaterialization: compiled.moduleMaterialization,
      moduleSemanticAnalysis: compiled.moduleSemanticAnalysis
    });
    const outer = roots.find((node) => node.displayName === "Outer")!;
    const instance = outer.children.find((node) => node.displayName === "Call")!;
    expect(instance.kind).toBe("moduleInstance");
    expect(instance.moduleDefinitionName).toBe("M");
    expect(instance.children.map((node) => [node.displayName, node.memberVisibility])).toEqual([
      ["Private", "private"],
      ["Public", "exported"]
    ]);
  });

  it("matches module definitions and descendants without requiring source duplication", () => {
    const node = {
      id: "instance",
      element: {} as never,
      displayName: "写し",
      typeLabel: "module instance",
      kind: "moduleInstance" as const,
      moduleDefinitionName: "縫い代写し",
      children: [{
        id: "private",
        element: {} as never,
        displayName: "脇コピー",
        typeLabel: "offset line",
        kind: "materializedChild" as const,
        memberVisibility: "private" as const,
        children: []
      }]
    };
    expect(moduleHierarchyNodeMatches(node, "縫い代写し")).toBe(true);
    expect(moduleHierarchyNodeMatches(node, "脇コピー")).toBe(true);
    expect(moduleHierarchyNodeMatches(node, "not-present")).toBe(false);
  });
});
