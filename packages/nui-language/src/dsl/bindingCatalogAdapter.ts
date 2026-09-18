// DSL adapter: compact visibility descriptors only. It never expands a
// binding into every visible scope.
import type { BindingSeed } from "../scalars/bindingCatalog";
import {
  buildCadContainerIndex,
  type CadContainerIndex,
  type ReconciledCadContainerInput
} from "../scalars/containerIndex";
import type { LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";
import type { DslStatement } from "./dslTypes";
import { parseDslReferenceToken, parseDslSourceReference } from "./dslReferenceTokens";
import { resolveSourceLexicalPath, type SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";

export type BuildDslBindingAdapterInput = {
  statements: readonly DslStatement[];
  scopeIndex: LexicalScopeIndex;
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  reconciledContainers: ReconciledCadContainerInput;
  sourceNamespace?: SourceLexicalNamespaceIndex;
};
export type DslBindingAdapterResult = {
  iterationBindings: readonly BindingSeed[];
  /** Geometry element data stays in the container index, outside this catalog. */
  containerIndex: CadContainerIndex;
};

export const buildDslBindingAdapterSeeds = ({
  statements,
  scopeIndex,
  stableStatementIdByIndex,
  reconciledContainers,
  sourceNamespace
}: BuildDslBindingAdapterInput): DslBindingAdapterResult => {
  const containerIndex = buildCadContainerIndex({ statements, scopeIndex, reconciled: reconciledContainers });
  const slotByStatementIndex = new Map<number, { scopeId: ScopeId; name: string; nameSpan: BindingSeed["nameSpan"] }>();
  for (const slot of scopeIndex.forGroupIterationSlots.values()) slotByStatementIndex.set(slot.statementIndex, slot);
  const iterationBindings: BindingSeed[] = [];
  // Source-order scan makes the adapter deterministic without sorting maps.
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const slot = slotByStatementIndex.get(statementIndex);
    if (slot && slot.name.trim()) {
      const stableStatementId = stableStatementIdByIndex.get(statementIndex);
      if (stableStatementId === undefined) throw new Error(`bindingCatalogAdapter: no stable statement id supplied for forGroup at index ${statementIndex}`);
      const statement = statements[statementIndex];
      const source = statement?.kind === "element" && statement.type === "forGroup" ? statement.forSource : undefined;
      const parsedSource = source ? parseDslSourceReference(source) : null;
      const sourcePath = parsedSource?.kind === "valid"
        ? parsedSource.reference.path
        : source
          ? parseDslReferenceToken(source)
          : null;
      const sourceDeclaration = sourcePath && sourceNamespace
        ? resolveSourceLexicalPath(sourceNamespace, statementIndex, sourcePath)
        : null;
      const sourceType = sourceDeclaration?.kind === "resolved" &&
        (sourceDeclaration.declaration.kind === "typedDeclaration" || sourceDeclaration.declaration.kind === "recordValue")
        ? sourceDeclaration.declaration.statement.kind === "typedDeclaration"
          ? sourceDeclaration.declaration.statement.valueType
          : null
        : null;
      const declaredType = sourceType?.kind === "array" ? sourceType.elementType : { kind: "number" as const };
      iterationBindings.push({ id: `binding:iteration:${stableStatementId}`, kind: "iteration", name: slot.name, nameSpan: slot.nameSpan, statementIndex, sourceOrder: 0, effectiveScopeId: slot.scopeId, visibility: { kind: "iteration", rootScopeId: slot.scopeId }, declaredType });
    }
  }
  return { iterationBindings, containerIndex };
};
