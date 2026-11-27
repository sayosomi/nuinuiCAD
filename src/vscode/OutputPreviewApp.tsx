import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent } from "react";
import { CommandRibbonView } from "../components/CommandRibbonView";
import { canvasThemeCssVariables, LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluateElementsWithRust } from "../geometry/evaluationEngine";
import { evaluateOutputPlan, type OutputDrawable, type OutputPlan, type OutputText } from "../output/outputCore";
import { projectOutputPlanForPlaceTranslation } from "../output/outputPlaceDisplayProjection";
import { panViewportByScreenDelta, VIEWPORT_ZOOM_STEP } from "../geometry/viewport";
import { projectOutputPlaces } from "../output/outputPlaceProjection";
import {
  projectDslOutputPreviewRevealRuntimeTarget,
  queryDslOutputPreviewRevealSourceTarget,
  type DslOutputPreviewRevealRuntimeTarget
} from "@nuinuicad/nui-language";
import {
  resolveOutputPreviewReveal,
  type OutputPreviewRevealTarget
} from "../output/outputPreviewReveal";
import {
  effectiveCompiledDocument,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { OutputPreviewPlaceOverlay } from "./OutputPreviewPlaceOverlay";
import { VscodeRustTransport } from "./vscodeRustTransport";
import {
  outputPreviewGraphAuthorityFor,
  outputPreviewRequiresGraph,
  outputPreviewSourceEditingFor,
  sameOutputPreviewGraphAuthority,
  type VscodeMultiDocumentGraphPublication,
  type VscodeOutputPreviewGraphAuthority
} from "./multiDocumentGraphTransport";
import { outputPreviewDiagnosticSourceRangeFor } from "./outputPreviewDiagnostics";
import {
  beginOutputPreviewPlaceDrag,
  outputPreviewPlaceCoordinatePatchesFor,
  outputPreviewPlaceDragProofIsCurrent,
  outputPreviewPlacePreviewSourceFor,
  type OutputPreviewPlaceDragPlanIdentity,
  type OutputPreviewPlaceDragProof
} from "./outputPreviewPlaceDrag";
import {
  outputPreviewCandidateForKey,
  outputPreviewCandidatesFor,
  selectOutputPreviewCandidate,
  type OutputPreviewCandidate
} from "./outputPreviewSelection";
import {
  DEFAULT_OUTPUT_PREVIEW_VIEWPORT,
  fitOutputPreviewViewport,
  fitOutputPreviewRevealViewport,
  outputPreviewFitBoundsFor,
  outputPreviewScreenToWorld,
  outputPreviewWorldToScreen,
  resetOutputPreviewViewport,
  type OutputPreviewViewport,
  type OutputPreviewViewportSize,
  zoomOutputPreviewViewportAt
} from "./outputPreviewViewport";
import {
  outputPreviewGuideLinesFor,
  outputPreviewPageRectsFor,
  outputPreviewPathDataFor,
  outputPreviewTextTransformFor
} from "./outputPreviewRendering";
import {
  vscodeWebviewContextDataFor,
  type ExtensionToVscodeMessage,
  type VscodeOutputPreviewRevealRequest,
  type VscodeOutputPreviewRevealResult,
  type VscodeWebviewApi
} from "./protocol";
import { VSCODE_CANVAS_RIBBON_ICON_SIZE } from "./vscodeCanvasRibbonConfig";
import { resolveVscodeLucideIcon, vscodeLucideIconName } from "./vscodeCanvasRibbonIcons";
import {
  vscodeViewportCoordinatesPresentationFor,
  vscodeViewportZoomPresentationFor
} from "./vscodeViewportStatus";
import { readVSCodeCanvasTheme } from "./vscodeCanvasTheme";
import { useNativePointerBoundaryFallback } from "../components/nativePointerBoundaryFallback";
import { webviewCanvasPresentationFor } from "./webviewCanvasPresentation";
import {
  useVscodeWebviewPresentation,
  webviewDiagnosticTextFor,
  webviewPresentationTextFor
} from "./webviewPresentation";

type OutputPreviewEvaluationState = {
  outputKey: string | null;
  sourceRevision: number | null;
  plan: OutputPlan | null;
  error: string | null;
  evaluating: boolean;
};

type OutputPreviewGraphContext = {
  authority: VscodeOutputPreviewGraphAuthority;
  compiled: LastGoodDslDocument;
  dependencyIdentity: string;
};

type OutputPreviewHostSource = {
  uri: string | undefined;
  version: number;
  text: string;
  requiresGraph: boolean;
};

const graphAwaitsSource = (
  source: OutputPreviewHostSource,
  publication: VscodeMultiDocumentGraphPublication | null
): boolean => publication?.hostDocumentUri === source.uri &&
  publication?.documentVersion != null && publication.documentVersion > source.version;

type OutputPreviewPlaceDragPreviewState = {
  proof: OutputPreviewPlaceDragProof;
  basePlan: OutputPlan;
  plan: OutputPlan;
  outputKey: string;
  candidates: readonly OutputPreviewCandidate[];
  sourceText: string;
  compiledDocument: LastGoodDslDocument;
  documentUri: string | undefined;
  originalGraphAuthority: VscodeOutputPreviewGraphAuthority | null;
  graphAuthority: VscodeOutputPreviewGraphAuthority | null;
  graphDependencyIdentity: string | null;
  phase: "dragging" | "commit-pending";
  expectedSourceText?: string;
  expectedDocumentVersion?: number;
};

type OutputPreviewRevealState =
  | { status: "idle" }
  | {
      status: "pending";
      requestId: number;
      documentVersion: number;
      sourceRevision: number;
    }
  | {
      status: "resolved";
      requestId: number;
      documentVersion: number;
      sourceRevision: number;
      outputKey: string;
      plan: OutputPlan;
      highlightedDrawables: readonly OutputDrawable[];
    }
  | {
      status: "failed";
      requestId: number;
      documentVersion: number;
      sourceRevision: number;
      reason: Extract<VscodeOutputPreviewRevealResult, { status: "failed" }>["reason"];
    };

type OutputPreviewPanMode = "middle" | "space-primary";
type PanState = { pointerId: number; lastX: number; lastY: number; mode: OutputPreviewPanMode };
type OutputPreviewClientPoint = { clientX: number; clientY: number };
type OutputPreviewViewportClientOrigin = { left: number; top: number };

const diagnosticMessageFor = (
  state: Pick<ReturnType<typeof useCadDocumentStore.getState>, "diagnostics" | "bindingIssueDiagnostics">,
  presentation: Parameters<typeof webviewDiagnosticTextFor>[0]
): string => {
  const diagnostic = state.diagnostics[0] ?? state.bindingIssueDiagnostics[0];
  return diagnostic
    ? webviewDiagnosticTextFor(presentation, diagnostic)
    : webviewPresentationTextFor(
        presentation,
        "output.noValidPlan",
        "The current source cannot produce a valid output plan."
      );
};

const outputKindLabel = (
  candidate: OutputPreviewCandidate,
  presentation: Parameters<typeof webviewPresentationTextFor>[0]
): string => webviewPresentationTextFor(
  presentation,
  candidate.kind === "print" ? "output.kind.print" : "output.kind.svg",
  candidate.kind === "print" ? "Print" : "SVG"
);

const outputTextLines = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n");
const normalizedSourceForDrag = (text: string): string => text.replace(/\r\n/g, "\n");

const graphDependencyIdentityFor = (graph: VscodeMultiDocumentGraphPublication["graph"]): string | null => {
  if (!graph) return null;
  return JSON.stringify({
    valid: graph.valid,
    nodes: graph.nodes.map((node) => ({ documentId: node.documentId, valid: node.valid }))
      .sort((left, right) => left.documentId.localeCompare(right.documentId)),
    edges: graph.edges.map(({ importerDocumentId, importPath, alias, targetDocumentId, status }) => ({
      importerDocumentId, importPath, alias, targetDocumentId: targetDocumentId ?? null, status
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    dependencyFingerprints: [...graph.dependencyFingerprints]
      .map(({ documentId, savedSourceFingerprint }) => ({ documentId, savedSourceFingerprint }))
      .sort((left, right) => left.documentId.localeCompare(right.documentId))
  });
};
const outputPreviewPointerBoundaryFallbackShouldRun = (event: PointerEvent): boolean => {
  const target = event.target;
  return !(target instanceof Element && target.closest(".output-preview-place-popover"));
};
const dragPlanIdentityForCandidate = (
  candidate: OutputPreviewCandidate | null
): OutputPreviewPlaceDragPlanIdentity | null => candidate ? {
  kind: candidate.kind,
  outputId: candidate.output.id,
  layoutId: candidate.output.layoutId
} : null;

const outputTextSvg = (
  drawable: OutputText,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
) => {
  const lines = outputTextLines(drawable.text);
  return (
    <text
      key={`${drawable.elementId}-${drawable.anchor.x}-${drawable.anchor.y}`}
      transform={outputPreviewTextTransformFor(drawable, size, viewport)}
      data-output-preview-layer="geometry"
      fill={drawable.colorHex}
      fontFamily="HeiseiKakuGo-W5, sans-serif"
      fontSize={drawable.fontSizeMm}
      dominantBaseline="alphabetic"
    >
      {lines.map((line, index) => (
        <tspan
          key={`${index}-${line}`}
          x={0}
          y={index * drawable.lineHeightMm}
          textLength={drawable.lineWidthsMm[index] || undefined}
          lengthAdjust="spacingAndGlyphs"
        >
          {line}
        </tspan>
      ))}
    </text>
  );
};

const drawableSvg = (
  drawable: OutputDrawable,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport
) => {
  if (drawable.kind === "text") return outputTextSvg(drawable, size, viewport);
  const path = outputPreviewPathDataFor(drawable, size, viewport);
  if (!path) return null;
  return (
    <path
      key={`${drawable.elementId}-${drawable.kind}-${path}`}
      d={path}
      data-output-preview-layer="geometry"
      fill={drawable.fill?.colorHex ?? "none"}
      fillOpacity={drawable.fill?.opacity}
      stroke={drawable.stroke.colorHex}
      strokeWidth={drawable.stroke.widthMm * viewport.zoom}
      strokeDasharray={drawable.stroke.style === "dashed" ? "6 4" : drawable.stroke.style === "dotted" ? "1 3" : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
};

const highlightedDrawableSvg = (
  drawable: OutputDrawable,
  size: OutputPreviewViewportSize,
  viewport: OutputPreviewViewport,
  layer: "place-highlight" | "reveal-highlight",
  occurrenceIndex: number
) => {
  if (drawable.kind === "text") {
    const lines = outputTextLines(drawable.text);
    return (
      <text
        key={`highlight-${layer}-${occurrenceIndex}-${drawable.elementId}-${drawable.anchor.x}-${drawable.anchor.y}`}
        transform={outputPreviewTextTransformFor(drawable, size, viewport)}
        data-output-preview-layer={layer}
        fill="var(--canvas-selection)"
        fontFamily="HeiseiKakuGo-W5, sans-serif"
        fontSize={drawable.fontSizeMm}
        dominantBaseline="alphabetic"
        opacity={0.55}
        pointerEvents="none"
      >
        {lines.map((line, index) => (
          <tspan
            key={`${index}-${line}`}
            x={0}
            y={index * drawable.lineHeightMm}
            textLength={drawable.lineWidthsMm[index] || undefined}
            lengthAdjust="spacingAndGlyphs"
          >
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  const path = outputPreviewPathDataFor(drawable, size, viewport);
  if (!path) return null;
  return (
    <path
      key={`highlight-${layer}-${occurrenceIndex}-${drawable.elementId}-${drawable.kind}-${path}`}
      d={path}
      data-output-preview-layer={layer}
      fill="none"
      stroke="var(--canvas-selection)"
      strokeWidth={Math.max(3, drawable.stroke.widthMm * viewport.zoom + 3)}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.72}
      pointerEvents="none"
    />
  );
};

export const OutputPreviewApp = ({ api }: { api: VscodeWebviewApi }) => {
  const webviewPresentation = useVscodeWebviewPresentation();
  const canvasPresentationAdapter = useMemo(
    () => webviewCanvasPresentationFor(webviewPresentation),
    [webviewPresentation]
  );
  const [hostSource, setHostSource] = useState<OutputPreviewHostSource | null>(null);
  const [awaitingSource, setAwaitingSource] = useState(false);
  const hostSourceRef = useRef<OutputPreviewHostSource | null>(null);
  const [graphContext, setGraphContext] = useState<OutputPreviewGraphContext | null>(null);
  const graphContextRef = useRef<OutputPreviewGraphContext | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const pendingGraphRef = useRef<VscodeMultiDocumentGraphPublication | null>(null);
  const graphSequenceRef = useRef(0);
  const graphRevisionsRef = useRef(new Map<string, number>());
  const localSourceText = useCadDocumentStore((state) => state.sourceText);
  const docText = useCadDocumentStore((state) => state.docText);
  const localSourceRevision = useCadDocumentStore((state) => state.currentSourceRevision);
  const localCompiled = useCadDocumentStore(effectiveCompiledDocument);
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  const bindingIssueDiagnostics = useCadDocumentStore((state) => state.bindingIssueDiagnostics);
  const graphBound = hostSource?.requiresGraph === true;
  const sourceText = graphBound ? hostSource.text : localSourceText;
  const currentSourceRevision = graphContext?.authority.rootSourceRevision ?? localSourceRevision;
  const canonicalCompiledDocument = graphContext?.compiled ?? localCompiled;
  const sourceIsCurrent = !awaitingSource && (graphBound ? graphContext !== null : sourceText === docText);
  const graphAuthority = graphContext?.authority;
  const [placeDragPreview, setPlaceDragPreview] = useState<OutputPreviewPlaceDragPreviewState | null>(null);
  const placeDragPreviewRef = useRef<OutputPreviewPlaceDragPreviewState | null>(null);
  const setPlaceDragPreviewCurrent = useCallback((next: OutputPreviewPlaceDragPreviewState | null) => {
    placeDragPreviewRef.current = next;
    setPlaceDragPreview(next);
  }, []);
  const [authoritativeContextGeneration, setAuthoritativeContextGeneration] = useState(0);
  const effectiveSourceText = placeDragPreview?.sourceText ?? sourceText;
  const compiledDocument = placeDragPreview?.compiledDocument ?? canonicalCompiledDocument;
  const canonicalCandidates = useMemo(
    () => sourceIsCurrent ? outputPreviewCandidatesFor(sourceText, canonicalCompiledDocument) : [],
    [canonicalCompiledDocument, sourceIsCurrent, sourceText]
  );
  const displayCandidates = placeDragPreview?.candidates ?? canonicalCandidates;
  const [selectedOutputKey, setSelectedOutputKey] = useState<string | null>(null);
  const [viewport, setViewport] = useState<OutputPreviewViewport>(DEFAULT_OUTPUT_PREVIEW_VIEWPORT);
  const [viewportSize, setViewportSize] = useState<OutputPreviewViewportSize>({ width: 0, height: 0 });
  const latestViewportSizeRef = useRef(viewportSize);
  useLayoutEffect(() => {
    latestViewportSizeRef.current = viewportSize;
  }, [viewportSize]);
  const [viewportClientOrigin, setViewportClientOrigin] = useState<OutputPreviewViewportClientOrigin>({ left: 0, top: 0 });
  const [pointerClientPosition, setPointerClientPosition] = useState<OutputPreviewClientPoint | null>(null);
  const [evaluationState, setEvaluationState] = useState<OutputPreviewEvaluationState>({
    outputKey: null,
    sourceRevision: null,
    plan: null,
    error: null,
    evaluating: false
  });
  const [highlightedPlaceId, setHighlightedPlaceId] = useState<string | null>(null);
  const [canvasTheme, setCanvasTheme] = useState(LEGACY_CANVAS_THEME);
  const [clearPlaceInteractionKey, setClearPlaceInteractionKey] = useState(0);
  const [pendingExportRequestId, setPendingExportRequestId] = useState<number | null>(null);
  const [revealState, setRevealState] = useState<OutputPreviewRevealState>({ status: "idle" });
  const workspaceRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanState | null>(null);
  const spaceHeldRef = useRef(false);
  const [reactHandledPointerEvents] = useState(() => new WeakSet<Event>());
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const outputPreviewPlaceCommitPendingRef = useRef<number | null>(null);
  const graphDragProofRef = useRef<OutputPreviewPlaceDragProof | null>(null);
  const pendingOpenRef = useRef<{ normalizedSourceOffset: number | null } | null>(null);
  const selectionGenerationRef = useRef(0);
  const fittedSelectionTokenRef = useRef<string | null>(null);
  const selectedOutputKeyRef = useRef<string | null>(selectedOutputKey);
  const latestPlanRef = useRef<OutputPlan | null>(null);
  const fitPlanRef = useRef<(plan: OutputPlan | null) => boolean>(() => false);
  const outputPlanEvaluationTailRef = useRef(Promise.resolve());
  const nextExportRequestIdRef = useRef(1);
  const nextPlanRequestIdRef = useRef(1);
  const pendingGraphPlansRef = useRef(new Map<number, {
    authority: VscodeOutputPreviewGraphAuthority;
    candidate: OutputPreviewCandidate;
    resolve: (plan: OutputPlan) => void;
    reject: (error: Error) => void;
  }>());
  const contextGenerationRef = useRef(0);
  const requestCurrentExportRef = useRef<() => boolean>(() => false);
  const revealGenerationRef = useRef(0);
  const pendingRevealResponseRef = useRef<VscodeOutputPreviewRevealResult | null>(null);
  const preserveViewportForSelectionRef = useRef<string | null>(null);
  const rustTransport = useMemo(() => new VscodeRustTransport(api.postMessage), [api]);

  const markReactPointerEvent = (event: React.PointerEvent): void => {
    reactHandledPointerEvents.add(event.nativeEvent ?? event as unknown as Event);
  };

  const pointerWorldPoint = useMemo(
    () => pointerClientPosition
      ? outputPreviewScreenToWorld({
          x: pointerClientPosition.clientX - viewportClientOrigin.left,
          y: pointerClientPosition.clientY - viewportClientOrigin.top
        }, viewportSize, viewport)
      : null,
    [pointerClientPosition, viewport, viewportClientOrigin, viewportSize]
  );

  const measureViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width < 0 ||
      rect.height < 0
    ) return;
    setViewportClientOrigin((current) => current.left === rect.left && current.top === rect.top
      ? current
      : { left: rect.left, top: rect.top });
    setViewportSize((current) => current.width === rect.width && current.height === rect.height
      ? current
      : { width: rect.width, height: rect.height });
  }, []);

  const fitPlan = useCallback((plan: OutputPlan | null): boolean => {
    if (!plan || viewportSize.width <= 0 || viewportSize.height <= 0) return false;
    const bounds = outputPreviewFitBoundsFor(plan);
    if (!bounds) return false;
    setViewport(fitOutputPreviewViewport(bounds, viewportSize));
    return true;
  }, [viewportSize]);

  const applyRevealViewportFit = useCallback((drawables: readonly OutputDrawable[]): void => {
    setViewport((current) => fitOutputPreviewRevealViewport(
      drawables,
      latestViewportSizeRef.current,
      current
    ) ?? current);
  }, []);

  const updateSelectedOutputKey = useCallback((nextKey: string | null, preserveViewport = false) => {
    if (selectedOutputKeyRef.current === nextKey) return;
    const pendingPlacement = placeDragPreviewRef.current;
    if (pendingPlacement && pendingPlacement.outputKey !== nextKey) {
      outputPreviewPlaceCommitPendingRef.current = null;
      graphDragProofRef.current = null;
      setPlaceDragPreviewCurrent(null);
    }
    preserveViewportForSelectionRef.current = preserveViewport ? nextKey : null;
    selectedOutputKeyRef.current = nextKey;
    selectionGenerationRef.current += 1;
    setSelectedOutputKey(nextKey);
  }, [setPlaceDragPreviewCurrent]);

  const clearExplicitReveal = useCallback(() => {
    revealGenerationRef.current += 1;
    pendingRevealResponseRef.current = null;
    preserveViewportForSelectionRef.current = null;
    setRevealState({ status: "idle" });
  }, []);

  const rejectPendingGraphPlans = useCallback(() => {
    for (const pending of pendingGraphPlansRef.current.values()) {
      pending.reject(new Error("The Output Preview graph changed during evaluation."));
    }
    pendingGraphPlansRef.current.clear();
  }, []);

  const invalidateAuthority = useCallback((preservePlacementPreview = false) => {
    contextGenerationRef.current += 1;
    if (!preservePlacementPreview) outputPreviewPlaceCommitPendingRef.current = null;
    graphDragProofRef.current = null;
    requestCurrentExportRef.current = () => false;
    latestPlanRef.current = null;
    rejectPendingGraphPlans();
    setEvaluationState({ outputKey: null, sourceRevision: null, plan: null, error: null, evaluating: false });
    setPendingExportRequestId(null);
    if (!preservePlacementPreview) setPlaceDragPreviewCurrent(null);
    clearExplicitReveal();
    setAuthoritativeContextGeneration(contextGenerationRef.current);
  }, [clearExplicitReveal, rejectPendingGraphPlans, setPlaceDragPreviewCurrent]);

  const receiveGraphPublication = useCallback((publication: VscodeMultiDocumentGraphPublication) => {
    const sequence = publication.outputPreview?.sequence;
    if (sequence === undefined || !Number.isSafeInteger(sequence) || sequence <= graphSequenceRef.current) return;
    const source = hostSourceRef.current;
    const pendingPlacement = placeDragPreviewRef.current;
    if (source && publication.hostDocumentUri !== source.uri) {
      if (pendingPlacement?.phase === "commit-pending" && publication.status === "current") {
        setAwaitingSource(true);
        graphContextRef.current = null;
        setGraphContext(null);
        setGraphError(null);
        invalidateAuthority();
      }
      return;
    }
    const pendingGraphBuild = pendingPlacement?.phase === "commit-pending" &&
      publication.hostDocumentUri === pendingPlacement.documentUri &&
      (publication.documentVersion === pendingPlacement.expectedDocumentVersion || publication.documentVersion === null) &&
      (publication.status === "building" || publication.status === "invalidated");
    if (pendingGraphBuild) {
      graphSequenceRef.current = sequence;
      graphContextRef.current = null;
      setGraphContext(null);
      setAwaitingSource(true);
      setGraphError(null);
      invalidateAuthority(true);
      return;
    }
    if (publication.status === "current" && (
      publication.graph.rootDocumentId !== publication.hostDocumentUri ||
      publication.graph.rootSource.documentId !== publication.hostDocumentUri
    )) {
      if (pendingPlacement?.phase === "commit-pending" &&
        publication.hostDocumentUri === pendingPlacement.documentUri &&
        publication.documentVersion === pendingPlacement.expectedDocumentVersion) {
        graphSequenceRef.current = sequence;
        setGraphError("The Output Preview graph does not match the committed Source document.");
        setAwaitingSource(false);
        invalidateAuthority();
      }
      return;
    }
    if (!source || graphAwaitsSource(source, publication)) {
      const matchingPendingRoot = pendingPlacement?.phase === "commit-pending" &&
        publication.hostDocumentUri === pendingPlacement.documentUri &&
        publication.documentVersion === pendingPlacement.expectedDocumentVersion;
      let preservePendingPlacement = Boolean(
        matchingPendingRoot &&
        (publication.status === "building" || publication.status === "invalidated")
      );
      if (matchingPendingRoot && pendingPlacement && publication.status === "current") {
        const authority = outputPreviewGraphAuthorityFor(
          publication,
          pendingPlacement.documentUri!,
          pendingPlacement.expectedDocumentVersion!,
          pendingPlacement.expectedSourceText!
        );
        const editing = outputPreviewSourceEditingFor(publication);
        const dependencyIdentity = graphDependencyIdentityFor(publication.graph);
        preservePendingPlacement = Boolean(
          authority &&
          editing &&
          dependencyIdentity !== null &&
          dependencyIdentity === pendingPlacement.graphDependencyIdentity &&
          outputPreviewCandidateForKey(
            outputPreviewCandidatesFor(pendingPlacement.expectedSourceText!, editing.compiled),
            pendingPlacement.outputKey
          )
        );
      }
      const pending = pendingGraphRef.current;
      if (sequence > (pending?.outputPreview?.sequence ?? 0) &&
        (publication.documentVersion ?? 0) >= (pending?.documentVersion ?? 0)) {
        pendingGraphRef.current = publication;
      }
      if (source) {
        setAwaitingSource(true);
        graphContextRef.current = null;
        setGraphContext(null);
        setGraphError(null);
        invalidateAuthority(preservePendingPlacement);
      } else if (
        pendingPlacement?.phase === "commit-pending" &&
        publication.status === "current" &&
        !preservePendingPlacement
      ) {
        invalidateAuthority();
      }
      return;
    }
    const expectedPendingRoot = pendingPlacement?.phase === "commit-pending" &&
      source.uri === pendingPlacement.documentUri &&
      source.version === pendingPlacement.expectedDocumentVersion &&
      normalizedSourceForDrag(source.text) === pendingPlacement.expectedSourceText;
    if (!source.requiresGraph || !source.uri ||
      (pendingGraphRef.current?.documentVersion ?? 0) > source.version ||
      (publication.documentVersion !== null && publication.documentVersion !== source.version)) return;
    let next: OutputPreviewGraphContext | null = null;
    let error: string | null = null;
    if (publication.status === "current") {
      const authority = outputPreviewGraphAuthorityFor(publication, source.uri, source.version, normalizedSourceForDrag(source.text));
      if (!authority) {
        if (expectedPendingRoot) {
          graphSequenceRef.current = sequence;
          setGraphError("The Output Preview graph does not match the committed Source document.");
          setAwaitingSource(false);
          invalidateAuthority();
        }
        return;
      }
      const newest = graphRevisionsRef.current.get(source.uri) ?? 0;
      if (authority.graphRevision <= newest) return;
      graphRevisionsRef.current.set(source.uri, authority.graphRevision);
      const editing = outputPreviewSourceEditingFor(publication);
      if (editing) next = {
        authority,
        compiled: editing.compiled,
        dependencyIdentity: graphDependencyIdentityFor(publication.graph) ?? ""
      };
      else error = publication.outputPreview?.error ?? publication.graph.diagnostics[0]?.message ?? "";
    } else if (publication.status !== "building") {
      error = "";
    }
    graphSequenceRef.current = sequence;
    const preservePendingPlacement = Boolean(
      expectedPendingRoot && pendingPlacement && publication.status === "current" && next &&
      pendingPlacement.graphDependencyIdentity !== null &&
      next.dependencyIdentity === pendingPlacement.graphDependencyIdentity &&
      outputPreviewCandidateForKey(
        outputPreviewCandidatesFor(source.text, next.compiled), pendingPlacement.outputKey
      )
    );
    if (preservePendingPlacement && pendingPlacement && next) {
      setPlaceDragPreviewCurrent({ ...pendingPlacement, graphAuthority: next.authority });
    }
    graphContextRef.current = next;
    setGraphContext(next);
    setGraphError(error);
    setAwaitingSource(false);
    invalidateAuthority(preservePendingPlacement);
  }, [invalidateAuthority, setPlaceDragPreviewCurrent]);

  const evaluateOutputPlanSerially = useCallback((request: Parameters<typeof evaluateOutputPlan>[0]) => {
    const evaluation = outputPlanEvaluationTailRef.current.then(() => evaluateOutputPlan(request));
    outputPlanEvaluationTailRef.current = evaluation.then(() => undefined, () => undefined);
    return evaluation;
  }, []);

  const evaluateOutputPlanWithRust = useCallback((
    document: LastGoodDslDocument,
    output: Parameters<typeof evaluateOutputPlan>[0]["output"]
  ) => evaluateOutputPlanSerially({
    compiledDocument: document,
    output,
    evaluate: (elements, options) => evaluateElementsWithRust(elements, options, rustTransport.transport)
  }), [evaluateOutputPlanSerially, rustTransport]);

  const evaluateCandidate = useCallback((
    compiled: LastGoodDslDocument,
    candidate: OutputPreviewCandidate,
    context: OutputPreviewGraphContext | null
  ): Promise<OutputPlan> => {
    if (!context) return evaluateOutputPlanWithRust(compiled, candidate.output);
    if (graphContextRef.current !== context) return Promise.reject(new Error("The Output Preview graph changed during evaluation."));
    const requestId = nextPlanRequestIdRef.current++;
    return new Promise((resolve, reject) => {
      pendingGraphPlansRef.current.set(requestId, { authority: context.authority, candidate, resolve, reject });
      api.postMessage({ type: "outputPreviewPlanRequest", requestId, graphAuthority: context.authority, outputKey: candidate.key });
    });
  }, [api, evaluateOutputPlanWithRust]);

  const applyOpenSelection = useCallback((normalizedSourceOffset: number | null) => {
    const state = useCadDocumentStore.getState();
    const source = hostSourceRef.current;
    const context = graphContextRef.current;
    if (source && graphAwaitsSource(source, pendingGraphRef.current)) return;
    if (source?.requiresGraph ? !context : state.sourceText !== state.docText) {
      pendingOpenRef.current = { normalizedSourceOffset };
      return;
    }
    const currentCandidates = context && source
      ? outputPreviewCandidatesFor(source.text, context.compiled)
      : outputPreviewCandidatesFor(state.sourceText, effectiveCompiledDocument(state));
    const selected = selectOutputPreviewCandidate({
      candidates: currentCandidates,
      cursorOffset: normalizedSourceOffset,
      existingKey: selectedOutputKeyRef.current
    });
    pendingOpenRef.current = null;
    updateSelectedOutputKey(selected?.key ?? null);
  }, [updateSelectedOutputKey]);

  useEffect(() => {
    selectedOutputKeyRef.current = selectedOutputKey;
  }, [selectedOutputKey]);

  useEffect(() => useCadDocumentStore.subscribe((state, previous) => {
    if (state.currentSourceRevision !== previous.currentSourceRevision) clearExplicitReveal();
  }), [clearExplicitReveal]);

  useLayoutEffect(() => {
    measureViewport();
    const element = viewportRef.current;
    if (!element) return undefined;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureViewport);
    observer?.observe(element);
    window.addEventListener("resize", measureViewport);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureViewport);
    };
  }, [measureViewport]);

  useEffect(() => {
    if (!sourceIsCurrent) return;
    if (pendingOpenRef.current !== null) {
      applyOpenSelection(pendingOpenRef.current.normalizedSourceOffset);
    }
  }, [applyOpenSelection, canonicalCandidates, sourceIsCurrent]);

  useEffect(() => {
    if (!sourceIsCurrent) return;
    const fallbackKey = canonicalCandidates[0]?.key ?? null;
    const currentKey = selectedOutputKeyRef.current;
    if (outputPreviewCandidateForKey(canonicalCandidates, currentKey) || currentKey === fallbackKey) return;
    updateSelectedOutputKey(fallbackKey);
  }, [canonicalCandidates, selectedOutputKey, sourceIsCurrent, updateSelectedOutputKey]);

  const canonicalSelectedCandidate = outputPreviewCandidateForKey(canonicalCandidates, selectedOutputKey);
  const selectedCandidate = placeDragPreview
    ? outputPreviewCandidateForKey(displayCandidates, selectedOutputKey)
    : canonicalSelectedCandidate;

  useEffect(() => {
    let cancelled = false;
    const generation = contextGenerationRef.current;
    if (!sourceIsCurrent) {
      return () => { cancelled = true; };
    }
    if (!canonicalSelectedCandidate) {
      const pending = placeDragPreviewRef.current;
      if (pending?.phase === "commit-pending" && !hostSourceRef.current?.requiresGraph) {
        outputPreviewPlaceCommitPendingRef.current = null;
        setPlaceDragPreviewCurrent(null);
      }
      return () => { cancelled = true; };
    }
    const candidate = canonicalSelectedCandidate;
    void evaluateCandidate(canonicalCompiledDocument, candidate, graphContext).then((plan) => {
      if (cancelled || generation !== contextGenerationRef.current) return;
      const pending = placeDragPreviewRef.current;
      if (
        plan.kind !== candidate.kind ||
        plan.outputId !== candidate.output.id ||
        plan.layoutId !== candidate.output.layoutId ||
        plan.rustPayload.kind !== candidate.kind
      ) throw new Error("The Output Preview plan does not match the current output.");
      const currentSource = hostSourceRef.current;
      const exactPendingSource = pending?.phase === "commit-pending" &&
        pending.outputKey === candidate.key &&
        currentSource !== null &&
        currentSource?.version === pending.expectedDocumentVersion &&
        currentSource.uri === pending.documentUri &&
        normalizedSourceForDrag(currentSource.text) === pending.expectedSourceText &&
        latestHostDocumentVersionRef.current === pending.expectedDocumentVersion;
      const exactPendingAuthority = exactPendingSource && (pending.graphAuthority === null
        ? !graphContextRef.current
        : Boolean(graphContextRef.current &&
          sameOutputPreviewGraphAuthority(graphContextRef.current.authority, pending.graphAuthority) &&
          graphContextRef.current.dependencyIdentity === pending.graphDependencyIdentity));
      if (pending?.phase === "commit-pending") {
        if (!exactPendingAuthority) fittedSelectionTokenRef.current = null;
        outputPreviewPlaceCommitPendingRef.current = null;
        setPlaceDragPreviewCurrent(null);
      }
      setEvaluationState({
        outputKey: candidate.key,
        sourceRevision: currentSourceRevision,
        plan,
        evaluating: false,
        error: null
      });
    }).catch((error: unknown) => {
      if (cancelled || generation !== contextGenerationRef.current) return;
      if (placeDragPreviewRef.current?.phase === "commit-pending") {
        outputPreviewPlaceCommitPendingRef.current = null;
        setPlaceDragPreviewCurrent(null);
      }
      setEvaluationState({
        outputKey: candidate.key,
        sourceRevision: currentSourceRevision,
        plan: null,
        evaluating: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    return () => { cancelled = true; };
  }, [bindingIssueDiagnostics, canonicalCompiledDocument, canonicalSelectedCandidate, currentSourceRevision, diagnostics, evaluateCandidate, graphContext, sourceIsCurrent, setPlaceDragPreviewCurrent]);

  const activePlan = sourceIsCurrent
    && evaluationState.sourceRevision === currentSourceRevision
    && canonicalSelectedCandidate
    && evaluationState.outputKey === canonicalSelectedCandidate.key
    ? evaluationState.plan
    : null;

  const exportablePlan = !placeDragPreview
    && activePlan
    && !activePlan.empty
    && evaluationState.sourceRevision === currentSourceRevision
    && canonicalSelectedCandidate
    && activePlan.outputId === canonicalSelectedCandidate.output.id
    && activePlan.rustPayload.kind === activePlan.kind
    ? activePlan
    : null;

  const requestCurrentExport = useCallback((): boolean => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (placeDragPreviewRef.current || !exportablePlan || !canonicalSelectedCandidate || documentVersion === null || pendingExportRequestId !== null) return false;
    const requestId = nextExportRequestIdRef.current;
    nextExportRequestIdRef.current += 1;
    setPendingExportRequestId(requestId);
    if (exportablePlan.kind === "print" && exportablePlan.rustPayload.kind === "print") {
      api.postMessage({
        type: "outputPreviewExportRequest",
        requestId,
        documentVersion,
        outputKey: canonicalSelectedCandidate.key,
        outputName: exportablePlan.outputName,
        ...(graphAuthority ? { graphAuthority } : {}),
        format: "pdf",
        payload: exportablePlan.rustPayload
      });
      return true;
    }
    if (exportablePlan.kind === "svg" && exportablePlan.rustPayload.kind === "svg") {
      api.postMessage({
        type: "outputPreviewExportRequest",
        requestId,
        documentVersion,
        outputKey: canonicalSelectedCandidate.key,
        outputName: exportablePlan.outputName,
        ...(graphAuthority ? { graphAuthority } : {}),
        format: "svg",
        payload: exportablePlan.rustPayload
      });
      return true;
    }
    setPendingExportRequestId(null);
    return false;
  }, [api, canonicalSelectedCandidate, exportablePlan, graphAuthority, pendingExportRequestId]);

  const requestInsertTemplate = useCallback((): boolean => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (documentVersion === null || !sourceIsCurrent || canonicalCandidates.length !== 0) return false;
    api.postMessage({ type: "outputPreviewInsertTemplate", documentVersion, ...(graphAuthority ? { graphAuthority } : {}) });
    return true;
  }, [api, canonicalCandidates.length, graphAuthority, sourceIsCurrent]);
  useLayoutEffect(() => {
    requestCurrentExportRef.current = requestCurrentExport;
  }, [requestCurrentExport]);

  useEffect(() => {
    const documentVersion = latestHostDocumentVersionRef.current;
    api.postMessage({
      type: "outputPreviewExportAvailability",
      documentVersion,
      ...(graphAuthority ? { graphAuthority } : {}),
      outputKey: exportablePlan && canonicalSelectedCandidate ? canonicalSelectedCandidate.key : null,
      format: exportablePlan?.kind === "print" ? "pdf" : exportablePlan?.kind === "svg" ? "svg" : null
    });
  }, [api, authoritativeContextGeneration, canonicalSelectedCandidate, exportablePlan, graphAuthority]);

  useEffect(() => {
    latestPlanRef.current = activePlan;
    fitPlanRef.current = fitPlan;
  }, [activePlan, fitPlan]);

  const handleRevealRequest = useCallback((message: VscodeOutputPreviewRevealRequest): void => {
    const state = useCadDocumentStore.getState();
    const context = graphContextRef.current;
    const hostSource = hostSourceRef.current;
    const authority = context?.authority;
    const sourceRevision = authority?.rootSourceRevision ?? state.currentSourceRevision;
    const graphAction = authority ? { graphAuthority: authority } : {};
    const generation = ++revealGenerationRef.current;
    const fail = (reason: Extract<VscodeOutputPreviewRevealResult, { status: "failed" }>["reason"]): void => {
      pendingRevealResponseRef.current = {
        type: "outputPreviewRevealResult",
        requestId: message.requestId,
        documentVersion: message.documentVersion,
        ...graphAction,
        status: "failed",
        reason
      };
      setRevealState({
        status: "failed",
        requestId: message.requestId,
        documentVersion: message.documentVersion,
        sourceRevision,
        reason
      });
    };

    if (latestHostDocumentVersionRef.current !== message.documentVersion) {
      fail("stale");
      return;
    }
    if (hostSource && graphAwaitsSource(hostSource, pendingGraphRef.current)) {
      fail("stale");
      return;
    }
    if (!sameOutputPreviewGraphAuthority(authority, message.graphAuthority)) {
      fail("stale");
      return;
    }
    if (hostSource?.requiresGraph ? !context : state.sourceText !== state.docText) {
      fail("current-target-unavailable");
      return;
    }

    const compiled = context?.compiled ?? effectiveCompiledDocument(state);
    const normalizedSource = normalizedSourceForDrag(context && hostSource ? hostSource.text : state.sourceText);
    if (!Number.isInteger(message.normalizedSourceOffset) || message.normalizedSourceOffset < 0 || message.normalizedSourceOffset > normalizedSource.length) {
      fail("current-target-unavailable");
      return;
    }
    if (!compiled.document || !compiled.statementMap) {
      fail("current-target-unavailable");
      return;
    }

    let target: OutputPreviewRevealTarget | undefined = message.runtimeTarget;
    if (!context) {
      const sourceTarget = queryDslOutputPreviewRevealSourceTarget({
        source: { normalizedSource, sourceRevision },
        compiled,
        position: message.normalizedSourceOffset
      });
      if (sourceTarget.status === "resolved") {
        if (sourceTarget.target.kind === "group" || sourceTarget.target.kind === "geometry" || sourceTarget.target.kind === "semantic") {
          const runtimeTarget = projectDslOutputPreviewRevealRuntimeTarget({
            target: sourceTarget.target,
            compiled,
            moduleGeometryRuntime: compiled.moduleGeometryRuntime,
            elements: compiled.document.elements
          });
          if (runtimeTarget.status === "resolved") target = runtimeTarget.target as DslOutputPreviewRevealRuntimeTarget;
        } else {
          target = sourceTarget.target;
        }
      }
    }
    if (!target) {
      fail("current-target-unavailable");
      return;
    }
    const revealTarget = target;

    const candidates = outputPreviewCandidatesFor(normalizedSource, compiled);
    pendingRevealResponseRef.current = null;
    setRevealState({
      status: "pending",
      requestId: message.requestId,
      documentVersion: message.documentVersion,
      sourceRevision
    });

    const evaluateCandidates = async (): Promise<OutputPlan[]> => {
      const plans: OutputPlan[] = [];
      for (const candidate of candidates) {
        plans.push(await evaluateCandidate(compiled, candidate, context));
      }
      return plans;
    };
    const revealIsCurrent = (): boolean => {
      const current = useCadDocumentStore.getState();
      return generation === revealGenerationRef.current &&
        latestHostDocumentVersionRef.current === message.documentVersion &&
        (context ? graphContextRef.current === context : (
          current.currentSourceRevision === sourceRevision &&
          current.sourceText === current.docText &&
          effectiveCompiledDocument(current) === compiled
        ));
    };
    void evaluateCandidates().then((plans) => {
      if (!revealIsCurrent()) return;
      const resolved = resolveOutputPreviewReveal({
        target: revealTarget,
        elements: compiled.document!.elements,
        plans,
        selectedOutputKey: selectedOutputKeyRef.current
      });
      if (resolved.status === "failed") {
        pendingRevealResponseRef.current = {
          type: "outputPreviewRevealResult",
          requestId: message.requestId,
          documentVersion: message.documentVersion,
          ...graphAction,
          status: "failed",
          reason: "no-containing-output"
        };
        setRevealState({
          status: "failed",
          requestId: message.requestId,
          documentVersion: message.documentVersion,
          sourceRevision,
          reason: "no-containing-output"
        });
        return;
      }

      preserveViewportForSelectionRef.current = resolved.outputKey;
      applyRevealViewportFit(resolved.highlightedDrawables);
      if (selectedOutputKeyRef.current !== resolved.outputKey) updateSelectedOutputKey(resolved.outputKey, true);
      setEvaluationState({
        outputKey: resolved.outputKey,
        sourceRevision,
        plan: resolved.plan,
        evaluating: false,
        error: null
      });
      pendingRevealResponseRef.current = {
        type: "outputPreviewRevealResult",
        requestId: message.requestId,
        documentVersion: message.documentVersion,
        ...graphAction,
        status: "resolved",
        outputKey: resolved.outputKey
      };
      setRevealState({
        status: "resolved",
        requestId: message.requestId,
        documentVersion: message.documentVersion,
        sourceRevision,
        outputKey: resolved.outputKey,
        plan: resolved.plan,
        highlightedDrawables: resolved.highlightedDrawables
      });
    }).catch(() => {
      if (revealIsCurrent()) fail("evaluation-failed");
    });
  }, [applyRevealViewportFit, evaluateCandidate, updateSelectedOutputKey]);

  useLayoutEffect(() => {
    const response = pendingRevealResponseRef.current;
    if (!response || revealState.status === "idle" || revealState.requestId !== response.requestId) return;
    pendingRevealResponseRef.current = null;
    api.postMessage(response);
  }, [api, revealState]);

  useLayoutEffect(() => {
    if (
      !sourceIsCurrent ||
      revealState.status !== "resolved" ||
      revealState.sourceRevision !== currentSourceRevision ||
      revealState.outputKey !== selectedOutputKey
    ) return;
    applyRevealViewportFit(revealState.highlightedDrawables);
  }, [applyRevealViewportFit, currentSourceRevision, revealState, selectedOutputKey, sourceIsCurrent, viewportSize]);

  useLayoutEffect(() => {
    if (!sourceIsCurrent || placeDragPreview) return;
    const plan = activePlan;
    if (!plan) return;
    const identity = `${plan.kind}:${plan.outputId}`;
    const fitToken = `${selectionGenerationRef.current}:${identity}`;
    if (preserveViewportForSelectionRef.current === selectedOutputKey) {
      preserveViewportForSelectionRef.current = null;
      fittedSelectionTokenRef.current = fitToken;
      return;
    }
    if (fittedSelectionTokenRef.current === fitToken) return;
    if (fitPlan(plan)) fittedSelectionTokenRef.current = fitToken;
  }, [activePlan, fitPlan, placeDragPreview, sourceIsCurrent, selectedOutputKey]);

  useEffect(() => {
    const refreshCanvasTheme = () => setCanvasTheme(readVSCodeCanvasTheme());
    refreshCanvasTheme();
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "canvasThemeChanged") {
        refreshCanvasTheme();
        return;
      }
      if (message.type === "outputPreviewOpen") {
        if (latestHostDocumentVersionRef.current !== message.documentVersion) return;
        clearExplicitReveal();
        applyOpenSelection(message.normalizedSourceOffset);
        return;
      }
      if (message.type === "outputPreviewFit") {
        fitPlanRef.current(latestPlanRef.current);
        return;
      }
      if (message.type === "outputPreviewResetView") {
        setViewport(resetOutputPreviewViewport());
        return;
      }
      if (message.type === "outputPreviewClearFocus") {
        clearExplicitReveal();
        setClearPlaceInteractionKey((current) => current + 1);
        return;
      }
      if (message.type === "outputPreviewReveal") {
        handleRevealRequest(message);
        return;
      }
      if (message.type === "outputPreviewExport") {
        requestCurrentExportRef.current();
        return;
      }
      if (message.type === "outputPreviewExportResult") {
        setPendingExportRequestId((current) => current === message.requestId ? null : current);
        return;
      }
      if (message.type === "outputPreviewPlanResult") {
        const pending = pendingGraphPlansRef.current.get(message.requestId);
        if (!pending || !sameOutputPreviewGraphAuthority(message.graphAuthority, pending.authority)) return;
        pendingGraphPlansRef.current.delete(message.requestId);
        if ("error" in message) {
          pending.reject(new Error(message.error));
        } else if (
          message.plan.kind === pending.candidate.kind &&
          message.plan.outputId === pending.candidate.output.id &&
          message.plan.layoutId === pending.candidate.output.layoutId &&
          message.plan.rustPayload.kind === pending.candidate.kind
        ) {
          pending.resolve(message.plan);
        } else {
          pending.reject(new Error("The Output Preview plan does not match the current output."));
        }
        return;
      }
      if (message.type === "multiDocumentGraphPublication") {
        receiveGraphPublication(message);
        return;
      }
      if (message.type === "replaceTextDocument" || message.type === "commitText") {
        const previous = hostSourceRef.current;
        const uri = message.hostDocumentUri ?? (message.type === "commitText" ? previous?.uri : undefined);
        const sameRoot = previous?.uri === uri;
        const pendingPlacement = placeDragPreviewRef.current;
        if (previous && message.type === "commitText" && !sameRoot) return;
        if (previous && sameRoot && message.documentVersion < previous.version) return;
        if (previous && sameRoot && previous.version === message.documentVersion) {
          if (previous.text === message.sourceText) {
            const expectedCommitReplay = pendingPlacement?.phase === "commit-pending" &&
              previous.uri === pendingPlacement.documentUri &&
              previous.version === pendingPlacement.expectedDocumentVersion &&
              normalizedSourceForDrag(previous.text) === pendingPlacement.expectedSourceText &&
              uri === pendingPlacement.documentUri &&
              message.documentVersion === pendingPlacement.expectedDocumentVersion &&
              normalizedSourceForDrag(message.sourceText) === pendingPlacement.expectedSourceText;
            if (pendingPlacement?.phase === "commit-pending" && !expectedCommitReplay) {
              setPlaceDragPreviewCurrent(null);
              outputPreviewPlaceCommitPendingRef.current = null;
            }
            api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
          } else if (
            pendingPlacement?.phase === "commit-pending" &&
            sameRoot &&
            uri === pendingPlacement.documentUri
          ) {
            setAwaitingSource(true);
            graphContextRef.current = null;
            setGraphContext(null);
            setGraphError("The Output Preview Source does not match the pending place commit.");
            invalidateAuthority();
          }
          return;
        }
        const matchingPlacementCommit = previous !== null && message.type === "commitText" && message.reason === "edit" &&
          pendingPlacement?.phase === "commit-pending" &&
          previous?.uri === pendingPlacement.documentUri &&
          previous.version === pendingPlacement.proof.documentVersion &&
          normalizedSourceForDrag(previous.text) === pendingPlacement.proof.normalizedSourceSnapshot &&
          uri === pendingPlacement.documentUri &&
          message.documentVersion === pendingPlacement.expectedDocumentVersion &&
          normalizedSourceForDrag(message.sourceText) === pendingPlacement.expectedSourceText;
        const next = {
          uri, version: message.documentVersion, text: message.sourceText,
          requiresGraph: outputPreviewRequiresGraph(message.sourceText)
        };
        hostSourceRef.current = next;
        setHostSource(next);
        setAwaitingSource(graphAwaitsSource(next, pendingGraphRef.current));
        latestHostDocumentVersionRef.current = message.documentVersion;
        pendingOpenRef.current = null;
        if (previous && !sameRoot) {
          if (uri) graphRevisionsRef.current.delete(uri);
          updateSelectedOutputKey(null);
        }
        graphContextRef.current = null;
        setGraphContext(null);
        setGraphError(null);
        invalidateAuthority(matchingPlacementCommit);
        if (!next.requiresGraph) {
          if (message.type === "replaceTextDocument" || previous?.requiresGraph) {
            useCadDocumentStore.getState().replaceTextDocument(message.sourceText, {
              currentFilePath: null, dirtySinceSave: false
            });
          } else {
            useCadDocumentStore.getState().commitText(message.sourceText, "editor");
          }
        }
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        const pending = pendingGraphRef.current;
        if (pending && (pending.hostDocumentUri !== uri || pending.documentVersion === null || pending.documentVersion <= next.version)) {
          pendingGraphRef.current = null;
          receiveGraphPublication(pending);
        }
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", onMessage);
      rejectPendingGraphPlans();
      rustTransport.dispose();
    };
  }, [api, applyOpenSelection, clearExplicitReveal, handleRevealRequest, invalidateAuthority, receiveGraphPublication, rejectPendingGraphPlans, rustTransport, setPlaceDragPreviewCurrent, updateSelectedOutputKey]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setPointerClientPosition({ clientX: event.clientX, clientY: event.clientY });
    setViewport((current) => zoomOutputPreviewViewportAt(
      current,
      Math.pow(VIEWPORT_ZOOM_STEP, -event.deltaY / 100),
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height
      }
    ));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    markReactPointerEvent(event);
    if (event.button === 0 && spaceHeldRef.current) {
      event.preventDefault();
      setPointerClientPosition({ clientX: event.clientX, clientY: event.clientY });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        mode: "space-primary"
      };
      return;
    }
    if (event.button !== 1) return;
    event.preventDefault();
    setPointerClientPosition({ clientX: event.clientX, clientY: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, mode: "middle" };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    markReactPointerEvent(event);
    setPointerClientPosition({ clientX: event.clientX, clientY: event.clientY });
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (pan.mode === "space-primary" && (event.buttons & 1) === 0) {
      stopPan(event);
      return;
    }
    setViewport((current) => panViewportByScreenDelta(
      current,
      event.clientX - pan.lastX,
      event.clientY - pan.lastY
    ));
    panRef.current = { ...pan, lastX: event.clientX, lastY: event.clientY };
  };

  const stopPan = (event: React.PointerEvent<HTMLDivElement>) => {
    markReactPointerEvent(event);
    setPointerClientPosition({ clientX: event.clientX, clientY: event.clientY });
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };

  const stopSpacePan = useCallback(() => {
    if (panRef.current?.mode !== "space-primary") return;
    const viewport = viewportRef.current;
    try {
      viewport?.releasePointerCapture(panRef.current.pointerId);
    } catch {
      // Pointer capture can already be gone after pointercancel/lostpointercapture.
    }
    panRef.current = null;
  }, []);

  const clearSpaceOwnership = useCallback(() => {
    spaceHeldRef.current = false;
    stopSpacePan();
  }, [stopSpacePan]);

  const handleViewportBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    clearSpaceOwnership();
  }, [clearSpaceOwnership]);

  const handleViewportKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.key !== " " && event.code !== "Space") ||
      !event.currentTarget.contains(document.activeElement)
    ) return;
    event.preventDefault();
    event.stopPropagation();
    spaceHeldRef.current = true;
  };

  useEffect(() => {
    const isSpaceKey = (event: KeyboardEvent): boolean => event.key === " " || event.code === "Space";
    const onKeyUp = (event: KeyboardEvent) => {
      if (isSpaceKey(event)) clearSpaceOwnership();
    };
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", clearSpaceOwnership);
    return () => {
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", clearSpaceOwnership);
      clearSpaceOwnership();
    };
  }, [clearSpaceOwnership]);

  const zoomViewportAtCenter = useCallback((zoomFactor: number) => {
    const size = latestViewportSizeRef.current;
    setViewport((current) => zoomOutputPreviewViewportAt(current, zoomFactor, {
      x: size.width / 2,
      y: size.height / 2,
      width: size.width,
      height: size.height
    }));
  }, []);

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    markReactPointerEvent(event);
    setPointerClientPosition(null);
  };

  useNativePointerBoundaryFallback({
    targetRef: viewportRef,
    handlers: {
      pointerdown: handlePointerDown,
      pointermove: handlePointerMove,
      pointerup: stopPan,
      pointercancel: stopPan,
      lostpointercapture: stopPan,
      pointerleave: handlePointerLeave
    },
    reactHandledEvents: reactHandledPointerEvents,
    shouldFallback: outputPreviewPointerBoundaryFallbackShouldRun
  });

  const navigateToSourceRange = (range: { from: number; to: number } | null) => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (!range || documentVersion === null || placeDragPreviewRef.current) return;
    api.postMessage({
      type: "outputPreviewSourceNavigation",
      documentVersion,
      ...(graphAuthority ? { graphAuthority } : {}),
      range
    });
  };

  const navigateToSelectedOutput = () => navigateToSourceRange(canonicalSelectedCandidate?.sourceRange ?? null);

  const plan = placeDragPreview?.plan ?? activePlan;
  const placeProjections = useMemo(
    () => plan ? projectOutputPlaces({ compiledDocument, plan }) : [],
    [compiledDocument, plan]
  );
  const highlightedPlace = highlightedPlaceId
    ? placeProjections.find((projection) => projection.placeId === highlightedPlaceId) ?? null
    : null;
  const highlightedRevealDrawables = sourceIsCurrent &&
    revealState.status === "resolved" &&
    revealState.sourceRevision === currentSourceRevision &&
    revealState.outputKey === selectedOutputKey
    ? revealState.highlightedDrawables
    : [];

  const currentDragPlanIdentity = dragPlanIdentityForCandidate(canonicalSelectedCandidate);
  const dragProofIsCurrent = useCallback((proof: OutputPreviewPlaceDragProof): boolean => {
    const state = useCadDocumentStore.getState();
    const context = graphContextRef.current;
    const source = hostSourceRef.current;
    if (source?.requiresGraph && (!context || graphDragProofRef.current !== proof)) return false;
    const sourceText = source?.requiresGraph ? source.text : state.sourceText;
    const currentCandidates = source?.requiresGraph
      ? context ? outputPreviewCandidatesFor(sourceText, context.compiled) : []
      : state.sourceText === state.docText ? outputPreviewCandidatesFor(sourceText, effectiveCompiledDocument(state)) : [];
    const currentCandidate = outputPreviewCandidateForKey(currentCandidates, selectedOutputKeyRef.current);
    return outputPreviewPlaceDragProofIsCurrent({
      proof,
      normalizedSource: normalizedSourceForDrag(sourceText),
      currentSourceRevision: context?.authority.rootSourceRevision ?? state.currentSourceRevision,
      documentVersion: latestHostDocumentVersionRef.current,
      plan: dragPlanIdentityForCandidate(currentCandidate)
    });
  }, []);

  const beginPlaceDrag = useCallback((projection: (typeof placeProjections)[number]) => {
    if (
      outputPreviewPlaceCommitPendingRef.current !== null ||
      placeDragPreview ||
      !plan ||
      !currentDragPlanIdentity ||
      !canonicalSelectedCandidate ||
      plan.placements.filter((placement) => placement.id === projection.placeId).length !== 1
    ) return null;
    const proof = beginOutputPreviewPlaceDrag({
      projection,
      normalizedSource: normalizedSourceForDrag(sourceText),
      currentSourceRevision,
      documentVersion: latestHostDocumentVersionRef.current,
      plan
    });
    if (!proof) return null;
    if (graphContextRef.current) graphDragProofRef.current = proof;
    const context = graphContextRef.current;
    const source = hostSourceRef.current;
    setPlaceDragPreviewCurrent({
      proof,
      basePlan: plan,
      plan,
      outputKey: canonicalSelectedCandidate.key,
      candidates: canonicalCandidates,
      sourceText,
      compiledDocument: canonicalCompiledDocument,
      documentUri: source?.uri,
      originalGraphAuthority: context?.authority ?? null,
      graphAuthority: context?.authority ?? null,
      graphDependencyIdentity: context?.dependencyIdentity ?? null,
      phase: "dragging"
    });
    return proof;
  }, [canonicalCandidates, canonicalCompiledDocument, canonicalSelectedCandidate, currentDragPlanIdentity, currentSourceRevision, placeDragPreview, plan, setPlaceDragPreviewCurrent, sourceText]);

  const previewPlaceDrag = useCallback((
    proof: OutputPreviewPlaceDragProof,
    coordinates: { x: number; y: number }
  ): boolean => {
    const current = placeDragPreviewRef.current;
    if (!current || current.proof !== proof || current.phase !== "dragging" || !dragProofIsCurrent(proof)) {
      if (current?.proof === proof && current.phase === "dragging") setPlaceDragPreviewCurrent(null);
      return false;
    }
    let plan: OutputPlan | null;
    try {
      plan = projectOutputPlanForPlaceTranslation({
        acceptedPlan: current.basePlan,
        placeId: proof.placeId,
        delta: { x: coordinates.x - proof.x.literal, y: coordinates.y - proof.y.literal }
      });
    } catch {
      setPlaceDragPreviewCurrent(null);
      return false;
    }
    if (!plan) {
      setPlaceDragPreviewCurrent(null);
      return false;
    }
    setPlaceDragPreviewCurrent({ ...current, plan });
    return true;
  }, [dragProofIsCurrent, setPlaceDragPreviewCurrent]);

  const cancelPlaceDrag = useCallback((proof: OutputPreviewPlaceDragProof) => {
    if (graphDragProofRef.current === proof) graphDragProofRef.current = null;
    const current = placeDragPreviewRef.current;
    if (current?.proof === proof && current.phase === "dragging") setPlaceDragPreviewCurrent(null);
  }, [setPlaceDragPreviewCurrent]);

  const commitPlaceDrag = useCallback((
    proof: OutputPreviewPlaceDragProof,
    coordinates: { x: number; y: number }
  ): boolean => {
    const current = placeDragPreviewRef.current;
    if (outputPreviewPlaceCommitPendingRef.current !== null || !current || current.proof !== proof ||
      current.phase !== "dragging" || !dragProofIsCurrent(proof)) {
      if (current?.proof === proof && current.phase === "dragging") setPlaceDragPreviewCurrent(null);
      return false;
    }
    const patches = outputPreviewPlaceCoordinatePatchesFor(proof, coordinates);
    if (patches === null) {
      setPlaceDragPreviewCurrent(null);
      return false;
    }
    if (graphDragProofRef.current === proof) graphDragProofRef.current = null;
    if (patches.length === 0) {
      setPlaceDragPreviewCurrent(null);
      return true;
    }
    const expectedSourceText = outputPreviewPlacePreviewSourceFor(proof, coordinates);
    const expectedDocumentVersion = proof.documentVersion + 1;
    if (expectedSourceText === null || !Number.isSafeInteger(expectedDocumentVersion)) {
      setPlaceDragPreviewCurrent(null);
      return false;
    }
    setPlaceDragPreviewCurrent({
      ...current,
      phase: "commit-pending",
      expectedSourceText,
      expectedDocumentVersion
    });
    outputPreviewPlaceCommitPendingRef.current = proof.documentVersion;
    api.postMessage({
      type: "outputPreviewPlaceCommit",
      documentVersion: proof.documentVersion,
      ...(current.originalGraphAuthority ? { graphAuthority: current.originalGraphAuthority } : {}),
      normalizedSourceSnapshot: proof.normalizedSourceSnapshot,
      statementRange: proof.statementRange,
      patches
    });
    return true;
  }, [api, dragProofIsCurrent, setPlaceDragPreviewCurrent]);

  const currentDiagnostic = graphBound ? undefined :
    [...diagnostics, ...bindingIssueDiagnostics].find((diagnostic) => diagnostic.severity === "error") ?? diagnostics[0] ?? bindingIssueDiagnostics[0];
  const diagnosticSourceRange = outputPreviewDiagnosticSourceRangeFor(sourceText, currentSourceRevision, currentDiagnostic);
  const sourceNavigationRange = diagnosticSourceRange ?? canonicalSelectedCandidate?.sourceRange ?? null;
  const previewError = awaitingSource ? null : sourceIsCurrent
    ? selectedCandidate && evaluationState.outputKey === selectedCandidate.key ? evaluationState.error : null
    : graphBound
      ? graphError === null ? null : graphError || diagnosticMessageFor({ diagnostics: [], bindingIssueDiagnostics: [] }, webviewPresentation)
      : diagnosticMessageFor({ diagnostics, bindingIssueDiagnostics }, webviewPresentation);
  const pageRects = plan ? outputPreviewPageRectsFor(plan, viewportSize, viewport) : [];
  const guideLines = plan ? outputPreviewGuideLinesFor(plan, viewportSize, viewport) : [];
  const paperBounds = plan?.kind === "svg" ? plan.bounds : null;
  const paperRect = paperBounds && viewportSize.width > 0
    ? (() => {
        const topLeft = outputPreviewWorldToScreen({ x: paperBounds.minX, y: paperBounds.maxY }, viewportSize, viewport);
        return { x: topLeft.x, y: topLeft.y, width: paperBounds.width * viewport.zoom, height: paperBounds.height * viewport.zoom };
      })()
    : null;
  const dragContextKey = `${authoritativeContextGeneration}:${currentSourceRevision}:${selectedOutputKey ?? "none"}`;

  return (
    <main
      ref={workspaceRef}
      className="output-preview-workspace vscode-canvas-webview"
      style={canvasThemeCssVariables(canvasTheme)}
    >
      <header className="output-preview-toolbar">
        <div className="output-preview-output-group">
          <select
            aria-label={webviewPresentationTextFor(webviewPresentation, "output.selector.label", "Output")}
            value={selectedOutputKey ?? ""}
            onChange={(event) => {
              clearExplicitReveal();
              updateSelectedOutputKey(event.target.value || null);
            }}
          disabled={canonicalCandidates.length === 0 || placeDragPreview !== null}
          >
          {displayCandidates.length === 0 ? (
              <option value="">{webviewPresentationTextFor(webviewPresentation, "output.selector.noOutputs", "No outputs")}</option>
            ) : null}
          {displayCandidates.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {outputKindLabel(candidate, webviewPresentation)} · {candidate.output.name}
              </option>
            ))}
          </select>
          <CommandRibbonView
            className="output-preview-command-ribbon"
            showHandle={false}
            viewportAwareTooltips
            tooltipBoundaryRef={workspaceRef}
            ribbon={{
              id: "output-preview-ribbon",
              label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.title", "Output Preview"),
              x: null,
              y: 0,
              orientation: "horizontal",
              iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
              items: [
                {
                  id: "output-preview-source-navigation",
                  type: "command",
                  commandId: "outputPreviewSourceNavigation",
                  icon: vscodeLucideIconName("crosshair"),
                  label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.goToSource", "Go to Source"),
                  description: "",
                  showLabel: false,
                  available: Boolean(canonicalSelectedCandidate) && !placeDragPreview,
                  nativeDisabled: !canonicalSelectedCandidate || placeDragPreview !== null
                }
              ]
            }}
            iconResolver={resolveVscodeLucideIcon}
            onCommand={(item) => {
              if (item.commandId === "outputPreviewSourceNavigation") navigateToSelectedOutput();
            }}
          />
        </div>
        {exportablePlan ? (
          <CommandRibbonView
            className="output-preview-export-ribbon"
            showHandle={false}
            viewportAwareTooltips
            tooltipBoundaryRef={workspaceRef}
            ribbon={{
              id: "output-preview-export-ribbon",
              label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.exportTitle", "Output Export"),
              x: null,
              y: 0,
              orientation: "horizontal",
              iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
              items: [{
                id: "output-preview-export",
                type: "command",
                commandId: "outputPreviewExport",
                icon: vscodeLucideIconName("file-down"),
                label: webviewPresentationTextFor(
                  webviewPresentation,
                  exportablePlan.kind === "print" ? "output.ribbon.exportPdf" : "output.ribbon.exportSvg",
                  exportablePlan.kind === "print" ? "Export PDF" : "Export SVG"
                ),
                description: "",
                showLabel: true,
                available: pendingExportRequestId === null,
                nativeDisabled: pendingExportRequestId !== null
              }]
            }}
            iconResolver={resolveVscodeLucideIcon}
            onCommand={(item) => {
              if (item.commandId === "outputPreviewExport") requestCurrentExport();
            }}
          />
        ) : null}
        <CommandRibbonView
          className="output-preview-reset-ribbon"
          showHandle={false}
          viewportAwareTooltips
          tooltipBoundaryRef={workspaceRef}
          ribbon={{
            id: "output-preview-reset-ribbon",
            label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.title", "Output Preview"),
            x: null,
            y: 0,
            orientation: "horizontal",
            iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
            items: [{
              id: "output-preview-reset",
              type: "command",
              commandId: "outputPreviewResetView",
              icon: vscodeLucideIconName("rotate-ccw"),
              label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.reset", "Reset Output Preview Pan and Zoom"),
              description: "",
              showLabel: false,
              available: true
            }]
          }}
          iconResolver={resolveVscodeLucideIcon}
          onCommand={(item) => {
            if (item.commandId === "outputPreviewResetView") api.postMessage({ type: "outputPreviewResetView" });
          }}
        />
        <CommandRibbonView
          className="output-preview-fit-ribbon"
          showHandle={false}
          viewportAwareTooltips
          tooltipBoundaryRef={workspaceRef}
          ribbon={{
            id: "output-preview-fit-ribbon",
            label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.title", "Output Preview"),
            x: null,
            y: 0,
            orientation: "horizontal",
            iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
            items: [
              {
                id: "output-preview-fit",
                type: "command",
                commandId: "outputPreviewFit",
                icon: vscodeLucideIconName("maximize"),
                label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.fit", "Fit Output Preview"),
                description: "",
                showLabel: false,
                available: Boolean(plan),
                nativeDisabled: !plan
              }
            ]
          }}
          iconResolver={resolveVscodeLucideIcon}
          onCommand={(item) => {
            if (item.commandId === "outputPreviewFit") api.postMessage({ type: "outputPreviewFit" });
          }}
        />
        <CommandRibbonView
          className="output-preview-zoom-ribbon"
          showHandle={false}
          viewportAwareTooltips
          tooltipBoundaryRef={workspaceRef}
          ribbon={{
            id: "output-preview-zoom-ribbon",
            label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.title", "Output Preview"),
            x: null,
            y: 0,
            orientation: "horizontal",
            iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
            items: [
              {
                id: "output-preview-zoom-out",
                type: "command",
                commandId: "outputPreviewZoomOut",
                icon: vscodeLucideIconName("minus"),
                label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.zoomOut", "Zoom out"),
                description: "",
                showLabel: false,
                available: true
              },
              vscodeViewportZoomPresentationFor(
                "output-preview-zoom-percent",
                viewport,
                webviewPresentationTextFor(webviewPresentation, "output.zoomPercent.label", "Output Preview zoom"),
                webviewPresentationTextFor(webviewPresentation, "output.zoomPercent.description", "Current Output Preview zoom.")
              ),
              {
                id: "output-preview-zoom-in",
                type: "command",
                commandId: "outputPreviewZoomIn",
                icon: vscodeLucideIconName("plus"),
                label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.zoomIn", "Zoom in"),
                description: "",
                showLabel: false,
                available: true
              }
            ]
          }}
          iconResolver={resolveVscodeLucideIcon}
          onCommand={(item) => {
            if (item.commandId === "outputPreviewZoomOut") zoomViewportAtCenter(1 / VIEWPORT_ZOOM_STEP);
            if (item.commandId === "outputPreviewZoomIn") zoomViewportAtCenter(VIEWPORT_ZOOM_STEP);
          }}
        />
        <CommandRibbonView
          className="output-preview-viewport-status-ribbon"
          showHandle={false}
          viewportAwareTooltips
          tooltipBoundaryRef={workspaceRef}
          ribbon={{
            id: "output-preview-viewport-status-ribbon",
            label: webviewPresentationTextFor(webviewPresentation, "output.ribbon.title", "Output Preview"),
            x: null,
            y: 0,
            orientation: "horizontal",
            iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
            items: [vscodeViewportCoordinatesPresentationFor(
              "output-preview-viewport-status",
              pointerWorldPoint,
              webviewPresentationTextFor(webviewPresentation, "output.viewportStatus.label", "Output Preview status"),
              webviewPresentationTextFor(webviewPresentation, "output.viewportStatus.description", "Current Output Preview pointer position."),
              {
                x: webviewPresentationTextFor(webviewPresentation, "viewport.status.x", "X"),
                y: webviewPresentationTextFor(webviewPresentation, "viewport.status.y", "Y")
              }
            )]
          }}
          iconResolver={resolveVscodeLucideIcon}
        />
        {evaluationState.evaluating || placeDragPreview?.phase === "commit-pending" ? (
          <span className="output-preview-status">
            {webviewPresentationTextFor(webviewPresentation, "output.evaluating", "Evaluating…")}
          </span>
        ) : null}
      </header>
      <div
        ref={viewportRef}
        className="output-preview-viewport"
        tabIndex={0}
        data-vscode-context={vscodeWebviewContextDataFor("blank")}
        onBlur={handleViewportBlur}
        onKeyDown={handleViewportKeyDown}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onLostPointerCapture={stopPan}
        onPointerLeave={handlePointerLeave}
        onAuxClick={(event) => event.preventDefault()}
      >
        {previewError ? (
          <div className="output-preview-state output-preview-error" role="alert">
            <strong>{webviewPresentationTextFor(webviewPresentation, "output.unavailable", "Output Preview unavailable")}</strong>
            <span>{previewError}</span>
            {sourceNavigationRange ? (
              <button type="button" onClick={() => navigateToSourceRange(sourceNavigationRange)}>
                {webviewPresentationTextFor(webviewPresentation, "output.goToSource", "Go to source")}
              </button>
            ) : null}
          </div>
        ) : (!sourceIsCurrent && placeDragPreview?.phase !== "commit-pending") ||
          (sourceIsCurrent && Boolean(selectedCandidate) && !plan) ? (
          <div className="output-preview-state" role="status">
            <strong>{webviewPresentationTextFor(webviewPresentation, "output.evaluating", "Evaluating…")}</strong>
          </div>
        ) : !selectedCandidate ? (
          <div className="output-preview-state" role="status">
            <strong>{webviewPresentationTextFor(webviewPresentation, "output.noOutputs", "No print or SVG outputs")}</strong>
            <span>{webviewPresentationTextFor(webviewPresentation, "output.addDeclaration", "Add a print or svg declaration in the Source Editor.")}</span>
            {canonicalCandidates.length === 0 ? (
              <button type="button" onClick={requestInsertTemplate}>
                {webviewPresentationTextFor(webviewPresentation, "output.insertTemplate", "Insert Template…")}
              </button>
            ) : null}
          </div>
        ) : plan?.empty ? (
          <div className="output-preview-state" role="status">
            <strong>{webviewPresentationTextFor(webviewPresentation, "output.emptySelection", "There are no output targets.")}</strong>
          </div>
        ) : plan ? (
          <>
            <svg
              className="output-preview-plane"
              width="100%"
              height="100%"
              aria-label={webviewPresentationTextFor(webviewPresentation, "output.previewAriaLabel", "Output preview")}
            >
              {paperRect ? <rect {...paperRect} data-output-preview-layer="output-fill" fill="#ffffff" /> : null}
              {pageRects.map((page, index) => <rect key={`page-fill-${index}`} {...page} data-output-preview-layer="page-fill" fill="#ffffff" />)}
              {plan.drawables.map((drawable) => drawableSvg(drawable, viewportSize, viewport))}
              {highlightedRevealDrawables.map((drawable, index) => highlightedDrawableSvg(drawable, viewportSize, viewport, "reveal-highlight", index))}
              {highlightedPlace?.drawables.map((drawable, index) => highlightedDrawableSvg(drawable, viewportSize, viewport, "place-highlight", index))}
              {pageRects.map((page, index) => <rect key={`page-boundary-${index}`} {...page} data-output-preview-layer="page-boundary" fill="none" stroke="#9aa0a6" strokeWidth={1} />)}
              {guideLines.map((guide, index) => <line key={`guide-${index}`} {...guide} data-output-preview-layer="overlap-guide" stroke="#70757a" strokeWidth={1} strokeDasharray="6 4" />)}
            </svg>
            <OutputPreviewPlaceOverlay
              projections={placeProjections}
              sourceText={effectiveSourceText}
              viewportSize={viewportSize}
              viewport={viewport}
              onNavigate={navigateToSourceRange}
              onHighlightPlaceIdChange={setHighlightedPlaceId}
              spacePrimaryPanActiveRef={spaceHeldRef}
              clearInteractionKey={clearPlaceInteractionKey}
              focusViewport={() => viewportRef.current?.focus()}
              presentation={canvasPresentationAdapter}
              placeContextMenuData={vscodeWebviewContextDataFor("place")}
              dragContextKey={dragContextKey}
              onBeginDrag={beginPlaceDrag}
              onPreviewDrag={previewPlaceDrag}
              onCommitDrag={commitPlaceDrag}
              onCancelDrag={cancelPlaceDrag}
            />
          </>
        ) : null}
      </div>
    </main>
  );
};
