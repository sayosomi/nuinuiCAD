import { isTauriRuntime } from "../geometry/evaluationEngine";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { confirmDiscardUnsavedChanges } from "./documentFile";

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
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested((event) => {
          if (!confirmDiscardUnsavedChanges("閉じ")) {
            event.preventDefault();
          }
        })
      )
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
