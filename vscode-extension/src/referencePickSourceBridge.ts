import * as vscode from "vscode";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import {
  isCanonicalReferencePickReference,
  isValidNumericReferencePickCandidate,
  referencePickReferenceKey,
  referencePickTargetProofFor,
  referencePickSourceForReference,
  sameReferencePickTargetProof,
  type VscodeReferencePickTargetProof,
  type VscodeReferencePickSnapshotProvenance,
  type VscodeReferencePickCancelRequest,
  type VscodeReferencePickNumericCandidate,
  type VscodeReferencePickNumericPropertyDraft,
  type VscodeReferencePickResult,
  type VscodeReferencePickStartRequest
} from "../../src/vscode/referencePickProtocol";
import { planVscodeReferencePickSourceEdit, planVscodeReferencePickExplicitEdit } from "../../src/vscode/referencePickSourceEdit";
import type { CanonicalGeometrySourceReference } from "../../src/model/moduleSemanticCandidateBoundary";
import {
  currentCompiledSemanticSnapshotFor,
  type NuiLanguageAnalysisSession
} from "./languageAnalysisSession";
import {
  normalizedSourceFor,
  normalizedOffsetFromRaw,
  rawOffsetFromNormalized,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export type VscodeReferencePickSourceBridgeResult =
  | "active"
  | "started"
  | "applied"
  | "canceled"
  | "stale"
  | "rejected"
  | "ignored";

export type VscodeReferencePickAppliedHandoff = {
  documentUri: string;
  documentVersion: number;
  preConfirmSource: string;
  postConfirmSource: string;
  normalizedSourceOffset: number;
  targetProof: VscodeReferencePickTargetProof;
  references: readonly CanonicalGeometrySourceReference[];
  numericProperty?: VscodeReferencePickNumericPropertyDraft;
};

export type VscodeReferencePickSourceBridge = {
  start: () => VscodeReferencePickStartRequest | null;
  handleResult: (result: VscodeReferencePickResult) => Promise<VscodeReferencePickSourceBridgeResult>;
  cancel: () => void;
  dispose: () => void;
  activeRequest: () => VscodeReferencePickStartRequest | null;
  isApplying: () => boolean;
  appliedHandoff: () => VscodeReferencePickAppliedHandoff | null;
};

type BridgePhase = "waiting" | "active" | "confirming" | "applying" | "finished";

type BridgeState = {
  request: VscodeReferencePickStartRequest;
  phase: BridgePhase;
  allowedCandidateReferences: readonly CanonicalGeometrySourceReference[] | null;
  allowedNumericCandidates: readonly VscodeReferencePickNumericCandidate[] | null;
  sessionMode: "target-bound" | "browse";
  snapshot?: VscodeReferencePickSnapshotProvenance;
  browseReferences: readonly CanonicalGeometrySourceReference[];
  browseNumericCandidates: readonly VscodeReferencePickNumericCandidate[];
};

/** Escapes text before it is passed as literal data to the snippet engine. */
export const snippetLiteralForText = (text: string): string =>
  text.replace(/[\\$}]/g, (character) => `\\${character}`);

const sameDocumentUri = (document: vscode.TextDocument, documentUri: string): boolean =>
  document.uri.toString() === documentUri;

const isOpenDocument = (document: vscode.TextDocument): boolean =>
  vscode.workspace.textDocuments.some((candidate) => candidate === document || candidate.uri.toString() === document.uri.toString());

export const createVscodeReferencePickSourceBridge = ({
  editor,
  languageAnalysisSession,
  requestId,
  normalizedSourceOffset,
  initialDraftReferences,
  initialNumericPropertyDraft,
  preserveSourceFocus,
  expectedTargetProof,
  browse = false,
  postMessage
}: {
  editor: vscode.TextEditor;
  languageAnalysisSession: NuiLanguageAnalysisSession;
  requestId: number;
  normalizedSourceOffset: number;
  initialDraftReferences?: readonly CanonicalGeometrySourceReference[];
  initialNumericPropertyDraft?: VscodeReferencePickNumericPropertyDraft;
  preserveSourceFocus?: true;
  expectedTargetProof?: VscodeReferencePickTargetProof;
  browse?: boolean;
  postMessage: (message: VscodeReferencePickStartRequest | VscodeReferencePickCancelRequest) => unknown;
}): VscodeReferencePickSourceBridge => {
  const document = editor.document;
  const documentUri = document.uri.toString();
  let state: BridgeState | null = null;
  let changeDisposable: vscode.Disposable | null = null;
  let closeDisposable: vscode.Disposable | null = null;
  let appliedHandoff: VscodeReferencePickAppliedHandoff | null = null;

  const disposeListeners = (): void => {
    changeDisposable?.dispose();
    closeDisposable?.dispose();
    changeDisposable = null;
    closeDisposable = null;
  };

  const finish = (): void => {
    if (state) state.phase = "finished";
    disposeListeners();
  };

  const cancel = (): void => {
    const current = state;
    if (!current || current.phase === "finished") return;
    current.phase = "finished";
    postMessage({
      type: "referencePickCancelRequest",
      requestId: current.request.requestId,
      documentUri: current.request.documentUri,
      documentVersion: current.request.documentVersion
    });
    disposeListeners();
  };

  const registerFreshnessListeners = (): void => {
    changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        state?.phase === "applying" ||
        event.contentChanges.length === 0 ||
        !sameDocumentUri(event.document, documentUri)
      ) return;
      cancel();
    });
    closeDisposable = vscode.workspace.onDidCloseTextDocument((closed) => {
      if (sameDocumentUri(closed, documentUri)) cancel();
    });
  };

  const start = (): VscodeReferencePickStartRequest | null => {
    if (state && state.phase !== "finished") return null;
    if (!isOpenDocument(document) || !Number.isInteger(normalizedSourceOffset) || !documentUri.startsWith("file:") || !document.fileName.endsWith(".nui")) return null;
    const rawSource = document.getText();
    if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: languageAnalysisSession.getSourceRevision()
    };
    const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
    const target = !browse && semantic?.compiled ? queryDslReferencePickTarget({ source, position: normalizedSourceOffset, semantic }) : null;
    const targetProof = target ? referencePickTargetProofFor(source.normalizedSource, target) : null;
    if (!browse && (!targetProof || (expectedTargetProof && !sameReferencePickTargetProof(targetProof, expectedTargetProof)))) return null;

    const request: VscodeReferencePickStartRequest = {
      type: "referencePickStartRequest",
      requestId,
      documentUri,
      documentVersion: document.version,
      normalizedSourceOffset,
      mode: browse ? "browse" : "target-bound",
      initialSelection: { from: normalizedOffsetFromRaw(rawSource, document.offsetAt(editor.selection.start)), to: normalizedOffsetFromRaw(rawSource, document.offsetAt(editor.selection.end)), oldText: document.getText(editor.selection) },
      targetProof,
      ...(initialDraftReferences !== undefined ? { initialDraftReferences: [...initialDraftReferences] } : {}),
      ...(initialNumericPropertyDraft ? { initialNumericPropertyDraft } : {}),
      ...(preserveSourceFocus ? { preserveSourceFocus: true } : {})
    };
    state = {
      request,
      phase: "waiting",
      sessionMode: browse ? "browse" : "target-bound",
      allowedCandidateReferences: null,
      allowedNumericCandidates: null,
      browseReferences: [],
      browseNumericCandidates: []
    };
    registerFreshnessListeners();
    postMessage(request);
    return request;
  };

  const resultBelongsToCurrentRequest = (result: VscodeReferencePickResult): boolean => {
    const current = state?.request;
    return !!current &&
      result.requestId === current.requestId &&
      result.documentUri === current.documentUri &&
      result.documentVersion === current.documentVersion &&
      sameReferencePickTargetProof(result.targetProof, current.targetProof);
  };

  const handleResult = async (
    result: VscodeReferencePickResult
  ): Promise<VscodeReferencePickSourceBridgeResult> => {
    const current = state;
    if (!current || current.phase === "finished") return "ignored";
    if (!resultBelongsToCurrentRequest(result)) {
      if (result.requestId === current.request.requestId) cancel();
      return "ignored";
    }

    if (result.status === "started") {
      if (
        current.phase !== "waiting" ||
        !result.candidateReferences.every(isCanonicalReferencePickReference) ||
        (result.sessionMode !== "browse" && current.request.targetProof?.role === "numericPropertyBase" && (
          result.numericCandidates === undefined ||
          !result.numericCandidates.every(isValidNumericReferencePickCandidate) ||
          result.numericCandidates.some((candidate) => !result.candidateReferences.some((reference) =>
            referencePickReferenceKey(reference) === referencePickReferenceKey(candidate.reference)
          ))
        ))
      ) {
        cancel();
        return "rejected";
      }
      if (result.browseReferences && !result.browseReferences.every(isCanonicalReferencePickReference) ||
        result.browseNumericCandidates && !result.browseNumericCandidates.every(isValidNumericReferencePickCandidate)) { cancel(); return "rejected"; }
      if (current.request.mode === "browse" && result.sessionMode !== "browse") { cancel(); return "rejected"; }
      current.sessionMode = result.sessionMode ?? "target-bound";
      current.snapshot = result.snapshot;
      current.browseReferences = result.browseReferences ?? result.candidateReferences;
      current.browseNumericCandidates = result.browseNumericCandidates ?? result.numericCandidates ?? [];
      current.phase = "active";
      current.allowedCandidateReferences = [...result.candidateReferences];
      current.allowedNumericCandidates = result.numericCandidates ? [...result.numericCandidates] : null;
      return "started";
    }

    if (result.status === "copy" || result.status === "explicit-edit") {
      if (current.phase === "confirming" || current.phase === "applying") return "ignored";
      try {
      if (JSON.stringify(current.snapshot) !== JSON.stringify(result.snapshot)) return "rejected";
      if (current.phase !== "active" || !isCanonicalReferencePickReference(result.reference) ||
        !current.browseReferences.some(ref => referencePickReferenceKey(ref) === referencePickReferenceKey(result.reference)) ||
        (result.property !== undefined && (!current.browseNumericCandidates.some(c => referencePickReferenceKey(c.reference) === referencePickReferenceKey(result.reference) && c.properties.includes(result.property!)) || result.reference.pointKey !== undefined))) return "rejected";
      const canonicalText = referencePickSourceForReference(result.reference) + (result.property ? `.${result.property}` : "");
      if (result.status === "copy") { await vscode.env.clipboard.writeText(canonicalText); return "active"; }
      if (!isOpenDocument(document) || document.version !== current.request.documentVersion) { cancel(); return "stale"; }
      current.phase = "confirming";
      const beforeFocusSource = document.getText();
      const expectedVersion = document.version;
      const shown = await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, preserveFocus: false, preview: false });
      if (state !== current || current.phase !== "confirming" || !sameDocumentUri(shown.document, documentUri) ||
        document.version !== expectedVersion || document.getText() !== beforeFocusSource) return "stale";
      const range = { from: normalizedOffsetFromRaw(beforeFocusSource, document.offsetAt(shown.selection.start)), to: normalizedOffsetFromRaw(beforeFocusSource, document.offsetAt(shown.selection.end)) };
      const source = normalizedSourceFor(beforeFocusSource);
      const proof = { documentUri, documentVersion: expectedVersion, range, oldText: source.slice(range.from, range.to), replacement: canonicalText };
      const action = range.from === range.to ? "Insert" : "Replace selection";
      const start = document.positionAt(rawOffsetFromNormalized(beforeFocusSource, range.from));
      const end = document.positionAt(rawOffsetFromNormalized(beforeFocusSource, range.to));
      const confirmed = await vscode.window.showInformationMessage(
        `${action} canonical reference in ${document.fileName}\nURI: ${documentUri}\nVersion: ${expectedVersion}\nRange: ${start.line + 1}:${start.character + 1}–${end.line + 1}:${end.character + 1}\nExisting text: ${JSON.stringify(proof.oldText)}\nInsert text: ${JSON.stringify(canonicalText)}`,
        { modal: true, detail: "To choose another range, cancel, select the caret or text in this Source file, then use Insert into Source again. Semantic diagnostics remain active." }, action
      );
      if (state !== current || current.phase !== "confirming") return "stale";
      if (confirmed !== action) { current.phase = "active"; return "active"; }
      const plan = planVscodeReferencePickExplicitEdit(proof, { documentUri: shown.document.uri.toString(), documentVersion: document.version, source: normalizedSourceFor(document.getText()), canonicalText });
      if (state !== current || current.phase !== "confirming" || !isOpenDocument(document) || !plan ||
        shown.document !== document || vscode.window.activeTextEditor !== shown ||
        document.offsetAt(shown.selection.start) !== document.offsetAt(start) || document.offsetAt(shown.selection.end) !== document.offsetAt(end)) { cancel(); return "stale"; }
      current.phase = "applying";
      const editRange = vscodeRangeForNormalized(document, document.getText(), plan.range);
      // TextEditor.edit binds the native transaction to this editor/document;
      // the builder runs synchronously and VS Code checks its document version.
      const applied = await shown.edit(builder => builder.replace(editRange, plan.replacement), { undoStopBefore: true, undoStopAfter: true });
      const rawStart = rawOffsetFromNormalized(beforeFocusSource, range.from), rawEnd = rawOffsetFromNormalized(beforeFocusSource, range.to);
      const expected = beforeFocusSource.slice(0, rawStart) + canonicalText + beforeFocusSource.slice(rawEnd);
      postMessage({ type: "referencePickCancelRequest", requestId: current.request.requestId, documentUri, documentVersion: current.request.documentVersion });
      finish();
      return applied && document.getText() === expected ? "applied" : "rejected";
      } catch { cancel(); return "rejected"; }
    }

    if (result.status === "canceled" || result.status === "stale" || result.status === "rejected") {
      finish();
      return result.status;
    }
    if (
      current.phase !== "active" || current.sessionMode !== "target-bound" ||
      !current.allowedCandidateReferences ||
      (current.request.targetProof?.role === "numericPropertyBase" && !current.allowedNumericCandidates)
    ) {
      cancel();
      return "rejected";
    }
    if (!isOpenDocument(document) || document.version !== current.request.documentVersion) {
      cancel();
      return "stale";
    }

    const rawSource = document.getText();
    if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: languageAnalysisSession.getSourceRevision()
    };
    const semantic = currentCompiledSemanticSnapshotFor(languageAnalysisSession, source);
    if (!semantic?.compiled) {
      cancel();
      return "stale";
    }
    if (!current.request.targetProof) { cancel(); return "rejected"; }
    const numericProperty = result.resultKind === "numericProperty"
      ? { reference: result.reference, property: result.property }
      : undefined;
    const plan = planVscodeReferencePickSourceEdit({
      source,
      compiled: semantic.compiled,
      normalizedSourceOffset: current.request.normalizedSourceOffset,
      targetProof: current.request.targetProof,
      references: result.resultKind === "geometry" ? result.references : [],
      allowedCandidateReferences: current.allowedCandidateReferences,
      ...(numericProperty ? { numericProperty } : {}),
      ...(current.allowedNumericCandidates ? { allowedNumericCandidates: current.allowedNumericCandidates } : {})
    });
    if (!plan) {
      cancel();
      return "rejected";
    }

    current.phase = "applying";
    const preConfirmSource = rawSource;
    const editRange = vscodeRangeForNormalized(document, rawSource, plan.range);
    const rawRangeStart = rawOffsetFromNormalized(rawSource, plan.range.from);
    const rawRangeEnd = rawOffsetFromNormalized(rawSource, plan.range.to);
    const expectedPostConfirmSource = rawSource.slice(0, rawRangeStart) +
      plan.replacement +
      rawSource.slice(rawRangeEnd);
    let shownEditor: vscode.TextEditor;
    try {
      shownEditor = await vscode.window.showTextDocument(document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: editRange
      });
      if (state !== current || current.phase !== "applying") return "canceled";
      if (!sameDocumentUri(shownEditor.document, documentUri) || document.version !== current.request.documentVersion || document.getText() !== preConfirmSource || vscode.window.activeTextEditor !== shownEditor) {
        finish();
        return "rejected";
      }
      const commandResult = await vscode.commands.executeCommand<unknown>(
        "editor.action.insertSnippet",
        {
          snippet: snippetLiteralForText(plan.replacement),
          ranges: [editRange]
        }
      );
      if (commandResult === false || document.getText() !== expectedPostConfirmSource) {
        finish();
        return "rejected";
      }
    } catch {
      finish();
      return "rejected";
    }

    appliedHandoff = {
      documentUri,
      documentVersion: document.version,
      preConfirmSource,
      postConfirmSource: document.getText(),
      normalizedSourceOffset: current.request.normalizedSourceOffset,
      targetProof: current.request.targetProof,
      references: result.resultKind === "geometry" ? [...result.references] : [],
      ...(numericProperty ? { numericProperty } : {})
    };

    const rawCaretOffset = rawRangeStart + plan.caretNormalizedOffset - plan.range.from;
    const caret = document.positionAt(rawCaretOffset);
    finish();
    try {
      await vscode.window.showTextDocument(document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
        selection: new vscode.Range(caret, caret)
      });
    } catch {
      // The canonical edit already succeeded. Focus restoration is best effort
      // if the editor disappears concurrently after the applied mutation.
    }
    return "applied";
  };

  return {
    start,
    handleResult,
    cancel,
    dispose: finish,
    activeRequest: () => state && state.phase !== "finished" ? state.request : null,
    isApplying: () => state?.phase === "applying",
    appliedHandoff: () => appliedHandoff
  };
};
