import { referencePickGraphFreshness, type VscodeReferencePickGraphContext } from "./referencePickGraphSnapshot";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import type { SourceSnapshot } from "@nuinuicad/nui-language";
import { referencePickDraftKey, startReferencePickSession } from "../model/referencePickSession";
import type { ReferencePickHover, ReferencePickSession } from "../model/referencePickSession";
import { referencePickNumericSubgeometryKey, type ReferencePickCandidate } from "../model/referencePickCandidates";
import type { NumericComputedGeometryProperty } from "../geometry/numericExpressions";
import type { EvaluationResult } from "../types/geometry";
import { canvasLayerVisibleElementIds, type CanvasLayerPresentation } from "../model/canvasLayerPresentation";
import {
  cancelVscodeReferencePickCanvasSession,
  referencePickSelectedText,
  referencePickDraftIsConfirmed,
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
  graph?: VscodeReferencePickGraphContext;
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

const candidatesVisibleInCanvasLayers = (
  candidates: readonly ReferencePickCandidate[],
  presentation: CanvasLayerPresentation | undefined
): readonly ReferencePickCandidate[] => {
  if (!presentation) return candidates;
  const visibleIds = canvasLayerVisibleElementIds(new Set(candidates.map(candidate => candidate.elementId)), presentation);
  return candidates.filter(candidate => visibleIds.has(candidate.elementId));
};

const visibleDraftForCandidates = (
  draft: ReferencePickSession,
  candidates: readonly ReferencePickCandidate[]
): ReferencePickSession => {
  const referenceIsVisible = (reference: ReferencePickSession["draftReferences"][number], numeric = false) =>
    candidates.some(candidate => candidate.options.some(option =>
      referencePickDraftKey(option.reference) === referencePickDraftKey(reference) &&
      (numeric ? option.kind === "numericProperty" : option.kind !== "numericProperty")
    ));
  const hoverIsVisible = (hover: NonNullable<ReferencePickSession["hover"]>) =>
    candidates.some(candidate => candidate.elementId === hover.candidateElementId && candidate.options.some(option =>
      referencePickDraftKey(option.reference) === referencePickDraftKey(hover.reference) &&
      (option.kind === "numericProperty"
        ? hover.numericSubgeometry === undefined ||
          referencePickNumericSubgeometryKey(option.subgeometry) === referencePickNumericSubgeometryKey(hover.numericSubgeometry)
        : hover.numericSubgeometry === undefined)
    ));

  const draftReferences = draft.draftReferences.filter(reference => referenceIsVisible(reference));
  const hover = draft.hover && hoverIsVisible(draft.hover) ? draft.hover : null;
  let numericProperty = draft.numericProperty;
  if (numericProperty) {
    const selected = numericProperty.selectedGeometry;
    const selectedOption = selected && candidates
      .find(candidate => candidate.elementId === selected.candidateElementId)
      ?.options.find(option => option.kind === "numericProperty" &&
        referencePickDraftKey(option.reference) === referencePickDraftKey(selected.reference) &&
        (selected.numericSubgeometry === undefined ||
          referencePickNumericSubgeometryKey(option.subgeometry) === referencePickNumericSubgeometryKey(selected.numericSubgeometry)));
    const numericDraft = numericProperty.draft;
    const numericDraftVisible = numericDraft && candidates
      .find(candidate => candidate.elementId === numericDraft.candidateElementId)
      ?.options.some(option => option.kind === "numericProperty" &&
        referencePickDraftKey(option.reference) === referencePickDraftKey(numericDraft.reference) &&
        option.properties.includes(numericDraft.property));
    if ((selected && !selectedOption) || (numericDraft && !numericDraftVisible) ||
        (numericDraft && !referenceIsVisible(numericDraft.reference, true))) {
      numericProperty = {
        ...numericProperty,
        stage: "geometrySelection",
        selectedGeometry: null,
        properties: [],
        draft: null
      };
    }
  }

  const draftChanged = draftReferences.length !== draft.draftReferences.length ||
    hover !== draft.hover || numericProperty !== draft.numericProperty;
  return draftChanged ? { ...draft, draftReferences, hover, numericProperty } : draft;
};

const visibleSessionForCanvasLayers = <TSession extends VscodeReferencePickCanvasSession>(
  session: TSession,
  presentation: CanvasLayerPresentation | undefined
): TSession => {
  if (!presentation) return session;
  const candidates = candidatesVisibleInCanvasLayers(session.candidates, presentation);
  const browseCandidates = session.browseCandidates
    ? candidatesVisibleInCanvasLayers(session.browseCandidates, presentation)
    : undefined;
  const draft = visibleDraftForCandidates(session.draft, candidates);
  const sameCandidates = candidates.length === session.candidates.length &&
    candidates.every((candidate, index) => candidate === session.candidates[index]);
  const sameBrowseCandidates = browseCandidates === undefined
    ? session.browseCandidates === undefined
    : browseCandidates.length === session.browseCandidates?.length &&
      browseCandidates.every((candidate, index) => candidate === session.browseCandidates?.[index]);
  if (draft === session.draft && sameCandidates && sameBrowseCandidates) return session;
  return { ...session, candidates, ...(browseCandidates ? { browseCandidates } : {}), draft };
};

const sessionWithLiveDraftVisibility = (
  session: VscodeReferencePickCanvasSession,
  presentation: CanvasLayerPresentation | undefined
): VscodeReferencePickCanvasSession => {
  const visible = visibleSessionForCanvasLayers(session, presentation);
  return visible.draft === session.draft ? session : { ...session, draft: visible.draft };
};

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
  canvasLayerPresentation,
  canStart = () => true
}: {
  api: VscodeWebviewApi | null;
  currentContextFor: () => VscodeReferencePickCurrentContext | null;
  currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
  prepareCandidateSnapshot?: (
    request: ReferencePickStartRequest,
    current: VscodeReferencePickCurrentContext
  ) => Promise<VscodeReferencePickCanvasSnapshot | null>;
  /** The exact live Canvas Layer projection used by the host Canvas. */
  canvasLayerPresentation?: CanvasLayerPresentation;
  canStart?: () => boolean;
}) => {
  const [session, setSession] = useState<VscodeReferencePickCanvasSession | null>(null);
  const sessionRef = useRef<VscodeReferencePickCanvasSession | null>(null);
  const pendingStartRequestRef = useRef<ReferencePickStartRequest | null>(null);
  const preparingRef = useRef<{ request: ReferencePickStartRequest } | null>(null);
  const activeCompiledRef = useRef<CompiledDslDocument | null>(null);
  const [candidateSnapshot, setCandidateSnapshot] = useState<VscodeReferencePickCanvasSnapshot | null>(null);
  const canvasLayerPresentationRef = useRef(canvasLayerPresentation);
  useLayoutEffect(() => {
    canvasLayerPresentationRef.current = canvasLayerPresentation;
  }, [canvasLayerPresentation]);
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
    deferUnusableSnapshot = false,
    browseOnly = false
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
      requireCandidates: deferUnusableSnapshot,
      browseOnly: browseOnly || snapshot?.browseOnly === true,
      ...(snapshot ? { candidateSnapshot: snapshot } : {})
    });
    // A pinned render is not candidate authority until the shared session
    // proves continuity and supplies candidates. An unrelated or empty pinned
    // render must not suppress incomplete-source projection. The projected
    // result and ordinary current/empty selections keep their existing policy.
    if (deferUnusableSnapshot && (started.result.status === "stale" || started.result.status === "rejected" || (started.session?.mode === "browse" && started.session.candidates.length === 0))) return false;
    pendingStartRequestRef.current = null;
    // The Extension Host retains this full compiler-authoritative allowlist for
    // the Pick lifetime. The live Webview projection below gates what can be
    // shown or acted on while still allowing a hidden candidate to return.
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
    const graphFreshness = referencePickGraphFreshness(message, current.source.normalizedSource, current.graph);
    if (graphFreshness === "defer") {
      pendingStartRequestRef.current = message;
      return;
    }
    if (graphFreshness === "stale") {
      pendingStartRequestRef.current = null;
      postStale(message);
      return;
    }
    if (message.graphSnapshot) {
      const prepared = message.graphSnapshot;
      pendingStartRequestRef.current = null;
      const next = { ...prepared.session, request: message };
      // Keep the same host authority as locally projected sessions; only the
      // Canvas session exposed to rendering and interaction is layer-filtered.
      api.postMessage(prepared.result);
      replaceSession(next);
      activeCompiledRef.current = current.compiled;
      return;
    }
    const needsProjection = !current.compiled.document || [...current.compiled.diagnostics, ...current.compiled.bindingIssueDiagnostics ?? []].some(d => d.severity === "error");
    if (current.evaluationIsCurrent || current.canvasSnapshot) {
      const defer = needsProjection && Boolean(prepareCandidateSnapshot) || message.mode !== "browse" && Boolean(current.canvasSnapshot) && !current.evaluationIsCurrent;
      if (start(message, current, authoritative, undefined, defer)) return;
    }
    pendingStartRequestRef.current = message;
    if (needsProjection && prepareCandidateSnapshot && preparingRef.current?.request !== message) {
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
        if (snapshot && start(message, latest, authority, snapshot, true)) return;
        start(message, latest, authority, snapshot ?? latest.canvasSnapshot, false, true);
      });
    } else if (current.evaluationIsCurrent || current.canvasSnapshot) {
      start(message, current, authoritative, current.canvasSnapshot, false, true);
    }
  }, [api, canStart, currentContextFor, currentReferencePickAuthorityFor, postStale, prepareCandidateSnapshot, replaceSession, start]);

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
      !contextMatchesAuthority(active.request, activeAuthority, current) ||
      referencePickGraphFreshness(active.request, current.source.normalizedSource, current.graph) !== "ready")) {
      postStale(active.request);
      replaceSession(null);
    } else if (active) {
      const visible = sessionWithLiveDraftVisibility(active, canvasLayerPresentationRef.current);
      if (visible !== active) replaceSession(visible);
    }

    const currentPending = pendingStartRequestRef.current;
    if (currentPending) tryStart(currentPending);
  }, [canvasLayerPresentation, currentContextFor, currentReferencePickAuthorityFor, postStale, replaceSession, tryStart]);

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
    const presentation = canvasLayerPresentationRef.current;
    if (hover && !visibleSessionForCanvasLayers(current, presentation).candidates.some(candidate =>
      candidate.elementId === hover.candidateElementId
    )) return;
    const safe = sessionWithLiveDraftVisibility(current, presentation);
    replaceSession(setVscodeReferencePickCanvasHover(safe, hover));
  }, [replaceSession]);

  const select = useCallback((selection: ReferencePickHover | null) => {
    const current = sessionRef.current;
    if (!current) return;
    const presentation = canvasLayerPresentationRef.current;
    if (selection && !visibleSessionForCanvasLayers(current, presentation).candidates.some(candidate =>
      candidate.elementId === selection.candidateElementId
    )) return;
    const safe = sessionWithLiveDraftVisibility(current, presentation);
    replaceSession(selectVscodeReferencePickCanvasDraft(safe, selection));
  }, [replaceSession]);

  const selectNumericProperty = useCallback((property: NumericComputedGeometryProperty) => {
    const current = sessionRef.current;
    if (!current) return;
    const safe = sessionWithLiveDraftVisibility(current, canvasLayerPresentationRef.current);
    replaceSession(selectVscodeReferencePickCanvasNumericProperty(safe, property));
  }, [replaceSession]);

  const moveDraftEntry = useCallback((referenceKey: string, toIndex: number) => {
    const current = sessionRef.current;
    if (!current) return;
    const safe = sessionWithLiveDraftVisibility(current, canvasLayerPresentationRef.current);
    replaceSession(moveVscodeReferencePickCanvasDraft(safe, referenceKey, toIndex));
  }, [replaceSession]);

  const removeDraftEntry = useCallback((referenceKey: string) => {
    const current = sessionRef.current;
    if (!current) return;
    const safe = sessionWithLiveDraftVisibility(current, canvasLayerPresentationRef.current);
    replaceSession(removeVscodeReferencePickCanvasDraft(safe, referenceKey));
  }, [replaceSession]);

  const browse = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const safe = sessionWithLiveDraftVisibility(current, canvasLayerPresentationRef.current);
    replaceSession({ ...safe, target: null, mode: "browse",
      candidates: (safe.browseCandidates ?? safe.candidates).map(c => ({ ...c, options: c.options.map(o => ({ ...o,
        authority: { status: "unverified", reason: "Browse has no proven destination operand; explicit insertion requires confirmation" }
      })) })),
      draft: startReferencePickSession({ expectedGeometryInterface: "path", role: "geometry", multiplicity: "single" }) });
  }, [replaceSession]);

  const explicit = useCallback((status: "copy" | "explicit-edit") => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const visible = visibleSessionForCanvasLayers(current, canvasLayerPresentationRef.current);
    if (!referencePickSelectedText(visible)) return;
    const numeric = visible.draft.numericProperty?.draft;
    const reference = numeric?.reference ?? visible.draft.draftReferences[0];
    if (!reference) return;
    api.postMessage({ type: "referencePickResult", requestId: current.request.requestId, documentUri: current.request.documentUri, documentVersion: current.request.documentVersion, targetProof: current.request.targetProof, snapshot: current.snapshot, status, reference, ...(numeric ? { property: numeric.property } : {}) });
  }, [api]);

  const confirm = useCallback(() => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const context = currentContextFor();
    const authority = currentReferencePickAuthorityFor(current.request.documentVersion);
    if (!context || context.compiled !== activeCompiledRef.current ||
      !contextMatchesAuthority(current.request, authority, context) ||
      referencePickGraphFreshness(current.request, context.source.normalizedSource, context.graph) !== "ready") {
      postStale(current.request);
      replaceSession(null);
      return;
    }
    const visible = visibleSessionForCanvasLayers(current, canvasLayerPresentationRef.current);
    if (!current.target || !referencePickDraftIsConfirmed(visible)) { explicit("explicit-edit"); return; }
    const confirmed = confirmVscodeReferencePickCanvasSession(visible);
    if (!confirmed.result) {
      replaceSession(confirmed.session);
      return;
    }
    api.postMessage(confirmed.result);
    replaceSession(null);
  }, [api, currentContextFor, currentReferencePickAuthorityFor, explicit, postStale, replaceSession]);

  const copy = useCallback(() => explicit("copy"), [explicit]);
  const insert = useCallback(() => explicit("explicit-edit"), [explicit]);

  const cancel = useCallback(() => {
    const current = sessionRef.current;
    if (!current || !api) return;
    const canceled = cancelVscodeReferencePickCanvasSession(current);
    if (canceled.result) api.postMessage(canceled.result);
    replaceSession(null);
  }, [api, replaceSession]);

  const visibleSession = session
    ? visibleSessionForCanvasLayers(session, canvasLayerPresentation)
    : null;

  return {
    session: visibleSession,
    candidateSnapshot,
    setHover,
    select,
    selectNumericProperty,
    moveDraftEntry,
    removeDraftEntry,
    confirm,
    browse,
    copy,
    insert,
    cancel
  };
};
