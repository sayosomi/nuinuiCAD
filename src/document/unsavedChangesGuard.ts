import { isTauriRuntime } from "../geometry/evaluationEngine";
import { useCadDocumentStore } from "../state/cadDocumentStore";

export const handleBeforeUnloadWithUnsavedChanges = (event: BeforeUnloadEvent) => {
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
        const { confirm } = await import("@tauri-apps/plugin-dialog");

        return currentWindow.onCloseRequested(async (event) => {
          if (!useCadDocumentStore.getState().dirtySinceSave) return;

          event.preventDefault();

          const shouldDiscard = await confirm("未保存の変更を破棄して閉じますか？", {
            title: "nuinuiCAD",
            kind: "warning",
            okLabel: "破棄して閉じる",
            cancelLabel: "キャンセル"
          });
          if (shouldDiscard) {
            await currentWindow.destroy();
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
