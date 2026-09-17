import { useCallback, useEffect, useRef, useState } from "react";
import type { DslReferencePickTarget } from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
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
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { EvaluationResult } from "../types/geometry";
import type { VscodeWebviewApi } from "./protocol";

export type VscodeModulePreviewReferencePickCurrentContext = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
  target: DslReferencePickTarget | null;
};

export type VscodeModulePreviewReferencePickContextLookup =
  | VscodeModulePreviewReferencePickCurrentContext
  | { kind: "pending" | "unavailable" }
  | null;

export const useVSCodeModulePreviewReferencePickSession = ({
  api,
  currentContextFor
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: (
    request: VscodeModulePreviewReferencePickStartRequest
  ) => VscodeModulePreviewReferencePickContextLookup;
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
      normalizedSource: request.normalizedSource,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      targetDefinitionStatementIndex: request.targetDefinitionStatementIndex,
      targetName: request.targetName,
      definitionStatementId: request.definitionStatementId,
      blockKind: request.blockKind,
      blockDefinitionStatementIndex: request.blockDefinitionStatementIndex,
      blockName: request.blockName,
      parameterIndex: request.parameterIndex,
      invocationText: request.invocationText,
      selectionStart: request.selectionStart,
      selectionEnd: request.selectionEnd,
      expectedGeometryInterface: request.expectedGeometryInterface,
      role: request.role,
      multiplicity: request.multiplicity,
      status
    });
  }, [api]);

  const tryStart = useCallback((request: VscodeModulePreviewReferencePickStartRequest) => {
    if (!api) return;
    const lookup = currentContextFor(request);
    if (lookup && "kind" in lookup && lookup.kind === "pending") return;
    if (lookup && "kind" in lookup) {
      postTerminal(request, "stale");
      requestRef.current = null;
      replaceSession(null);
      return;
    }
    const context = lookup;
    if (!context || !context.target ||
      context.target.expectedGeometryInterface !== request.expectedGeometryInterface ||
      context.target.role !== request.role ||
      context.target.multiplicity !== request.multiplicity
    ) {
      postTerminal(request, "stale");
      requestRef.current = null;
      replaceSession(null);
      return;
    }
    if (!context.evaluationIsCurrent) return;
    if (sessionRef.current) return;
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
      normalizedSource: request.normalizedSource,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      targetDefinitionStatementIndex: request.targetDefinitionStatementIndex,
      targetName: request.targetName,
      definitionStatementId: request.definitionStatementId,
      blockKind: request.blockKind,
      blockDefinitionStatementIndex: request.blockDefinitionStatementIndex,
      blockName: request.blockName,
      parameterIndex: request.parameterIndex,
      invocationText: request.invocationText,
      selectionStart: request.selectionStart,
      selectionEnd: request.selectionEnd,
      expectedGeometryInterface: request.expectedGeometryInterface,
      role: request.role,
      multiplicity: request.multiplicity,
      status: "started",
      candidateReferences
    });
  }, [api, currentContextFor, postTerminal, replaceSession]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<VscodeModulePreviewReferencePickStartRequest> & {
        type?: string;
      };
      if (message.type === "modulePreviewReferencePickStartRequest") {
        if (!api) return;
        const request = event.data as VscodeModulePreviewReferencePickStartRequest;
        const previousRequest = requestRef.current;
        if (previousRequest) postTerminal(previousRequest, "canceled");
        requestRef.current = null;
        replaceSession(null);
        requestRef.current = request;
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

  useEffect(() => {
    const request = requestRef.current;
    if (request) tryStart(request);
  }, [currentContextFor, tryStart]);

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
      normalizedSource: request.normalizedSource,
      sourceRevision: request.sourceRevision,
      sessionRevision: request.sessionRevision,
      targetDefinitionStatementId: request.targetDefinitionStatementId,
      targetDefinitionStatementIndex: request.targetDefinitionStatementIndex,
      targetName: request.targetName,
      definitionStatementId: request.definitionStatementId,
      blockKind: request.blockKind,
      blockDefinitionStatementIndex: request.blockDefinitionStatementIndex,
      blockName: request.blockName,
      parameterIndex: request.parameterIndex,
      invocationText: request.invocationText,
      selectionStart: request.selectionStart,
      selectionEnd: request.selectionEnd,
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
