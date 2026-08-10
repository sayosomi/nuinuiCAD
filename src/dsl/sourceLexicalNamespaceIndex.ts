import { isGeometryDeclarationCategory } from "./dslConstructions";
import { isInUnloweredModuleSubtree } from "./dslCompilationGuard";
import { buildLexicalScopeIndexFromStatements } from "./lexicalScopeIndexAdapter";
import type { DslDiagnostic, DslSpan, DslStatement } from "./dslTypes";
import { scopeChain, type IncludeStatement, type LexicalScopeIndex, type ScopeId } from "../scalars/lexicalScopeIndex";

/** Named declarations that participate in the source-level lexical namespace. */
export type SourceLexicalDeclarationKind =
  | "moduleDefinition"
  | "moduleInstance"
  | "group"
  | "geometry"
  | "conditionalGroup"
  | "forGroup"
  | "typedDeclaration";

export type SourceLexicalDeclaration = {
  scopeId: ScopeId;
  statementIndex: number;
  statementId: string;
  kind: SourceLexicalDeclarationKind;
  name: string;
  nameSpan: DslSpan | null;
  statement: DslStatement;
};

export type SourceLexicalNamespaceCollision = {
  scopeId: ScopeId;
  name: string;
  declarations: readonly [SourceLexicalDeclaration, SourceLexicalDeclaration];
};

export type SourceLexicalNamespaceIndex = {
  scopeIndex: LexicalScopeIndex;
  declarationsByScope: ReadonlyMap<ScopeId, readonly SourceLexicalDeclaration[]>;
  declarationsByScopeAndName: ReadonlyMap<ScopeId, ReadonlyMap<string, readonly SourceLexicalDeclaration[]>>;
  allDeclarations: readonly SourceLexicalDeclaration[];
  collisions: readonly SourceLexicalNamespaceCollision[];
  diagnostics: readonly DslDiagnostic[];
};

export type SourceLexicalLookup =
  | { kind: "resolved"; declaration: SourceLexicalDeclaration }
  | { kind: "forward"; scopeId: ScopeId; declarations: readonly SourceLexicalDeclaration[] }
  | { kind: "undefined" }
  | { kind: "ambiguous"; scopeId: ScopeId; declarations: readonly SourceLexicalDeclaration[] };

export type BuildSourceLexicalNamespaceOptions = {
  includeStatement?: IncludeStatement;
  scopeIndex?: LexicalScopeIndex;
};

const declarationKindOf = (statement: DslStatement): SourceLexicalDeclarationKind | null => {
  if (statement.kind === "moduleDefinition") return "moduleDefinition";
  if (statement.kind === "moduleInstance") return "moduleInstance";
  if (statement.kind === "group") return "group";
  if (statement.kind === "typedDeclaration") return "typedDeclaration";
  if (statement.kind === "element") {
    if (statement.type === "conditionalGroup") return "conditionalGroup";
    if (statement.type === "forGroup") return "forGroup";
    if (isGeometryDeclarationCategory(statement.category)) return "geometry";
  }
  return null;
};

const isModuleKind = (kind: SourceLexicalDeclarationKind) =>
  kind === "moduleDefinition" || kind === "moduleInstance";

const isExistingCadNamespaceKind = (kind: SourceLexicalDeclarationKind) =>
  kind === "group" || kind === "geometry" || kind === "conditionalGroup" || kind === "forGroup";

/**
 * Build a source-only namespace index from parser-owned enclosing metadata.
 * This observes module bodies but does not lower or evaluate them. The caller
 * must provide reconciler-owned identities for every scope opener and named
 * declaration that is included in the index.
 */
export const buildSourceLexicalNamespaceIndex = (
  statements: readonly DslStatement[],
  stableStatementIdByIndex: ReadonlyMap<number, string>,
  options: BuildSourceLexicalNamespaceOptions = {}
): SourceLexicalNamespaceIndex => {
  const includeStatement = options.includeStatement ?? (() => true);
  const scopeIndex = options.scopeIndex ?? buildLexicalScopeIndexFromStatements(statements, stableStatementIdByIndex, includeStatement);
  const declarationsByScope = new Map<ScopeId, SourceLexicalDeclaration[]>();
  const declarationsByScopeAndName = new Map<ScopeId, Map<string, SourceLexicalDeclaration[]>>();
  const allDeclarations: SourceLexicalDeclaration[] = [];

  statements.forEach((statement, statementIndex) => {
    if (!includeStatement(statement, statementIndex)) return;
    const kind = declarationKindOf(statement);
    if (!kind || !statement.name) return;
    const scopeId = scopeIndex.scopeOfStatement.get(statementIndex);
    if (!scopeId) return;
    const statementId = stableStatementIdByIndex.get(statementIndex);
    if (statementId === undefined) {
      throw new Error(`sourceLexicalNamespaceIndex: no stable statement id supplied for statement index ${statementIndex}`);
    }
    const declaration: SourceLexicalDeclaration = {
      scopeId,
      statementIndex,
      statementId,
      kind,
      name: statement.name,
      nameSpan: statement.nameSpan,
      statement
    };
    const scopeDeclarations = declarationsByScope.get(scopeId);
    if (scopeDeclarations) scopeDeclarations.push(declaration);
    else declarationsByScope.set(scopeId, [declaration]);
    const names = declarationsByScopeAndName.get(scopeId);
    if (names) {
      const sameName = names.get(statement.name);
      if (sameName) sameName.push(declaration);
      else names.set(statement.name, [declaration]);
    } else {
      declarationsByScopeAndName.set(scopeId, new Map([[statement.name, [declaration]]]));
    }
    allDeclarations.push(declaration);
  });

  const collisions: SourceLexicalNamespaceCollision[] = [];
  const diagnostics: DslDiagnostic[] = [];
  const isSourceOnlyDeclaration = (declaration: SourceLexicalDeclaration) =>
    isInUnloweredModuleSubtree(statements, declaration.statementIndex);
  for (const [scopeId, names] of declarationsByScopeAndName) {
    for (const [name, declarations] of names) {
      const prior: SourceLexicalDeclaration[] = [];
      for (const declaration of declarations) {
        const conflicting = prior.find(
          (candidate) =>
            candidate.kind !== declaration.kind ||
            isModuleKind(candidate.kind) ||
            isModuleKind(declaration.kind) ||
            (isSourceOnlyDeclaration(candidate) && isSourceOnlyDeclaration(declaration))
        );
        if (!conflicting) {
          prior.push(declaration);
          continue;
        }
        collisions.push({ scopeId, name, declarations: [conflicting, declaration] });
        // The parser already owns duplicate CAD-element diagnostics for the
        // group/geometry namespace. Keep the collision record for consumers,
        // but leave that diagnostic to the existing owner so the two systems
        // do not report the same problem twice.
        if (
          isExistingCadNamespaceKind(conflicting.kind) &&
          isExistingCadNamespaceKind(declaration.kind) &&
          !isSourceOnlyDeclaration(conflicting) &&
          !isSourceOnlyDeclaration(declaration)
        ) {
          prior.push(declaration);
          continue;
        }
        const nameSpan = declaration.nameSpan;
        diagnostics.push({
          severity: "error",
          line: declaration.statement.line,
          column: (nameSpan?.start ?? declaration.statement.keywordSpan.start) + 1,
          message: `同じlexical scopeで名前「${name}」が衝突しています: ${conflicting.kind}(行 ${conflicting.statement.line}) と ${declaration.kind}。`,
          code: "source-namespace-collision",
          ...(declaration.statement.namePhysicalSpan
            ? { physicalSpan: declaration.statement.namePhysicalSpan }
            : { physicalSpan: declaration.statement.physicalSpan })
        });
        prior.push(declaration);
      }
    }
  }

  return {
    scopeIndex,
    declarationsByScope,
    declarationsByScopeAndName,
    allDeclarations,
    collisions,
    diagnostics
  };
};

/** Short name for callers that already know this is a lexical namespace. */
export const buildLexicalNamespaceIndex = buildSourceLexicalNamespaceIndex;

/**
 * Resolve one source declaration using the parser's document order and the
 * shared lexical scope tree. A declaration in the nearest scope wins even if
 * it is a non-module or a forward declaration; lookup never falls through to
 * an outer scope in that case.
 */
export const resolveSourceLexicalDeclaration = (
  index: SourceLexicalNamespaceIndex,
  statementIndex: number,
  name: string
): SourceLexicalLookup => {
  const startScope = index.scopeIndex.scopeOfStatement.get(statementIndex);
  if (!startScope) return { kind: "undefined" };
  for (const scopeId of scopeChain(index.scopeIndex, startScope)) {
    const declarations = index.declarationsByScopeAndName.get(scopeId)?.get(name) ?? [];
    if (declarations.length === 0) continue;
    const visible = declarations.filter((declaration) => declaration.statementIndex < statementIndex);
    if (visible.length === 1) return { kind: "resolved", declaration: visible[0] };
    if (visible.length > 1) return { kind: "ambiguous", scopeId, declarations: visible };
    return { kind: "forward", scopeId, declarations };
  }
  return { kind: "undefined" };
};
