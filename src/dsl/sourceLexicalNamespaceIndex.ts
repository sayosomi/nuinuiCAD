import { isGeometryDeclarationCategory } from "./dslConstructions";
import { buildLexicalScopeIndexFromStatements } from "./lexicalScopeIndexAdapter";
import type { DslDiagnostic, DslSpan, DslStatement } from "./dslTypes";
import type { IncludeStatement, LexicalScopeIndex, ScopeId } from "../scalars/lexicalScopeIndex";

/** Named declarations that participate in the source-level lexical namespace. */
export type SourceLexicalDeclarationKind =
  | "moduleDefinition"
  | "moduleInstance"
  | "group"
  | "geometry"
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

export type BuildSourceLexicalNamespaceOptions = {
  includeStatement?: IncludeStatement;
  scopeIndex?: LexicalScopeIndex;
};

const declarationKindOf = (statement: DslStatement): SourceLexicalDeclarationKind | null => {
  if (statement.kind === "moduleDefinition") return "moduleDefinition";
  if (statement.kind === "moduleInstance") return "moduleInstance";
  if (statement.kind === "group") return "group";
  if (statement.kind === "typedDeclaration") return "typedDeclaration";
  if (statement.kind === "element" && isGeometryDeclarationCategory(statement.category)) return "geometry";
  return null;
};

const isModuleKind = (kind: SourceLexicalDeclarationKind) =>
  kind === "moduleDefinition" || kind === "moduleInstance";

const isExistingCadNamespaceKind = (kind: SourceLexicalDeclarationKind) =>
  kind === "group" || kind === "geometry";

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
  for (const [scopeId, names] of declarationsByScopeAndName) {
    for (const [name, declarations] of names) {
      const prior: SourceLexicalDeclaration[] = [];
      for (const declaration of declarations) {
        const conflicting = prior.find(
          (candidate) => candidate.kind !== declaration.kind || isModuleKind(candidate.kind) || isModuleKind(declaration.kind)
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
        if (isExistingCadNamespaceKind(conflicting.kind) && isExistingCadNamespaceKind(declaration.kind)) {
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
