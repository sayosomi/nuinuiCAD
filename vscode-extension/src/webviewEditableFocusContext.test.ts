import { describe, expect, it, vi } from "vitest";
import {
  createWebviewEditableFocusContext,
  NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT
} from "./webviewEditableFocusContext";

type TestWebview = {
  receive: (message: unknown) => void;
  webview: {
    onDidReceiveMessage: (listener: (message: unknown) => unknown) => { dispose: () => void };
  };
};

const createWebview = (): TestWebview => {
  const listeners: Array<(message: unknown) => unknown> = [];
  return {
    receive: (message) => {
      for (const listener of [...listeners]) listener(message);
    },
    webview: {
      onDidReceiveMessage: (listener) => {
        listeners.push(listener);
        return {
          dispose: () => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          }
        };
      }
    }
  };
};

const flushContext = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe("VS Code Webview editable-focus context owner", () => {
  it("aggregates independent attachments, ignores duplicates and malformed messages, and clears disposed state", async () => {
    const executeSetContext = vi.fn(async () => undefined);
    const owner = createWebviewEditableFocusContext(executeSetContext);
    const first = createWebview();
    const second = createWebview();
    const firstAttachment = owner.attach(first.webview);
    const secondAttachment = owner.attach(second.webview);
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, false);

    first.receive({ type: "webviewEditableFocus", focused: true });
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, true);
    const trueReportCount = executeSetContext.mock.calls.length;
    first.receive({ type: "webviewEditableFocus", focused: true });
    second.receive({ type: "webviewEditableFocus", focused: "true" });
    second.receive({ type: "otherMessage", focused: true });
    await flushContext();
    expect(executeSetContext.mock.calls.length).toBe(trueReportCount);

    second.receive({ type: "webviewEditableFocus", focused: true });
    first.receive({ type: "webviewEditableFocus", focused: false });
    await flushContext();
    expect(executeSetContext.mock.calls.length).toBe(trueReportCount);
    second.receive({ type: "webviewEditableFocus", focused: false });
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, false);

    first.receive({ type: "webviewEditableFocus", focused: true });
    await flushContext();
    firstAttachment.dispose();
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, false);
    first.receive({ type: "webviewEditableFocus", focused: true });
    firstAttachment.setHostFocused(true);
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, false);

    secondAttachment.dispose();
    const callsBeforeOwnerDispose = executeSetContext.mock.calls.length;
    owner.dispose();
    first.receive({ type: "webviewEditableFocus", focused: true });
    second.receive({ type: "webviewEditableFocus", focused: true });
    await flushContext();
    expect(executeSetContext.mock.calls.length).toBe(callsBeforeOwnerDispose);
  });

  it("bridges host-owned focus without allowing a browser duplicate to clear it prematurely", async () => {
    const executeSetContext = vi.fn(async () => undefined);
    const owner = createWebviewEditableFocusContext(executeSetContext);
    const webview = createWebview();
    const attachment = owner.attach(webview.webview);
    await flushContext();

    attachment.setHostFocused(true);
    await flushContext();
    webview.receive({ type: "webviewEditableFocus", focused: false });
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, true);
    attachment.setHostFocused(false);
    await flushContext();
    expect(executeSetContext).toHaveBeenLastCalledWith(NUI_WEBVIEW_EDITABLE_FOCUS_CONTEXT, false);
    attachment.dispose();
    owner.dispose();
  });
});
