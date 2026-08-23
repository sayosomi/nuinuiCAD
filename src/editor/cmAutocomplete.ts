import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
  type Completion,
  CompletionContext,
  type CompletionSource
} from "@codemirror/autocomplete";
import { Prec, type Extension, type Text } from "@codemirror/state";
import { keymap, type Command, type EditorView } from "@codemirror/view";
import { dslCompletionContextAt, dslIntermediatesAttributeParameterKey, type DslCompletionContext } from "../dsl/dslCompletionContext";
import { scanDslSource } from "../dsl/dslTokens";
import { dslChoiceTypeName, dslModuleParameterTypeNames, dslTypedDeclarationTypeNames } from "../dsl/dslDeclarationParser";
import { argumentCompletionCandidates, constructionCompletionCandidates } from "../dsl/dslCallCompletionCandidates";
import { dslReferenceCompletionOptions } from "../dsl/dslCompletionCandidates";
import {
  createLogicalStatementSourceMap,
  logicalOffsetToPhysical,
  physicalSpanForLogicalRange,
  physicalToLogicalOffset,
  type LogicalStatement,
  type LogicalStatementSourceMap
} from "../dsl/logicalStatementSourceMap";
import type { CadElement, ComputedGeometry, DependencyError, ElementId, EvaluationResult } from "../types/geometry";
import type { ScopeBodyRangeIndex, StatementRangeIndex, TypedDeclarationRangeIndex } from "./statementRangeIndex";
import { deepestContainingScopeId, typedDeclarationBindingIdAtCursor } from "./statementRangeIndex";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import type { StatementInfo } from "../dsl/dslDocument";
import { isScalarTypeAssignable } from "../scalars/scalarAssignability";
import { formatBuiltinFunctionSignatures, getBuiltinFunctionDefinition } from "../scalars/builtinFunctions";
import {
  scalarExpressionCandidates,
  scalarFunctionCandidates,
  scalarLiteralCandidates,
  scalarPrefixOperatorCandidates,
  templateHoleScalarCandidates,
  typedBindingReferenceCandidates,
  type ScalarCompletionCandidate
} from "../scalars/typedValueCandidates";
import type { ScalarType } from "../scalars/types";
import type { ScalarExpressionCompletionContext } from "../scalars/scalarExpressionPositionClassifier";
import { setRhsScalarCandidates, setTargetCandidates, type SetCompletionSiteDeps, type SetTargetCandidate } from "../scalars/setCompletionCandidates";
import { mergeSetTargetCandidates, recoverLiveSetTargetCandidates, type SetTargetCompletionCandidate } from "../scalars/setTargetRecoveryCandidates";
import { visibleTypedBindingsAtLivePosition } from "../scalars/liveTypedBindingVisibility";
import { cmCompositionCompletionRetry } from "./cmCompositionCompletionRetry";
import { cmDeleteCompletionRetry } from "./cmDeleteCompletionRetry";
import { elementPropertyCompletions } from "./elementPropertyCompletions";
import { isInsideModuleSemanticStatement, moduleCompletionCandidates, type ModuleCompletionCandidate, type ModuleCompletionSite } from "../dsl/moduleCompletionCandidates";
import { isScopeWithin } from "../dsl/moduleLexicalResolution";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  queryDslCompletion,
  type DslCompletionCandidate,
  type DslCompletionQueryResult,
  type DslCompletionSemanticSnapshot
} from "../dsl/dslCompletionQuery";

export type DslAutocompleteDocumentInput = {
  source: string;
  cursorLineNumber: number;
  lineText: string;
  localPos: number;
  doc: Text;
  startsInBlockComment?: boolean;
};

export type DslAutocompleteOptions = {
  elements: () => readonly CadElement[];
  statementRanges: () => StatementRangeIndex;
  isComposing: () => boolean;
  /** Last-applied evaluation's computedGeometry/effectiveEnabledElementIds/errors,
   * used for dslElementParameterCompletionOptions's disabled/invalid gating. */
  computedGeometry: () => Map<ElementId, ComputedGeometry> | undefined;
  forGroupGeneratedRows?: () => EvaluationResult["forGroupGeneratedRows"] | undefined;
  effectiveEnabledElementIds: () => Set<ElementId> | undefined;
  evaluationErrors: () => DependencyError[] | undefined;
  /** Tier B for typed value completion (Task 39): the last successfully
   * compiled document's precomputed BindingCatalog/BindingAnalysis, read
   * as-is on every keystroke (never rebuilt here) - undefined for a document
   * with no typed declarations || set statements. */
  bindingAnalysis: () => BindingAnalysis | undefined;
  /** Live-line -> stable typed-declaration BindingId bridge (Task 39), kept
   * in sync with CM edits by the caller the same way statementRanges is. */
  typedDeclarationRanges: () => TypedDeclarationRangeIndex;
  /** Tier B site resolution for `set` target/RHS completion (Task 40): live
   * body-range tracking per lexical scope, purely structural &&
   * independent of any specific `set` statement's own compiled identity -
   * see statementRangeIndex.ts's own doc comment for why this (not
   * BindingVersionGraph) is the source of truth here. */
  scopeBodyRanges: () => ScopeBodyRangeIndex;
  /** `doc.statementMap.byElementId`, used only to map an element at the
   * cursor to the compiled catalog's own statementIndex for a property
   * scalar value / template hole's BindingReferenceSite (Task 39) - never
   * for any other purpose already covered by statementRanges/computedGeometry. */
  statementInfoByElementId: () => ReadonlyMap<ElementId, StatementInfo> | undefined;
  /** `doc.statementMap.byKey`, used only to map a printLayout/place block at
   * the cursor to the compiled catalog's own statementIndex for a
   * printLayoutBlock numeric field's BindingReferenceSite (Task 53) -
   * mirrors statementInfoByElementId's role for element-scoped completion.
   * Optional so existing test-only DslAutocompleteOptions literals that never
   * exercise printLayoutBlock completion don't need updating. */
  statementInfoByKey?: () => ReadonlyMap<string, StatementInfo> | undefined;
  /** Whether the evaluation backing computedGeometry/effectiveEnabledElementIds/
   * evaluationErrors above is current for the live document right now (the
   * caller's own evaluationStateIsCurrentFor check - see
   * elementParameterCandidateState in elementParameterReferenceOptions.ts).
   * Rust evaluation is asynchronous, so those fields can be stale (or from a
   * still-in-flight request) even when they otherwise look populated;
   * `elementParameter` completion must report no candidates - never a
   * synchronous re-evaluation - while this is false. Defaults to true so
   * existing callers/tests that don't model evaluation freshness keep their
   * prior behavior. */
  evaluationIsCurrent?: () => boolean;
  /** Defaults to deriving everything from the CompletionContext's own editor state. */
  documentInput?: (context: CompletionContext) => DslAutocompleteDocumentInput | null;
  /** Last-good source-semantic module metadata. It is never consulted while
   * semanticMetadataFresh is false, so completion cannot leak stale names. */
  moduleSemanticMetadata?: () => CompiledDslDocument | undefined;
  /** Revision paired with module/binding source semantics for the host-neutral
   * query. Kept optional for focused editor tests that use revision 0. */
  semanticSourceRevision?: () => number;
  semanticMetadataFresh?: () => boolean;
  /** Maps a live cursor to a last-good module statement identity. Completion
   * may use stale semantic identities only through this proof-carrying map. */
  moduleCompletionStatementIndexAt?: (position: number) => number | null;
  /** Structural live-site proof for Module call completion. A returned site
   * may use an existing lexical scope && source-order anchor without inventing
   * a StatementIdentity for a newly typed call. */
  moduleCompletionSiteAt?: (position: number, purpose: "moduleCall" | "moduleBody") => ModuleCompletionSite | null;
};

/** A logical-projection pairing kept alongside the document input so the
 * completion's from/to can later be projected back through the exact same
 * source map/statement that produced lineText/localPos — never a freshly
 * rebuilt one, && never mixed with physical-line arithmetic. */
type LogicalProjection = { map: LogicalStatementSourceMap; statement: LogicalStatement };

/** Builds the default (non-overridden) document input for one completion call.
 * Prefers the cursor's enclosing statement's logical projection (so
 * continuation-line completion sees the whole statement, per W3); falls back
 * to the legacy single physical line as one unit — never a logical lineText
 * paired with physical localPos || vice versa — whenever the cursor's
 * statement can't be found || its position can't be projected into logical
 * text (comments, the continuation backslash, trimmed indentation). */
const defaultDocumentInput = (context: CompletionContext): { input: DslAutocompleteDocumentInput; projection: LogicalProjection | null } => {
  const line = context.state.doc.lineAt(context.pos);
  const source = context.state.doc.toString();
  const physicalInput: DslAutocompleteDocumentInput = {
    source,
    cursorLineNumber: line.number,
    lineText: line.text,
    localPos: context.pos - line.from,
    doc: context.state.doc,
    startsInBlockComment: scanDslSource(source).lines[line.number - 1]?.startsInBlockComment ?? false
  };
  const map = createLogicalStatementSourceMap({ normalizedSource: source, sourceRevision: 0 });
  const statement = map.statements.find((candidate) => context.pos >= candidate.range.from && context.pos <= candidate.range.to);
  if (!statement) return { input: physicalInput, projection: null };
  const localPos = physicalToLogicalOffset(map, statement, context.pos);
  if (localPos === null) return { input: physicalInput, projection: null };
  return {
    input: { ...physicalInput, lineText: statement.logicalText, localPos },
    projection: { map, statement }
  };
};

const statementElementIdsByLiveLine = (doc: Text, ranges: StatementRangeIndex) => {
  const result = new Map<number, ElementId>();
  for (const range of ranges.values()) {
    const fromLine = doc.lineAt(range.from).number;
    const toLine = doc.lineAt(range.to).number;
    for (let line = fromLine; line <= toLine; line += 1) result.set(line, range.elementId);
  }
  return result;
};

/** Task 39: maps the pure `ScalarCompletionCandidate` union to CM's
 * `Completion` shape - the one place that translates candidate `kind` into a
 * CM `type`/`apply` convention. A reference candidate's `apply` always
 * re-adds the "@" sigil: the completion span never includes it when nothing
 * has been typed yet (a clean operand-start), && does include it as part of
 * the replaced text when a partial "@name" is already in progress - "@" +
 * name is the correct insertion text either way. */
const asScalarCompletions = (candidates: readonly ScalarCompletionCandidate[]): Completion[] =>
  candidates.map((candidate) => {
    if (candidate.kind === "argumentName") {
      return { label: candidate.label, apply: `${candidate.label}: `, type: "keyword" };
    }
    if (candidate.kind === "reference") {
      return {
        label: candidate.name,
        apply: `@${candidate.name}`,
        type: "constant"
      };
    }
    if (candidate.kind === "operator") return { label: candidate.label, type: "keyword" };
    if (candidate.kind === "function") {
      const definition = getBuiltinFunctionDefinition(candidate.name);
      return {
        label: candidate.name,
        apply: `${candidate.name}(`,
        ...(definition ? { detail: formatBuiltinFunctionSignatures(definition) } : {}),
        type: "function"
      };
    }
    return { label: candidate.label, type: "enum" };
  });

/** Task 40: maps `SetTargetCandidate` to CM's `Completion` shape. Unlike
 * asScalarCompletions's reference branch, a `set` target is a bare
 * identifier - `apply` is the plain name, never `@`-prefixed. */
const asSetTargetCompletions = (candidates: readonly Pick<SetTargetCandidate, "name">[]): Completion[] =>
  candidates.map((candidate) => ({ label: candidate.name, apply: candidate.name, type: "constant" }));

/** Converts host-neutral Module candidates at the existing CodeMirror
 * boundary. Marker/colon/parenthesis insertion remains an editor concern. */
const asModuleCompletions = (candidates: readonly ModuleCompletionCandidate[], bareReferences = false): Completion[] =>
  candidates.map((candidate) => {
    if (candidate.kind === "binding" || candidate.kind === "geometry") {
      const label = bareReferences ? candidate.label : `@${candidate.label}`;
      return { label, ...(bareReferences ? {} : { apply: label }), type: "constant" };
    }
    if (candidate.kind === "argumentName") return { label: candidate.label, apply: `${candidate.label}: `, type: "property" };
    if (candidate.kind === "builtin") return { label: candidate.label, apply: `${candidate.label}(`, detail: candidate.detail, type: "function" };
    if (candidate.kind === "module") return { label: candidate.label, type: "class" };
    if (candidate.kind === "literal") return { label: candidate.label, detail: candidate.detail, type: candidate.label === '""' ? "text" : "constant" };
    return { label: candidate.label, type: "property" };
  });

const asQueryCompletions = (
  result: DslCompletionQueryResult,
  bareReferences = false,
  moduleBodyBindings = false,
  bareBindingTargets = false
): Completion[] =>
  result.candidates.map((candidate: DslCompletionCandidate): Completion => {
    if (candidate.kind === "binding") {
      if (bareBindingTargets) return { label: candidate.label, apply: candidate.label, type: "constant" };
      const markerBinding = !bareReferences && (
        moduleBodyBindings ||
        (result.context.kind === "parameter" && result.context.parameter.definition.kind === "number") ||
        result.context.kind === "moduleArgumentValue" ||
        result.context.kind === "moduleReference"
      );
      return bareReferences
        ? { label: candidate.label, type: "constant" }
        : markerBinding
          ? { label: `@${candidate.label}`, apply: `@${candidate.label}`, type: "constant" }
          : { label: candidate.label, apply: `@${candidate.label}`, type: "constant" };
    }
    if (candidate.kind === "geometry") {
      const label = bareReferences ? candidate.label : `@${candidate.label}`;
      return { label, ...(bareReferences ? {} : { apply: label }), type: "constant" };
    }
    if (candidate.kind === "argumentName") return { label: candidate.label, apply: `${candidate.label}: `, type: "property" };
    if (candidate.kind === "builtin") return { label: candidate.label, apply: `${candidate.label}(`, detail: candidate.detail, type: "function" };
    if (candidate.kind === "keyword") return { label: candidate.label, type: "keyword" };
    if (candidate.kind === "type" && candidate.label === dslChoiceTypeName) {
      return {
        label: candidate.label,
        type: "type",
        apply: (view, _completion, from, to) => view.dispatch({
          changes: { from, to, insert: "choice()" },
          selection: { anchor: from + "choice(".length }
        })
      };
    }
    if (candidate.kind === "type") return { label: candidate.label, type: "type" };
    if (candidate.kind === "construction") return { label: candidate.label, apply: candidate.label, detail: candidate.detail, type: "function" };
    if (candidate.kind === "property") return { label: candidate.label, type: "constant" };
    if (candidate.kind === "module") return { label: candidate.label, type: "class" };
    if (candidate.kind === "operator") return { label: candidate.label, type: "keyword" };
    return { label: candidate.label, type: "enum" };
  });

const declaredTypeCompletions = (allowGeometryArrays: boolean): Completion[] => dslTypedDeclarationTypeNames
  .filter((label) => allowGeometryArrays || !label.endsWith("[]"))
  .map((label) =>
  label === dslChoiceTypeName
    ? {
      label,
      type: "type",
      apply: (view, _completion, from, to) => view.dispatch({
        changes: { from, to, insert: "choice()" },
        selection: { anchor: from + "choice(".length }
      })
    }
    : { label, type: "type" }
);

const moduleParameterTypeCompletions = (): Completion[] => dslModuleParameterTypeNames.map((label) =>
  label === dslChoiceTypeName
    ? {
      label,
      type: "type" as const,
      apply: (view, _completion, from, to) => view.dispatch({
        changes: { from, to, insert: "choice()" },
        selection: { anchor: from + "choice(".length }
      })
    }
    : { label, type: "type" as const }
);

/** Resolves the BindingReferenceSite for the CadElement at the cursor's own
 * line (property scalar value / template hole contexts): looks the live
 * element up in the compiled document's own `statementMap.byElementId` to
 * get its catalog-space statementIndex, then reads that statement's scope
 * from the same precomputed `BindingCatalog` - mirrors
 * propertyBindingCompiler.ts's own site construction exactly, so `@name`
 * visibility here matches what Task 22 itself already resolves for this
 * exact property. Returns `null` whenever the live element/statement can't
 * be cross-referenced into the (possibly stale) compiled catalog. */
const elementBindingSite = (
  elementId: ElementId | undefined,
  statementInfoByElementId: ReadonlyMap<ElementId, StatementInfo> | undefined,
  bindingAnalysis: BindingAnalysis
) => {
  const statementIndex = elementId ? statementInfoByElementId?.get(elementId)?.statementIndex : undefined;
  if (statementIndex === undefined) return null;
  const scopeId = bindingAnalysis.catalog.scopeIndex.scopeOfStatement.get(statementIndex) ?? bindingAnalysis.catalog.scopeIndex.rootScopeId;
  return { scopeId, statementIndex };
};

/** Task 40: builds the position-based site setTargetCandidates/
 * setRhsScalarCandidates need, purely from the last successfully compiled
 * BindingCatalog's own scope index (via ScopeBodyRangeIndex) plus each
 * candidate binding's own live position (via TypedDeclarationRangeIndex) -
 * never BindingVersionGraph, && never gated on this specific `set`
 * statement's own compiled identity, so it resolves the same way for an
 * already-compiled `set` && a brand-new, never-yet-compiled one. */
const setCompletionSiteDeps = (
  options: DslAutocompleteOptions,
  bindingAnalysis: BindingAnalysis,
  cursorPosition: number
): SetCompletionSiteDeps => ({
  catalog: bindingAnalysis.catalog,
  entriesById: bindingAnalysis.entriesById,
  containingScopeId: deepestContainingScopeId(options.scopeBodyRanges(), cursorPosition, bindingAnalysis.catalog.scopeIndex.rootScopeId),
  livePositionOf: (bindingId) => options.typedDeclarationRanges().get(bindingId)?.from,
  cursorPosition
});

/**
 * Task 51 completion-only recovery: the last-good catalog remains the source
 * of normal candidates, while the current tolerant parse supplies poisoned
 * `let` declarations && any newly typed lexical scopes. The committed
 * candidate is mapped through its live declaration position before merging;
 * this lets one lexical winner be selected across stale && live metadata
 * without inventing a BindingId || changing runtime reference resolution.
 */
const mergedSetTargetCandidates = (
  options: DslAutocompleteOptions,
  input: DslAutocompleteDocumentInput,
  cursorPosition: number,
  bindingAnalysis: BindingAnalysis | undefined
) => {
  const recovery = recoverLiveSetTargetCandidates({ source: input.source, cursorPosition });
  const committed: SetTargetCompletionCandidate[] = [];
  if (bindingAnalysis) {
    const deps = setCompletionSiteDeps(options, bindingAnalysis, cursorPosition);
    for (const candidate of setTargetCandidates(deps)) {
      const livePosition = deps.livePositionOf(candidate.bindingId);
      if (livePosition === undefined) continue;
      const location = recovery.declarationLocationAtPosition(livePosition);
      if (!location || location.name !== candidate.name) continue;
      committed.push({
        name: candidate.name,
        type: candidate.type,
        declarationPosition: location.declarationPosition,
        scopeKey: location.scopeKey,
        source: "committed"
      });
    }
  }
  return mergeSetTargetCandidates(committed, recovery);
};

/**
 * Completes a newly inserted declaration/element before it has a compiled
 * owner identity. Candidate bindings must have both catalog identities &&
 * mapped live declaration offsets, so this preserves the normal fail-closed
 * freshness contract without importing CodeMirror types into scalar logic.
 */
const liveTypedBindingsAtCompletionCursor = (
  options: DslAutocompleteOptions,
  bindingAnalysis: BindingAnalysis,
  cursorPosition: number
) => visibleTypedBindingsAtLivePosition({
  catalog: bindingAnalysis.catalog,
  containingScopeId: deepestContainingScopeId(
    options.scopeBodyRanges(),
    cursorPosition,
    bindingAnalysis.catalog.scopeIndex.rootScopeId
  ),
  cursorOffset: cursorPosition,
  offsetForBinding: (bindingId) => options.typedDeclarationRanges().get(bindingId)?.from
}, () => true);

type TypedReferenceCompletionContext = Extract<DslCompletionContext, {
  kind: "typedInitializer" | "conditionExpression" | "propertyScalarValue" | "templateHole";
}>;

const moduleSiteAt = (
  options: DslAutocompleteOptions,
  position: number,
  purpose: "moduleCall" | "moduleBody"
): ModuleCompletionSite | null => {
  if (options.moduleCompletionSiteAt) return options.moduleCompletionSiteAt(position, purpose);
  const statementIndex = options.moduleCompletionStatementIndexAt?.(position) ?? null;
  return statementIndex === null ? null : { statementIndex, sourceOrderIndex: statementIndex };
};

const moduleMetadataAt = (
  options: DslAutocompleteOptions,
  position: number,
  purpose: "moduleCall" | "moduleBody"
) => {
  const compiled = options.moduleSemanticMetadata?.();
  const site = moduleSiteAt(options, position, purpose);
  const fresh = options.semanticMetadataFresh?.() !== false;
  return compiled && (fresh || site) ? { compiled, site, fresh } : null;
};

const isModuleBodySite = (compiled: CompiledDslDocument, site: ModuleCompletionSite | null) => {
  if (!site) return false;
  const id = compiled.statementMap?.statementIdByStatementIndex?.get(site.statementIndex);
  if (id && compiled.moduleSemanticAnalysis?.definitions.some((definition) => definition.bodyStatementIds.includes(id))) return true;
  const namespace = compiled.sourceLexicalNamespace;
  return Boolean(namespace && site.scopeId && compiled.moduleSemanticAnalysis?.definitions.some((definition) =>
    isScopeWithin(namespace, site.scopeId!, definition.bodyScopeId)
  ));
};

const moduleScalarCompletions = (
  options: DslAutocompleteOptions,
  input: DslAutocompleteDocumentInput,
  context: CompletionContext,
  expectedScalarType: ScalarType | null,
  purpose: "moduleCall" | "moduleBody" = "moduleBody"
) => {
  const metadata = moduleMetadataAt(options, context.pos, purpose);
  if (!metadata) return { candidates: [] as Completion[], body: false };
  return {
    candidates: asModuleCompletions(moduleCompletionCandidates({
      compiled: metadata.compiled,
      cursorPosition: context.pos,
      kind: "reference",
      sourceText: input.source,
      logicalCursorPosition: input.localPos,
      liveStatementText: input.lineText,
      expectedScalarType,
      ...(metadata.site ? {
        statementIndex: metadata.site.statementIndex,
        scopeId: metadata.site.scopeId,
        sourceOrderIndex: metadata.site.sourceOrderIndex
      } : {})
    })),
    body: isModuleBodySite(metadata.compiled, metadata.site) || (metadata.site === null && isInsideModuleSemanticStatement(metadata.compiled, context.pos))
  };
};

const completionKey = (completion: Completion) => `${completion.label}\u0000${typeof completion.apply === "string" ? completion.apply : ""}`;

const mergeCompletionCandidates = (...lists: readonly Completion[][]): Completion[] => {
  const seen = new Set<string>();
  return lists.flat().filter((candidate) => {
    const key = completionKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeModuleScalarCompletions = (candidates: readonly Completion[]): Completion[] => candidates.map((candidate) =>
  typeof candidate.apply === "string" && candidate.apply.startsWith("@") && candidate.label.startsWith("@")
    ? { ...candidate, label: candidate.label.slice(1) }
    : candidate
);

const scalarCandidatesWithoutReferences = (candidates: readonly ScalarCompletionCandidate[]) =>
  candidates.filter((candidate) => candidate.kind !== "reference");

/** Keeps source lookup && composition-end eligibility on the identical
 * freshness/type-filtered candidate calculation. This stays in the editor:
 * scalar helpers receive only catalog, scope, && offset data. */
const typedReferenceCompletions = (
  options: DslAutocompleteOptions,
  input: DslAutocompleteDocumentInput,
  context: CompletionContext,
  completionContext: TypedReferenceCompletionContext
): Completion[] => {
  if (completionContext.kind === "typedInitializer") {
    const bindingAnalysis = options.bindingAnalysis();
    const bindingId = bindingAnalysis ? typedDeclarationBindingIdAtCursor(options.typedDeclarationRanges(), context.pos) : null;
    const binding = bindingAnalysis && bindingId ? bindingAnalysis.catalog.bindingsById.get(bindingId) : undefined;
    const scalarCandidates = bindingAnalysis && bindingId && !binding
      ? []
      : bindingAnalysis && binding
      ? scalarExpressionCandidates(completionContext.positionContext, {
        catalog: bindingAnalysis.catalog,
        entriesById: bindingAnalysis.entriesById,
        site: { scopeId: binding.effectiveScopeId, statementIndex: binding.statementIndex },
        includeOperators: true
      })
      : bindingAnalysis
        ? scalarExpressionCandidates(completionContext.positionContext, {
          catalog: bindingAnalysis.catalog,
          entriesById: bindingAnalysis.entriesById,
          liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos),
          includeOperators: true
        })
      : [];
    const module = moduleScalarCompletions(options, input, context, completionContext.declaredType);
    const existing = module.body ? scalarCandidatesWithoutReferences(scalarCandidates) : scalarCandidates;
    return mergeCompletionCandidates(asScalarCompletions(existing), normalizeModuleScalarCompletions(module.candidates));
  }

  const bindingAnalysis = options.bindingAnalysis();
  const elementId = statementElementIdsByLiveLine(input.doc, options.statementRanges()).get(input.cursorLineNumber);
  const site = bindingAnalysis ? elementBindingSite(elementId, options.statementInfoByElementId(), bindingAnalysis) : null;
  const scalarExpressionCandidatesFor = (positionContext: ScalarExpressionCompletionContext): readonly ScalarCompletionCandidate[] => {
    if (bindingAnalysis) {
      return scalarExpressionCandidates(positionContext, {
        catalog: bindingAnalysis.catalog,
        entriesById: bindingAnalysis.entriesById,
        ...(site ? { site } : { liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos) }),
        includeOperators: true
      });
    }
    if (positionContext.kind !== "operand" || !positionContext.expectedType) return [];
    return [
      ...scalarFunctionCandidates(positionContext.expectedType),
      ...scalarLiteralCandidates(positionContext.expectedType).map((candidate): ScalarCompletionCandidate => ({ kind: "literal", label: candidate.label })),
      ...(!positionContext.literalOnly
        ? scalarPrefixOperatorCandidates(positionContext.expectedType).map((candidate): ScalarCompletionCandidate => ({ kind: "operator", label: candidate.label }))
        : [])
    ];
  };
  if (completionContext.kind === "conditionExpression") {
    const scalarCandidates = scalarExpressionCandidatesFor(completionContext.positionContext);
    const expectedType = completionContext.positionContext.kind === "operand"
      ? completionContext.positionContext.expectedType
      : completionContext.positionContext.kind === "operator"
        ? completionContext.positionContext.rootType
        : null;
    const module = moduleScalarCompletions(options, input, context, expectedType);
    const existing = module.body ? scalarCandidatesWithoutReferences(scalarCandidates) : scalarCandidates;
    return mergeCompletionCandidates(asScalarCompletions(existing), normalizeModuleScalarCompletions(module.candidates));
  }
  if (completionContext.kind === "propertyScalarValue") {
    const propertyContext = completionContext.propertyContext;
    if (propertyContext.kind === "expression") {
      const scalarCandidates = scalarExpressionCandidatesFor(propertyContext.positionContext);
      const expectedType = propertyContext.positionContext.kind === "operand"
        ? propertyContext.positionContext.expectedType
        : propertyContext.positionContext.kind === "operator"
          ? propertyContext.positionContext.rootType
          : null;
      const module = moduleScalarCompletions(options, input, context, expectedType);
      const existing = module.body ? scalarCandidatesWithoutReferences(scalarCandidates) : scalarCandidates;
      return mergeCompletionCandidates(asScalarCompletions(existing), normalizeModuleScalarCompletions(module.candidates));
    }
    if (propertyContext.kind === "booleanLiteral") {
      const module = moduleScalarCompletions(options, input, context, { kind: "boolean" });
      return mergeCompletionCandidates(
        asScalarCompletions(scalarFunctionCandidates({ kind: "boolean" })),
        scalarLiteralCandidates({ kind: "boolean" }).map((candidate) => ({ label: candidate.label, type: "enum" })),
        normalizeModuleScalarCompletions(module.candidates)
      );
    }
    const expectedType = propertyContext.expectedType;
    const scalarCandidates = bindingAnalysis
      ? typedBindingReferenceCandidates({
        catalog: bindingAnalysis.catalog,
        entriesById: bindingAnalysis.entriesById,
        ...(site ? { site } : { liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos) }),
        accepts: (type) => type !== null && isScalarTypeAssignable(type, expectedType)
      }).map((candidate): ScalarCompletionCandidate => ({ kind: "reference", name: candidate.name, bindingId: candidate.bindingId }))
      : [];
    const module = moduleScalarCompletions(options, input, context, expectedType);
    const existing = module.body ? scalarCandidatesWithoutReferences(scalarCandidates) : scalarCandidates;
    return mergeCompletionCandidates(asScalarCompletions(existing), normalizeModuleScalarCompletions(module.candidates));
  }

  const scalarCandidates = bindingAnalysis
    ? templateHoleScalarCandidates(input.lineText, completionContext.contentSpan, input.localPos, {
      catalog: bindingAnalysis.catalog,
      entriesById: bindingAnalysis.entriesById,
      ...(site ? { site } : { liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos) }),
      includeOperators: true
    })
    : [];
  const moduleString = moduleScalarCompletions(options, input, context, { kind: "string" });
  const moduleNumber = moduleScalarCompletions(options, input, context, { kind: "number" });
  const moduleBody = moduleString.body || moduleNumber.body;
  const existing = moduleBody ? scalarCandidatesWithoutReferences(scalarCandidates) : scalarCandidates;
  return mergeCompletionCandidates(
    asScalarCompletions(existing),
    normalizeModuleScalarCompletions(moduleString.candidates),
    normalizeModuleScalarCompletions(moduleNumber.candidates)
  );
};

/**
 * Task 51: typed `const`/`let` number-kind bindings, offered as `@name`
 * candidates alongside the legacy top-level/local `@variable` candidates in
 * a plain numeric attribute (`x:`, `,length:`, `dx:`, ...) - the same
 * position `numericBindingCompiler.ts` already resolves a compiled
 * `@typedBindingName` occurrence against at evaluation time, but which had
 * no completion source of its own before this. Reuses the exact site/
 * live-visibility resolution `typedReferenceCompletions` above already
 * established for propertyScalarValue/templateHole, so scope visibility
 * agrees with those contexts && with the compiler.
 *
 * Unlike asScalarCompletions's own bare-name label (paired with
 * `disablesCompletionFiltering`/`filter: false` at every other typed-
 * reference call site), the label here is `@`-prefixed to match
 * asVariableCompletions's legacy candidates exactly - the two lists are
 * merged into one array in the "number"-kind branch below && must share
 * one label convention so CM's own `validFor`-based filtering (not
 * `filter: false`) narrows both consistently as the query lengthens.
 */
const typedNumberBindingCompletions = (
  options: DslAutocompleteOptions,
  input: DslAutocompleteDocumentInput,
  context: CompletionContext
): Completion[] => {
  const bindingAnalysis = options.bindingAnalysis();
  if (!bindingAnalysis) return [];
  const elementId = statementElementIdsByLiveLine(input.doc, options.statementRanges()).get(input.cursorLineNumber);
  const site = elementBindingSite(elementId, options.statementInfoByElementId(), bindingAnalysis);
  return typedBindingReferenceCandidates({
    catalog: bindingAnalysis.catalog,
    entriesById: bindingAnalysis.entriesById,
    ...(site ? { site } : { liveVisibleBindings: liveTypedBindingsAtCompletionCursor(options, bindingAnalysis, context.pos) }),
    accepts: (type) => type?.kind === "number"
  }).map((candidate): Completion => ({ label: `@${candidate.name}`, apply: `@${candidate.name}`, type: "constant" }));
};

/** CodeMirror's stock filtering compares the raw `@name` token to labels
 * such as `name`, so it removes every option at the bare `@` trigger. Keep
 * filtering off for that token, but retain a narrow, case-insensitive prefix
 * match once the author has started the name. */
const filteredTypedReferenceCompletions = (
  completions: readonly Completion[],
  input: DslAutocompleteDocumentInput,
  completionContext: TypedReferenceCompletionContext
): Completion[] => {
  const token = input.lineText.slice(completionContext.from, completionContext.to);
  if (!token.startsWith("@")) return [...completions];
  const query = token.slice(1).toLocaleLowerCase();
  return query.length === 0
    ? [...completions]
    : completions.filter((completion) => completion.label.toLocaleLowerCase().startsWith(query));
};

const typedReferenceToken = (input: DslAutocompleteDocumentInput, completionContext: DslCompletionContext): string | null =>
  completionContext && (
    completionContext.kind === "typedInitializer" ||
    completionContext.kind === "conditionExpression" ||
    completionContext.kind === "propertyScalarValue" ||
    completionContext.kind === "templateHole" ||
    completionContext.kind === "geometryArrayValue"
  )
    ? input.lineText.slice(completionContext.from, completionContext.to)
    : null;

/**
 * Task 51: the `@`-marker implicit-trigger token for *any* reference-shaped
 * completion context, including a *sigilled* `elementParameter` - which
 * typedReferenceToken above cannot cover, since its span excludes the
 * `Element.` prefix (and any leading `@`) by design (asElementParameterCompletions
 * only ever applies the member token). Reads `tokenStart` (the whole token's
 * start, sigil included) instead, so `@AB.` implicitly triggers exactly like
 * `@name` does.
 */
const referenceMarkerToken = (input: DslAutocompleteDocumentInput, completionContext: DslCompletionContext): string | null => {
  if (completionContext?.kind === "elementParameter") {
    return completionContext.sigil ? input.lineText.slice(completionContext.tokenStart, completionContext.to) : null;
  }
  if (completionContext?.kind === "setRhs" && completionContext.geometryProperty) {
    return input.lineText.slice(completionContext.geometryProperty.tokenStart, completionContext.to);
  }
  return typedReferenceToken(input, completionContext);
};

const completionDocumentInput = (options: DslAutocompleteOptions, context: CompletionContext) => {
  if (!options.documentInput) return defaultDocumentInput(context);
  const input = options.documentInput(context);
  if (!input) return { input: null, projection: null };
  return {
    input: {
      ...input,
      startsInBlockComment: input.startsInBlockComment ??
        (scanDslSource(input.source).lines[input.cursorLineNumber - 1]?.startsInBlockComment ?? false)
    },
    projection: null
  };
};

const completionContextForInput = (input: DslAutocompleteDocumentInput) =>
  dslCompletionContextAt(input.lineText, input.localPos, input.startsInBlockComment);

const semanticSnapshotForQuery = (
  options: DslAutocompleteOptions
): { sourceRevision: number; semantic?: DslCompletionSemanticSnapshot } => {
  const compiled = options.moduleSemanticMetadata?.();
  const sourceRevision = options.semanticSourceRevision?.() ?? compiled?.spans.sourceMap.sourceRevision ?? 0;
  const bindingAnalysis = options.bindingAnalysis();
  const semantic = compiled || bindingAnalysis
    ? {
        sourceRevision,
        ...(compiled ? { compiled } : {}),
        ...(bindingAnalysis ? { bindingAnalysis } : {})
      } satisfies DslCompletionSemanticSnapshot
    : undefined;
  return { sourceRevision, semantic };
};

const semanticSnapshotMatchesInput = (
  input: DslAutocompleteDocumentInput,
  snapshot: ReturnType<typeof semanticSnapshotForQuery>
) => Boolean(
  snapshot.semantic &&
  snapshot.semantic.sourceRevision === snapshot.sourceRevision &&
  (snapshot.semantic.sourceText ?? snapshot.semantic.compiled?.spans.sourceMap.source) === input.source
);

const isTypedReferenceRetryContext = (options: DslAutocompleteOptions, view: Parameters<Command>[0]) => {
  const context = new CompletionContext(view.state, view.state.selection.main.head, false, view);
  const { input } = completionDocumentInput(options, context);
  if (!input) return false;
  const completionContext = completionContextForInput(input);
  if (!completionContext || (
    completionContext.kind !== "typedInitializer" &&
    completionContext.kind !== "conditionExpression" &&
    completionContext.kind !== "propertyScalarValue" &&
    completionContext.kind !== "templateHole"
  )) return false;
  if (!typedReferenceToken(input, completionContext)?.startsWith("@")) return false;
  return filteredTypedReferenceCompletions(
    typedReferenceCompletions(options, input, context, completionContext),
    input,
    completionContext
  ).length > 0;
};

/**
 * Whether the cursor is currently at an `ElementName.` position whose
 * candidates (computed from the *current* evaluation the caller already
 * confirmed is fresh) are non-empty. Used only by cmEvaluationFreshnessRetry
 * right after evaluation transitions from not-current to current, to decide
 * whether re-querying completion would actually surface something - never
 * called while evaluation is still not current (that decision belongs to
 * the caller, exactly like isTypedReferenceRetryContext above never
 * re-derives IME composition state itself).
 */
export const isElementParameterRetryContext = (options: DslAutocompleteOptions, view: Parameters<Command>[0]) => {
  const context = new CompletionContext(view.state, view.state.selection.main.head, false, view);
  const { input } = completionDocumentInput(options, context);
  if (!input) return false;
  const completionContext = completionContextForInput(input);
  if (!completionContext) return false;
  const elementToken = completionContext.kind === "elementParameter"
    ? completionContext.elementToken
    : completionContext.kind === "setRhs" && completionContext.geometryProperty
      ? (() => {
          const bindingAnalysis = options.bindingAnalysis();
          const target = mergedSetTargetCandidates(options, input, context.pos, bindingAnalysis)
            .find((candidate) => candidate.name === completionContext.targetName);
          return target?.type.kind === "number" ? completionContext.geometryProperty.elementToken : null;
        })()
      : null;
  if (!elementToken?.trim()) return false;
  return elementPropertyCompletions({
    source: input.source,
    cursorLine: input.cursorLineNumber,
    statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
    elements: options.elements(),
    elementToken,
    computedGeometry: options.computedGeometry() ?? new Map(),
    effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
    errors: options.evaluationErrors() ?? [],
    evaluationIsCurrent: true
  }).length > 0;
};

/**
 * Task 51 rerun: whether the production completion source itself would
 * offer at least one candidate, non-explicitly, at `pos` right now. Used by
 * cmDeleteCompletionRetry.ts to decide whether a delete-shaped transaction
 * that left completion inactive is worth re-querying for - deliberately
 * context-kind-agnostic (setTarget, choice, typed binding, element
 * property, template hole all resolve through this exact same
 * createDslCompletionSource call), unlike isTypedReferenceRetryContext/
 * isElementParameterRetryContext above, which each narrow to one specific
 * kind for their own, more targeted retry mechanisms. The completion source
 * itself never actually returns a Promise (no async work happens inside
 * it), so this stays a thin async wrapper only to keep the call uniform for
 * its one caller.
 */
export const hasImplicitCompletionCandidatesAt = async (
  options: DslAutocompleteOptions,
  view: EditorView,
  pos: number
): Promise<boolean> => {
  const context = new CompletionContext(view.state, pos, false, view);
  const result = await createDslCompletionSource(options)(context);
  return result !== null && result.options.length > 0;
};

export const createDslCompletionSource = (options: DslAutocompleteOptions): CompletionSource => (context) => {
  if (options.isComposing() || context.view?.compositionStarted) return null;
  const { input, projection } = completionDocumentInput(options, context);
  if (!input) return null;
  const completionContext = completionContextForInput(input);
  if (!completionContext) return null;
  const referenceToken = referenceMarkerToken(input, completionContext);
  // Ordinary typing at an empty typed expression (or, since Task 51, an
  // empty numeric-attribute reference token) must stay quiet. Explicit
  // completion still exposes literal/operator candidates there, while the
  // reference marker is the sole implicit trigger for both typed binding &&
  // element-property options - uniformly now, since both share one sigil.
  if (!context.explicit && referenceToken !== null && !referenceToken.startsWith("@")) return null;

  const semanticInput = semanticSnapshotForQuery(options);
  const neutralQuery = queryDslCompletion({
    source: { normalizedSource: input.source, sourceRevision: semanticInput.sourceRevision },
    position: context.pos,
    semantic: semanticInput.semantic
  });
  const moduleBodyQuery = Boolean(
    neutralQuery &&
    semanticInput.semantic &&
    Boolean(semanticInput.semantic.compiled && isInsideModuleSemanticStatement(semanticInput.semantic.compiled, context.pos))
  );
  const neutralCompletions = neutralQuery
    ? asQueryCompletions(
      neutralQuery,
      completionContext.kind === "moduleQualifiedMember",
      moduleBodyQuery && neutralQuery.context.kind === "parameter" && neutralQuery.context.parameter.definition.kind === "number",
      completionContext.kind === "setTarget"
    )
    : [];
  const neutralHasSourceCandidates = Boolean(neutralQuery?.candidates.some((candidate) =>
    candidate.kind === "binding" || candidate.kind === "geometry" || candidate.kind === "module" || candidate.kind === "property"
  ));
  const neutralSemanticIsCurrent = semanticSnapshotMatchesInput(input, semanticInput);
  let usesNeutralQuery = false;

  let completions: Completion[];
  let preservesSharedReferenceRanking = false;
  let disablesCompletionFiltering = false;
  if (completionContext.kind === "keyword") {
    completions = neutralQuery ? neutralCompletions : completionContext.options.map((label) => ({ label, type: "keyword" }));
    usesNeutralQuery = neutralQuery !== null;
  } else if (completionContext.kind === "construction") {
    completions = neutralQuery
      ? neutralCompletions
      : constructionCompletionCandidates(completionContext.category).map((candidate) => ({ ...candidate, type: "function" }));
    usesNeutralQuery = neutralQuery !== null;
  } else if (completionContext.kind === "argument") {
    const moduleMetadata = options.semanticMetadataFresh?.() === false ? undefined : options.moduleSemanticMetadata?.();
    const moduleCandidates = moduleMetadata
      ? asModuleCompletions(moduleCompletionCandidates({ compiled: moduleMetadata, cursorPosition: context.pos, kind: "reference" }))
      : [];
    completions = neutralQuery
      ? neutralCompletions
      : moduleCandidates.length > 0
        ? moduleCandidates
        : argumentCompletionCandidates(completionContext.spec, completionContext.usedArgumentNames)
          .map((candidate) => ({ ...candidate, type: "property" }));
    usesNeutralQuery = neutralQuery !== null;
  } else if (
    completionContext.kind === "moduleCallee" ||
    completionContext.kind === "moduleArgumentLabel" ||
    completionContext.kind === "moduleArgumentValue" ||
    completionContext.kind === "moduleQualifiedMember" ||
    completionContext.kind === "moduleReference"
  ) {
    const availableMetadata = options.moduleSemanticMetadata?.();
    const site = moduleSiteAt(options, context.pos, "moduleCall");
    const metadata = availableMetadata && (options.semanticMetadataFresh?.() !== false || site !== null)
      ? availableMetadata
      : undefined;
    const kind = completionContext.kind === "moduleCallee"
      ? "callee"
      : completionContext.kind === "moduleArgumentLabel"
        ? "label"
        : completionContext.kind === "moduleArgumentValue"
          ? "value"
          : completionContext.kind === "moduleQualifiedMember"
            ? "qualifiedMember"
            : "reference";
    completions = neutralQuery && neutralCompletions.length > 0 && (neutralSemanticIsCurrent || neutralHasSourceCandidates)
      ? neutralCompletions
      : metadata
        ? asModuleCompletions(moduleCompletionCandidates({ compiled: metadata, cursorPosition: context.pos, kind,
        sourceText: input.source,
        logicalCursorPosition: input.localPos,
        liveStatementText: input.lineText,
        ...(site ? {
          statementIndex: site.statementIndex,
          scopeId: site.scopeId,
          sourceOrderIndex: site.sourceOrderIndex
        } : {}),
        ...(completionContext.kind === "moduleArgumentLabel" || completionContext.kind === "moduleArgumentValue" || completionContext.kind === "moduleQualifiedMember"
          ? { argumentIndex: completionContext.argumentIndex } : {}),
        ...(completionContext.kind === "moduleArgumentValue"
          ? { argumentValueSpan: { start: completionContext.from, end: completionContext.to } } : {}),
        ...(completionContext.kind === "moduleQualifiedMember" && completionContext.expectedScalarType
          ? { expectedScalarType: completionContext.expectedScalarType } : {}),
        ...(completionContext.kind === "moduleQualifiedMember"
          ? { qualifiedInstanceName: completionContext.qualifiedInstanceName } : {}) }), completionContext.kind === "moduleQualifiedMember")
        : [];
    usesNeutralQuery = neutralQuery !== null && neutralCompletions.length > 0 && (neutralSemanticIsCurrent || neutralHasSourceCandidates);
    if (completions.length === 0 && completionContext.kind === "moduleReference" && !availableMetadata) {
      const query = input.lineText.slice(completionContext.from, input.localPos);
      completions = dslReferenceCompletionOptions({
        source: input.source, cursorLine: input.cursorLineNumber, kind: "reference", parameterKey: "reference", query,
        replacementFrom: completionContext.from, statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
        elements: options.elements(), computedGeometry: options.computedGeometry(), forGroupGeneratedRows: options.forGroupGeneratedRows?.(),
        effectiveEnabledElementIds: options.effectiveEnabledElementIds(), errors: options.evaluationErrors()
      }).map((option) => ({ label: option.displayLabel, apply: option.sourceToken, type: "constant" }));
    }
    disablesCompletionFiltering = true;
  } else if (completionContext.kind === "moduleParameterType") {
    completions = neutralQuery ? neutralCompletions : moduleParameterTypeCompletions();
    usesNeutralQuery = neutralQuery !== null;
  } else if (completionContext.kind === "declaredType") {
    completions = neutralQuery ? neutralCompletions : declaredTypeCompletions(completionContext.bindingKind === "const");
    usesNeutralQuery = neutralQuery !== null;
  } else if (completionContext.kind === "numericTypeOption") {
    completions = neutralQuery ? neutralCompletions : completionContext.options.map((label, index) => ({
      label,
      apply: `${label}: `,
      type: "property",
      sortText: String(index).padStart(4, "0")
    }));
    usesNeutralQuery = neutralQuery !== null;
  } else if (completionContext.kind === "elementParameter") {
    // Rust evaluation is asynchronous (useEvaluationEngine.ts): while it
    // hasn't caught up with the live document, computedGeometry/
    // effectiveEnabledElementIds can be stale || still in flight. Report no
    // candidates rather than guessing from stale data || re-evaluating
    // synchronously here - see elementParameterCandidateState. The
    // cmEvaluationFreshnessRetry extension re-queries once evaluation
    // becomes current, without requiring another keystroke.
    completions = elementPropertyCompletions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
      elements: options.elements(),
      elementToken: completionContext.elementToken,
      computedGeometry: options.computedGeometry() ?? new Map(),
      effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
      errors: options.evaluationErrors() ?? [],
      evaluationIsCurrent: options.evaluationIsCurrent?.() ?? true
    });
  } else if (completionContext.kind === "geometryArrayValue") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    if (neutralQuery && neutralCompletions.length > 0 &&
      (!semanticInput.semantic || neutralSemanticIsCurrent || neutralHasSourceCandidates)) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
      const metadata = options.moduleSemanticMetadata?.();
      const site = moduleSiteAt(options, context.pos, "moduleBody");
      completions = metadata
        ? asModuleCompletions(moduleCompletionCandidates({
            compiled: metadata,
            cursorPosition: context.pos,
            kind: "reference",
            sourceText: input.source,
            logicalCursorPosition: input.localPos,
            liveStatementText: input.lineText,
            ...(site ? {
              statementIndex: site.statementIndex,
              scopeId: site.scopeId,
              sourceOrderIndex: site.sourceOrderIndex
            } : {})
          }))
        : [];
    }
  } else if (completionContext.kind === "typedInitializer" || completionContext.kind === "conditionExpression") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    if (neutralQuery && neutralCompletions.length > 0 &&
      (!semanticInput.semantic || neutralSemanticIsCurrent || neutralHasSourceCandidates)) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
      completions = filteredTypedReferenceCompletions(
        typedReferenceCompletions(options, input, context, completionContext), input, completionContext
      );
    }
  } else if (completionContext.kind === "propertyScalarValue") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    if (neutralQuery && neutralCompletions.length > 0 &&
      (!semanticInput.semantic || neutralSemanticIsCurrent || neutralHasSourceCandidates)) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
      completions = filteredTypedReferenceCompletions(
        typedReferenceCompletions(options, input, context, completionContext), input, completionContext
      );
    }
  } else if (completionContext.kind === "templateHole") {
    disablesCompletionFiltering = referenceToken?.startsWith("@") ?? false;
    if (neutralQuery && neutralCompletions.length > 0 &&
      (!semanticInput.semantic || neutralSemanticIsCurrent || neutralHasSourceCandidates)) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
      completions = filteredTypedReferenceCompletions(
        typedReferenceCompletions(options, input, context, completionContext), input, completionContext
      );
    }
  } else if (completionContext.kind === "setTarget") {
    const bindingAnalysis = options.bindingAnalysis();
    if (neutralQuery && neutralCompletions.length > 0 && neutralSemanticIsCurrent) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
      completions = asSetTargetCompletions(mergedSetTargetCandidates(options, input, context.pos, bindingAnalysis));
    }
  } else if (completionContext.kind === "setRhs") {
    const bindingAnalysis = options.bindingAnalysis();
    const deps = bindingAnalysis ? setCompletionSiteDeps(options, bindingAnalysis, context.pos) : null;
    const target = mergedSetTargetCandidates(options, input, context.pos, bindingAnalysis)
      .find((candidate) => candidate.name === completionContext.targetName);
    if (neutralQuery && neutralCompletions.length > 0 && neutralSemanticIsCurrent) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
      completions = completionContext.geometryProperty
        ? target?.type.kind === "number"
          ? elementPropertyCompletions({
          source: input.source,
          cursorLine: input.cursorLineNumber,
          statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
          elements: options.elements(),
          elementToken: completionContext.geometryProperty.elementToken,
          computedGeometry: options.computedGeometry() ?? new Map(),
          effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
          errors: options.evaluationErrors() ?? [],
          evaluationIsCurrent: options.evaluationIsCurrent?.() ?? true
          })
          : []
        : (() => {
          const existingCandidates = deps && target
            ? setRhsScalarCandidates(input.lineText, completionContext.expressionSpan, input.localPos, target.type, deps)
            : [];
          const module = moduleScalarCompletions(options, input, context, target?.type ?? null);
          const existing = module.body ? scalarCandidatesWithoutReferences(existingCandidates) : existingCandidates;
          return mergeCompletionCandidates(asScalarCompletions(existing), normalizeModuleScalarCompletions(module.candidates));
        })();
    }
  } else if (completionContext.parameter.definition.kind === "choice") {
    // `sortText` only breaks ties among equally-scored matches (CodeMirror's
    // default compareCompletions falls back to alphabetical-by-label
    // otherwise, e.g. "left" before "right"), so declared order wins
    // whenever nothing has been typed yet without disturbing real
    // fuzzy-match ranking once the user starts narrowing.
    completions = (completionContext.parameter.definition.choiceOptions ?? []).map((label, index) => ({
      label,
      type: "enum",
      sortText: String(index).padStart(4, "0")
    }));
  } else if (completionContext.parameter.key === dslIntermediatesAttributeParameterKey) {
    // Intermediates use the shared typed numeric source; do not offer
    // element-specific completion candidates here.
    completions = [];
  } else if (completionContext.parameter.definition.kind === "number") {
    if (neutralQuery && neutralCompletions.length > 0 &&
      (!semanticInput.semantic || neutralSemanticIsCurrent || neutralHasSourceCandidates)) {
      completions = neutralCompletions;
      usesNeutralQuery = true;
    } else {
    const availableMetadata = options.moduleSemanticMetadata?.();
    const site = moduleSiteAt(options, context.pos, "moduleBody");
    const moduleMetadata = availableMetadata && (options.semanticMetadataFresh?.() !== false || site !== null)
      ? availableMetadata
      : undefined;
    const moduleCandidates = moduleMetadata
      ? asModuleCompletions(moduleCompletionCandidates({
        compiled: moduleMetadata,
        cursorPosition: context.pos,
        kind: "reference",
        sourceText: input.source,
        logicalCursorPosition: input.localPos,
        liveStatementText: input.lineText,
        expectedScalarType: { kind: "number" },
        ...(site ? {
          statementIndex: site.statementIndex,
          scopeId: site.scopeId,
          sourceOrderIndex: site.sourceOrderIndex
        } : {})
      }))
      : [];
    const moduleBodySite = Boolean(availableMetadata && ((site && isModuleBodySite(availableMetadata, site)) || isInsideModuleSemanticStatement(availableMetadata, context.pos)));
    const staleModuleBody = availableMetadata && options.semanticMetadataFresh?.() === false &&
      (moduleBodySite || isInsideModuleSemanticStatement(availableMetadata, context.pos));
    completions = moduleBodySite
      ? moduleCandidates
      : moduleCandidates.length > 0 ? moduleCandidates : staleModuleBody ? [] : typedNumberBindingCompletions(options, input, context);
    }
  } else {
    const query = input.lineText.slice(completionContext.from, input.localPos).replace(/^@/, "");
    if (!query.trim()) return null;
    preservesSharedReferenceRanking = true;
    const availableMetadata = options.moduleSemanticMetadata?.();
    const site = moduleSiteAt(options, context.pos, "moduleBody");
    const moduleMetadata = availableMetadata && (options.semanticMetadataFresh?.() !== false || site !== null)
      ? availableMetadata
      : undefined;
    const moduleCandidates = moduleMetadata
      ? asModuleCompletions(moduleCompletionCandidates({
        compiled: moduleMetadata,
        cursorPosition: context.pos,
        kind: "reference",
        sourceText: input.source,
        logicalCursorPosition: input.localPos,
        liveStatementText: input.lineText,
        ...(site ? {
          statementIndex: site.statementIndex,
          scopeId: site.scopeId,
          sourceOrderIndex: site.sourceOrderIndex
        } : {})
      }))
      : [];
    const moduleBodySite = Boolean(availableMetadata && ((site && isModuleBodySite(availableMetadata, site)) || isInsideModuleSemanticStatement(availableMetadata, context.pos)));
    const staleModuleBody = moduleMetadata === undefined && availableMetadata && options.semanticMetadataFresh?.() === false &&
      (moduleBodySite || isInsideModuleSemanticStatement(availableMetadata, context.pos));
    completions = moduleBodySite
      ? moduleCandidates
      : moduleCandidates.length > 0
      ? moduleCandidates
      : staleModuleBody ? [] : dslReferenceCompletionOptions({
      source: input.source,
      cursorLine: input.cursorLineNumber,
      kind: completionContext.parameter.definition.kind,
      parameterKey: completionContext.parameter.key,
      query,
      replacementFrom: completionContext.from,
      statementElementIds: statementElementIdsByLiveLine(input.doc, options.statementRanges()),
      elements: options.elements(),
      computedGeometry: options.computedGeometry(),
      forGroupGeneratedRows: options.forGroupGeneratedRows?.(),
      effectiveEnabledElementIds: options.effectiveEnabledElementIds(),
      errors: options.evaluationErrors()
    }).map((option) => ({
      label: option.displayLabel,
      apply: option.sourceToken,
      detail: option.detail,
      type: "constant"
    }));
  }
  if (completions.length === 0 && !context.explicit) return null;
  let from: number;
  let to: number;
  if (usesNeutralQuery && neutralQuery) {
    from = neutralQuery.replacementRange.from;
    to = neutralQuery.replacementRange.to;
    // Preserve the established CodeMirror application contract while the
    // host-neutral DTO keeps `@` outside its editable range. CodeMirror's
    // completion object still inserts the marker together with the name.
    if (
      neutralQuery.candidates.some((candidate) => candidate.kind === "binding") &&
      input.source[from - 1] === "@"
    ) from -= 1;
  } else if (projection && completionContext.from === completionContext.to) {
    // physicalSpanForLogicalRange only ever emits non-empty segments (its
    // `to > from` filter is built for real content spans, e.g. P8's comment
    // re-attachment), so an empty cursor-point range — the common case right
    // after a trigger character with nothing typed yet — always comes back
    // with zero segments there. Project the single point instead.
    const point = logicalOffsetToPhysical(projection.map, projection.statement, completionContext.from);
    if (point === null) return null;
    from = point;
    to = point;
  } else if (projection) {
    // The candidates above were already computed against logical text/offsets,
    // so the replacement range must come back through that same source
    // map/statement — never physical `base + offset` arithmetic, which would
    // silently mix logical && physical coordinate spaces on a continuation
    // statement. A range that can't collapse to one contiguous physical
    // fragment (crosses a continuation boundary) is fail-closed: no completion.
    const span = physicalSpanForLogicalRange(projection.map, projection.statement, { start: completionContext.from, end: completionContext.to });
    if (!span || span.segments.length !== 1) return null;
    from = span.segments[0].from;
    to = span.segments[0].to;
  } else {
    const base = context.pos - input.localPos;
    from = base + completionContext.from;
    to = base + completionContext.to;
  }
  return {
    from,
    to,
    options: completions,
    ...(preservesSharedReferenceRanking || disablesCompletionFiltering
      ? { filter: false as const }
      : { validFor: /^[^\s#]*$/ })
  };
};

const guardedCompletionCommand = (isComposing: () => boolean, command: Command): Command =>
  (view) => {
    if (isComposing() || view.compositionStarted) return false;
    return command(view);
  };

/** Context && candidate generation stay CM-free for the Source Editor. */
export const dslAutocompleteExtension = (options: DslAutocompleteOptions): Extension[] => {
  const guarded = (command: Command) => guardedCompletionCommand(options.isComposing, command);
  const dismissCompletionForSpace = (view: Parameters<Command>[0]) => {
    if (options.isComposing() || view.compositionStarted) return false;
    // Deliberately do not consume ,Space: CodeMirror/the browser owns inserting
    // the one ordinary whitespace character after the completion is closed.
    closeCompletion(view);
    return false;
  };

  return [
    // Own the stock completion bindings so composition can always fall through
    // to CodeMirror/the IME. With an active popup Tab accepts (rather than
    // cycles) its current candidate; when no popup is open it returns false
    // && preserves Source Editor value-span/snippet navigation.
    autocompletion({ override: [createDslCompletionSource(options)], defaultKeymap: false }),
    cmCompositionCompletionRetry({
      isComposing: options.isComposing,
      isRetryContext: (view) => isTypedReferenceRetryContext(options, view)
    }),
    cmDeleteCompletionRetry({
      isComposing: options.isComposing,
      hasImplicitCandidatesAt: (view, pos) => hasImplicitCompletionCandidatesAt(options, view, pos)
    }),
    Prec.highest(keymap.of([
      // Avoid Ctrl-Space (input-source switching) && Option character keys:
      // both are unreliable on macOS Japanese keyboard layouts.
      { key: "Mod-Shift-Space", run: guarded(startCompletion) },
      { key: "Escape", run: guarded(closeCompletion) },
      { key: "ArrowDown", run: guarded(moveCompletionSelection(true)) },
      { key: "ArrowUp", run: guarded(moveCompletionSelection(false)) },
      { key: "PageDown", run: guarded(moveCompletionSelection(true, "page")) },
      { key: "PageUp", run: guarded(moveCompletionSelection(false, "page")) },
      { key: "Enter", run: guarded(acceptCompletion) },
      { key: "Tab", run: guarded(acceptCompletion) },
      { key: "Space", run: dismissCompletionForSpace },
      { key: "Space", shift: dismissCompletionForSpace }
    ]))
  ];
};
