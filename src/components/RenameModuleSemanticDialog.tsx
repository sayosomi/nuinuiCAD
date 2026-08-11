import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { renameModuleSemanticWithPropagation } from "../commands/renameModuleSemanticWithPropagation";
import { createModuleSemanticRangeIndex, moduleSemanticDeclarationRange, type ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { isImeComposingKeyEvent } from "./keyboardEventGuards";
import { selectTextInputValue } from "./textInputSelection";

export type RenameModuleSemanticDialogProps = { onConfirmed: (target: ModuleSemanticTarget) => void };

export const RenameModuleSemanticDialog = ({ onConfirmed }: RenameModuleSemanticDialogProps) => {
  const target = useCadUiStore((state) => state.renameModuleSemanticPromptTarget);
  if (!target) return null;
  return <RenameModuleSemanticDialogContent key={JSON.stringify(target)} target={target} onConfirmed={onConfirmed} />;
};

const RenameModuleSemanticDialogContent = ({ target, onConfirmed }: RenameModuleSemanticDialogProps & { target: ModuleSemanticTarget }) => {
  const sourceText = useCadDocumentStore((state) => state.sourceText);
  const compiled = useCadDocumentStore((state) => state.doc);
  const inputRef = useRef<HTMLInputElement>(null);
  const range = moduleSemanticDeclarationRange(createModuleSemanticRangeIndex(compiled), target);
  const currentName = range ? sourceText.slice(range.from, range.to) : "";
  const [requestedName, setRequestedName] = useState(currentName);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      selectTextInputValue(inputRef.current);
    });
  }, []);

  const close = () => useCadUiStore.getState().setRenameModuleSemanticPromptTarget(null);
  const confirm = () => {
    if (!renameModuleSemanticWithPropagation(target, requestedName)) {
      setPromptError(useCadUiStore.getState().commandErrorMessage ?? "リネームできませんでした。入力を確認して再試行してください。");
      return;
    }
    close();
    requestAnimationFrame(() => onConfirmed(target));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isComposing) confirm();
  };

  return (
    <div className="rename-element-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="rename-element-dialog" role="dialog" aria-modal="true" aria-label="Moduleの名前を変更" onKeyDown={(event) => {
        if (event.key === "Escape" && !isImeComposingKeyEvent(event) && !isComposing) { event.preventDefault(); close(); }
      }}>
        <div className="shortcut-overlay-header">
          <div><h2>Moduleの名前を変更</h2><p>{currentName || "削除されたModule symbol"}</p></div>
          <button type="button" onClick={close}>閉じる</button>
        </div>
        <form className="rename-element-form" onSubmit={submit}>
          <label><span>名前</span><input ref={inputRef} value={requestedName} aria-label="名前" onChange={(event) => { setRequestedName(event.target.value); setPromptError(null); }} onCompositionStart={() => setIsComposing(true)} onCompositionEnd={() => setIsComposing(false)} /></label>
          {promptError ? <p className="rename-element-error" role="alert">{promptError}</p> : null}
          <div className="rename-element-actions"><button type="button" onClick={close}>キャンセル</button><button type="submit">名前を変更</button></div>
        </form>
      </section>
    </div>
  );
};
