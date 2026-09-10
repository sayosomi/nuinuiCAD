import { useLayoutEffect, useRef } from "react";
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

export type PickModeStatusOrderedDraftEntry = {
  key: string;
  label: string;
};

export type PickModeStatusModel = {
  targetLabel: string;
  instruction: string;
  currentSelection?: string | null;
  currentValue?: string | null;
  orderedDraft?: {
    entries: readonly PickModeStatusOrderedDraftEntry[];
    count: number;
    onMove: (key: string, toIndex: number) => void;
    onRemove: (key: string) => void;
  };
  onFinish: () => void;
};

type PickModeStatusAction = "move-up" | "move-down" | "remove";
type PendingPickModeStatusFocus =
  | { kind: "entry"; key: string; action: PickModeStatusAction }
  | { kind: "finish" };

const pickModeStatusActions: readonly PickModeStatusAction[] = ["move-up", "move-down", "remove"];

export const PickModeStatusView = ({ model }: { model: PickModeStatusModel }) => {
  const actionButtonRefs = useRef(new Map<string, Partial<Record<PickModeStatusAction, HTMLButtonElement | null>>>());
  const finishButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<PendingPickModeStatusFocus | null>(null);

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) return;
    pendingFocusRef.current = null;

    if (pendingFocus.kind === "finish") {
      finishButtonRef.current?.focus();
      return;
    }

    const entryRefs = actionButtonRefs.current.get(pendingFocus.key);
    if (!entryRefs) return;
    const actionIndex = pickModeStatusActions.indexOf(pendingFocus.action);
    const directTarget = entryRefs[pendingFocus.action];
    if (directTarget && !directTarget.disabled) {
      directTarget.focus();
      return;
    }
    for (const action of pickModeStatusActions.slice(actionIndex + 1)) {
      const fallbackTarget = entryRefs[action];
      if (fallbackTarget && !fallbackTarget.disabled) {
        fallbackTarget.focus();
        return;
      }
    }
  }, [model.orderedDraft?.entries]);

  const setActionButtonRef = (
    key: string,
    action: PickModeStatusAction,
    button: HTMLButtonElement | null
  ) => {
    let entryRefs = actionButtonRefs.current.get(key);
    if (!entryRefs) {
      entryRefs = {};
      actionButtonRefs.current.set(key, entryRefs);
    }
    entryRefs[action] = button;
  };

  const renderOrderedDraft = () => {
    if (!model.orderedDraft) return null;
    const { entries, count, onMove, onRemove } = model.orderedDraft;
    const moveEntry = (key: string, action: PickModeStatusAction, toIndex: number) => {
      pendingFocusRef.current = { kind: "entry", key, action };
      onMove(key, toIndex);
    };
    const removeEntry = (key: string) => {
      const removedIndex = entries.findIndex((entry) => entry.key === key);
      if (removedIndex >= 0) {
        const fallbackEntry = entries[removedIndex + 1] ?? entries[removedIndex - 1];
        pendingFocusRef.current = fallbackEntry
          ? { kind: "entry", key: fallbackEntry.key, action: "remove" }
          : { kind: "finish" };
      }
      onRemove(key);
    };
    return (
      <div className="pick-mode-status-selection" aria-label={`選択済み ${count} 件`}>
        <span>選択済み {count}件</span>
        {entries.length > 0 ? (
          <ol className="pick-mode-status-list" onWheel={(event) => event.stopPropagation()}>
            {entries.map((entry, index) => (
              <li
                key={entry.key}
                className="pick-mode-status-list-item"
                data-pick-draft-key={entry.key}
              >
                <span className="pick-mode-status-list-index">{index + 1}</span>
                <span className="pick-mode-status-list-label" title={entry.label}>{entry.label}</span>
                <span className="pick-mode-status-list-actions">
                  <button
                    type="button"
                    aria-label={`${entry.label}を上へ移動`}
                    disabled={index === 0}
                    ref={(button) => setActionButtonRef(entry.key, "move-up", button)}
                    onClick={() => moveEntry(entry.key, "move-up", index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`${entry.label}を下へ移動`}
                    disabled={index === entries.length - 1}
                    ref={(button) => setActionButtonRef(entry.key, "move-down", button)}
                    onClick={() => moveEntry(entry.key, "move-down", index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`${entry.label}を削除`}
                    ref={(button) => setActionButtonRef(entry.key, "remove", button)}
                    onClick={() => removeEntry(entry.key)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      className="pick-mode-status"
      role="status"
      aria-live="polite"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="pick-mode-status-title" aria-hidden="true">PICK MODE</span>
      <div className="pick-mode-status-copy">
        <strong>{model.targetLabel}</strong>
        <small>{model.instruction}</small>
        {model.currentSelection !== null && model.currentSelection !== undefined ? (
          <div className="pick-mode-status-selection" aria-label="現在の選択">
            <span>現在の選択: {model.currentSelection}</span>
          </div>
        ) : null}
        {model.currentValue !== null && model.currentValue !== undefined ? (
          <div className="pick-mode-status-selection" aria-label="現在の選択">
            <span>現在の値: <code>{model.currentValue}</code></span>
          </div>
        ) : null}
        {renderOrderedDraft()}
      </div>
      <button ref={finishButtonRef} type="button" onClick={model.onFinish}>
        選択を完了
      </button>
      <kbd title="Enter で選択を完了">↵</kbd>
      <kbd>Esc</kbd>
    </aside>
  );
};

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
      : "Canvasから点を選択"
    : pickModeSession.kind === "numeric-reference"
      ? "線・曲線を選び、使用する値を明示的に選択"
      : isLineList
        ? `線を仮選択中（${selectedCount}件）。Canvas上で追加・解除できます。`
        : "Canvasから線を選択";
  const finish = () => dispatchCommand("finishPickMode");
  const moveDraftEntry = (key: string, toIndex: number) => {
    movePickModeDraftEntryInSession(key, toIndex);
  };
  const removeDraftEntry = (key: string) => {
    removePickModeDraftEntryFromSession(key);
  };
  return (
    <PickModeStatusView
      model={{
        targetLabel: `${element?.name ?? targetElementId} / ${definition?.label ?? targetParameterKey}`,
        instruction,
        currentSelection: pointDraftLabel ?? lineDraftLabel,
        currentValue: numericReferenceEntry?.expression,
        orderedDraft: isLineList ? {
          entries: draft
            .filter((entry): entry is Extract<typeof draft[number], { kind: "line" }> => entry.kind === "line")
            .map((entry) => ({
              key: entry.key,
              label: elements.find((candidate) => candidate.id === entry.lineId)?.name ?? entry.lineId
            })),
          count: selectedCount,
          onMove: moveDraftEntry,
          onRemove: removeDraftEntry
        } : isPointList ? {
          entries: draft
            .filter((entry): entry is Extract<typeof draft[number], { kind: "point" }> => entry.kind === "point")
            .map((entry) => ({ key: entry.key, label: pointAnchorName(entry.anchor, elements) })),
          count: selectedPointCount,
          onMove: moveDraftEntry,
          onRemove: removeDraftEntry
        } : undefined,
        onFinish: finish
      }}
    />
  );
};
