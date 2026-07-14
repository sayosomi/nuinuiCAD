import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createDslCompletionSource } from "./cmAutocomplete";

describe("createDslCompletionSource", () => {
  it("suppresses completion while the existing editor composition guard is active", () => {
    const state = EditorState.create({ doc: "poi" });
    const source = createDslCompletionSource({
      elements: () => [],
      statementRanges: () => new Map(),
      isComposing: () => true
    });
    expect(source({ state, pos: 3, explicit: true } as never)).toBeNull();
  });

  it("returns parser keyword completions after composition has ended", async () => {
    const state = EditorState.create({ doc: "poi" });
    const source = createDslCompletionSource({
      elements: () => [],
      statementRanges: () => new Map(),
      isComposing: () => false
    });
    const result = await Promise.resolve(source({ state, pos: 3, explicit: true } as never));
    expect(result).not.toBeNull();
    expect(result?.options.map((option) => option.label)).toContain("point");
  });
});
