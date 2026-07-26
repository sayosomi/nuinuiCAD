// Evaluation-neutral binding version graph. This module consumes compiler
// products only; it never parses source or resolves a target/reference.
import type { BindingAnalysis, BindingAnalysisEntry } from "./bindingAnalysis";
import { bindingIdForStableStatementId, type BindingId } from "./bindingCatalog";
import type { ScopeId, LexicalScopeIndex } from "./lexicalScopeIndex";
import type { ScalarProgram, ScalarProgramStatement } from "./scalarProgram";
import type { SetStatementAnalysis } from "./setStatementCompiler";
import type { ScalarType } from "./types";
import type { TypedScalarExpression } from "./typedExpressionAst";

export type BindingVersionId = string;

export type BindingControlOwner =
  | {
      kind: "conditionalBranch";
      ownerStatementId: string;
      branch: "then" | "else";
      scopeId: ScopeId;
      /** Explicit lexical close from Task 30's scope metadata, never inferred at runtime. */
      exitSourceOrder: number;
    }
  | { kind: "forGroup"; ownerStatementId: string; scopeId: ScopeId; exitSourceOrder: number };

export type BindingControlMetadata = {
  scopeId: ScopeId;
  /** Explicit lexical close for this version's own declaration/set scope. */
  scopeExitSourceOrder: number;
  /** Outer-to-inner executable control owners; groups deliberately add none. */
  ownerChain: readonly BindingControlOwner[];
  /** The innermost owner, or linear execution when the chain is empty. */
  kind: "linear" | "conditionalBranch" | "forGroup";
};

export type BindingVersionState =
  | { kind: "uncomputed" }
  | { kind: "poisoned"; reason: "invalid-declaration" | "invalid-dependency" };

type BindingVersionBase = {
  id: BindingVersionId;
  bindingId: BindingId;
  declaredType: ScalarType;
  sourceOrder: number;
  scopeId: ScopeId;
  scopeExitSourceOrder: number;
  control: BindingControlMetadata;
  predecessorId?: BindingVersionId;
  initialState: BindingVersionState;
};

export type DeclarationBindingVersion = BindingVersionBase & {
  kind: "declare";
  bindingKind: "const" | "let";
  initializer?: TypedScalarExpression;
};

export type SetBindingVersion = BindingVersionBase & {
  kind: "set";
  bindingKind: "let";
  expression: TypedScalarExpression;
  setStatementId: string;
};

export type BindingVersion = DeclarationBindingVersion | SetBindingVersion;

export type BeforeStatementPosition = { kind: "beforeStatement"; sourceOrder: number };
export type AfterStatementPosition = { kind: "afterStatement"; sourceOrder: number };
export type BindingReadPosition = BeforeStatementPosition | AfterStatementPosition;

export const beforeStatement = (sourceOrder: number): BeforeStatementPosition => ({ kind: "beforeStatement", sourceOrder });
export const afterStatement = (sourceOrder: number): AfterStatementPosition => ({ kind: "afterStatement", sourceOrder });

type BindingVersionTimeline = {
  sourceOrders: readonly number[];
  versionIds: readonly BindingVersionId[];
};

export type BindingVersionGraph = {
  versions: readonly BindingVersion[];
  versionsById: ReadonlyMap<BindingVersionId, BindingVersion>;
  versionIdsByBindingId: ReadonlyMap<BindingId, readonly BindingVersionId[]>;
  timelinesByBindingId: ReadonlyMap<BindingId, BindingVersionTimeline>;
  /** Statement-stream cutoff inherited from the compiled scalar program. */
  evaluationLimitSourceOrder?: number;
};

export type BindingVersionBuildInput = {
  scalarProgram: ScalarProgram;
  bindingAnalysis: BindingAnalysis;
  setStatements: ReadonlyMap<number, SetStatementAnalysis> | undefined;
  controlByScopeId: ReadonlyMap<ScopeId, BindingControlMetadata>;
};

const stableStatementIdForBinding = (bindingId: BindingId): string => {
  const prefix = "binding:";
  if (!bindingId.startsWith(prefix) || bindingId.length === prefix.length) {
    throw new Error(`bindingVersions: binding ${bindingId} has no reversible stable statement identity`);
  }
  const statementId = bindingId.slice(prefix.length);
  if (bindingIdForStableStatementId(statementId) !== bindingId) {
    throw new Error(`bindingVersions: binding ${bindingId} does not use the canonical stable identity format`);
  }
  return statementId;
};

const controlFor = (controls: ReadonlyMap<ScopeId, BindingControlMetadata>, scopeId: ScopeId): BindingControlMetadata => {
  const control = controls.get(scopeId);
  if (!control) throw new Error(`bindingVersions: missing control metadata for scope ${scopeId}`);
  return control;
};

const declarationSeedFor = (
  bindingId: BindingId,
  entry: BindingAnalysisEntry,
  programByBindingId: ReadonlyMap<BindingId, ScalarProgramStatement>
): { initializer?: TypedScalarExpression; initialState: BindingVersionState } => {
  const programStatement = programByBindingId.get(bindingId);
  if (programStatement) return { initializer: programStatement.declaration.initializer, initialState: { kind: "uncomputed" } };
  if (entry.programEligibility.kind === "eligible") {
    throw new Error(`bindingVersions: eligible binding ${bindingId} is missing its scalar program declaration`);
  }
  return {
    initialState: {
      kind: "poisoned",
      reason: entry.programEligibility.reason === "invalid-dependency" ? "invalid-dependency" : "invalid-declaration"
    }
  };
};

/**
 * Normalizes opaque lexical scopes once. No scope ID string is interpreted:
 * all control semantics come from LexicalScope.kind/parent/opening metadata.
 */
export const buildBindingControlMetadata = (
  scopeIndex: LexicalScopeIndex,
  stableStatementIdByIndex: ReadonlyMap<number, string>
): ReadonlyMap<ScopeId, BindingControlMetadata> => {
  const controls = new Map<ScopeId, BindingControlMetadata>();
  for (const [scopeId, scope] of scopeIndex.scopes) {
    const parentControl = scope.parentId === null
      ? []
      : controls.get(scope.parentId)?.ownerChain;
    if (!parentControl) throw new Error(`bindingVersions: missing parent control metadata for scope ${scopeId}`);
    const ownerChain = [...parentControl];
    if (scope.kind === "then" || scope.kind === "else" || scope.kind === "forGroup") {
      if (scope.openingStatementIndex === null) {
        throw new Error(`bindingVersions: control scope ${scopeId} has no opening statement`);
      }
      const ownerStatementId = stableStatementIdByIndex.get(scope.openingStatementIndex);
      if (!ownerStatementId) {
        throw new Error(`bindingVersions: control scope ${scopeId} has no stable owner statement identity`);
      }
      ownerChain.push(scope.kind === "forGroup"
        ? { kind: "forGroup", ownerStatementId, scopeId, exitSourceOrder: scope.exitStatementIndex }
        : {
            kind: "conditionalBranch",
            ownerStatementId,
            branch: scope.kind,
            scopeId,
            exitSourceOrder: scope.exitStatementIndex
          });
    }
    const owner = ownerChain[ownerChain.length - 1];
    controls.set(scopeId, {
      scopeId,
      scopeExitSourceOrder: scope.exitStatementIndex,
      ownerChain,
      kind: owner?.kind ?? "linear"
    });
  }
  return controls;
};

const lowerBound = (values: readonly number[], needle: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < needle) low = middle + 1;
    else high = middle;
  }
  return low;
};

const upperBound = (values: readonly number[], needle: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= needle) low = middle + 1;
    else high = middle;
  }
  return low;
};

/** O(log versions for this binding), never a chain walk. */
export const readBindingVersionAtPosition = (
  graph: BindingVersionGraph,
  bindingId: BindingId,
  position: BindingReadPosition
): BindingVersion | undefined => {
  const timeline = graph.timelinesByBindingId.get(bindingId);
  if (!timeline) return undefined;
  const insertion = position.kind === "beforeStatement"
    ? lowerBound(timeline.sourceOrders, position.sourceOrder)
    : upperBound(timeline.sourceOrders, position.sourceOrder);
  const versionId = timeline.versionIds[insertion - 1];
  return versionId === undefined ? undefined : graph.versionsById.get(versionId);
};

export const buildBindingVersionGraph = ({
  scalarProgram,
  bindingAnalysis,
  setStatements,
  controlByScopeId
}: BindingVersionBuildInput): BindingVersionGraph => {
  const programByBindingId = new Map<BindingId, ScalarProgramStatement>();
  for (const statement of scalarProgram.statements) {
    if (programByBindingId.has(statement.bindingId)) throw new Error(`bindingVersions: duplicate scalar program binding ${statement.bindingId}`);
    programByBindingId.set(statement.bindingId, statement);
  }

  const declarations: DeclarationBindingVersion[] = [];
  for (const binding of bindingAnalysis.catalog.bindings) {
    if (binding.kind !== "typed" || binding.declaredType === null) continue;
    const entry = bindingAnalysis.entriesById.get(binding.id);
    if (!entry) throw new Error(`bindingVersions: missing analysis entry for ${binding.id}`);
    const seed = declarationSeedFor(binding.id, entry, programByBindingId);
    const id = stableStatementIdForBinding(binding.id);
    declarations.push({
      id,
      kind: "declare",
      bindingId: binding.id,
      bindingKind: binding.mutability as "const" | "let",
      declaredType: binding.declaredType,
      sourceOrder: binding.statementIndex,
      scopeId: binding.effectiveScopeId,
      scopeExitSourceOrder: controlFor(controlByScopeId, binding.effectiveScopeId).scopeExitSourceOrder,
      control: controlFor(controlByScopeId, binding.effectiveScopeId),
      initialState: seed.initialState,
      ...(seed.initializer ? { initializer: seed.initializer } : {})
    });
  }

  const sets = setStatements ? [...setStatements.values()] : [];
  for (let index = 1; index < sets.length; index += 1) {
    if (sets[index - 1].sourceOrder >= sets[index].sourceOrder) {
      throw new Error("bindingVersions: set statements must be supplied in strict source order");
    }
  }

  const versions: BindingVersion[] = [];
  const currentVersionByBindingId = new Map<BindingId, BindingVersionId>();
  const versionIdsByBindingId = new Map<BindingId, BindingVersionId[]>();
  const timelineSourceOrdersByBindingId = new Map<BindingId, number[]>();
  let declarationIndex = 0;
  let setIndex = 0;
  const appendTo = <T>(map: Map<BindingId, T[]>, bindingId: BindingId, value: T): void => {
    const values = map.get(bindingId);
    if (values) values.push(value);
    else map.set(bindingId, [value]);
  };
  const append = (version: BindingVersion) => {
    if (currentVersionByBindingId.has(version.bindingId)) version.predecessorId = currentVersionByBindingId.get(version.bindingId);
    else if (version.kind === "set") throw new Error(`bindingVersions: set ${version.id} has no declaration version for ${version.bindingId}`);
    currentVersionByBindingId.set(version.bindingId, version.id);
    versions.push(version);
    appendTo(versionIdsByBindingId, version.bindingId, version.id);
    appendTo(timelineSourceOrdersByBindingId, version.bindingId, version.sourceOrder);
  };

  while (declarationIndex < declarations.length || setIndex < sets.length) {
    const declaration = declarations[declarationIndex];
    const set = sets[setIndex];
    if (set === undefined || (declaration !== undefined && declaration.sourceOrder < set.sourceOrder)) {
      append(declaration);
      declarationIndex += 1;
      continue;
    }
    const target = bindingAnalysis.catalog.bindingsById.get(set.targetBindingId);
    if (!target || target.kind !== "typed" || target.mutability !== "let" || target.declaredType === null) {
      throw new Error(`bindingVersions: resolved set ${set.statementId} has no typed let target`);
    }
    append({
      id: set.statementId,
      kind: "set",
      bindingId: set.targetBindingId,
      bindingKind: "let",
      declaredType: target.declaredType,
      sourceOrder: set.sourceOrder,
      scopeId: set.scopeId,
      scopeExitSourceOrder: controlFor(controlByScopeId, set.scopeId).scopeExitSourceOrder,
      control: controlFor(controlByScopeId, set.scopeId),
      expression: set.expression,
      setStatementId: set.statementId,
      initialState: { kind: "uncomputed" }
    });
    setIndex += 1;
  }

  const versionsById = new Map<BindingVersionId, BindingVersion>();
  for (const version of versions) {
    if (versionsById.has(version.id)) throw new Error(`bindingVersions: duplicate version identity ${version.id}`);
    versionsById.set(version.id, version);
  }
  const timelinesByBindingId = new Map<BindingId, BindingVersionTimeline>();
  for (const [bindingId, sourceOrders] of timelineSourceOrdersByBindingId) {
    timelinesByBindingId.set(bindingId, { sourceOrders, versionIds: versionIdsByBindingId.get(bindingId)! });
  }
  return {
    versions,
    versionsById,
    versionIdsByBindingId,
    timelinesByBindingId,
    ...(scalarProgram.evaluationLimitSourceOrder === undefined
      ? {}
      : { evaluationLimitSourceOrder: scalarProgram.evaluationLimitSourceOrder })
  };
};
