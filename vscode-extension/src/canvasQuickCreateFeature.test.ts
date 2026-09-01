import { beforeEach, describe, expect, it, vi } from "vitest";

type TestItem = {
  label: string;
  description?: string;
  commandId: string;
  alwaysShow?: boolean;
  buttons?: Array<{ tooltip?: string }>;
};

type TestQuickPick = {
  items: TestItem[];
  selectedItems: TestItem[];
  buttons: Array<{ tooltip?: string }>;
  show: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  fireValue: (value: string) => void;
  fireAccept: () => void;
  fireHide: () => void;
  fireTriggerButton: (button: { tooltip?: string }) => void;
  fireTriggerItemButton: (item: TestItem, button: { tooltip?: string }) => void;
};

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showQuickPick: vi.fn(),
  createQuickPick: vi.fn(),
  configurationUpdates: [] as Array<{ section: string; value: unknown; target: unknown }>,
  getConfiguration: vi.fn(() => ({
    get: () => mocks.setting,
    update: (section: string, value: unknown, target: unknown) => {
      mocks.configurationUpdates.push({ section, value, target });
      mocks.setting = value;
      return Promise.resolve();
    }
  })),
  configurationListeners: [] as Array<(event: { affectsConfiguration: (section: string) => boolean }) => void>,
  quickPicks: [] as TestQuickPick[],
  setting: undefined as unknown
}));

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

const eventSource = <T>() => {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (listener: (value: T) => void) => {
      listeners.add(listener);
      return disposable(() => listeners.delete(listener));
    },
    fire: (value: T) => {
      for (const listener of listeners) listener(value);
    }
  };
};

const createTestQuickPick = (): TestQuickPick => {
  const valueChanged = eventSource<string>();
  const accepted = eventSource<void>();
  const hidden = eventSource<void>();
  const triggeredButton = eventSource<{ tooltip?: string }>();
  const triggeredItemButton = eventSource<{ item: TestItem; button: { tooltip?: string } }>();
  const picker = {
    items: [] as TestItem[],
    selectedItems: [] as TestItem[],
    buttons: [] as Array<{ tooltip?: string }>,
    show: vi.fn(),
    dispose: vi.fn(),
    onDidChangeValue: (listener: (value: string) => void) => valueChanged.subscribe(listener),
    onDidAccept: (listener: () => void) => accepted.subscribe(listener),
    onDidHide: (listener: () => void) => hidden.subscribe(listener),
    onDidTriggerButton: (listener: (button: { tooltip?: string }) => void) => triggeredButton.subscribe(listener),
    onDidTriggerItemButton: (listener: (event: { item: TestItem; button: { tooltip?: string } }) => void) =>
      triggeredItemButton.subscribe(listener),
    fireValue: (value: string) => valueChanged.fire(value),
    fireAccept: () => accepted.fire(undefined),
    fireHide: () => hidden.fire(undefined),
    fireTriggerButton: (button: { tooltip?: string }) => triggeredButton.fire(button),
    fireTriggerItemButton: (item: TestItem, button: { tooltip?: string }) =>
      triggeredItemButton.fire({ item, button })
  };
  mocks.quickPicks.push(picker);
  return picker;
};

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    },
    executeCommand: mocks.executeCommand
  },
  window: {
    createQuickPick: mocks.createQuickPick,
    showQuickPick: mocks.showQuickPick
  },
  workspace: {
    getConfiguration: mocks.getConfiguration,
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration: (section: string) => boolean }) => void) => {
      mocks.configurationListeners.push(listener);
      return disposable();
    }
  },
  ConfigurationTarget: { Global: 1 },
  ThemeIcon: class ThemeIcon {
    constructor(readonly id: string) {}
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
  VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS,
  vscodeCanvasQuickCreateCommandContextKeyFor
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
  await Promise.resolve();
};

const setContexts = () => mocks.executeCommand.mock.calls
  .filter(([command]) => command === "setContext")
  .map(([, key, value]) => [key, value]);

const itemWithCommand = (picker: TestQuickPick, commandId: string): TestItem => {
  const item = picker.items.find((candidate) => candidate.commandId === commandId);
  if (!item) throw new Error(`Missing test item ${commandId}`);
  return item;
};

const buttonWithTooltip = (item: TestItem, tooltip: string): { tooltip?: string } => {
  const button = item.buttons?.find((candidate) => candidate.tooltip === tooltip);
  if (!button) throw new Error(`Missing ${tooltip} button on ${item.commandId}`);
  return button;
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.showQuickPick.mockReset();
  mocks.createQuickPick.mockReset();
  mocks.createQuickPick.mockImplementation(createTestQuickPick);
  mocks.configurationUpdates.length = 0;
  mocks.getConfiguration.mockClear();
  mocks.configurationListeners.length = 0;
  mocks.quickPicks.length = 0;
  mocks.setting = undefined;
});

describe("registerVscodeCanvasQuickCreateFeature", () => {
  it("projects normalized Quick Create slots and configured membership live", async () => {
    mocks.setting = ["addLine", "unknown", "addLine", "addFreePoint"];
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => null });
    await flush();

    expect(mocks.getConfiguration).toHaveBeenCalledTimes(1);
    expect(setContexts().slice(0, VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.length)).toEqual([
      [VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS[0], "addLine"],
      [VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS[1], "addFreePoint"],
      ...VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.slice(2).map((key) => [key, ""])
    ]);
    expect(setContexts().slice(VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.length)).toContainEqual([
      vscodeCanvasQuickCreateCommandContextKeyFor("addLine"),
      true
    ]);
    expect(setContexts().slice(VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.length)).toContainEqual([
      vscodeCanvasQuickCreateCommandContextKeyFor("addFreePoint"),
      true
    ]);
    expect(setContexts().slice(VSCODE_CANVAS_QUICK_CREATE_SLOT_CONTEXT_KEYS.length)).toContainEqual([
      vscodeCanvasQuickCreateCommandContextKeyFor("addArcLine"),
      false
    ]);

    mocks.setting = ["addArcLine"];
    const listener = mocks.configurationListeners[0];
    listener?.({ affectsConfiguration: (section) => section === VSCODE_CANVAS_QUICK_CREATE_SETTING });
    await flush();
    expect(setContexts()).toContainEqual([
      vscodeCanvasQuickCreateCommandContextKeyFor("addArcLine"),
      true
    ]);
    expect(setContexts()).toContainEqual([
      vscodeCanvasQuickCreateCommandContextKeyFor("addLine"),
      false
    ]);
    feature.dispose();
  });

  it("uses the persisted setting through the native Quick Pick manager", async () => {
    mocks.setting = ["addLine", "addArcLine"];
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => null });
    const command = mocks.commands.get(VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID);
    const pending = command?.();
    const picker = mocks.quickPicks[0]!;

    expect(picker.items.map(({ commandId }) => commandId)).toEqual(["addLine", "addArcLine"]);
    expect(picker.items[0]?.buttons?.map(({ tooltip }) => tooltip)).toEqual(["Move Down", "Remove"]);
    expect(picker.items[1]?.buttons?.map(({ tooltip }) => tooltip)).toEqual(["Move Up", "Remove"]);

    mocks.showQuickPick.mockResolvedValue({ commandId: "addBezierCurve" });
    picker.fireTriggerButton(picker.buttons[0]!);
    await flush();
    expect(mocks.configurationUpdates.at(-1)).toEqual({
      section: VSCODE_CANVAS_QUICK_CREATE_SETTING,
      value: ["addLine", "addArcLine", "addBezierCurve"],
      target: 1
    });
    expect(picker.items.map(({ commandId }) => commandId)).toEqual([
      "addLine", "addArcLine", "addBezierCurve"
    ]);
    picker.fireTriggerItemButton(
      itemWithCommand(picker, "addBezierCurve"),
      buttonWithTooltip(itemWithCommand(picker, "addBezierCurve"), "Move Up")
    );
    await flush();
    expect(mocks.setting).toEqual(["addLine", "addBezierCurve", "addArcLine"]);

    picker.fireTriggerItemButton(
      itemWithCommand(picker, "addLine"),
      buttonWithTooltip(itemWithCommand(picker, "addLine"), "Remove")
    );
    await flush();
    expect(mocks.setting).toEqual(["addBezierCurve", "addArcLine"]);

    picker.fireTriggerItemButton(
      itemWithCommand(picker, "addBezierCurve"),
      buttonWithTooltip(itemWithCommand(picker, "addBezierCurve"), "Move Down")
    );
    await flush();
    expect(mocks.setting).toEqual(["addArcLine", "addBezierCurve"]);

    picker.fireHide();
    await pending;
    expect(picker.dispose).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("opens Add candidates in the existing alphabetical order and supports full catalog capacity", async () => {
    mocks.setting = ["addLine", "unknown", "addLine"];
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => null });
    const pending = mocks.commands.get(VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID)?.();
    const picker = mocks.quickPicks[0]!;
    mocks.showQuickPick.mockResolvedValue({ commandId: "addAngleLengthLine" });
    picker.fireTriggerButton(picker.buttons[0]!);
    await flush();
    const addItems = mocks.showQuickPick.mock.calls[0]?.[0] as TestItem[];
    expect(addItems.map(({ commandId }) => commandId)).toEqual(
      vscodeCanvasCreationCommands.map(({ commandId }) => commandId).sort()
        .filter((commandId) => commandId !== "addLine")
    );
    expect(mocks.setting).toEqual(["addLine", "addAngleLengthLine"]);

    mocks.setting = vscodeCanvasCreationCommands.map(({ commandId }) => commandId);
    picker.fireTriggerButton(picker.buttons[0]!);
    await flush();
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(picker.items).toHaveLength(vscodeCanvasCreationCommands.length);
    picker.fireHide();
    await pending;
    feature.dispose();
  });

  it("normalizes unknown and duplicate persisted values before mutations and leaves cancellation unchanged", async () => {
    mocks.setting = ["addLine", "unknown", "addLine", "addArcLine"];
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint: () => null });
    const pending = mocks.commands.get(VSCODE_CANVAS_CONFIGURE_QUICK_CREATE_COMMAND_ID)?.();
    const picker = mocks.quickPicks[0]!;
    expect(picker.items.map(({ commandId }) => commandId)).toEqual(["addLine", "addArcLine"]);
    picker.fireTriggerItemButton(
      itemWithCommand(picker, "addArcLine"),
      buttonWithTooltip(itemWithCommand(picker, "addArcLine"), "Remove")
    );
    await flush();
    expect(mocks.setting).toEqual(["addLine"]);
    const updatesBeforeCancelledAdd = mocks.configurationUpdates.length;
    mocks.showQuickPick.mockResolvedValue(undefined);
    picker.fireTriggerButton(picker.buttons[0]!);
    await flush();
    expect(mocks.configurationUpdates).toHaveLength(updatesBeforeCancelledAdd);
    picker.fireHide();
    await pending;
    feature.dispose();
  });

  it("filters actual native Quick Pick value changes and dispatches the selected result", async () => {
    const token = {};
    const postCreationCommand = vi.fn();
    const activeCanvasEndpoint = vi.fn(() => ({
      sessionToken: token,
      isCurrent: () => true,
      postCreationCommand
    }));
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint });
    const pending = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    const picker = mocks.quickPicks[0]!;

    expect(picker.items).toHaveLength(vscodeCanvasCreationCommands.length);
    expect(picker.items.every(({ alwaysShow }) => alwaysShow)).toBe(true);
    picker.fireValue("ベジェ");
    expect(picker.items.map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint", "addBezierExtremePoint", "addBezierCurve"
    ]);
    picker.fireValue("curve");
    expect(picker.items.map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint", "addBezierExtremePoint", "addBezierCurve",
      "addOffsetLine", "addCopyLine", "addMove"
    ]);
    picker.fireValue("bezier 曲線");
    expect(picker.items.map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint", "addBezierExtremePoint", "addBezierCurve"
    ]);
    picker.fireValue("   ");
    expect(picker.items).toHaveLength(vscodeCanvasCreationCommands.length);

    picker.fireValue("ベジェ");
    picker.selectedItems = [itemWithCommand(picker, "addBezierCurve")];
    picker.fireAccept();
    await pending;
    expect(postCreationCommand).toHaveBeenCalledWith("addBezierCurve");
    expect(picker.dispose).toHaveBeenCalledTimes(1);
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
    const feature = registerVscodeCanvasQuickCreateFeature({ activeCanvasEndpoint });

    const cancelled = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    mocks.quickPicks[0]!.fireHide();
    await cancelled;

    const changed = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    currentToken = secondToken;
    const picker = mocks.quickPicks[1]!;
    picker.selectedItems = [itemWithCommand(picker, "addLine")];
    picker.fireAccept();
    await changed;

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

    const closed = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    currentToken = null;
    const closedPicker = mocks.quickPicks[0]!;
    closedPicker.selectedItems = [itemWithCommand(closedPicker, "addLine")];
    closedPicker.fireAccept();
    await closed;

    currentToken = token;
    current = true;
    const stale = mocks.commands.get(VSCODE_CANVAS_CREATE_GEOMETRY_COMMAND_ID)?.();
    current = false;
    const stalePicker = mocks.quickPicks[1]!;
    stalePicker.selectedItems = [itemWithCommand(stalePicker, "addLine")];
    stalePicker.fireAccept();
    await stale;

    expect(postCreationCommand).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("revalidates the active Canvas for direct individual commands", async () => {
    const token = {};
    const postCreationCommand = vi.fn();
    let endpoint: {
      sessionToken: object;
      isCurrent: () => boolean;
      postCreationCommand: typeof postCreationCommand;
    } | null = {
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
