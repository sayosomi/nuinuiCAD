import type { StatementIdentity } from "../document/statementIdentity";
import { scopeChain, type ScopeId } from "../scalars/lexicalScopeIndex";
import {
  resolveSourceLexicalPath,
  resolveSourceLexicalPathFromDeclaration,
  type SourceLexicalDeclaration,
  type SourceLexicalLookup,
  type SourceLexicalNamespaceIndex
} from "./sourceLexicalNamespaceIndex";
import type { DslReferencePath } from "./dslReferenceTokens";

/** The synthetic bindings which module semantic analysis overlays on the real
 * source namespace. The value is deliberately generic so completion &&
 * semantic analysis cannot grow two subtly different lookup algorithms. */
export type ModuleLexicalParameterOverlay<T, D = unknown> = {
  bodyScopeId: ScopeId;
  value: D;
  parameters: readonly { index: number; name: string; value: T }[];
};

export type ModuleLexicalLookup<T, D = unknown> =
  | { kind: "parameter"; definition: ModuleLexicalParameterOverlay<T, D>; parameter: { index: number; name: string; value: T } }
  | { kind: "iteration"; statementId: StatementIdentity; statementIndex: number; name: string }
  | SourceLexicalLookup;

export type ModuleLexicalPathLookup<T, D = unknown> =
  | ModuleLexicalLookup<T, D>
  | {
      kind: "invalidOverlayTraversal";
      overlay: "parameter" | "iteration";
      name: string;
      segment: string;
      segmentIndex: number;
    };

export type ModuleLexicalResolutionInput<T, D = unknown> = {
  sourceNamespace: SourceLexicalNamespaceIndex;
  stableStatementIdByIndex: ReadonlyMap<number, StatementIdentity>;
  parameterOverlays?: readonly ModuleLexicalParameterOverlay<T, D>[];
};

export type ModuleLexicalResolutionPosition = {
  /** An existing lexical scope from the last-good namespace. */
  scopeId?: ScopeId;
  /** Source-order position; may be one past the last compiled statement. */
  sourceOrderIndex?: number;
};

const statementIdAt = (ids: ReadonlyMap<number, StatementIdentity>, index: number): StatementIdentity => {
  const id = ids.get(index);
  if (id === undefined) throw new Error(`moduleLexicalResolution: no stable statement identity for index ${index}`);
  return id;
};

/** Resolves one name with the module parameter/iteration overlays applied.
 * This is the sole source-order + nearest-scope lookup used by module
 * semantic analysis && module completion. */
export const resolveModuleLexicalDeclaration = <T, D = unknown>(
  input: ModuleLexicalResolutionInput<T, D>,
  statementIndex: number,
  name: string,
  position: ModuleLexicalResolutionPosition = {}
): ModuleLexicalLookup<T, D> => {
  const startScope = position.scopeId ?? input.sourceNamespace.scopeIndex.scopeOfStatement.get(statementIndex);
  if (!startScope) return { kind: "undefined" };
  const sourceOrderIndex = position.sourceOrderIndex ?? statementIndex;
  let firstFuture: { scopeId: ScopeId; declarations: readonly SourceLexicalDeclaration[] } | null = null;
  for (const scopeId of scopeChain(input.sourceNamespace.scopeIndex, startScope)) {
    const declarations = input.sourceNamespace.declarationsByScopeAndName.get(scopeId)?.get(name) ?? [];
    const visible = declarations.filter((declaration) => declaration.statementIndex < sourceOrderIndex);
    if (visible.length === 1) return { kind: "resolved", declaration: visible[0] };
    if (visible.length > 1) return { kind: "ambiguous", scopeId, declarations: visible };
    const iteration = input.sourceNamespace.scopeIndex.forGroupIterationSlots.get(scopeId);
    if (iteration?.name === name && iteration.statementIndex < sourceOrderIndex) {
      return {
        kind: "iteration",
        statementId: statementIdAt(input.stableStatementIdByIndex, iteration.statementIndex),
        statementIndex: iteration.statementIndex,
        name
      };
    }
    const overlay = input.parameterOverlays?.find((candidate) => candidate.bodyScopeId === scopeId);
    const parameter = overlay?.parameters.find((candidate) => candidate.name === name);
    if (parameter) return { kind: "parameter", definition: overlay!, parameter };
    if (declarations.length > 0 && !firstFuture) firstFuture = { scopeId, declarations };
  }
  return firstFuture ? { kind: "forward", ...firstFuture } : { kind: "undefined" };
};

/** Resolve a qualified module-body path without duplicating source namespace
 * traversal. Only the first segment is overlay-aware; once it resolves to a
 * source declaration, the canonical source path helper owns the remaining
 * segments && their source-order diagnostics. */
export const resolveModuleLexicalPath = <T, D = unknown>(
  input: ModuleLexicalResolutionInput<T, D>,
  statementIndex: number,
  path: DslReferencePath,
  position: ModuleLexicalResolutionPosition = {}
): ModuleLexicalPathLookup<T, D> => {
  if (path.segments.length === 0) return { kind: "undefined" };
  if (path.absolute) return resolveSourceLexicalPath(input.sourceNamespace, statementIndex, path);

  const first = resolveModuleLexicalDeclaration(input, statementIndex, path.segments[0], position);
  if (path.segments.length === 1) return first;
  if (first.kind === "parameter" || first.kind === "iteration") {
    return {
      kind: "invalidOverlayTraversal",
      overlay: first.kind,
      name: path.segments[0],
      segment: path.segments[1],
      segmentIndex: 1
    };
  }
  if (first.kind !== "resolved") return first;
  const lookup = resolveSourceLexicalPathFromDeclaration(
    input.sourceNamespace,
    statementIndex,
    first.declaration,
    path.segments.slice(1),
    position.sourceOrderIndex ?? statementIndex
  );
  // Module lexical resolution does not supply an external namespace resolver.
  // Keep an imported namespace fail-closed here instead of widening the
  // established module lookup contract to multi-document catalog payloads.
  return lookup.kind === "external" ? { kind: "undefined" } : lookup;
};

const isDescendantOrSelf = (index: SourceLexicalNamespaceIndex, child: ScopeId, ancestor: ScopeId): boolean => {
  let current: ScopeId | null = child;
  while (current) {
    if (current === ancestor) return true;
    current = index.scopeIndex.scopes.get(current)?.parentId ?? null;
  }
  return false;
};

/** Shared scope ancestry proof used by Module semantic completion to classify
 * a nested dirty site without reimplementing lexical declaration lookup. */
export const isScopeWithin = isDescendantOrSelf;

/** Module bodies may resolve declarations only inside their own body scope.
 * Keep this boundary check beside the shared lookup so completion cannot
 * accidentally publish a document declaration that semantic analysis rejects. */
export const isModuleLookupVisibleWithinBody = <T, D = unknown>(
  sourceNamespace: SourceLexicalNamespaceIndex,
  lookup: ModuleLexicalLookup<T, D>,
  bodyScopeId: ScopeId
): boolean => {
  if (lookup.kind === "resolved") return isDescendantOrSelf(sourceNamespace, lookup.declaration.scopeId, bodyScopeId);
  if (lookup.kind === "iteration") {
    const scope = sourceNamespace.scopeIndex.scopeOfStatement.get(lookup.statementIndex);
    return Boolean(scope && isDescendantOrSelf(sourceNamespace, scope, bodyScopeId));
  }
  if (lookup.kind === "parameter") return lookup.definition.bodyScopeId === bodyScopeId;
  return false;
};