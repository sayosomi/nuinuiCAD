import { useCallback, useEffect, useRef, useState } from "react";
import type { CompiledDslDocument, SourceSnapshot } from "../dsl/dslDocument";
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

export const useVSCodeReferencePickSession = ({
  api,
  currentContextFor
}: {
  api: VscodeWebviewApi;
  currentContextFor: (documentVersion: number) => VscodeReferencePickCurrentContext | null;
}) => {
  const [session, setSession] = useState<VscodeReferencePickCanvasSession | null>(null);
  const sessionRef = useRef<VscodeReferencePickCanvasSession | null>(null);

  const replaceSession = useCallback((next: VscodeReferencePickCanvasSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (message.type === "referencePickStartRequest") {
        const previous = sessionRef.current;
        if (previous) {
          const canceled = cancelVscodeReferencePickCanvasSession(previous);
          if (canceled.result) api.postMessage(canceled.result);
          replaceSession(null);
        }
        const current = currentContextFor(message.documentVersion);
        if (!current) {
          const stale = startVscodeReferencePickCanvasSession({
            request: message,
            authoritativeDocumentUri: message.documentUri,
            authoritativeDocumentVersion: message.documentVersion + 1,
            source: { normalizedSource: "", sourceRevision: -1 },
            compiled: current?.compiled as never,
            evaluation: current?.evaluation as never,
            evaluationIsCurrent: false
          });
          api.postMessage(stale.result);
          return;
        }
        const started = startVscodeReferencePickCanvasSession({
          request: message,
          // The Extension Host routes the request only to the Canvas session
          // bound to this Source document. The request URI is therefore the
          // authoritative URI for this panel; version/source/proof are still
          // independently revalidated below by the host-neutral bridge.
          authoritativeDocumentUri: message.documentUri,
          authoritativeDocumentVersion: message.documentVersion,
          source: current.source,
          compiled: current.compiled,
          evaluation: current.evaluation,
          evaluationIsCurrent: current.evaluationIsCurrent
        });
        api.postMessage(started.result);
        replaceSession(started.session);
        return;
      }
      if (message.type === "referencePickCancelRequest") {
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
        return;
      }
      if (message.type === "replaceTextDocument" || message.type === "commitText") {
        if (sessionRef.current) replaceSession(null);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, currentContextFor, replaceSession]);

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
    if (!current) return;
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
    if (!current) return;
    const canceled = cancelVscodeReferencePickCanvasSession(current);
    if (canceled.result) api.postMessage(canceled.result);
    replaceSession(null);
  }, [api, replaceSession]);

  return { session, setHover, select, confirm, cancel };
};
