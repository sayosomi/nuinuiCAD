// Occurrence enumeration for typed binding rename safety analysis.
// Pure - reads only already-compiled analysis records (scalarProgram,
// textTemplates, propertyBindings, setStatements, &&
// the raw already-parsed DslStatement stream for `set` target names). Never
// re-parses DSL source, never calls compileDslDocument/parseDsl.
//
// Completeness boundary: initializer/set-rhs/property/template
// occurrences are enumerated only for statements that already compiled
// successfully - each source map here only contains resolved entries. A
// currently-broken reference is an existing, independent compile diagnostic
// && out of reach without re-parsing raw text, which this module avoids.
// `set` target enumeration is the one exception with full coverage (valid ||
// not), since it only needs the statement's own `name`/`nameSpan`, already
// parsed - no RHS parsing required.
import type { DslSpan, DslStatement } from "../dsl/dslTypes";
import type { BindingCatalog, BindingId } from "./bindingCatalog";
import type { BindingReferenceSite } from "./bindingResolution";
import type { LexicalScopeIndex } from "./lexicalScopeIndex";
import type { ScalarValueSource } from "./propertyBindingCompiler";
import type { ScalarProgram } from "./scalarProgram";
import type { SetStatementAnalysis } from "./setStatementCompiler";
import type { TextTemplateAst } from "./textTemplate";
import type { CompiledNumericBinding } from "./numericBindingCompiler";
import type { DslPhysicalSpan } from "../dsl/logicalStatementSourceMap";
import { referencesIn } from "./typedDependencyGraph";

export type TypedRenameOccurrenceKind =
  | "initializer"
  | "set-rhs"
  | "set-target"
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
  readonly currentName: string;
  readonly physicalSpan?: DslPhysicalSpan;
  /** Only present for "initializer" occurrences - required by resolveInitializerReferences's owner-aware self-detection. */
  readonly initializerOwner?: { readonly fromBindingId: BindingId; readonly occurrenceIndex: number };
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
      occurrences.push({
        kind: "initializer",
        key: occurrenceKeyForInitializerRef(statement.bindingId, occurrenceIndex),
        site: { scopeId: statement.scopeId, statementIndex: binding.statementIndex },
        span: reference.nameSpan,
        currentName: reference.name,
        initializerOwner: { fromBindingId: statement.bindingId, occurrenceIndex }
      });
    });
  }
  return occurrences;
};

export type SiteBatchOccurrenceInput = {
  readonly scopeIndex: LexicalScopeIndex;
  readonly statements: readonly DslStatement[];
  readonly setStatements?: ReadonlyMap<number, SetStatementAnalysis>;
  readonly propertyBindings?: ReadonlyMap<string, ScalarValueSource>;
  readonly textTemplates?: ReadonlyMap<string, TextTemplateAst>;
  readonly numericBindings?: ReadonlyMap<string, CompiledNumericBinding>;
};

const scopeIdForStatement = (scopeIndex: LexicalScopeIndex, statementIndex: number) =>
  scopeIndex.scopeOfStatement.get(statementIndex) ?? scopeIndex.rootScopeId;

const statementIndexFromOccurrenceKey = (key: string): number => Number(key.slice(0, key.indexOf(":")));

/**
 * Every occurrence resolvable through the owner-less `resolveReferencesAtSites`
 * batch resolver: set RHS references, every `set` statement's own target name
 * (valid || not - see the module header), bare `@binding` property values,
 * && typed text-template holes.
 */
export const collectSiteBatchOccurrences = (
  input: SiteBatchOccurrenceInput
): readonly TypedRenameOccurrence[] => {
  const occurrences: TypedRenameOccurrence[] = [];

  for (const [statementIndex, analysis] of input.setStatements ?? []) {
    const refs = referencesIn(analysis.expression);
    refs.forEach((reference, index) => {
      occurrences.push({
        kind: "set-rhs",
        key: `set-rhs:${statementIndex}:${index}`,
        site: { scopeId: analysis.scopeId, statementIndex: analysis.sourceOrder },
        span: reference.nameSpan,
        currentName: reference.name
      });
    });
  }

  input.statements.forEach((statement, statementIndex) => {
    if (statement.kind !== "set" || !statement.nameSpan) return;
    occurrences.push({
      kind: "set-target",
      key: `set-target:${statementIndex}`,
      site: { scopeId: scopeIdForStatement(input.scopeIndex, statementIndex), statementIndex },
      span: statement.nameSpan,
      currentName: statement.name
    });
  });

  for (const [occurrenceKey, source] of input.propertyBindings ?? []) {
    const statementIndex = statementIndexFromOccurrenceKey(occurrenceKey);
    if (source.kind === "binding") {
      occurrences.push({
        kind: "property-binding",
        key: `property-binding:${occurrenceKey}`,
        site: { scopeId: scopeIdForStatement(input.scopeIndex, statementIndex), statementIndex },
        span: source.nameSpan,
        currentName: source.name
      });
    } else if (source.kind === "expression") {
      referencesIn(source.expression).forEach((reference, index) => {
        if (reference.bindingId === null) return;
        occurrences.push({
          kind: "property-binding",
          key: `property-binding:${occurrenceKey}:${index}`,
          site: { scopeId: scopeIdForStatement(input.scopeIndex, statementIndex), statementIndex },
          span: reference.nameSpan,
          currentName: reference.name
        });
      });
    }
  }

  for (const [occurrenceKey, template] of input.textTemplates ?? []) {
    const statementIndex = statementIndexFromOccurrenceKey(occurrenceKey);
    template.dependencies.forEach((dependency, index) => {
      occurrences.push({
        kind: "template-hole",
        key: `template-hole:${occurrenceKey}:${index}`,
        site: {
          scopeId: scopeIdForStatement(input.scopeIndex, statementIndex),
          statementIndex
        },
        // TextTemplateDependency has no separate bare-identifier nameSpan
        // (unlike ScalarValueSource/TypedScalarExpression's reference node) -
        // `.span` covers the whole "@name" token, confirmed by reading its
        // actual value against source text. `@` is always exactly one
        // character immediately before the name (no space is a valid `@name`
        // token), so trimming it here keeps every occurrence kind's span
        // uniformly "bare identifier only", matching this module's contract.
        span: { start: dependency.span.start + 1, end: dependency.span.end },
        currentName: dependency.name
      });
    });
  }
  for (const [occurrenceKey, numeric] of input.numericBindings ?? []) {
    numeric.references.forEach((reference, index) => occurrences.push({
      kind: "numeric-expression", key: `numeric-expression:${occurrenceKey}:${index}`,
      site: reference.site, span: reference.nameSpan, currentName: reference.name,
      ...(reference.physicalNameSpan?.segments.length === 1 ? { physicalSpan: reference.physicalNameSpan } : {})
    }));
  }

  return occurrences;
};
