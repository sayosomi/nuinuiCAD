import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const extensionPath = resolve(process.cwd(), "vscode-extension/src/extension.ts");

const outputPreviewHistorySource = async (): Promise<string> => {
  const source = await readFile(extensionPath, "utf8");
  const start = source.indexOf("const executeOutputPreviewHistory = async (");
  const end = source.indexOf("\n  const bakeSettings = (", start);
  if (start < 0 || end < 0) throw new Error("Output Preview history owner not found");
  return source.slice(start, end);
};

describe("Output Preview native history host integration", () => {
  it("anchors history to the active Preview session and its exact live document", async () => {
    const source = await outputPreviewHistorySource();

    expect(source).toContain("activeOutputPreviewSessionForOpenCommand()");
    expect(source).toContain('sessions.get(session.documentUri, "outputPreview") === session');
    expect(source).toContain("isOpenDocument(session.document)");
    expect(source).toContain("visibleEditorFor(session.document)");
    expect(source).toContain("vscode.window.showTextDocument(session.document");
    expect(source).toContain("sameDocument(activatedEditor.document, session.document)");
  });

  it("delegates only native Undo/Redo and returns focus to the still-live Preview", async () => {
    const source = await outputPreviewHistorySource();

    expect(source).toContain("handoffOutputPreviewHistory(direction");
    expect(source).toContain("vscode.commands.executeCommand(nativeDirection)");
    expect(source).toContain("session.panel.reveal(undefined, false)");
    expect(source).not.toContain("canvasHistory");
    expect(source).not.toContain("canvasCommand");
  });
});
