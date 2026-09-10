import { describe, expect, it } from "vitest";
import { vscodeCanvasCreationCommands } from "../../src/vscode/vscodeCanvasCreationCommands";
import { createSourceCreationMru } from "./sourceCreationMru";

describe("Source creation MRU", () => {
  it("starts empty", () => {
    expect(createSourceCreationMru().recentCommandIds).toEqual([]);
  });

  it("keeps up to five distinct command IDs newest first", () => {
    const mru = createSourceCreationMru();
    const commandIds = vscodeCanvasCreationCommands.slice(0, 5).map(({ commandId }) => commandId);

    for (const commandId of commandIds) mru.record(commandId);

    expect(mru.recentCommandIds).toEqual([...commandIds].reverse());
  });

  it("moves a reused command to the front without duplication", () => {
    const mru = createSourceCreationMru();
    const commandIds = vscodeCanvasCreationCommands.slice(0, 3).map(({ commandId }) => commandId);
    commandIds.forEach((commandId) => mru.record(commandId));

    mru.record(commandIds[0]!);

    expect(mru.recentCommandIds).toEqual([commandIds[0], commandIds[2], commandIds[1]]);
    expect(new Set(mru.recentCommandIds).size).toBe(mru.recentCommandIds.length);
  });

  it("evicts only the least-recent command when a sixth distinct command is recorded", () => {
    const mru = createSourceCreationMru();
    const commandIds = vscodeCanvasCreationCommands.slice(0, 6).map(({ commandId }) => commandId);
    commandIds.forEach((commandId) => mru.record(commandId));

    expect(mru.recentCommandIds).toEqual(commandIds.slice(1).reverse());
    expect(mru.recentCommandIds).not.toContain(commandIds[0]);
  });

  it("returns a snapshot that cannot mutate the MRU", () => {
    const mru = createSourceCreationMru();
    mru.record(vscodeCanvasCreationCommands[0]!.commandId);
    const snapshot = mru.recentCommandIds as Array<typeof vscodeCanvasCreationCommands[number]["commandId"]>;
    snapshot.length = 0;

    expect(mru.recentCommandIds).toEqual([vscodeCanvasCreationCommands[0]!.commandId]);
  });
});
