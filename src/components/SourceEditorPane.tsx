import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RefObject } from "react";
import { Layers3, Palette } from "lucide-react";
import { SourceEditorController } from "../editor/sourceEditorController";
import type { SourceEditorHandle, SourceEvaluationPublication } from "../editor/sourceEditorTypes";
import type { DslDiagnostic, DslDiagnosticNavigationTarget } from "../dsl/dslTypes";
import type { CommandContext } from "../commands/commands";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { fileNameFromPath } from "../document/nuiFormat";
import { DocumentDiagnostics } from "./DocumentDiagnostics";
import { SourceRibbonDock } from "./SourceRibbonDock";
import { SourceEditorContextMenu, type SourceEditorContextMenuState } from "./SourceEditorContextMenu";
import { SourceSearchPanel } from "./SourceSearchPanel";
import { dispatchCommand } from "../commands/commands";
import type { ElementId } from "../types/geometry";

type SourceEditorPaneProps = {
  commandContext?: CommandContext;
  canvasFocusRef?: RefObject<HTMLDivElement | null>;
  /** Dock element ref shared with CommandRibbonOverlay's drop-to-dock hit test. */
  commandRibbonDockRef?: RefObject<HTMLDivElement | null>;
  inert?: boolean;
};

/**
 * The permanent left pane: the DSL source editor that replaced the legacy
 * element-list LeftPanel in Phase 2e.
 */
export const SourceEditorPane = forwardRef<SourceEditorHandle, SourceEditorPaneProps>(function SourceEditorPane(
  { commandContext = {}, canvasFocusRef, commandRibbonDockRef, inert = false },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SourceEditorController | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const isSearchOpenRef = useRef(isSearchOpen);
  isSearchOpenRef.current = isSearchOpen;
  const [contextMenuState, setContextMenuState] = useState<SourceEditorContextMenuState | null>(null);
  const [isLastGoodEvaluation, setIsLastGoodEvaluation] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<readonly DslDiagnostic[]>([]);
  const currentFilePath = useCadDocumentStore((state) => state.currentFilePath);
  const dirtySinceSave = useCadDocumentStore((state) => state.dirtySinceSave);
  // Task 48: docText/sourceText are the same reactive dirty signal Inspector
  // already subscribes to (InspectorPanel.tsx) - re-deriving runtimeDiagnostics
  // whenever either changes is what makes a single-character edit clear a
  // runtime marker on its very next render, without waiting for a new
  // evaluation. onEvaluationPresentationChange below covers the other
  // trigger: an async evaluation result arriving with no new keystroke.
  const docText = useCadDocumentStore((state) => state.docText);
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const commandErrorMessage = useCadUiStore((state) => state.commandErrorMessage);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasFocusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = new SourceEditorController(containerRef.current, undefined, undefined, {
      onRequestCanvasFocus: () => (canvasFocusRef ?? fallbackCanvasFocusRef).current?.focus(),
      onRequestElementSearch: () => {
        setIsSearchOpen(true);
        controllerRef.current?.focusSearch();
      },
      onRequestContextMenu: (elementId: ElementId, x: number, y: number) => setContextMenuState({ elementId, x, y }),
      isSourceSearchOpen: () => isSearchOpenRef.current,
      closeSourceSearch: () => setIsSearchOpen(false),
      onEvaluationPresentationChange: ({ isLastGood }) => {
        setIsLastGoodEvaluation(isLastGood);
        // Task 48: the async-evaluation-arrived trigger - a fresh evaluation
        // can complete with no new keystroke, so runtimeDiagnostics must be
        // re-derived here too, not only from the docText/sourceText effect
        // below.
        setRuntimeDiagnostics(controllerRef.current?.runtimeDiagnostics() ?? []);
      }
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setRuntimeDiagnostics(controllerRef.current?.runtimeDiagnostics() ?? []);
  }, [docText, sourceText]);

  // Task 48: Problems-popover navigation - one explicit, non-cascading
  // switch per DslDiagnosticNavigationTarget kind. Each branch calls exactly
  // the one SourceEditorHandle method that owns that kind's exact-span-or-
  // no-op contract; there is no generic fallback between kinds (e.g. a
  // property target never falls back to a declaration jump).
  const navigateToDiagnostic = (target: DslDiagnosticNavigationTarget) => {
    const controller = controllerRef.current;
    if (!controller) return;
    switch (target.kind) {
      case "binding":
        controller.jumpToBindingDeclaration(target.bindingId);
        return;
      case "property":
        controller.jumpToPropertyBindingValue(target.occurrenceKey);
        return;
      case "templateHole":
        controller.jumpToTemplateHole(target.occurrenceKey, target.holeIndex);
        return;
      case "element":
        controller.jumpToElement(target.elementId);
        return;
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => controllerRef.current?.focus(),
    currentCursorElementId: () => controllerRef.current?.currentCursorElementId() ?? null,
    getText: () => controllerRef.current?.getText() ?? "",
    setEvaluation: (publication: SourceEvaluationPublication) => controllerRef.current?.setEvaluation(publication),
    jumpToElement: (elementId) => controllerRef.current?.jumpToElement(elementId),
    jumpToElementEnd: (elementId) => controllerRef.current?.jumpToElementEnd(elementId) ?? false,
    jumpToParameterValue: (elementId, parameterKey) => controllerRef.current?.jumpToParameterValue(elementId, parameterKey) ?? false,
    jumpToBindingDeclaration: (bindingId) => controllerRef.current?.jumpToBindingDeclaration(bindingId) ?? false,
    jumpToBindingDeclarationPart: (bindingId, part) => controllerRef.current?.jumpToBindingDeclarationPart(bindingId, part) ?? false,
    jumpToPropertyBindingValue: (occurrenceKey) => controllerRef.current?.jumpToPropertyBindingValue(occurrenceKey) ?? false,
    jumpToTemplateHole: (occurrenceKey, holeIndex) => controllerRef.current?.jumpToTemplateHole(occurrenceKey, holeIndex) ?? false,
    applyPickCandidate: (elementId) => controllerRef.current?.applyPickCandidate(elementId) ?? false,
    pickCandidateElementIds: () => controllerRef.current?.pickCandidateElementIds() ?? [],
    openTextSearch: () => controllerRef.current?.openTextSearch(),
    closeTextSearch: () => controllerRef.current?.closeTextSearch(),
    runtimeDiagnostics: () => controllerRef.current?.runtimeDiagnostics() ?? [],
    focusSearch: () => {
      setIsSearchOpen(true);
      controllerRef.current?.focusSearch();
    }
  }), []);

  return (
    <div className="source-editor-pane-wrapper" data-source-editor-scope="true" inert={inert || undefined}>
      <header className="source-editor-header">
        <div className="source-editor-header-actions">
          <button type="button" className="palette-open-button" onClick={() => dispatchCommand("openPaletteSettings")}>
            <Palette size={15} aria-hidden="true" />
            <span className="source-editor-icon-button-label">パレット</span>
          </button>
          <button
            type="button"
            className="visibility-profile-open-button"
            onClick={() => dispatchCommand("openVisibilityProfileSettings")}
          >
            <Layers3 size={15} aria-hidden="true" />
            <span className="source-editor-icon-button-label">表示プロファイル</span>
          </button>
        </div>
        <p className="document-status" title={currentFilePath ?? "未保存"}>
          <span>{fileNameFromPath(currentFilePath)}</span>
          {dirtySinceSave ? <span className="document-dirty">未保存の変更</span> : null}
          {isLastGoodEvaluation ? <span className="document-stale-evaluation">評価: last-good</span> : null}
        </p>
        <DocumentDiagnostics runtimeDiagnostics={runtimeDiagnostics} onNavigate={navigateToDiagnostic} />
        {commandErrorMessage ? <p className="command-error-message" role="alert">{commandErrorMessage}</p> : null}
      </header>
      <SourceSearchPanel
        handle={controllerRef.current}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
      <div className="source-editor-pane" ref={containerRef} aria-label="DSL source editor" />
      {contextMenuState ? (
        <SourceEditorContextMenu
          commandContext={commandContext}
          state={contextMenuState}
          onClose={() => setContextMenuState(null)}
        />
      ) : null}
      <SourceRibbonDock
        canvasFocusRef={canvasFocusRef ?? fallbackCanvasFocusRef}
        commandContext={commandContext}
        dockRef={commandRibbonDockRef ?? dockRef}
        isSearchActive={isSearchOpen}
      />
    </div>
  );
});
