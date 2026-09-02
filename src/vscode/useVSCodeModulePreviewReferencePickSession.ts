import { useCallback, useEffect, useRef, useState } from "react";
import type { DslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import type { SourceSnapshot } from "../dsl/logicalStatementSourceMap";
import type { ReferencePickHover } from "../model/referencePickSession";
import {
  confirmReferencePickSession,
  confirmedReferencePickResult,
  type ReferencePickSession
} from "../model/referencePickSession";
import {
  createVscodeReferencePickCanvasSession,
  referencePickCandidateReferences,
  selectVscodeReferencePickCanvasDraft,
  setVscodeReferencePickCanvasHover,
  type VscodeReferencePickCanvasSessionLike
} from "./referencePickCanvasSession";
import { referencePickCandidates } from "../model/referencePickCandidates";
import {
  type VscodeModulePreviewReferencePickStartRequest
} from "./modulePreviewProtocol";
import {
  isCanonicalReferencePickReference
} from "./referencePickProtocol";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import type { EvaluationResult } from "../types/geometry";
import type { VscodeWebviewApi } from "./protocol";

export type VscodeModulePreviewReferencePickCurrentContext = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
  target: DslReferencePickTarget | null;
};

export const useVSCodeModulePreviewReferencePickSession = ({
  api,
  currentContextFor
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: (
    request: VscodeModulePreviewReferencePickStartRequest
  ) => VscodeModulePreviewReferencePickCurrentContext | null;
}) => {
  const [session, setSession] = useState<VscodeReferencePickCanvasSessionLike | null>(null);
  const sessionRef = useRef<VscodeReferencePickCanvasSessionLike | null>(null);
  const requestRef = useRef<VscodeModulePreviewReferencePickStartRequest | null>(null);

  const replaceSession = useCallback((next: VscodeReferencePickCanvasSessionLike | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const postTerminal = useCallback((
    request: VscodeModulePreviewReferencePickStartRequest,
    status: "stale" | "rejected" | "canceled"
  ) => {
    api?.postMessage({
      type: "modulePreviewReferencePickResult",
      requestId: request.requestId,
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      definitionStatementId: request.definitionStatementId,
      parameterIndex: request.parameterIndex,
      expectedGeometryInterface: request.expectedGeometryInterface,
      role: request.role,
      multiplicity: request.multiplicity,
      status
    });
  }, [api]);

  const tryStart = useCallback((request: VscodeModulePreviewReferencePickStartRequest) => {
    if (!api) return;
    const context = currentContextFor(request);
    if (
      !context ||
      !context.target ||
      !context.evaluationIsCurrent ||
      context.target.expectedGeometryInterface !== request.expectedGeometryInterface ||
      context.target.role !== request.role ||
      context.target.multiplicity !== request.multiplicity
    ) {
      postTerminal(request, "stale");
      requestRef.current = null;
      replaceSession(null);
      return;
    }
    const candidates = referencePickCandidates({
      compiled: context.compiled,
      evaluation: context.evaluation,
      target: context.target
    });
    const candidateReferences = referencePickCandidateReferences(candidates);
    const draft = {
      expectedGeometryInterface: context.target.expectedGeometryInterface,
      role: context.target.role,
      multiplicity: context.target.multiplicity,
      hover: null,
      draftReferences: [],
      numericProperty: null,
      status: "active"
    } satisfies ReferencePickSession;
    const next = createVscodeReferencePickCanvasSession({
      request,
      target: context.target,
      candidates,
      draft
    });
    requestRef.current = request;
    replaceSession(next);
    api.postMessage({
      type: "modulePreviewReferencePickResult",
      requestId: request.requestId,
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      definitionStatementId: request.definitionStatementId,
      parameterIndex: request.parameterIndex,
      expectedGeometryInterface: request.expectedGeometryInterface,
      role: request.role,
      multiplicity: request.multiplicity,
      status: "started",
      candidateReferences
    });
  }, [api, currentContextFor, postTerminal, replaceSession]);

  useEffect(() => {
    const current = sessionRef.current;
    const request = requestRef.current;
    if (!current || !request) return;
    const context = currentContextFor(request);
    if (
      !context ||
      !context.target ||
      !context.evaluationIsCurrent ||
      context.target.expectedGeometryInterface !== request.expectedGeometryInterface ||
      context.target.role !== request.role ||
      context.target.multiplicity !== request.multiplicity
    ) {
      postTerminal(request, "stale");
      requestRef.current = null;
      replaceSession(null);
    }
  }, [currentContextFor, postTerminal, replaceSession]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<VscodeModulePreviewReferencePickStartRequest> & {
        type?: string;
      };
      if (message.type === "modulePreviewReferencePickStartRequest") {
        if (!api) return;
        const request = event.data as VscodeModulePreviewReferencePickStartRequest;
        const previous = sessionRef.current;
        const previousRequest = requestRef.current;
        if (previous && previousRequest) postTerminal(previousRequest, "canceled");
        requestRef.current = null;
        replaceSession(null);
        tryStart(request);
        return;
      }
      if (message.type === "modulePreviewReferencePickCancelRequest") {
        const request = requestRef.current;
        if (!request || !api ||
          request.requestId !== message.requestId ||
          request.sessionId !== message.sessionId ||
          request.documentUri !== message.documentUri ||
          request.documentVersion !== message.documentVersion) return;
        postTerminal(request, "canceled");
        requestRef.current = null;
        replaceSession(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, postTerminal, replaceSession, tryStart]);

  const setHover = useCallback((hover: ReferencePickHover | null) => {
    const current = sessionRef.current;
    if (current) replaceSession(setVscodeReferencePickCanvasHover(current, hover));
  }, [replaceSession]);

  const select = useCallback((selection: ReferencePickHover | null) => {
    const current = sessionRef.current;
    if (current) replaceSession(selectVscodeReferencePickCanvasDraft(current, selection));
  }, [replaceSession]);

  const confirm = useCallback(() => {
    const current = sessionRef.current;
    const request = requestRef.current;
    if (!current || !request || !api) return;
    const confirmed = confirmReferencePickSession(current.draft);
    const references = confirmedReferencePickResult(confirmed);
    if (!references || references.length !== 1 || !isCanonicalReferencePickReference(references[0])) return;
    api.postMessage({
      type: "modulePreviewReferencePickResult",
      requestId: request.requestId,
      sessionId: request.sessionId,
      documentUri: request.documentUri,
      documentVersion: request.documentVersion,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      definitionStatementId: request.definitionStatementId,
      parameterIndex: request.parameterIndex,
      expectedGeometryInterface: request.expectedGeometryInterface,
      role: request.role,
      multiplicity: request.multiplicity,
      status: "confirmed",
      resultKind: "geometry",
      references: [references[0]]
    });
    requestRef.current = null;
    replaceSession(null);
  }, [api, replaceSession]);

  const cancel = useCallback(() => {
    const request = requestRef.current;
    if (!request || !api) return;
    postTerminal(request, "canceled");
    requestRef.current = null;
    replaceSession(null);
  }, [api, postTerminal, replaceSession]);

  return { session, setHover, select, selectNumericProperty: undefined, confirm, cancel };
};
