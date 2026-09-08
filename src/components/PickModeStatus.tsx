import { dispatchCommand } from "../commands/commands";
import {
  movePickModeDraftEntryInSession,
  removePickModeDraftEntryFromSession
} from "../commands/pickCommands";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import {
  matchingPickModeSessionForTargets,
  type PickModeDraftEntry
} from "../model/pickModeSession";
import { sourceReferenceText } from "../model/moduleSemanticCandidateBoundary";
import { pointAnchorName } from "./commandLineProgress";

export const PickModeStatus = () => {
  const elements = useCadDocumentStore(effectiveElements);
  const pointTarget = useCadUiStore((state) => state.activePointPickTarget);
  const numericTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const lineTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const pickModeSession = useCadUiStore((state) => matchingPickModeSessionForTargets(state.activePickModeSession, {
    point: state.activePointPickTarget,
    numericReference: state.activeNumericReferencePickTarget,
    line: state.activeLinePickTarget
  }));
  const target = pickModeSession?.kind === "point"
    ? pointTarget
    : pickModeSession?.kind === "numeric-reference"
      ? numericTarget
      : pickModeSession?.kind === "line"
        ? lineTarget
        : null;
  if (!pickModeSession) return null;

  const targetElementId = target?.elementId ?? pickModeSession.targetElementId;
  const targetParameterKey = target?.parameterKey ?? pickModeSession.targetParameterKey;
  const element = elements.find((candidate) => candidate.id === targetElementId);
  const definition = element
    ? findParameterDefinition(element, targetParameterKey)
    : null;
  const isLineList = pickModeSession.kind === "line" && pickModeSession.selectionCardinality === "ordered-multiple";
  const isPointList = pickModeSession.kind === "point" && pickModeSession.selectionCardinality === "ordered-multiple";
  const draft = pickModeSession?.draft ?? [];
  const selectedLineNames = draft
    .filter((entry): entry is Extract<typeof draft[number], { kind: "line" }> => entry.kind === "line")
    .map((entry) => elements.find((candidate) => candidate.id === entry.lineId)?.name ?? entry.lineId);
  const selectedPointNames = draft
    .filter((entry): entry is Extract<typeof draft[number], { kind: "point" }> => entry.kind === "point")
    .map((entry) => pointAnchorName(entry.anchor, elements));
  const singlePointEntry = !isPointList
    ? draft.find((entry): entry is Extract<PickModeDraftEntry, { kind: "point" }> => entry.kind === "point")
    : undefined;
  const singleLineEntry = !isLineList
    ? draft.find((entry): entry is Extract<PickModeDraftEntry, { kind: "line" }> => entry.kind === "line")
    : undefined;
  const numericReferenceEntry = pickModeSession.kind === "numeric-reference"
    ? draft.find((entry): entry is Extract<PickModeDraftEntry, { kind: "numeric-reference" }> => entry.kind === "numeric-reference")
    : undefined;
  const pointDraftLabel = singlePointEntry
    ? sourceReferenceText(singlePointEntry.sourceReference ?? null) ?? pointAnchorName(singlePointEntry.anchor, elements)
    : null;
  const lineDraftLabel = singleLineEntry
    ? sourceReferenceText(singleLineEntry.sourceReference ?? null) ??
      (elements.find((candidate) => candidate.id === singleLineEntry.lineId)?.name ?? singleLineEntry.lineId)
    : null;
  const selectedCount = selectedLineNames.length;
  const selectedPointCount = selectedPointNames.length;
  const instruction = pickModeSession.kind === "point"
    ? isPointList
      ? `点を順番に仮選択中（${selectedPointCount}件）。Canvas上で追加できます。`
      : "Canvasまたは構成リストから点を選択"
    : pickModeSession.kind === "numeric-reference"
      ? "線・曲線を選び、使用する値を明示的に選択"
      : isLineList
        ? `線を仮選択中（${selectedCount}件）。Canvas上で追加・解除できます。`
        : "Canvasまたは構成リストから線を選択";
  const finish = () => dispatchCommand("finishPickMode");
  const moveDraftEntry = (key: string, toIndex: number) => {
    movePickModeDraftEntryInSession(key, toIndex);
  };
  const removeDraftEntry = (key: string) => {
    removePickModeDraftEntryFromSession(key);
  };
  function renderOrderedDraft<T extends Extract<typeof draft[number], { kind: "line" | "point" }>>(
    entries: readonly T[],
    labelFor: (entry: T) => string,
    count: number
  ) {
    return (
    <div className="pick-mode-status-selection" aria-label={`選択済み ${count} 件`}>
      <span>選択済み {count}件</span>
      {entries.length > 0 ? (
        <ol className="pick-mode-status-list">
          {entries.map((entry, index) => {
            const label = labelFor(entry);
            return (
              <li
                key={entry.key}
                className="pick-mode-status-list-item"
                data-pick-draft-key={entry.key}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  event.stopPropagation();
                  moveDraftEntry(entry.key, index + (event.key === "ArrowUp" ? -1 : 1));
                }}
              >
                <span className="pick-mode-status-list-index">{index + 1}</span>
                <span className="pick-mode-status-list-label" title={label}>{label}</span>
                <span className="pick-mode-status-list-actions">
                  <button
                    type="button"
                    aria-label={`${label}を上へ移動`}
                    disabled={index === 0}
                    onClick={() => moveDraftEntry(entry.key, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`${label}を下へ移動`}
                    disabled={index === entries.length - 1}
                    onClick={() => moveDraftEntry(entry.key, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`${label}を削除`}
                    onClick={() => removeDraftEntry(entry.key)}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
    );
  }

  return (
    <aside
      className="pick-mode-status"
      role="status"
      aria-live="polite"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="pick-mode-status-title" aria-hidden="true">PICK MODE</span>
      <div className="pick-mode-status-copy">
        <strong>{element?.name ?? targetElementId} / {definition?.label ?? targetParameterKey}</strong>
        <small>{instruction}</small>
        {pointDraftLabel !== null ? (
          <div className="pick-mode-status-selection" aria-label="現在の選択">
            <span>現在の選択: {pointDraftLabel}</span>
          </div>
        ) : null}
        {lineDraftLabel !== null ? (
          <div className="pick-mode-status-selection" aria-label="現在の選択">
            <span>現在の選択: {lineDraftLabel}</span>
          </div>
        ) : null}
        {numericReferenceEntry ? (
          <div className="pick-mode-status-selection" aria-label="現在の選択">
            <span>現在の値: <code>{numericReferenceEntry.expression}</code></span>
          </div>
        ) : null}
        {isLineList ? (
          renderOrderedDraft(
            draft.filter((entry): entry is Extract<typeof draft[number], { kind: "line" }> => entry.kind === "line"),
            (entry) => elements.find((candidate) => candidate.id === entry.lineId)?.name ?? entry.lineId,
            selectedCount
          )
        ) : null}
        {isPointList ? renderOrderedDraft(
          draft.filter((entry): entry is Extract<typeof draft[number], { kind: "point" }> => entry.kind === "point"),
          (entry) => pointAnchorName(entry.anchor, elements),
          selectedPointCount
        ) : null}
      </div>
      <button type="button" onClick={finish}>
        選択を完了
      </button>
      <kbd title="Enter で選択を完了">↵</kbd>
      <kbd>Esc</kbd>
    </aside>
  );
};
