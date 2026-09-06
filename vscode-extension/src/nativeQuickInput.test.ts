import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  createQuickPick: vi.fn(),
  createInputBox: vi.fn()
}));

vi.mock("vscode", () => ({
  window: {
    showQuickPick: mocks.showQuickPick,
    showInputBox: mocks.showInputBox,
    createQuickPick: mocks.createQuickPick,
    createInputBox: mocks.createInputBox
  }
}));

import {
  nativeCreateInputBox,
  nativeCreateQuickPick,
  nativeShowInputBox,
  nativeShowQuickPick
} from "./nativeQuickInput";

type TestQuickInput = { ignoreFocusOut: boolean };

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const directNativeQuickInputUse = /vscode\.window\.(?:showQuickPick|showInputBox|createQuickPick|createInputBox)\b/g;

const productionSourceFilesUnder = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return productionSourceFilesUnder(path);
  if (
    !entry.isFile() ||
    !/\.(?:ts|tsx)$/.test(entry.name) ||
    /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) ||
    entry.name === "nativeQuickInput.ts"
  ) return [];
  return [path];
});

beforeEach(() => {
  mocks.showQuickPick.mockReset();
  mocks.showInputBox.mockReset();
  mocks.createQuickPick.mockReset();
  mocks.createInputBox.mockReset();
});

describe("native Quick Input policy", () => {
  it("keeps direct native Quick Input primitives behind the shared owner", () => {
    const violations = productionSourceFilesUnder(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(directNativeQuickInputUse)].map((match) =>
        `${relative(sourceRoot, path)}: ${match[0]}`
      );
    });

    expect(violations).toEqual([]);
  });

  it("forces focus-out persistence while preserving show-style options", async () => {
    const quickPickItems = [{ label: "Pick" }];
    const quickPickOptions = {
      title: "Choose",
      matchOnDescription: true,
      ignoreFocusOut: false
    };
    mocks.showQuickPick.mockResolvedValue(quickPickItems[0]);

    await expect(nativeShowQuickPick(quickPickItems, quickPickOptions)).resolves.toBe(quickPickItems[0]);

    expect(mocks.showQuickPick).toHaveBeenCalledWith(quickPickItems, {
      ...quickPickOptions,
      ignoreFocusOut: true
    });

    const inputOptions = {
      title: "Name",
      prompt: "Name",
      ignoreFocusOut: false
    };
    mocks.showInputBox.mockResolvedValue("Chosen");

    await expect(nativeShowInputBox(inputOptions)).resolves.toBe("Chosen");

    expect(mocks.showInputBox).toHaveBeenCalledWith({
      ...inputOptions,
      ignoreFocusOut: true
    });
  });

  it("configures created Quick Inputs before returning them", () => {
    const quickPick: TestQuickInput = { ignoreFocusOut: false };
    const inputBox: TestQuickInput = { ignoreFocusOut: false };
    mocks.createQuickPick.mockReturnValue(quickPick);
    mocks.createInputBox.mockReturnValue(inputBox);

    const returnedQuickPick = nativeCreateQuickPick<{ label: string }>();
    const returnedInputBox = nativeCreateInputBox();

    expect(returnedQuickPick).toBe(quickPick);
    expect(returnedQuickPick.ignoreFocusOut).toBe(true);
    expect(returnedInputBox).toBe(inputBox);
    expect(returnedInputBox.ignoreFocusOut).toBe(true);
  });
});
