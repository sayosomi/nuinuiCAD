import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RefObject } from "react";
import { Layers3, Palette } from "lucide-react";
import { SourceEditorController } from "../editor/sourceEditorController";
import type { SourceEditorHandle, SourceEvaluationPublication } from "../editor/sourceEditorTypes";
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
  const currentFilePath = useCadDocumentStore((state) => state.currentFilePath);
  const dirtySinceSave = useCadDocumentStore((state) => state.dirtySinceSave);
  const commandErrorMessage = useCadUiStore((state) => state.commandErrorMessage);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasFocusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = new SourceEditorController(containerRef.current, undefined, undefined, {
      onRequestCanvasFocus: () => (canvasFocusRef ?? fallbackCanvasFocusRef).current?.focus(),
      onRequestContextMenu: (elementId: ElementId, x: number, y: number) => setContextMenuState({ elementId, x, y }),
      isSourceSearchOpen: () => isSearchOpenRef.current,
      closeSourceSearch: () => setIsSearchOpen(false),
      onEvaluationPresentationChange: ({ isLastGood }) => setIsLastGoodEvaluation(isLastGood)
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => controllerRef.current?.focus(),
    currentCursorElementId: () => controllerRef.current?.currentCursorElementId() ?? null,
    getText: () => controllerRef.current?.getText() ?? "",
    setEvaluation: (publication: SourceEvaluationPublication) => controllerRef.current?.setEvaluation(publication),
    jumpToElement: (elementId) => controllerRef.current?.jumpToElement(elementId),
    jumpToParameterValue: (elementId, parameterKey) => controllerRef.current?.jumpToParameterValue(elementId, parameterKey) ?? false,
    applyPickCandidate: (elementId) => controllerRef.current?.applyPickCandidate(elementId) ?? false,
    pickCandidateElementIds: () => controllerRef.current?.pickCandidateElementIds() ?? [],
    openTextSearch: () => controllerRef.current?.openTextSearch(),
    closeTextSearch: () => controllerRef.current?.closeTextSearch(),
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
        <DocumentDiagnostics />
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
