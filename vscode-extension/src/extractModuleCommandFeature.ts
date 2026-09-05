import * as vscode from "vscode";
import {
  planExtractModule,
  type ExtractModulePlan,
  type ExtractModulePlanResult
} from "@nuinuicad/nui-language/document";
import type { LineSplice } from "@nuinuicad/nui-language/document";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import { materializedRuntimeElementId } from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";
import type {
  VscodeCanvasObservationElementSource,
  VscodeCanvasObservationSnapshot
} from "../../src/vscode/protocol";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import {
  extractModuleCanvasExecutionRejectionMessageFor,
  extractModuleRejectionMessageFor,
  extractModuleTranslatorFor,
  type ExtractModuleCanvasExecutionRejection
} from "./extractModuleLocalization";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";

export const VSCODE_EXTRACT_MODULE_COMMAND_ID = "nuinuiCAD.extractModule";
export const VSCODE_EXTRACT_MODULE_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.extractModuleSourceTarget";
export const VSCODE_EXTRACT_MODULE_CANVAS_TARGET_CONTEXT_KEY = "nuinuiCAD.extractModuleCanvasTarget";

export type ExtractModuleCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
  observation: () => VscodeCanvasObservationSnapshot | null;
};

export type ExtractModuleCommandFeatureHost = {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  activeSourceEditor: () => vscode.TextEditor | undefined;
  sourceEditorForDocument: (document: vscode.TextDocument) => vscode.TextEditor | undefined;
  activeCanvasEndpoint: () => ExtractModuleCanvasEndpoint | null;
  navigateCanvasToSourceOffset: (
    endpoint: ExtractModuleCanvasEndpoint,
    normalizedSourceOffset: number
  ) => boolean;
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

export type VscodeExtractModuleCommandFeature = vscode.Disposable & {
  handleCanvasAuthoritativeDocumentReady: (document: vscode.TextDocument, documentVersion: number) => void;
  handleCanvasObservationPublication: (document: vscode.TextDocument) => void;
  handleDocumentChange: (document: vscode.TextDocument) => void;
  handleDocumentClose: (document: vscode.TextDocument) => void;
};

type ExactSourceState = {
  rawSource: string;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  session: NuiLanguageAnalysisSession;
};

export type ExtractModuleSourceSelection = {
  start: vscode.Position;
  end: vscode.Position;
  active: vscode.Position;
  isEmpty: boolean;
};

export type ExtractModuleSourceInvocation = ExactSourceState & {
  editor: vscode.TextEditor;
  selection: ExtractModuleSourceSelection;
  targets: readonly StatementIdentity[];
};

type PendingCanvasNavigation = {
  endpoint: ExtractModuleCanvasEndpoint;
  document: vscode.TextDocument;
  documentVersion: number;
  normalizedSource: string;
  plan: ExtractModulePlan;
};

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor => Boolean(
  editor &&
  editor.document.uri.scheme === "file" &&
  editor.document.fileName.endsWith(".nui")
);

const selectionFor = (editor: vscode.TextEditor): ExtractModuleSourceSelection => ({
  start: editor.selection.start,
  end: editor.selection.end,
  active: editor.selection.active,
  isEmpty: editor.selection.start.line === editor.selection.end.line &&
    editor.selection.start.character === editor.selection.end.character
});

const positionEquals = (left: vscode.Position, right: vscode.Position): boolean =>
  left.line === right.line && left.character === right.character;

const selectionsEqual = (
  left: ExtractModuleSourceSelection,
  right: ExtractModuleSourceSelection
): boolean => left.isEmpty === right.isEmpty &&
  positionEquals(left.start, right.start) &&
  positionEquals(left.end, right.end) &&
  positionEquals(left.active, right.active);

const sourceTargetIdsEqual = (
  left: readonly StatementIdentity[],
  right: readonly StatementIdentity[]
): boolean => left.length === right.length && left.every((target, index) => target === right[index]);

const exactSourceStateFor = (
  document: vscode.TextDocument,
  languageAnalysisSessionFor: ExtractModuleCommandFeatureHost["languageAnalysisSessionFor"]
): ExactSourceState | null => {
  const rawSource = document.getText();
  const session = languageAnalysisSessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: session.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(session, source);
  const compiled = semantic?.compiled;
  if (!compiled || !compiled.statementMap || compiled.spans.sourceMap.source !== source.normalizedSource) return null;
  return { rawSource, source, compiled, session };
};

const lineStartsFor = (source: string): readonly number[] => {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
};

const sourceRangeForStatementInfo = (
  source: string,
  starts: readonly number[],
  range: { startLine: number; endLine: number }
): { from: number; to: number } | null => {
  const from = starts[range.startLine - 1];
  if (from === undefined || range.endLine < range.startLine) return null;
  const nextLineStart = starts[range.endLine];
  const to = nextLineStart === undefined ? source.length : Math.max(from, nextLineStart - 1);
  return { from, to };
};

const authoredStatementIdsFor = (
  exact: ExactSourceState,
  start: number,
  end: number
): StatementIdentity[] => {
  const statementMap = exact.compiled.statementMap;
  if (!statementMap || start > end) return [];
  const starts = lineStartsFor(exact.source.normalizedSource);
  return statementMap.statements
    .flatMap((info): Array<{ statementId: StatementIdentity; statementIndex: number }> => {
      const statement = exact.compiled.statements[info.statementIndex];
      const statementId = statementMap.statementIdByStatementIndex?.get(info.statementIndex);
      const range = sourceRangeForStatementInfo(exact.source.normalizedSource, starts, info.range);
      if (
        !statement ||
        !statementId ||
        statement.sourceRevision !== exact.source.sourceRevision ||
        info.sourceRevision !== exact.source.sourceRevision ||
        statement.kind === "blockEnd" ||
        statement.kind === "blockElse" ||
        !range ||
        range.from >= end ||
        start >= range.to
      ) return [];
      return [{ statementId, statementIndex: info.statementIndex }];
    })
    .sort((left, right) => left.statementIndex - right.statementIndex)
    .map(({ statementId }) => statementId);
};

/** Collects every complete authored statement touched by the exact Source selection. */
export const collectExtractModuleSourceTargets = (
  editor: vscode.TextEditor | undefined,
  languageAnalysisSessionFor: ExtractModuleCommandFeatureHost["languageAnalysisSessionFor"]
): ExtractModuleSourceInvocation | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const exact = exactSourceStateFor(editor.document, languageAnalysisSessionFor);
  if (!exact) return null;
  const selection = selectionFor(editor);
  const start = normalizedOffsetFromRaw(exact.rawSource, editor.document.offsetAt(selection.start));
  const end = normalizedOffsetFromRaw(exact.rawSource, editor.document.offsetAt(selection.end));
  const targets = selection.isEmpty
    ? authoredStatementIdsFor(exact, start, start + 1)
    : authoredStatementIdsFor(exact, start, end);
  return { ...exact, editor, selection, targets };
};

const currentSourceStatementIdFor = (
  compiled: CompiledDslDocument,
  statementIndex: number
): StatementIdentity | null => {
  const statementMap = compiled.statementMap;
  const statement = compiled.statements[statementIndex];
  const statementId = statementMap?.statementIdByStatementIndex?.get(statementIndex);
  const info = statementMap?.statements[statementIndex];
  return statement && statementId && info &&
    statement.sourceRevision === statementMap.sourceRevision &&
    info.sourceRevision === statementMap.sourceRevision
    ? statementId
    : null;
};

const sameNumberPath = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const moduleInstanceTargetFor = (
  source: VscodeCanvasObservationElementSource,
  compiled: CompiledDslDocument,
  sourceSnapshot: SourceSnapshot
): { statementId: StatementIdentity; statementIndex: number } | null => {
  if (!("runtimeKind" in source) || source.runtimeKind !== "moduleInstance") return null;
  if (
    !Array.isArray(source.sourceStatementPath) ||
    source.sourceStatementPath.length === 0 ||
    source.sourceStatementPath.some((index) => !Number.isInteger(index) || index < 0) ||
    !compiled.statementMap ||
    !compiled.moduleMaterialization
  ) return null;

  const runtimeIdentity = compiled.moduleMaterialization.runtimeIdentityByElementId.get(source.runtimeElementId);
  if (
    !runtimeIdentity ||
    runtimeIdentity.kind !== "moduleInstance" ||
    materializedRuntimeElementId(runtimeIdentity.kind, runtimeIdentity.path) !== source.runtimeElementId
  ) return null;
  const currentPath = runtimeIdentity.path.map((statementId) =>
    compiled.statementMap?.statementIndexByStatementId?.get(statementId)
  );
  if (!currentPath.every((index): index is number => index !== undefined && Number.isInteger(index) && index >= 0) ||
      !sameNumberPath(currentPath as number[], source.sourceStatementPath)) return null;

  const owner = sourceOwnerForRuntimeElementId({
    statementMap: compiled.statementMap,
    moduleMaterialization: compiled.moduleMaterialization,
    moduleRuntimeContext: compiled.moduleRuntimeContext
  }, source.runtimeElementId);
  if (
    !owner ||
    owner.kind !== "moduleInstance" ||
    owner.source?.kind === "dependency-saved" ||
    owner.sourceStatementIndex !== currentPath.at(-1) ||
    owner.sourceStatementId !== compiled.statementMap.statementIdByStatementIndex?.get(owner.sourceStatementIndex)
  ) return null;
  const statement = compiled.statements[owner.sourceStatementIndex];
  const info = compiled.statementMap.statementRangeById.get(owner.sourceStatementId);
  if (
    !statement ||
    statement.kind !== "moduleInstance" ||
    statement.sourceRevision !== sourceSnapshot.sourceRevision ||
    !info ||
    info.sourceRevision !== sourceSnapshot.sourceRevision ||
    info.statementIndex !== owner.sourceStatementIndex
  ) return null;
  return { statementId: owner.sourceStatementId, statementIndex: owner.sourceStatementIndex };
};

const ordinaryTargetFor = (
  source: VscodeCanvasObservationElementSource,
  compiled: CompiledDslDocument,
  sourceSnapshot: SourceSnapshot
): { statementId: StatementIdentity; statementIndex: number } | null => {
  if ("runtimeKind" in source || !Number.isInteger(source.sourceStatementIndex) || source.sourceStatementIndex < 0) return null;
  const statementId = currentSourceStatementIdFor(compiled, source.sourceStatementIndex);
  const statement = compiled.statements[source.sourceStatementIndex];
  return statementId && statement?.sourceRevision === sourceSnapshot.sourceRevision
    ? { statementId, statementIndex: source.sourceStatementIndex }
    : null;
};

type ExtractModuleCanvasTargetProjection = {
  targets: readonly StatementIdentity[];
  executionRejection: ExtractModuleCanvasExecutionRejection | null;
};

const extractModuleCanvasTargetProjectionFor = ({
  snapshot,
  source,
  compiled
}: {
  snapshot: VscodeCanvasObservationSnapshot | null | undefined;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
}): ExtractModuleCanvasTargetProjection => {
  if (
    !snapshot ||
    snapshot.selectionSubject.kind !== "elements" ||
    snapshot.selectedElementIds.length === 0 ||
    !snapshot.selectedElementSources ||
    snapshot.documentVersion < 0 ||
    snapshot.isCurrent !== true ||
    snapshot.isStale ||
    snapshot.previewActive ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision ||
    compiled.statementMap?.sourceRevision !== source.sourceRevision
  ) return { targets: [], executionRejection: null };

  const sourcesByRuntimeElementId = new Map<string, VscodeCanvasObservationElementSource[]>();
  for (const candidate of snapshot.selectedElementSources) {
    const entries = sourcesByRuntimeElementId.get(candidate.runtimeElementId);
    if (entries) entries.push(candidate);
    else sourcesByRuntimeElementId.set(candidate.runtimeElementId, [candidate]);
  }

  const targets = new Map<StatementIdentity, number>();
  let executionRejection: ExtractModuleCanvasExecutionRejection | null = null;
  for (const runtimeElementId of snapshot.selectedElementIds) {
    const candidates = sourcesByRuntimeElementId.get(runtimeElementId);
    if (!candidates || candidates.length === 0) return { targets: [], executionRejection: null };
    const distinctCandidates = new Map(candidates.map((candidate) => [JSON.stringify(candidate), candidate] as const));
    if (distinctCandidates.size !== 1) return { targets: [], executionRejection: null };
    const candidate = distinctCandidates.values().next().value as VscodeCanvasObservationElementSource | undefined;
    if (!candidate) return { targets: [], executionRejection: null };
    if ("runtimeKind" in candidate && candidate.runtimeKind === "moduleBody") {
      executionRejection ??= "materialized-module-body-descendant";
      continue;
    }
    const target = "runtimeKind" in candidate
      ? moduleInstanceTargetFor(candidate, compiled, source)
      : ordinaryTargetFor(candidate, compiled, source);
    if (!target) return { targets: [], executionRejection: null };
    targets.set(target.statementId, target.statementIndex);
  }

  return {
    targets: [...targets.entries()]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([statementId]) => statementId),
    executionRejection
  };
};

/** Re-proves observation-owned Canvas sources against the current semantic/materialization state. */
export const collectExtractModuleCanvasTargets = ({
  snapshot,
  source,
  compiled
}: {
  snapshot: VscodeCanvasObservationSnapshot | null | undefined;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
}): readonly StatementIdentity[] => extractModuleCanvasTargetProjectionFor({ snapshot, source, compiled }).targets;

const canvasObservationFor = (
  endpoint: ExtractModuleCanvasEndpoint
): VscodeCanvasObservationSnapshot | null => {
  const snapshot = endpoint.observation();
  return snapshot &&
    snapshot.documentVersion === endpoint.document.version &&
    snapshot.isCurrent === true &&
    !snapshot.isStale &&
    !snapshot.previewActive
    ? snapshot
    : null;
};

const canvasSelectionFingerprintFor = (snapshot: VscodeCanvasObservationSnapshot): string => JSON.stringify({
  documentVersion: snapshot.documentVersion,
  selectedElementIds: snapshot.selectedElementIds,
  selectedElementSources: snapshot.selectedElementSources ?? [],
  selectionSubject: snapshot.selectionSubject
});

const planForNames = (
  exact: ExactSourceState,
  targets: readonly StatementIdentity[],
  moduleName: string,
  instanceName: string
): ExtractModulePlanResult => planExtractModule({
  source: exact.source,
  compiled: exact.compiled,
  statementIds: targets,
  moduleName,
  instanceName
});

const nameValidationFor = (
  exact: ExactSourceState,
  targets: readonly StatementIdentity[],
  name: string,
  kind: "instance" | "module",
  displayLanguage: string
): string | undefined => {
  const probe = planForNames(
    exact,
    targets,
    kind === "module" ? name : "__nuinuiCADExtractModuleNameProbe__",
    kind === "instance" ? name : "__nuinuiCADExtractModuleInstanceNameProbe__"
  );
  return probe.status === "rejected" && probe.code === "invalid-name"
    ? extractModuleRejectionMessageFor(probe, displayLanguage)
    : undefined;
};

const conflictForDeterministicModuleName = (
  exact: ExactSourceState,
  targets: readonly StatementIdentity[],
  moduleName: string,
  instanceName: string
): ExtractModulePlanResult | null => {
  const result = planForNames(exact, targets, moduleName, instanceName);
  return result.status === "rejected" && (result.code === "invalid-name" || result.code === "name-collision")
    ? result
    : null;
};

const presentPlannerRejection = (result: ExtractModulePlanResult, displayLanguage: string): void => {
  if (result.status === "rejected") {
    void vscode.window.showErrorMessage(`nuinuiCAD: ${extractModuleRejectionMessageFor(result, displayLanguage)}`);
  }
};

const generatedInstanceOffsetFor = (
  plan: ExtractModulePlan,
  exact: ExactSourceState
): number | null => {
  const namespace = exact.compiled.sourceLexicalNamespace;
  const statementMap = exact.compiled.statementMap;
  if (!namespace || !statementMap) return null;
  const matches = namespace.allDeclarations.filter((declaration) =>
    declaration.kind === "moduleInstance" &&
    declaration.scopeId === plan.targetScopeId &&
    declaration.name === plan.generatedInstance.name &&
    declaration.statement.kind === "moduleInstance" &&
    declaration.statement.moduleName === plan.generatedInstance.moduleName &&
    declaration.statement.sourceRevision === exact.source.sourceRevision &&
    statementMap.statements[declaration.statementIndex]?.range.startLine === plan.generatedInstance.startLine &&
    statementMap.statements[declaration.statementIndex]?.range.endLine === plan.generatedInstance.endLine
  );
  if (matches.length !== 1) return null;
  const statement = matches[0]!.statement;
  return statement.kind === "moduleInstance" ? statement.documentRange.from : null;
};

export const registerVscodeExtractModuleCommandFeature = ({
  languageAnalysisSessionFor,
  activeSourceEditor,
  sourceEditorForDocument,
  activeCanvasEndpoint,
  navigateCanvasToSourceOffset,
  applySourceLineSplices,
  displayLanguageFor = vscodeDisplayLanguage
}: ExtractModuleCommandFeatureHost): VscodeExtractModuleCommandFeature => {
  let disposed = false;
  let contextUpdate: Promise<void> = Promise.resolve();
  let pendingCanvasNavigation: PendingCanvasNavigation | null = null;

  const setContexts = (sourceTarget: boolean, canvasTarget: boolean): void => {
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => Promise.all([
        vscode.commands.executeCommand("setContext", VSCODE_EXTRACT_MODULE_SOURCE_TARGET_CONTEXT_KEY, sourceTarget),
        vscode.commands.executeCommand("setContext", VSCODE_EXTRACT_MODULE_CANVAS_TARGET_CONTEXT_KEY, canvasTarget)
      ]))
      .then(() => undefined);
  };

  const exactCanvasStateFor = (endpoint: ExtractModuleCanvasEndpoint): ExactSourceState | null => {
    const snapshot = canvasObservationFor(endpoint);
    const exact = exactSourceStateFor(endpoint.document, languageAnalysisSessionFor);
    return snapshot && exact ? exact : null;
  };

  const canvasTargetsFor = (endpoint: ExtractModuleCanvasEndpoint): readonly StatementIdentity[] => {
    const snapshot = canvasObservationFor(endpoint);
    const exact = snapshot ? exactSourceStateFor(endpoint.document, languageAnalysisSessionFor) : null;
    return snapshot && exact
      ? collectExtractModuleCanvasTargets({ snapshot, source: exact.source, compiled: exact.compiled })
      : [];
  };

  const refreshContext = (): void => {
    if (disposed) return;
    const sourceEditor = activeSourceEditor();
    const sourceInvocation = collectExtractModuleSourceTargets(sourceEditor, languageAnalysisSessionFor);
    if (sourceInvocation) {
      setContexts(sourceInvocation.targets.length > 0, false);
      return;
    }
    const endpoint = activeCanvasEndpoint();
    setContexts(false, endpoint ? canvasTargetsFor(endpoint).length > 0 : false);
  };

  const execute = async (): Promise<void> => {
    if (disposed) return;
    const displayLanguage = displayLanguageFor();
    const sourceInvocation = collectExtractModuleSourceTargets(activeSourceEditor(), languageAnalysisSessionFor);
    let origin: "source" | "canvas";
    let editor: vscode.TextEditor;
    let exact: ExactSourceState;
    let canvasEndpoint: ExtractModuleCanvasEndpoint | null = null;
    let capturedCanvasFingerprint: string | null = null;
    let targets: readonly StatementIdentity[];

    if (sourceInvocation) {
      if (sourceInvocation.targets.length === 0) {
        void vscode.window.showErrorMessage(
          extractModuleTranslatorFor(displayLanguage)("extractModule.source.noTarget")
        );
        return;
      }
      origin = "source";
      editor = sourceInvocation.editor;
      exact = sourceInvocation;
      targets = sourceInvocation.targets;
    } else {
      canvasEndpoint = activeCanvasEndpoint();
      const snapshot = canvasEndpoint ? canvasObservationFor(canvasEndpoint) : null;
      const canvasExact = canvasEndpoint ? exactCanvasStateFor(canvasEndpoint) : null;
      const canvasProjection = canvasEndpoint && snapshot && canvasExact
        ? extractModuleCanvasTargetProjectionFor({ snapshot, source: canvasExact.source, compiled: canvasExact.compiled })
        : null;
      const canvasTargets = canvasProjection?.targets ?? [];
      if (canvasProjection?.executionRejection) {
        void vscode.window.showErrorMessage(
          extractModuleCanvasExecutionRejectionMessageFor(canvasProjection.executionRejection, displayLanguage)
        );
        refreshContext();
        return;
      }
      if (!canvasEndpoint || !snapshot || !canvasExact || canvasTargets.length === 0) {
        void vscode.window.showErrorMessage(
          extractModuleTranslatorFor(displayLanguage)("extractModule.canvas.noTarget")
        );
        refreshContext();
        return;
      }
      editor = sourceEditorForDocument(canvasEndpoint.document) ??
        vscode.window.visibleTextEditors.find((candidate) => sameDocument(candidate.document, canvasEndpoint!.document)) ??
        await vscode.window.showTextDocument(canvasEndpoint.document, { preserveFocus: true, preview: false });
      origin = "canvas";
      exact = canvasExact;
      targets = canvasTargets;
      capturedCanvasFingerprint = canvasSelectionFingerprintFor(snapshot);
    }

    const capturedDocument = editor.document;
    const capturedVersion = capturedDocument.version;
    const capturedRawSource = capturedDocument.getText();
    const capturedSelection = origin === "source" ? selectionFor(editor) : null;
    const acceptedInstanceName = await vscode.window.showInputBox({
      title: extractModuleTranslatorFor(displayLanguage)("extractModule.input.instanceName"),
      prompt: extractModuleTranslatorFor(displayLanguage)("extractModule.input.instanceName"),
      validateInput: (value) => nameValidationFor(exact, targets, value.trim(), "instance", displayLanguage)
    });
    if (acceptedInstanceName === undefined) return;
    const instanceName = acceptedInstanceName.trim();
    const moduleCandidate = `${instanceName}Module`;
    const deterministicConflict = conflictForDeterministicModuleName(
      exact,
      targets,
      moduleCandidate,
      instanceName
    );
    if (deterministicConflict) presentPlannerRejection(deterministicConflict, displayLanguage);

    const candidateLabel = extractModuleTranslatorFor(displayLanguage)("extractModule.choice.useModuleName", {
      moduleName: moduleCandidate
    });
    const renameModuleLabel = extractModuleTranslatorFor(displayLanguage)("extractModule.choice.renameModule");
    const moduleChoice = await vscode.window.showQuickPick([
      { label: candidateLabel },
      { label: renameModuleLabel }
    ], { title: extractModuleTranslatorFor(displayLanguage)("extractModule.input.moduleName") });
    if (!moduleChoice) return;
    if (moduleChoice.label === candidateLabel && deterministicConflict) {
      presentPlannerRejection(deterministicConflict, displayLanguage);
      return;
    }
    const moduleName = moduleChoice.label === renameModuleLabel
      ? (await vscode.window.showInputBox({
          title: extractModuleTranslatorFor(displayLanguage)("extractModule.input.moduleName"),
          prompt: extractModuleTranslatorFor(displayLanguage)("extractModule.input.moduleName"),
          validateInput: (value) => nameValidationFor(exact, targets, value.trim(), "module", displayLanguage)
        }))?.trim()
      : moduleCandidate;
    if (moduleName === undefined) return;

    const currentExact = exactSourceStateFor(capturedDocument, languageAnalysisSessionFor);
    if (!currentExact) {
      void vscode.window.showErrorMessage(
        extractModuleTranslatorFor(displayLanguage)("extractModule.exactCurrent")
      );
      return;
    }
    const result = planForNames(currentExact, targets, moduleName, instanceName);
    if (result.status === "rejected") {
      presentPlannerRejection(result, displayLanguage);
      return;
    }

    const currentSourceInvocation = origin === "source"
      ? collectExtractModuleSourceTargets(activeSourceEditor(), languageAnalysisSessionFor)
      : null;
    const currentEndpoint = origin === "canvas" ? activeCanvasEndpoint() : null;
    const currentCanvasSnapshot = currentEndpoint ? canvasObservationFor(currentEndpoint) : null;
    const currentCanvasExact = currentEndpoint && currentCanvasSnapshot
      ? exactSourceStateFor(currentEndpoint.document, languageAnalysisSessionFor)
      : null;
    const currentCanvasProjection = currentEndpoint && currentCanvasSnapshot && currentCanvasExact
      ? extractModuleCanvasTargetProjectionFor({
          snapshot: currentCanvasSnapshot,
          source: currentCanvasExact.source,
          compiled: currentCanvasExact.compiled
        })
      : null;
    if (currentCanvasProjection?.executionRejection) {
      void vscode.window.showErrorMessage(
        extractModuleCanvasExecutionRejectionMessageFor(currentCanvasProjection.executionRejection, displayLanguage)
      );
      refreshContext();
      return;
    }
    const currentCanvasTargets = currentCanvasProjection?.targets ?? [];
    const stillCurrent = currentExact.rawSource === capturedRawSource &&
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
            canvasEndpoint &&
            currentEndpoint.panel === canvasEndpoint.panel &&
            sameDocument(currentEndpoint.document, canvasEndpoint.document) &&
            currentEndpoint.isAuthoritativeReady() &&
            currentCanvasSnapshot &&
            capturedCanvasFingerprint === canvasSelectionFingerprintFor(currentCanvasSnapshot) &&
            sourceTargetIdsEqual(targets, currentCanvasTargets)
          ));
    if (!stillCurrent) {
      void vscode.window.showErrorMessage(
        extractModuleTranslatorFor(displayLanguage)("extractModule.stateChanged")
      );
      refreshContext();
      return;
    }

    const applied = await applySourceLineSplices(editor, capturedVersion, capturedRawSource, result.splices);
    if (!applied) {
      void vscode.window.showErrorMessage(
        extractModuleTranslatorFor(displayLanguage)("extractModule.sourceChangedBeforeApply")
      );
      refreshContext();
      return;
    }

    if (origin === "canvas" && canvasEndpoint) {
      pendingCanvasNavigation = {
        endpoint: canvasEndpoint,
        document: capturedDocument,
        documentVersion: capturedDocument.version,
        normalizedSource: normalizedSourceFor(capturedDocument.getText()),
        plan: result
      };
      finishPendingCanvasNavigation();
    }
    void vscode.window.showInformationMessage(
      extractModuleTranslatorFor(displayLanguage)("extractModule.completed", {
        moduleName: result.moduleName,
        instanceName: result.instanceName
      })
    );
    refreshContext();
  };

  const finishPendingCanvasNavigation = (): void => {
    const pending = pendingCanvasNavigation;
    if (!pending) return;
    const endpoint = activeCanvasEndpoint();
    if (!endpoint || endpoint.panel !== pending.endpoint.panel || !sameDocument(endpoint.document, pending.document)) {
      pendingCanvasNavigation = null;
      return;
    }
    if (
      pending.document.version !== pending.documentVersion ||
      normalizedSourceFor(pending.document.getText()) !== pending.normalizedSource ||
      !endpoint.isAuthoritativeReady() ||
      !canvasObservationFor(endpoint)
    ) return;
    const exact = exactSourceStateFor(pending.document, languageAnalysisSessionFor);
    if (!exact) return;
    const offset = generatedInstanceOffsetFor(pending.plan, exact);
    if (offset === null) {
      pendingCanvasNavigation = null;
      return;
    }
    pendingCanvasNavigation = null;
    navigateCanvasToSourceOffset(endpoint, offset);
  };

  const handleCanvasAuthoritativeDocumentReady = (document: vscode.TextDocument, documentVersion: number): void => {
    if (documentVersion !== document.version) return;
    finishPendingCanvasNavigation();
    refreshContext();
  };

  const handleCanvasObservationPublication = (document: vscode.TextDocument): void => {
    if (pendingCanvasNavigation && sameDocument(pendingCanvasNavigation.document, document)) finishPendingCanvasNavigation();
    refreshContext();
  };

  const handleDocumentChange = (document: vscode.TextDocument): void => {
    if (pendingCanvasNavigation && sameDocument(pendingCanvasNavigation.document, document) &&
        pendingCanvasNavigation.documentVersion !== document.version) pendingCanvasNavigation = null;
    refreshContext();
  };

  const handleDocumentClose = (document: vscode.TextDocument): void => {
    if (pendingCanvasNavigation && sameDocument(pendingCanvasNavigation.document, document)) pendingCanvasNavigation = null;
    refreshContext();
  };

  const command = vscode.commands.registerCommand(VSCODE_EXTRACT_MODULE_COMMAND_ID, () => {
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
      pendingCanvasNavigation = null;
      setContexts(false, false);
    } }
  ) as VscodeExtractModuleCommandFeature;
  disposable.handleCanvasAuthoritativeDocumentReady = handleCanvasAuthoritativeDocumentReady;
  disposable.handleCanvasObservationPublication = handleCanvasObservationPublication;
  disposable.handleDocumentChange = handleDocumentChange;
  disposable.handleDocumentClose = handleDocumentClose;
  refreshContext();
  return disposable;
};
