import { useLayoutEffect, useRef, useState } from "react";

export type CanvasModeStatusOrderedDraftEntry = {
  key: string;
  label: string;
};

export type CanvasModeStatusModel = {
  title: string;
  instruction: string;
  targetLabel?: string | null;
  currentSelection?: string | null;
  currentValue?: string | null;
  orderedDraft?: {
    entries: readonly CanvasModeStatusOrderedDraftEntry[];
    count: number;
    onMove: (key: string, toIndex: number) => void;
    onRemove: (key: string) => void;
  };
  finishLabel: string;
  finishHint: string;
  onFinish: () => void;
  finishDisabled?: boolean;
  compactReferencePick?: boolean;
  actions?: readonly { label: string; onClick: () => void; disabled?: boolean }[];
  secondaryActions?: readonly { label: string; onClick: () => void; disabled?: boolean }[];
};

type CanvasModeStatusAction = "move-up" | "move-down" | "remove";
type PendingCanvasModeStatusFocus =
  | { kind: "entry"; key: string; action: CanvasModeStatusAction }
  | { kind: "finish" };

const canvasModeStatusActions: readonly CanvasModeStatusAction[] = ["move-up", "move-down", "remove"];

export const CanvasModeStatus = ({ model }: { model: CanvasModeStatusModel }) => {
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const actionButtonRefs = useRef(new Map<string, Partial<Record<CanvasModeStatusAction, HTMLButtonElement | null>>>());
  const finishButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<PendingCanvasModeStatusFocus | null>(null);

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
    const actionIndex = canvasModeStatusActions.indexOf(pendingFocus.action);
    const directTarget = entryRefs[pendingFocus.action];
    if (directTarget && !directTarget.disabled) {
      directTarget.focus();
      return;
    }
    for (const action of canvasModeStatusActions.slice(actionIndex + 1)) {
      const fallbackTarget = entryRefs[action];
      if (fallbackTarget && !fallbackTarget.disabled) {
        fallbackTarget.focus();
        return;
      }
    }
  }, [model.orderedDraft?.entries]);

  const setActionButtonRef = (
    key: string,
    action: CanvasModeStatusAction,
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
    const moveEntry = (key: string, action: CanvasModeStatusAction, toIndex: number) => {
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
      <div className="canvas-mode-status-selection" aria-label={`選択済み ${count} 件`}>
        <span>選択済み {count}件</span>
        {entries.length > 0 ? (
          <ol className="canvas-mode-status-list" onWheel={(event) => event.stopPropagation()}>
            {entries.map((entry, index) => (
              <li key={entry.key} className="canvas-mode-status-list-item" data-canvas-mode-draft-key={entry.key}>
                <span className="canvas-mode-status-list-index">{index + 1}</span>
                <span className="canvas-mode-status-list-label" title={entry.label}>{entry.label}</span>
                <span className="canvas-mode-status-list-actions">
                  <button
                    type="button"
                    aria-label={`${entry.label}を上へ移動`}
                    disabled={index === 0}
                    ref={(button) => setActionButtonRef(entry.key, "move-up", button)}
                    onClick={() => moveEntry(entry.key, "move-up", index - 1)}
                  >↑</button>
                  <button
                    type="button"
                    aria-label={`${entry.label}を下へ移動`}
                    disabled={index === entries.length - 1}
                    ref={(button) => setActionButtonRef(entry.key, "move-down", button)}
                    onClick={() => moveEntry(entry.key, "move-down", index + 1)}
                  >↓</button>
                  <button
                    type="button"
                    aria-label={`${entry.label}を削除`}
                    ref={(button) => setActionButtonRef(entry.key, "remove", button)}
                    onClick={() => removeEntry(entry.key)}
                  >×</button>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  };

  const renderPrimaryActions = () => (
    <div className="canvas-mode-status-primary-actions">
      <button ref={finishButtonRef} type="button" disabled={model.finishDisabled} onClick={model.onFinish}>{model.finishLabel}</button>
      {model.actions?.map(action => <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
    </div>
  );

  const renderSecondaryActions = () => model.secondaryActions?.length ? (
    <div className="canvas-mode-status-more">
      <button
        type="button"
        className="canvas-mode-status-more-toggle"
        aria-label="その他の参照操作"
        aria-expanded={secondaryActionsOpen}
        aria-controls="canvas-mode-status-more-menu"
        title="その他の参照操作"
        onClick={() => setSecondaryActionsOpen(open => !open)}
      >…</button>
      {secondaryActionsOpen ? (
        <div id="canvas-mode-status-more-menu" className="canvas-mode-status-more-menu" role="group" aria-label="その他の参照操作">
          {model.secondaryActions.map(action => (
            <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <aside
      className={`canvas-mode-status${model.compactReferencePick ? " is-reference-pick-compact" : ""}`}
      role="status"
      aria-live="polite"
      data-canvas-mode-status="true"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={model.compactReferencePick ? (event) => event.stopPropagation() : undefined}
    >
      {!model.compactReferencePick ? <span className="canvas-mode-status-title" aria-hidden="true">{model.title}</span> : null}
      <div className="canvas-mode-status-copy">
        {model.targetLabel ? <strong>{model.targetLabel}</strong> : <strong>{model.instruction}</strong>}
        {model.targetLabel ? <small>{model.instruction}</small> : null}
        {model.compactReferencePick && model.currentSelection !== null && model.currentSelection !== undefined ? (
          <span className="canvas-mode-status-current-reference" aria-label="選択した参照">{model.currentSelection}</span>
        ) : model.compactReferencePick && model.currentValue !== null && model.currentValue !== undefined ? (
          <span className="canvas-mode-status-current-reference" aria-label="選択した値">{model.currentValue}</span>
        ) : model.currentSelection !== null && model.currentSelection !== undefined ? (
          <div className="canvas-mode-status-selection" aria-label="現在の選択">
            <span>現在の選択: {model.currentSelection}</span>
          </div>
        ) : null}
        {model.currentValue !== null && model.currentValue !== undefined ? (
          <div className="canvas-mode-status-selection" aria-label="現在の選択">
            <span>現在の値: <code>{model.currentValue}</code></span>
          </div>
        ) : null}
        {renderOrderedDraft()}
      </div>
      {model.compactReferencePick ? renderPrimaryActions() : (
        <>
          {model.actions?.map(action => <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
          <button ref={finishButtonRef} type="button" disabled={model.finishDisabled} onClick={model.onFinish}>{model.finishLabel}</button>
        </>
      )}
      {model.compactReferencePick ? renderSecondaryActions() : null}
      <kbd title={model.finishHint}>↵</kbd>
      <kbd>Esc</kbd>
    </aside>
  );
};
