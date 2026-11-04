import { useCallback, useEffect, useRef, useState } from "react";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import type { ReferencePickHover } from "../model/referencePickSession";
import type { NumericComputedGeometryProperty } from "../geometry/numericExpressions";
import type { EvaluationResult } from "../types/geometry";
import {
  cancelVscodeReferencePickCanvasSession,
  confirmVscodeReferencePickCanvasSession,
  moveVscodeReferencePickCanvasDraft,
  removeVscodeReferencePickCanvasDraft,
  selectVscodeReferencePickCanvasDraft,
  selectVscodeReferencePickCanvasNumericProperty,
  setVscodeReferencePickCanvasHover,
  startVscodeReferencePickCanvasSession,
  type VscodeReferencePickCanvasSnapshot,
  type VscodeReferencePickCanvasSession
} from "./referencePickCanvasSession";
import type {
  ExtensionToVscodeMessage,
  VscodeWebviewApi
} from "./protocol";

export type VscodeReferencePickCurrentContext = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
  /** Candidate authority used only when Canvas is rendering a coherent pinned snapshot. */
  canvasSnapshot?: VscodeReferencePickCanvasSnapshot;
};

export type VscodeReferencePickAuthority = {
  documentVersion: number;
  normalizedSource: string;
};

export type VscodeReferencePickAuthorityFor = (
  expectedDocumentVersion: number
) => VscodeReferencePickAuthority | null;

type ReferencePickStartRequest = Extract<
  ExtensionToVscodeMessage,
  { type: "referencePickStartRequest" }
>;

const contextMatchesAuthority = (
  message: ReferencePickStartRequest,
  authoritative: VscodeReferencePickAuthority | null,
  current: VscodeReferencePickCurrentContext | null
): boolean => Boolean(
  authoritative &&
  authoritative.documentVersion === message.documentVersion &&
  current &&
  current.source.normalizedSource === authoritative.normalizedSource &&
  current.compiled.spans.sourceMap.source === authoritative.normalizedSource &&
  current.compiled.spans.sourceMap.sourceRevision === current.source.sourceRevision
);

export const useVSCodeReferencePickSession = ({
  api,
  currentContextFor,
  currentReferencePickAuthorityFor,
  prepareCandidateSnapshot,
  canStart = () => true
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: () => VscodeReferencePickCurrentContext | null;
  currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
  prepareCandidateSnapshot?: (
    request: ReferencePickStartRequest,
    current: VscodeReferencePickCurrentContext
  ) => Promise<VscodeReferencePickCanvasSnapshot | null>;
  canStart?: () => boolean;
}) => {
  const [session, setSession] = useState<VscodeReferencePickCanvasSession | null>(null);
  const sessionRef = useRef<VscodeReferencePickCanvasSession | null>(null);
  const pendingStartRequestRef = useRef<ReferencePickStartRequest | null>(null);
  const preparingRef = useRef<{ request: ReferencePickStartRequest } | null>(null);
  const activeCompiledRef = useRef<CompiledDslDocument | null>(null);
  const [candidateSnapshot, setCandidateSnapshot] = useState<VscodeReferencePickCanvasSnapshot | null>(null);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      preparingRef.current = null;
      pendingStartRequestRef.current = null;
    };
  }, []);

  const replaceSession = useCallback((next: VscodeReferencePickCanvasSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (!next) {
      activeCompiledRef.current = null;
      setCandidateSnapshot(null);
    }
  }, []);

  const postStale = useCallback((message: ReferencePickStartRequest) => {
    api?.postMessage({
      type: "referencePickResult",
      requestId: message.requestId,
      documentUri: message.documentUri,
      documentVersion: message.documentVersion,
      targetProof: message.targetProof,
      status: "stale"
    });
  }, [api]);

  const start = useCallback((
    message: ReferencePickStartRequest,
    current: VscodeReferencePickCurrentContext,
    authoritative: VscodeReferencePickAuthority,
    projected?: VscodeReferencePickCanvasSnapshot,
    deferStaleSnapshot = false
  ) => {
    const snapshot = projected ?? current.canvasSnapshot;
    const started = startVscodeReferencePickCanvasSession({
      request: message,
      authoritativeDocumentUri: message.documentUri,
      authoritativeDocumentVersion: authoritative.documentVersion,
      source: current.source,
      compiled: current.compiled,
      evaluation: current.evaluation,
      evaluationIsCurrent: current.evaluationIsCurrent,
      ...(snapshot ? { candidateSnapshot: snapshot } : {})
    });
    // A pinned render is not candidate authority until the shared session
    // proves continuity. An unrelated startup sample can require projection.
    if (deferStaleSnapshot && started.result.status === "stale") return false;
    pendingStartRequestRef.current = null;
    api?.postMessage(started.result);
    replaceSession(started.session);
    if (started.session) {
      activeCompiledRef.current = current.compiled;
      setCandidateSnapshot(projected ?? null);
    }
    return true;
  }, [api, replaceSession]);

  const tryStart = useCallback((message: ReferencePickStartRequest) => {
    if (!api) return;
    if (!canStart()) {
      api.postMessage({
        type: "referencePickResult",
        requestId: message.requestId,
        documentUri: message.documentUri,
        documentVersion: message.documentVersion,
        targetProof: message.targetProof,
        status: "canceled"
      });
      pendingStartRequestRef.current = null;
      return;
    }
    const authoritative = currentReferencePickAuthorityFor(message.documentVersion);
    const current = currentContextFor();
    if (!authoritative) {
      pendingStartRequestRef.current = null;
      postStale(message);
      return;
    }
    // The host authority can become current before this render has hydrated
    // the Source/compiler context. Keep the request pending in that narrow
    // window; an absent context is not evidence that the Source request is
    // stale. Once a context exists, it must still prove the exact authority.
    if (!current) {
      pendingStartRequestRef.current = message;
      return;
    }
    if (!contextMatchesAuthority(message, authoritative, current)) {
      pendingStartRequestRef.current = null;
      postStale(message);
      return;
    }
    if (current.evaluationIsCurrent || current.canvasSnapshot) {
      if (start(message, current, authoritative, undefined, !current.compiled.document && Boolean(prepareCandidateSnapshot))) return;
    }
    pendingStartRequestRef.current = message;
    if (!current.compiled.document && prepareCandidateSnapshot && preparingRef.current?.request !== message) {
      const work = { request: message };
      preparingRef.current = work;
      void prepareCandidateSnapshot(message, current).catch(() => null).then((snapshot) => {
        if (!liveRef.current || preparingRef.current !== work || pendingStartRequestRef.current !== message) return;
        const latest = currentContextFor();
        const authority = currentReferencePickAuthorityFor(message.documentVersion);
        preparingRef.current = null;
        if (!authority || !latest || !contextMatchesAuthority(message, authority, latest) ||
          latest.compiled !== current.compiled || latest.source.sourceRevision !== current.source.sourceRevision) {
          pendingStartRequestRef.current = null;
          postStale(message);
          return;
        }
        if (!canStart()) {
          pendingStartRequestRef.current = null;
          return;
        }
        if (snapshot) start(message, latest, authority, snapshot);
        else {
          pendingStartRequestRef.current = null;
          postStale(message);
        }
      });
    }
  }, [api, canStart, currentContextFor, currentReferencePickAuthorityFor, postStale, prepareCandidateSnapshot, start]);

  useEffect(() => {
    const current = currentContextFor();
    const pending = pendingStartRequestRef.current;
    const pendingAuthority = pending
      ? currentReferencePickAuthorityFor(pending.documentVersion)
      : null;
    if (pending && (!pendingAuthority || (current && !contextMatchesAuthority(pending, pendingAuthority, current)))) {
      pendingStartRequestRef.current = null;
    }

    const active = sessionRef.current;
    const activeAuthority = active
      ? currentReferencePickAuthorityFor(active.request.documentVersion)
      : null;
    if (active && (!activeAuthority || !current || current.compiled !== activeCompiledRef.current ||
      !contextMatchesAuthority(active.request, activeAuthority, current))) {
      replaceSession(null);
    }

    const currentPending = pendingStartRequestRef.current;
    if (currentPending) tryStart(currentPending);
  }, [currentContextFor, currentReferencePickAuthorityFor, replaceSession, tryStart]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (message.type === "referencePickStartRequest") {
        if (!api) return;
        if (JSON.stringify(pendingStartRequestRef.current) === JSON.stringify(message) ||
          JSON.stringify(sessionRef.current?.request) === JSON.stringify(message)) return;
        pendingStartRequestRef.current = null;
        preparingRef.current = null;
        const previous = sessionRef.current;
        if (previous) {
          const canceled = cancelVscodeReferencePickCanvasSession(previous);
          if (canceled.result) api.postMessage(canceled.result);
          replaceSession(null);
        }
        tryStart(message);
        return;
      }
      if (message.type === "referencePickCancelRequest") {
        if (!api) return;
        const pending = pendingStartRequestRef.current;
        if (
          pending &&
          pending.requestId === message.requestId &&
          pending.documentUri === message.documentUri &&
          pending.documentVersion === message.documentVersion
        ) {
          pendingStartRequestRef.current = null;
          preparingRef.current = null;
          return;
        }
        const current = sessionRef.current;
        if (
          !current ||
          current.request.requestId !== message.requestId ||
          current.request.documentUri !== message.documentUri ||
          current.request.documentVersion !== message.documentVersion
        ) return;
        const canceled = cancelVscodeReferencePickCanvasSession(current);
        if (canceled.result) api.postMessage(canceled.result);
        replaceSession(null);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, replaceSession, tryStart]);

  const setHover = useCallback((hover: ReferencePickHover | null) => {
    const current = sessionRef.current;
    if (!current) return;
    replaceSession(setVscodeReferencePickCanvasHover(current, hover));
  }, [replaceSession]);

  const select = useCallback((selection: ReferencePickHover | null) => {
    const current = sessionRef.current;
    if (!current) return;
    replaceSession(selectVscodeReferencePickCanvasDraft(current, selection));
  }, [replaceSession]);

  const selectNumericProperty = useCallback((property: NumericComputedGeometryProperty) => {
    const current = sessionRef.current;
    if (!current) return;
    replaceSession(selectVscodeReferencePickCanvasNumericProperty(current, property));
  }, [replaceSession]);

  const moveDraftEntry = useCallback((referenceKey: string, toIndex: number) => {
    const current = sessionRef.current;
    if (!current) return;
    replaceSession(moveVscodeReferencePickCanvasDraft(current, referenceKey, toIndex));
  }, [replaceSession]);

  const removeDraftEntry = useCallback((referenceKey: string) => {
    const current = sessionRef.current;
    if (!current) return;
    replaceSession(removeVscodeReferencePickCanvasDraft(current, referenceKey));
  }, [replaceSession]);

  const confirm = useCallback(() => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const context = currentContextFor();
    const authority = currentReferencePickAuthorityFor(current.request.documentVersion);
    if (!context || context.compiled !== activeCompiledRef.current ||
      !contextMatchesAuthority(current.request, authority, context)) {
      postStale(current.request);
      replaceSession(null);
      return;
    }
    const confirmed = confirmVscodeReferencePickCanvasSession(current);
    if (!confirmed.result) {
      replaceSession(confirmed.session);
      return;
    }
    api.postMessage(confirmed.result);
    replaceSession(null);
  }, [api, currentContextFor, currentReferencePickAuthorityFor, postStale, replaceSession]);

  const cancel = useCallback(() => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const canceled = cancelVscodeReferencePickCanvasSession(current);
    if (canceled.result) api.postMessage(canceled.result);
    replaceSession(null);
  }, [api, replaceSession]);

  return {
    session,
    candidateSnapshot,
    setHover,
    select,
    selectNumericProperty,
    moveDraftEntry,
    removeDraftEntry,
    confirm,
    cancel
  };
};
