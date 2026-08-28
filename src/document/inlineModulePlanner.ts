import { encodeIdentityTuple } from "./identityTuple";
import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrence,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { parseElementActivityLiteral } from "../dsl/dslActivity";
import { geometryArrayTypeOfTypedDeclaration } from "../dsl/geometryArraySourceAnnotations";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { ModuleDefinitionSemantic, ModuleInstanceSemantic } from "../dsl/moduleSemanticTypes";
import { DSL_INDENT, formatDslName } from "../dsl/dslTokens";
import { reconcileStatements } from "./statementReconciler";
import type { StatementIdentity } from "./statementIdentity";
import { applyLineSplices, type LineSplice } from "./textPatch";

export type InlineModuleTargetIdentity = {
  /** The owning document identity; null means the current local document. */
  documentKey: string | null;
  statementId: StatementIdentity;
};

export type InlineModulePolicy = {
  /** Reserved for optional-parameter branch comments in a later slice. */
  emitOmittedBranchComments: boolean;
  includeHiddenInstances: boolean;
  includeDisabledInstances: boolean;
};

export type InlineModuleKnownSkipCode =
  | "non-local-target"
  | "not-module-instance"
  | "unresolved-callee"
  | "hidden-excluded"
  | "disabled-excluded"
  | "parameter-lowering-required"
  | "nested-module-validation-required";

export type InlineModuleRejectCode =
  | "stale-semantic-snapshot"
  | "invalid-target"
  | "unsafe-source-span"
  | "unsafe-rewrite";

export type InlineModuleSkippedTarget = {
  status: "skipped";
  target: InlineModuleTargetIdentity;
  statementIndex: number | null;
  instanceName: string | null;
  code: InlineModuleKnownSkipCode;
  reason: string;
};

export type InlineModuleInlinedTarget = {
  status: "inlined";
  target: InlineModuleTargetIdentity;
  statementIndex: number;
  instanceName: string;
  moduleDefinitionStatementId: StatementIdentity;
  activity: "visible" | "hidden" | "disabled";
  generatedGroupName: string;
  sourceRange: { startLine: number; endLine: number };
};

export type InlineModuleTargetResult = InlineModuleSkippedTarget | InlineModuleInlinedTarget;

export type InlineModulePlan = {
  status: "planned";
  sourceRevision: number;
  /** Deduplicated target results in authored source order. */
  targets: readonly InlineModuleTargetResult[];
  /** One atomic batch in old-source coordinates. Callers apply all or none. */
  splices: readonly LineSplice[];
};

export type InlineModuleRejection = {
  status: "rejected";
  code: InlineModuleRejectCode;
  message: string;
  target?: InlineModuleTargetIdentity;
};

export type InlineModulePlanResult = InlineModulePlan | InlineModuleRejection;

export type InlineModulePlanInput = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  targets: readonly InlineModuleTargetIdentity[];
  policy: InlineModulePolicy;
};

type AbsoluteReplacement = { from: number; to: number; text: string };
type Activity = InlineModuleInlinedTarget["activity"];
type StatementEntry = {
  statementId: StatementIdentity;
  statementIndex: number;
  statement: DslStatement;
};

type BodyRange = {
  from: number;
  to: number;
  bodyLines: readonly string[];
  definitionIndent: string;
  definitionStatementIndex: number;
  entries: readonly StatementEntry[];
};

type InlineEntry = {
  target: InlineModuleTargetIdentity;
  statementIndex: number;
  statement: Extract<DslStatement, { kind: "moduleInstance" }>;
  instance: ModuleInstanceSemantic;
  definition: ModuleDefinitionSemantic;
  activity: Activity;
  statementInfo: NonNullable<CompiledDslDocument["statementMap"]>["statements"][number];
};

type OwnerMapping = {
  targetStatementId: StatementIdentity;
  generatedGroupStatementId: StatementIdentity;
  bodyStatementIds: ReadonlyMap<StatementIdentity, StatementIdentity>;
};

type OccurrenceSlot = {
  kind: DslSemanticOccurrence["kind"];
  token: string;
  ordinal: number;
  owners: readonly string[];
};

const reject = (
  code: InlineModuleRejectCode,
  message: string,
  target?: InlineModuleTargetIdentity
): InlineModuleRejection => ({
  status: "rejected",
  code,
  message,
  ...(target ? { target } : {})
});

const cleanCompile = (compiled: CompiledDslDocument): boolean =>
  !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
  !(compiled.bindingIssueDiagnostics ?? []).some((diagnostic) => diagnostic.severity === "error");

const cleanSemanticAnalysis = (compiled: CompiledDslDocument): boolean => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  return analysis !== undefined && !analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error");
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

const leadingWhitespace = (line: string): string => line.match(/^\s*/)?.[0] ?? "";

const singlePhysicalRange = (
  span: { sourceRevision: number; segments: readonly { from: number; to: number }[] } | null | undefined,
  sourceRevision: number
): { from: number; to: number } | null =>
  span?.sourceRevision === sourceRevision && span.segments.length === 1
    ? span.segments[0] ?? null
    : null;

const applyAbsoluteReplacements = (
  source: string,
  rangeFrom: number,
  rangeTo: number,
  replacements: readonly AbsoluteReplacement[]
): string | null => {
  const ordered = [...replacements].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = rangeFrom;
  for (const replacement of ordered) {
    if (
      replacement.from < rangeFrom ||
      replacement.to > rangeTo ||
      replacement.from > replacement.to ||
      replacement.from < previousTo
    ) return null;
    previousTo = replacement.to;
  }

  let result = source.slice(rangeFrom, rangeTo);
  for (const replacement of ordered.reverse()) {
    const from = replacement.from - rangeFrom;
    const to = replacement.to - rangeFrom;
    result = `${result.slice(0, from)}${replacement.text}${result.slice(to)}`;
  }
  return result;
};

const statementIdAt = (
  compiled: CompiledDslDocument,
  statementIndex: number
): StatementIdentity | null =>
  compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex) ?? null;

const statementIndexForId = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): number | null => {
  const statementIndex = compiled.statementMap?.statementIndexByStatementId?.get(statementId);
  return statementIndex === undefined ? null : statementIndex;
};

const statementEntryForId = (
  compiled: CompiledDslDocument,
  statementId: StatementIdentity
): StatementEntry | null => {
  const statementIndex = statementIndexForId(compiled, statementId);
  const statement = statementIndex === null ? undefined : compiled.statements[statementIndex];
  return statementIndex === null || !statement ? null : { statementId, statementIndex, statement };
};

const inlineOpenBraceLine = (
  source: string,
  starts: readonly number[],
  statement: Extract<DslStatement, { kind: "moduleDefinition" }>
): number | null => {
  const physical = statement.physicalSpan.segments;
  for (const segment of physical) {
    const brace = source.indexOf("{", segment.from);
    if (brace >= segment.to) continue;
    const line = starts.findIndex((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1]! : source.length + 1;
      return start <= brace && brace < end;
    });
    if (line >= 0) return line + 1;
  }
  return null;
};

const bodyEntriesForDefinition = (
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
): readonly StatementEntry[] | null => {
  const entries: StatementEntry[] = [];
  for (const statementId of definition.bodyStatementIds) {
    const entry = statementEntryForId(compiled, statementId);
    if (!entry) return null;
    let current = entry.statement.enclosing?.statementIndex ?? null;
    const visited = new Set<number>();
    let ownedByDefinition = false;
    while (current !== null && !visited.has(current)) {
      if (current === definition.statementIndex) {
        ownedByDefinition = true;
        break;
      }
      visited.add(current);
      current = compiled.statements[current]?.enclosing?.statementIndex ?? null;
    }
    if (!ownedByDefinition) return null;
    entries.push(entry);
  }
  return entries.sort((left, right) => left.statementIndex - right.statementIndex);
};

const bodyRequiresDeferredValidation = (
  entries: readonly StatementEntry[],
  definitionStatementIndex: number
): boolean =>
  entries.some(({ statement }) =>
    statement.enclosing?.statementIndex !== definitionStatementIndex ||
    statement.kind === "moduleDefinition" ||
    statement.kind === "moduleInstance" ||
    statement.kind === "group" ||
    statement.kind === "recordDefinition" ||
    (statement.kind === "typedDeclaration" &&
      (Boolean(statement.recordTypeReference) || Boolean(geometryArrayTypeOfTypedDeclaration(statement)))) ||
    (statement.kind === "element" && (statement.type === "conditionalGroup" || statement.type === "forGroup"))
  );

const bodyRangeForDefinition = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  definition: ModuleDefinitionSemantic
): BodyRange | null => {
  const statement = compiled.statements[definition.statementIndex];
  const info = compiled.statementMap?.statements[definition.statementIndex];
  if (!statement || statement.kind !== "moduleDefinition" || !info) return null;
  const openBraceLine = info.openBraceLine ?? inlineOpenBraceLine(source, starts, statement);
  const closeBraceLine = info.closeBraceLine;
  if (openBraceLine === null || closeBraceLine === undefined || closeBraceLine <= openBraceLine) return null;

  const bodyStartLine = openBraceLine + 1;
  const bodyEndLine = closeBraceLine - 1;
  const definitionLine = source.slice(
    starts[info.line - 1]!,
    lineEndOffset(source, starts, info.line)
  );
  const definitionIndent = leadingWhitespace(definitionLine);
  const entries = bodyEntriesForDefinition(compiled, definition);
  if (!entries) return null;
  if (bodyStartLine > bodyEndLine) {
    const insertion = starts[closeBraceLine - 1];
    return insertion === undefined
      ? null
      : { from: insertion, to: insertion, bodyLines: [], definitionIndent, definitionStatementIndex: definition.statementIndex, entries };
  }

  const from = starts[bodyStartLine - 1];
  const to = lineEndOffset(source, starts, bodyEndLine);
  if (from === undefined || from > to) return null;
  return {
    from,
    to,
    bodyLines: source.slice(from, to).split("\n"),
    definitionIndent,
    definitionStatementIndex: definition.statementIndex,
    entries
  };
};

const exportedTokenReplacements = (
  source: string,
  compiled: CompiledDslDocument,
  body: BodyRange
): AbsoluteReplacement[] | null => {
  const replacements: AbsoluteReplacement[] = [];
  const sourceRevision = compiled.spans.sourceMap.sourceRevision;
  for (const entry of body.entries) {
    if (entry.statement.kind !== "typedDeclaration" && entry.statement.kind !== "element") continue;
    if (!entry.statement.exported) continue;
    const range = singlePhysicalRange(entry.statement.exportPhysicalSpan, sourceRevision);
    if (
      !range ||
      range.from < body.from ||
      range.to > body.to ||
      source.slice(range.from, range.to) !== "export"
    ) return null;
    let to = range.to;
    while (to < body.to && (source[to] === " " || source[to] === "\t")) to += 1;
    replacements.push({ from: range.from, to, text: "" });
  }
  return replacements;
};

const rebaseBodyLines = (
  lines: readonly string[],
  definitionIndent: string,
  instanceIndent: string
): string[] => lines.map((line) => {
  if (line.trim().length === 0) return line;
  return line.startsWith(definitionIndent)
    ? `${instanceIndent}${line.slice(definitionIndent.length)}`
    : `${instanceIndent}${DSL_INDENT}${line}`;
});

const trailingSourceSuffix = (
  source: string,
  starts: readonly number[],
  statement: DslStatement,
  info: NonNullable<CompiledDslDocument["statementMap"]>["statements"][number]
): string | null => {
  if (info.range.startLine !== info.range.endLine) return null;
  const lineStart = starts[info.range.startLine - 1];
  if (lineStart === undefined) return null;
  const lineEnd = lineEndOffset(source, starts, info.range.endLine);
  const physical = singlePhysicalRange(statement.physicalSpan, statement.sourceRevision);
  if (!physical || physical.from < lineStart || physical.to > lineEnd) return null;
  return source.slice(physical.to, lineEnd);
};

const instanceActivity = (
  statement: Extract<DslStatement, { kind: "moduleInstance" }>
): Activity | null => {
  const option = statement.options.find((candidate) => candidate.name === "state");
  if (!option) return "visible";
  return parseElementActivityLiteral(option.value) as Activity | null;
};

const semanticAnalysisFor = (compiled: CompiledDslDocument) =>
  compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;

const skip = (
  target: InlineModuleTargetIdentity,
  statementIndex: number | null,
  instanceName: string | null,
  code: InlineModuleKnownSkipCode,
  reason: string
): InlineModuleSkippedTarget => ({
  status: "skipped",
  target,
  statementIndex,
  instanceName,
  code,
  reason
});

const targetKey = (target: InlineModuleTargetIdentity): string =>
  encodeIdentityTuple([
    target.documentKey === null ? "local-document" : "qualified-document",
    target.documentKey ?? "",
    target.statementId
  ]);

const ownerStatementIdForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
): StatementIdentity | null => {
  if (identity.kind === "source" || identity.kind === "recordType" || identity.kind === "recordValue") {
    return identity.statementId;
  }
  if (identity.kind === "modifier") return null;
  if (identity.kind === "recordField") return identity.field.recordStatementId;
  if (identity.kind === "typed") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId)?.statementIndex;
    return statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  }
  if (identity.kind === "element") {
    const statementIndex = compiled.statementMap?.byElementId.get(identity.elementId)?.statementIndex;
    return statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  }

  const target = identity.target;
  if (target.kind === "documentBinding") {
    const statementIndex = compiled.bindingAnalysis?.catalog.bindingsById.get(target.bindingId)?.statementIndex;
    return statementIndex === undefined ? null : statementIdAt(compiled, statementIndex);
  }
  if (target.kind === "moduleParameter") return target.slot.definitionStatementId;
  return target.statementId;
};

const ownerTokenForIdentity = (
  compiled: CompiledDslDocument,
  identity: DslSemanticIdentity
): string => {
  const statementId = ownerStatementIdForIdentity(compiled, identity);
  return statementId === null
    ? `identity:${dslSemanticIdentityKey(identity)}`
    : `statement:${statementId}`;
};

const occurrenceSlotsForStatement = (
  source: string,
  compiled: CompiledDslDocument,
  index: DslSemanticOccurrenceIndex,
  statementIndex: number
): OccurrenceSlot[] => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return [];
  const slots = new Map<string, { kind: DslSemanticOccurrence["kind"]; token: string; ordinal: number; owners: Set<string> }>();
  const ordinalByToken = new Map<string, number>();
  for (const occurrence of index.occurrences) {
    if (
      occurrence.from < statement.documentRange.from ||
      occurrence.to > statement.documentRange.to
    ) continue;
    const key = `${occurrence.from}:${occurrence.to}:${occurrence.kind}`;
    const tokenKey = `${occurrence.kind}:${source.slice(occurrence.from, occurrence.to)}`;
    const current = slots.get(key);
    if (current) {
      current.owners.add(ownerTokenForIdentity(compiled, occurrence.identity));
    } else {
      const ordinal = ordinalByToken.get(tokenKey) ?? 0;
      ordinalByToken.set(tokenKey, ordinal + 1);
      slots.set(key, {
        kind: occurrence.kind,
        token: source.slice(occurrence.from, occurrence.to),
        ordinal,
        owners: new Set([ownerTokenForIdentity(compiled, occurrence.identity)])
      });
    }
  }
  return [...slots.values()].map((slot) => ({
    kind: slot.kind,
    token: slot.token,
    ordinal: slot.ordinal,
    owners: [...slot.owners].sort()
  }));
};

const occurrenceIsQualifiedTargetMember = (
  source: string,
  occurrence: DslSemanticOccurrence,
  statementOccurrences: readonly DslSemanticOccurrence[],
  targetStatementIds: ReadonlySet<StatementIdentity>
): StatementIdentity | null => {
  if (occurrence.kind !== "reference" || occurrence.identity.kind !== "module") return null;
  if (occurrence.identity.target.kind !== "moduleSource") return null;
  for (const prior of statementOccurrences) {
    if (
      prior.kind !== "reference" ||
      prior.identity.kind !== "module" ||
      prior.identity.target.kind !== "moduleInstance" ||
      !targetStatementIds.has(prior.identity.target.statementId) ||
      prior.to > occurrence.from ||
      source.slice(prior.to, occurrence.from) !== "::"
    ) continue;
    return prior.identity.target.statementId;
  }
  return null;
};

const expectedOwnerToken = (
  source: string,
  compiled: CompiledDslDocument,
  occurrence: DslSemanticOccurrence,
  statementOccurrences: readonly DslSemanticOccurrence[],
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): string => {
  const owner = ownerStatementIdForIdentity(compiled, occurrence.identity);
  if (owner === null) return ownerTokenForIdentity(compiled, occurrence.identity);

  if (occurrence.identity.kind === "module" && occurrence.identity.target.kind === "moduleInstance") {
    const mapping = mappingsByTarget.get(occurrence.identity.target.statementId);
    if (mapping) return `statement:${mapping.generatedGroupStatementId}`;
  }
  const targetStatementId = occurrenceIsQualifiedTargetMember(
    source,
    occurrence,
    statementOccurrences,
    new Set(mappingsByTarget.keys())
  );
  if (targetStatementId) {
    const mapping = mappingsByTarget.get(targetStatementId);
    const copiedStatementId = mapping?.bodyStatementIds.get(owner);
    if (copiedStatementId) return `statement:${copiedStatementId}`;
  }
  return `statement:${owner}`;
};

const compareSlots = (
  expected: readonly OccurrenceSlot[],
  actual: readonly OccurrenceSlot[]
): boolean =>
  expected.length === actual.length && expected.every((slot, index) => {
    const candidate = actual[index];
    return Boolean(
      candidate &&
      candidate.kind === slot.kind &&
      candidate.token === slot.token &&
      candidate.owners.length === slot.owners.length &&
      candidate.owners.every((owner, ownerIndex) => owner === slot.owners[ownerIndex])
    );
  });

const verifyPreservedSemanticOwners = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  replacedStatementIds: ReadonlySet<StatementIdentity>,
  mappingsByTarget: ReadonlyMap<StatementIdentity, OwnerMapping>
): boolean => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  for (const [statementIndex, statementId] of compiled.statementMap?.statementIdByStatementIndex ?? []) {
    if (replacedStatementIds.has(statementId)) continue;
    const statement = compiled.statements[statementIndex];
    if (!statement) return false;
    const statementOccurrences = beforeIndex.occurrences.filter((occurrence) =>
      occurrence.from >= statement.documentRange.from && occurrence.to <= statement.documentRange.to
    );
    // Structural and settings statements can receive reconciler ids in test
    // and host adapters, but they do not own semantic occurrences. There is
    // no resolution proof to perform for those ids.
    if (statementOccurrences.length === 0) continue;
    const nextIndex = nextCompiled.statementMap?.statementIndexByStatementId?.get(statementId);
    if (nextIndex === undefined) return false;
    const nextStatement = nextCompiled.statements[nextIndex];
    if (!nextStatement || nextStatement.kind !== statement.kind || nextStatement.name !== statement.name) return false;
    const expected = occurrenceSlotsForStatement(source, compiled, beforeIndex, statementIndex).map((slot) => {
      const owners = new Set<string>();
      const candidates = statementOccurrences.filter((candidate) =>
        candidate.kind === slot.kind && source.slice(candidate.from, candidate.to) === slot.token
      );
      const candidate = candidates[slot.ordinal];
      if (candidate) owners.add(expectedOwnerToken(source, compiled, candidate, statementOccurrences, mappingsByTarget));
      return { ...slot, owners: [...owners].sort() };
    });
    const actual = occurrenceSlotsForStatement(nextCompiled.spans.sourceMap.source, nextCompiled, afterIndex, nextIndex);
    if (!compareSlots(expected, actual)) return false;
  }
  return true;
};

const copyOwnerMappingFor = (
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  groupIndex: number,
  entry: InlineEntry
): OwnerMapping | null => {
  const nextEntries = nextCompiled.statements
    .map((statement, statementIndex) => ({ statement, statementIndex }))
    .filter(({ statement, statementIndex }) =>
      statementIndex !== groupIndex &&
      statement.enclosing?.statementIndex === groupIndex &&
      statement.kind !== "blockEnd" &&
      statement.kind !== "blockElse"
    );
  if (nextEntries.length !== entry.definition.bodyStatementIds.length) return null;

  const bodyStatementIds = new Map<StatementIdentity, StatementIdentity>();
  for (const [index, oldBodyId] of entry.definition.bodyStatementIds.entries()) {
    const oldBody = statementEntryForId(compiled, oldBodyId);
    const nextBody = nextEntries[index];
    const nextBodyId = nextBody ? statementIdAt(nextCompiled, nextBody.statementIndex) : null;
    if (
      !oldBody ||
      !nextBody ||
      !nextBodyId ||
      oldBody.statement.kind !== nextBody.statement.kind ||
      oldBody.statement.name !== nextBody.statement.name
    ) return null;
    bodyStatementIds.set(oldBodyId, nextBodyId);
  }

  const generatedGroupStatementId = statementIdAt(nextCompiled, groupIndex);
  return generatedGroupStatementId
    ? {
        targetStatementId: entry.target.statementId,
        generatedGroupStatementId,
        bodyStatementIds
      }
    : null;
};

const verifyCopiedBodyOwners = (
  source: string,
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entry: InlineEntry,
  mapping: OwnerMapping
): boolean => {
  const beforeIndex = createDslSemanticOccurrenceIndex(compiled);
  const afterIndex = createDslSemanticOccurrenceIndex(nextCompiled);
  const nextGroupIndex = statementIndexForId(nextCompiled, mapping.generatedGroupStatementId);
  if (nextGroupIndex === null) return false;

  for (const oldBodyId of entry.definition.bodyStatementIds) {
    const oldBodyIndex = statementIndexForId(compiled, oldBodyId);
    const nextBodyId = mapping.bodyStatementIds.get(oldBodyId);
    const nextBodyIndex = nextBodyId ? statementIndexForId(nextCompiled, nextBodyId) : null;
    if (oldBodyIndex === null || nextBodyIndex === null || nextBodyId === undefined) return false;
    const oldStatementOccurrences = beforeIndex.occurrences.filter((occurrence) => {
      const statement = compiled.statements[oldBodyIndex];
      return Boolean(statement && occurrence.from >= statement.documentRange.from && occurrence.to <= statement.documentRange.to);
    });
    const expected = occurrenceSlotsForStatement(source, compiled, beforeIndex, oldBodyIndex).map((slot) => ({
      ...slot,
      owners: (() => {
        const candidates = oldStatementOccurrences.filter((occurrence) =>
          occurrence.kind === slot.kind && source.slice(occurrence.from, occurrence.to) === slot.token
        );
        const candidate = candidates[slot.ordinal];
        if (!candidate) return [];
        const owner = ownerStatementIdForIdentity(compiled, candidate.identity);
        const copied = owner ? mapping.bodyStatementIds.get(owner) : undefined;
        return [copied ? `statement:${copied}` : ownerTokenForIdentity(compiled, candidate.identity)];
      })().sort()
    }));
    const actual = occurrenceSlotsForStatement(nextCompiled.spans.sourceMap.source, nextCompiled, afterIndex, nextBodyIndex);
    if (!compareSlots(expected, actual)) return false;
  }

  return nextCompiled.statements[nextGroupIndex]?.kind === "group";
};

const generatedGroupFor = (
  compiled: CompiledDslDocument,
  nextCompiled: CompiledDslDocument,
  entry: InlineEntry
): number | null => {
  const scopeId = compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(entry.statementIndex);
  if (!scopeId || !nextCompiled.sourceLexicalNamespace) return null;
  const candidates = nextCompiled.sourceLexicalNamespace.allDeclarations.filter((declaration) =>
    declaration.kind === "group" &&
    declaration.name === entry.statement.name &&
    declaration.scopeId === scopeId
  );
  return candidates.length === 1 ? candidates[0]!.statementIndex : null;
};

const replacementFor = (
  source: string,
  starts: readonly number[],
  compiled: CompiledDslDocument,
  entry: InlineEntry,
  body: BodyRange
): LineSplice | InlineModuleRejection => {
  const exportReplacements = exportedTokenReplacements(source, compiled, body);
  if (!exportReplacements) {
    return reject("unsafe-source-span", "Module export marker の exact-current source span を解決できません。", entry.target);
  }
  const bodyText = body.bodyLines.length === 0
    ? ""
    : applyAbsoluteReplacements(source, body.from, body.to, exportReplacements);
  if (bodyText === null) {
    return reject("unsafe-rewrite", "Module body の export rewrite が重複しています。", entry.target);
  }
  const instanceLine = source.slice(
    starts[entry.statementInfo.line - 1]!,
    lineEndOffset(source, starts, entry.statementInfo.line)
  );
  const instanceIndent = leadingWhitespace(instanceLine);
  const suffix = trailingSourceSuffix(source, starts, entry.statement, entry.statementInfo);
  if (suffix === null) {
    return reject("unsafe-source-span", "Inline target の exact-current source range を解決できません。", entry.target);
  }
  const rewrittenBodyLines = bodyText.length === 0
    ? []
    : rebaseBodyLines(bodyText.split("\n"), body.definitionIndent, instanceIndent);
  const activityText = entry.activity === "visible" ? "" : `(state: ${entry.activity})`;
  return {
    startLine: entry.statementInfo.range.startLine,
    endLine: entry.statementInfo.range.endLine,
    replacementLines: [
      `${instanceIndent}group ${formatDslName(entry.statement.name)}${activityText} {${suffix}`,
      ...rewrittenBodyLines,
      `${instanceIndent}}`
    ]
  };
};

/** Plan a safe, host-neutral Checkpoint 1 Module inline mutation. */
export const planInlineModule = (input: InlineModulePlanInput): InlineModulePlanResult => {
  const { source: snapshot, compiled, policy } = input;
  const source = snapshot.normalizedSource;
  const statementMap = compiled.statementMap;
  const namespace = compiled.sourceLexicalNamespace;
  const analysis = semanticAnalysisFor(compiled);
  if (
    !statementMap ||
    !namespace ||
    !analysis ||
    snapshot.sourceRevision !== statementMap.sourceRevision ||
    snapshot.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
    source !== compiled.spans.sourceMap.source ||
    !cleanCompile(compiled) ||
    !cleanSemanticAnalysis(compiled)
  ) {
    return reject(
      "stale-semantic-snapshot",
      "Inline Module には error-free な exact-current source/semantic snapshot が必要です。"
    );
  }
  if (input.targets.length === 0) {
    return reject("invalid-target", "Inline Module には1件以上の document-qualified target が必要です。");
  }

  const deduplicated = new Map<string, InlineModuleTargetIdentity>();
  for (const target of input.targets) {
    if (
      typeof target.statementId !== "string" ||
      (target.documentKey !== null && typeof target.documentKey !== "string")
    ) {
      return reject("invalid-target", "Inline target identity の document/statement owner が不正です。");
    }
    const key = targetKey(target);
    if (!deduplicated.has(key)) deduplicated.set(key, target);
  }

  const resolved = [...deduplicated.values()].map((target) => {
    if (target.documentKey !== null) return { target, statementIndex: null as number | null };
    return {
      target,
      statementIndex: statementIndexForId(compiled, target.statementId)
    };
  });
  const invalidLocal = resolved.find((entry) =>
    entry.target.documentKey === null && entry.statementIndex === null
  );
  if (invalidLocal) {
    return reject(
      "invalid-target",
      "Inline target が current authored source statement として解決できません。",
      invalidLocal.target
    );
  }
  resolved.sort((left, right) => {
    if (left.statementIndex === null && right.statementIndex === null) {
      return targetKey(left.target).localeCompare(targetKey(right.target));
    }
    if (left.statementIndex === null) return 1;
    if (right.statementIndex === null) return -1;
    return left.statementIndex - right.statementIndex;
  });

  const starts = lineStarts(source);
  const results: InlineModuleTargetResult[] = [];
  const splices: LineSplice[] = [];
  const inlined: InlineEntry[] = [];

  for (const entry of resolved) {
    const { target, statementIndex } = entry;
    if (target.documentKey !== null) {
      results.push(skip(target, null, null, "non-local-target", "Imported / multi-document Inline はこの local planner slice の対象外です。"));
      continue;
    }
    if (statementIndex === null) {
      return reject("invalid-target", "Inline target が current authored source statement として解決できません。", target);
    }
    const statement = compiled.statements[statementIndex];
    const instance = analysis.instancesByStatementId.get(target.statementId);
    const mappedTargetInfo = statementMap.statementRangeById.get(target.statementId);
    if (!statement || statement.kind !== "moduleInstance") {
      results.push(skip(target, statementIndex, statement?.name ?? null, "not-module-instance", "対象 statement は Module instance ではありません。"));
      continue;
    }
    if (
      !mappedTargetInfo ||
      mappedTargetInfo.statementIndex !== statementIndex ||
      mappedTargetInfo.sourceRevision !== snapshot.sourceRevision
    ) {
      return reject("stale-semantic-snapshot", "Inline target の authored statement map が exact-current ではありません。", target);
    }
    if (
      !instance ||
      instance.statementIndex !== statementIndex ||
      instance.name !== statement.name ||
      instance.calleeResolution !== "resolved" ||
      !instance.callee ||
      instance.callee.name !== statement.moduleName
    ) {
      results.push(skip(target, statementIndex, statement.name, "unresolved-callee", "local Module definition を一意に解決できません。"));
      continue;
    }
    const definition = analysis.definitionsByStatementId.get(instance.callee.definitionStatementId);
    const definitionStatement = definition ? compiled.statements[definition.statementIndex] : undefined;
    if (
      !definition ||
      definition.statementId !== instance.callee.definitionStatementId ||
      definition.statementIndex !== instance.callee.definitionStatementIndex ||
      definitionStatement?.kind !== "moduleDefinition"
    ) {
      return reject("unsafe-rewrite", "Resolved Module definition の semantic owner が見つかりません。", target);
    }

    const activity = instanceActivity(statement);
    if (!activity) {
      return reject("unsafe-source-span", "Module instance の activity を exact-current semantic value として解決できません。", target);
    }
    if (activity === "hidden" && !policy.includeHiddenInstances) {
      results.push(skip(target, statementIndex, statement.name, "hidden-excluded", "hidden instance は現在の policy で除外されています。"));
      continue;
    }
    if (activity === "disabled" && !policy.includeDisabledInstances) {
      results.push(skip(target, statementIndex, statement.name, "disabled-excluded", "disabled instance は現在の policy で除外されています。"));
      continue;
    }
    if (definition.parameters.length > 0 || instance.parameterBindings.length > 0) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "parameter-lowering-required",
        "この Checkpoint 1 slice では parameter lowering を未実装のため parameterized Module を安全側で除外します。"
      ));
      continue;
    }
    if (instance.callerModuleDefinitionStatementId !== null) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "nested-module-validation-required",
        "Module body 内の Module instance は broad capture-preservation 検証が必要なためこの slice の対象外です。"
      ));
      continue;
    }

    const body = bodyRangeForDefinition(source, starts, compiled, definition);
    if (!body) {
      return reject("unsafe-source-span", "Module body の exact-current source range を解決できません。", target);
    }
    if (bodyRequiresDeferredValidation(body.entries, body.definitionStatementIndex)) {
      results.push(skip(
        target,
        statementIndex,
        statement.name,
        "nested-module-validation-required",
        "Module body の nested structure は broad capture-preservation 検証が必要なためこの slice の対象外です."
      ));
      continue;
    }

    const info = statementMap.statements[statementIndex];
    const targetPhysical = singlePhysicalRange(statement.physicalSpan, snapshot.sourceRevision);
    if (
      !info ||
      info.sourceRevision !== snapshot.sourceRevision ||
      statement.documentRange.sourceRevision !== snapshot.sourceRevision ||
      info.range.startLine !== info.range.endLine ||
      !targetPhysical
    ) {
      return reject("unsafe-source-span", "Inline target の exact-current authored statement span を解決できません。", target);
    }
    const replacement = replacementFor(source, starts, compiled, {
      target,
      statementIndex,
      statement,
      instance,
      definition,
      activity,
      statementInfo: info
    }, body);
    if ("status" in replacement) return replacement;
    splices.push(replacement);
    inlined.push({
      target,
      statementIndex,
      statement,
      instance,
      definition,
      activity,
      statementInfo: info
    });
    results.push({
      status: "inlined",
      target,
      statementIndex,
      instanceName: statement.name,
      moduleDefinitionStatementId: definition.statementId,
      activity,
      generatedGroupName: statement.name,
      sourceRange: { startLine: info.range.startLine, endLine: info.range.endLine }
    });
  }

  splices.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
  try {
    applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }
  if (splices.length === 0) {
    return { status: "planned", sourceRevision: snapshot.sourceRevision, targets: results, splices };
  }

  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(source, splices);
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }

  const nextRevision = snapshot.sourceRevision + 1;
  let nextCompiled: CompiledDslDocument;
  try {
    const parsed = parseDslSnapshot({ normalizedSource: candidateSource, sourceRevision: nextRevision });
    const reconciled = reconcileStatements({
      oldStatements: compiled.statements,
      oldLines: compiled.sourceLines,
      oldElementIds: statementMap.elementIdByStatementIndex,
      oldStatementIds: statementMap.statementIdByStatementIndex,
      newStatements: parsed.statements,
      newLines: candidateSource.split("\n")
    });
    nextCompiled = compileDslDocument(candidateSource, {
      preparsed: parsed,
      sourceRevision: nextRevision,
      assignedElementIds: reconciled.assignedIds,
      assignedStatementIds: reconciled.assignedIds
    });
  } catch (error) {
    return reject("unsafe-rewrite", error instanceof Error ? error.message : String(error));
  }
  if (
    !nextCompiled.statementMap ||
    !nextCompiled.sourceLexicalNamespace ||
    !semanticAnalysisFor(nextCompiled) ||
    !cleanCompile(nextCompiled) ||
    !cleanSemanticAnalysis(nextCompiled)
  ) {
    const diagnostic = [...nextCompiled.diagnostics, ...(nextCompiled.bindingIssueDiagnostics ?? [])]
      .find((candidate) => candidate.severity === "error");
    return reject("unsafe-rewrite", diagnostic?.message ?? "Inline 後の source semantics を安全に再コンパイルできません。");
  }

  const mappings = new Map<StatementIdentity, OwnerMapping>();
  for (const entry of inlined) {
    const groupIndex = generatedGroupFor(compiled, nextCompiled, entry);
    if (groupIndex === null) return reject("unsafe-rewrite", "生成した group の exact semantic owner を解決できません。", entry.target);
    const mapping = copyOwnerMappingFor(compiled, nextCompiled, groupIndex, entry);
    if (!mapping || !verifyCopiedBodyOwners(source, compiled, nextCompiled, entry, mapping)) {
      return reject("unsafe-rewrite", "コピーした Module body の semantic ownership を証明できません。", entry.target);
    }
    mappings.set(entry.target.statementId, mapping);
  }

  const replacedIds = new Set(inlined.map((entry) => entry.target.statementId));
  if (!verifyPreservedSemanticOwners(source, compiled, nextCompiled, replacedIds, mappings)) {
    return reject("unsafe-rewrite", "Inline 後に preserved statement の semantic resolution が変化するため適用できません。");
  }

  return {
    status: "planned",
    sourceRevision: snapshot.sourceRevision,
    targets: results,
    splices
  };
};
