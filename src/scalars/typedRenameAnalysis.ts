// Task 37: typed binding rename safety analysis. Pure - determines whether
// renaming one typed `const`/`let` declaration changes scope resolution
// anywhere in the document, without ever re-parsing DSL source or invoking
// compileDslDocument. See docs/typed-variables/tasks/37-typed-rename-analysis.md.
//
// Mechanism: a "virtual renamed catalog" is a cheap shallow copy of the real
// BindingCatalog with only the target Binding's `.name` field replaced.
// bindingResolution.ts's runSweep - the shared engine behind both
// resolveInitializerReferences and resolveReferencesAtSites - rebuilds its
// per-statement ScopeFrames from scratch on every call and reads `.name`
// directly off each Binding in `catalog.bindings` at sweep time; it never
// consults the catalog's precomputed name-indexed maps for typed-binding
// matching. So every occurrence in the document is replayed twice - once
// against the real catalog (with each occurrence's actual current name text)
// and once against the virtual catalog (occurrences currently resolving to
// the rename target use the candidate new name; every other occurrence keeps
// its real text unchanged) - and the two full BindingResolution results are
// compared structurally (kind + relevant binding id(s), never collapsed to a
// single id). Any difference anywhere in the document, not just at the
// rename target's own references, is a capture/resolution-change rejection -
// mirroring src/document/renameAnalysis.ts's `validateRenameReferenceStability`
// ("every before/after reference slot; rename targets receive no exception").
import type { DslSpan, DslStatement } from "../dsl/dslTypes";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { isBareDslIdentifierChar } from "../dsl/dslTokens";
import type { Binding, BindingCatalog, BindingId, BindingKind } from "./bindingCatalog";
import {
  resolveInitializerReferences,
  resolveReferencesAtSites,
  type BindingResolution,
  type InitializerResolutionRequest,
  type SiteReferenceRequest
} from "./bindingResolution";
import type { ElementLocalRangeIndex } from "./elementLocalRangeIndex";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import type { ScalarProgram } from "./scalarProgram";
import { classifySetTargetResolution, type SetStatementAnalysis, type SetTargetClassification } from "./setStatementCompiler";
import type { TextTemplateAst } from "./textTemplate";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import {
  collectInitializerOccurrences,
  collectSiteBatchOccurrences,
  occurrenceKeyForInitializerRef,
  type TypedRenameOccurrence,
  type TypedRenameOccurrenceKind
} from "./typedRenameOccurrences";

export type TypedRenameAnalysisInput = {
  catalog: BindingCatalog;
  statements: readonly DslStatement[];
  targetBindingId: BindingId;
  newName: string;
  physicalSpan?: DslPhysicalSpan;
  scalarProgram?: ScalarProgram;
  setStatements?: ReadonlyMap<number, SetStatementAnalysis>;
  propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  numericBindings?: ReadonlyMap<string, CompiledNumericBinding>;
  /** Same neutral local-resolution owner numeric-expression/text-template
   * compilation already uses (see elementLocalRangeIndex.ts) - a rename
   * that would newly resolve a reference to a same-named element-local
   * variable must be rejected as a capture exactly like any other
   * resolution change, so replay must see the same element-local data the
   * real compiler does. */
  elementLocalRangeIndex: ElementLocalRangeIndex;
};

export type TypedRenameSpan = {
  kind: TypedRenameOccurrenceKind;
  /** Index into the compiled document's `statements` array - required by
   * Task 38 to project this logical-text-local span into a physical
   * document position; not itself a re-resolution of anything. */
  statementIndex: number;
  span: DslSpan;
  oldName: string;
  newName: string;
};

export type TypedRenameCollisionDetail = {
  conflictingBindingId: BindingId;
  conflictingName: string;
  conflictingKind: BindingKind;
  conflictingSpan: DslSpan | null;
};

export type TypedRenameCaptureDetail = {
  kind: TypedRenameOccurrenceKind;
  span: DslSpan;
  name: string;
};

export type TypedRenameAnalysisRejected =
  | { verdict: "rejected"; reason: "target-not-found"; detail: { targetBindingId: BindingId } }
  | { verdict: "rejected"; reason: "invalid-name"; detail: { input: string; message: string } }
  | { verdict: "rejected"; reason: "same-scope-collision"; detail: TypedRenameCollisionDetail }
  | { verdict: "rejected"; reason: "capture"; detail: TypedRenameCaptureDetail };

export type TypedRenameAnalysis =
  | {
      verdict: "ok";
      targetBindingId: BindingId;
      newName: string;
      declarationSpan: DslSpan | null;
      occurrences: readonly TypedRenameSpan[];
    }
  | TypedRenameAnalysisRejected;

const RESERVED_SCALAR_WORDS = new Set(["true", "false"]);

const validateScalarIdentifier = (name: string): string | null => {
  if (name.length === 0) return "名前は空にできません。";
  if (RESERVED_SCALAR_WORDS.has(name)) return `"${name}" は予約語のため使用できません。`;
  if (![...name].every(isBareDslIdentifierChar)) return "名前をDSLトークンとして安全に表現できません。";
  return null;
};

const findSameScopeCollision = (
  catalog: BindingCatalog,
  target: Binding,
  newName: string
): TypedRenameCollisionDetail | null => {
  const bucket = catalog.bindingsByEffectiveScopeAndName.get(target.effectiveScopeId)?.get(newName) ?? [];
  const conflict = bucket.find((binding) => binding.id !== target.id);
  if (!conflict) return null;
  return {
    conflictingBindingId: conflict.id,
    conflictingName: conflict.name,
    conflictingKind: conflict.kind,
    conflictingSpan: conflict.nameSpan
  };
};

const buildVirtualRenamedCatalog = (catalog: BindingCatalog, target: Binding, newName: string): BindingCatalog => {
  const renamedTarget: Binding = { ...target, name: newName };
  const bindings = catalog.bindings.map((binding) => (binding.id === target.id ? renamedTarget : binding));
  const bindingsById = new Map(catalog.bindingsById);
  bindingsById.set(target.id, renamedTarget);
  return { ...catalog, bindings, bindingsById };
};

const resolutionTargetsBinding = (resolution: BindingResolution | undefined, bindingId: BindingId): boolean =>
  !!resolution &&
  ((resolution.kind === "resolved" && resolution.binding.id === bindingId) ||
    (resolution.kind === "self" && resolution.bindingId === bindingId));

const idListsEqual = (a: readonly BindingId[], b: readonly BindingId[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/** Structural equality - never collapsed to a single id. Every BindingResolution variant compares its own relevant field(s). */
const sameResolution = (before: BindingResolution, after: BindingResolution): boolean => {
  if (before.kind !== after.kind) return false;
  switch (before.kind) {
    case "resolved":
      return after.kind === "resolved" && before.binding.id === after.binding.id;
    case "self":
      return after.kind === "self" && before.bindingId === after.bindingId;
    case "undefined":
      return true;
    case "forward":
      return after.kind === "forward" && idListsEqual(before.bindingIds, after.bindingIds);
    case "duplicate":
      return after.kind === "duplicate" && idListsEqual(before.bindingIds, after.bindingIds);
    case "resolvedLocal":
      // Numeric-expression and template-hole occurrences both carry
      // site.elementLocal and this replay passes elementLocalRangeIndex, so
      // this arm is live: it is exactly what rejects a rename that would
      // newly capture a same-named element-local variable (before/after
      // local.id differs, or one side is "resolvedLocal" and the other
      // isn't, which the outer `before.kind !== after.kind` check above
      // already catches).
      return after.kind === "resolvedLocal" && before.local.id === after.local.id;
  }
};

const sameSetTargetClassification = (before: SetTargetClassification, after: SetTargetClassification): boolean => {
  if (before.kind !== after.kind) return false;
  if (before.kind === "valid" && after.kind === "valid") return before.binding.id === after.binding.id;
  if (before.kind === "invalid" && after.kind === "invalid") return before.reason === after.reason;
  return true;
};

const toInitializerRequests = (
  occurrences: readonly TypedRenameOccurrence[],
  affectedKeys: ReadonlySet<string> | null,
  newName: string | null
): InitializerResolutionRequest[] =>
  occurrences.map((occurrence) => ({
    fromBindingId: occurrence.initializerOwner!.fromBindingId,
    occurrenceIndex: occurrence.initializerOwner!.occurrenceIndex,
    name: affectedKeys?.has(occurrence.key) ? newName! : occurrence.currentName,
    site: occurrence.site
  }));

const toSiteRequests = (
  occurrences: readonly TypedRenameOccurrence[],
  affectedKeys: ReadonlySet<string> | null,
  newName: string | null
): SiteReferenceRequest[] =>
  occurrences.map((occurrence) => ({
    key: occurrence.key,
    name: affectedKeys?.has(occurrence.key) ? newName! : occurrence.currentName,
    site: occurrence.site
  }));

/**
 * The only public entry point. Callers gather `input` from a single compiled
 * document (see src/document/typedRenameAnalysis.ts for the adapter) and get
 * back either an "ok" verdict carrying every occurrence's exact patchable
 * span (ready for Task 38 to splice atomically, no further analysis needed),
 * or a rejection with enough detail to explain why.
 */
export const analyzeTypedBindingRename = (input: TypedRenameAnalysisInput): TypedRenameAnalysis => {
  const target = input.catalog.bindingsById.get(input.targetBindingId);
  if (!target || target.kind !== "typed") {
    return { verdict: "rejected", reason: "target-not-found", detail: { targetBindingId: input.targetBindingId } };
  }

  const newName = input.newName;
  const nameError = validateScalarIdentifier(newName);
  if (nameError) return { verdict: "rejected", reason: "invalid-name", detail: { input: input.newName, message: nameError } };

  const collision = findSameScopeCollision(input.catalog, target, newName);
  if (collision) return { verdict: "rejected", reason: "same-scope-collision", detail: collision };

  const virtualCatalog = buildVirtualRenamedCatalog(input.catalog, target, newName);

  // The scalar program may also contain materialized module bindings. Those
  // identities are intentionally outside the document BindingCatalog and
  // must not be replayed through the document-only Binding resolver; module
  // source occurrences are added by the CompiledDslDocument adapter below.
  const initializerOccurrences = collectInitializerOccurrences(input.scalarProgram)
    .filter((occurrence) => input.catalog.bindingsById.has(occurrence.initializerOwner!.fromBindingId) && input.catalog.scopeIndex.scopes.has(occurrence.site.scopeId));
  const siteOccurrences = collectSiteBatchOccurrences({
    scopeIndex: input.catalog.scopeIndex,
    statements: input.statements,
    setStatements: input.setStatements,
    propertyBindings: input.propertyBindings,
    textTemplates: input.textTemplates
    , numericBindings: input.numericBindings
  }).filter((occurrence) => input.catalog.scopeIndex.scopes.has(occurrence.site.scopeId));
  const setTargetOccurrences = siteOccurrences.filter((occurrence) => occurrence.kind === "set-target");
  const otherSiteOccurrences = siteOccurrences.filter((occurrence) => occurrence.kind !== "set-target");

  // Pass 1: real catalog, every occurrence's actual current name text - one
  // batched sweep per resolver, not one call per occurrence. Both passes
  // share the exact same elementLocalRangeIndex: a typed-binding rename
  // never touches any element's numericVariables, so element-local
  // visibility is identical before and after.
  const initializerBefore = resolveInitializerReferences(
    input.catalog,
    toInitializerRequests(initializerOccurrences, null, null),
    input.elementLocalRangeIndex
  );
  const siteBefore = resolveReferencesAtSites(input.catalog, toSiteRequests(siteOccurrences, null, null), input.elementLocalRangeIndex);

  const affectedKeys = new Set<string>();
  for (const resolved of initializerBefore) {
    if (resolutionTargetsBinding(resolved.resolution, target.id)) affectedKeys.add(occurrenceKeyFor(resolved));
  }
  for (const occurrence of otherSiteOccurrences) {
    if (resolutionTargetsBinding(siteBefore.get(occurrence.key), target.id)) affectedKeys.add(occurrence.key);
  }
  for (const occurrence of setTargetOccurrences) {
    const classification = classifySetTargetResolution(siteBefore.get(occurrence.key));
    if (classification.kind === "valid" && classification.binding.id === target.id) affectedKeys.add(occurrence.key);
  }

  // A rename with zero referencing occurrences (only the declaration itself
  // changes) still falls through to the same replay below, so shadow-capture
  // of *unrelated* occurrences by the new name is always checked.

  // Pass 2: virtual catalog, affected occurrences use newName, every other
  // occurrence keeps its real, unchanged text.
  const initializerAfterList = resolveInitializerReferences(
    virtualCatalog,
    toInitializerRequests(initializerOccurrences, affectedKeys, newName),
    input.elementLocalRangeIndex
  );
  const initializerAfter = new Map(initializerAfterList.map((resolved) => [occurrenceKeyFor(resolved), resolved.resolution]));
  const siteAfter = resolveReferencesAtSites(virtualCatalog, toSiteRequests(siteOccurrences, affectedKeys, newName), input.elementLocalRangeIndex);

  for (let index = 0; index < initializerOccurrences.length; index += 1) {
    const occurrence = initializerOccurrences[index];
    const before = initializerBefore[index].resolution;
    const after = initializerAfter.get(occurrence.key);
    if (!after || !sameResolution(before, after)) {
      return {
        verdict: "rejected",
        reason: "capture",
        detail: { kind: occurrence.kind, span: occurrence.span, name: occurrence.currentName }
      };
    }
  }
  for (const occurrence of otherSiteOccurrences) {
    const before = siteBefore.get(occurrence.key);
    const after = siteAfter.get(occurrence.key);
    if (!before || !after || !sameResolution(before, after)) {
      return {
        verdict: "rejected",
        reason: "capture",
        detail: { kind: occurrence.kind, span: occurrence.span, name: occurrence.currentName }
      };
    }
  }
  for (const occurrence of setTargetOccurrences) {
    const before = classifySetTargetResolution(siteBefore.get(occurrence.key));
    const after = classifySetTargetResolution(siteAfter.get(occurrence.key));
    if (!sameSetTargetClassification(before, after)) {
      return {
        verdict: "rejected",
        reason: "capture",
        detail: { kind: occurrence.kind, span: occurrence.span, name: occurrence.currentName }
      };
    }
  }

  const occurrences: TypedRenameSpan[] = [];
  for (const occurrence of [...initializerOccurrences, ...siteOccurrences]) {
    if (!affectedKeys.has(occurrence.key)) continue;
    occurrences.push({
      kind: occurrence.kind,
      statementIndex: occurrence.site.statementIndex,
      span: occurrence.span,
      oldName: occurrence.currentName,
      newName,
      ...(occurrence.physicalSpan ? { physicalSpan: occurrence.physicalSpan } : {})
    });
  }

  return { verdict: "ok", targetBindingId: target.id, newName, declarationSpan: target.nameSpan, occurrences };
};

const occurrenceKeyFor = (resolved: { fromBindingId: BindingId; occurrenceIndex: number }): string =>
  occurrenceKeyForInitializerRef(resolved.fromBindingId, resolved.occurrenceIndex);
