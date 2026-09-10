import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const mocks = vi.hoisted(() => ({
  pickCreationCommand: vi.fn(),
  showQuickPick: vi.fn(),
  insertSnippet: vi.fn()
}));

vi.mock("vscode", () => ({}));
vi.mock("./creationCommandQuickPick", () => ({
  pickVscodeCreationCommand: mocks.pickCreationCommand
}));
vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.showQuickPick
}));
vi.mock("./sourceCreationSnippetAdapter", () => ({
  insertSourceCreationSnippet: mocks.insertSnippet
}));

import { sourceCreationTemplatePlanForLegacyCommand } from "../../src/commands/sourceCreationTemplatePlan";
import { runSourceCreationFlow } from "./sourceCreationFlow";
import { createSourceCreationMru } from "./sourceCreationMru";

type TestEditor = vscode.TextEditor;
type TestPosition = vscode.Position;

const renderedArgumentsFor = (materialization: {
  parts: ReadonlyArray<
    | { kind: "text"; text: string }
    | { kind: "hole"; hole: { role: "name" } | { role: "argument"; argName: string } }
  >;
}): string[] => materialization.parts.flatMap((part) => {
  if (part.kind !== "hole" || part.hole.role !== "argument") return [];
  return [part.hole.argName];
});

beforeEach(() => {
  mocks.pickCreationCommand.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.insertSnippet.mockReset();
  mocks.insertSnippet.mockResolvedValue(true);
});

describe("runSourceCreationFlow", () => {
  it("inserts a one-form addLine at the exact caller-supplied position without opening a form picker", async () => {
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    const editor = { id: "editor" } as unknown as TestEditor;
    const position = { line: 4, character: 7 } as TestPosition;

    await expect(runSourceCreationFlow(editor, position, "en-US", createSourceCreationMru())).resolves.toBe(true);

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertSnippet.mock.calls[0]?.[0]).toBe(editor);
    expect(mocks.insertSnippet.mock.calls[0]?.[2]).toBe(position);
    expect(mocks.insertSnippet.mock.calls[0]?.[1]).toMatchObject({
      commandId: "addLine",
      formIndex: 0
    });
  });

  it("derives division forms from planner metadata and materializes only the selected exclusive argument", async () => {
    mocks.pickCreationCommand.mockResolvedValue("addDivisionPoint");
    mocks.showQuickPick.mockImplementation(async (items: readonly { label: string; formIndex: number }[]) => {
      expect(items.map(({ label }) => label)).toEqual(["距離", "割合"]);
      return items[0];
    });
    const editor = {} as TestEditor;
    const position = {} as TestPosition;

    await runSourceCreationFlow(editor, position, "ja-JP", createSourceCreationMru());

    const distance = mocks.insertSnippet.mock.calls[0]?.[1] as {
      parts: ReadonlyArray<
        | { kind: "text"; text: string }
        | { kind: "hole"; hole: { role: "name" } | { role: "argument"; argName: string } }
      >;
    };
    expect(renderedArgumentsFor(distance)).toContain("distance");
    expect(renderedArgumentsFor(distance)).not.toContain("ratio");

    mocks.showQuickPick.mockImplementationOnce(async (items: readonly { label: string; formIndex: number }[]) => items[1]);
    await runSourceCreationFlow(editor, position, "ja-JP", createSourceCreationMru());
    const ratio = mocks.insertSnippet.mock.calls[1]?.[1] as typeof distance;
    expect(renderedArgumentsFor(ratio)).toContain("ratio");
    expect(renderedArgumentsFor(ratio)).not.toContain("distance");
  });

  it("presents division exclusive forms in English for the default host locale", async () => {
    mocks.pickCreationCommand.mockResolvedValue("addDivisionPoint");
    mocks.showQuickPick.mockImplementation(async (items: readonly { label: string; formIndex: number }[]) => {
      expect(items.map(({ label }) => label)).toEqual(["Distance", "Ratio"]);
      return items[1];
    });

    await runSourceCreationFlow({} as TestEditor, {} as TestPosition, "en-US", createSourceCreationMru());

    const ratio = mocks.insertSnippet.mock.calls[0]?.[1] as {
      parts: ReadonlyArray<
        | { kind: "text"; text: string }
        | { kind: "hole"; hole: { role: "name" } | { role: "argument"; argName: string } }
      >;
    };
    expect(renderedArgumentsFor(ratio)).toContain("ratio");
    expect(renderedArgumentsFor(ratio)).not.toContain("distance");
  });

  it("derives tangentOffset forms from planner metadata and keeps only the selected exclusive argument", async () => {
    mocks.pickCreationCommand.mockResolvedValue("addLineTangentOffsetPoint");
    mocks.showQuickPick.mockImplementation(async (items: readonly { label: string; formIndex: number }[]) => {
      expect(items.map(({ label }) => label)).toEqual(["Angle", "Curve Side"]);
      return items[1];
    });
    const plan = sourceCreationTemplatePlanForLegacyCommand("addLineTangentOffsetPoint");
    expect(plan?.forms).toHaveLength(2);

    await runSourceCreationFlow({} as TestEditor, {} as TestPosition, "en", createSourceCreationMru());

    const materialization = mocks.insertSnippet.mock.calls[0]?.[1] as {
      parts: ReadonlyArray<
        | { kind: "text"; text: string }
        | { kind: "hole"; hole: { role: "name" } | { role: "argument"; argName: string } }
      >;
    };
    expect(renderedArgumentsFor(materialization)).toContain("curveSide");
    expect(renderedArgumentsFor(materialization)).not.toContain("angle");
  });

  it("fails closed on type or form cancellation and retains no flow session state", async () => {
    const editor = {} as TestEditor;
    const position = {} as TestPosition;
    const sourceCreationMru = createSourceCreationMru();

    mocks.pickCreationCommand.mockResolvedValueOnce(undefined);
    await expect(runSourceCreationFlow(editor, position, "en", sourceCreationMru)).resolves.toBeUndefined();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();

    mocks.pickCreationCommand.mockResolvedValueOnce("addDivisionPoint");
    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    await expect(runSourceCreationFlow(editor, position, "en", sourceCreationMru)).resolves.toBeUndefined();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();

    mocks.pickCreationCommand.mockResolvedValueOnce("addDivisionPoint");
    mocks.showQuickPick.mockImplementationOnce(async (items: readonly { formIndex: number }[]) => items[1]);
    await runSourceCreationFlow(editor, position, "en", sourceCreationMru);
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    expect(sourceCreationMru.recentCommandIds).toEqual(["addDivisionPoint"]);
  });

  it("records recency only for an exactly successful insertion", async () => {
    const sourceCreationMru = createSourceCreationMru();
    const editor = {} as TestEditor;
    const position = {} as TestPosition;

    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockResolvedValueOnce(false);
    await expect(runSourceCreationFlow(editor, position, "en", sourceCreationMru)).resolves.toBe(false);
    expect(sourceCreationMru.recentCommandIds).toEqual([]);

    mocks.insertSnippet.mockResolvedValueOnce(undefined);
    await expect(runSourceCreationFlow(editor, position, "en", sourceCreationMru)).resolves.toBeUndefined();
    expect(sourceCreationMru.recentCommandIds).toEqual([]);

    mocks.insertSnippet.mockRejectedValueOnce(new Error("insertion failed"));
    await expect(runSourceCreationFlow(editor, position, "en", sourceCreationMru)).rejects.toThrow(
      "insertion failed"
    );
    expect(sourceCreationMru.recentCommandIds).toEqual([]);

    mocks.insertSnippet.mockResolvedValueOnce(true);
    await expect(runSourceCreationFlow(editor, position, "en", sourceCreationMru)).resolves.toBe(true);
    expect(sourceCreationMru.recentCommandIds).toEqual(["addLine"]);
  });

  it("does not record when type planning fails", async () => {
    const sourceCreationMru = createSourceCreationMru();
    mocks.pickCreationCommand.mockResolvedValue("unknownCommand");

    await expect(runSourceCreationFlow({} as TestEditor, {} as TestPosition, "en", sourceCreationMru))
      .resolves.toBeUndefined();

    expect(sourceCreationMru.recentCommandIds).toEqual([]);
  });
});
