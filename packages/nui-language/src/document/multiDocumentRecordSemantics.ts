import { documentRecordTypeIdentity, type RecordDefinitionSemantic } from "../dsl/recordSemanticAnalysis";
import { buildSourceLexicalNamespaceIndex, type SourceLexicalExternalNamespaceResolver } from "../dsl/sourceLexicalNamespaceIndex";
import type { MultiDocumentDeclarationContributor, MultiDocumentSourceArtifact } from "./multiDocumentImportGraph";
import { qualifySemanticIdentity, qualifySourceLocation, sourceIdentityOf } from "./multiDocumentPrimitives";
import type { MultiDocumentPublicApiEntry } from "./multiDocumentPublicApi";

/** Core record declarations participate in the generic public/private catalog. */
export const recordDeclarationContributor: MultiDocumentDeclarationContributor<never> = ({ source, parsed, statementIdByStatementIndex }) =>
  parsed.statements.flatMap((statement, statementIndex) => {
    if (statement.kind !== "recordDefinition" || statement.enclosing || !statement.name) return [];
    const segments = statement.namePhysicalSpan?.segments;
    const range = segments?.length
      ? { from: segments[0]!.from, to: segments.at(-1)!.to }
      : { from: statement.documentRange.from, to: statement.documentRange.to };
    return [{
      identity: qualifySemanticIdentity(source.documentId, statementIdByStatementIndex.get(statementIndex)!),
      family: "record" as const,
      name: statement.name,
      exported: statement.exported,
      declaration: qualifySourceLocation(sourceIdentityOf(source), range)
    }];
  });

/** Bind one exact source artifact after the existing graph has resolved its
 * saved dependencies. Definitions needed for nested fields retain their
 * original identities; visibility still comes solely from the public catalog.
 * Cached file-local artifacts are never rewritten with graph-bound semantics. */
export const bindDocumentRecordSemantics = (
  artifact: MultiDocumentSourceArtifact,
  dependencies: readonly MultiDocumentSourceArtifact[],
  externalNamespaceResolver: SourceLexicalExternalNamespaceResolver
) => {
  const externalDefinitions = new Map<string, RecordDefinitionSemantic>();
  for (const dependency of dependencies) {
    for (const [identity, definition] of dependency.sourceLexicalNamespace.recordSemanticAnalysis?.definitionsByStatementId ?? []) {
      externalDefinitions.set(identity, definition);
    }
  }
  return buildSourceLexicalNamespaceIndex(artifact.parsed.statements, artifact.statementIdByStatementIndex, {
    externalNamespaceResolver,
    recordTypes: {
      identityForDefinition: id => documentRecordTypeIdentity(artifact.source.documentId, id),
      externalDefinitions,
      resolveExternalDefinition: member => {
        const entry = member.value as MultiDocumentPublicApiEntry;
        return entry.family === "record"
          ? externalDefinitions.get(documentRecordTypeIdentity(entry.identity.documentId, entry.identity.localIdentity)) ?? null : null;
      }
    }
  });
};
