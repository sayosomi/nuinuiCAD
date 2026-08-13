import { dslScopeBeforeParsedLine, parseDslSnapshot } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import type { DslPhysicalSegment } from "../dsl/logicalStatementSourceMap";
import type { ScalarType } from "./types";

/** Completion-only identity. It must never be used as a BindingId || runtime scope id. */
export type CompletionScopeKey = string;

export type RecoverableSetTargetCandidate = {
  readonly name: string;
  readonly type: ScalarType;
  readonly declarationPosition: number;
  readonly scopeKey: CompletionScopeKey;
  readonly source: "live";
};

export type LiveSetTargetDeclaration = {
  readonly name: string;
  readonly bindingKind: "const" | "let";
  readonly declaredType: ScalarType | null;
  readonly declarationPosition: number;
  readonly scopeKey: CompletionScopeKey;
};

export type SetTargetCompletionCandidate = {
  readonly name: string;
  readonly type: ScalarType;
  readonly declarationPosition: number;
  readonly scopeKey: CompletionScopeKey;
  readonly source: "committed" | "live";
};

type ScopeInfo = {
  readonly parentKey: CompletionScopeKey | null;
  readonly depth: number;
};

type DeclarationLocation = {
  readonly name: string;
  readonly declarationPosition: number;
  readonly scopeKey: CompletionScopeKey;
};

export type LiveSetTargetRecovery = {
  /** Includes non-eligible live declarations so stale committed metadata with
   * the same identity can be suppressed. */
  readonly declarations: readonly LiveSetTargetDeclaration[];
  readonly candidates: readonly RecoverableSetTargetCandidate[];
  readonly cursorPosition: number;
  readonly cursorScopeKey: CompletionScopeKey;
  readonly scopeKeyAtPosition: (position: number) => CompletionScopeKey | null;
  readonly declarationLocationAtPosition: (position: number) => DeclarationLocation | null;
  readonly scopeDistance: (candidateScopeKey: CompletionScopeKey, cursorScopeKey?: CompletionScopeKey) => number | null;
};

const ROOT_SCOPE_KEY = "root";
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isLexicalBlock = (statement: DslStatement): "group" | "conditional" | "for" | null => {
  if (statement.kind === "group") return "group";
  if (statement.kind !== "element") return null;
  if (statement.type === "conditionalGroup") return "conditional";
  if (statement.type === "forGroup") return "for";
  return null;
};

const onlyPhysicalSegment = (segments: readonly DslPhysicalSegment[] | undefined): DslPhysicalSegment | null =>
  segments?.length === 1 ? segments[0] : null;

const lineNumberAt = (source: string, position: number): number => {
  let line = 1;
  const end = Math.max(0, Math.min(position, source.length));
  for (let index = 0; index < end; index += 1) if (source[index] === "\n") line += 1;
  return line;
};

const typeKey = (type: ScalarType): string => {
  if (type.kind !== "choice") return type.kind;
  return `choice:${type.options.join("\u0000")}`;
};

/**
 * Parses only the current editor buffer && derives a small lexical model for
 * completion. No compiler catalog, binding identity, || runtime value is
 * created here. The parser intentionally keeps typed declarations whose
 * initializer is invalid, which is the recovery behavior this layer needs.
 */
export const recoverLiveSetTargetCandidates = (input: {
  readonly source: string;
  readonly cursorPosition: number;
}): LiveSetTargetRecovery => {
  const parsed = parseDslSnapshot({ normalizedSource: input.source, sourceRevision: 0 });
  const statements = parsed.statements;
  const scopes = new Map<CompletionScopeKey, ScopeInfo>([[ROOT_SCOPE_KEY, { parentKey: null, depth: 0 }]]);
  const scopeKeyByStatement = new Map<number, CompletionScopeKey>();

  const registerScope = (scopeKey: CompletionScopeKey, parentKey: CompletionScopeKey) => {
    if (scopes.has(scopeKey)) return;
    const parent = scopes.get(parentKey);
    if (!parent) return;
    scopes.set(scopeKey, { parentKey, depth: parent.depth + 1 });
  };

  const scopeKeyForStatement = (statementIndex: number): CompletionScopeKey => {
    const cached = scopeKeyByStatement.get(statementIndex);
    if (cached) return cached;
    const statement = statements[statementIndex];
    if (!statement?.enclosing) {
      scopeKeyByStatement.set(statementIndex, ROOT_SCOPE_KEY);
      return ROOT_SCOPE_KEY;
    }

    const parentIndex = statement.enclosing.statementIndex;
    const parent = statements[parentIndex];
    const parentScopeKey = scopeKeyForStatement(parentIndex);
    const block = parent ? isLexicalBlock(parent) : null;
    if (!parent || !block) {
      scopeKeyByStatement.set(statementIndex, parentScopeKey);
      return parentScopeKey;
    }

    const branch = block === "conditional" ? `:${statement.enclosing.branch}` : "";
    const scopeKey = `${parentScopeKey}/${block}:${parent.documentRange.from}${branch}`;
    registerScope(scopeKey, parentScopeKey);
    scopeKeyByStatement.set(statementIndex, scopeKey);
    return scopeKey;
  };

  const scopeKeyForBlock = (statementIndex: number, branch: "then" | "else"): CompletionScopeKey => {
    const statement = statements[statementIndex];
    if (!statement) return ROOT_SCOPE_KEY;
    const block = isLexicalBlock(statement);
    if (!block) return scopeKeyForStatement(statementIndex);
    const parentScopeKey = scopeKeyForStatement(statementIndex);
    const branchSuffix = block === "conditional" ? `:${branch}` : "";
    const scopeKey = `${parentScopeKey}/${block}:${statement.documentRange.from}${branchSuffix}`;
    registerScope(scopeKey, parentScopeKey);
    return scopeKey;
  };

  // Populate all statement scopes before looking up positions. This also
  // registers a newly typed block even when the document cannot compile.
  statements.forEach((_, index) => { scopeKeyForStatement(index); });
  statements.forEach((statement, index) => {
    if (statement.opensBlock) {
      const block = isLexicalBlock(statement);
      if (block) scopeKeyForBlock(index, "then");
    }
  });

  const cursorLine = lineNumberAt(input.source, input.cursorPosition);
  const frame = dslScopeBeforeParsedLine(parsed, cursorLine);
  const cursorScopeKey = frame
    ? scopeKeyForBlock(frame.statementIndex, frame.branch)
    : ROOT_SCOPE_KEY;

  const scopeDistance = (candidateScopeKey: CompletionScopeKey, currentScopeKey = cursorScopeKey): number | null => {
    let distance = 0;
    let current: CompletionScopeKey | null = currentScopeKey;
    while (current !== null) {
      if (current === candidateScopeKey) return distance;
      current = scopes.get(current)?.parentKey ?? null;
      distance += 1;
    }
    return null;
  };

  const statementIndexAtPosition = (position: number): number | null => {
    const matching = statements
      .map((statement, index) => ({ statement, index }))
      .filter(({ statement }) => position >= statement.documentRange.from && position <= statement.documentRange.to);
    return matching.length === 1 ? matching[0].index : null;
  };

  const declarationLocationAtPosition = (position: number): DeclarationLocation | null => {
    const statementIndex = statementIndexAtPosition(position);
    if (statementIndex === null) return null;
    const statement = statements[statementIndex];
    if (statement.kind !== "typedDeclaration") return null;
    const name = onlyPhysicalSegment(statement.namePhysicalSpan?.segments);
    if (!name || !statement.nameSpan || !identifierPattern.test(statement.name) || !statement.name) return null;
    return { name: statement.name, declarationPosition: name.from, scopeKey: scopeKeyForStatement(statementIndex) };
  };

  const declarations: LiveSetTargetDeclaration[] = [];
  const candidates: RecoverableSetTargetCandidate[] = [];
  statements.forEach((statement, statementIndex) => {
    if (
      statement.kind !== "typedDeclaration" ||
      !statement.name ||
      !identifierPattern.test(statement.name)
    ) return;
    const name = onlyPhysicalSegment(statement.namePhysicalSpan?.segments);
    if (!name || !statement.nameSpan) return;
    const scopeKey = scopeKeyForStatement(statementIndex);
    declarations.push({
      name: statement.name,
      bindingKind: statement.bindingKind,
      declaredType: statement.declaredType,
      declarationPosition: name.from,
      scopeKey
    });
    if (statement.bindingKind !== "let" || statement.declaredType === null || name.from > input.cursorPosition) return;
    if (scopeDistance(scopeKey) === null) return;
    candidates.push({
      name: statement.name,
      type: statement.declaredType,
      declarationPosition: name.from,
      scopeKey,
      source: "live"
    });
  });

  return {
    declarations,
    candidates,
    cursorPosition: input.cursorPosition,
    cursorScopeKey,
    scopeKeyAtPosition: (position) => {
      const statementIndex = statementIndexAtPosition(position);
      return statementIndex === null ? null : scopeKeyForStatement(statementIndex);
    },
    declarationLocationAtPosition,
    scopeDistance
  };
};

const betterCandidate = (
  current: SetTargetCompletionCandidate,
  candidate: SetTargetCompletionCandidate,
  currentDistance: number,
  candidateDistance: number
): SetTargetCompletionCandidate => {
  if (candidateDistance < currentDistance) return candidate;
  if (candidateDistance > currentDistance) return current;
  if (candidate.declarationPosition > current.declarationPosition) return candidate;
  if (candidate.declarationPosition < current.declarationPosition) return current;
  // The lexical rules are tied here (same name, scope, && position). Keep a
  // deterministic result without making source freshness a priority.
  return typeKey(candidate.type) < typeKey(current.type) ? candidate : current;
};

const declarationIdentity = (candidate: Pick<SetTargetCompletionCandidate, "name" | "scopeKey" | "declarationPosition">): string =>
  `${candidate.name}\u0000${candidate.scopeKey}\u0000${candidate.declarationPosition}`;

/** Reconciles one current live declaration with its stale committed snapshot. */
export const reconcileSameDeclarationIdentity = (
  committed: readonly SetTargetCompletionCandidate[],
  recovery: LiveSetTargetRecovery
): readonly SetTargetCompletionCandidate[] => {
  const liveByIdentity = new Map(recovery.declarations.map((declaration) => [declarationIdentity(declaration), declaration]));
  const committedIdentities = new Set<string>();
  const reconciled: SetTargetCompletionCandidate[] = [];

  for (const candidate of committed) {
    const identity = declarationIdentity(candidate);
    const live = liveByIdentity.get(identity);
    if (!live) {
      reconciled.push(candidate);
      continue;
    }
    committedIdentities.add(identity);
    if (live.bindingKind === "let" && live.declaredType !== null) {
      reconciled.push({ ...candidate, type: live.declaredType, source: "live" });
    }
    // A live const || unknown/broken type deliberately contributes no target,
    // so the stale committed let cannot come back through lexical selection.
  }

  for (const candidate of recovery.candidates) {
    if (!committedIdentities.has(declarationIdentity(candidate))) reconciled.push(candidate);
  }
  return reconciled;
};

/** Merges reconciled committed/live target metadata using lexical visibility rules. */
export const mergeSetTargetCandidates = (
  committed: readonly SetTargetCompletionCandidate[],
  recovery: LiveSetTargetRecovery
): readonly SetTargetCompletionCandidate[] => {
  const pool = reconcileSameDeclarationIdentity(committed, recovery);
  const winners = new Map<string, { candidate: SetTargetCompletionCandidate; distance: number }>();
  for (const candidate of pool) {
    if (candidate.declarationPosition > recovery.cursorPosition) continue;
    const distance = recovery.scopeDistance(candidate.scopeKey);
    if (distance === null) continue;
    const current = winners.get(candidate.name);
    if (!current) {
      winners.set(candidate.name, { candidate, distance });
      continue;
    }
    const winner = betterCandidate(current.candidate, candidate, current.distance, distance);
    winners.set(candidate.name, { candidate: winner, distance: winner === candidate ? distance : current.distance });
  }
  return [...winners.values()].map(({ candidate }) => candidate);
};
