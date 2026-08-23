import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import {
  moduleGeometryInterfaceTypeOfElement,
  type ModuleGeometryInterfaceType
} from "../dsl/moduleGeometryInterfaces";
import type { ModuleScalarSourceTarget } from "../dsl/moduleSemanticTypes";
import { parseDslSnapshot } from "../dsl/dslParser";
import { serializeDslNumericType, type DslNumericTypeOptions } from "../dsl/dslNumericTypeOptions";
import type { DslModuleParameterType, DslStatement } from "../dsl/dslTypes";
import { DSL_INDENT, formatDslName, unquoteDslString } from "../dsl/dslTokens";
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
  type: DslModuleParameterType;
  typeText: string;
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

type DependencyDescriptor = {
  name: string;
  type: DslModuleParameterType;
  numericTypeOptions?: DslNumericTypeOptions;
  declarationFrom: number;
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

const isSupportedModuleBodyStatement = (statement: DslStatement): boolean => {
  if (
    statement.kind === "typedDeclaration" ||
    statement.kind === "set" ||
    statement.kind === "group" ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance"
  ) return true;
  if (statement.kind !== "element") return false;
  return statement.category === "point" ||
    statement.category === "line" ||
    statement.category === "curve" ||
    statement.category === "arc" ||
    statement.category === "text" ||
    statement.category === "group" ||
    statement.category === "mutation" ||
    statement.type === "conditionalGroup" ||
    statement.type === "forGroup";
};

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
      replacement.from < rangeFrom || replacement.to > rangeTo ||
      replacement.from > replacement.to || replacement.from < previousTo
    ) return null;
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
): { from: number; to: number; argumentFrom: number } => {
  let from = occurrence.from;
  let cursor = occurrence.from;
  while (true) {
    const prior = occurrences.find((candidate) =>
      candidate.kind === "reference" && candidate.to + 2 === cursor && source.slice(candidate.to, cursor) === "::"
    );
    if (!prior) break;
    from = prior.from;
    cursor = prior.from;
  }
  return {
    from,
    to: occurrence.to,
    argumentFrom: source[from - 1] === "@" ? from - 1 : from
  };
};

const isFinalReferenceSegment = (source: string, occurrence: DslSemanticOccurrence): boolean =>
  occurrence.kind === "reference" && source.slice(occurrence.to, occurrence.to + 2) !== "::";

const declarationRangesFor = (
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
) => index.declarationsByIdentity.get(dslSemanticIdentityKey(identity)) ?? [];

const statementIndexForId = (compiled: CompiledDslDocument, statementId: StatementIdentity): number | undefined =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId);

const scalarTypeText = (type: ScalarType, numericTypeOptions?: DslNumericTypeOptions): string => {
  if (type.kind === "number") return serializeDslNumericType(numericTypeOptions);
  if (type.kind === "choice") return `choice(${type.options.join(", ")})`;
  return type.kind;
};

const moduleParameterTypeText = (
  type: DslModuleParameterType,
  numericTypeOptions?: DslNumericTypeOptions
): string => type.kind === "point" || type.kind === "line" || type.kind === "path"
  ? type.kind
  : scalarTypeText(type, numericTypeOptions);

const numericOptionsForStatement = (statement: DslStatement | undefined): DslNumericTypeOptions | undefined =>
  statement?.kind === "typedDeclaration" && statement.declaredType?.kind === "number"
    ? statement.numericTypeOptions
    : undefined;

const dependencyDescriptor = (
  compiled: CompiledDslDocument,
  source: string,
  index: DslSemanticOccurrenceIndex,
  identity: DslSemanticIdentity
): DependencyDescriptor | null => {
  const declarations = declarationRangesFor(index, identity);
  if (declarations.length !== 1) return null;
  const declarationFrom = declarations[0]!.from;

  if (identity.kind === "typed") {
    const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
    if (!binding?.declaredType) return null;
    return {
      name: binding.name,
      type: binding.declaredType,
      numericTypeOptions: numericOptionsForStatement(compiled.statements[binding.statementIndex]),
      declarationFrom
    };
  }

  if (identity.kind === "element") {
    const info = compiled.statementMap?.byElementId.get(identity.elementId);
    const statement = info ? compiled.statements[info.statementIndex] : undefined;
    const type: ModuleGeometryInterfaceType | null = moduleGeometryInterfaceTypeOfElement(statement);
    if (!statement?.name || !type) return null;
    return { name: statement.name, type: { kind: type }, declarationFrom };
  }

  if (identity.kind !== "module") return null;
  const target = identity.target;
  if (target.kind === "documentBinding") {
    const binding = compiled.bindingAnalysis?.catalog.bindingsById.get(target.bindingId);
    if (!binding?.declaredType) return null;
    return {
      name: binding.name,
      type: binding.declaredType,
      numericTypeOptions: numericOptionsForStatement(compiled.statements[binding.statementIndex]),
      declarationFrom
    };
  }
  if (target.kind === "moduleParameter") {
    const definition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(target.slot.definitionStatementId);
    const parameter = definition?.parameters[target.slot.parameterIndex];
    if (!definition || !parameter?.type) return null;
    const definitionStatement = compiled.statements[definition.statementIndex];
    const sourceParameter = definitionStatement?.kind === "moduleDefinition"
      ? definitionStatement.parameters[target.slot.parameterIndex]
      : undefined;
    return {
      name: parameter.name,
      type: parameter.type,
      numericTypeOptions: parameter.type.kind === "number" ? sourceParameter?.numericTypeOptions : undefined,
      declarationFrom
    };
  }
  if (target.kind === "moduleSource") {
    const statementIndex = statementIndexForId(compiled, target.statementId);
    const statement = statementIndex === undefined ? undefined : compiled.statements[statementIndex];
    if (!statement?.name) return null;
    if (statement.kind === "typedDeclaration" && statement.declaredType) {
      return {
        name: statement.name,
        type: statement.declaredType,
        numericTypeOptions: numericOptionsForStatement(statement),
        declarationFrom
      };
    }
    const type = moduleGeometryInterfaceTypeOfElement(statement);
    return type ? { name: statement.name, type: { kind: type }, declarationFrom } : null;
  }
  if (target.kind === "moduleIteration") {
    const declarationText = source.slice(declarations[0]!.from, declarations[0]!.to);
    const name = unquoteDslString(declarationText);
    return name ? { name, type: { kind: "number" }, declarationFrom } : null;
  }
  return null;
};

const targetStatementIndexForModuleScalar = (
  compiled: CompiledDslDocument,
  target: ModuleScalarSourceTarget | null
): number | null => {
  if (!target) return null;
  if (target.kind === "moduleLocal" || target.kind === "iteration") return target.statementIndex;
  if (target.kind === "documentBinding") {
    return compiled.bindingAnalysis?.catalog.bindingsById.get(target.bindingId)?.statementIndex ?? null;
  }
  if (target.kind === "parameter") {
    return compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(target.definitionStatementId)?.statementIndex ?? null;
  }
  return null;
};

const statementInsideOffsets = (
  statement: DslStatement | undefined,
  from: number,
  to: number
): boolean => Boolean(statement && statement.documentRange.from >= from && statement.documentRange.to <= to);

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

  for (const definition of compiled.moduleSemanticAnalysis?.definitions ?? []) {
    for (const body of definition.bodyStatements) {
      if (body.statementKind !== "set") continue;
      const targetIndex = targetStatementIndexForModuleScalar(compiled, body.scalarTarget);
      if (targetIndex === null) continue;
      const setInside = statementInsideOffsets(compiled.statements[body.statementIndex], selectedFrom, selectedTo);
      const targetInside = statementInsideOffsets(compiled.statements[targetIndex], selectedFrom, selectedTo);
      if (setInside !== targetInside) {
        return reject(
          "cross-boundary-mutation",
          "Module 内の set は Extract 境界をまたいで mutable binding を書き換えるため移動できません。",
          { statementIndex: body.statementIndex }
        );
      }
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
  const result = new Map<StatementIdentity, string[]>();
  for (const [statementIndex, statementId] of compiled.statementMap?.statementIdByStatementIndex ?? []) {
    if (excludedStatementIds.has(statementId)) continue;
    const statement = compiled.statements[statementIndex];
    if (!statement) continue;
    const identities = index.occurrences
      .filter((occurrence) =>
        isFinalReferenceSegment(source, occurrence) &&
        occurrence.from >= statement.documentRange.from &&
        occurrence.to <= statement.documentRange.to
      )
      .map((occurrence) => dslSemanticIdentityKey(occurrence.identity));
    result.set(statementId, identities);
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
    if (startLine !== endLine || (startLine >= selectedStartLine && startLine <= selectedEndLine)) return null;
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

const directExportStatement = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity,
  selectedIndexes: ReadonlySet<number>
): { statementId: StatementIdentity; statementIndex: number; statement: DslStatement } | null => {
  let statementIndex: number | undefined;
  if (identity.kind === "typed") {
    statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
  } else if (identity.kind === "element") {
    statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
  } else if (identity.kind === "module" && identity.target.kind === "moduleSource") {
    statementIndex = statementIndexForId(compiled, identity.target.statementId);
  }
  if (statementIndex === undefined || !selectedIndexes.has(statementIndex)) return null;
  const statement = compiled.statements[statementIndex];
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  return statement && statementId ? { statementId, statementIndex, statement } : null;
};

const exportInsertionPoint = (statement: DslStatement): number | null => {
  const span = statement.keywordPhysicalSpan;
  return span?.segments.length === 1 ? span.segments[0]!.from : null;
};

const cleanCompile = (compiled: CompiledDslDocument): boolean =>
  !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
  !(compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

export const planExtractModule = (input: ExtractModulePlanInput): ExtractModulePlanResult => {
  const { source: snapshot, compiled, statementIds, moduleName, instanceName } = input;
  const statementMap = compiled.statementMap;
  const namespace = compiled.sourceLexicalNamespace;
  const source = snapshot.normalizedSource;
  if (
    !statementMap || !namespace ||
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
    return statementIndex === undefined ? null : { statementId, statementIndex, statement: compiled.statements[statementIndex] };
  });
  const missing = selected.find((entry) => !entry?.statement);
  if (missing !== undefined) {
    return reject(
      "non-authored-target",
      "選択対象が現在の authored source statement として解決できません。materialized Module descendant または stale target の可能性があります。"
    );
  }
  const ordered = (selected as { statementId: StatementIdentity; statementIndex: number; statement: DslStatement }[])
    .sort((left, right) => left.statementIndex - right.statementIndex);
  const first = ordered[0]!;
  const firstScope = namespace.scopeIndex.scopeOfStatement.get(first.statementIndex);
  if (!firstScope) return reject("invalid-target", "選択先の lexical scope を解決できません。", { statementId: first.statementId, statementIndex: first.statementIndex });

  for (const entry of ordered) {
    const scope = namespace.scopeIndex.scopeOfStatement.get(entry.statementIndex);
    if (scope !== firstScope || !sameEnclosing(entry.statement.enclosing, first.statement.enclosing)) {
      return reject("cross-scope-target", "Extract Module の対象は同じ lexical scope の sibling statement に限定されます。", {
        statementId: entry.statementId,
        statementIndex: entry.statementIndex
      });
    }
    if (!isSupportedModuleBodyStatement(entry.statement)) {
      return reject("unsupported-statement", `「${entry.statement.kind}」statement は Module body に移動できません。`, {
        statementId: entry.statementId,
        statementIndex: entry.statementIndex
      });
    }
    if (
      (entry.statement.kind === "typedDeclaration" || entry.statement.kind === "element") &&
      entry.statement.exported
    ) {
      return reject("existing-public-interface", "既存の export declaration を nested Module へ移すと公開interfaceが変わるため Extract できません。", {
        statementId: entry.statementId,
        statementIndex: entry.statementIndex
      });
    }
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
    const intervening = siblings.slice(minPosition, maxPosition + 1).find((entry) => !selectedIndexSet.has(entry.statementIndex));
    const interveningId = intervening ? statementMap.statementIdByStatementIndex?.get(intervening.statementIndex) : undefined;
    return reject("non-contiguous-target", "Extract Module の対象statementは authored source order で連続している必要があります。", {
      ...(intervening ? { interveningStatementIndex: intervening.statementIndex } : {}),
      ...(interveningId ? { interveningStatementId: interveningId } : {})
    });
  }

  for (const generatedName of [moduleName, instanceName]) {
    if ((namespace.declarationsByScopeAndName.get(firstScope)?.get(generatedName) ?? []).length > 0) {
      return reject("name-collision", `生成名「${generatedName}」は対象 lexical scope の既存 declaration と衝突します。`);
    }
  }

  const starts = lineStarts(source);
  const firstInfo = statementMap.statements[first.statementIndex];
  const last = ordered[ordered.length - 1]!;
  const lastInfo = statementMap.statements[last.statementIndex];
  if (!firstInfo || !lastInfo || firstInfo.sourceRevision !== snapshot.sourceRevision || lastInfo.sourceRevision !== snapshot.sourceRevision) {
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
  const references = occurrenceIndex.occurrences.filter((occurrence) => isFinalReferenceSegment(source, occurrence));
  const selectedReferences = references.filter((occurrence) => occurrence.from >= selectedFrom && occurrence.to <= selectedTo);
  const dependencyByIdentity = new Map<string, {
    identity: DslSemanticIdentity;
    descriptor: DependencyDescriptor;
    occurrences: DslSemanticOccurrence[];
    argumentSource: string;
  }>();

  for (const occurrence of selectedReferences) {
    const declarationRanges = declarationRangesFor(occurrenceIndex, occurrence.identity);
    if (declarationRanges.length !== 1) {
      return reject("unresolved-semantic-identity", "選択範囲内の reference identity を一意な declaration へ解決できません。");
    }
    const declaration = declarationRanges[0]!;
    if (declaration.from >= selectedFrom && declaration.to <= selectedTo) continue;
    const descriptor = dependencyDescriptor(compiled, source, occurrenceIndex, occurrence.identity);
    if (!descriptor) {
      return reject("unrepresentable-dependency", "選択範囲外への dependency を現在の Module parameter semantics で表現できません。");
    }
    const key = dslSemanticIdentityKey(occurrence.identity);
    const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
    const current = dependencyByIdentity.get(key);
    if (current) current.occurrences.push(occurrence);
    else dependencyByIdentity.set(key, {
      identity: occurrence.identity,
      descriptor,
      occurrences: [occurrence],
      argumentSource: source.slice(path.argumentFrom, path.to)
    });
  }

  const dependencies = [...dependencyByIdentity.entries()]
    .sort((left, right) => left[1].descriptor.declarationFrom - right[1].descriptor.declarationFrom || left[0].localeCompare(right[0]))
    .map(([identityKey, value]): ExtractModuleDependency => ({
      identityKey,
      name: value.descriptor.name,
      type: value.descriptor.type,
      typeText: moduleParameterTypeText(value.descriptor.type, value.descriptor.numericTypeOptions),
      argumentSource: value.argumentSource,
      declarationFrom: value.descriptor.declarationFrom
    }));

  const dependencyNames = new Map<string, string>();
  for (const dependency of dependencies) {
    const prior = dependencyNames.get(dependency.name);
    if (prior && prior !== dependency.identityKey) {
      return reject("parameter-name-collision", `異なる dependency が同じ parameter 名「${dependency.name}」になるため安全に Extract できません。`);
    }
    dependencyNames.set(dependency.name, dependency.identityKey);
  }
  const selectedDeclarationNames = new Set(
    namespace.allDeclarations
      .filter((declaration) => statementInsideOffsets(compiled.statements[declaration.statementIndex], selectedFrom, selectedTo))
      .map((declaration) => declaration.name)
  );
  for (const dependency of dependencies) {
    if (selectedDeclarationNames.has(dependency.name)) {
      return reject("parameter-name-collision", `生成 parameter「${dependency.name}」が移動対象内の declaration と衝突します。`);
    }
  }

  const internalReplacements: AbsoluteReplacement[] = [];
  for (const dependency of dependencyByIdentity.values()) {
    for (const occurrence of dependency.occurrences) {
      const path = sourcePathRangeForOccurrence(source, occurrenceIndex.occurrences, occurrence);
      internalReplacements.push({ from: path.from, to: path.to, text: formatDslName(dependency.descriptor.name) });
    }
  }

  const exports: ExtractModuleExport[] = [];
  const outsideReplacements: AbsoluteReplacement[] = [];
  const exportedIdentityKeys = new Set<string>();
  for (const declarationOccurrence of occurrenceIndex.occurrences.filter((occurrence) =>
    occurrence.kind === "declaration" && occurrence.from >= selectedFrom && occurrence.to <= selectedTo
  )) {
    const identityKey = dslSemanticIdentityKey(declarationOccurrence.identity);
    if (exportedIdentityKeys.has(identityKey)) continue;
    const outsideReferences = references.filter((reference) =>
      dslSemanticIdentityKey(reference.identity) === identityKey &&
      (reference.from < selectedFrom || reference.to > selectedTo)
    );
    if (outsideReferences.length === 0) continue;
    const direct = directExportStatement(compiled, declarationOccurrence.identity, selectedIndexSet);
    if (!direct) {
      return reject("unrepresentable-export", "移動対象内の nested declaration が範囲外から参照されているため direct Module export として表現できません。");
    }
    const { statement, statementIndex, statementId } = direct;
    const exportable =
      statement.kind === "typedDeclaration" && Boolean(statement.declaredType) ||
      statement.kind === "element" && moduleGeometryInterfaceTypeOfElement(statement) !== null;
    if (!exportable || !statement.name) {
      return reject("unrepresentable-export", `statement「${statement.name || statement.kind}」は現在の direct Module export semantics で公開できません。`, {
        statementId,
        statementIndex
      });
    }
    if ((statement.kind === "typedDeclaration" || statement.kind === "element") && statement.exported) {
      return reject("existing-public-interface", "既存 export declaration の公開interfaceを nested Module 経由へ暗黙変更できません。", { statementId, statementIndex });
    }
    const insertion = exportInsertionPoint(statement);
    if (insertion === null) {
      return reject("unsafe-rewrite", "export keyword の exact source insertion point を確定できません。", { statementId, statementIndex });
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
  const firstRawLine = source.slice(starts[selectedStartLine - 1]!, lineEndOffset(source, starts, selectedStartLine));
  const outerIndent = firstRawLine.match(/^\s*/)?.[0] ?? "";
  const parameterText = dependencies.map((dependency) => `${formatDslName(dependency.name)}: ${dependency.typeText}`).join(", ");
  const argumentText = dependencies.map((dependency) => `${formatDslName(dependency.name)}: ${dependency.argumentSource}`).join(", ");
  const bodyLines = selectedText.split("\n").map((line) => line.trim().length === 0 ? line : `${DSL_INDENT}${line}`);
  const replacementLines = [
    `${outerIndent}module ${formatDslName(moduleName)}(${parameterText}) {`,
    ...bodyLines,
    `${outerIndent}}`,
    `${outerIndent}instance ${formatDslName(instanceName)} = ${formatDslName(moduleName)}(${argumentText})`
  ];
  const selectedSplice: LineSplice = {
    startLine: selectedStartLine,
    endLine: selectedEndLine,
    replacementLines
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
  const splices = [...outsideSplices, selectedSplice].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);

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
    return reject("unsafe-rewrite", firstError?.message ?? "Extract 後の source semantics を安全にコンパイルできません。");
  }

  const movedIds = new Set<StatementIdentity>();
  for (const [statementIndex, statementId] of statementMap.statementIdByStatementIndex ?? []) {
    if (statementInsideOffsets(compiled.statements[statementIndex], selectedFrom, selectedTo)) movedIds.add(statementId);
  }
  for (const statementId of movedIds) {
    if (!nextCompiled.statementMap.statementIndexByStatementId?.has(statementId)) {
      return reject("identity-loss", "Extract 後に authored statement identity を保持できませんでした。", { statementId });
    }
  }

  const oldSequences = sourceReferenceSequencesByStatementId(compiled, occurrenceIndex, movedIds);
  const nextOccurrenceIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const nextSequences = sourceReferenceSequencesByStatementId(nextCompiled, nextOccurrenceIndex, movedIds);
  for (const [statementId, identities] of oldSequences) {
    const after = nextSequences.get(statementId);
    if (!after || identities.length !== after.length || identities.some((identity, index) => identity !== after[index])) {
      return reject("unsafe-rewrite", "Extract 後に範囲外 statement の reference resolution が変化するため適用できません。", { statementId });
    }
  }

  const generatedModule = nextCompiled.sourceLexicalNamespace.allDeclarations.find((declaration) =>
    declaration.kind === "moduleDefinition" && declaration.scopeId === firstScope && declaration.name === moduleName
  );
  const generatedInstance = nextCompiled.sourceLexicalNamespace.allDeclarations.find((declaration) =>
    declaration.kind === "moduleInstance" && declaration.scopeId === firstScope && declaration.name === instanceName
  );
  if (!generatedModule || !generatedInstance) {
    return reject("unsafe-rewrite", "生成した Module / instance を target lexical scope で再解決できません。");
  }
  const generatedInstanceInfo = nextCompiled.statementMap.statements[generatedInstance.statementIndex];
  if (!generatedInstanceInfo) return reject("unsafe-rewrite", "生成 instance の source metadata を取得できません。");

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
