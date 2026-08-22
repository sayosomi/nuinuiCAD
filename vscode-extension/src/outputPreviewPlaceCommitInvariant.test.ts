import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const extensionPath = resolve(process.cwd(), "vscode-extension/src/extension.ts");

const outputPreviewPlaceCommitSource = async (): Promise<string> => {
  const source = await readFile(extensionPath, "utf8");
  const start = source.indexOf("const applyOutputPreviewPlaceCommit = async (");
  const end = source.indexOf("\n  const createOutputPreviewPanel = (", start);
  if (start < 0 || end < 0) throw new Error("Output Preview place commit owner not found");
  return source.slice(start, end);
};

describe("Output Preview place native Undo boundary", () => {
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
});
