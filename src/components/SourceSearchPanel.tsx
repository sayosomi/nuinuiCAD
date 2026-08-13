import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { elementSearchResults } from "../model/elementSearch";
import { visibilityRoleNamesById } from "../model/visibilityProfiles";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";
import type { ElementId } from "../types/geometry";

type SourceSearchPanelProps = {
  handle: SourceEditorHandle | null;
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Plain React, no `@codemirror/*` import. Reuses elementSearchResults for
 * name/ID/type/role search, && delegates to the handle's plain
 * openTextSearch/closeTextSearch for CodeMirror's own text search — this
 * component never touches CM itself.
 */
export const SourceSearchPanel = ({ handle, isOpen, onClose }: SourceSearchPanelProps) => {
  const elements = useCadDocumentStore(effectiveElements);
  const visibilityRoles = useCadDocumentStore((state) => state.visibilityRoles);
  const query = useCadUiStore((state) => state.elementSearchQuery);
  const cursorId = useCadUiStore((state) => state.elementSearchCursorId);
  const setElementSearchQuery = useCadUiStore((state) => state.setElementSearchQuery);
  const setElementSearchCursorId = useCadUiStore((state) => state.setElementSearchCursorId);
  const elementSearchPickableOnly = useCadUiStore((state) => state.elementSearchPickableOnly);
  const setElementSearchPickableOnly = useCadUiStore((state) => state.setElementSearchPickableOnly);
  const isPickActive = useCadUiStore((state) => Boolean(
    state.activePointPickTarget || state.activeNumericReferencePickTarget || state.activeLinePickTarget
  ));
  const [mode, setMode] = useState<"element" | "text">("element");

  const roleNamesById = useMemo(() => visibilityRoleNamesById(visibilityRoles), [visibilityRoles]);
  const results = useMemo(
    () => {
      if (mode !== "element" || !query.trim()) return [];
      const pickable = new Set(handle?.pickCandidateElementIds() ?? []);
      return elementSearchResults(elements, query, roleNamesById)
        .filter((result) => !elementSearchPickableOnly || pickable.has(result.element.id));
    },
    [mode, elements, query, roleNamesById, elementSearchPickableOnly, handle]
  );
  const activeCursorId = results.some((result) => result.element.id === cursorId)
    ? cursorId
    : results[0]?.element.id ?? null;

  useEffect(() => {
    if (isOpen && mode === "text") handle?.openTextSearch();
    else handle?.closeTextSearch();
  }, [mode, handle, isOpen]);

  if (!isOpen) return null;

  const moveCursor = (offset: 1 | -1) => {
    if (results.length === 0) return;
    const currentIndex = activeCursorId ? results.findIndex((result) => result.element.id === activeCursorId) : -1;
    const nextIndex = currentIndex < 0 ? (offset > 0 ? 0 : results.length - 1) : (currentIndex + offset + results.length) % results.length;
    setElementSearchCursorId(results[nextIndex].element.id);
  };

  const applyResult = (elementId: ElementId) => {
    if (isPickActive) handle?.applyPickCandidate(elementId);
    else handle?.jumpToElement(elementId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
      return;
    }
    if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (activeCursorId) applyResult(activeCursorId);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        setElementSearchQuery("");
        return;
      }
      onClose();
    }
  };

  return (
    <div className="source-search-panel" data-source-editor-search="true" role="search" aria-label="Source Editor検索">
      <div className="source-search-panel-tabs">
        <button type="button" className={mode === "element" ? "is-active" : ""} onClick={() => setMode("element")}>
          要素検索
        </button>
        <button type="button" className={mode === "text" ? "is-active" : ""} onClick={() => setMode("text")}>
          テキスト検索
        </button>
        <button type="button" aria-label="検索を閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      {mode === "element" ? (
        <>
          <input
            autoFocus
            value={query}
            placeholder="名前 / ID / 型 / 番号で検索"
            aria-label="要素を検索"
            onChange={(event) => setElementSearchQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {isPickActive ? (
            <label className="search-pickable-toggle">
              <input
                type="checkbox"
                checked={elementSearchPickableOnly}
                onChange={(event) => setElementSearchPickableOnly(event.target.checked)}
              />
              選択可能のみ
            </label>
          ) : null}
          <ul className="source-search-results">
            {results.slice(Math.max(0, results.findIndex((result) => result.element.id === activeCursorId) - 50), Math.max(100, results.findIndex((result) => result.element.id === activeCursorId) + 50)).map((result) => (
              <li key={result.element.id}>
                <button
                  type="button"
                  className={result.element.id === activeCursorId ? "is-cursor" : ""}
                  onClick={() => applyResult(result.element.id)}
                >
                  {result.element.name || result.element.id}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="source-search-text-hint">CodeMirrorのテキスト検索を表示しています。</p>
      )}
    </div>
  );
};
