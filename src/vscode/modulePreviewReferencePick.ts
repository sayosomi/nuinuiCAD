import { moduleGeometryInterfaceTypeOf } from "@nuinuicad/nui-language";
import type { ModulePreviewRootResult } from "../dsl/modulePreviewRoot";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";
import type { DslReferencePickTarget } from "@nuinuicad/nui-language";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { VscodeModulePreviewReferencePickProof } from "./modulePreviewProtocol";

const modulePreviewReferencePickTargetForCompiled = ({
  compiled,
  moduleSemanticAnalysis,
  definitionStatementId,
  parameterIndex,
  expectedGeometryInterface
}: {
  compiled: CompiledDslDocument;
  moduleSemanticAnalysis: NonNullable<CompiledDslDocument["moduleSemanticAnalysis"]>;
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  expectedGeometryInterface?: VscodeModulePreviewReferencePickProof["expectedGeometryInterface"];
}): DslReferencePickTarget | null => {
  const definition = moduleSemanticAnalysis.definitionsByStatementId.get(definitionStatementId);
  const parameter = definition?.parameters.find((candidate) => candidate.parameterIndex === parameterIndex);
  const statement = definition && compiled.statements[definition.statementIndex];
  const statementInfo = definition && compiled.statementMap?.statements[definition.statementIndex];
  const namespace = compiled.sourceLexicalNamespace;
  const scopeId = definition && namespace?.scopeIndex.scopeOfStatement.get(definition.statementIndex);
  const geometryInterface = moduleGeometryInterfaceTypeOf(parameter?.type);
  if (
    !definition ||
    !parameter ||
    !statement ||
    statement.kind !== "moduleDefinition" ||
    !statementInfo ||
    !scopeId ||
    scopeId !== definition.declarationScopeId ||
    geometryInterface === null ||
    (expectedGeometryInterface !== undefined && geometryInterface !== expectedGeometryInterface) ||
    definition.statementId !== definitionStatementId ||
    statement.sourceRevision !== compiled.spans.sourceMap.sourceRevision
  ) return null;

  const statementRange = {
    from: statement.documentRange.from,
    to: statement.documentRange.to,
    startLine: statementInfo.range.startLine,
    endLine: statementInfo.range.endLine
  };
  return {
    sourceAnchor: {
      sourceRevision: compiled.spans.sourceMap.sourceRevision,
      statementId: definition.statementId,
      statementIndex: definition.statementIndex,
      sourceOrderIndex: definition.statementIndex,
      scopeId: definition.declarationScopeId,
      statementRange
    },
    expectedGeometryInterface: geometryInterface,
    role: "geometry",
    multiplicity: "single",
    range: { from: statementRange.from, to: statementRange.to }
  };
};

/**
 * Derives the shared candidate target from the exact Module definition that
 * owns a Preview invocation argument. The anchor is the definition's declaration/caller scope;
 * it is never obtained from a Source caret or an editable Source range.
 */
export const modulePreviewReferencePickTargetFor = ({
  root,
  definitionStatementId,
  parameterIndex,
  expectedGeometryInterface
}: {
  root: ModulePreviewRootResult;
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  expectedGeometryInterface?: VscodeModulePreviewReferencePickProof["expectedGeometryInterface"];
}): DslReferencePickTarget | null => {
  return modulePreviewReferencePickTargetForCompiled({
    compiled: root.candidateCompiledDocument,
    moduleSemanticAnalysis: root.moduleSemanticAnalysis,
    definitionStatementId,
    parameterIndex,
    expectedGeometryInterface
  });
};

/**
 * Resolve a geometry value site directly against the current authored Source.
 * This is the candidate authority while a Preview invocation is invalid and
 * therefore cannot produce a materialized Preview root yet.
 */
export const modulePreviewReferencePickTargetForAuthoredSource = ({
  compiled,
  definitionStatementId,
  parameterIndex,
  expectedGeometryInterface
}: {
  compiled: CompiledDslDocument;
  definitionStatementId: StatementIdentity;
  parameterIndex: number;
  expectedGeometryInterface?: VscodeModulePreviewReferencePickProof["expectedGeometryInterface"];
}): DslReferencePickTarget | null => {
  if (!compiled.moduleSemanticAnalysis) return null;
  return modulePreviewReferencePickTargetForCompiled({
    compiled,
    moduleSemanticAnalysis: compiled.moduleSemanticAnalysis,
    definitionStatementId,
    parameterIndex,
    expectedGeometryInterface
  });
};
