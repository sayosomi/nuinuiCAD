import * as vscode from "vscode";
import {
  applyLineSplices,
  type LineSplice
} from "../../src/document/textPatch";
import {
  planInlineModule,
  type InlineModulePlan,
  type InlineModulePolicy,
  type InlineModuleTargetIdentity
} from "../../src/document/inlineModulePlanner";
import type { CompiledDslDocument } from "../../src/dsl/dslDocument";
import { sourceOwnerForRuntimeElementId } from "../../src/dsl/sourceOwnership";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type {
  VscodeInlineModuleCanvasTargetProof,
  VscodeInlineModuleCanvasTargetsPublication,
  VscodeInlineModuleGeneratedGroupProof
} from "../../src/vscode/protocol";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  inlineModuleRejectionMessageFor,
  inlineModuleSummaryFor,
  inlineModuleTranslatorFor
} from "./inlineModuleLocalization";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";

export const VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID = "nuinuiCAD.inlineModuleInstance";
export const VSCODE_INLINE_MODULE_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.inlineModuleSourceTarget";
export const VSCODE_INLINE_MODULE_CANVAS_TARGET_CONTEXT_KEY = "nuinuiCAD.inlineModuleCanvasTarget";

export type InlineModuleCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
};

export type InlineModuleCommandFeatureHost = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  activeSourceEditor: () => vscode.TextEditor | undefined;
  sourceEditorForDocument: (document: vscode.TextDocument) => vscode.TextEditor | undefined;
  activeCanvasEndpoint: () => InlineModuleCanvasEndpoint | null;
  applySourceLineSplices: (
    editor: vscode.TextEditor,
    expectedDocumentVersion: number,
    expectedSourceText: string,
    splices: readonly LineSplice[]
  ) => Promise<boolean>;
  displayLanguageFor?: () => string;
};

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

export type VscodeInlineModuleCommandFeature = vscode.Disposable & {
  handleCanvasTargetsPublication: (
    document: vscode.TextDocument,
    publication: VscodeInlineModuleCanvasTargetsPublication
  ) => void;
  handleCanvasAuthoritativeDocumentReady: (document: vscode.TextDocument, documentVersion: number) => void;
  handleDocumentChange: (document: vscode.TextDocument) => void;
  handleDocumentClose: (document: vscode.TextDocument) => void;
};

type ExactSourceState = {
  rawSource: string;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  session: NuiLanguageAnalysisSession;
};

type SourceSelection = {
  start: vscode.Position;
  end: vscode.Position;
  active: vscode.Position;
  isEmpty: boolean;
};

type SourceInvocation = ExactSourceState & {
  editor: vscode.TextEditor;
  selection: SourceSelection;
  targets: readonly InlineModuleTargetIdentity[];
};

type PendingCanvasSelection = {
  endpoint: InlineModuleCanvasEndpoint;
  document: vscode.TextDocument;
  documentVersion: number;
  normalizedSource: string;
  oldNormalizedSource: string;
  splices: readonly LineSplice[];
  plan: InlineModulePlan;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const documentKey = (document: vscode.TextDocument): string => document.uri.toString();

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor => Boolean(
  editor &&
  editor.document.uri.scheme === "file" &&
  editor.document.fileName.endsWith(".nui")
);

const selectionFor = (editor: vscode.TextEditor): SourceSelection => ({
  start: editor.selection.start,
  end: editor.selection.end,
  active: editor.selection.active,
  isEmpty: editor.selection.start.line === editor.selection.end.line &&
    editor.selection.start.character === editor.selection.end.character
});

const positionEquals = (left: vscode.Position, right: vscode.Position): boolean =>
  left.line === right.line && left.character === right.character;

const selectionsEqual = (left: SourceSelection, right: SourceSelection): boolean =>
  left.isEmpty === right.isEmpty &&
  positionEquals(left.start, right.start) &&
  positionEquals(left.end, right.end) &&
  positionEquals(left.active, right.active);

const sourceTargetIdsEqual = (
  left: readonly InlineModuleTargetIdentity[],
  right: readonly InlineModuleTargetIdentity[]
): boolean => left.length === right.length && left.every((target, index) => {
  const other = right[index];
  return target.documentKey === other?.documentKey && target.statementId === other.statementId;
});

const exactSourceStateFor = (
  document: vscode.TextDocument,
  languageAnalysisSessionFor: InlineModuleCommandFeatureHost["languageAnalysisSessionFor"]
): ExactSourceState | null => {
  const rawSource = document.getText();
  const session = languageAnalysisSessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  const semantic = session.definitionSemanticSnapshot(source);
  const compiled = semantic?.compiled;
  if (!compiled || !compiled.statementMap || compiled.spans.sourceMap.source !== source.normalizedSource) {
    return null;
  }
  return { rawSource, source, compiled, session };
};

const statementTargetFor = (
  compiled: CompiledDslDocument,
  statementIndex: number
): InlineModuleTargetIdentity | null => {
  const statementId = compiled.statementMap?.statementIdByStatementIndex?.get(statementIndex);
  const statement = compiled.statements[statementIndex];
  return statement && statement.kind === "moduleInstance" && statementId
    ? { documentKey: null, statementId }
    : null;
};

/** Collects only authored Module-instance statements from one exact Source snapshot. */
export const collectInlineModuleSourceTargets = (
  editor: vscode.TextEditor | undefined,
  languageAnalysisSessionFor: InlineModuleCommandFeatureHost["languageAnalysisSessionFor"]
): SourceInvocation | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const exact = exactSourceStateFor(editor.document, languageAnalysisSessionFor);
  if (!exact || !exact.compiled.statementMap) return null;

  const selection = selectionFor(editor);
  const start = normalizedOffsetFromRaw(exact.rawSource, editor.document.offsetAt(selection.start));
  const end = normalizedOffsetFromRaw(exact.rawSource, editor.document.offsetAt(selection.end));
  const statementIndexes = selection.isEmpty
    ? exact.compiled.statements.flatMap((statement, statementIndex) =>
        statement.kind === "moduleInstance" &&
        statement.sourceRevision === exact.source.sourceRevision &&
        statement.physicalSpan.sourceRevision === exact.source.sourceRevision &&
        statement.physicalSpan.segments.some((segment) => segment.from <= start && start < segment.to)
          ? [statementIndex]
          : [])
    : exact.compiled.statements.flatMap((statement, statementIndex) =>
        statement.kind === "moduleInstance" &&
        statement.sourceRevision === exact.source.sourceRevision &&
        statement.documentRange.sourceRevision === exact.source.sourceRevision &&
        statement.documentRange.from < end && start < statement.documentRange.to
          ? [statementIndex]
          : []);
  const targets = statementIndexes
    .map((statementIndex) => statementTargetFor(exact.compiled, statementIndex))
    .filter((target): target is InlineModuleTargetIdentity => target !== null);
  return { ...exact, editor, selection, targets };
};

const statementPathFor = (
  runtimeElementId: string,
  compiled: CompiledDslDocument
): readonly number[] | null => {
  const materialization = compiled.moduleMaterialization;
  const owner = compiled.statementMap && materialization
    ? sourceOwnerForRuntimeElementId({
        statementMap: compiled.statementMap,
        moduleMaterialization: materialization
      }, runtimeElementId)
    : null;
  if (!owner || owner.kind !== "moduleInstance") return null;
  const path = owner.origin?.instancePath ?? materialization?.runtimeIdentityByElementId.get(runtimeElementId)?.path;
  const ids = compiled.statementMap?.statementIndexByStatementId;
  if (!path || path.length === 0 || !ids) return null;
  const indexes = path.map((statementId) => ids.get(statementId));
  return indexes.every((index): index is number => index !== undefined && Number.isInteger(index) && index >= 0)
    ? indexes
    : null;
};

const proofRangeEqual = (
  statement: CompiledDslDocument["statements"][number],
  proof: VscodeInlineModuleCanvasTargetProof
): boolean => statement.documentRange.from === proof.sourceRange.from &&
  statement.documentRange.to === proof.sourceRange.to;

/** Re-proves Canvas-local runtime tokens against the fresh Extension Host materialization. */
export const reproveInlineModuleCanvasTargets = ({
  publication,
  source,
  compiled
}: {
  publication: VscodeInlineModuleCanvasTargetsPublication;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
}): readonly InlineModuleTargetIdentity[] => {
  if (
    publication.normalizedSource !== source.normalizedSource ||
    !compiled.statementMap ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    compiled.statementMap.sourceRevision !== source.sourceRevision
  ) return [];

  const materialization = compiled.moduleMaterialization;
  if (!materialization) return [];
  const currentByPath = new Map<string, {
    target: InlineModuleTargetIdentity;
    statementIndex: number;
    path: readonly number[];
  }>();
  for (const runtimeElementId of materialization.originByRuntimeElementId.keys()) {
    const owner = sourceOwnerForRuntimeElementId({
      statementMap: compiled.statementMap,
      moduleMaterialization: materialization
    }, runtimeElementId);
    const path = statementPathFor(runtimeElementId, compiled);
    const statementId = owner?.sourceStatementId;
    const mappedStatementId = compiled.statementMap.statementIdByStatementIndex?.get(owner?.sourceStatementIndex ?? -1);
    const statement = owner && compiled.statements[owner.sourceStatementIndex];
    if (
      !owner ||
      owner.kind !== "moduleInstance" ||
      !path ||
      !statementId ||
      mappedStatementId !== statementId ||
      !statement ||
      statement.kind !== "moduleInstance" ||
      statement.sourceRevision !== source.sourceRevision ||
      owner.source?.kind === "dependency-saved"
    ) continue;
    const key = JSON.stringify(path);
    if (!currentByPath.has(key)) {
      currentByPath.set(key, {
        target: { documentKey: null, statementId },
        statementIndex: owner.sourceStatementIndex,
        path
      });
    }
  }

  const resolved: Array<{ target: InlineModuleTargetIdentity; statementIndex: number }> = [];
  const seenStatementIndexes = new Set<number>();
  for (const proof of publication.targets) {
    if (
      !Number.isInteger(proof.sourceStatementIndex) ||
      !Array.isArray(proof.sourceStatementPath) ||
      proof.sourceStatementPath.some((index) => !Number.isInteger(index) || index < 0) ||
      typeof proof.sourceStatementId !== "string"
    ) continue;
    const candidate = currentByPath.get(JSON.stringify(proof.sourceStatementPath));
    const statement = candidate && compiled.statements[candidate.statementIndex];
    if (
      !candidate ||
      !statement ||
      candidate.statementIndex !== proof.sourceStatementIndex ||
      candidate.target.statementId !== proof.sourceStatementId ||
      !proofRangeEqual(statement, proof) ||
      seenStatementIndexes.has(candidate.statementIndex)
    ) continue;
    seenStatementIndexes.add(candidate.statementIndex);
    resolved.push(candidate);
  }
  return resolved
    .sort((left, right) => left.statementIndex - right.statementIndex)
    .map(({ target }) => target);
};

const lineCountFor = (splice: LineSplice): number =>
  splice.endLine >= splice.startLine ? splice.endLine - splice.startLine + 1 : 0;

const mappedLineFor = (oldLine: number, splices: readonly LineSplice[]): number => {
  let delta = 0;
  for (const splice of [...splices].sort((left, right) => left.startLine - right.startLine)) {
    if (oldLine < splice.startLine) break;
    if (oldLine <= splice.endLine || splice.endLine < splice.startLine && oldLine === splice.startLine) {
      return splice.startLine + delta;
    }
    delta += splice.replacementLines.length - lineCountFor(splice);
  }
  return oldLine + delta;
};

const generatedGroupProofsFor = (
  oldNormalizedSource: string,
  plan: InlineModulePlan,
  compiled: CompiledDslDocument,
  source: SourceSnapshot
): readonly VscodeInlineModuleGeneratedGroupProof[] => {
  let candidateSource: string;
  try {
    candidateSource = applyLineSplices(oldNormalizedSource, plan.splices);
  } catch {
    return [];
  }
  if (candidateSource !== source.normalizedSource || !compiled.statementMap) return [];

  const proofs: VscodeInlineModuleGeneratedGroupProof[] = [];
  for (const target of plan.targets) {
    if (target.status !== "inlined") continue;
    const expectedLine = mappedLineFor(target.sourceRange.startLine, plan.splices);
    const candidates = compiled.statements.flatMap((statement, statementIndex) =>
      statement.kind === "group" &&
      statement.name === target.generatedGroupName &&
      statement.documentRange.startLine === expectedLine &&
      statement.sourceRevision === source.sourceRevision
        ? [{ statement, statementIndex }]
        : []);
    if (candidates.length !== 1) return [];
    const candidate = candidates[0]!;
    const statementId = compiled.statementMap.statementIdByStatementIndex?.get(candidate.statementIndex);
    const info = statementId ? compiled.statementMap.statementRangeById.get(statementId) : undefined;
    if (!statementId || !info || info.sourceRevision !== source.sourceRevision) return [];
    proofs.push({
      sourceStatementIndex: candidate.statementIndex,
      sourceRange: {
        from: candidate.statement.documentRange.from,
        to: candidate.statement.documentRange.to
      },
      generatedGroupName: target.generatedGroupName
    });
  }
  return proofs;
};

export const inlineModulePolicyForSettings = (): InlineModulePolicy => {
  const configuration = vscode.workspace.getConfiguration("nuinuiCAD");
  return {
    emitOmittedBranchComments: configuration.get<boolean>("inlineModule.emitOmittedBranchComments", true),
    includeHiddenInstances: configuration.get<boolean>("inlineModule.includeHiddenInstances", false),
    includeDisabledInstances: configuration.get<boolean>("inlineModule.includeDisabledInstances", false)
  };
};

const resultSummary = (plan: InlineModulePlan, displayLanguage: string): string =>
  inlineModuleSummaryFor(plan, displayLanguage);

export const registerVscodeInlineModuleCommandFeature = ({
  languageAnalysisSessionFor,
  activeSourceEditor,
  sourceEditorForDocument,
  activeCanvasEndpoint,
  applySourceLineSplices,
  displayLanguageFor = vscodeDisplayLanguage
}: InlineModuleCommandFeatureHost): VscodeInlineModuleCommandFeature => {
  let disposed = false;
  let nextRequestId = 1;
  let contextUpdate: Promise<void> = Promise.resolve();
  const publications = new Map<string, VscodeInlineModuleCanvasTargetsPublication>();
  let pendingCanvasSelection: PendingCanvasSelection | null = null;

  const setContexts = (sourceTarget: boolean, canvasTarget: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all([
        vscode.commands.executeCommand("setContext", VSCODE_INLINE_MODULE_SOURCE_TARGET_CONTEXT_KEY, sourceTarget),
        vscode.commands.executeCommand("setContext", VSCODE_INLINE_MODULE_CANVAS_TARGET_CONTEXT_KEY, canvasTarget)
      ]))
      .then(() => undefined);
  };

  const currentCanvasPublicationFor = (endpoint: InlineModuleCanvasEndpoint): VscodeInlineModuleCanvasTargetsPublication | null => {
    const publication = publications.get(documentKey(endpoint.document));
    return publication && publication.documentVersion === endpoint.document.version &&
      publication.normalizedSource === normalizedSourceFor(endpoint.document.getText()) &&
      endpoint.isAuthoritativeReady()
      ? publication
      : null;
  };

  const canvasTargetsFor = (endpoint: InlineModuleCanvasEndpoint): readonly InlineModuleTargetIdentity[] => {
    const publication = currentCanvasPublicationFor(endpoint);
    const exact = exactSourceStateFor(endpoint.document, languageAnalysisSessionFor);
    return publication && exact
      ? reproveInlineModuleCanvasTargets({ publication, source: exact.source, compiled: exact.compiled })
      : [];
  };

  const refreshContext = (): void => {
    if (disposed) return;
    const sourceEditor = activeSourceEditor();
    const sourceInvocation = collectInlineModuleSourceTargets(sourceEditor, languageAnalysisSessionFor);
    if (sourceInvocation) {
      setContexts(sourceInvocation.targets.length > 0, false);
      return;
    }
    const endpoint = activeCanvasEndpoint();
    setContexts(false, endpoint ? canvasTargetsFor(endpoint).length > 0 : false);
  };

  const canvasProofsEqual = (
    left: readonly VscodeInlineModuleCanvasTargetProof[],
    right: readonly VscodeInlineModuleCanvasTargetProof[]
  ): boolean => left.length === right.length && left.every((proof, index) => {
    const other = right[index];
    return other?.runtimeElementId === proof.runtimeElementId &&
      other.sourceStatementId === proof.sourceStatementId &&
      other.sourceStatementIndex === proof.sourceStatementIndex &&
      JSON.stringify(other.sourceStatementPath) === JSON.stringify(proof.sourceStatementPath) &&
      other.sourceRange.from === proof.sourceRange.from &&
      other.sourceRange.to === proof.sourceRange.to;
  });

  const execute = async (): Promise<void> => {
    if (disposed) return;
    const displayLanguage = displayLanguageFor();
    const sourceEditor = activeSourceEditor();
    const sourceInvocation = collectInlineModuleSourceTargets(sourceEditor, languageAnalysisSessionFor);
    let origin: "source" | "canvas";
    let editor: vscode.TextEditor;
    let exact: ExactSourceState;
    let canvasEndpoint: InlineModuleCanvasEndpoint | null = null;
    let capturedPublication: VscodeInlineModuleCanvasTargetsPublication | null = null;

    if (sourceInvocation) {
      if (sourceInvocation.targets.length === 0) {
        void vscode.window.showErrorMessage(
          inlineModuleTranslatorFor(displayLanguage)("inlineModule.source.noTarget")
        );
        return;
      }
      origin = "source";
      editor = sourceInvocation.editor;
      exact = sourceInvocation;
    } else {
      canvasEndpoint = activeCanvasEndpoint();
      if (!canvasEndpoint || !canvasEndpoint.isAuthoritativeReady()) {
        void vscode.window.showErrorMessage(
          inlineModuleTranslatorFor(displayLanguage)("inlineModule.requiresCurrentTarget")
        );
        return;
      }
      const publication = currentCanvasPublicationFor(canvasEndpoint);
      const canvasExact = exactSourceStateFor(canvasEndpoint.document, languageAnalysisSessionFor);
      const canvasTargets = publication && canvasExact
        ? reproveInlineModuleCanvasTargets({ publication, source: canvasExact.source, compiled: canvasExact.compiled })
        : [];
      if (!publication || !canvasExact || canvasTargets.length === 0) {
        void vscode.window.showErrorMessage(
          inlineModuleTranslatorFor(displayLanguage)("inlineModule.canvas.noTarget")
        );
        refreshContext();
        return;
      }
      editor = sourceEditorForDocument(canvasEndpoint.document) ??
        vscode.window.visibleTextEditors.find((candidate) => sameDocument(candidate.document, canvasEndpoint!.document)) ??
        await vscode.window.showTextDocument(canvasEndpoint.document, { preserveFocus: true, preview: false });
      origin = "canvas";
      exact = canvasExact;
      capturedPublication = publication;
      // The re-proof above is the only target authority for Canvas execution.
    }

    const capturedDocument = editor.document;
    const capturedVersion = capturedDocument.version;
    const capturedRawSource = capturedDocument.getText();
    const capturedSelection = origin === "source" ? selectionFor(editor) : null;
    const targets = origin === "source"
      ? (sourceInvocation?.targets ?? [])
      : reproveInlineModuleCanvasTargets({
          publication: capturedPublication!,
          source: exact.source,
          compiled: exact.compiled
        });
    if (targets.length === 0) return;

    const result = planInlineModule({
      source: exact.source,
      compiled: exact.compiled,
      targets,
      policy: inlineModulePolicyForSettings()
    });
    if (result.status === "rejected") {
      void vscode.window.showErrorMessage(`nuinuiCAD: ${inlineModuleRejectionMessageFor(result, displayLanguage)}`);
      return;
    }

    const currentSourceInvocation = origin === "source"
      ? collectInlineModuleSourceTargets(activeSourceEditor(), languageAnalysisSessionFor)
      : null;
    const currentEndpoint = origin === "canvas" ? activeCanvasEndpoint() : null;
    const currentExact = exactSourceStateFor(capturedDocument, languageAnalysisSessionFor);
    const currentPublication = currentEndpoint ? currentCanvasPublicationFor(currentEndpoint) : null;
    const currentCanvasTargets = currentEndpoint && currentPublication && currentExact
      ? reproveInlineModuleCanvasTargets({ publication: currentPublication, source: currentExact.source, compiled: currentExact.compiled })
      : [];
    const canvasProofsStillCurrent = Boolean(
      origin === "canvas" && capturedPublication && currentPublication &&
      canvasProofsEqual(capturedPublication.targets, currentPublication.targets)
    );
    const stillCurrent = currentExact &&
      currentExact.rawSource === capturedRawSource &&
      capturedDocument.version === capturedVersion &&
      (origin === "source"
        ? Boolean(
            currentSourceInvocation &&
            currentSourceInvocation.editor === editor &&
            capturedSelection &&
            selectionsEqual(capturedSelection, currentSourceInvocation.selection) &&
            sourceTargetIdsEqual(targets, currentSourceInvocation.targets)
          )
        : Boolean(
            currentEndpoint &&
            currentEndpoint.panel === canvasEndpoint!.panel &&
            currentEndpoint.isAuthoritativeReady() &&
            currentPublication &&
            canvasProofsStillCurrent &&
            sourceTargetIdsEqual(targets, currentCanvasTargets)
          ));
    if (!stillCurrent) {
      void vscode.window.showErrorMessage(
        inlineModuleTranslatorFor(displayLanguage)("inlineModule.sourceOrCanvasChanged")
      );
      refreshContext();
      return;
    }

    if (result.splices.length === 0) {
      void vscode.window.showWarningMessage(
        `${inlineModuleTranslatorFor(displayLanguage)("inlineModule.noChanges")} ${resultSummary(result, displayLanguage)}`
      );
      return;
    }

    const applied = await applySourceLineSplices(editor, capturedVersion, capturedRawSource, result.splices);
    if (!applied) {
      void vscode.window.showErrorMessage(
        inlineModuleTranslatorFor(displayLanguage)("inlineModule.sourceChangedBeforeApply")
      );
      refreshContext();
      return;
    }

    if (origin === "canvas" && canvasEndpoint) {
      pendingCanvasSelection = {
        endpoint: canvasEndpoint,
        document: capturedDocument,
        documentVersion: capturedDocument.version,
        normalizedSource: normalizedSourceFor(capturedDocument.getText()),
        oldNormalizedSource: exact.source.normalizedSource,
        splices: result.splices,
        plan: result
      };
    }
    void vscode.window.showInformationMessage(resultSummary(result, displayLanguage));
    refreshContext();
  };

  const finishPendingCanvasSelection = (
    document: vscode.TextDocument,
    publication: VscodeInlineModuleCanvasTargetsPublication
  ): void => {
    const pending = pendingCanvasSelection;
    if (!pending || !sameDocument(pending.document, document)) return;
    const currentEndpoint = activeCanvasEndpoint();
    if (!currentEndpoint || currentEndpoint.panel !== pending.endpoint.panel) {
      pendingCanvasSelection = null;
      return;
    }
    if (
      pending.documentVersion !== document.version ||
      pending.normalizedSource !== publication.normalizedSource ||
      pending.normalizedSource !== normalizedSourceFor(document.getText()) ||
      !pending.endpoint.isAuthoritativeReady()
    ) return;
    const exact = exactSourceStateFor(document, languageAnalysisSessionFor);
    if (!exact) return;
    const generatedGroups = generatedGroupProofsFor(
      pending.oldNormalizedSource,
      pending.plan,
      exact.compiled,
      exact.source
    );
    pendingCanvasSelection = null;
    if (generatedGroups.length === 0) return;
    void pending.endpoint.panel.webview.postMessage({
      type: "inlineModuleSelectionRequest",
      requestId: nextRequestId++,
      documentVersion: document.version,
      normalizedSource: exact.source.normalizedSource,
      generatedGroups
    });
  };

  const handleCanvasTargetsPublication = (
    document: vscode.TextDocument,
    publication: VscodeInlineModuleCanvasTargetsPublication
  ): void => {
    if (disposed) return;
    if (
      !Number.isInteger(publication.documentVersion) ||
      publication.documentVersion !== document.version ||
      publication.normalizedSource !== normalizedSourceFor(document.getText())
    ) return;
    publications.set(documentKey(document), publication);
    finishPendingCanvasSelection(document, publication);
    refreshContext();
  };

  const handleCanvasAuthoritativeDocumentReady = (document: vscode.TextDocument, documentVersion: number): void => {
    if (documentVersion !== document.version) return;
    refreshContext();
  };

  const handleDocumentChange = (document: vscode.TextDocument): void => {
    publications.delete(documentKey(document));
    if (pendingCanvasSelection && sameDocument(pendingCanvasSelection.document, document) &&
        pendingCanvasSelection.documentVersion !== document.version) {
      pendingCanvasSelection = null;
    }
    refreshContext();
  };

  const handleDocumentClose = (document: vscode.TextDocument): void => {
    publications.delete(documentKey(document));
    if (pendingCanvasSelection && sameDocument(pendingCanvasSelection.document, document)) pendingCanvasSelection = null;
    refreshContext();
  };

  const command = vscode.commands.registerCommand(VSCODE_INLINE_MODULE_INSTANCE_COMMAND_ID, () => {
    void execute();
  });
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(() => refreshContext());
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === activeSourceEditor()) refreshContext();
  });
  const tabGroups = vscode.window.tabGroups as typeof vscode.window.tabGroups & {
    onDidChangeTabs?: (listener: () => void) => vscode.Disposable;
    onDidChangeTabGroups?: (listener: () => void) => vscode.Disposable;
  };
  const tabListeners = [
    tabGroups.onDidChangeTabs?.(() => refreshContext()),
    tabGroups.onDidChangeTabGroups?.(() => refreshContext())
  ].filter((listener): listener is vscode.Disposable => listener !== undefined);
  const disposable = vscode.Disposable.from(
    command,
    activeEditorListener,
    selectionListener,
    ...tabListeners,
    { dispose: () => {
      disposed = true;
      publications.clear();
      pendingCanvasSelection = null;
      setContexts(false, false);
    } }
  ) as VscodeInlineModuleCommandFeature;
  disposable.handleCanvasTargetsPublication = handleCanvasTargetsPublication;
  disposable.handleCanvasAuthoritativeDocumentReady = handleCanvasAuthoritativeDocumentReady;
  disposable.handleDocumentChange = handleDocumentChange;
  disposable.handleDocumentClose = handleDocumentClose;
  refreshContext();
  return disposable;
};
