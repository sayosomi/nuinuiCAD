import {
  AutomationDocument,
  type AutomationDocumentState
} from "./document/automationDocument";
import { reconcileStatements } from "./document/statementReconciler";
import {
  queryDslCompletion,
  type DslCompletionQueryResult,
  type DslCompletionRecoveryInput,
  type DslCompletionSemanticSnapshot
} from "./dsl/dslCompletionQuery";
import {
  queryDslConstructionCategoryQuickFixes,
  type DslConstructionCategoryQuickFixPlan
} from "./dsl/dslConstructionCategoryQuickFixQuery";
import {
  queryDslDefinition,
  type DslDefinitionQueryResult,
  type DslDefinitionSemanticSnapshot
} from "./dsl/dslDefinitionQuery";
import {
  queryDslDocumentSymbols,
  type DslDocumentSymbol
} from "./dsl/dslDocumentSymbolQuery";
import { queryDslFixedColors, type DslFixedColorResult } from "./dsl/dslFixedColorQuery";
import { queryDslFolding, type DslFoldingRange } from "./dsl/dslFoldingQuery";
import {
  queryDslGeometryHoverDeclarationRange,
  queryDslGeometryHoverTarget,
  type DslGeometryHoverRange,
  type DslGeometryHoverTarget,
  type DslHoverSemanticSnapshot
} from "./dsl/dslHoverQuery";
import {
  planDslRenameEditsResult,
  queryDslRenameTarget,
  type DslRenameEditPlanResult,
  type DslRenameSemanticSnapshot,
  type DslRenameTarget
} from "./dsl/dslRenameQuery";
import {
  queryDslReferences,
  type DslReferencesQueryResult,
  type DslReferencesSemanticSnapshot
} from "./dsl/dslReferencesQuery";
import {
  queryDslSignatureHelp,
  type DslSignatureHelpQueryResult,
  type DslSignatureHelpSemanticSnapshot
} from "./dsl/dslSignatureHelpQuery";
import {
  queryDslSourceValueStep,
  type DslSourceValueStepPlan
} from "./dsl/dslSourceValueStepQuery";
import { queryDslThemeRoleColors, type DslThemeRoleColor } from "./dsl/dslThemeRoleColorQuery";
import {
  isDslTypoSuggestionDiagnosticCode,
  queryDslTypoSuggestions,
  type DslTypoSuggestionCandidate
} from "./dsl/dslTypoSuggestionQuery";
import type { DslDiagnostic } from "./dsl/dslTypes";
import {
  type SourceSnapshot
} from "./dsl/logicalStatementSourceMap";
import { MISSING_DECLARED_TYPE_CODE } from "./dsl/dslDeclarationParser";
import { CONSTRUCTION_CATEGORY_MISMATCH_CODE } from "./dsl/dslCallParser";
import {
  typedVariableQuickFixes,
  type TypedVariableQuickFixDescriptor
} from "./scalars/typedVariableQuickFixes";
import type { CompiledDslDocument } from "./dsl/dslDocument";
import type { LastGoodDslDocument } from "./document/canonicalDocument";
import {
  nuiDiagnosticsForState,
  toNuiDiagnostic,
  type NuiDiagnostic,
  type NuiDiagnosticRange
} from "./nuiDiagnostics";

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export type NuiEvaluableDocumentSnapshot = {
  sourceRevision: number;
  sourceText: string;
  documentRevision: number;
  compiledDocumentRevision: number;
  compiled: LastGoodDslDocument;
};

/** The one narrow current-compile bridge retained for deferred host consumers. */
export type NuiCurrentCompiledSemanticBridge = {
  sourceRevision: number;
  sourceText: string;
  compiled: CompiledDslDocument;
};

export type NuiSourceValueStepResult = {
  sourceRevision: number;
  forward: DslSourceValueStepPlan | null;
  backward: DslSourceValueStepPlan | null;
};

export type NuiQuickFixInput = {
  source: "nuinuiCAD";
  code: string;
  range: NuiDiagnosticRange;
};

export type NuiQuickFixDiagnosticFingerprint = NuiQuickFixInput;

type NuiQuickFixEdit = {
  from: number;
  to: number;
  expectedText: string;
  newText: string;
};

export type NuiQuickFixPlan =
  | {
      kind: "typo-suggestion";
      diagnostic: NuiQuickFixDiagnosticFingerprint;
      sourceRevision: number;
      candidate: DslTypoSuggestionCandidate;
      edit: NuiQuickFixEdit;
    }
  | {
      kind: "typed-variable";
      diagnostic: NuiQuickFixDiagnosticFingerprint;
      sourceRevision: number;
      descriptor: TypedVariableQuickFixDescriptor;
      edit: NuiQuickFixEdit;
    }
  | {
      kind: "construction-category";
      diagnostic: NuiQuickFixDiagnosticFingerprint;
      sourceRevision: number;
      targetCategory: string;
      edit: NuiQuickFixEdit;
    };

type CurrentSemantic = DslCompletionSemanticSnapshot & {
  sourceText: string;
  compiled: CompiledDslDocument;
};

const exactSourceFor = (sourceText: string, sourceRevision: number): SourceSnapshot => ({
  normalizedSource: normalizedSourceFor(sourceText),
  sourceRevision
});

const hasCurrentErrors = (state: AutomationDocumentState): boolean =>
  [...state.currentCompiled.diagnostics, ...(state.currentCompiled.bindingIssueDiagnostics ?? [])]
    .some((diagnostic) => diagnostic.severity === "error");

const samePosition = (
  left: { line: number; character: number },
  right: { line: number; character: number }
): boolean => left.line === right.line && left.character === right.character;

const sameRange = (
  left: NuiDiagnosticRange,
  right: NuiDiagnosticRange
): boolean => samePosition(left.start, right.start) && samePosition(left.end, right.end);

const sameFingerprint = (
  left: NuiQuickFixInput,
  right: NuiDiagnostic
): boolean => right.source === left.source && right.code === left.code && sameRange(left.range, right.range);

const dslDiagnosticsFor = (compiled: CompiledDslDocument): readonly DslDiagnostic[] => [
  ...compiled.diagnostics,
  ...(compiled.bindingIssueDiagnostics ?? [])
];

const editForDescriptor = (descriptor: TypedVariableQuickFixDescriptor): NuiQuickFixEdit => ({
  from: descriptor.action.from,
  to: descriptor.action.to,
  expectedText: descriptor.action.expectedOldText,
  newText: descriptor.action.insert
});

const editForCategoryPlan = (plan: DslConstructionCategoryQuickFixPlan): NuiQuickFixEdit => ({
  from: plan.edit.from,
  to: plan.edit.to,
  expectedText: plan.edit.expectedText,
  newText: plan.edit.newText
});

const completionEditFor = (
  source: SourceSnapshot,
  result: ReturnType<typeof queryDslTypoSuggestions>,
  candidate: DslTypoSuggestionCandidate
): NuiQuickFixEdit | null => {
  if (!result) return null;
  const { from, to } = result.replacementRange;
  if (from < 0 || to <= from || to > source.normalizedSource.length) return null;
  return {
    from,
    to,
    expectedText: source.normalizedSource.slice(from, to),
    newText: candidate.label
  };
};

const completionSemanticFor = (
  state: AutomationDocumentState,
  source: SourceSnapshot
): CurrentSemantic | null => {
  const normalizedSource = normalizedSourceFor(state.sourceText);
  const compiled = state.currentCompiled;
  if (
    source.normalizedSource !== normalizedSource ||
    source.sourceRevision !== compiled.spans.sourceMap.sourceRevision ||
    compiled.spans.sourceMap.source !== normalizedSource
  ) return null;
  return {
    sourceRevision: source.sourceRevision,
    sourceText: normalizedSource,
    compiled,
    ...(compiled.bindingAnalysis ? { bindingAnalysis: compiled.bindingAnalysis } : {})
  };
};

const completionRecoveryFor = (
  state: AutomationDocumentState
): DslCompletionRecoveryInput | undefined => {
  if (state.currentCompiled.statementMap || !state.doc.statementMap?.statementIndexByStatementId) return undefined;

  try {
    const reconciled = reconcileStatements({
      oldStatements: state.doc.statements,
      oldLines: state.doc.sourceLines,
      oldElementIds: state.doc.statementMap.elementIdByStatementIndex,
      oldStatementIds: state.doc.statementMap.statementIdByStatementIndex,
      newStatements: state.currentCompiled.statements,
      newLines: state.currentCompiled.sourceLines
    });
    const mappedStatementIds = new Map<number, string>();
    for (const [liveStatementIndex, statementId] of reconciled.assignedIds) {
      if (state.doc.statementMap.statementIndexByStatementId.has(statementId)) {
        mappedStatementIds.set(liveStatementIndex, statementId);
      }
    }
    if (mappedStatementIds.size === 0) return undefined;
    return {
      liveCompiled: state.currentCompiled,
      lastGoodCompiled: state.doc,
      mappedStatementIds
    };
  } catch {
    return undefined;
  }
};

export class NuiLanguageSession {
  private readonly document: AutomationDocument;

  constructor(sourceText: string) {
    this.document = AutomationDocument.fromSource(sourceText);
  }

  getSource(): string {
    return this.document.getSource();
  }

  getSourceRevision(): number {
    return this.document.getState().currentCompiled.spans.sourceMap.sourceRevision;
  }

  replaceSource(sourceText: string): void {
    this.document.replaceSource(sourceText);
  }

  diagnostics(): readonly NuiDiagnostic[] {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const diagnostics = nuiDiagnosticsForState(this.getSource(), state);
    const semantic = completionSemanticFor(state, source);
    if (!semantic) return diagnostics;

    const suffixCandidateByDiagnostic = new Map<string, string>();
    for (const diagnostic of dslDiagnosticsFor(semantic.compiled)) {
      if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) continue;
      const result = queryDslTypoSuggestions({ source, diagnostic, semantic });
      if (!result || result.candidates.length !== 1) continue;
      const projected = toNuiDiagnostic(this.getSource(), diagnostic);
      if (!projected || projected.code === undefined) continue;
      suffixCandidateByDiagnostic.set(
        `${projected.code}:${projected.range.start.line}:${projected.range.start.character}:${projected.range.end.line}:${projected.range.end.character}`,
        result.candidates[0]!.label
      );
    }

    return diagnostics.map((diagnostic) => {
      if (!isDslTypoSuggestionDiagnosticCode(diagnostic.code)) return diagnostic;
      const candidate = suffixCandidateByDiagnostic.get(
        `${diagnostic.code}:${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.line}:${diagnostic.range.end.character}`
      );
      return candidate
        ? {
            ...diagnostic,
            suffixPresentation: {
              key: "typoSuggestion.diagnosticSuffix",
              parameters: { candidate }
            }
          }
        : diagnostic;
    });
  }

  completion(offset: number): DslCompletionQueryResult | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source);
    const recovery = completionRecoveryFor(state);
    return queryDslCompletion({
      source,
      position: offset,
      ...(semantic ? { semantic } : {}),
      ...(recovery ? { recovery } : {})
    });
  }

  definition(offset: number): DslDefinitionQueryResult | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslDefinitionSemanticSnapshot | null;
    return queryDslDefinition({ source, position: offset, ...(semantic ? { semantic } : {}) });
  }

  hover(offset: number): DslGeometryHoverTarget | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslHoverSemanticSnapshot | null;
    return queryDslGeometryHoverTarget({ source, position: offset, ...(semantic ? { semantic } : {}) });
  }

  hoverDeclarationRange(elementId: string): DslGeometryHoverRange | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslHoverSemanticSnapshot | null;
    return queryDslGeometryHoverDeclarationRange({ source, elementId, ...(semantic ? { semantic } : {}) });
  }

  references(offset: number): DslReferencesQueryResult | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslReferencesSemanticSnapshot | null;
    return queryDslReferences({ source, position: offset, ...(semantic ? { semantic } : {}) });
  }

  prepareRename(offset: number): DslRenameTarget | null {
    const state = this.document.getState();
    if (hasCurrentErrors(state)) return null;
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslRenameSemanticSnapshot | null;
    return queryDslRenameTarget({ source, ...(semantic ? { semantic } : {}) }, offset);
  }

  rename(offset: number, newName: string): DslRenameEditPlanResult {
    const state = this.document.getState();
    if (hasCurrentErrors(state)) return { status: "rejected", rejection: { reason: "unavailable" } };
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslRenameSemanticSnapshot | null;
    return planDslRenameEditsResult(
      { source, ...(semantic ? { semantic } : {}) },
      offset,
      newName
    );
  }

  signatureHelp(offset: number): DslSignatureHelpQueryResult | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source) as DslSignatureHelpSemanticSnapshot | null;
    return queryDslSignatureHelp({ source, position: offset, ...(semantic ? { semantic } : {}) });
  }

  foldingRanges(): readonly DslFoldingRange[] {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const compiled = completionSemanticFor(state, source)?.compiled;
    return compiled
      ? queryDslFolding({ source, statements: compiled.statements, sourceMap: compiled.spans.sourceMap })
      : [];
  }

  documentSymbols(): readonly DslDocumentSymbol[] {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const compiled = completionSemanticFor(state, source)?.compiled;
    return compiled
      ? queryDslDocumentSymbols({ source, statements: compiled.statements, sourceMap: compiled.spans.sourceMap })
      : [];
  }

  fixedColors(): readonly DslFixedColorResult[] {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source);
    return queryDslFixedColors({ source, semantic: semantic ?? undefined });
  }

  themeRoleColors(): readonly DslThemeRoleColor[] {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source);
    return queryDslThemeRoleColors({ source, semantic: semantic ?? undefined });
  }

  sourceValueStep(offset: number): NuiSourceValueStepResult | null {
    const forward = this.sourceValueStepForSelection({ start: offset, end: offset }, 1);
    const backward = this.sourceValueStepForSelection({ start: offset, end: offset }, -1);
    if (!forward && !backward) return null;
    return { sourceRevision: this.getSourceRevision(), forward, backward };
  }

  sourceValueStepForSelection(
    selection: { start: number; end: number },
    direction: 1 | -1
  ): DslSourceValueStepPlan | null {
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source);
    return queryDslSourceValueStep({
      source,
      semantic: semantic ?? undefined,
      selections: [selection],
      direction
    });
  }

  quickFixes(input: NuiQuickFixInput): readonly NuiQuickFixPlan[] {
    if (input.source !== "nuinuiCAD") return [];
    const state = this.document.getState();
    const source = exactSourceFor(this.getSource(), this.getSourceRevision());
    const semantic = completionSemanticFor(state, source);
    if (!semantic) return [];

    const projectedDiagnostics = this.diagnostics();
    const target = projectedDiagnostics.find((diagnostic) => sameFingerprint(input, diagnostic));
    if (!target) return [];

    const rawDiagnostic = dslDiagnosticsFor(semantic.compiled).find((diagnostic) => {
      const projected = toNuiDiagnostic(this.getSource(), diagnostic);
      return projected ? sameFingerprint(input, projected) : false;
    });
    if (!rawDiagnostic) return [];

    const fingerprint: NuiQuickFixDiagnosticFingerprint = {
      source: target.source,
      code: target.code!,
      range: target.range
    };
    const plans: NuiQuickFixPlan[] = [];

    if (isDslTypoSuggestionDiagnosticCode(rawDiagnostic.code)) {
      const result = queryDslTypoSuggestions({ source, diagnostic: rawDiagnostic, semantic });
      for (const candidate of result?.candidates ?? []) {
        const edit = completionEditFor(source, result, candidate);
        if (edit) plans.push({
          kind: "typo-suggestion",
          diagnostic: fingerprint,
          sourceRevision: source.sourceRevision,
          candidate,
          edit
        });
      }
    }

    if (rawDiagnostic.code === MISSING_DECLARED_TYPE_CODE || rawDiagnostic.code === "invalid-choice-literal") {
      const descriptorsByDiagnostic = typedVariableQuickFixes(
        semantic.sourceText,
        semantic.compiled.statements,
        semantic.compiled.diagnostics
      );
      for (const [index, diagnostic] of semantic.compiled.diagnostics.entries()) {
        const projected = toNuiDiagnostic(this.getSource(), diagnostic);
        if (!projected || !sameFingerprint(input, projected)) continue;
        for (const descriptor of descriptorsByDiagnostic[index] ?? []) {
          plans.push({
            kind: "typed-variable",
            diagnostic: fingerprint,
            sourceRevision: source.sourceRevision,
            descriptor,
            edit: editForDescriptor(descriptor)
          });
        }
      }
    }

    if (rawDiagnostic.code === CONSTRUCTION_CATEGORY_MISMATCH_CODE) {
      const categoryPlans = queryDslConstructionCategoryQuickFixes({
        source,
        diagnostic: rawDiagnostic,
        semantic: {
          sourceRevision: source.sourceRevision,
          sourceText: semantic.sourceText,
          compiled: semantic.compiled
        }
      });
      plans.push(...categoryPlans.map((plan) => ({
        kind: "construction-category" as const,
        diagnostic: fingerprint,
        sourceRevision: source.sourceRevision,
        targetCategory: plan.targetCategory,
        edit: editForCategoryPlan(plan)
      })));
    }

    return plans;
  }

  runtimeEvaluationSnapshot(): NuiEvaluableDocumentSnapshot | null {
    const state = this.document.getState();
    const sourceText = this.getSource();
    const normalizedSource = normalizedSourceFor(sourceText);
    const sourceRevision = this.getSourceRevision();
    if (
      state.status === "fatal" ||
      hasCurrentErrors(state) ||
      state.docText !== sourceText ||
      state.currentCompiled.spans.sourceMap.source !== normalizedSource ||
      state.currentCompiled.spans.sourceMap.sourceRevision !== sourceRevision ||
      state.doc.spans.sourceMap.source !== normalizedSource ||
      state.doc.spans.sourceMap.sourceRevision !== sourceRevision
    ) return null;
    return {
      sourceRevision,
      sourceText: normalizedSource,
      documentRevision: state.revision,
      compiledDocumentRevision: state.compiledRevision,
      compiled: state.doc
    };
  }

  /** @internal Transition-only bridge for deferred workspace/runtime consumers. */
  currentCompiledSemanticBridge(): NuiCurrentCompiledSemanticBridge | null {
    const state = this.document.getState();
    const sourceText = this.getSource();
    const normalizedSource = normalizedSourceFor(sourceText);
    const sourceRevision = this.getSourceRevision();
    if (
      state.currentCompiled.spans.sourceMap.source !== normalizedSource ||
      state.currentCompiled.spans.sourceMap.sourceRevision !== sourceRevision
    ) return null;
    return { sourceRevision, sourceText: normalizedSource, compiled: state.currentCompiled };
  }

  /** @internal Transition-only completion recovery for old query-level tests. */
  currentCompletionRecovery(): DslCompletionRecoveryInput | undefined {
    return completionRecoveryFor(this.document.getState());
  }
}

export const createNuiLanguageSession = (sourceText: string): NuiLanguageSession =>
  new NuiLanguageSession(sourceText);
