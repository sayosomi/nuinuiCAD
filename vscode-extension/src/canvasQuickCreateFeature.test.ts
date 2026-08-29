import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showQuickPick: vi.fn(),
  openConfiguration: [] as unknown[],
  configuration: [] as unknown[],
  getConfiguration: vi.fn(() => {
    const settingAtCall = mocks.setting;
    return { get: () => settingAtCall };
  }),
  configurationListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  setting: undefined as unknown
}));

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    },
    executeCommand: mocks.executeCommand
  },
  window: { showQuickPick: mocks.showQuickPick },
  workspace: {
    getConfiguration: mocks.getConfiguration,
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => {
      mocks.configurationListeners.push(listener);
      return disposable();
    }
  },
  Disposable: {
    from: (...items: Array<{ dispose: () => void }>) => disposable(() => {
      for (const item of items) item.dispose();
    })
  }
}));

import {
  registerVscodeCanvasQuickCreateFeature,
  VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID,
  VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID,
  VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS
} from "./canvasQuickCreateFeature";
import {
  VSCODE_CANVAS_QUICK_CREATE_SETTING,
  vscodeCanvasCreationCommands,
  vscodeCanvasCreationCommandIdFor
} from "../../src/vscode/vscodeCanvasCreationCommands";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.showQuickPick.mockReset();
  mocks.getConfiguration.mockClear();
  mocks.configurationListeners.length = 0;
  mocks.setting = undefined;
});

describe("registerVscodeCanvasQuickCreateFeature", () => {
  it("projects normalized Quick Create slots and updates them live", async () => {
    mocks.setting = ["addLine", "unknown", "addLine", "addFreePoint"];
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => null });
    await flush();
    expect(mocks.getConfiguration).toHaveBeenCalledTimes(1);

    expect(mocks.executeCommand.mock.calls.filter(([command]) => command === "setContext")).toEqual([
      ["setContext", VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS[0], "addLine"],
      ["setContext", VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS[1], "addFreePoint"],
      ...VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.slice(2).map((key) => ["setContext", key, ""])
    ]);

    mocks.setting = ["addArcLine"];
    const listener = mocks.configurationListeners[0];
    listener?.({ affectsConfiguration: (section) => section === VSCODE_CANVAS_QUICK_CREATE_SETTING });
    await flush();
    expect(mocks.getConfiguration).toHaveBeenCalledTimes(2);
    expect(mocks.executeCommand).toHaveBeenLastCalledWith(
      "setContext",
      VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS[5],
      ""
    );
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS[0],
      "addArcLine"
    );

    feature.dispose();
  });

  it("opens Settings at the exact Quick Create setting", async () => {
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => null });
    await mocks.commands.get(VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID)?.();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      VSCODE_CANVAS_QUICK_CREATE_SETTING
    );
    feature.dispose();
  });

  it("searches native Quick Pick items by English and Japanese keywords and dispatches the selected command", async () => {
    const token = {};
    const postCreationCommand = vi.fn();
    const activeCanvasEndpoint = vi.fn(() => ({ sessionToken: token, isCurrent: () => true, postCreationCommand }));
    mocks.showQuickPick.mockResolvedValue({ commandId: "addArcLine" });
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint });

    await mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    const [items, options] = mocks.showQuickPick.mock.calls[0] ?? [];
    const arcLine = (items as Array<Record<string, unknown>>).find((item) => item.commandId === "addArcLine");
    expect(arcLine).toMatchObject({
      label: "Arc Line",
      description: expect.stringContaining("円弧")
    });
    expect(options).toMatchObject({ matchOnDescription: true });
    expect(postCreationCommand).toHaveBeenCalledWith("addArcLine");
    expect(activeCanvasEndpoint).toHaveBeenCalledTimes(2);

    feature.dispose();
  });

  it("does nothing on cancel or when the Canvas session changes while the picker is open", async () => {
    const firstToken = {};
    const secondToken = {};
    const postCreationCommand = vi.fn();
    let currentToken: object | null = firstToken;
    const activeCanvasEndpoint = vi.fn(() => currentToken
      ? { sessionToken: currentToken, isCurrent: () => true, postCreationCommand }
      : null);
    let resolvePick: ((value: unknown) => void) | undefined;
    mocks.showQuickPick.mockReturnValue(new Promise((resolve) => {
      resolvePick = resolve;
    }));
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint });
    const pending = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    currentToken = secondToken;
    resolvePick?.({ commandId: "addLine" });
    await pending;
    expect(postCreationCommand).not.toHaveBeenCalled();

    mocks.showQuickPick.mockResolvedValue(undefined);
    currentToken = firstToken;
    await mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    expect(postCreationCommand).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("does nothing when the Canvas closes or becomes stale while the picker is open", async () => {
    const token = {};
    const postCreationCommand = vi.fn();
    let currentToken: object | null = token;
    let current = true;
    const activeCanvasEndpoint = () => currentToken
      ? { sessionToken: currentToken, isCurrent: () => current, postCreationCommand }
      : null;
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint });

    let resolvePick: ((value: unknown) => void) | undefined;
    mocks.showQuickPick.mockReturnValueOnce(new Promise((resolve) => {
      resolvePick = resolve;
    }));
    const closedPending = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    currentToken = null;
    resolvePick?.({ commandId: "addLine" });
    await closedPending;

    currentToken = token;
    current = true;
    mocks.showQuickPick.mockReturnValueOnce(new Promise((resolve) => {
      resolvePick = resolve;
    }));
    const stalePending = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    current = false;
    resolvePick?.({ commandId: "addLine" });
    await stalePending;

    expect(postCreationCommand).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("revalidates the active Canvas for direct individual commands", async () => {
    const token = {};
    const postCreationCommand = vi.fn();
    let endpoint: { sessionToken: object; isCurrent: () => boolean; postCreationCommand: typeof postCreationCommand } | null = {
      sessionToken: token,
      isCurrent: () => endpoint !== null,
      postCreationCommand
    };
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => endpoint });
    await mocks.commands.get(vscodeCanvasCreationCommandIdFor("addLine"))?.();
    expect(postCreationCommand).toHaveBeenCalledWith("addLine");

    postCreationCommand.mockClear();
    endpoint = null;
    await mocks.commands.get(vscodeCanvasCreationCommandIdFor("addLine"))?.();
    expect(postCreationCommand).not.toHaveBeenCalled();
    expect(vscodeCanvasCreationCommands).toHaveLength(25);
    feature.dispose();
  });
});
