import { useCallback, useEffect, useRef, useState } from "react";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { ReferencePickHover } from "../model/referencePickSession";
import type { EvaluationResult } from "../types/geometry";
import {
  cancelVscodeReferencePickCanvasSession,
  confirmVscodeReferencePickCanvasSession,
  selectVscodeReferencePickCanvasDraft,
  setVscodeReferencePickCanvasHover,
  startVscodeReferencePickCanvasSession,
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
};

type AuthoritativeHostSource = {
  documentVersion: number;
  normalizedSource: string;
};

type ReferencePickStartRequest = Extract<
  ExtensionToVscodeMessage,
  { type: "referencePickStartRequest" }
>;

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export const useVSCodeReferencePickSession = ({
  api,
  currentContextFor
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: () => VscodeReferencePickCurrentContext | null;
}) => {
  const [session, setSession] = useState<VscodeReferencePickCanvasSession | null>(null);
  const sessionRef = useRef<VscodeReferencePickCanvasSession | null>(null);
  const authoritativeHostSourceRef = useRef<AuthoritativeHostSource | null>(null);
  const pendingStartRequestRef = useRef<ReferencePickStartRequest | null>(null);

  const replaceSession = useCallback((next: VscodeReferencePickCanvasSession | null) => {
    sessionRef.current = next;
    setSession(next);
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

  const tryStart = useCallback((message: ReferencePickStartRequest) => {
    if (!api) return;
    const authoritative = authoritativeHostSourceRef.current;
    const current = currentContextFor();
    if (
      !authoritative ||
      authoritative.documentVersion !== message.documentVersion ||
      !current ||
      current.source.normalizedSource !== authoritative.normalizedSource ||
      current.compiled.spans.sourceMap.source !== authoritative.normalizedSource
    ) {
      pendingStartRequestRef.current = null;
      postStale(message);
      return;
    }
    if (!current.evaluationIsCurrent) {
      pendingStartRequestRef.current = message;
      return;
    }

    pendingStartRequestRef.current = null;
    const started = startVscodeReferencePickCanvasSession({
      request: message,
      // The Extension Host routes the request only to the Canvas session
      // bound to this Source document. The host snapshot above proves the
      // matching version/source; target proof and candidates are re-derived
      // independently in this Webview compiler session.
      authoritativeDocumentUri: message.documentUri,
      authoritativeDocumentVersion: authoritative.documentVersion,
      source: current.source,
      compiled: current.compiled,
      evaluation: current.evaluation,
      evaluationIsCurrent: current.evaluationIsCurrent
    });
    api.postMessage(started.result);
    replaceSession(started.session);
  }, [api, currentContextFor, postStale, replaceSession]);

  useEffect(() => {
    const pending = pendingStartRequestRef.current;
    if (pending) tryStart(pending);
  }, [tryStart]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (message.type === "replaceTextDocument" || message.type === "commitText") {
        authoritativeHostSourceRef.current = {
          documentVersion: message.documentVersion,
          normalizedSource: normalizedSourceFor(message.sourceText)
        };
        pendingStartRequestRef.current = null;
        if (sessionRef.current) replaceSession(null);
        return;
      }
      if (message.type === "referencePickStartRequest") {
        if (!api) return;
        pendingStartRequestRef.current = null;
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

  const confirm = useCallback(() => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const confirmed = confirmVscodeReferencePickCanvasSession(current);
    if (!confirmed.result) {
      replaceSession(confirmed.session);
      return;
    }
    api.postMessage(confirmed.result);
    replaceSession(null);
  }, [api, replaceSession]);

  const cancel = useCallback(() => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const canceled = cancelVscodeReferencePickCanvasSession(current);
    if (canceled.result) api.postMessage(canceled.result);
    replaceSession(null);
  }, [api, replaceSession]);

  return { session, setHover, select, confirm, cancel };
};
