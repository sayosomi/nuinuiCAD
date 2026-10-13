import { describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { createModuleRuntimeContext } from "../dsl/moduleRuntimeContext";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "../document/multiDocumentModuleSemantics";
import {
  buildMultiDocumentImportGraph,
  type MultiDocumentSavedSourceLoader
} from "../document/multiDocumentImportGraph";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost
} from "../document/multiDocumentPrimitives";
import { compileModuleScalarRuntime } from "./moduleScalarRuntime";

const compileWithUnsupportedGeometryBuiltinTargets = (compiled: CompiledDslDocument) => {
  const moduleSemanticAnalysis = compiled.moduleSemanticAnalysis;
  const moduleMaterialization = compiled.moduleMaterialization;
  const moduleGeometryRuntime = compiled.moduleGeometryRuntime;
  const statementMap = compiled.statementMap;
  const stableStatementIdByIndex = statementMap?.statementIdByStatementIndex;
  if (!compiled.document || !moduleSemanticAnalysis || !moduleMaterialization || !moduleGeometryRuntime || !statementMap || !stableStatementIdByIndex) {
    throw new Error("compiled Module runtime inputs are required for unsupported-target diagnostics");
  }
  return compileModuleScalarRuntime({
    statements: compiled.statements,
    stableStatementIdByIndex,
    moduleSemanticAnalysis,
    moduleMaterialization,
    documentBindingAnalysis: compiled.bindingAnalysis,
    documentScalarProgram: compiled.scalarProgram,
    reconciledContainers: {
      elementIdByStatementIndex: statementMap.elementIdByStatementIndex,
      elements: compiled.document.elements
    },
    elements: compiled.document.elements,
    sourceScopeIndex: compiled.sourceLexicalNamespace?.scopeIndex,
    sourceNamespace: compiled.sourceLexicalNamespace,
    moduleGeometryRuntime: {
      ...moduleGeometryRuntime,
      // Force the production lowering's existing unresolved-target path after
      // semantic resolution, just as a genuinely unsupported runtime target does.
      resolveBuiltinTarget: () => undefined
    },
    moduleRuntimeContext: compiled.moduleRuntimeContext,
    drawingModifiers: compiled.document.modifiers,
    transformationRecipes: compiled.runtimeTransformationRecipes
  });
};

describe("Module geometry carry source order lowering", () => {
  it("preserves Module-materialized binding ownership as the appended catalog lane", () => {
    const source = [
      "nui 1",
      "module M(input: number) {",
      "  const local: number = @input + 1",
      "  export const output: number = @local",
      "}",
      "instance One = M(input: 10)",
      "const result: number = @One::output"
    ].join("\n");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    const catalog = compiled.doc.bindingAnalysis?.catalog;
    const versions = compiled.doc.bindingVersions?.versions ?? [];
    const appendedBindings = new Set(catalog?.bindings
      .filter((binding) => binding.catalogOrder === "append")
      .map((binding) => binding.id));
    const appendedVersions = versions.filter((version) => appendedBindings.has(version.bindingId));

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(appendedVersions.length).toBeGreaterThan(0);
    expect(appendedVersions.every((version) => version.catalogOrder === "append")).toBe(true);
    expect(appendedVersions.some((version) => version.control.kind === "linear")).toBe(true);
  });

  it("projects the original Module point carry onto the canonical integer order", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 2, y: 3)",
      "  for i in range(min: 0, max: 0, step: 1) carry last: point = @P {",
      "    next last = @P",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "instance A = M()"
    ].join("\n");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    const carries = [...(compiled.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.geometryCarries ?? []);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(carries).toHaveLength(1);
    expect(carries[0]!.nextSourceOrder).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(carries[0]!.nextSourceOrder)).toBe(true);
  });

  it("keeps unsupported endpoint diagnostics attached to exact declarations with matching spans", () => {
    const source = [
      "nui 1",
      "line Axis = segment(start: (0, 0), end: (1, 0))",
      "line A = segment(start: (0, 0), end: (0, 1))",
      "module MeasureOne() {",
      "  line source = segment(start: (0, 0), end: (0, 1))",
      "  line axis = segment(start: (0, 0), end: (1, 0))",
      "  const angle: number = lineAngle(@source.start, @axis.start)",
      "}",
      "module MeasureTwo() {",
      "  line source = segment(start: (0, 0), end: (0, 1))",
      "  line axis = segment(start: (0, 0), end: (1, 0))",
      "  const angle: number = lineAngle(@source.start, @axis.start)",
      "}",
      "instance First = MeasureOne()",
      "instance Second = MeasureTwo()",
      "const alpha: number = lineAngle(@A.start, @Axis.start)",
      "const bravo: number = lineAngle(@A.start, @Axis.start)"
    ].join("\n");
    const compiledText = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    expect(compiledText.status).toBe("valid");

    const compiled = compiledText.currentCompiled;
    const expectedSourceLines = [7, 12, 16, 17];
    const expectedStatementIndices = expectedSourceLines.map((line) => {
      const statementIndex = compiled.statements.findIndex((statement) =>
        statement.kind === "typedDeclaration" && statement.line === line
      );
      if (statementIndex < 0) throw new Error(`source declaration on line ${line} was not parsed`);
      return statementIndex;
    });

    const diagnostics = compileWithUnsupportedGeometryBuiltinTargets(compiled).diagnostics.filter(
      (diagnostic) => diagnostic.code === "builtin-geometry-target-unavailable"
    );
    expect(diagnostics).toHaveLength(8);
    for (const [index, statementIndex] of expectedStatementIndices.entries()) {
      const sourceLine = expectedSourceLines[index];
      const ownedDiagnostics = diagnostics.filter((diagnostic) => diagnostic.statementIndex === statementIndex);
      expect(ownedDiagnostics, `diagnostics owned by source line ${sourceLine}`).toHaveLength(2);
      expect(ownedDiagnostics.map((diagnostic) => diagnostic.line)).toEqual([sourceLine, sourceLine]);
      expect(ownedDiagnostics.every((diagnostic) => diagnostic.logicalSpan !== undefined)).toBe(true);
    }

    const rootCallSpansByStatement = expectedStatementIndices.slice(2).map((statementIndex) =>
      diagnostics.filter((diagnostic) => diagnostic.statementIndex === statementIndex)
        .map((diagnostic) => diagnostic.logicalSpan)
    );
    expect(rootCallSpansByStatement[0]).toEqual(rootCallSpansByStatement[1]);
  });

  it("keeps imported Module endpoint diagnostics out of root statement ownership", async () => {
    const importedDocumentId = documentIdFromHost("foreign-module-document");
    const rootDocumentId = documentIdFromHost("root-module-document");
    const importedSource = [
      "nui 1",
      "export module Measure() {",
      "  line source = segment(start: (0, 0), end: (0, 1))",
      "  line axis = segment(start: (0, 0), end: (1, 0))",
      "  const angle: number = lineAngle(@source.start, @axis.start)",
      "}"
    ].join("\n");
    const rootText = [
      "nui 1",
      "import \"./measure.nui\" as foreign",
      "instance use = foreign::Measure()"
    ].join("\n");
    const root = {
      kind: "root-current" as const,
      documentId: rootDocumentId,
      normalizedSource: rootText,
      sourceRevision: 1
    };
    const imported = {
      kind: "dependency-saved" as const,
      documentId: importedDocumentId,
      savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:foreign-module-document"),
      normalizedSource: importedSource
    };
    const loader: MultiDocumentSavedSourceLoader = {
      async loadSavedDependency(importerDocumentId, relativePath) {
        return importerDocumentId === rootDocumentId && relativePath === "./measure.nui"
          ? { status: "loaded", snapshot: imported }
          : { status: "failed", reason: "missing" };
      }
    };
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader,
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const moduleRuntimeContext = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(rootDocumentId)!;
    const compiled = compileDslDocument(rootText, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext
    });

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(moduleRuntimeContext.valid).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const diagnostics = compileWithUnsupportedGeometryBuiltinTargets(compiled).diagnostics.filter(
      (diagnostic) => diagnostic.code === "builtin-geometry-target-unavailable"
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([5, 5]);
    expect(diagnostics.every((diagnostic) => diagnostic.statementIndex === undefined)).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.logicalSpan === undefined)).toBe(true);
  });
});
