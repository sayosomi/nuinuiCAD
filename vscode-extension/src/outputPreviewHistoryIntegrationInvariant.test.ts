import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const featurePath = resolve(process.cwd(), "vscode-extension/src/outputPreviewFeature.ts");

const outputPreviewHistorySource = async (): Promise<string> => {
  return readFile(featurePath, "utf8");
};

describe("Output Preview native history host integration", () => {
  it("anchors history to the active Preview session and its exact live document", async () => {
    const source = await outputPreviewHistorySource();

    expect(source).toContain("const executeHistory = async");
    expect(source).toContain("activeSessionForOpenCommand()");
    expect(source).toContain("host.registry.get(session.documentUri) === session");
    expect(source).toContain("host.isOpenDocument(session.document)");
    expect(source).toContain("host.visibleEditorFor(session.document)");
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
