export const NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT = "nuinuiCAD.webviewEditableFocus";

type WebviewDisposable = { dispose: () => void };

export type WebviewEditableFocusWebview = {
  onDidReceiveMessage: (listener: (message: unknown) => unknown) => WebviewDisposable;
};

export type WebviewEditableFocusAttachment = WebviewDisposable & {
  setHostFocused: (focused: boolean) => void;
};

export type WebviewEditableFocusContext = WebviewDisposable & {
  attach: (webview: WebviewEditableFocusWebview) => WebviewEditableFocusAttachment;
};

type FocusSlot = {
  browserFocused: boolean;
  hostFocused: boolean;
  disposed: boolean;
};

const isWebviewEditableFocusMessage = (
  message: unknown
): message is { type: "webviewEditableFocus"; focused: boolean } =>
  typeof message === "object" && message !== null &&
  (message as { type?: unknown }).type === "webviewEditableFocus" &&
  typeof (message as { focused?: unknown }).focused === "boolean";

export const createWebviewEditableFocusContext = (
  executeSetContext: (key: string, value: boolean) => unknown
): WebviewEditableFocusContext => {
  const slots = new Set<FocusSlot>();
  let aggregateFocused = false;
  let publishedFocused: boolean | null = null;
  let contextUpdate: Promise<void> = Promise.resolve();
  let contextDisposed = false;
  const slotDisposers = new Map<FocusSlot, () => void>();

  const queueContextUpdate = (focused: boolean): void => {
    if (publishedFocused === focused) return;
    publishedFocused = focused;
    contextUpdate = contextUpdate
      .catch(() => undefined)
      .then(() => executeSetContext(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, focused))
      .then(() => undefined)
      .catch(() => undefined);
  };

  const recomputeAggregate = (): void => {
    const nextAggregate = [...slots].some((slot) => slot.browserFocused || slot.hostFocused);
    if (nextAggregate === aggregateFocused) return;
    aggregateFocused = nextAggregate;
    queueContextUpdate(nextAggregate);
  };

  const updateSlot = (
    slot: FocusSlot,
    source: "browser" | "host",
    focused: boolean
  ): void => {
    if (slot.disposed) return;
    if (source === "browser") {
      if (slot.browserFocused === focused) return;
      slot.browserFocused = focused;
    } else {
      if (slot.hostFocused === focused) return;
      slot.hostFocused = focused;
    }
    recomputeAggregate();
  };

  queueContextUpdate(false);

  const attach = (webview: WebviewEditableFocusWebview): WebviewEditableFocusAttachment => {
    if (contextDisposed) {
      return {
        setHostFocused: () => undefined,
        dispose: () => undefined
      };
    }
    const slot: FocusSlot = {
      browserFocused: false,
      hostFocused: false,
      disposed: false
    };
    slots.add(slot);
    const messageDisposable = webview.onDidReceiveMessage((message) => {
      if (isWebviewEditableFocusMessage(message)) updateSlot(slot, "browser", message.focused);
    });
    const disposeSlot = (): void => {
      if (slot.disposed) return;
      slot.disposed = true;
      messageDisposable.dispose();
      slots.delete(slot);
      slotDisposers.delete(slot);
      recomputeAggregate();
    };
    slotDisposers.set(slot, disposeSlot);

    return {
      setHostFocused: (focused) => updateSlot(slot, "host", focused),
      dispose: disposeSlot
    };
  };

  return {
    attach,
    dispose: () => {
      if (contextDisposed) return;
      contextDisposed = true;
      for (const disposeSlot of [...slotDisposers.values()]) disposeSlot();
      queueContextUpdate(false);
    }
  };
};
