import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { renameElementWithPropagation } from "../commands/renameElementWithPropagation";
import { getSelectedElementIds } from "../commands/commandRuntime";
import { elementQualifiedName } from "../model/elementNames";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import type { ElementId } from "../types/geometry";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { selectTextInputValue } from "./textInputSelection";

type RenameElementDialogProps = {
  onConfirmed: (elementId: ElementId) => void;
};

const staleTargetError = "リネーム対象が変更または削除されたため、確定を中止しました。もう一度選択してください。";

export const RenameElementDialog = ({ onConfirmed }: RenameElementDialogProps) => {
  const targetId = useCadUiStore((state) => state.renameElementPromptTargetId);

  if (!targetId) return null;

  return <RenameElementDialogContent key={targetId} targetId={targetId} onConfirmed={onConfirmed} />;
};

type RenameElementDialogContentProps = RenameElementDialogProps & {
  targetId: ElementId;
};

const RenameElementDialogContent = ({ targetId, onConfirmed }: RenameElementDialogContentProps) => {
  const elements = useCadDocumentStore((state) => state.elements);
  const inputRef = useRef<HTMLInputElement>(null);
  const target = targetId ? elements.find((element) => element.id === targetId) : null;
  const [requestedName, setRequestedName] = useState(() => target?.name ?? "");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      selectTextInputValue(inputRef.current);
    });
  }, []);

  const close = () => useCadUiStore.getState().setRenameElementPromptTargetId(null);
  const abortForStaleTarget = () => {
    useCadUiStore.getState().setCommandErrorMessage(staleTargetError);
    close();
  };
  const confirm = () => {
    const selectedIds = getSelectedElementIds();
    const currentTarget = useCadDocumentStore.getState().elements.find((element) => element.id === targetId);
    if (selectedIds.length !== 1 || selectedIds[0] !== targetId || !currentTarget) {
      abortForStaleTarget();
      return;
    }
    if (!renameElementWithPropagation(targetId, requestedName)) {
      setPromptError(
        useCadUiStore.getState().commandErrorMessage ?? "リネームできませんでした。入力を確認して再試行してください。"
      );
      return;
    }
    close();
    requestAnimationFrame(() => onConfirmed(targetId));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isComposing) return;
    confirm();
  };

  return (
    <div
      className="rename-element-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="rename-element-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="選択要素の名前を変更"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || isImeComposingKeyEvent(event) || isComposing) return;
          event.preventDefault();
          close();
        }}
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>選択要素の名前を変更</h2>
            <p>{target ? elementQualifiedName(target, elements) : "削除された要素"}</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>
        <form className="rename-element-form" onSubmit={submit}>
          <label>
            <span>名前</span>
            <input
              ref={inputRef}
              value={requestedName}
              aria-label="名前"
              onChange={(event) => {
                setRequestedName(event.target.value);
                setPromptError(null);
              }}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
            />
          </label>
          {promptError ? <p className="rename-element-error" role="alert">{promptError}</p> : null}
          <div className="rename-element-actions">
            <button type="button" onClick={close}>キャンセル</button>
            <button type="submit">名前を変更</button>
          </div>
        </form>
      </section>
    </div>
  );
};
