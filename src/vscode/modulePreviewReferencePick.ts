import { moduleGeometryInterfaceTypeOf } from "../dsl/moduleGeometryInterfaces";
import type { ModulePreviewRootResult } from "../dsl/modulePreviewRoot";
import type { StatementIdentity } from "../document/statementIdentity";
import type { DslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import type { VscodeModulePreviewReferencePickProof } from "./modulePreviewProtocol";

/**
 * Derives the shared candidate target from the exact Module definition that
 * owns a Preview row. The anchor is the definition's declaration/caller scope;
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
  const definition = root.moduleSemanticAnalysis.definitionsByStatementId.get(definitionStatementId);
  const parameter = definition?.parameters.find((candidate) => candidate.parameterIndex === parameterIndex);
  const statement = definition && root.candidateCompiledDocument.statements[definition.statementIndex];
  const statementInfo = definition && root.candidateCompiledDocument.statementMap?.statements[definition.statementIndex];
  const namespace = root.candidateCompiledDocument.sourceLexicalNamespace;
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
    statement.sourceRevision !== root.candidateCompiledDocument.spans.sourceMap.sourceRevision
  ) return null;

  const statementRange = {
    from: statement.documentRange.from,
    to: statement.documentRange.to,
    startLine: statementInfo.range.startLine,
    endLine: statementInfo.range.endLine
  };
  return {
    sourceAnchor: {
      sourceRevision: root.candidateCompiledDocument.spans.sourceMap.sourceRevision,
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
