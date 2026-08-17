import { exactPhysicalSpan } from "./dslDiagnosticSpan";
import type { CompiledDslDocument } from "./dslDocument";
import {
  createModuleSemanticRangeIndex,
  moduleSemanticTargetKey,
  type ModuleSemanticTarget
} from "./moduleSemanticEditor";
import {
  parseDslReferenceToken,
  parseDslSourceReference,
  readDslReferencePathSegments
} from "./dslReferenceTokens";
import {
  resolveSourceLexicalPathSegments,
  type SourceLexicalDeclaration
} from "./sourceLexicalNamespaceIndex";
import type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
import type { BindingId } from "../scalars/bindingCatalog";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { geometryPropertiesIn, referencesIn } from "../scalars/typedDependencyGraph";
import { parsePropertyBindingOccurrenceKey } from "../scalars/propertyBindingCompiler";
import type { CompiledNumericBinding } from "../scalars/numericBindingCompiler";
import type { TypedScalarExpression } from "../scalars/typedExpressionAst";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { coordinateComponent } from "./dslParameterSpanScanner";
import { analyzeTypedBindingRenameInDocument } from "../document/typedRenameAnalysis";
import {
  projectTypedRenameEdits,
  type TypedRenameSpliceEntry
} from "../document/typedRenameSplice";
import {
  analyzeModuleSemanticRename
} from "../document/moduleSemanticRenameAnalysis";
import {
  analyzeRename,
  projectElementRenameEdits
} from "../document/renameAnalysis";
import type { ElementId } from "../types/geometry";

export type DslRenameTarget = {
  sourceRevision: SourceRevision;
  oldName: string;
  range: { from: number; to: number };
};

export type DslRenameEdit = {
  from: number;
  to: number;
  expectedText: string;
  newText: string;
};

export type DslRenameEditPlan = {
  sourceRevision: SourceRevision;
  target: DslRenameTarget;
  edits: readonly DslRenameEdit[];
};

export type DslRenameSemanticSnapshot = {
  sourceRevision: SourceRevision;
  sourceText?: string;
  compiled?: CompiledDslDocument;
  bindingAnalysis?: BindingAnalysis;
};

export type DslRenameSnapshot = {
  source: SourceSnapshot;
  semantic?: DslRenameSemanticSnapshot;
};

type RenameIdentity =
  | { kind: "typed"; bindingId: BindingId }
  | { kind: "module"; target: ModuleSemanticTarget }
  | { kind: "element"; elementId: ElementId };

type RenameCandidate = {
  from: number;
  to: number;
  identity: RenameIdentity;
};

type ExactSnapshot = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
};

const identityKey = (identity: RenameIdentity) => {
  if (identity.kind === "typed") return `typed:${identity.bindingId}`;
  if (identity.kind === "element") return `element:${identity.elementId}`;
  return `module:${moduleSemanticTargetKey(identity.target)}`;
};

const semanticSourceText = (semantic: DslRenameSemanticSnapshot) =>
  semantic.sourceText ?? semantic.compiled?.spans.sourceMap.source;

const exactSnapshot = (snapshot: DslRenameSnapshot): ExactSnapshot | null => {
  const { source, semantic } = snapshot;
  if (
    source.normalizedSource.includes("\r") ||
    !semantic?.compiled ||
    semantic.sourceRevision !== source.sourceRevision ||
    semanticSourceText(semantic) !== source.normalizedSource
  ) return null;
  const compiled = semantic.bindingAnalysis && semantic.compiled.bindingAnalysis !== semantic.bindingAnalysis
    ? { ...semantic.compiled, bindingAnalysis: semantic.bindingAnalysis }
    : semantic.compiled;
  if (
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) return null;
  return { source, compiled };
};

const physicalRange = (compiled: CompiledDslDocument, statementIndex: number, span: { start: number; end: number }) => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const physical = exactPhysicalSpan(compiled.spans, statement, span);
  return physical?.segments.length === 1 ? physical.segments[0] : null;
};

const statementIndexForId = (compiled: CompiledDslDocument, statementId: string) =>
  compiled.statementMap?.statementIndexByStatementId?.get(statementId);

const elementIdForStatementIndex = (compiled: CompiledDslDocument, statementIndex: number): ElementId | null => {
  const elementId = compiled.statementMap?.elementIdByStatementIndex.get(statementIndex);
  return elementId && compiled.document?.elements.some((element) => element.id === elementId) ? elementId : null;
};

const identityForModuleTarget = (compiled: CompiledDslDocument, target: ModuleSemanticTarget): RenameIdentity | null => {
  if (target.kind === "documentBinding") return { kind: "typed", bindingId: target.bindingId };
  if (target.kind === "moduleIteration" || target.kind === "moduleElementLocalVariable") return null;
  if (target.kind === "moduleSource") {
    const statementIndex = statementIndexForId(compiled, target.statementId);
    const elementId = statementIndex === undefined ? null : elementIdForStatementIndex(compiled, statementIndex);
    if (elementId) return { kind: "element", elementId };
  }
  return { kind: "module", target };
};

const addCandidate = (candidates: RenameCandidate[], from: number, to: number, identity: RenameIdentity | null) => {
  if (!identity || from >= to) return;
  candidates.push({ from, to, identity });
};

const addPhysicalCandidate = (
  candidates: RenameCandidate[],
  compiled: CompiledDslDocument,
  statementIndex: number,
  span: { start: number; end: number },
  identity: RenameIdentity | null
) => {
  const physical = physicalRange(compiled, statementIndex, span);
  if (physical) addCandidate(candidates, physical.from, physical.to, identity);
};

const elementIdentity = (compiled: CompiledDslDocument, elementId: string | null): RenameIdentity | null =>
  elementId && compiled.document?.elements.some((element) => element.id === elementId)
    ? { kind: "element", elementId }
    : null;

/** Returns the existing compiler-owned logical value span for one numeric binding. */
const numericValueSpan = (
  compiled: CompiledDslDocument,
  statementIndex: number,
  parameterKey: string
) => {
  const statement = compiled.statements[statementIndex];
  if (!statement) return null;
  const logical = compiled.spans.logicalStatementByRangeFrom.get(statement.documentRange.from);
  if (!logical) return null;

  if (statement.kind === "element" || statement.kind === "group") {
    const elementId = elementIdForStatementIndex(compiled, statementIndex);
    const element = elementId ? compiled.document?.elements.find((candidate) => candidate.id === elementId) : undefined;
    return element ? resolveParameterValueSpan(logical.logicalText, element, parameterKey) : null;
  }

  if (statement.kind !== "printLayout" && statement.kind !== "place") return null;
  const coordinate = parameterKey.match(/^(.+):(x|y)$/);
  const attributeKey = coordinate?.[1] ?? parameterKey;
  const outer = statement.payloadSpans[attributeKey];
  if (!outer) return null;
  return coordinate
    ? coordinateComponent(logical.logicalText, outer, coordinate[2] as "x" | "y")
    : outer;
};

const addTypedCandidates = (compiled: CompiledDslDocument, candidates: RenameCandidate[]) => {
  const analysis = compiled.bindingAnalysis;
  if (!analysis) return;
  for (const binding of analysis.catalog.bindings) {
    if (binding.kind !== "typed" || !binding.nameSpan) continue;
    addPhysicalCandidate(candidates, compiled, binding.statementIndex, binding.nameSpan, { kind: "typed", bindingId: binding.id });
  }
  const addExpression = (statementIndex: number, expression: TypedScalarExpression) => {
    for (const reference of referencesIn(expression)) {
      if (!reference.bindingId) continue;
      addPhysicalCandidate(candidates, compiled, statementIndex, reference.nameSpan, {
        kind: "typed",
        bindingId: reference.bindingId
      });
    }
  };
  for (const statement of compiled.scalarProgram?.statements ?? []) {
    addExpression(statement.sourceOrder, statement.declaration.initializer);
  }
  for (const [occurrenceKey, source] of compiled.propertyBindings ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (!Number.isInteger(statementIndex)) continue;
    if (source.kind === "binding") {
      addPhysicalCandidate(candidates, compiled, statementIndex, source.nameSpan, { kind: "typed", bindingId: source.bindingId });
    } else if (source.kind === "expression") {
      addExpression(statementIndex, source.expression);
    }
  }
  for (const [occurrenceKey, expression] of compiled.conditionalGroupConditions ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (Number.isInteger(statementIndex)) addExpression(statementIndex, expression);
  }
  for (const [statementIndex, analysisForSet] of compiled.setStatements ?? []) {
    if (analysisForSet.targetBindingId) {
      addPhysicalCandidate(candidates, compiled, statementIndex, compiled.statements[statementIndex]?.nameSpan ?? { start: 0, end: 0 }, {
        kind: "typed",
        bindingId: analysisForSet.targetBindingId
      });
    }
    addExpression(statementIndex, analysisForSet.expression);
  }
  for (const [occurrenceKey, template] of compiled.textTemplates ?? []) {
    const statementIndex = Number(occurrenceKey.slice(0, occurrenceKey.indexOf(":")));
    if (!Number.isInteger(statementIndex)) continue;
    for (const segment of template.segments) {
      if (segment.kind !== "hole" || segment.holeKind === "numeric") continue;
      addExpression(statementIndex, segment.expression);
    }
  }
  for (const [occurrenceKey, numeric] of compiled.numericBindings ?? []) {
    const occurrence = parsePropertyBindingOccurrenceKey(occurrenceKey);
    if (occurrence) addNumericGeometryPropertyCandidates(compiled, candidates, occurrence.statementIndex, numeric);
    for (const reference of numeric.references) {
      const physical = reference.physicalNameSpan?.segments.length === 1
        ? reference.physicalNameSpan.segments[0]
        : null;
      if (physical) addCandidate(candidates, physical.from, physical.to, { kind: "typed", bindingId: reference.bindingId });
    }
  }
};

const declarationIdentity = (compiled: CompiledDslDocument, declaration: SourceLexicalDeclaration): RenameIdentity | null => {
  const elementId = elementIdForStatementIndex(compiled, declaration.statementIndex);
  if (elementId) return { kind: "element", elementId };
  if (declaration.kind === "geometry" || declaration.kind === "typedDeclaration") {
    const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(declaration.statementIndex);
    return statementId ? { kind: "module", target: { kind: "moduleSource", statementId } } : null;
  }
  return null;
};

const addQualifiedPathCandidates = (
  compiled: CompiledDslDocument,
  candidates: RenameCandidate[],
  statementIndex: number,
  nameSpan: { start: number; end: number },
  finalTarget: RenameIdentity | null
) => {
  const physical = physicalRange(compiled, statementIndex, nameSpan);
  const namespace = compiled.sourceLexicalNamespace;
  if (!physical || !namespace) return;
  const source = compiled.spans.sourceMap.source;
  const pathText = source.slice(physical.from, physical.to);
  const path = parseDslReferenceToken(pathText);
  const resolved = resolveSourceLexicalPathSegments(namespace, statementIndex, path);
  if (resolved.segments.length !== path.segments.length) return;
  const ranges = readDslReferencePathSegments(source, physical.from, physical.to);
  if (ranges.kind !== "valid" || ranges.segments.length !== resolved.segments.length) return;
  resolved.segments.forEach((declaration, index) => {
    const identity = declarationIdentity(compiled, declaration) ?? (index === resolved.segments.length - 1 ? finalTarget : null);
    const range = ranges.segments[index];
    if (range) addCandidate(candidates, range.start, range.end, identity);
  });
};

const addNumericGeometryPropertyCandidates = (
  compiled: CompiledDslDocument,
  candidates: RenameCandidate[],
  statementIndex: number,
  numeric: CompiledNumericBinding
) => {
  if (!numeric.typedExpression) return;
  const valueSpan = numericValueSpan(compiled, statementIndex, numeric.parameterKey);
  if (!valueSpan) return;
  for (const reference of geometryPropertiesIn(numeric.typedExpression)) {
    const identity = elementIdentity(compiled, reference.elementId);
    if (!identity) continue;
    addQualifiedPathCandidates(
      compiled,
      candidates,
      statementIndex,
      {
        start: valueSpan.start + reference.elementNameSpan.start,
        end: valueSpan.start + reference.elementNameSpan.end
      },
      identity
    );
  }
};

const addModuleSemanticPathCandidates = (compiled: CompiledDslDocument, candidates: RenameCandidate[]) => {
  const analysis = compiled.moduleSemanticAnalysis ?? compiled.sourceSemanticAnalysis;
  if (!analysis) return;
  const addGeometry = (statementIndex: number, reference: { nameSpan?: { start: number; end: number }; target: unknown }) => {
    if (!reference.nameSpan || !reference.target) return;
    const target = reference.target as { kind?: string; statementId?: string };
    const finalTarget = target.kind === "sourceGeometry" || target.kind === "sourceGeometryProperty"
      ? target.statementId
        ? identityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId })
        : null
      : null;
    addQualifiedPathCandidates(compiled, candidates, statementIndex, reference.nameSpan, finalTarget);
  };
  for (const [statementId, references] of analysis.rootGeometryReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined) continue;
    for (const reference of references) {
      addGeometry(statementIndex, reference.reference);
    }
  }
  for (const [statementId, site] of analysis.rootScalarExpressionsByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined) continue;
    for (const reference of site.expression.geometryProperties) addGeometry(statementIndex, reference);
  }
  for (const [statementId, site] of analysis.rootParentReferencesByStatementId) {
    const statementIndex = statementIndexForId(compiled, statementId);
    if (statementIndex === undefined || !site.reference.nameSpan || !site.reference.target) continue;
    const target = site.reference.target;
    const finalTarget = target.kind === "sourceContainer"
      ? identityForModuleTarget(compiled, { kind: "moduleSource", statementId: target.statementId })
      : null;
    addQualifiedPathCandidates(compiled, candidates, statementIndex, site.reference.nameSpan, finalTarget);
  }
  for (const definition of analysis.definitions) {
    for (const body of definition.bodyStatements) {
      for (const reference of body.geometryReferences) addGeometry(body.statementIndex, reference.reference);
      for (const site of body.scalarExpressions) {
        for (const reference of site.expression.geometryProperties) addGeometry(body.statementIndex, reference);
      }
      for (const site of body.textTemplateHoles) {
        for (const reference of site.expression.geometryProperties) addGeometry(body.statementIndex, reference);
      }
    }
  }
};

const addModuleCandidates = (compiled: CompiledDslDocument, candidates: RenameCandidate[]) => {
  const semanticCompiled = compiled.moduleSemanticAnalysis || !compiled.sourceSemanticAnalysis
    ? compiled
    : { ...compiled, moduleSemanticAnalysis: compiled.sourceSemanticAnalysis };
  const index = createModuleSemanticRangeIndex(semanticCompiled);
  for (const token of index.tokens) {
    const identity = identityForModuleTarget(compiled, token.target);
    addCandidate(candidates, token.from, token.to, identity);
  }
  addModuleSemanticPathCandidates(compiled, candidates);
};

const addRootDeclarations = (compiled: CompiledDslDocument, candidates: RenameCandidate[]) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const declaration of namespace.allDeclarations) {
    if (
      declaration.kind !== "group" &&
      declaration.kind !== "geometry" &&
      declaration.kind !== "conditionalGroup" &&
      declaration.kind !== "forGroup"
    ) continue;
    const identity = declarationIdentity(compiled, declaration);
    if (!identity || !declaration.nameSpan) continue;
    const physical = physicalRange(compiled, declaration.statementIndex, declaration.nameSpan);
    if (physical) addCandidate(candidates, physical.from, physical.to, identity);
  }
};

const addPrintLayoutCandidates = (compiled: CompiledDslDocument, candidates: RenameCandidate[]) => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace) return;
  for (const [statementIndex, statement] of compiled.statements.entries()) {
    if (statement.kind !== "place") continue;
    const valueSpan = statement.payloadSpans.group;
    const physical = valueSpan ? physicalRange(compiled, statementIndex, valueSpan) : null;
    if (!physical) continue;
    const parsed = parseDslSourceReference(compiled.spans.sourceMap.source.slice(physical.from, physical.to));
    if (parsed.kind !== "valid" || parsed.reference.property) continue;
    const path = parseDslReferenceToken(parsed.reference.pathText);
    const resolved = resolveSourceLexicalPathSegments(namespace, statementIndex, path);
    const ranges = readDslReferencePathSegments(
      compiled.spans.sourceMap.source,
      physical.from + parsed.reference.pathRange.start,
      physical.from + parsed.reference.pathRange.end
    );
    if (resolved.segments.length !== 1 || ranges.kind !== "valid" || ranges.segments.length !== 1) continue;
    const identity = declarationIdentity(compiled, resolved.segments[0]);
    const range = ranges.segments[0];
    if (range) addCandidate(candidates, range.start, range.end, identity);
  }
};

const candidatesFor = (compiled: CompiledDslDocument) => {
  const candidates: RenameCandidate[] = [];
  addTypedCandidates(compiled, candidates);
  addRootDeclarations(compiled, candidates);
  addModuleCandidates(compiled, candidates);
  addPrintLayoutCandidates(compiled, candidates);
  return candidates;
};

const candidateAt = (compiled: CompiledDslDocument, position: number): { candidate: RenameCandidate; target: DslRenameTarget } | null => {
  const candidates = candidatesFor(compiled)
    .filter((candidate) => position >= candidate.from && position < candidate.to)
    .sort((left, right) => (left.to - left.from) - (right.to - right.from));
  if (candidates.length === 0) return null;
  const shortest = candidates[0].to - candidates[0].from;
  const shortestCandidates = candidates.filter((candidate) => candidate.to - candidate.from === shortest);
  const keys = new Set(shortestCandidates.map((candidate) => identityKey(candidate.identity)));
  if (keys.size !== 1) return null;
  const candidate = shortestCandidates[0];
  const oldName = compiled.spans.sourceMap.source.slice(candidate.from, candidate.to);
  if (!oldName) return null;
  return {
    candidate,
    target: { sourceRevision: compiled.spans.sourceMap.sourceRevision, oldName, range: { from: candidate.from, to: candidate.to } }
  };
};

const editsAreSafe = (edits: readonly DslRenameEdit[]) => {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].from < ordered[index - 1].to) return false;
  }
  const seen = new Set(ordered.map((edit) => `${edit.from}:${edit.to}`));
  return seen.size === ordered.length;
};

export const queryDslRenameTarget = (
  snapshot: DslRenameSnapshot,
  sourceOffset: number
): DslRenameTarget | null => {
  const exact = exactSnapshot(snapshot);
  if (!exact || sourceOffset < 0 || sourceOffset >= exact.source.normalizedSource.length) return null;
  return candidateAt(exact.compiled, sourceOffset)?.target ?? null;
};

export const planDslRenameEdits = (
  snapshot: DslRenameSnapshot,
  sourceOffset: number,
  newName: string
): DslRenameEditPlan | null => {
  const exact = exactSnapshot(snapshot);
  if (!exact || sourceOffset < 0 || sourceOffset >= exact.source.normalizedSource.length) return null;
  const selected = candidateAt(exact.compiled, sourceOffset);
  if (!selected) return null;

  let edits: readonly DslRenameEdit[];
  const identity = selected.candidate.identity;
  if (identity.kind === "typed") {
    const analysis = analyzeTypedBindingRenameInDocument({ compiled: exact.compiled, targetBindingId: identity.bindingId, newName });
    if (analysis.verdict !== "ok" || !analysis.declarationSpan) return null;
    const target = exact.compiled.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
    if (!target) return null;
    const entries: TypedRenameSpliceEntry[] = [
      { statementIndex: target.statementIndex, span: analysis.declarationSpan, oldName: target.name, newName: analysis.newName },
      ...analysis.occurrences
    ];
    const projection = projectTypedRenameEdits(exact.source.normalizedSource, exact.compiled, entries);
    if (!projection.ok) return null;
    edits = projection.edits.map((edit) => ({ ...edit }));
  } else if (identity.kind === "module") {
    const analysis = analyzeModuleSemanticRename(exact.source.normalizedSource, exact.compiled, identity.target, newName);
    if (analysis.verdict !== "ok") return null;
    const projection = projectTypedRenameEdits(exact.source.normalizedSource, exact.compiled, analysis.entries);
    if (!projection.ok) return null;
    edits = projection.edits.map((edit) => ({ ...edit }));
  } else {
    const analysis = analyzeRename({
      sourceText: exact.source.normalizedSource,
      compiled: exact.compiled,
      targetElementId: identity.elementId,
      newName
    });
    if (analysis.verdict !== "ok") return null;
    const projection = projectElementRenameEdits({
      sourceText: exact.source.normalizedSource,
      compiled: exact.compiled,
      targetElementId: identity.elementId,
      analysis
    });
    if (!projection.ok) return null;
    edits = projection.edits.map((edit) => ({ ...edit }));
  }

  if (!editsAreSafe(edits)) return null;
  return {
    sourceRevision: exact.source.sourceRevision,
    target: selected.target,
    edits
  };
};

export type { SourceRevision, SourceSnapshot } from "./logicalStatementSourceMap";
