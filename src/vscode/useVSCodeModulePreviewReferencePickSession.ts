import { useCallback, useEffect, useRef, useState } from "react";
import type { DslReferencePickTarget, SourceSnapshot } from "@nuinuicad/nui-language";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { EvaluationResult } from "../types/geometry";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import {
  referencePickCandidates,
  type ReferencePickCandidate
} from "../model/referencePickCandidates";
import type { VscodeWebviewApi } from "./protocol";
import {
  isCanonicalReferencePickReference,
  referencePickReferenceKey
} from "./referencePickProtocol";
import { referencePickCandidateReferences } from "./referencePickCanvasSession";
import type { VscodeModulePreviewReferencePickStartRequest } from "./modulePreviewProtocol";

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

/** Protocol/session authority only. Draft, hover, hit testing, and completion
 * remain owned by the common DrawingCanvas Pick Mode path. */
export type VscodeModulePreviewReferencePickSession = {
  request: VscodeModulePreviewReferencePickStartRequest;
  target: DslReferencePickTarget;
  candidates: ReferencePickCandidate[];
  candidateReferences: CanonicalGeometrySourceReference[];
};

type TerminalStatus = "stale" | "rejected" | "canceled";

const resultProofFor = (request: VscodeModulePreviewReferencePickStartRequest) => ({
  requestId: request.requestId,
  sessionId: request.sessionId,
  documentUri: request.documentUri,
  documentVersion: request.documentVersion,
  normalizedSource: request.normalizedSource,
  sourceRevision: request.sourceRevision,
  sessionRevision: request.sessionRevision,
  targetDefinitionStatementIndex: request.targetDefinitionStatementIndex,
  targetName: request.targetName,
  definitionStatementIndex: request.definitionStatementIndex,
  definitionName: request.definitionName,
  blockKind: request.blockKind,
  parameterIndex: request.parameterIndex,
  parameterName: request.parameterName,
  expectedGeometryInterface: request.expectedGeometryInterface,
  role: request.role,
  multiplicity: request.multiplicity
});

export const useVSCodeModulePreviewReferencePickSession = ({
  api,
  currentContextFor
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: (
    request: VscodeModulePreviewReferencePickStartRequest
  ) => VscodeModulePreviewReferencePickContextLookup;
}) => {
  const [session, setSession] = useState<VscodeModulePreviewReferencePickSession | null>(null);
  const sessionRef = useRef<VscodeModulePreviewReferencePickSession | null>(null);
  const requestRef = useRef<VscodeModulePreviewReferencePickStartRequest | null>(null);

  const replaceSession = useCallback((next: VscodeModulePreviewReferencePickSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const postTerminal = useCallback((
    request: VscodeModulePreviewReferencePickStartRequest,
    status: TerminalStatus
  ) => {
    api?.postMessage({
      type: "modulePreviewReferencePickResult",
      ...resultProofFor(request),
      status
    });
  }, [api]);

  const clear = useCallback(() => {
    requestRef.current = null;
    replaceSession(null);
  }, [replaceSession]);

  const exactContextFor = useCallback((request: VscodeModulePreviewReferencePickStartRequest) => {
    const lookup = currentContextFor(request);
    if (!lookup || "kind" in lookup || !lookup.target || !lookup.evaluationIsCurrent) return null;
    if (
      lookup.source.normalizedSource !== request.normalizedSource ||
      lookup.source.sourceRevision !== request.sourceRevision ||
      lookup.target.sourceAnchor.sourceRevision !== request.sourceRevision ||
      lookup.target.sourceAnchor.statementIndex !== request.definitionStatementIndex ||
      lookup.target.expectedGeometryInterface !== request.expectedGeometryInterface ||
      lookup.target.role !== request.role ||
      lookup.target.multiplicity !== request.multiplicity
    ) return null;
    return lookup as VscodeModulePreviewReferencePickCurrentContext & {
      target: DslReferencePickTarget;
    };
  }, [currentContextFor]);

  const tryStart = useCallback((request: VscodeModulePreviewReferencePickStartRequest) => {
    if (!api) return;
    const lookup = currentContextFor(request);
    if (lookup && "kind" in lookup && lookup.kind === "pending") return;
    if (!exactContextFor(request)) {
      postTerminal(request, "stale");
      clear();
      return;
    }
    if (sessionRef.current) return;
    const context = exactContextFor(request);
    if (!context || !context.target) return;
    const candidates = referencePickCandidates({
      compiled: context.compiled,
      evaluation: context.evaluation,
      target: context.target
    });
    const candidateReferences = referencePickCandidateReferences(candidates);
    requestRef.current = request;
    replaceSession({ request, target: context.target, candidates, candidateReferences });
    api.postMessage({
      type: "modulePreviewReferencePickResult",
      ...resultProofFor(request),
      status: "started",
      candidateReferences
    });
  }, [api, clear, currentContextFor, exactContextFor, postTerminal, replaceSession]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<VscodeModulePreviewReferencePickStartRequest> & { type?: string };
      if (message.type === "modulePreviewReferencePickStartRequest") {
        if (!api) return;
        const request = event.data as VscodeModulePreviewReferencePickStartRequest;
        const previousRequest = requestRef.current;
        if (previousRequest) postTerminal(previousRequest, "canceled");
        clear();
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
        clear();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [api, clear, postTerminal, tryStart]);

  useEffect(() => {
    const request = requestRef.current;
    if (request) tryStart(request);
  }, [tryStart]);

  const confirm = useCallback((reference: CanonicalGeometrySourceReference) => {
    const current = sessionRef.current;
    const request = requestRef.current;
    if (!current || !request || !api) return false;
    const context = exactContextFor(request);
    if (!context) {
      postTerminal(request, "stale");
      clear();
      return false;
    }
    const currentCandidates = referencePickCandidates({
      compiled: context.compiled,
      evaluation: context.evaluation,
      target: context.target
    });
    const allowed = referencePickCandidateReferences(currentCandidates)
      .some((candidate) => referencePickReferenceKey(candidate) === referencePickReferenceKey(reference));
    if (!allowed || !isCanonicalReferencePickReference(reference)) {
      postTerminal(request, "rejected");
      clear();
      return false;
    }
    api.postMessage({
      type: "modulePreviewReferencePickResult",
      ...resultProofFor(request),
      status: "confirmed",
      resultKind: "geometry",
      references: [reference]
    });
    clear();
    return true;
  }, [api, clear, exactContextFor, postTerminal]);

  const cancel = useCallback(() => {
    const request = requestRef.current;
    if (!request || !api) return;
    postTerminal(request, "canceled");
    clear();
  }, [api, clear, postTerminal]);

  return { session, confirm, cancel };
};
