import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { parseDslSnapshot } from "../dsl/dslParser";
import { serializeDslNumericType, type DslNumericTypeOptions } from "../dsl/dslNumericTypeOptions";
import type { DslModuleParameterType, DslStatement } from "../dsl/dslTypes";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { ScalarType } from "../scalars/types";
import { reconcileStatements } from "./statementReconciler";
import type { StatementIdentity } from "./statementIdentity";
import { applyLineSplices, type LineSplice } from "./textPatch";

export type ExtractModuleRejectCode =
  | "stale-semantic-snapshot"
  | "invalid-target"
  | "non-authored-target"
  | "cross-scope-target"
  | "non-contiguous-target"
  | "unsupported-statement"
  | "invalid-name"
  | "name-collision"
  | "unresolved-semantic-identity"
  | "parameter-name-collision"
  | "unrepresentable-dependency"
  | "cross-boundary-mutation"
  | "unrepresentable-export"
  | "existing-public-interface"
  | "unsafe-rewrite"
  | "identity-loss";

export type ExtractModuleRejection = {
  status: "rejected";
  code: ExtractModuleRejectCode;
  message: string;
  statementId?: StatementIdentity;
  statementIndex?: number;
  interveningStatementId?: StatementIdentity;
  interveningStatementIndex?: number;
};

export type ExtractModuleDependency = {
  identityKey: string;
  name: string;
  type: DslModuleParameterType | null;
  typeText: string;
  recordTypeIdentity?: string;
  argumentSource: string;
  declarationFrom: number;
};

export type ExtractModuleExport = {
  identityKey: string;
  name: string;
  statementId: StatementIdentity;
  statementIndex: number;
};

export type ExtractModulePlan = {
  status: "planned";
  sourceRevision: number;
  moduleName: string;
  instanceName: string;
  targetScopeId: string;
  selectedStatementIds: readonly StatementIdentity[];
  dependencies: readonly ExtractModuleDependency[];
  exports: readonly ExtractModuleExport[];
  /** One atomic old-source-coordinate batch. Callers must apply all or none. */
  splices: readonly LineSplice[];
  generatedInstance: {
    name: string;
    moduleName: string;
    startLine: number;
    endLine: number;
  };
};

export type ExtractModulePlanResult = ExtractModulePlan | ExtractModuleRejection;

export type ExtractModulePlanInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  statementIds: readonly StatementIdentity[];
  moduleName: string;
  instanceName: string;
};

type AbsoluteReplacement = { from: number; to: number; text: string };

type ScalarDependencyDescriptor = {
  name: string;
  type: ScalarType;
  numericTypeOptions?: DslNumericTypeOptions;
  declarationFrom: number;
};

type SourcePathRange = {
  rewriteFrom: number;
  to: number;
  argumentFrom: number;
};

type DirectScalarStatement = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>;
};

const reject = (
  code: ExtractModuleRejectCode,
  message: string,
  details: Partial<Omit<ExtractModuleRejection, "status" | "code" | "message">> = {}
): ExtractModuleRejection => ({ status: "rejected", code, message, ...details });

const sameEnclosing = (
  left: DslStatement["enclosing"],
  right: DslStatement["enclosing"]
): boolean =>
  left?.statementIndex === right?.statementIndex &&
  left?.branch === right?.branch;

const isStructuralStatement = (statement: DslStatement): boolean =>
  statement.kind === "blockEnd" || statement.kind === "blockElse";

const lineStarts = (source: string): number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const lineEndOffset = (source: string, starts: readonly number[], line: number): number =>
  line < starts.length ? starts[line]! - 1 : source.length;

const lineAtOffset = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, high + 1);
};

const applyAbsoluteReplacements = (
  source: string,
  rangeFrom: number,
  rangeTo: number,
  replacements: readonly AbsoluteReplacement[]
): string | null => {
  const sorted = [...replacements].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = rangeFrom;
  for (const replacement of sorted) {
    if (
      replacement.from < rangeFrom ||
      replacement.to > rangeTo ||
      replacement.from > replacement.to ||
      replacement.from < previousTo
    ) {
      return null;
    }
    previousTo = Math.max(previousTo, replacement.to);
  }

  let result = source.slice(rangeFrom, rangeTo);
  for (const replacement of sorted.reverse()) {
    const from = replacement.from - rangeFrom;
    const to = replacement.to - rangeFrom;
    result = result.slice(0, from) + replacement.text + result.slice(to);
  }
  return result;
};

const sourcePathRangeForOccurrence = (
  source: string,
  occurrences: readonly DslSemanticOccurrence[],
  occurrence: DslSemanticOccurrence
): SourcePathRange => {
  let firstSegmentFrom = occurrence.from;
  let cursor = occurrence.from;
  while (true) {
    const prior = occurrences.find((candidate) =>
      candidate.kind === "reference" &&
      candidate.to + 2 === cursor &&
      source.slice(candidate.to, cursor) === "::"
    );
    if (!prior) break;
    firstSegmentFrom = prior.from;
    cursor = prior.from;
  }

  const rooted = firstSegmentFrom >= 3 && source.slice(firstSegmentFrom - 3, firstSegmentFrom) === "@::";
  return {
    rewriteFrom: rooted ? firstSegmentFrom - 2 : firstSegmentFrom,
    to: occurrence.to,
    argumentFrom: rooted
      ? firstSegmentFrom - 3
      : source[firstSegmentFrom - 1] === "@"
        ? firstSegmentFrom - 1
        : firstSegmentFrom
  };
};

const isFinalReferenceSegment = (source: string, occurrence: DslSemanticOccurrence): boolean =>
  occurrence.kind === "reference" && source.slice(occurrence.to, occurrence.to + 2) !== "::";

const canonicalFinalReferenceOccurrences = (
  source: string,
  occurrences: readonly DslSemanticOccurrence[]
): readonly DslSemanticOccurrence[] => {
  const byEnd = new Map<number, DslSemanticOccurrence>();
  for (const occurrence of occurrences) {
    if (!isFinalReferenceSegment(source, occurrence)) continue;
    const prior = byEnd.get(occurrence.to);
    if (!prior || occurrence.from > prior.from) byEnd.set(occurrence.to, occurrence);
  }
  return [...byEnd.values()].sort((left, right) => left.from - right.from || left.to - right.to);
};

const declarationRangesFor = (
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
) => index.declarationsByIdentity.get(dslSemanticIdentityKey(identity)) ?? [];

const statementIndexForId = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): number | undefined =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId);

const statementIdForIndex = (
  compiled: CompiledDslDocument,
  statementIndex: number | undefined
): StatementIdentity | null =>
  statementIndex === undefined
    ? null
    : compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ?? null;

const semanticOwnerKey = (compiled: CompiledDslDocument, identity: DslSemanticIdentity): string => {
  if (identity.kind === "typed") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
    const statementId = statementIdForIndex(compiled, statementIndex);
    return statementId ? `statement:${statementId}` : dslSemanticIdentityKey(identity);
  }
  if (identity.kind === "element") {
    const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
    const statementId = statementIdForIndex(compiled, statementIndex);
    return statementId ? `statement:${statementId}` : dslSemanticIdentityKey(identity);
  }
  if (identity.kind === "source") return `statement:${identity.statementId}`;

  const target = identity.target;
  if (target.kind === "documentBinding") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(target.bindingId)?.statementIndex;
    const statementId = statementIdForIndex(compiled, statementIndex);
    return statementId ? `statement:${statementId}` : dslSemanticIdentityKey(identity);
  }
  if (target.kind === "moduleParameter") {
    return `parameter:${target.slot.definitionStatementId}:${target.slot.parameterIndex}`;
  }
  if (target.kind === "moduleElementLocalVariable") {
    return `module-element-local:${target.statementId}:${target.variableIndex}`;
  }
  return `statement:${target.statementId}`;
};

const scalarTypeText = (type: ScalarType, numericTypeOptions?: DslNumericTypeOptions): string => {
  if (type.kind === "number") return serializeDslNumericType(numericTypeOptions);
  if (type.kind === "choice") return `choice(${type.options.join(", ")})`;
  return type.kind;
};

const numericOptionsForStatement = (
  statement: DslStatement | undefined
): DslNumericTypeOptions | undefined =>
  statement?.kind === "typedDeclaration" && statement.declaredType?.kind === "number"
    ? statement.numericTypeOptions
    : undefined;

const scalarDependencyDescriptor = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): ScalarDependencyDescriptor | null => {
  const declarations = declarationRangesFor(index, identity);
  if (declarations.length !== 1) return null;
  const declarationFrom = declarations[0]!.from;

  const descriptorForBinding = (bindingId: string): ScalarDependencyDescriptor | null => {
    const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(bindingId);
    if (!binding?.declaredType) return null;
    const statement = compiled.statements[binding.statementIndex];
    // Checkpoint 1 accepts only direct authored scalar declarations. SAY-128 record-field
    // slots point back to record-valued source declarations and fail closed here instead
    // of being split into synthetic scalar parameters.
    if (
      statement?.kind !== "typedDeclaration" ||
      !statement.declaredType ||
      statement.recordTypeReference ||
      statement.enclosing !== null
    ) {
      return null;
    }
    return {
      name: binding.name,
      type: binding.declaredType,
      numericTypeOptions: numericOptionsForStatement(statement),
      declarationFrom
    };
  };

  if (identity.kind === "typed") return descriptorForBinding(identity.bindingId);
  if (identity.kind === "module" && identity.target.kind === "documentBinding") {
    return descriptorForBinding(identity.target.bindingId);
  }
  return null;
};

const directSelectedScalarStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): DirectScalarStatement | null => {
  let statementIndex: number | undefined;
  if (identity.kind === "typed") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
  } else if (identity.kind === "module" && identity.target.kind === "documentBinding") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.target.bindingId)?.statementIndex;
  }
  if (statementIndex === undefined || !selectedIndexes.has(statementIndex)) return null;

  const statement = compiled.statements[statementIndex];
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  return statement?.kind === "typedDeclaration" && statementId
    ? { statementId, statementIndex, statement }
    : null;
};

const statementInsideOffsets = (
  statement: DslStatement | undefined,
  from: number,
  to: number
): boolean =>
  Boolean(statement && statement.documentRange.from >= from && statement.documentRange.to <= to);

const validateMutationBoundaries = (
  compiled: CompiledDslDocument,
  selectedFrom: number,
  selectedTo: number
): ExtractModuleRejection | null => {
  for (const [setStatementIndex, set] of compiled.setStatements ?? []) {
    const targetIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(set.targetBindingId)?.statementIndex;
    if (targetIndex === undefined) continue;
    const setInside = statementInsideOffsets(compiled.statements[setStatementIndex], selectedFrom, selectedTo);
    const targetInside = statementInsideOffsets(compiled.statements[targetIndex], selectedFrom, selectedTo);
    if (setInside !== targetInside) {
      return reject(
        "cross-boundary-mutation",
        `set ${set.targetName} は Extract 境界をまたいで mutable binding を書き換えるため移動できません。`,
        { statementIndex: setStatementIndex }
      );
    }
  }
  return null;
};

const sourceReferenceSequencesByStatementId = (
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  excludedStatementIds: ReadonlySet<StatementIdentity>
): ReadonlyMap<StatementIdentity, readonly string[]> => {
  const source = compiled.spans.sourceMap.source;
  const references = canonicalFinalReferenceOccurrences(source, index.occurrences);
  const result = new Map<StatementIdentity, string[]>();

  for (const [statementIndex, statementId] of compiled.statementMap?.statementIdByStatementIndex ?? []) {
    if (excludedStatementIds.has(statementId)) continue;
    const statement = compiled.statements[statementIndex];
    if (!statement) continue;
    const identities = references
      .filter((occurrence) =>
        occurrence.from >= statement.documentRange.from &&
        occurrence.to <= statement.documentRange.to
      )
      .map((occurrence) => semanticOwnerKey(compiled, occurrence.identity));
    if (identities.length > 0) result.set(statementId, identities);
  }
  return result;
};

const replacementSplicesOutsideSelection = (
  source: string,
  starts: readonly number[],
  selectedStartLine: number,
  selectedEndLine: number,
  replacements: readonly AbsoluteReplacement[]
): LineSplice[] | null => {
  const byLine = new Map<number, AbsoluteReplacement[]>();
  for (const replacement of replacements) {
    const startLine = lineAtOffset(starts, replacement.from);
    const endLine = lineAtOffset(starts, Math.max(replacement.from, replacement.to - 1));
    if (startLine !== endLine || (startLine >= selectedStartLine && startLine <= selectedEndLine)) {
      return null;
    }
    const bucket = byLine.get(startLine) ?? [];
    bucket.push(replacement);
    byLine.set(startLine, bucket);
  }

  const splices: LineSplice[] = [];
  for (const [line, lineReplacements] of [...byLine.entries()].sort((left, right) => left[0] - right[0])) {
    const from = starts[line - 1]!;
    const to = lineEndOffset(source, starts, line);
    const replacement = applyAbsoluteReplacements(source, from, to, lineReplacements);
    if (replacement === null) return null;
    splices.push({ startLine: line, endLine: line, replacementLines: [replacement] });
  }
  return splices;
};

const exportInsertionPoint = (statement: DslStatement): number | null => {
  const span = statement.keywordPhysicalSpan;
  return span?.segments.length === 1 ? span.segments[0]!.from : null;
};

const cleanCompile = (compiled: CompiledDslDocument): boolean =>
  !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
  !(compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

const checkpointStatementRejection = (
  statement: DslStatement,
  statementId: StatementIdentity,
  statementIndex: number
): ExtractModuleRejection | null => {
  if (statement.kind === "import" || statement.kind === "fileReExport") {
    return reject(
      "unsupported-statement",
      `「${statement.kind}」statement は local-source Extract Module v1 の対象外です。`,
      { statementId, statementIndex }
    );
  }
  if (statement.enclosing !== null) {
    return reject(
      "unsupported-statement",
      "Checkpoint 1 は root lexical scope の direct scalar statement だけを安全に Extract します。",
      { statementId, statementIndex }
    );
  }
  if (statement.kind === "typedDeclaration") {
    if (!statement.declaredType || statement.recordTypeReference) {
      return reject(
        "unsupported-statement",
        `record-valued declaration「${statement.name}」は Checkpoint 1 の nominal-record scope 外です。`,
        { statementId, statementIndex }
      );
    }
    if (statement.exported) {
      return reject(
        "existing-public-interface",
        "既存の export declaration を nested Module へ移すと公開interfaceが変わるため Extract できません。",
        { statementId, statementIndex }
      );
    }
    return null;
  }
  if (statement.kind === "set") return null;

  return reject(
    "unsupported-statement",
    `「${statement.kind}」statement は scalar-first Checkpoint 1 の対象外です。`,
    { statementId, statementIndex }
  );
};

const lexicalTieBreak = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const planExtractModule = (input: ExtractModulePlanInput): ExtractModulePlanResult => {
  const { source: snapshot, compiled, statementIds, moduleName, instanceName } = input;
  const statementMap = compiled.statementMap;
  const namespace = compiled.sourceLexicalNamespace;
  const source = snapshot.normalizedSource;

  if (
    !statementMap ||
    !namespace ||
    snapshot.sourceRevision !== statementMap.sourceRevision ||
    snapshot.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
    source !== compiled.spans.sourceMap.source
  ) {
    return reject("stale-semantic-snapshot", "Extract Module には exact-current の source/semantic snapshot が必要です。");
  }
  if (!cleanCompile(compiled)) {
    return reject("stale-semantic-snapshot", "現在の semantic snapshot に未解決エラーがあるため Extract Module の安全性を証明できません。");
  }
  if (statementIds.length === 0 || new Set(statementIds).size !== statementIds.length) {
    return reject("invalid-target", "Extract Module には1件以上の重複しない authored statement が必要です。");
  }
  if (!moduleName || !instanceName || moduleName.includes("\n") || instanceName.includes("\n")) {
    return reject("invalid-name", "生成する Module 名と instance 名には空でない有効な名前が必要です。");
  }
  if (moduleName === instanceName) {
    return reject("invalid-name", "Module 名と instance 名は別の名前にしてください。");
  }

  const selected = statementIds.map((statementId) => {
    const statementIndex = statementIndexForId(compiled, statementId);
    return statementIndex === undefined
      ? null
      : { statementId, statementIndex, statement: compiled.statements[statementIndex] };
  });
  if (selected.some((entry) => !entry?.statement)) {
    return reject(
      "non-authored-target",
      "選択対象が現在の authored source statement として解決できません。materialized Module descendant または stale target の可能性があります。"
    );
  }

  const ordered = (selected as {
    statementId: StatementIdentity;
    statementIndex: number;
    statement: DslStatement;
  }[]).sort((left, right) => left.statementIndex - right.statementIndex);
  const first = ordered[0]!;
  const firstScope = namespace.scopeIndex.scopeOfStatement.get(first.statementIndex);
  if (!firstScope) {
    return reject("invalid-target", "選択先の lexical scope を解決できません。", {
      statementId: first.statementId,
      statementIndex: first.statementIndex
    });
  }

  for (const entry of ordered) {
    const scope = namespace.scopeIndex.scopeOfStatement.get(entry.statementIndex);
    if (scope !== firstScope || !sameEnclosing(entry.statement.enclosing, first.statement.enclosing)) {
      return reject(
        "cross-scope-target",
        "Extract Module の対象は同じ lexical scope の sibling statement に限定されます。",
        { statementId: entry.statementId, statementIndex: entry.statementIndex }
      );
    }
  }
  for (const entry of ordered) {
    const rejection = checkpointStatementRejection(entry.statement, entry.statementId, entry.statementIndex);
    if (rejection) return rejection;
  }

  const selectedIndexSet = new Set(ordered.map((entry) => entry.statementIndex));
  const siblings = compiled.statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter(({ statement, statementIndex }) =>
      !isStructuralStatement(statement) &&
      namespace.scopeIndex.scopeOfStatement.get(statementIndex) === firstScope &&
      sameEnclosing(statement.enclosing, first.statement.enclosing)
    );
  const selectedSiblingPositions = siblings
    .map((entry, position) => selectedIndexSet.has(entry.statementIndex) ? position : -1)
    .filter((position) => position >= 0);
  const minPosition = Math.min(...selectedSiblingPositions);
  const maxPosition = Math.max(...selectedSiblingPositions);
  if (maxPosition - minPosition + 1 !== selectedSiblingPositions.length) {
    const intervening = siblings
      .slice(minPosition, maxPosition + 1)
      .find((entry) => !selectedIndexSet.has(entry.statementIndex));
    const interveningId = intervening
      ? statementMap.statementIdByStatementIndex?.get(intervening.statementIndex)
      : undefined;
    return reject(
      "non-contiguous-target",
      "Extract Module の対象statementは authored source order で連続している必要があります。",
      {
        ...(intervening ? { interveningStatementIndex: intervening.statementIndex } : {}),
        ...(interveningId ? { interveningStatementId: interveningId } : {})
      }
    );
  }

  for (const generatedName of [moduleName, instanceName]) {
    if ((namespace.declarationsByScopeAndName.get(firstScope)?.get(generatedName) ?? []).length > 0) {
      return reject(
        "name-collision",
        `生成名「${generatedName}」は対象 lexical scope の既存 declaration と衝突します。`
      );
    }
  }

  const starts = lineStarts(source);
  const firstInfo = statementMap.statements[first.statementIndex];
  const last = ordered[ordered.length - 1]!;
  const lastInfo = statementMap.statements[last.statementIndex];
  if (
    !firstInfo ||
    !lastInfo ||
    firstInfo.sourceRevision !== snapshot.sourceRevision ||
    lastInfo.sourceRevision !== snapshot.sourceRevision
  ) {
    return reject("stale-semantic-snapshot", "選択statementの source range が current revision と一致しません。");
  }
  const selectedStartLine = firstInfo.range.startLine;
  const selectedEndLine = lastInfo.range.endLine;
  const selectedFrom = starts[selectedStartLine - 1];
  const selectedTo = lineEndOffset(source, starts, selectedEndLine);
  if (selectedFrom === undefined || selectedFrom > selectedTo) {
    return reject("invalid-target", "選択statementの物理 source range を確定できません。");
  }

  const mutationRejection = validateMutationBoundaries(compiled, selectedFrom, selectedTo);
  if (mutationRejection) return mutationRejection;

  const occurrenceIndex = createDslSemanticOccurrenceIndex(compiled);
  const references = canonicalFinalReferenceOccurrences(source, occurrenceIndex.occurrences);
  const selectedReferences = references.filter((occurrence) =>
    occurrence.from >= selectedFrom && occurrence.to <= selectedTo
  );
  const dependencyByIdentity = new Map<string, {
    descriptor: ScalarDependencyDescriptor;
    occurrences: DslSemanticOccurrence[];
    argumentSource: string;
  }>();

  for (const occurrence of selectedReferences) {
    const declarationRanges = declarationRangesFor(occurrenceIndex, occurrence.identity);
    if (declarationRanges.length !== 1) {
      return reject(
        "unresolved-semantic-identity",
        "選択範囲内の reference identity を一意な declaration へ解決できません。"
      );
    }
    const declaration = declarationRanges[0]!;
    if (declaration.from >= selectedFrom && declaration.to <= selectedTo) {
      // With nested scopes excluded by Checkpoint 1, an internal reference must resolve
      // directly to one of the authored scalar declarations that moves with the range.
      if (!directSelectedScalarStatement(compiled, occurrence.identity, selectedIndexSet)) {
        return reject(
          "unrepresentable-dependency",
          "選択範囲内の reference が Checkpoint 1 の direct scalar owner として証明できません。"
        );
      }
      continue;
    }

    const descriptor = scalarDependencyDescriptor(compiled, occurrenceIndex, occurrence.identity);
    if (!descriptor) {
      return reject(
        "unrepresentable-dependency",
        "Checkpoint 1 では direct authored scalar dependency 以外を Module parameter として安全に表現しません。"
      );
    }

    const key = dslSemanticIdentityKey(occurrence.identity);
    const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
    const current = dependencyByIdentity.get(key);
    if (current) current.occurrences.push(occurrence);
    else {
      dependencyByIdentity.set(key, {
        descriptor,
        occurrences: [occurrence],
        argumentSource: source.slice(path.argumentFrom, path.to)
      });
    }
  }

  const dependencies: ExtractModuleDependency[] = [...dependencyByIdentity.entries()]
    .map(([identityKey, value]) => ({
      identityKey,
      name: value.descriptor.name,
      type: value.descriptor.type,
      typeText: scalarTypeText(value.descriptor.type, value.descriptor.numericTypeOptions),
      argumentSource: value.argumentSource,
      declarationFrom: value.descriptor.declarationFrom
    }))
    .sort((left, right) =>
      left.declarationFrom - right.declarationFrom ||
      lexicalTieBreak(left.identityKey, right.identityKey)
    );

  const dependencyNames = new Map<string, string>();
  for (const dependency of dependencies) {
    const prior = dependencyNames.get(dependency.name);
    if (prior && prior !== dependency.identityKey) {
      return reject(
        "parameter-name-collision",
        `異なる dependency が同じ parameter 名「${dependency.name}」になるため安全に Extract できません。`
      );
    }
    dependencyNames.set(dependency.name, dependency.identityKey);
  }

  const selectedDeclarationNames = new Set(
    ordered
      .filter((entry) => entry.statement.kind === "typedDeclaration")
      .map((entry) => entry.statement.name)
  );
  for (const dependency of dependencies) {
    if (selectedDeclarationNames.has(dependency.name)) {
      return reject(
        "parameter-name-collision",
        `生成 parameter「${dependency.name}」が移動対象内の declaration と衝突します。`
      );
    }
  }

  const internalReplacements: AbsoluteReplacement[] = [];
  for (const dependency of dependencyByIdentity.values()) {
    for (const occurrence of dependency.occurrences) {
      const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
      internalReplacements.push({
        from: path.rewriteFrom,
        to: path.to,
        text: formatDslName(dependency.descriptor.name)
      });
    }
  }

  const exports: ExtractModuleExport[] = [];
  const outsideReplacements: AbsoluteReplacement[] = [];
  const exportedIdentityKeys = new Set<string>();
  for (const declarationOccurrence of occurrenceIndex.occurrences.filter((occurrence) =>
    occurrence.kind === "declaration" &&
    occurrence.from >= selectedFrom &&
    occurrence.to <= selectedTo
  )) {
    const identityKey = dslSemanticIdentityKey(declarationOccurrence.identity);
    if (exportedIdentityKeys.has(identityKey)) continue;

    const outsideReferences = references.filter((reference) =>
      dslSemanticIdentityKey(reference.identity) === identityKey &&
      (reference.from < selectedFrom || reference.to > selectedTo)
    );
    if (outsideReferences.length === 0) continue;

    const direct = directSelectedScalarStatement(compiled, declarationOccurrence.identity, selectedIndexSet);
    if (!direct) {
      return reject(
        "unrepresentable-export",
        "Checkpoint 1 では direct scalar declaration 以外を Module export として公開しません。"
      );
    }

    const { statement, statementIndex, statementId } = direct;
    if (!statement.declaredType || statement.recordTypeReference || !statement.name) {
      return reject(
        "unrepresentable-export",
        `statement「${statement.name || statement.kind}」は Checkpoint 1 の direct scalar export で表現できません。`,
        { statementId, statementIndex }
      );
    }

    const insertion = exportInsertionPoint(statement);
    if (insertion === null) {
      return reject("unsafe-rewrite", "export keyword の exact source insertion point を確定できません。", {
        statementId,
        statementIndex
      });
    }
    internalReplacements.push({ from: insertion, to: insertion, text: "export " });

    for (const reference of outsideReferences) {
      outsideReplacements.push({
        from: reference.from,
        to: reference.to,
        text: `${formatDslName(instanceName)}::${formatDslName(statement.name)}`
      });
    }
    exports.push({ identityKey, name: statement.name, statementId, statementIndex });
    exportedIdentityKeys.add(identityKey);
  }

  const selectedText = applyAbsoluteReplacements(source, selectedFrom, selectedTo, internalReplacements);
  if (selectedText === null) {
    return reject("unsafe-rewrite", "選択範囲内の semantic rewrite が重複し、atomic source patch を構成できません。");
  }

  const firstRawLine = source.slice(
    starts[selectedStartLine - 1]!,
    lineEndOffset(source, starts, selectedStartLine)
  );
  const outerIndent = firstRawLine.match(/^\s*/)?.[0] ?? "";
  const parameterText = dependencies
    .map((dependency) => `${formatDslName(dependency.name)}: ${dependency.typeText}`)
    .join(", ");
  const argumentText = dependencies
    .map((dependency) => `${formatDslName(dependency.name)}: ${dependency.argumentSource}`)
    .join(", ");
  const bodyLines = selectedText
    .split("\n")
    .map((line) => line.trim().length === 0 ? line : `${DSL_INDENT}${line}`);

  const selectedSplice: LineSplice = {
    startLine: selectedStartLine,
    endLine: selectedEndLine,
    replacementLines: [
      `${outerIndent}module ${formatDslName(moduleName)}(${parameterText}) {`,
      ...bodyLines,
      `${outerIndent}}`,
      `${outerIndent}instance ${formatDslName(instanceName)} = ${formatDslName(moduleName)}(${argumentText})`
    ]
  };
  const outsideSplices = replacementSplicesOutsideSelection(
    source,
    starts,
    selectedStartLine,
    selectedEndLine,
    outsideReplacements
  );
  if (outsideSplices === null) {
    return reject("unsafe-rewrite", "範囲外 reference rewrite を exact single-line splice として表現できません。");
  }
  const splices = [...outsideSplices, selectedSplice]
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);

  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }

  const nextRevision = snapshot.sourceRevision + 1;
  const parsed = parseDslSnapshot({ normalizedSource: candidateSource, sourceRevision: nextRevision });
  const reconciled = reconcileStatements({
    oldStatements: compiled.statements,
    oldLines: compiled.sourceLines,
    oldElementIds: statementMap.elementIdByStatementIndex,
    oldStatementIds: statementMap.statementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: candidateSource.split("\n")
  });
  const nextCompiled = compileDslDocument(candidateSource, {
    preparsed: parsed,
    sourceRevision: nextRevision,
    assignedElementIds: reconciled.assignedIds,
    assignedStatementIds: reconciled.assignedIds
  });

  if (!nextCompiled.statementMap || !nextCompiled.sourceLexicalNamespace || !cleanCompile(nextCompiled)) {
    const firstError = [...nextCompiled.diagnostics, ...(nextCompiled.bindingIssueDiagnostics ?? [])]
      .find((diagnostic) => diagnostic.severity === "error");
    return reject(
      "unsafe-rewrite",
      firstError?.message ?? "Extract 後の source semantics を安全にコンパイルできません。"
    );
  }

  const movedIds = new Set<StatementIdentity>(ordered.map((entry) => entry.statementId));
  for (const entry of ordered) {
    const nextIndex = nextCompiled.statementMap.statementIndexByStatementId?.get(entry.statementId);
    const nextStatement = nextIndex === undefined ? undefined : nextCompiled.statements[nextIndex];
    if (
      !nextStatement ||
      nextStatement.kind !== entry.statement.kind ||
      nextStatement.name !== entry.statement.name
    ) {
      return reject("identity-loss", "Extract 後に authored statement identity を保持できませんでした。", {
        statementId: entry.statementId
      });
    }
  }

  const generatedModule = nextCompiled.sourceLexicalNamespace.allDeclarations.find((declaration) =>
    declaration.kind === "moduleDefinition" &&
    declaration.scopeId === firstScope &&
    declaration.name === moduleName
  );
  const generatedInstance = nextCompiled.sourceLexicalNamespace.allDeclarations.find((declaration) =>
    declaration.kind === "moduleInstance" &&
    declaration.scopeId === firstScope &&
    declaration.name === instanceName
  );
  if (!generatedModule || !generatedInstance) {
    return reject("unsafe-rewrite", "生成した Module / instance を target lexical scope で再解決できません。");
  }

  // Checkpoint 1 deliberately excludes nested binders, geometry, and records. For the
  // remaining root-scalar language, moved-reference safety is established before apply:
  // every internal reference resolves to a selected direct scalar declaration; every
  // outside dependency is compiler-resolved, rewritten to one explicit parameter, and
  // checked against moved declaration names. The candidate must then compile cleanly.
  // A generic post-move identity comparison is intentionally not used here because root
  // document bindings and Module-owned references have different canonical identity forms.
  // Outside statements do not cross that representation boundary and are still compared.
  const oldSequences = sourceReferenceSequencesByStatementId(compiled, occurrenceIndex, movedIds);
  const nextOccurrenceIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const nextSequences = sourceReferenceSequencesByStatementId(nextCompiled, nextOccurrenceIndex, movedIds);
  for (const [statementId, identities] of oldSequences) {
    const after = nextSequences.get(statementId);
    if (
      !after ||
      identities.length !== after.length ||
      identities.some((identity, index) => identity !== after[index])
    ) {
      return reject(
        "unsafe-rewrite",
        "Extract 後に範囲外 statement の reference resolution が変化するため適用できません。",
        { statementId }
      );
    }
  }

  const generatedInstanceInfo = nextCompiled.statementMap.statements[generatedInstance.statementIndex];
  if (!generatedInstanceInfo) {
    return reject("unsafe-rewrite", "生成 instance の source metadata を取得できません。");
  }

  return {
    status: "planned",
    sourceRevision: snapshot.sourceRevision,
    moduleName,
    instanceName,
    targetScopeId: firstScope,
    selectedStatementIds: ordered.map((entry) => entry.statementId),
    dependencies,
    exports,
    splices,
    generatedInstance: {
      name: instanceName,
      moduleName,
      startLine: generatedInstanceInfo.range.startLine,
      endLine: generatedInstanceInfo.range.endLine
    }
  };
};
