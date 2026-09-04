import { useCallback, useEffect, useRef, useState } from "react";
import type { CanonicalDocumentValue } from "../document/canonicalDocument";
import type { CanvasPresentation } from "../components/canvasPresentation";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import {
  applyCoordinatePointConversionPlan,
  planCoordinatePointConversion,
  type CoordinatePointConversionPlan,
  type CoordinatePointConversionSkip
} from "../commands/coordinatePointConversion";
import {
  coordinatePointConversionBaseForInput,
  coordinatePointConversionSelectedBase,
  selectCoordinatePointConversionBase,
  setCoordinatePointConversionQuery,
  startCoordinatePointConversionSession,
  type CoordinatePointConversionSession,
  type CoordinatePointConversionSessionOrigin
} from "../commands/coordinatePointConversionSession";
import type { EvaluationResult } from "../types/geometry";
import type { ExtensionToVscodeMessage, VscodeWebviewApi } from "./protocol";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  coordinatePointConversionPickTarget,
  isCoordinatePointConversionPickTarget
} from "./coordinatePointConversionPick";

export type VscodeCoordinatePointConversionCurrentContext = {
  document: CanonicalDocumentValue;
  source: SourceSnapshot;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
};

export type VscodeCoordinatePointConversionAuthority = {
  documentVersion: number;
  normalizedSource: string;
};

type CoordinatePointConversionStartRequest = Extract<
  ExtensionToVscodeMessage,
  { type: "coordinatePointConversionStart" }
>;

type PendingOperation = {
  operationId: number;
  session: CoordinatePointConversionSession;
  plan: CoordinatePointConversionPlan;
};

const contextMatchesAuthority = (
  request: CoordinatePointConversionStartRequest,
  authority: VscodeCoordinatePointConversionAuthority | null,
  current: VscodeCoordinatePointConversionCurrentContext | null
) => Boolean(
  authority &&
  authority.documentVersion === request.documentVersion &&
  current &&
  current.source.normalizedSource === authority.normalizedSource &&
  current.document.sourceText === authority.normalizedSource &&
  current.document.doc.spans.sourceMap.source === authority.normalizedSource
);

const emptyReason = (message: string): CoordinatePointConversionSkip["reason"] => ({
  code: "revalidation-failed",
  message
});

export const useVSCodeCoordinatePointConversionSession = ({
  api,
  currentContextFor,
  currentAuthorityFor,
  postCanvasCommit,
  presentation
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: () => VscodeCoordinatePointConversionCurrentContext | null;
  currentAuthorityFor: (documentVersion: number) => VscodeCoordinatePointConversionAuthority | null;
  postCanvasCommit: (operationId?: number, coordinatePointConversionRequestId?: number) => void;
  presentation?: CanvasPresentation;
}) => {
  const [session, setSession] = useState<CoordinatePointConversionSession | null>(null);
  const [canvasBasePick, setCanvasBasePick] = useState(false);
  const sessionRef = useRef<CoordinatePointConversionSession | null>(null);
  const canvasBasePickRef = useRef(false);
  const pendingStartRef = useRef<CoordinatePointConversionStartRequest | null>(null);
  const pendingOperationRef = useRef<PendingOperation | null>(null);
  const nextOperationIdRef = useRef(1);

  const replaceSession = useCallback((next: CoordinatePointConversionSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (!next) {
      canvasBasePickRef.current = false;
      setCanvasBasePick(false);
    }
  }, []);

  const postRejected = useCallback((request: CoordinatePointConversionStartRequest, reason: CoordinatePointConversionSkip["reason"]) => {
    api?.postMessage({
      type: "coordinatePointConversionResult",
      requestId: request.requestId,
      operationId: 0,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      origin: request.origin,
      mode: request.mode,
      status: "rejected",
      classification: "all-skipped",
      successfulTargetIds: [],
      successfulTargetCount: 0,
      skippedTargets: request.targetIds.map((targetId) => ({ targetId, reason })),
      skippedTargetCount: request.targetIds.length
    });
  }, [api]);

  const tryStart = useCallback((request: CoordinatePointConversionStartRequest) => {
    if (!api) return;
    const current = currentContextFor();
    if (!current || !contextMatchesAuthority(request, currentAuthorityFor(request.documentVersion), current)) {
      pendingStartRef.current = null;
      postRejected(request, emptyReason(
        presentation?.text(
          "canvas.coordinateConversion.error.sourceMismatch",
          "現在のSourceと変換要求が一致しません。"
        ) ?? "現在のSourceと変換要求が一致しません。"
      ));
      return;
    }
    if (!current.evaluationIsCurrent) {
      pendingStartRef.current = request;
      return;
    }
    const started = startCoordinatePointConversionSession({
      requestId: request.requestId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      mode: request.mode,
      origin: request.origin as CoordinatePointConversionSessionOrigin,
      targetIds: request.targetIds,
      snapshot: { document: current.document, evaluation: current.evaluation }
    });
    pendingStartRef.current = null;
    if (started.status === "rejected") {
      postRejected(request, started.reason);
      return;
    }
    canvasBasePickRef.current = request.canvasBasePick === true;
    setCanvasBasePick(canvasBasePickRef.current);
    replaceSession(started.session);
  }, [api, currentAuthorityFor, currentContextFor, postRejected, presentation, replaceSession]);

  useEffect(() => {
    const active = sessionRef.current;
    if (active && !contextMatchesAuthority(
      active as unknown as CoordinatePointConversionStartRequest,
      currentAuthorityFor(active.documentVersion),
      currentContextFor()
    )) {
      replaceSession(null);
    }
    const pending = pendingStartRef.current;
    if (pending) tryStart(pending);
  }, [currentAuthorityFor, currentContextFor, replaceSession, session, tryStart]);

  useEffect(() => {
    if (session) {
      useCadUiStore.getState().setActivePointPickTarget(coordinatePointConversionPickTarget());
      useCadUiStore.setState({
        activeNumericReferencePickTarget: null,
        activeLinePickTarget: null,
        activePickCursor: null
      });
    } else {
      const ui = useCadUiStore.getState();
      if (isCoordinatePointConversionPickTarget(ui.activePointPickTarget)) {
        useCadUiStore.setState({ activePointPickTarget: null, activePickCursor: null });
      }
    }
    return () => {
      const ui = useCadUiStore.getState();
      if (isCoordinatePointConversionPickTarget(ui.activePointPickTarget)) {
        useCadUiStore.setState({ activePointPickTarget: null, activePickCursor: null });
      }
    };
  }, [session]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (message.type === "coordinatePointConversionStart") {
        pendingStartRef.current = message;
        replaceSession(null);
        tryStart(message);
        return;
      }
      if (message.type !== "canvasCommitResult") return;
      const pending = pendingOperationRef.current;
      if (!pending || pending.operationId !== message.operationId) return;
      pendingOperationRef.current = null;
      const result = pending.plan;
      api?.postMessage({
        type: "coordinatePointConversionResult",
        requestId: pending.session.requestId,
        operationId: pending.operationId,
        documentUri: pending.session.documentUri,
        documentVersion: message.documentVersion,
        origin: pending.session.origin,
        mode: pending.session.mode,
        status: message.status === "accepted" ? "applied" : "rejected",
        classification: result.classification,
        successfulTargetIds: result.successfulTargetIds,
        successfulTargetCount: result.successfulTargetCount,
        skippedTargets: result.skippedTargets,
        skippedTargetCount: result.skippedTargetCount
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, replaceSession, tryStart]);

  const setQuery = useCallback((query: string) => {
    const current = sessionRef.current;
    if (current) replaceSession(setCoordinatePointConversionQuery({ ...current, selectedBaseKey: null }, query));
  }, [replaceSession]);

  const confirm = useCallback(() => {
    const currentSession = sessionRef.current;
    if (!currentSession || !api) return;
    const current = currentContextFor();
    const authority = currentAuthorityFor(currentSession.documentVersion);
    if (!current || !authority || !contextMatchesAuthority(
      {
        type: "coordinatePointConversionStart",
        requestId: currentSession.requestId,
        documentUri: currentSession.documentUri,
        documentVersion: currentSession.documentVersion,
        mode: currentSession.mode,
        targetIds: currentSession.targetIds,
        origin: currentSession.origin
      },
      authority,
      current
    ) || !current.evaluationIsCurrent) {
      replaceSession({ ...currentSession, error: emptyReason(
        presentation?.text(
          "canvas.coordinateConversion.error.staleContext",
          "現在の文書または評価結果が古くなっています。"
        ) ?? "現在の文書または評価結果が古くなっています。"
      ) });
      return;
    }
    const base = coordinatePointConversionSelectedBase(currentSession) ?? coordinatePointConversionBaseForInput(currentSession, currentSession.query);
    if (!base) {
      replaceSession({ ...currentSession, error: {
        code: "base-not-candidate",
        message: presentation?.text(
          "canvas.coordinateConversion.error.baseRequired",
          "基準点を選択するか、参照名を入力してください。"
        ) ?? "基準点を選択するか、参照名を入力してください。"
      } });
      return;
    }
    const plan = planCoordinatePointConversion({
      snapshot: { document: current.document, evaluation: current.evaluation },
      targetIds: currentSession.targetIds,
      base,
      mode: currentSession.mode
    });
    const applied = applyCoordinatePointConversionPlan(plan, {
      document: current.document,
      evaluation: current.evaluation
    });
    const operationId = nextOperationIdRef.current++;
    if (applied.status === "rejected") {
      replaceSession({ ...currentSession, error: applied.reason });
      api.postMessage({
        type: "coordinatePointConversionResult",
        requestId: currentSession.requestId,
        operationId,
        documentUri: currentSession.documentUri,
        documentVersion: currentSession.documentVersion,
        origin: currentSession.origin,
        mode: currentSession.mode,
        status: "rejected",
        classification: applied.plan.classification,
        successfulTargetIds: applied.plan.successfulTargetIds,
        successfulTargetCount: applied.plan.successfulTargetCount,
        skippedTargets: applied.plan.skippedTargets,
        skippedTargetCount: applied.plan.skippedTargetCount
      });
      return;
    }
    if (applied.status === "noop") {
      api.postMessage({
        type: "coordinatePointConversionResult",
        requestId: currentSession.requestId,
        operationId,
        documentUri: currentSession.documentUri,
        documentVersion: currentSession.documentVersion,
        origin: currentSession.origin,
        mode: currentSession.mode,
        status: "noop",
        classification: applied.plan.classification,
        successfulTargetIds: applied.plan.successfulTargetIds,
        successfulTargetCount: applied.plan.successfulTargetCount,
        skippedTargets: applied.plan.skippedTargets,
        skippedTargetCount: applied.plan.skippedTargetCount
      });
      replaceSession(null);
      return;
    }
    const committed = useCadDocumentStore.getState().commitLineSplices(applied.plan.splices);
    if (committed.status !== "applied") {
      replaceSession({ ...currentSession, error: emptyReason(
        presentation?.text(
          "canvas.coordinateConversion.error.applyFailed",
          "変換結果をSource Editorへ反映できませんでした。"
        ) ?? "変換結果をSource Editorへ反映できませんでした。"
      ) });
      return;
    }
    if (currentSession.origin === "source") {
      useCadUiStore.getState().clearElementSelection();
    }
    pendingOperationRef.current = { operationId, session: currentSession, plan: applied.plan };
    replaceSession(null);
    postCanvasCommit(operationId, currentSession.requestId);
  }, [api, currentAuthorityFor, currentContextFor, postCanvasCommit, presentation, replaceSession]);

  const selectBase = useCallback((key: string) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = selectCoordinatePointConversionBase(current, key);
    replaceSession(next);
    if (canvasBasePickRef.current && next.selectedBaseKey === key) confirm();
  }, [confirm, replaceSession]);

  const cancel = useCallback(() => replaceSession(null), [replaceSession]);

  const startPick = useCallback(() => {
    if (!sessionRef.current) return;
    useCadUiStore.getState().setActivePointPickTarget(coordinatePointConversionPickTarget());
  }, []);

  return { session, canvasBasePick, setQuery, selectBase, startPick, confirm, cancel };
};
