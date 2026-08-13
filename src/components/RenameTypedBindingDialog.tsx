import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { renameTypedBindingWithPropagation } from "../commands/renameTypedBindingWithPropagation";
import type { BindingId } from "../scalars/bindingCatalog";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { selectTextInputValue } from "./textInputSelection";

type RenameTypedBindingDialogProps = {
  onConfirmed: (bindingId: BindingId) => void;
};

const staleTargetError = "リネーム対象の変数が変更または削除されたため、確定を中止しました。もう一度選択してください。";

/**
 * Typed-binding counterpart to RenameElementDialog: same modal shape &&
 * flush -> confirm -> close/onConfirmed flow, but targets a BindingId &&
 * commits through renameTypedBindingWithPropagation (Task 38) instead of
 * renameElementWithPropagation. Kept as its own component rather than a
 * generalized union inside RenameElementDialog, so existing CAD element
 * rename behavior/tests stay untouched.
 */
export const RenameTypedBindingDialog = ({ onConfirmed }: RenameTypedBindingDialogProps) => {
  const targetId = useCadUiStore((state) => state.renameTypedBindingPromptTargetId);

  if (!targetId) return null;

  return <RenameTypedBindingDialogContent key={targetId} targetId={targetId} onConfirmed={onConfirmed} />;
};

type RenameTypedBindingDialogContentProps = RenameTypedBindingDialogProps & {
  targetId: BindingId;
};

const RenameTypedBindingDialogContent = ({ targetId, onConfirmed }: RenameTypedBindingDialogContentProps) => {
  const bindingAnalysis = useCadDocumentStore((state) => state.doc.bindingAnalysis);
  const inputRef = useRef<HTMLInputElement>(null);
  const target = bindingAnalysis?.catalog.bindingsById.get(targetId) ?? null;
  const [requestedName, setRequestedName] = useState(() => target?.name ?? "");
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      selectTextInputValue(inputRef.current);
    });
  }, []);

  const close = () => useCadUiStore.getState().setRenameTypedBindingPromptTargetId(null);
  const abortForStaleTarget = () => {
    useCadUiStore.getState().setCommandErrorMessage(staleTargetError);
    close();
  };
  const confirm = () => {
    const currentBindingAnalysis = useCadDocumentStore.getState().doc.bindingAnalysis;
    if (!currentBindingAnalysis?.catalog.bindingsById.has(targetId)) {
      abortForStaleTarget();
      return;
    }
    if (!renameTypedBindingWithPropagation(targetId, requestedName)) {
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
        aria-label="変数の名前を変更"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || isImeComposingKeyEvent(event) || isComposing) return;
          event.preventDefault();
          close();
        }}
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>変数の名前を変更</h2>
            <p>{target ? target.name : "削除された変数"}</p>
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
