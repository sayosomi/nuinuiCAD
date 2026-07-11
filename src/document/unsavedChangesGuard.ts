import { message } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { sourceEditSession } from "../editor/sourceEditSession";
import { saveDocument } from "./documentFile";

const CLOSE_DIALOG_SAVE = "保存して閉じる";
const CLOSE_DIALOG_DISCARD = "保存しないで閉じる";
const CLOSE_DIALOG_CANCEL = "キャンセル";

const shouldSaveAndClose = (choice: string) => choice === CLOSE_DIALOG_SAVE || choice === "Yes";
const shouldDiscardAndClose = (choice: string) => choice === CLOSE_DIALOG_DISCARD || choice === "No";

export const handleBeforeUnloadWithUnsavedChanges = (event: BeforeUnloadEvent) => {
  if (sourceEditSession.flush("unsaved-guard") === "blocked-composition") {
    event.preventDefault();
    event.returnValue = "";
    return "";
  }
  if (!useCadDocumentStore.getState().dirtySinceSave) return;

  event.preventDefault();
  event.returnValue = "";
  return "";
};

export const registerUnsavedChangesGuard = () => {
  window.addEventListener("beforeunload", handleBeforeUnloadWithUnsavedChanges);

  let disposed = false;
  let unlistenCloseRequested: (() => void) | null = null;

  if (isTauriRuntime()) {
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const currentWindow = getCurrentWindow();

        return currentWindow.onCloseRequested(async (event) => {
          if (sourceEditSession.flush("unsaved-guard") === "blocked-composition") {
            event.preventDefault();
            useCadUiStore.getState().setCommandErrorMessage(
              "日本語入力の確定中は閉じられません。入力を確定してから再操作してください。"
            );
            return;
          }
          if (!useCadDocumentStore.getState().dirtySinceSave) return;

          event.preventDefault();

          const closeChoice = await message("未保存の変更があります。閉じる前に保存しますか？", {
            title: "nuinuiCAD",
            kind: "warning",
            buttons: {
              yes: CLOSE_DIALOG_SAVE,
              no: CLOSE_DIALOG_DISCARD,
              cancel: CLOSE_DIALOG_CANCEL
            }
          });

          if (shouldDiscardAndClose(closeChoice)) {
            await currentWindow.destroy();
          }

          if (shouldSaveAndClose(closeChoice)) {
            try {
              await saveDocument();
            } catch (error: unknown) {
              console.error("Failed to save document before closing.", error);
              return;
            }
            if (!useCadDocumentStore.getState().dirtySinceSave) {
              await currentWindow.destroy();
            }
          }
        })
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenCloseRequested = unlisten;
      })
      .catch((error: unknown) => {
        console.error("Failed to register window close guard.", error);
      });
  }

  return () => {
    disposed = true;
    window.removeEventListener("beforeunload", handleBeforeUnloadWithUnsavedChanges);
    unlistenCloseRequested?.();
  };
};
