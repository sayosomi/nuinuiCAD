import { describe, expect, it } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { pickCandidates } from "../model/pickCandidates";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileSource = (source: string) => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `nested-export:${index}`] as const))
  });
};

const errorDiagnostics = (compiled: ReturnType<typeof compileSource>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const evaluateSource = (compiled: ReturnType<typeof compileSource>) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("nested export source did not compile");
  return evaluateElements(compiled.document.elements, {
    evaluationLimitIndex: compiled.document.evaluationLimitIndex,
    statementInfoByElementId: compiled.statementMap.byElementId,
    statementIdByStatementIndex: compiled.statementMap.statementIdByStatementIndex,
    sourceExecutionPositionByElementId: compiled.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId
  });
};

const source = [
  "nui 4",
  "module C() {",
  "  export line Out = segment(start: (0, 0), end: (10, 0))",
  "}",
  "module B() {",
  "  instance C1 = C()",
  "  line BUse = segment(start: (0, 0), end: (5, 0))",
  "  export line Forwarded = transformCopy(startPoint: @C1::Out.start, endPoint: @C1::Out.end, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@C1::Out])",
  "}",
  "module A() {",
  "  instance B1 = B()",
  "  line AUse = segment(start: (0, 0), end: (5, 0))",
  "  export line ForwardedAgain = transformCopy(startPoint: @B1::Forwarded.start, endPoint: @B1::Forwarded.end, scale: 1, angleDeg: 0, mirrorX: false, baseLines: [@B1::Forwarded])",
  "}",
  "instance Root = A()",
  "line RootUse = segment(start: (0, 0), end: (5, 0))"
].join("\n");

describe("multi-level Module export candidate visibility", () => {
  it("allows direct nested exports and requires each explicit re-export hop", () => {
    const compiled = compileSource(source);
    expect(errorDiagnostics(compiled)).toEqual([]);
    expect(compiled.document).not.toBeNull();
    const result = evaluateSource(compiled);
    expect(result.errors).toEqual([]);

    const elements = compiled.document!.elements;
    const ancestryNames = (element: typeof elements[number]) => {
      const names: string[] = [];
      let parentId = element.parentGroupId;
      while (parentId) {
        const parent = elements.find((candidate) => candidate.id === parentId);
        if (!parent) break;
        names.push(parent.name);
        parentId = parent.parentGroupId;
      }
      return names;
    };
    const elementAtPath = (name: string, ancestors: readonly string[]) => elements.find((element) =>
      element.name === name && ancestors.every((ancestor) => ancestryNames(element).includes(ancestor))
    );
    const cOut = elementAtPath("Out", ["Root", "B1", "C1"]);
    const bForwarded = elementAtPath("Forwarded", ["Root", "B1"]);
    const aForwardedAgain = elementAtPath("ForwardedAgain", ["Root"]);
    const bUse = elementAtPath("BUse", ["Root", "B1"]);
    const aUse = elementAtPath("AUse", ["Root"]);
    const rootUse = elements.find((element) => element.name === "RootUse");
    if (!cOut || !bForwarded || !aForwardedAgain || !bUse || !aUse || !rootUse) {
      throw new Error("nested export fixture runtime hierarchy is incomplete");
    }

    const context = {
      moduleMaterialization: compiled.moduleMaterialization,
      moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
      sourceLexicalNamespace: compiled.sourceLexicalNamespace,
      statementInfoByElementId: compiled.statementMap!.byElementId
    };
    const sourceReferencesFor = (targetElementId: string) => pickCandidates(elements, result, {
      activePointPickTarget: null,
      activeLinePickTarget: { elementId: targetElementId, parameterKey: "baseLineIds" },
      activeNumericReferencePickTarget: null,
      // Keep all runtime geometry in the candidate input so this assertion
      // exercises the semantic boundary rather than only flat source order.
      referenceElements: elements,
      moduleSemanticContext: context
    }).flatMap((candidate) => candidate.options.flatMap((option) =>
      option.kind === "line" && option.sourceReference ? [option.sourceReference.base] : []
    ));

    const bReferences = sourceReferencesFor(bUse.id);
    expect(bReferences).toContain("C1::Out");
    expect(bReferences).not.toContain("B1::Forwarded");

    const aReferences = sourceReferencesFor(aUse.id);
    expect(aReferences).toContain("B1::Forwarded");
    expect(aReferences).not.toContain("C1::Out");
    expect(aReferences).not.toContain("B1::C1::Out");

    const rootReferences = sourceReferencesFor(rootUse.id);
    expect(rootReferences).toContain("Root::ForwardedAgain");
    expect(rootReferences).not.toContain("B1::Forwarded");
    expect(rootReferences).not.toContain("C1::Out");
    expect(rootReferences).not.toContain("module-runtime:");
    expect(cOut.id).toMatch(/^module-runtime:/);

    expect(errorDiagnostics(compileSource(source))).toEqual([]);
  });
});
