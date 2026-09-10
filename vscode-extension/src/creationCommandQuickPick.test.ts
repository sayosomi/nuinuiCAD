import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterVscodeCanvasCreationCommands,
  vscodeCanvasCreationCommands,
  type VscodeCanvasCreationCommand
} from "../../src/vscode/vscodeCanvasCreationCommands";

type TestItem = {
  label: string;
  description?: string;
  commandId: string;
  alwaysShow?: boolean;
};

type TestQuickPick = {
  placeholder?: string;
  matchOnDescription?: boolean;
  items: TestItem[];
  selectedItems: TestItem[];
  show: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  fireValue: (value: string) => void;
  fireAccept: () => void;
  fireHide: () => void;
};

const mocks = vi.hoisted(() => ({
  createQuickPick: vi.fn(),
  quickPicks: [] as TestQuickPick[]
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
  const picker = {
    items: [] as TestItem[],
    selectedItems: [] as TestItem[],
    show: vi.fn(),
    dispose: vi.fn(),
    onDidChangeValue: (listener: (value: string) => void) => valueChanged.subscribe(listener),
    onDidAccept: (listener: () => void) => accepted.subscribe(listener),
    onDidHide: (listener: () => void) => hidden.subscribe(listener),
    fireValue: (value: string) => valueChanged.fire(value),
    fireAccept: () => accepted.fire(undefined),
    fireHide: () => hidden.fire(undefined)
  };
  mocks.quickPicks.push(picker);
  return picker;
};

vi.mock("vscode", () => ({
  window: {
    createQuickPick: mocks.createQuickPick
  }
}));

import {
  pickVscodeCreationCommand,
  sortVscodeCreationCommandsForQuickPick
} from "./creationCommandQuickPick";

beforeEach(() => {
  mocks.createQuickPick.mockReset();
  mocks.createQuickPick.mockImplementation(createTestQuickPick);
  mocks.quickPicks.length = 0;
});

describe("pickVscodeCreationCommand", () => {
  it("sorts initial and filtered presentation without changing catalog membership", async () => {
    const englishPending = pickVscodeCreationCommand({
      displayLanguage: "en-US"
    });
    const englishPicker = mocks.quickPicks[0]!;

    expect(englishPicker.items.map(({ label }) => label)).toEqual(
      [...englishPicker.items.map(({ label }) => label)].sort((left, right) => left.localeCompare(right))
    );
    expect([...englishPicker.items.map(({ commandId }) => commandId)].sort()).toEqual(
      [...vscodeCanvasCreationCommands.map(({ commandId }) => commandId)].sort()
    );
    expect(englishPicker.items).toHaveLength(vscodeCanvasCreationCommands.length);
    expect(englishPicker.items.every(({ alwaysShow }) => alwaysShow)).toBe(true);
    expect(englishPicker.placeholder).toBe("Create geometry");
    expect(englishPicker.matchOnDescription).toBe(false);
    expect(englishPicker.items.find(({ commandId }) => commandId === "addBezierCurve")).toMatchObject({
      label: "Bezier Curve",
      description: "Create Bezier Curve"
    });

    englishPicker.fireValue("bezier 曲線");
    const expectedBezierCommands = filterVscodeCanvasCreationCommands("bezier 曲線");
    expect([...englishPicker.items.map(({ commandId }) => commandId)].sort()).toEqual(
      [...expectedBezierCommands.map(({ commandId }) => commandId)].sort()
    );
    expect(englishPicker.items).toHaveLength(expectedBezierCommands.length);
    expect(englishPicker.items.map(({ commandId }) => commandId)).toEqual([
      "addBezierBulgePoint",
      "addBezierCurve",
      "addBezierExtremePoint"
    ]);
    expect(englishPicker.items.map(({ label }) => label)).toEqual([
      "Bezier Bulge Point",
      "Bezier Curve",
      "Bezier Extreme Point"
    ]);
    englishPicker.fireValue("   ");
    expect(englishPicker.items.map(({ label }) => label)).toEqual(
      [...englishPicker.items.map(({ label }) => label)].sort((left, right) => left.localeCompare(right))
    );
    expect([...englishPicker.items.map(({ commandId }) => commandId)].sort()).toEqual(
      [...vscodeCanvasCreationCommands.map(({ commandId }) => commandId)].sort()
    );

    englishPicker.fireHide();
    englishPicker.fireHide();
    englishPicker.fireAccept();
    await expect(englishPending).resolves.toBeUndefined();
    expect(englishPicker.dispose).toHaveBeenCalledTimes(1);

    const japanesePending = pickVscodeCreationCommand({ displayLanguage: "ja-JP" });
    const japanesePicker = mocks.quickPicks[1]!;
    expect(japanesePicker.placeholder).toBe("ジオメトリを作成");
    expect(japanesePicker.items.find(({ commandId }) => commandId === "addBezierCurve")).toMatchObject({
      label: "Bezier Curve",
      description: "ベジェ曲線を作成"
    });
    japanesePicker.selectedItems = [japanesePicker.items.find(({ commandId }) => commandId === "addLine")!];
    japanesePicker.fireAccept();
    await expect(japanesePending).resolves.toBe("addLine");
    expect(japanesePicker.dispose).toHaveBeenCalledTimes(1);
  });

  it("uses command ID as a deterministic fallback for equal labels without mutating entries", () => {
    const entries: VscodeCanvasCreationCommand[] = [
      { commandId: "addText", quickPickLabel: "Same Label", keywords: [] },
      { commandId: "addLine", quickPickLabel: "Same Label", keywords: [] }
    ];

    expect(sortVscodeCreationCommandsForQuickPick(entries).map(({ commandId }) => commandId)).toEqual([
      "addLine",
      "addText"
    ]);
    expect(entries.map(({ commandId }) => commandId)).toEqual(["addText", "addLine"]);
  });

});
