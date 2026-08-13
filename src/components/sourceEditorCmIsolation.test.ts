import { describe, expect, it } from "vitest";
import searchPanelSource from "./SourceSearchPanel.tsx?raw";
import contextMenuSource from "./SourceEditorContextMenu.tsx?raw";

/**
 * SourceSearchPanel && SourceEditorContextMenu are plain React components that talk
 * to CodeMirror only through the controller's plain-typed handle/options — CM stays
 * confined to src/editor/ && SourceEditorPane.tsx.
 */
describe("CM import isolation for Phase 2d components", () => {
  it("SourceSearchPanel.tsx does not import @codemirror", () => {
    expect(searchPanelSource).not.toMatch(/from\s+["']@codemirror/);
  });

  it("SourceEditorContextMenu.tsx does not import @codemirror", () => {
    expect(contextMenuSource).not.toMatch(/from\s+["']@codemirror/);
  });
});
