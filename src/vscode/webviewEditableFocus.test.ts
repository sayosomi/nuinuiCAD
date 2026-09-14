import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VscodeWebviewApi } from "./protocol";
import { bindVscodeWebviewEditableFocus } from "./webviewEditableFocus";

const flushFocusPublication = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const messagesFor = (api: VscodeWebviewApi): Array<{ type: string; focused: boolean }> =>
  vi.mocked(api.postMessage).mock.calls.map(([message]) => message)
    .filter((message): message is { type: "webviewEditableFocus"; focused: boolean } =>
      message.type === "webviewEditableFocus"
    );

describe("VS Code Webview editable-focus projection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("publishes the initial state and recognizes every editable focus element", async () => {
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const input = document.body.appendChild(document.createElement("input"));
    const textarea = document.body.appendChild(document.createElement("textarea"));
    const select = document.body.appendChild(document.createElement("select"));
    const contenteditable = document.body.appendChild(document.createElement("div"));
    contenteditable.setAttribute("contenteditable", "true");
    const stop = bindVscodeWebviewEditableFocus(api, document);

    expect(messagesFor(api)).toEqual([{ type: "webviewEditableFocus", focused: false }]);
    for (const editable of [input, textarea, select, contenteditable]) {
      editable.focus();
      await flushFocusPublication();
      expect(messagesFor(api).at(-1)).toEqual({ type: "webviewEditableFocus", focused: true });
    }
    stop();
  });

  it("clears focus for non-editable content and settles editable-to-editable transitions as focused", async () => {
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const first = document.body.appendChild(document.createElement("input"));
    const second = document.body.appendChild(document.createElement("textarea"));
    const nonEditable = document.body.appendChild(document.createElement("div"));
    nonEditable.tabIndex = 0;
    const stop = bindVscodeWebviewEditableFocus(api, document);

    first.focus();
    await flushFocusPublication();
    const messageCountBeforeTransition = messagesFor(api).length;
    second.focus();
    await flushFocusPublication();
    expect(messagesFor(api).slice(messageCountBeforeTransition)).toEqual([]);
    second.blur();
    await flushFocusPublication();
    expect(messagesFor(api).at(-1)).toEqual({ type: "webviewEditableFocus", focused: false });
    const messageCountBeforeNonEditable = messagesFor(api).length;
    nonEditable.focus();
    await flushFocusPublication();
    expect(messagesFor(api).length).toBe(messageCountBeforeNonEditable);
    stop();
  });

  it("publishes the current state again after Webview reinitialization", async () => {
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const input = document.body.appendChild(document.createElement("input"));
    const firstStop = bindVscodeWebviewEditableFocus(api, document);
    firstStop();

    input.focus();
    const secondStop = bindVscodeWebviewEditableFocus(api, document);
    expect(messagesFor(api).at(-1)).toEqual({ type: "webviewEditableFocus", focused: true });
    secondStop();
  });
});
