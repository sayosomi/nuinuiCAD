import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CommandRibbonView } from "../components/CommandRibbonView";
import { evaluateElementsWithRust } from "../geometry/evaluationEngine";
import { evaluateOutputPlan, type OutputDrawable, type OutputPlan, type OutputText } from "../output/outputCore";
import {
  effectiveCompiledDocument,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { outputPreviewDiagnosticSourceRangeFor } from "./outputPreviewDiagnostics";
import {
  outputPreviewCandidateForKey,
  outputPreviewCandidatesFor,
  selectOutputPreviewCandidate,
  type OutputPreviewCandidate
} from "./outputPreviewSelection";
import {
  DEFAULT_OUTPUT_PREVIEW_VIEWPORT,
  fitOutputPreviewViewport,
  outputPreviewFitBoundsFor,
  outputPreviewWorldToScreen,
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
import type { ExtensionToVscodeMessage, VscodeWebviewApi } from "./protocol";
import { VSCODE_CANVAS_RIBBON_ICON_SIZE } from "./vscodeCanvasRibbonConfig";
import { resolveVscodeLucideIcon } from "./vscodeCanvasRibbonIcons";

type OutputPreviewEvaluationState = {
  outputKey: string | null;
  plan: OutputPlan | null;
  error: string | null;
  evaluating: boolean;
};

type PanState = { pointerId: number; lastX: number; lastY: number };

const diagnosticMessageFor = (state: ReturnType<typeof useCadDocumentStore.getState>): string =>
  state.diagnostics[0]?.message ?? state.bindingIssueDiagnostics[0]?.message ?? "The current source cannot produce a valid output plan.";

const outputKindLabel = (candidate: OutputPreviewCandidate): string =>
  candidate.kind === "print" ? "Print" : "SVG";

const outputTextLines = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n");

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
          y={-index * drawable.lineHeightMm}
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
      fill="none"
      stroke={drawable.stroke.colorHex}
      strokeWidth={drawable.stroke.widthMm * viewport.zoom}
      strokeDasharray={drawable.stroke.style === "dashed" ? "6 4" : drawable.stroke.style === "dotted" ? "1 3" : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
};

export const OutputPreviewApp = ({ api }: { api: VscodeWebviewApi }) => {
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const docText = useCadDocumentStore((state) => state.docText);
  const currentSourceRevision = useCadDocumentStore((state) => state.currentSourceRevision);
  const compiledDocument = useCadDocumentStore(effectiveCompiledDocument);
  const diagnostics = useCadDocumentStore((state) => state.diagnostics);
  const bindingIssueDiagnostics = useCadDocumentStore((state) => state.bindingIssueDiagnostics);
  const sourceIsCurrent = sourceText === docText;
  const candidates = useMemo(
    () => sourceIsCurrent ? outputPreviewCandidatesFor(sourceText, compiledDocument) : [],
    [compiledDocument, sourceIsCurrent, sourceText]
  );
  const [selectedOutputKey, setSelectedOutputKey] = useState<string | null>(null);
  const [viewport, setViewport] = useState<OutputPreviewViewport>(DEFAULT_OUTPUT_PREVIEW_VIEWPORT);
  const [viewportSize, setViewportSize] = useState<OutputPreviewViewportSize>({ width: 0, height: 0 });
  const [evaluationState, setEvaluationState] = useState<OutputPreviewEvaluationState>({
    outputKey: null,
    plan: null,
    error: null,
    evaluating: false
  });
  const workspaceRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanState | null>(null);
  const latestHostDocumentVersionRef = useRef<number | null>(null);
  const pendingOpenOffsetRef = useRef<number | null>(null);
  const selectionGenerationRef = useRef(0);
  const fittedSelectionTokenRef = useRef<string | null>(null);
  const selectedOutputKeyRef = useRef<string | null>(selectedOutputKey);
  const latestPlanRef = useRef<OutputPlan | null>(null);
  const fitPlanRef = useRef<(plan: OutputPlan | null) => boolean>(() => false);
  const rustTransport = useMemo(() => new VscodeRustTransport(api.postMessage), [api]);

  const measureViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setViewportSize({ width: rect.width, height: rect.height });
  }, []);

  const fitPlan = useCallback((plan: OutputPlan | null): boolean => {
    if (!plan || viewportSize.width <= 0 || viewportSize.height <= 0) return false;
    const bounds = outputPreviewFitBoundsFor(plan);
    if (!bounds) return false;
    setViewport(fitOutputPreviewViewport(bounds, viewportSize));
    return true;
  }, [viewportSize]);

  const updateSelectedOutputKey = useCallback((nextKey: string | null) => {
    if (selectedOutputKeyRef.current === nextKey) return;
    selectedOutputKeyRef.current = nextKey;
    selectionGenerationRef.current += 1;
    setSelectedOutputKey(nextKey);
  }, []);

  const applyOpenSelection = useCallback((cursorOffset: number) => {
    const state = useCadDocumentStore.getState();
    if (state.sourceText !== state.docText) {
      pendingOpenOffsetRef.current = cursorOffset;
      return;
    }
    const currentCandidates = outputPreviewCandidatesFor(state.sourceText, effectiveCompiledDocument(state));
    const selected = selectOutputPreviewCandidate({
      candidates: currentCandidates,
      cursorOffset,
      existingKey: selectedOutputKeyRef.current
    });
    pendingOpenOffsetRef.current = null;
    updateSelectedOutputKey(selected?.key ?? null);
  }, [updateSelectedOutputKey]);

  useEffect(() => {
    selectedOutputKeyRef.current = selectedOutputKey;
  }, [selectedOutputKey]);

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
    if (pendingOpenOffsetRef.current !== null) {
      applyOpenSelection(pendingOpenOffsetRef.current);
    }
  }, [applyOpenSelection, candidates, sourceIsCurrent]);

  useEffect(() => {
    const fallbackKey = candidates[0]?.key ?? null;
    const currentKey = selectedOutputKeyRef.current;
    if (outputPreviewCandidateForKey(candidates, currentKey) || currentKey === fallbackKey) return;
    updateSelectedOutputKey(fallbackKey);
  }, [candidates, selectedOutputKey, updateSelectedOutputKey]);

  const selectedCandidate = outputPreviewCandidateForKey(candidates, selectedOutputKey);

  useEffect(() => {
    let cancelled = false;
    if (!sourceIsCurrent) {
      return () => { cancelled = true; };
    }
    if (!selectedCandidate) {
      return () => { cancelled = true; };
    }
    void evaluateOutputPlan({
      compiledDocument,
      output: selectedCandidate.output,
      evaluate: (elements, options) => evaluateElementsWithRust(elements, options, rustTransport.transport)
    }).then((plan) => {
      if (!cancelled) setEvaluationState({ outputKey: selectedCandidate.key, plan, evaluating: false, error: null });
    }).catch((error: unknown) => {
      if (!cancelled) setEvaluationState({
        outputKey: selectedCandidate.key,
        plan: null,
        evaluating: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    return () => { cancelled = true; };
  }, [bindingIssueDiagnostics, compiledDocument, diagnostics, rustTransport, selectedCandidate, sourceIsCurrent]);

  const activePlan = sourceIsCurrent && selectedCandidate && evaluationState.outputKey === selectedCandidate.key
    ? evaluationState.plan
    : null;

  useEffect(() => {
    latestPlanRef.current = activePlan;
    fitPlanRef.current = fitPlan;
  }, [activePlan, fitPlan]);

  useEffect(() => {
    if (!sourceIsCurrent) return;
    const plan = activePlan;
    if (!plan) return;
    const identity = `${plan.kind}:${plan.outputId}`;
    const fitToken = `${selectionGenerationRef.current}:${identity}`;
    if (fittedSelectionTokenRef.current === fitToken) return;
    if (fitPlan(plan)) fittedSelectionTokenRef.current = fitToken;
  }, [activePlan, fitPlan, sourceIsCurrent, selectedOutputKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToVscodeMessage>) => {
      const message = event.data;
      if (rustTransport.handleMessage(message)) return;
      if (message.type === "outputPreviewOpen") {
        if (latestHostDocumentVersionRef.current !== message.documentVersion) return;
        applyOpenSelection(message.normalizedSourceOffset);
        return;
      }
      if (message.type === "outputPreviewFit") {
        fitPlanRef.current(latestPlanRef.current);
        return;
      }
      if (message.type === "replaceTextDocument") {
        if (latestHostDocumentVersionRef.current !== null && message.documentVersion < latestHostDocumentVersionRef.current) return;
        latestHostDocumentVersionRef.current = message.documentVersion;
        useCadDocumentStore.getState().replaceTextDocument(message.sourceText, {
          currentFilePath: null,
          dirtySinceSave: false
        });
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
        return;
      }
      if (message.type === "commitText") {
        if (latestHostDocumentVersionRef.current !== null && message.documentVersion < latestHostDocumentVersionRef.current) return;
        latestHostDocumentVersionRef.current = message.documentVersion;
        useCadDocumentStore.getState().commitText(message.sourceText, "editor");
        api.postMessage({ type: "webviewAuthoritativeDocumentReady", documentVersion: message.documentVersion });
      }
    };
    window.addEventListener("message", onMessage);
    api.postMessage({ type: "webviewReady" });
    return () => {
      window.removeEventListener("message", onMessage);
      rustTransport.dispose();
    };
  }, [api, applyOpenSelection, rustTransport]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setViewport((current) => zoomOutputPreviewViewportAt(
      current,
      Math.pow(1.1, -event.deltaY / 100),
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height
      }
    ));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId || (event.buttons & 4) === 0) return;
    setViewport((current) => ({
      ...current,
      panX: current.panX + event.clientX - pan.lastX,
      panY: current.panY + event.clientY - pan.lastY
    }));
    panRef.current = { ...pan, lastX: event.clientX, lastY: event.clientY };
  };

  const stopPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };

  const navigateToSourceRange = (range: { from: number; to: number } | null) => {
    const documentVersion = latestHostDocumentVersionRef.current;
    if (!range || documentVersion === null) return;
    api.postMessage({
      type: "outputPreviewSourceNavigation",
      documentVersion,
      range
    });
  };

  const navigateToSelectedOutput = () => navigateToSourceRange(selectedCandidate?.sourceRange ?? null);

  const plan = activePlan;
  const currentDiagnostic = [...diagnostics, ...bindingIssueDiagnostics].find((diagnostic) => diagnostic.severity === "error") ?? diagnostics[0] ?? bindingIssueDiagnostics[0];
  const diagnosticSourceRange = outputPreviewDiagnosticSourceRangeFor(sourceText, currentSourceRevision, currentDiagnostic);
  const sourceNavigationRange = diagnosticSourceRange ?? selectedCandidate?.sourceRange ?? null;
  const previewError = sourceIsCurrent
    ? selectedCandidate && evaluationState.outputKey === selectedCandidate.key ? evaluationState.error : null
    : diagnosticMessageFor({ ...useCadDocumentStore.getState(), diagnostics, bindingIssueDiagnostics });
  const pageRects = plan ? outputPreviewPageRectsFor(plan, viewportSize, viewport) : [];
  const guideLines = plan ? outputPreviewGuideLinesFor(plan, viewportSize, viewport) : [];
  const paperBounds = plan?.kind === "svg" ? plan.bounds : null;
  const paperRect = paperBounds && viewportSize.width > 0
    ? (() => {
        const topLeft = outputPreviewWorldToScreen({ x: paperBounds.minX, y: paperBounds.maxY }, viewportSize, viewport);
        return { x: topLeft.x, y: topLeft.y, width: paperBounds.width * viewport.zoom, height: paperBounds.height * viewport.zoom };
      })()
    : null;

  return (
    <main ref={workspaceRef} className="output-preview-workspace vscode-canvas-webview">
      <header className="output-preview-toolbar">
        <select
          aria-label="Output"
          value={selectedOutputKey ?? ""}
          onChange={(event) => updateSelectedOutputKey(event.target.value || null)}
          disabled={candidates.length === 0}
        >
          {candidates.length === 0 ? <option value="">No outputs</option> : null}
          {candidates.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {outputKindLabel(candidate)} · {candidate.output.name}
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
            label: "Output Preview",
            x: null,
            y: 0,
            orientation: "horizontal",
            iconSize: VSCODE_CANVAS_RIBBON_ICON_SIZE,
            items: [
              {
                id: "output-preview-source-navigation",
                type: "command",
                commandId: "outputPreviewSourceNavigation",
                icon: "crosshair",
                label: "ソースエディタで出力定義を表示",
                description: "選択した出力定義をソースエディタで表示します。",
                showLabel: false,
                available: Boolean(selectedCandidate),
                nativeDisabled: !selectedCandidate
              },
              {
                id: "output-preview-fit",
                type: "command",
                commandId: "outputPreviewFit",
                icon: "maximize",
                label: "出力全体をプレビューに合わせる",
                description: "選択した出力全体が収まるようにプレビューを調整します。",
                showLabel: false,
                available: Boolean(plan),
                nativeDisabled: !plan
              }
            ]
          }}
          iconResolver={resolveVscodeLucideIcon}
          onCommand={(item) => {
            if (item.commandId === "outputPreviewSourceNavigation") navigateToSelectedOutput();
            if (item.commandId === "outputPreviewFit") api.postMessage({ type: "outputPreviewFit" });
          }}
        />
        {evaluationState.evaluating ? <span className="output-preview-status">Evaluating…</span> : null}
      </header>
      <div
        ref={viewportRef}
        className="output-preview-viewport"
        tabIndex={0}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onAuxClick={(event) => event.preventDefault()}
      >
        {previewError ? (
          <div className="output-preview-state output-preview-error" role="alert">
            <strong>Output Preview unavailable</strong>
            <span>{previewError}</span>
            {sourceNavigationRange ? <button type="button" onClick={() => navigateToSourceRange(sourceNavigationRange)}>Go to source</button> : null}
          </div>
        ) : !selectedCandidate ? (
          <div className="output-preview-state" role="status">
            <strong>No print or SVG outputs</strong>
            <span>Add a print or svg declaration in the Source Editor.</span>
          </div>
        ) : plan ? (
          <svg className="output-preview-plane" width="100%" height="100%" aria-label="Output preview">
            {paperRect ? <rect {...paperRect} data-output-preview-layer="output-fill" fill="#ffffff" /> : null}
            {pageRects.map((page, index) => <rect key={`page-fill-${index}`} {...page} data-output-preview-layer="page-fill" fill="#ffffff" />)}
            {plan.drawables.map((drawable) => drawableSvg(drawable, viewportSize, viewport))}
            {pageRects.map((page, index) => <rect key={`page-boundary-${index}`} {...page} data-output-preview-layer="page-boundary" fill="none" stroke="#9aa0a6" strokeWidth={1} />)}
            {guideLines.map((guide, index) => <line key={`guide-${index}`} {...guide} data-output-preview-layer="overlap-guide" stroke="#70757a" strokeWidth={1} strokeDasharray="6 4" />)}
          </svg>
        ) : null}
      </div>
    </main>
  );
};
