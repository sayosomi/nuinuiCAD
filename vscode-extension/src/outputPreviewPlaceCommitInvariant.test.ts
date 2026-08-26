import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const extensionPath = resolve(process.cwd(), "vscode-extension/src/extension.ts");
const featurePath = resolve(process.cwd(), "vscode-extension/src/outputPreviewSourceInteractionFeature.ts");

const outputPreviewPlaceCommitSource = (): Promise<string> => readFile(featurePath, "utf8");

describe("Output Preview place native Undo boundary", () => {
  it("keeps Source navigation exact-current and fail-closed", async () => {
    const source = await outputPreviewPlaceCommitSource();

    expect(source).toContain("!session.panel.active");
    expect(source).toContain("session.document.version !== message.documentVersion");
    expect(source).toContain("isNormalizedRangeSafe");
    expect(source).toContain("vscode.window.showTextDocument(session.document");
    expect(source).toContain('vscode.commands.executeCommand("editor.unfold")');
    expect(source).toContain("editor.revealRange(range");
  });

  it("keeps one drag commit in one WorkspaceEdit transaction", async () => {
    const source = await outputPreviewPlaceCommitSource();

    expect(source.match(/new vscode\.WorkspaceEdit\(\)/g)).toHaveLength(1);
    expect(source.match(/vscode\.workspace\.applyEdit\(edit\)/g)).toHaveLength(1);
    expect(source).toContain("for (const patch of message.patches)");
    expect(source).toContain("edit.replace(");
    expect(source).not.toContain("editor.edit(");
  });

  it("keeps stale or unsafe commits on the resync path before applying edits", async () => {
    const source = await outputPreviewPlaceCommitSource();
    const applyOffset = source.indexOf("vscode.workspace.applyEdit(edit)");

    expect(source.indexOf("session.document.version !== message.documentVersion")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("normalizedSource !== message.normalizedSourceSnapshot")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("outputPreviewPlaceCoordinatePatchesAreSafe")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("resyncOutputPreview(session)")).toBeGreaterThanOrEqual(0);
    expect(applyOffset).toBeGreaterThan(source.indexOf("outputPreviewPlaceCoordinatePatchesAreSafe"));
  });

  it("delegates the production root message paths to the feature owner", async () => {
    const source = await readFile(extensionPath, "utf8");

    expect(source).toContain("createOutputPreviewSourceInteractionFeature");
    expect(source).toContain("outputPreviewSourceInteraction.handleSourceNavigation(session, message)");
    expect(source).toContain("outputPreviewSourceInteraction.applyPlaceCommit(session, message)");
    expect(source).not.toContain("const applyOutputPreviewPlaceCommit = async");
    expect(source).not.toContain("const handleOutputPreviewSourceNavigation = async");
  });
});
