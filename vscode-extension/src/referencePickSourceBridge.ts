import * as vscode from "vscode";
import { queryDslReferencePickTarget } from "../../src/dsl/dslReferencePickQuery";
import {
  isCanonicalReferencePickReference,
  referencePickTargetProofFor,
  sameReferencePickTargetProof,
  type VscodeReferencePickTargetProof,
  type VscodeReferencePickCancelRequest,
  type VscodeReferencePickResult,
  type VscodeReferencePickStartRequest
} from "../../src/vscode/referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "../../src/vscode/referencePickSourceEdit";
import type { CanonicalGeometrySourceReference } from "../../src/model/moduleSemanticCandidateBoundary";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  normalizedSourceFor,
  rawOffsetFromNormalized,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export type VscodeReferencePickSourceBridgeResult =
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

type BridgePhase = "waiting" | "active" | "applying" | "finished";

type BridgeState = {
  request: VscodeReferencePickStartRequest;
  phase: BridgePhase;
  allowedCandidateReferences: readonly CanonicalGeometrySourceReference[] | null;
};

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
  expectedTargetProof,
  postMessage
}: {
  editor: vscode.TextEditor;
  languageAnalysisSession: NuiLanguageAnalysisSession;
  requestId: number;
  normalizedSourceOffset: number;
  initialDraftReferences?: readonly CanonicalGeometrySourceReference[];
  expectedTargetProof?: VscodeReferencePickTargetProof;
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
    if (!isOpenDocument(document) || !Number.isInteger(normalizedSourceOffset)) return null;
    const rawSource = document.getText();
    if (languageAnalysisSession.getSource() !== rawSource) languageAnalysisSession.replaceSource(rawSource);
    const source = {
      normalizedSource: normalizedSourceFor(rawSource),
      sourceRevision: languageAnalysisSession.getSourceRevision()
    };
    const semantic = languageAnalysisSession.definitionSemanticSnapshot(source);
    if (!semantic?.compiled) return null;
    const target = queryDslReferencePickTarget({ source, position: normalizedSourceOffset, semantic });
    if (!target) return null;
    const targetProof = referencePickTargetProofFor(source.normalizedSource, target);
    if (!targetProof || (expectedTargetProof && !sameReferencePickTargetProof(targetProof, expectedTargetProof))) return null;

    const request: VscodeReferencePickStartRequest = {
      type: "referencePickStartRequest",
      requestId,
      documentUri,
      documentVersion: document.version,
      normalizedSourceOffset,
      targetProof,
      ...(initialDraftReferences !== undefined ? { initialDraftReferences: [...initialDraftReferences] } : {})
    };
    state = { request, phase: "waiting", allowedCandidateReferences: null };
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
        !result.candidateReferences.every(isCanonicalReferencePickReference)
      ) {
        cancel();
        return "rejected";
      }
      current.phase = "active";
      current.allowedCandidateReferences = [...result.candidateReferences];
      return "started";
    }

    if (result.status === "canceled" || result.status === "stale" || result.status === "rejected") {
      finish();
      return result.status;
    }
    if (current.phase !== "active" || !current.allowedCandidateReferences) {
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
    const semantic = languageAnalysisSession.definitionSemanticSnapshot(source);
    if (!semantic?.compiled) {
      cancel();
      return "stale";
    }
    const plan = planVscodeReferencePickSourceEdit({
      source,
      compiled: semantic.compiled,
      normalizedSourceOffset: current.request.normalizedSourceOffset,
      targetProof: current.request.targetProof,
      references: result.references,
      allowedCandidateReferences: current.allowedCandidateReferences
    });
    if (!plan) {
      cancel();
      return "rejected";
    }

    current.phase = "applying";
    const preConfirmSource = rawSource;
    const editRange = vscodeRangeForNormalized(document, rawSource, plan.range);
    let applied: boolean;
    try {
      applied = await editor.edit((editBuilder) => {
        editBuilder.replace(editRange, plan.replacement);
      }, { undoStopBefore: true, undoStopAfter: true });
    } catch {
      finish();
      return "rejected";
    }
    if (!applied) {
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
      references: [...result.references]
    };

    const rawRangeStart = rawOffsetFromNormalized(rawSource, plan.range.from);
    const caret = document.positionAt(rawRangeStart + plan.replacement.length);
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
