import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RefObject } from "react";
import { SourceEditorController } from "../editor/sourceEditorController";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import type { CommandContext } from "../commands/commands";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { fileNameFromPath } from "../document/nuiFormat";
import { DocumentDiagnostics } from "./DocumentDiagnostics";
import { LeftPanelRibbonDock } from "./LeftPanelRibbonDock";
import { SourceEditorContextMenu, type SourceEditorContextMenuState } from "./SourceEditorContextMenu";
import { SourceSearchPanel } from "./SourceSearchPanel";
import { dispatchCommand } from "../commands/commands";
import type { ElementId } from "../types/geometry";

type SourceEditorPaneProps = {
  commandContext?: CommandContext;
  canvasFocusRef?: RefObject<HTMLDivElement | null>;
};

/**
 * Phase 2d feature-complete pane, still not mounted by AppLayout in production
 * (that cutover, plus LeftPanel removal, is Phase 2e).
 */
export const SourceEditorPane = forwardRef<SourceEditorHandle, SourceEditorPaneProps>(function SourceEditorPane(
  { commandContext = {}, canvasFocusRef },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SourceEditorController | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const isSearchOpenRef = useRef(isSearchOpen);
  isSearchOpenRef.current = isSearchOpen;
  const [contextMenuState, setContextMenuState] = useState<SourceEditorContextMenuState | null>(null);
  const currentFilePath = useCadDocumentStore((state) => state.currentFilePath);
  const dirtySinceSave = useCadDocumentStore((state) => state.dirtySinceSave);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasFocusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = new SourceEditorController(containerRef.current, undefined, undefined, {
      onRequestCanvasFocus: () => (canvasFocusRef ?? fallbackCanvasFocusRef).current?.focus(),
      onRequestContextMenu: (elementId: ElementId, x: number, y: number) => setContextMenuState({ elementId, x, y }),
      isSourceSearchOpen: () => isSearchOpenRef.current,
      closeSourceSearch: () => setIsSearchOpen(false)
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
    getText: () => controllerRef.current?.getText() ?? "",
    setEvaluation: (evaluation, sourceRevision) => controllerRef.current?.setEvaluation(evaluation, sourceRevision),
    jumpToElement: (elementId) => controllerRef.current?.jumpToElement(elementId),
    openTextSearch: () => controllerRef.current?.openTextSearch(),
    closeTextSearch: () => controllerRef.current?.closeTextSearch(),
    focusSearch: () => {
      setIsSearchOpen(true);
      controllerRef.current?.focusSearch();
    }
  }), []);

  return (
    <div className="source-editor-pane-wrapper">
      <header className="source-editor-header">
        <div className="source-editor-header-actions">
          <button type="button" className="palette-open-button" onClick={() => dispatchCommand("openPaletteSettings")}>
            パレット
          </button>
          <button
            type="button"
            className="visibility-profile-open-button"
            onClick={() => dispatchCommand("openVisibilityProfileSettings")}
          >
            表示プロファイル
          </button>
        </div>
        <p className="document-status" title={currentFilePath ?? "未保存"}>
          <span>{fileNameFromPath(currentFilePath)}</span>
          {dirtySinceSave ? <span className="document-dirty">未保存の変更</span> : null}
        </p>
        <DocumentDiagnostics />
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
      <LeftPanelRibbonDock
        canvasFocusRef={canvasFocusRef ?? fallbackCanvasFocusRef}
        commandContext={commandContext}
        dockRef={dockRef}
        isSearchActive={isSearchOpen}
      />
    </div>
  );
});
