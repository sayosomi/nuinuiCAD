import type { VscodeWebviewApi } from "./protocol";

export const isEditableFocusTarget = (target: Element | null): boolean => {
  if (!target) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;

  const contentEditableHost = target.closest("[contenteditable]");
  if (contentEditableHost) return contentEditableHost.getAttribute("contenteditable") !== "false";
  return (target as HTMLElement).isContentEditable === true;
};

export const bindVscodeWebviewEditableFocus = (
  api: VscodeWebviewApi,
  ownerDocument: Document = globalThis.document
): (() => void) => {
  let publishedFocus: boolean | null = null;
  let scheduled = false;

  const publishCurrentFocus = (): void => {
    scheduled = false;
    const focused = isEditableFocusTarget(ownerDocument.activeElement);
    if (publishedFocus === focused) return;
    publishedFocus = focused;
    api.postMessage({ type: "webviewEditableFocus", focused });
  };

  const scheduleFocusPublication = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(publishCurrentFocus);
  };

  ownerDocument.addEventListener("focusin", scheduleFocusPublication);
  ownerDocument.addEventListener("focusout", scheduleFocusPublication);
  publishCurrentFocus();

  return () => {
    ownerDocument.removeEventListener("focusin", scheduleFocusPublication);
    ownerDocument.removeEventListener("focusout", scheduleFocusPublication);
  };
};
