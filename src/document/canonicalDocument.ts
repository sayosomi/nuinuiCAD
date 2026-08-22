import {
  compileDslDocument,
  NEW_DOCUMENT_DSL_MAJOR_VERSION,
  serializeDocumentToDsl,
  type CompiledDslDocument,
  type DslDocumentData,
  type DslMajorVersion,
  type StatementMap
} from "../dsl/dslDocument";
import { MISSING_ATTRIBUTE_VALUE_CODE } from "../dsl/dslArgScanner";
import { parseDslSnapshot } from "../dsl/dslParser";
import type { DslDiagnostic } from "../dsl/dslTypes";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import { createCadElementId } from "../model/cadIds";
import type { ElementId } from "../types/geometry";
import type { TypedDependencyGraph } from "../scalars/typedDependencyGraph";
import { defaultDocumentPalette } from "../palette/palette";
import { defaultVisibilityProfile } from "../model/visibilityProfiles";
import { applyLineSplices, buildTextPatch, UnappliedTextPatchError, type LineSplice } from "./textPatch";
import { reconcileStatements } from "./statementReconciler";
import { zipAssignedElementIds } from "./shadowText";
import { buildModuleModelPatch } from "./moduleModelBridge";

export type LastGoodDslDocument = Omit<CompiledDslDocument, "document" | "statementMap" | "majorVersion"> & {
  document: DslDocumentData;
  statementMap: StatementMap;
  /** Always resolvable once document/statementMap are non-null — see CompiledDslDocument.majorVersion. */
  majorVersion: DslMajorVersion;
};

export type CanonicalDocumentValue = {
  sourceText: string;
  doc: LastGoodDslDocument;
  docText: string;
  diagnostics: DslDiagnostic[];
  /** Task 48: BindingAnalysis.issues adapted to DslDiagnostic - see
   * CompiledDslDocument.bindingIssueDiagnostics for why this stays out of
   * `diagnostics` itself (non-gating). Always sourced from the same compile
   * attempt as `diagnostics` at every construction site in this file. */
  bindingIssueDiagnostics: readonly DslDiagnostic[];
  /** Current-source analysis; it must not fall back with last-good geometry. */
  typedDependencyGraph?: TypedDependencyGraph;
};

export type TextCompileResult = CanonicalDocumentValue & {
  /** The compile attempt for sourceText, including partial fatal results. */
  currentCompiled: CompiledDslDocument;
  status: "valid" | "warning" | "fatal";
};

export type ModelBridgeResult =
  | { status: "committed"; value: CanonicalDocumentValue; splices: LineSplice[] }
  | { status: "noop" }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "unapplied"; reason: string; diagnostic: DslDiagnostic };

// sourceTextは保存対象そのもの。改行やBOMをここで正規化しない。
const normalizedText = (text: string) => text;

const compileLines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");

export const isLastGoodDslDocument = (
  compiled: CompiledDslDocument
): compiled is LastGoodDslDocument => Boolean(compiled.document && compiled.statementMap);

const adoptElementObjects = (
  compiled: LastGoodDslDocument,
  elements: DslDocumentData["elements"]
): LastGoodDslDocument => ({
  ...compiled,
  document: {
    ...compiled.document,
    elements
  }
});

/**
 * Recoverable editor errors can still produce a compiled document so live
 * source semantics remain available. Such a partial document must not become
 * the identity-reconciliation owner for the next revision: statements that
 * temporarily disappear would otherwise receive fresh IDs when the source is
 * repaired. Keep the last error-free reconciliation base associated with each
 * errorful compiled document without changing the document's live semantics.
 */
const errorRecoveryReconciliationBase = new WeakMap<LastGoodDslDocument, LastGoodDslDocument>();

const hasErrorDiagnostics = (compiled: CompiledDslDocument): boolean =>
  compiled.diagnostics.some((item) => item.severity === "error") ||
  (compiled.bindingIssueDiagnostics ?? []).some((item) => item.severity === "error");

export const compileCanonicalText = (
  current: CanonicalDocumentValue,
  nextText: string,
  options: { createdElementIds?: readonly ElementId[] } = {}
): TextCompileResult => {
  const sourceText = normalizedText(nextText);
  const revision = current.sourceText === sourceText ? current.doc.statementMap.sourceRevision : current.doc.statementMap.sourceRevision + 1;
  const normalizedSource = sourceText.replace(/\r\n/g, "\n");
  const parsed = parseDslSnapshot({ normalizedSource, sourceRevision: revision });
  const createdElementIds = [...(options.createdElementIds ?? [])];
  const reconciliationBase = errorRecoveryReconciliationBase.get(current.doc) ?? current.doc;
  const reconciled = reconcileStatements({
    oldStatements: reconciliationBase.statements,
    oldLines: reconciliationBase.sourceLines,
    oldElementIds: reconciliationBase.statementMap.elementIdByStatementIndex,
    oldStatementIds: reconciliationBase.statementMap.statementIdByStatementIndex,
    newStatements: parsed.statements,
    newLines: compileLines(sourceText)
  }, {
    createId: (type) => createdElementIds.shift() ?? createCadElementId(type)
  });
  const compiled = compileDslDocument(sourceText, {
    assignedElementIds: reconciled.assignedIds,
    assignedStatementIds: reconciled.assignedIds,
    preparsed: parsed,
    sourceRevision: revision
  });

  if (!isLastGoodDslDocument(compiled)) {
    return {
      sourceText,
      doc: current.doc,
      docText: current.docText,
      currentCompiled: compiled,
      diagnostics: compiled.diagnostics,
      bindingIssueDiagnostics: compiled.bindingIssueDiagnostics ?? [],
      typedDependencyGraph: compiled.typedDependencyGraph,
      status: "fatal"
    };
  }

  if (hasErrorDiagnostics(compiled)) {
    errorRecoveryReconciliationBase.set(compiled, reconciliationBase);
  }

  return {
    sourceText,
    doc: compiled,
    docText: sourceText,
    currentCompiled: compiled,
    diagnostics: compiled.diagnostics,
    bindingIssueDiagnostics: compiled.bindingIssueDiagnostics ?? [],
    typedDependencyGraph: compiled.typedDependencyGraph,
    status: compiled.diagnostics.some((item) => item.severity === "warning")
      ? "warning"
      : "valid"
  };
};

const compileZippedModelText = (
  text: string,
  afterDocument: DslDocumentData,
  sourceRevision = 0,
  previous?: LastGoodDslDocument
): { ok: true; doc: LastGoodDslDocument } | { ok: false; reason: string } => {
  const sourceText = normalizedText(text);
  const parsed = parseDslSnapshot({ normalizedSource: sourceText.replace(/\r\n/g, "\n"), sourceRevision });
  // Same missing-attribute-value carve-out as dslDocument.ts/dslCompiler.ts:
  // this model-diff recompile path must stay consistent with the line-splice
  // path (compileCanonicalText), || a document containing an intentionally-
  // blank `key:` value would patch successfully but fail this fallback
  // regeneration, which the shadow-equivalence property test treats as a
  // genuine inconsistency.
  if (parsed.diagnostics.some((item) => item.severity === "error" && item.code !== MISSING_ATTRIBUTE_VALUE_CODE)) {
    return { ok: false, reason: "モデル差分テキストの構文解析に失敗しました。" };
  }
  const assignedElementIds = zipAssignedElementIds(parsed.statements, afterDocument.elements);
  if (!assignedElementIds) {
    return { ok: false, reason: "モデル差分テキストと要素列の位置対応が崩れました。" };
  }
  // Geometry IDs come from the model bridge; typed declaration identities
  // remain reconciler-owned && are never synthesized from the source text.
  const assignedStatementIds = previous
    ? reconcileStatements({
        oldStatements: previous.statements,
        oldLines: previous.sourceLines,
        oldElementIds: previous.statementMap.elementIdByStatementIndex,
        oldStatementIds: previous.statementMap.statementIdByStatementIndex,
        newStatements: parsed.statements,
        newLines: compileLines(sourceText)
      }).assignedIds
    : new Map<number, ElementId>();
  for (const [statementIndex, elementId] of assignedElementIds) assignedStatementIds.set(statementIndex, elementId);
  const compiled = compileDslDocument(sourceText, {
    assignedElementIds,
    assignedStatementIds,
    preparsed: parsed,
    sourceRevision
  });
  if (!isLastGoodDslDocument(compiled)) {
    return { ok: false, reason: "モデル差分テキストのコンパイルに失敗しました。" };
  }
  const compiledIds = compiled.document.elements.map((element) => element.id);
  if (
    compiledIds.length !== afterDocument.elements.length ||
    compiledIds.some((id, index) => id !== afterDocument.elements[index].id)
  ) {
    return { ok: false, reason: "モデル差分テキストの要素ID列が一致しません。" };
  }
  return { ok: true, doc: adoptElementObjects(compiled, afterDocument.elements) };
};

export const commitModelBridge = (
  current: CanonicalDocumentValue,
  afterDocument: DslDocumentData,
  snapshot?: SourceSnapshot
): ModelBridgeResult => {
  if (snapshot && (
    snapshot.sourceRevision !== current.doc.statementMap.sourceRevision ||
    snapshot.normalizedSource !== current.sourceText.replace(/\r\n/g, "\n")
  )) {
    return { status: "rejected", reason: "revision-mismatch" };
  }
  if (current.docText !== current.sourceText) {
    return { status: "rejected", reason: "fatalな編集中テキストがあるためモデル編集を適用できません。" };
  }

  if (current.doc.moduleMaterialization) {
    const modulePatch = buildModuleModelPatch(current, afterDocument);
    if (modulePatch.status === "noop") return { status: "noop" };
    if (modulePatch.status === "unapplied") {
      return {
        status: "unapplied",
        reason: modulePatch.reason,
        diagnostic: {
          severity: "error",
          line: 1,
          column: 1,
          message: modulePatch.reason,
          sourceRevision: current.doc.statementMap.sourceRevision
        }
      };
    }
    let patchedText: string;
    try {
      patchedText = applyLineSplices(current.sourceText, modulePatch.splices);
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    if (patchedText === current.sourceText) return { status: "noop" };
    const compiled = compileCanonicalText(current, patchedText);
    if (compiled.status === "fatal") {
      return { status: "failed", reason: "Module source patch後のテキストをコンパイルできませんでした。" };
    }
    return {
      status: "committed",
      value: {
        sourceText: compiled.sourceText,
        doc: compiled.doc,
        docText: compiled.docText,
        diagnostics: compiled.diagnostics,
        bindingIssueDiagnostics: compiled.bindingIssueDiagnostics,
        typedDependencyGraph: compiled.typedDependencyGraph
      },
      splices: modulePatch.splices
    };
  }

  let patchedText: string;
  let splices: LineSplice[];
  try {
    splices = buildTextPatch({ old: current.doc, newDocument: afterDocument });
    patchedText = applyLineSplices(
      current.sourceText,
      splices
    );
  } catch (error) {
    if (error instanceof UnappliedTextPatchError) {
      return {
        status: "unapplied",
        reason: error.message,
        diagnostic: { severity: "error", line: 1, column: 1, message: error.message, sourceRevision: current.doc.statementMap.sourceRevision }
      };
    }
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  if (patchedText === current.sourceText) return { status: "noop" };

  const compiled = compileZippedModelText(patchedText, afterDocument, current.doc.statementMap.sourceRevision + 1, current.doc);
  if (!compiled.ok) return { status: "failed", reason: compiled.reason };

  return {
    status: "committed",
    value: {
      sourceText: patchedText,
      doc: compiled.doc,
      docText: patchedText,
      diagnostics: compiled.doc.diagnostics,
      bindingIssueDiagnostics: compiled.doc.bindingIssueDiagnostics ?? [],
      typedDependencyGraph: compiled.doc.typedDependencyGraph
    },
    splices
  };
};

export type LineSplicePatchResult =
  | { status: "committed"; value: CanonicalDocumentValue; splices: LineSplice[] }
  | { status: "noop" }
  | { status: "failed"; reason: string };

/**
 * Commits precomputed `LineSplice`s directly (no element-model diff step) -
 * for callers, like the typed binding rename command, that already know
 * exactly what changed && only need it applied && recompiled. Reuses
 * `applyLineSplices` && `compileCanonicalText` verbatim; does not
 * reimplement either. Unlike `commitModelBridge`, there is no `afterDocument`
 * to zip element IDs against, so recompilation goes through the same
 * statement-reconciling `compileCanonicalText` path plain text edits use -
 * this is what preserves the renamed declaration's stable binding identity.
 */
export const commitLineSplicePatch = (
  current: CanonicalDocumentValue,
  splices: readonly LineSplice[],
  options: { createdElementIds?: readonly ElementId[] } = {}
): LineSplicePatchResult => {
  if (current.docText !== current.sourceText) {
    return { status: "failed", reason: "fatalな編集中テキストがあるため適用できません。" };
  }
  let patchedText: string;
  try {
    patchedText = applyLineSplices(current.sourceText, splices);
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
  if (patchedText === current.sourceText) return { status: "noop" };

  const compiled = compileCanonicalText(current, patchedText, options);
  if (compiled.status === "fatal") {
    return { status: "failed", reason: "パッチ後のテキストをコンパイルできませんでした。" };
  }
  return {
    status: "committed",
    value: {
      sourceText: compiled.sourceText,
      doc: compiled.doc,
      docText: compiled.docText,
      diagnostics: compiled.diagnostics,
      bindingIssueDiagnostics: compiled.bindingIssueDiagnostics,
      typedDependencyGraph: compiled.typedDependencyGraph
    },
    splices: [...splices]
  };
};

export const regenerateCanonicalFromModel = (
  document: DslDocumentData,
  majorVersion: DslMajorVersion
): CanonicalDocumentValue => {
  const sourceText = serializeDocumentToDsl(document, majorVersion);
  const compiled = compileZippedModelText(sourceText, document);
  if (!compiled.ok) throw new Error(compiled.reason);
  return {
    sourceText,
    doc: compiled.doc,
    docText: sourceText,
    diagnostics: compiled.doc.diagnostics,
    bindingIssueDiagnostics: compiled.doc.bindingIssueDiagnostics ?? [],
    typedDependencyGraph: compiled.doc.typedDependencyGraph
  };
};

const emptyFileSnapshot = (): DslDocumentData => ({
  elements: [],
  modifiers: [],
  palette: defaultDocumentPalette(),
  visibilityRoles: [],
  visibilityProfiles: [defaultVisibilityProfile()],
  activeVisibilityProfileId: defaultVisibilityProfile().id,
  layouts: [],
  printOutputs: [],
  svgOutputs: [],
  evaluationLimitIndex: undefined
});

export const compileFreshCanonicalText = (
  sourceText: string
): TextCompileResult => {
  const baseline = regenerateCanonicalFromModel(emptyFileSnapshot(), NEW_DOCUMENT_DSL_MAJOR_VERSION);
  return compileCanonicalText(baseline, sourceText);
};
