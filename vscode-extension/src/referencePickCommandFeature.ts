import { projectReferencePickGraphSnapshot } from "../../src/vscode/referencePickGraphSnapshot";
import { projectVscodeMultiDocumentCanvasRuntime } from "../../src/vscode/multiDocumentRuntimeTransport";
import {
  outputPreviewRequiresGraph,
  sameOutputPreviewGraphAuthority,
  type VscodeOutputPreviewGraphAuthority
} from "../../src/vscode/multiDocumentGraphTransport";
import { evaluatePreparedRust, type RustEvaluationTransport } from "../../src/geometry/rustEvaluationRunner";
import * as vscode from "vscode";
import {
  projectDslRevealRuntimeStatementOwner,
  queryDslCanvasSourceTarget,
  queryDslCanvasRevealSourceTarget,
  type CompiledDslDocument,
  type DslRevealRuntimeStatementOwnerProjection
} from "@nuinuicad/nui-language";
import {
  isDslOutputPreviewRevealSourceTargetStructurallyAvailable,
  queryDslOutputPreviewRevealSourceTarget,
  type DslOutputPreviewRevealSourceQueryResult,
  type DslOutputPreviewRevealSourceTarget
} from "@nuinuicad/nui-language";
import {
  queryDslReferencePickTarget,
  queryDslReferencePickTargetResolution,
  type DslReferencePickTarget,
  type DslReferencePickTargetResolution
} from "@nuinuicad/nui-language";
import type { CanonicalGeometrySourceReference } from "../../src/model/moduleSemanticCandidateBoundary";
import type {
  VscodeReferencePickResult,
  VscodeReferencePickNumericPropertyDraft,
  VscodeReferencePickTargetProof
} from "../../src/vscode/referencePickProtocol";
import {
  referencePickNumericPropertyDraftFor,
  referencePickSeedReferences,
  referencePickTargetProofFor
} from "../../src/vscode/referencePickProtocol";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import {
  activeVscodeMultiDocumentHost,
  canonicalVscodeDocumentId,
  type VscodeMultiDocumentDiagnosticSnapshot,
  type VscodeMultiDocumentLanguageSemanticSnapshot
} from "./multiDocumentHost";
import { referencePickTranslatorFor } from "./referencePickLocalization";
import {
  createVscodeReferencePickSourceBridge,
  type VscodeReferencePickAppliedHandoff,
  type VscodeReferencePickSourceBridge
} from "./referencePickSourceBridge";
import { normalizedOffsetFromRaw, normalizedSourceFor } from "./sourceOffsetAdapter";
import { nativeShowQuickPick } from "./nativeQuickInput";

export const VSCODE_REFERENCE_PICK_COMMAND_ID = "nuinuiCAD.pickReferenceFromCanvas";
export const VSCODE_REFERENCE_PICK_CONTEXT_KEY = "nuinuiCAD.referencePickSourceTarget";
export const VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.revealInCanvasSourceTarget";
export const VSCODE_REVEAL_IN_OUTPUT_PREVIEW_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.revealInOutputPreviewSourceTarget";
export const VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY = "nuinuiCAD.bakeSourceTarget";

const vscodeDisplayLanguage = (): string => {
  try {
    return vscode.env?.language ?? "en";
  } catch {
    return "en";
  }
};

const referencePickStartRejectedMessageFor = (displayLanguage: string): string =>
  displayLanguage.toLowerCase().startsWith("ja")
    ? "nuinuiCAD: Source と Canvas の参照先を確認できず、Pick を開始できませんでした。"
    : "nuinuiCAD: Pick could not start because the current Source and Canvas reference could not be verified.";

export type VscodeReferencePickCanvasEndpoint = {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  isAuthoritativeReady: () => boolean;
};

type ReferencePickTargetQuickPickItem = vscode.QuickPickItem & {
  target: DslReferencePickTarget;
};

type ActiveReferencePick = {
  editor: vscode.TextEditor;
  sourceSelection: vscode.Selection;
  normalizedSourceOffset: number;
  documentVersion: number;
  requestId: number;
  endpoint: VscodeReferencePickCanvasEndpoint;
  bridge: VscodeReferencePickSourceBridge | null;
  starting?: boolean;
  graphSemantic?: VscodeMultiDocumentLanguageSemanticSnapshot;
  graphPickResult?: import("../../src/vscode/referencePickProtocol").VscodeReferencePickStartedResult;
  initialDraftReferences?: readonly CanonicalGeometrySourceReference[];
  initialNumericPropertyDraft?: VscodeReferencePickNumericPropertyDraft;
  preserveSourceFocus?: true;
  expectedTargetProof?: VscodeReferencePickTargetProof;
  browse?: true;
  webviewDisposable: vscode.Disposable;
  panelDisposable: vscode.Disposable;
};

type ReferencePickHistoryHandoff = VscodeReferencePickAppliedHandoff & {
  editor: vscode.TextEditor;
  endpoint: VscodeReferencePickCanvasEndpoint;
  state: "confirmed" | "restored";
};

export type VscodeSourceTargetAvailability = {
  referencePickSourceOffset: number | null;
  revealInCanvas: boolean;
  revealInOutputPreview: boolean;
  bake: boolean;
};

export type VscodeCanvasRevealSourceTarget = {
  target: import("@nuinuicad/nui-language").DslCanvasRevealSourceTarget;
  documentVersion: number;
  normalizedSourceOffset: number;
  sourceRevision: number;
  graphRevision: number | null;
  runtimeProjection?: DslRevealRuntimeStatementOwnerProjection;
};

export type VscodeCanvasRevealSourceTargetResult =
  | { status: "resolved"; value: VscodeCanvasRevealSourceTarget }
  | {
      status: "failed";
      reason: import("@nuinuicad/nui-language").DslCanvasRevealFailureReason | "analysis-unavailable";
    };

const unavailableSourceTargets = (): VscodeSourceTargetAvailability => ({
  referencePickSourceOffset: null,
  revealInCanvas: false,
  revealInOutputPreview: false,
  bake: false
});

type ReferencePickEditorState = {
  rawSource: string;
  source: { normalizedSource: string; sourceRevision: number };
  semantic: ReturnType<typeof currentCompiledSemanticSnapshotFor>;
  normalizedSourceOffset: number;
};

type ResolvedReferencePickEditorState = ReferencePickEditorState & {
  resolution: DslReferencePickTargetResolution;
};

const isSupportedSourceEditor = (editor: vscode.TextEditor | undefined): editor is vscode.TextEditor =>
  Boolean(editor) &&
  editor!.document.uri.scheme === "file" &&
  editor!.document.fileName.endsWith(".nui");

const sameDocument = (left: vscode.TextDocument, right: vscode.TextDocument): boolean =>
  left === right || left.uri.toString() === right.uri.toString();

const selectionSignatureFor = (editor: vscode.TextEditor): string => {
  const selections = editor.selections?.length ? editor.selections : [editor.selection];
  return JSON.stringify(selections.map((selection) => {
    const anchor = selection.anchor ?? selection.active;
    const positionKey = (position: vscode.Position) =>
      Number.isInteger(position.line) && Number.isInteger(position.character)
        ? [position.line, position.character]
        : "offset" in position
          ? [position.offset]
          : [position.line, position.character];
    return [positionKey(anchor), positionKey(selection.active)];
  }));
};

const referencePickEditorStateFor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): ReferencePickEditorState | null => {
  if (!isSupportedSourceEditor(editor)) return null;
  const rawSource = editor.document.getText();
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
  const normalizedSourceOffset = normalizedOffsetFromRaw(
    rawSource,
    editor.document.offsetAt(editor.selection.active)
  );
  return {
    rawSource,
    source,
    semantic,
    normalizedSourceOffset
  };
};

const referencePickTargetStateFor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): ResolvedReferencePickEditorState | null => {
  const state = referencePickEditorStateFor(editor, languageAnalysisSession);
  return state
    ? {
        ...state,
        resolution: state.semantic?.compiled
          ? queryDslReferencePickTargetResolution({
              source: state.source,
              position: state.normalizedSourceOffset,
              semantic: state.semantic
            })
          : { kind: "none" }
      }
    : null;
};

const referencePickQuickPickItemsFor = (
  source: string,
  targets: readonly DslReferencePickTarget[],
  displayLanguage: string
): readonly ReferencePickTargetQuickPickItem[] => {
  const translate = referencePickTranslatorFor(displayLanguage);
  const rows = [...targets]
    .map((target, index) => ({ target, index }))
    .sort((left, right) => left.target.range.from - right.target.range.from ||
      left.target.range.to - right.target.range.to || left.index - right.index)
    .map(({ target }) => {
    const value = source.slice(target.range.from, target.range.to);
    const activation = source.slice(
      (target.activationRange ?? target.range).from,
      (target.activationRange ?? target.range).to
    ).trim();
    return {
      label: value || translate("referencePick.emptyTarget"),
      description: `${target.role} · ${target.expectedGeometryInterface}`,
      detail: activation,
      target
    };
  });
  const collisions = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = JSON.stringify([row.label, row.description, row.detail]);
    const indexes = collisions.get(key) ?? [];
    indexes.push(index);
    collisions.set(key, indexes);
  });
  return rows.map((row, index) => {
    const indexes = collisions.get(JSON.stringify([row.label, row.description, row.detail]));
    if (!indexes || indexes.length < 2) return row;
    const ordinal = indexes.indexOf(index) + 1;
    return { ...row, description: `${row.description} ${ordinal}/${indexes.length}` };
  });
};

const targetSourceStatementIndex = (
  target: import("@nuinuicad/nui-language").DslCanvasRevealSourceTarget
): number => target.kind === "semantic"
  ? target.semantic.sourceStatementIndex
  : target.sourceStatementIndex;

/**
 * Imported Module callers are the only Reveal targets that require the
 * graph-published runtime universe. Ordinary root elements and same-document
 * local Module callers continue through the local Canvas path.
 */
const requiresMultiDocumentRuntime = (
  compiled: NonNullable<ReturnType<typeof currentCompiledSemanticSnapshotFor>>["compiled"],
  target: import("@nuinuicad/nui-language").DslCanvasRevealSourceTarget,
  rootDocumentId: string
): boolean => [...(compiled.moduleMaterialization?.executionStatements ?? [])].some((entry) => {
  if (entry.sourceStatementIndex !== targetSourceStatementIndex(target)) return false;
  const origin = entry.origin;
  return Boolean(
    (origin?.sourceDocumentId !== undefined && String(origin.sourceDocumentId) !== rootDocumentId) ||
    (origin?.moduleDefinitionDocumentId !== undefined && String(origin.moduleDefinitionDocumentId) !== rootDocumentId)
  );
});

type EditorRevealQueryState = ReferencePickEditorState;

const editorRevealQueryStateFor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): EditorRevealQueryState | null => {
  return referencePickEditorStateFor(editor, languageAnalysisSession);
};

const localRevealSourceTargetFromState = (
  editor: vscode.TextEditor,
  state: EditorRevealQueryState | null
): VscodeCanvasRevealSourceTargetResult => {
  if (!state || !state.semantic?.compiled?.statementMap) {
    return { status: "failed", reason: "analysis-unavailable" };
  }
  const result = queryDslCanvasRevealSourceTarget({
    source: state.source,
    compiled: state.semantic.compiled,
    position: state.normalizedSourceOffset
  });
  return result.status === "resolved"
    ? {
        status: "resolved",
        value: {
          target: result.target,
          documentVersion: editor.document.version,
          normalizedSourceOffset: state.normalizedSourceOffset,
          sourceRevision: state.source.sourceRevision,
          graphRevision: null
        }
      }
    : result;
};

export const localRevealSourceTargetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeCanvasRevealSourceTargetResult =>
  localRevealSourceTargetFromState(editor, editorRevealQueryStateFor(editor, languageAnalysisSession));

const localRevealRequiresMultiDocumentRuntime = (
  editor: vscode.TextEditor,
  state: EditorRevealQueryState | null,
  result: VscodeCanvasRevealSourceTargetResult
): boolean => {
  if (result.status !== "resolved") return false;
  return Boolean(
    state?.semantic?.compiled &&
    requiresMultiDocumentRuntime(
      state.semantic.compiled,
      result.value.target,
      editor.document.uri.toString()
    )
  );
};

type ImportedModuleInstanceSourceRange = { from: number; to: number };

const importedModuleInstanceRangesByCompiled = new WeakMap<
  CompiledDslDocument,
  readonly ImportedModuleInstanceSourceRange[]
>();

const importedModuleInstanceRangesFor = (
  compiled: CompiledDslDocument
): readonly ImportedModuleInstanceSourceRange[] => {
  const existing = importedModuleInstanceRangesByCompiled.get(compiled);
  if (existing) return existing;
  const ranges = compiled.statements.flatMap((statement) =>
    statement.kind === "moduleInstance" && statement.moduleName.includes("::")
      ? [{ from: statement.documentRange.from, to: statement.documentRange.to }]
      : []
  );
  importedModuleInstanceRangesByCompiled.set(compiled, ranges);
  return ranges;
};

const currentImportedModuleInstanceFor = (
  state: ReferencePickEditorState | null
): boolean => {
  const compiled = state?.semantic?.compiled;
  if (!compiled) return false;
  return importedModuleInstanceRangesFor(compiled).some((range) =>
    state.normalizedSourceOffset >= range.from &&
    state.normalizedSourceOffset <= range.to
  );
};

const graphSemanticSnapshotFor = async (
  document: vscode.TextDocument
): Promise<VscodeMultiDocumentLanguageSemanticSnapshot | null> => {
  const host = activeVscodeMultiDocumentHost();
  if (!host || typeof host.languageSemanticSnapshotFor !== "function") return null;
  return host.languageSemanticSnapshotFor(document);
};

/** Resolve Reveal once from the exact graph snapshot when the target is an
 * imported Module caller, while retaining the established local path for all
 * other targets. */
export const revealInCanvasSourceTargetForEditor = async (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): Promise<VscodeCanvasRevealSourceTargetResult> => {
  const state = editorRevealQueryStateFor(editor, languageAnalysisSession);
  const local = localRevealSourceTargetFromState(editor, state);
  if (!state) return local;
  const document = editor.document;
  const capturedVersion = editor.document.version;
  const capturedRawSource = state.rawSource;
  const capturedOffset = state.normalizedSourceOffset;
  const capturedSelection = selectionSignatureFor(editor);
  const wasActiveEditor = vscode.window.activeTextEditor === editor;
  const localRequiresGraph = localRevealRequiresMultiDocumentRuntime(
    editor,
    state,
    local
  );
  const graphSemantic = await graphSemanticSnapshotFor(editor.document);
  if (
    editor.document !== document ||
    editor.document.version !== capturedVersion ||
    editor.document.getText() !== capturedRawSource ||
    selectionSignatureFor(editor) !== capturedSelection ||
    (wasActiveEditor && vscode.window.activeTextEditor !== editor) ||
    normalizedOffsetFromRaw(
      editor.document.getText(),
      editor.document.offsetAt(editor.selection.active)
    ) !== capturedOffset
  ) return { status: "failed", reason: "source-mismatch" };

  if (
    graphSemantic &&
    graphSemantic.documentVersion === capturedVersion &&
    graphSemantic.sourceText === state.source.normalizedSource &&
    graphSemantic.compiled.spans.sourceMap.source === graphSemantic.sourceText &&
    graphSemantic.compiled.spans.sourceMap.sourceRevision === graphSemantic.sourceRevision &&
    graphSemantic.compiled.statementMap
  ) {
    const graphTarget = queryDslCanvasRevealSourceTarget({
      source: {
        normalizedSource: graphSemantic.sourceText,
        sourceRevision: graphSemantic.sourceRevision
      },
      compiled: graphSemantic.compiled,
      position: capturedOffset
    });
    if (
      graphTarget.status === "resolved" &&
      requiresMultiDocumentRuntime(
        graphSemantic.compiled,
        graphTarget.target,
        graphSemantic.rootDocumentId
      )
    ) {
      return {
        status: "resolved",
        value: {
          target: graphTarget.target,
          documentVersion: capturedVersion,
          normalizedSourceOffset: capturedOffset,
          sourceRevision: graphSemantic.sourceRevision,
          graphRevision: graphSemantic.graphRevision,
          ...(graphTarget.target.kind === "statement-owner"
            ? {
                runtimeProjection: projectDslRevealRuntimeStatementOwner(
                  graphSemantic.compiled,
                  graphTarget.target.sourceStatementIndex,
                  graphSemantic.rootDocumentId
                )
              }
            : {})
        }
      };
    }
  }
  return localRequiresGraph
    ? { status: "failed", reason: graphSemantic ? "source-mismatch" : "analysis-unavailable" }
    : local;
};

export type VscodeOutputPreviewRevealSourceTargetFailureReason =
  | "analysis-unavailable"
  | "source-mismatch"
  | "invalid-position"
  | "no-target";

export type VscodeOutputPreviewRevealSourceTargetResult =
  | {
      status: "resolved";
      normalizedSourceOffset: number;
      target: DslOutputPreviewRevealSourceTarget;
      graphAuthority?: VscodeOutputPreviewGraphAuthority;
    }
  | {
      status: "failed";
      reason: VscodeOutputPreviewRevealSourceTargetFailureReason;
    };

const outputPreviewRevealSourceTargetFromSnapshot = ({
  source,
  semantic,
  normalizedSourceOffset
}: {
  source: { normalizedSource: string; sourceRevision: number };
  semantic: ReturnType<typeof currentCompiledSemanticSnapshotFor>;
  normalizedSourceOffset: number;
}): VscodeOutputPreviewRevealSourceTargetResult => {
  if (!semantic?.compiled) return { status: "failed", reason: "analysis-unavailable" };
  if (!Number.isInteger(normalizedSourceOffset) || normalizedSourceOffset < 0 || normalizedSourceOffset > source.normalizedSource.length) {
    return { status: "failed", reason: "invalid-position" };
  }
  const result: DslOutputPreviewRevealSourceQueryResult = queryDslOutputPreviewRevealSourceTarget({
    source,
    compiled: semantic.compiled,
    position: normalizedSourceOffset
  });
  return result.status === "resolved"
    ? { status: "resolved", normalizedSourceOffset, target: result.target }
    : { status: "failed", reason: result.reason };
};

export const outputPreviewGraphSnapshotFor = (document: vscode.TextDocument): VscodeMultiDocumentDiagnosticSnapshot | null => {
  const state = activeVscodeMultiDocumentHost()?.diagnosticsStateFor?.(document);
  if (state?.status !== "current" || state.owner !== "multi-document" || state.documentVersion !== document.version) return null;
  const snapshot = state.snapshot;
  const root = snapshot.graph.rootSource;
  return snapshot.documentVersion === document.version &&
    snapshot.rootGeneration === state.rootGeneration &&
    root.documentId === snapshot.graph.rootDocumentId &&
    root.documentId === canonicalVscodeDocumentId(document.uri) &&
    root.normalizedSource === normalizedSourceFor(document.getText()) ? snapshot : null;
};

const outputPreviewGraphAuthorityFromSnapshot = (
  snapshot: VscodeMultiDocumentDiagnosticSnapshot
): VscodeOutputPreviewGraphAuthority => ({
  hostDocumentUri: String(snapshot.graph.rootDocumentId),
  documentVersion: snapshot.documentVersion,
  graphRevision: snapshot.graphRevision,
  rootSourceRevision: snapshot.graph.rootSource.sourceRevision
});

export const revalidateOutputPreviewGraphAuthority = async (
  document: vscode.TextDocument,
  authority: VscodeOutputPreviewGraphAuthority
): Promise<boolean> => {
  const snapshot = outputPreviewGraphSnapshotFor(document);
  const host = activeVscodeMultiDocumentHost();
  if (!snapshot?.graph.valid || !snapshot.compiled || !host ||
    !sameOutputPreviewGraphAuthority(authority, outputPreviewGraphAuthorityFromSnapshot(snapshot))) return false;
  return host.isSavedGraphSnapshotCurrent(document, snapshot);
};

const outputPreviewRevealSourceTargetForGraph = (
  snapshot: VscodeMultiDocumentDiagnosticSnapshot | null,
  normalizedSourceOffset: number
): VscodeOutputPreviewRevealSourceTargetResult => {
  const compiled = snapshot?.compiled;
  if (!snapshot?.graph.valid || !compiled?.document || !compiled.statementMap ||
    compiled.moduleRuntimeContext?.graph !== snapshot.graph || !compiled.moduleRuntimeContext.valid) {
    return { status: "failed", reason: "analysis-unavailable" };
  }
  const root = snapshot.graph.rootSource;
  const result = outputPreviewRevealSourceTargetFromSnapshot({
    source: root,
    semantic: { compiled, sourceRevision: root.sourceRevision, sourceText: root.normalizedSource },
    normalizedSourceOffset
  });
  if (result.status === "failed") return result;
  if (!isDslOutputPreviewRevealSourceTargetStructurallyAvailable({ target: result.target, compiled })) {
    return { status: "failed", reason: "no-target" };
  }
  return { ...result, graphAuthority: outputPreviewGraphAuthorityFromSnapshot(snapshot) };
};

/**
 * Resolves the exact current Source target for Output Preview Reveal. The
 * caller supplies the existing document analysis session so this command
 * never creates a second parser, resolver, or semantic snapshot owner.
 */
export const outputPreviewRevealSourceTargetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeOutputPreviewRevealSourceTargetResult => {
  if (!isSupportedSourceEditor(editor)) return { status: "failed", reason: "no-target" };
  const rawSource = editor.document.getText();
  const normalizedSourceOffset = normalizedOffsetFromRaw(rawSource, editor.document.offsetAt(editor.selection.active));
  if (outputPreviewRequiresGraph(rawSource)) {
    return outputPreviewRevealSourceTargetForGraph(outputPreviewGraphSnapshotFor(editor.document), normalizedSourceOffset);
  }
  if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
  const source = {
    normalizedSource: normalizedSourceFor(rawSource),
    sourceRevision: languageAnalysisSession.getSourceRevision()
  };
  const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
  return outputPreviewRevealSourceTargetFromSnapshot({ source, semantic, normalizedSourceOffset });
};

const sourceTargetAvailabilityFromState = (
  state: ReferencePickEditorState | null,
  localRevealTarget: VscodeCanvasRevealSourceTargetResult,
  outputGraph: VscodeMultiDocumentDiagnosticSnapshot | null | undefined
): VscodeSourceTargetAvailability => {
  if (!state?.semantic?.compiled) return unavailableSourceTargets();
  const { source, normalizedSourceOffset, semantic } = state;
  const referencePickSourceOffset = normalizedSourceOffset;
  const revealInCanvas = localRevealTarget.status === "resolved";
  const bake = queryDslCanvasSourceTarget({
    source,
    compiled: semantic.compiled,
    position: normalizedSourceOffset
  }) !== null;
  const outputPreviewRevealTarget = outputGraph === undefined ? outputPreviewRevealSourceTargetFromSnapshot({
    source,
    semantic,
    normalizedSourceOffset
  }) : outputPreviewRevealSourceTargetForGraph(outputGraph, normalizedSourceOffset);
  const revealInOutputPreview = outputPreviewRevealTarget.status === "resolved" &&
    (outputGraph !== undefined || isDslOutputPreviewRevealSourceTargetStructurallyAvailable({
      target: outputPreviewRevealTarget.target,
      compiled: semantic.compiled
    }));
  return { referencePickSourceOffset, revealInCanvas, revealInOutputPreview, bake };
};

type LocalSourceTargetContext = {
  availability: VscodeSourceTargetAvailability;
  revealTarget: VscodeCanvasRevealSourceTargetResult;
  requiresGraph: boolean;
};

const localSourceTargetContextFor = (
  editor: vscode.TextEditor,
  state: ReferencePickEditorState | null,
  outputGraph = state && outputPreviewRequiresGraph(state.rawSource) ? outputPreviewGraphSnapshotFor(editor.document) : undefined
): LocalSourceTargetContext => {
  const revealTarget = localRevealSourceTargetFromState(editor, state);
  const requiresGraph = localRevealRequiresMultiDocumentRuntime(editor, state, revealTarget) ||
    (revealTarget.status !== "resolved" && currentImportedModuleInstanceFor(state));
  return {
    availability: sourceTargetAvailabilityFromState(state, revealTarget, outputGraph),
    revealTarget,
    requiresGraph
  };
};

export const sourceTargetAvailabilityForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): VscodeSourceTargetAvailability => {
  if (!isSupportedSourceEditor(editor)) return unavailableSourceTargets();
  return localSourceTargetContextFor(
    editor,
    referencePickEditorStateFor(editor, languageAnalysisSession)
  ).availability;
};

const sourceTargetAvailabilityWithGraphForState = async (
  editor: vscode.TextEditor,
  state: ReferencePickEditorState | null,
  local: LocalSourceTargetContext,
  isCurrent: () => boolean
): Promise<VscodeSourceTargetAvailability | null> => {
  if (!isCurrent()) return null;
  if (!state || !local.requiresGraph) return local.availability;
  const capturedVersion = editor.document.version;
  const capturedRawSource = state.rawSource;
  const capturedOffset = state.normalizedSourceOffset;
  const graphSemantic = await graphSemanticSnapshotFor(editor.document);
  if (!isCurrent()) return null;

  let graphRevealAvailable = false;
  if (
    graphSemantic &&
    graphSemantic.documentVersion === capturedVersion &&
    graphSemantic.sourceText === state.source.normalizedSource &&
    graphSemantic.compiled.spans.sourceMap.source === graphSemantic.sourceText &&
    graphSemantic.compiled.spans.sourceMap.sourceRevision === graphSemantic.sourceRevision &&
    graphSemantic.compiled.statementMap
  ) {
    const graphTarget = queryDslCanvasRevealSourceTarget({
      source: {
        normalizedSource: graphSemantic.sourceText,
        sourceRevision: graphSemantic.sourceRevision
      },
      compiled: graphSemantic.compiled,
      position: capturedOffset
    });
    graphRevealAvailable = graphTarget.status === "resolved" &&
      requiresMultiDocumentRuntime(
        graphSemantic.compiled,
        graphTarget.target,
        graphSemantic.rootDocumentId
      );
  }

  if (editor.document.version !== capturedVersion || editor.document.getText() !== capturedRawSource) return null;
  return { ...local.availability, revealInCanvas: graphRevealAvailable };
};

export const sourceTargetAvailabilityForEditorAsync = async (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): Promise<VscodeSourceTargetAvailability> => {
  if (!isSupportedSourceEditor(editor)) return unavailableSourceTargets();
  const state = referencePickEditorStateFor(editor, languageAnalysisSession);
  const local = localSourceTargetContextFor(editor, state);
  const version = editor.document.version;
  const rawSource = editor.document.getText();
  const selection = selectionSignatureFor(editor);
  const resolved = await sourceTargetAvailabilityWithGraphForState(editor, state, local, () =>
    editor.document.version === version &&
    editor.document.getText() === rawSource &&
    selectionSignatureFor(editor) === selection
  );
  return resolved ?? (local.requiresGraph
    ? { ...local.availability, revealInCanvas: false }
    : local.availability);
};

export const referencePickSourceOffsetForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): number | null => {
  const state = referencePickEditorStateFor(editor, languageAnalysisSession);
  return state ? state.normalizedSourceOffset : null;
};

export const referencePickSourceTargetResolutionForEditor = (
  editor: vscode.TextEditor,
  languageAnalysisSession: NuiLanguageAnalysisSession
): DslReferencePickTargetResolution => referencePickTargetStateFor(editor, languageAnalysisSession)?.resolution ?? { kind: "none" };

export const registerVscodeReferencePickFeature = ({
  languageAnalysisSessionFor,
  ensureCanvas,
  displayLanguageFor = vscodeDisplayLanguage,
  rustTransport
}: {
  languageAnalysisSessionFor: (document: vscode.TextDocument) => NuiLanguageAnalysisSession;
  ensureCanvas: (
    document: vscode.TextDocument
  ) => VscodeReferencePickCanvasEndpoint | null | Promise<VscodeReferencePickCanvasEndpoint | null>;
  displayLanguageFor?: () => string;
  rustTransport?: RustEvaluationTransport;
}): vscode.Disposable => {
  let nextRequestId = 1;
  let active: ActiveReferencePick | null = null;
  let historyHandoff: ReferencePickHistoryHandoff | null = null;
  let contextUpdate: Promise<void> = Promise.resolve();
  let contextRefreshRevision = 0;
  let contextUpdateScheduled = false;
  type SourceTargetContextUpdate = {
    availability: VscodeSourceTargetAvailability;
    key: string;
    isCurrent: () => boolean;
  };
  let pendingContextUpdate: SourceTargetContextUpdate | null = null;
  let inFlightContextUpdate: SourceTargetContextUpdate | null = null;
  let appliedContextKey: string | null = null;
  let lastUnsupportedContextSurface = false;
  let lastContextState: {
    editor: vscode.TextEditor;
    document: vscode.TextDocument;
    languageAnalysisSession: NuiLanguageAnalysisSession;
    documentVersion: number;
    rawSource: string;
    selectionSignature: string;
    sourceRevision: number;
    compiled: unknown;
    outputGraph: VscodeMultiDocumentDiagnosticSnapshot | null | undefined;
    local: LocalSourceTargetContext;
  } | null = null;

  const setSourceTargetContexts = (
    availability: VscodeSourceTargetAvailability,
    isCurrent: () => boolean = () => true
  ): void => {
    const key = JSON.stringify([
      availability.referencePickSourceOffset !== null,
      availability.revealInCanvas,
      availability.revealInOutputPreview,
      availability.bake
    ]);
    if (key === appliedContextKey && !pendingContextUpdate && !inFlightContextUpdate) return;
    pendingContextUpdate = { availability, key, isCurrent };
    scheduleContextUpdate();
  };

  const scheduleContextUpdate = (): void => {
    if (contextUpdateScheduled) return;
    contextUpdateScheduled = true;
    contextUpdate = contextUpdate.catch(() => undefined).then(async () => {
      while (pendingContextUpdate) {
        const next = pendingContextUpdate;
        pendingContextUpdate = null;
        if (!next.isCurrent() || next.key === appliedContextKey) continue;
        inFlightContextUpdate = next;
        const entries: readonly [string, boolean][] = [
          [VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY, next.availability.revealInCanvas],
          [VSCODE_REVEAL_IN_OUTPUT_PREVIEW_SOURCE_TARGET_CONTEXT_KEY, next.availability.revealInOutputPreview],
          [VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY, next.availability.bake],
          [VSCODE_REFERENCE_PICK_CONTEXT_KEY, next.availability.referencePickSourceOffset !== null]
        ];
        try {
          const results = await Promise.allSettled(entries.map(([contextKey, value]) =>
            vscode.commands.executeCommand("setContext", contextKey, value)
          ));
          appliedContextKey = results.every((result) => result.status === "fulfilled")
            ? next.key
            : null;
        } finally {
          inFlightContextUpdate = null;
        }
      }
    }).finally(() => {
      contextUpdateScheduled = false;
      if (pendingContextUpdate) scheduleContextUpdate();
    });
  };

  const refreshContext = (editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor): void => {
    if (!isSupportedSourceEditor(editor)) {
      if (!lastContextState && lastUnsupportedContextSurface) return;
      lastContextState = null;
      lastUnsupportedContextSurface = true;
      const refreshRevision = ++contextRefreshRevision;
      setSourceTargetContexts(unavailableSourceTargets(), () =>
        refreshRevision === contextRefreshRevision && vscode.window.activeTextEditor === editor
      );
      return;
    }
    const languageAnalysisSession = languageAnalysisSessionFor(editor.document);
    const state = referencePickEditorStateFor(editor, languageAnalysisSession);
    if (!state) return;
    const expectedDocument = editor.document;
    const expectedVersion = expectedDocument.version;
    const expectedSource = state.rawSource;
    const expectedSelection = selectionSignatureFor(editor);
    const compiled = state.semantic?.compiled ?? null;
    const outputGraph = outputPreviewRequiresGraph(expectedSource) ? outputPreviewGraphSnapshotFor(expectedDocument) : undefined;
    const previous = lastContextState;
    if (previous &&
      previous.editor === editor &&
      previous.document === expectedDocument &&
      previous.languageAnalysisSession === languageAnalysisSession &&
      previous.documentVersion === expectedVersion &&
      previous.rawSource === expectedSource &&
      previous.selectionSignature === expectedSelection &&
      previous.sourceRevision === state.source.sourceRevision &&
      previous.compiled === compiled &&
      previous.outputGraph === outputGraph) return;

    lastUnsupportedContextSurface = false;
    const local = localSourceTargetContextFor(editor, state, outputGraph);
    const refreshRevision = ++contextRefreshRevision;
    const contextIsCurrent = (): boolean =>
      refreshRevision === contextRefreshRevision &&
      vscode.window.activeTextEditor === editor &&
      editor.document === expectedDocument &&
      editor.document.version === expectedVersion &&
      editor.document.getText() === expectedSource &&
      selectionSignatureFor(editor) === expectedSelection &&
      (outputGraph === undefined || outputPreviewGraphSnapshotFor(expectedDocument) === outputGraph);
    lastContextState = {
      editor,
      document: expectedDocument,
      languageAnalysisSession,
      documentVersion: expectedVersion,
      rawSource: expectedSource,
      selectionSignature: expectedSelection,
      sourceRevision: state.source.sourceRevision,
      compiled,
      outputGraph,
      local
    };
    const host = activeVscodeMultiDocumentHost();
    const initialAvailability = local.requiresGraph
      ? { ...local.availability, revealInCanvas: false }
      : local.availability;
    setSourceTargetContexts(initialAvailability, contextIsCurrent);
    if (!host || !local.requiresGraph) return;
    void sourceTargetAvailabilityWithGraphForState(editor, state, local, contextIsCurrent).then((availability) => {
      if (availability && contextIsCurrent()) setSourceTargetContexts(availability, contextIsCurrent);
    }).catch(() => {
      if (contextIsCurrent()) setSourceTargetContexts(initialAvailability, contextIsCurrent);
    });
  };

  const clearActive = (disposeBridge: boolean): void => {
    const current = active;
    if (!current) return;
    active = null;
    current.webviewDisposable.dispose();
    current.panelDisposable.dispose();
    if (disposeBridge) current.bridge?.dispose();
  };

  const clearHistoryHandoff = (): void => {
    historyHandoff = null;
  };

  const cancelActive = (): void => {
    const current = active;
    if (!current) return;
    current.bridge?.cancel();
    clearActive(false);
  };

  const tryStartActive = async (): Promise<void> => {
    const current = active;
    if (!current || current.bridge || current.starting || !current.endpoint.isAuthoritativeReady()) return;
    if (
      current.editor.document.version !== current.documentVersion ||
      !sameDocument(current.editor.document, current.endpoint.document)
    ) {
      clearActive(false);
      return;
    }
    current.starting = true;
    const capturedSource = current.editor.document.getText();
    const graphSemantic = activeVscodeMultiDocumentHost() ? await graphSemanticSnapshotFor(current.editor.document) : null;
    current.starting = false;
    if (active !== current || current.editor.document.version !== current.documentVersion ||
      current.editor.document.getText() !== capturedSource || !current.endpoint.isAuthoritativeReady()) return;
    current.graphSemantic = graphSemantic ?? undefined;
    const currentSession = languageAnalysisSessionFor(current.editor.document);
    const rawSource = current.editor.document.getText();
    if (currentSession.getSource() !== rawSource) currentSession.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: currentSession.getSourceRevision()
    };
    const semantic = graphSemantic ?? currentCompiledSemanticSnapshotFor(currentSession, source);
    if (graphSemantic) source.sourceRevision = graphSemantic.sourceRevision;
    const freshTarget = semantic?.compiled
      ? queryDslReferencePickTarget({
          source,
          position: current.normalizedSourceOffset,
          semantic
        })
      : null;
    if (!freshTarget && !current.browse) {
      clearActive(false);
      refreshContext(current.editor);
      return;
    }

    const bridge = createVscodeReferencePickSourceBridge({
      editor: current.editor,
      languageAnalysisSession: languageAnalysisSessionFor(current.editor.document),
      requestId: current.requestId,
      ...(current.browse ? { browse: true } : {}),
      normalizedSourceOffset: current.normalizedSourceOffset,
      ...(current.initialDraftReferences !== undefined
        ? { initialDraftReferences: current.initialDraftReferences }
        : {}),
      ...(current.initialNumericPropertyDraft
        ? { initialNumericPropertyDraft: current.initialNumericPropertyDraft }
        : {}),
      ...(current.preserveSourceFocus ? { preserveSourceFocus: true } : {}),
      ...(current.expectedTargetProof ? { expectedTargetProof: current.expectedTargetProof } : {}),
      ...(graphSemantic ? {
        semanticSnapshot: graphSemantic,
        validateSemanticSnapshot: async () => {
          const latest = await graphSemanticSnapshotFor(current.editor.document);
          return active === current && latest !== null && latest.compiled === graphSemantic.compiled &&
            latest.sourceDocumentUri === graphSemantic.sourceDocumentUri &&
            latest.rootDocumentId === graphSemantic.rootDocumentId &&
            latest.graphRevision === graphSemantic.graphRevision && latest.documentVersion === current.documentVersion;
        }
      } : {}),
      postMessage: (message) => {
        if (message.type !== "referencePickStartRequest" || !graphSemantic) return current.endpoint.panel.webview.postMessage(message);
        const runtimeContext = graphSemantic.compiled.moduleRuntimeContext;
        const runtime = runtimeContext && projectVscodeMultiDocumentCanvasRuntime({
          graph: runtimeContext.graph, compiled: graphSemantic.compiled, graphRevision: graphSemantic.graphRevision
        });
        if (!runtime) return current.endpoint.panel.webview.postMessage(message);
        void (async () => {
          if (!rustTransport) throw new Error("Graph runtime transport unavailable");
          const evaluation = await evaluatePreparedRust(runtime.preparedRustEvaluation, rustTransport);
          const latest = await graphSemanticSnapshotFor(current.editor.document);
          if (active !== current) return;
          if (!latest || latest.compiled !== graphSemantic.compiled || latest.sourceDocumentUri !== graphSemantic.sourceDocumentUri ||
            latest.rootDocumentId !== graphSemantic.rootDocumentId || latest.graphRevision !== graphSemantic.graphRevision ||
            latest.documentVersion !== current.documentVersion || current.editor.document.getText() !== capturedSource) {
            throw new Error("Graph Pick authority changed during preparation");
          }
          const graphSnapshot = projectReferencePickGraphSnapshot({ request: message, semantic: graphSemantic, evaluation });
          if (!graphSnapshot) throw new Error("Graph Pick projection unavailable");
          current.graphPickResult = graphSnapshot.result;
          await current.endpoint.panel.webview.postMessage({ ...message, graphSnapshot });
        })().catch(() => {
          if (active !== current) return;
          cancelActive();
          void vscode.window.showErrorMessage(referencePickTranslatorFor(displayLanguageFor())("referencePick.candidateUnavailable"));
        });
      }
    });
    current.bridge = bridge;
    if (!bridge.start()) {
      clearActive(true);
      clearHistoryHandoff();
      void vscode.window.showErrorMessage(referencePickStartRejectedMessageFor(displayLanguageFor()));
      refreshContext(current.editor);
    }
  };

  const attachActive = (current: ActiveReferencePick): void => {
    active = current;
    current.webviewDisposable = current.endpoint.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (active !== current || typeof message !== "object" || message === null || !("type" in message)) return;
      const typed = message as { type: string };
      if (typed.type === "webviewAuthoritativeDocumentReady") {
        void tryStartActive().catch(() => { if (active === current) cancelActive(); });
        return;
      }
      if (typed.type === "referencePickResult") {
        void handleReferencePickResult(message as VscodeReferencePickResult).catch(() => {
          if (active !== current) return;
          cancelActive();
          void vscode.window.showErrorMessage(referencePickTranslatorFor(displayLanguageFor())("referencePick.candidateUnavailable"));
        });
      }
    });
    current.panelDisposable = current.endpoint.panel.onDidDispose(() => {
      if (active === current) {
        clearActive(true);
        clearHistoryHandoff();
      }
    });
    void tryStartActive().catch(() => { if (active === current) cancelActive(); });
  };

  const handleReferencePickResult = async (result: VscodeReferencePickResult): Promise<void> => {
    const current = active;
    const bridge = current?.bridge;
    if (!current || !bridge) return;
    if (current.graphSemantic && result.status !== "canceled") {
      const latest = await graphSemanticSnapshotFor(current.editor.document);
      if (active !== current) return;
      if (!latest || latest.compiled !== current.graphSemantic.compiled || latest.sourceDocumentUri !== current.graphSemantic.sourceDocumentUri ||
        latest.rootDocumentId !== current.graphSemantic.rootDocumentId || latest.graphRevision !== current.graphSemantic.graphRevision ||
        latest.documentVersion !== current.documentVersion) {
        cancelActive();
        void vscode.window.showErrorMessage(referencePickTranslatorFor(displayLanguageFor())("referencePick.candidateUnavailable"));
        return;
      }
    }
    if (current.graphPickResult && (result.status === "started"
      ? JSON.stringify(result) !== JSON.stringify(current.graphPickResult)
      : result.status !== "canceled" && result.status !== "stale" && result.status !== "rejected" &&
        JSON.stringify(result.snapshot) !== JSON.stringify(current.graphPickResult.snapshot))) {
      cancelActive();
      return;
    }
    const outcome = await bridge.handleResult(result);
    if (active !== current) return;
    if (outcome === "started") {
      current.endpoint.panel.reveal(vscode.ViewColumn.Beside, current.preserveSourceFocus === true);
      return;
    }
    if (outcome === "ignored" || outcome === "active") return;
    if (outcome === "applied") {
      const applied = bridge.appliedHandoff();
      clearActive(false);
      if (applied) {
        historyHandoff = {
          ...applied,
          editor: current.editor,
          endpoint: current.endpoint,
          state: "confirmed"
        };
      } else {
        clearHistoryHandoff();
      }
      refreshContext(vscode.window.activeTextEditor);
      return;
    }
    if (outcome === "canceled") {
      clearActive(false);
      clearHistoryHandoff();
      try {
        await vscode.window.showTextDocument(current.editor.document, {
          viewColumn: current.editor.viewColumn,
          preserveFocus: false,
          preview: false,
          selection: current.sourceSelection
        });
      } catch {
        // Pick cancellation is already complete. Focus restoration is best effort.
      }
      refreshContext(vscode.window.activeTextEditor);
      return;
    }
    if (outcome === "rejected") {
      clearActive(false);
      clearHistoryHandoff();
      void vscode.window.showErrorMessage(
        referencePickTranslatorFor(displayLanguageFor())("referencePick.candidateUnavailable")
      );
      refreshContext(vscode.window.activeTextEditor);
      return;
    }
    clearActive(false);
    clearHistoryHandoff();
    const unchangedGraphSource = current.graphSemantic && current.editor.document.version === current.documentVersion &&
      normalizedSourceFor(current.editor.document.getText()) === current.graphSemantic.sourceText;
    void vscode.window.showErrorMessage(referencePickTranslatorFor(displayLanguageFor())(
      unchangedGraphSource ? "referencePick.candidateUnavailable" : "referencePick.sourceChanged"
    ));
    refreshContext(vscode.window.activeTextEditor);
  };

  const startRestoredReferencePick = (handoff: ReferencePickHistoryHandoff): void => {
    if (historyHandoff !== handoff || active) return;
    if (
      !isSupportedSourceEditor(handoff.editor) ||
      !sameDocument(handoff.editor.document, handoff.endpoint.document) ||
      handoff.editor.document.getText() !== handoff.preConfirmSource
    ) {
      clearHistoryHandoff();
      return;
    }

    const documentVersion = handoff.editor.document.version;
    const sourceSelection = handoff.editor.selection;
    const current: ActiveReferencePick = {
      editor: handoff.editor,
      sourceSelection,
      normalizedSourceOffset: handoff.normalizedSourceOffset,
      documentVersion,
      requestId: nextRequestId++,
      endpoint: handoff.endpoint,
      bridge: null,
      ...(handoff.numericProperty ? {} : { initialDraftReferences: handoff.references }),
      ...(handoff.numericProperty ? { initialNumericPropertyDraft: handoff.numericProperty } : {}),
      preserveSourceFocus: true,
      expectedTargetProof: handoff.targetProof,
      webviewDisposable: { dispose: () => undefined },
      panelDisposable: { dispose: () => undefined }
    };
    handoff.endpoint.panel.reveal(vscode.ViewColumn.Beside, true);
    attachActive(current);
  };

  const command = vscode.commands.registerCommand(VSCODE_REFERENCE_PICK_COMMAND_ID, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!isSupportedSourceEditor(editor)) return;
    const languageAnalysisSession = languageAnalysisSessionFor(editor.document);
    const captured = referencePickTargetStateFor(editor, languageAnalysisSession);
    if (!captured) {
      refreshContext(editor);
      void vscode.window.showErrorMessage(
        referencePickTranslatorFor(displayLanguageFor())("referencePick.noTarget")
      );
      return;
    }

    const document = editor.document;
    const documentVersion = document.version;
    const capturedSource = captured.rawSource;
    const capturedSelection = selectionSignatureFor(editor);
    const graphSemantic = await graphSemanticSnapshotFor(document);
    if (document.version !== documentVersion || document.getText() !== capturedSource ||
      selectionSignatureFor(editor) !== capturedSelection || vscode.window.activeTextEditor !== editor) return;
    if (graphSemantic) {
      captured.source = { normalizedSource: graphSemantic.sourceText, sourceRevision: graphSemantic.sourceRevision };
      captured.resolution = queryDslReferencePickTargetResolution({ source: captured.source, position: captured.normalizedSourceOffset, semantic: graphSemantic });
    }
    const displayLanguage = displayLanguageFor();
    let selectedTarget: DslReferencePickTarget | null = captured.resolution.kind === "target"
      ? captured.resolution.target
      : null;
    if (captured.resolution.kind === "ambiguous") {
      const selected = await nativeShowQuickPick(
        referencePickQuickPickItemsFor(
          captured.source.normalizedSource,
          captured.resolution.targets,
          displayLanguage
        ),
        {
          placeHolder: referencePickTranslatorFor(displayLanguage)("referencePick.targetPickerPlaceholder"),
          matchOnDescription: true,
          matchOnDetail: true
        }
      );
      // Dismissing target choice keeps Browse available; never choose a range implicitly.
      if (
        vscode.window.activeTextEditor !== editor ||
        document.version !== documentVersion ||
        document.getText() !== capturedSource ||
        selectionSignatureFor(editor) !== capturedSelection
      ) return;
      selectedTarget = selected?.target ?? null;
    }
    const targetProof = selectedTarget ? referencePickTargetProofFor(captured.source.normalizedSource, selectedTarget) : null;
    const seedReferences = !targetProof || selectedTarget?.role === "numericPropertyBase"
      ? []
      : referencePickSeedReferences(targetProof);
    if (!seedReferences) return;
    const initialNumericPropertyDraft = targetProof ? referencePickNumericPropertyDraftFor(targetProof) : null;

    cancelActive();
    clearHistoryHandoff();
    const sourceSelection = editor.selection;
    const endpoint = await ensureCanvas(editor.document);
    if (!endpoint) {
      void vscode.window.showErrorMessage(referencePickTranslatorFor(displayLanguage)("referencePick.canvasUnavailable"));
      return;
    }
    if (
      !endpoint ||
      editor.document.version !== documentVersion ||
      !sameDocument(editor.document, endpoint.document) ||
      editor.document.getText() !== capturedSource ||
      selectionSignatureFor(editor) !== capturedSelection
    ) return;

    try {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: sourceSelection
      });
    } catch {
      return;
    }
    endpoint.panel.reveal(vscode.ViewColumn.Beside, true);

    const current: ActiveReferencePick = {
      editor,
      sourceSelection,
      normalizedSourceOffset: selectedTarget?.range.from ?? captured.normalizedSourceOffset,
      documentVersion,
      requestId: nextRequestId++,
      endpoint,
      bridge: null,
      ...(seedReferences.length > 0 ? { initialDraftReferences: seedReferences } : {}),
      ...(initialNumericPropertyDraft ? { initialNumericPropertyDraft } : {}),
      ...(targetProof ? { expectedTargetProof: targetProof } : { browse: true as const }),
      webviewDisposable: { dispose: () => undefined },
      panelDisposable: { dispose: () => undefined }
    };
    attachActive(current);
  });

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => refreshContext(editor));
  const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (event.textEditor === vscode.window.activeTextEditor) refreshContext(event.textEditor);
  });
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.contentChanges.length > 0) {
      const current = active;
      const handoff = historyHandoff;
      const sameActiveDocument = current && sameDocument(event.document, current.editor.document);
      const sameHandoffDocument = handoff && sameDocument(event.document, handoff.editor.document);

      if (sameActiveDocument && typeof current.bridge?.isApplying === "function" && current.bridge.isApplying()) {
        // The bridge owns exactly this one edit. Its freshness listener is
        // likewise suppressed while the native editor transaction is in flight.
      } else if (sameHandoffDocument && handoff) {
        const sourceText = event.document.getText();
        const isOwnConfirmChange = event.document.version === handoff.documentVersion &&
          sourceText === handoff.postConfirmSource;
        const isMatchingUndo = handoff.state === "confirmed" &&
          event.reason === vscode.TextDocumentChangeReason.Undo &&
          event.document.version > handoff.documentVersion &&
          sourceText === handoff.preConfirmSource;
        const isMatchingRedo = handoff.state === "restored" &&
          event.reason === vscode.TextDocumentChangeReason.Redo &&
          event.document.version > handoff.documentVersion &&
          sourceText === handoff.postConfirmSource;

        if (isOwnConfirmChange) {
          // The successful bridge edit may be observed after the bridge result
          // is delivered. Keep the one-step handoff eligible in that case.
        } else if (isMatchingUndo) {
          historyHandoff = { ...handoff, state: "restored" };
          startRestoredReferencePick(historyHandoff);
        } else if (isMatchingRedo) {
          cancelActive();
          clearHistoryHandoff();
        } else {
          cancelActive();
          clearHistoryHandoff();
        }
      } else if (sameActiveDocument) {
        cancelActive();
        clearHistoryHandoff();
        void vscode.window.showErrorMessage(referencePickTranslatorFor(displayLanguageFor())("referencePick.sourceChanged"));
      } else if (handoff) {
        clearHistoryHandoff();
      }
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && sameDocument(editor.document, event.document)) refreshContext(editor);
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (active && sameDocument(document, active.editor.document)) cancelActive();
    if (historyHandoff && sameDocument(document, historyHandoff.editor.document)) clearHistoryHandoff();
    refreshContext(vscode.window.activeTextEditor);
  });
  const graphListener = activeVscodeMultiDocumentHost()?.onDiagnosticsChanged?.((uri) => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() === uri) refreshContext(editor);
  });

  refreshContext();

  return vscode.Disposable.from(
    command,
    activeEditorListener,
    selectionListener,
    documentChangeListener,
    closeListener,
    ...(graphListener ? [graphListener] : []),
    {
      dispose: () => {
        contextRefreshRevision += 1;
        cancelActive();
        clearHistoryHandoff();
        setSourceTargetContexts(unavailableSourceTargets());
      }
    }
  );
};
