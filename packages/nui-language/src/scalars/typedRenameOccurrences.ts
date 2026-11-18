// Occurrence enumeration for typed binding rename safety analysis.
// Pure - reads only already-compiled analysis records (scalarProgram,
// textTemplates, propertyBindings, and other typed references, &&
// the raw already-parsed DslStatement stream). Never
// re-parses DSL source, never calls compileDslDocument/parseDsl.
//
// Completeness boundary: initializer/property/template
// occurrences are enumerated only for statements that already compiled
// successfully - each source map here only contains resolved entries. A
// currently-broken reference is an existing, independent compile diagnostic
// && out of reach without re-parsing raw text, which this module avoids.
// Carry targets and next references are owned by the source semantic
// occurrence index; this typed batch only handles scalar expression sites.
import type { DslSpan, DslStatement } from "../dsl/dslTypes";
import type { BindingCatalog, BindingId } from "./bindingCatalog";
import type { BindingReferenceSite } from "./bindingResolution";
import type { LexicalScopeIndex } from "./lexicalScopeIndex";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import type { ScalarProgram } from "./scalarProgram";
import type { TextTemplateAst } from "./textTemplate";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { readDslReferencePathSegments } from "../dsl/dslReferenceTokens";
import { referencesIn } from "./typedDependencyGraph";

export type TypedRenameOccurrenceKind =
  | "initializer"
  | "property-binding"
  | "numeric-expression"
  | "template-hole"
  | "module-semantic";

export type TypedRenameOccurrence = {
  readonly kind: TypedRenameOccurrenceKind;
  /** Unique across the whole batch; also the resolver request key. */
  readonly key: string;
  readonly site: BindingReferenceSite;
  /** Exact patchable span - bare name only, never including a leading `@`. */
  readonly span: DslSpan;
  /** Complete reference path used for name resolution, including every qualifier. */
  readonly referenceName: string;
  /** Source text for the terminal path segment at `span`. */
  readonly currentName: string;
  /** Invalid/unexpected path forms remain present for resolution but fail closed before editing. */
  readonly patchable: boolean;
  readonly physicalSpan?: DslPhysicalSpan;
  /** Only present for "initializer" occurrences - required by resolveInitializerReferences's owner-aware self-detection. */
  readonly initializerOwner?: { readonly fromBindingId: BindingId; readonly occurrenceIndex: number };
};

export type TypedRenameReferenceLeaf = {
  readonly leafName: string;
  readonly span: DslSpan;
};

/** Projects an already-parsed reference path to the source span of its final segment. */
export const typedRenameReferenceLeaf = (
  referenceName: string,
  referenceSpan: DslSpan
): TypedRenameReferenceLeaf | null => {
  const path = readDslReferencePathSegments(referenceName);
  if (path.kind !== "valid" || path.end !== referenceName.length || path.segments.length === 0) return null;
  const leaf = path.segments[path.segments.length - 1];
  if (!leaf) return null;
  return {
    leafName: referenceName.slice(leaf.start, leaf.end),
    span: { start: referenceSpan.start + leaf.start, end: referenceSpan.start + leaf.end }
  };
};

/** Changes a resolved path's leaf while preserving its absolute marker and ancestor text verbatim. */
export const renameTypedReferenceLeaf = (referenceName: string, newName: string): string | null => {
  const path = readDslReferencePathSegments(referenceName);
  if (path.kind !== "valid" || path.end !== referenceName.length || path.segments.length === 0) return null;
  const leaf = path.segments[path.segments.length - 1];
  if (!leaf) return null;
  return referenceName.slice(0, leaf.start) + newName + referenceName.slice(leaf.end);
};

/** Shared with typedRenameAnalysis.ts's resolveInitializerReferences replay - the sole key format for an initializer occurrence, never re-derived a second way. */
export const occurrenceKeyForInitializerRef = (bindingId: BindingId, occurrenceIndex: number) =>
  `initializer:${bindingId}:${occurrenceIndex}`;

/** Every reference inside every program-eligible typed declaration's initializer. */
export const collectInitializerOccurrences = (
  scalarProgram: ScalarProgram | undefined,
  catalog: BindingCatalog
): readonly TypedRenameOccurrence[] => {
  const occurrences: TypedRenameOccurrence[] = [];
  for (const statement of scalarProgram?.statements ?? []) {
    const binding = catalog.bindingsById.get(statement.bindingId);
    if (!binding) continue;
    const refs = referencesIn(statement.declaration.initializer);
    refs.forEach((reference, occurrenceIndex) => {
      const leaf = typedRenameReferenceLeaf(reference.name, reference.nameSpan);
      occurrences.push({
        kind: "initializer",
        key: occurrenceKeyForInitializerRef(statement.bindingId, occurrenceIndex),
        site: { scopeId: statement.scopeId, statementIndex: binding.statementIndex },
        span: leaf?.span ?? reference.nameSpan,
        referenceName: reference.name,
        currentName: leaf?.leafName ?? reference.name,
        patchable: leaf !== null,
        initializerOwner: { fromBindingId: statement.bindingId, occurrenceIndex }
      });
    });
  }
  return occurrences;
};

export type SiteBatchOccurrenceInput = {
  readonly scopeIndex: LexicalScopeIndex;
  readonly statements: readonly DslStatement[];
  readonly propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  readonly textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  readonly numericBindings?: ReadonlyMap<string, CompiledNumericBinding>;
};

const scopeIdForStatement = (scopeIndex: LexicalScopeIndex, statementIndex: number) =>
  scopeIndex.scopeOfStatement.get(statementIndex) ?? scopeIndex.rootScopeId;

const statementIndexFromOccurrenceKey = (key: string): number => Number(key.slice(0, key.indexOf(":")));

/**
 * Every occurrence resolvable through the owner-less `resolveReferencesAtSites`
 * batch resolver: scalar expression references,
 * (valid || not - see the module header), bare `@binding` property values,
 * && typed text-template holes.
 */
export const collectSiteBatchOccurrences = (
  input: SiteBatchOccurrenceInput
): readonly TypedRenameOccurrence[] => {
  const occurrences: TypedRenameOccurrence[] = [];

  for (const [occurrenceKey, source] of input.propertyBindings ?? []) {
    const statementIndex = statementIndexFromOccurrenceKey(occurrenceKey);
    if (source.kind === "binding") {
      const leaf = typedRenameReferenceLeaf(source.name, source.nameSpan);
      occurrences.push({
        kind: "property-binding",
        key: `property-binding:${occurrenceKey}`,
        site: { scopeId: scopeIdForStatement(input.scopeIndex, statementIndex), statementIndex },
        span: leaf?.span ?? source.nameSpan,
        referenceName: source.name,
        currentName: leaf?.leafName ?? source.name,
        patchable: leaf !== null
      });
    } else if (source.kind === "expression") {
      referencesIn(source.expression).forEach((reference, index) => {
        if (reference.bindingId === null) return;
        const leaf = typedRenameReferenceLeaf(reference.name, reference.nameSpan);
        occurrences.push({
          kind: "property-binding",
          key: `property-binding:${occurrenceKey}:${index}`,
          site: { scopeId: scopeIdForStatement(input.scopeIndex, statementIndex), statementIndex },
          span: leaf?.span ?? reference.nameSpan,
          referenceName: reference.name,
          currentName: leaf?.leafName ?? reference.name,
          patchable: leaf !== null
        });
      });
    }
  }

  for (const [occurrenceKey, template] of input.textTemplates ?? []) {
    const statementIndex = statementIndexFromOccurrenceKey(occurrenceKey);
    template.dependencies.forEach((dependency, index) => {
      const referenceSpan = { start: dependency.span.start + 1, end: dependency.span.end };
      const leaf = typedRenameReferenceLeaf(dependency.name, referenceSpan);
      occurrences.push({
        kind: "template-hole",
        key: `template-hole:${occurrenceKey}:${index}`,
        site: {
          scopeId: scopeIdForStatement(input.scopeIndex, statementIndex),
          statementIndex
        },
        span: leaf?.span ?? referenceSpan,
        referenceName: dependency.name,
        currentName: leaf?.leafName ?? dependency.name,
        patchable: leaf !== null
      });
    });
  }
  for (const [occurrenceKey, numeric] of input.numericBindings ?? []) {
    numeric.references.forEach((reference, index) => {
      const leaf = typedRenameReferenceLeaf(reference.name, reference.nameSpan);
      occurrences.push({
        kind: "numeric-expression", key: `numeric-expression:${occurrenceKey}:${index}`,
        site: reference.site, span: leaf?.span ?? reference.nameSpan,
        referenceName: reference.name, currentName: leaf?.leafName ?? reference.name, patchable: leaf !== null,
        ...(reference.physicalNameSpan?.segments.length === 1 ? { physicalSpan: reference.physicalNameSpan } : {})
      });
    });
  }

  return occurrences;
};
