import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FileSystemError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    FileSystemError,
    fileNotFound: () => new FileSystemError("FileNotFound"),
    readFile: vi.fn(),
    stat: vi.fn(),
    createDirectory: vi.fn(),
    isWritableFileSystem: vi.fn(() => true),
    applyEdit: vi.fn(),
    openTextDocument: vi.fn(),
    showTextDocument: vi.fn(),
    clipboardWriteText: vi.fn(),
    executeCommand: vi.fn(),
    showQuickPick: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    workspaceFolders: [] as Array<{ name: string; uri: { fsPath: string; scheme: string; toString: () => string } }>,
    createFile: vi.fn()
  };
});

vi.mock("vscode", () => {
  const uriFor = (fsPath: string) => ({
    fsPath,
    scheme: "file",
    toString: () => `file://${fsPath}`
  });
  class WorkspaceEdit {
    createFile(uri: { fsPath: string }, options: unknown): this {
      mocks.createFile(uri, options);
      return this;
    }
  }
  return {
    Uri: {
      joinPath: (base: { fsPath: string }, ...segments: string[]) => uriFor(`${base.fsPath}/${segments.join("/")}`)
    },
    FileSystemError: mocks.FileSystemError,
    FileType: { File: 1, Directory: 2 },
    WorkspaceEdit,
    commands: { executeCommand: mocks.executeCommand },
    env: { clipboard: { writeText: mocks.clipboardWriteText } },
    workspace: {
      get workspaceFolders() { return mocks.workspaceFolders; },
      fs: {
        readFile: mocks.readFile,
        stat: mocks.stat,
        createDirectory: mocks.createDirectory,
        isWritableFileSystem: mocks.isWritableFileSystem
      },
      applyEdit: mocks.applyEdit,
      openTextDocument: mocks.openTextDocument
    },
    window: {
      showQuickPick: mocks.showQuickPick,
      showInformationMessage: mocks.showInformationMessage,
      showWarningMessage: mocks.showWarningMessage,
      showErrorMessage: mocks.showErrorMessage,
      showTextDocument: mocks.showTextDocument
    }
  };
});

import {
  createOfficialSnippetConfigurationFeature,
  officialSnippetConfigurationMessageFor,
  VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID,
  OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY
} from "./officialSnippetConfiguration";

type SnippetDefinition = {
  prefix: string | string[];
  body: string | string[];
  description?: string;
  scope?: string;
};

const canonicalSnippetPath = resolve(process.cwd(), "vscode-extension/snippets/nui.json");
const canonicalSnippets = JSON.parse(readFileSync(canonicalSnippetPath, "utf8")) as Record<string, SnippetDefinition>;
const defaultsText = (): Uint8Array => new TextEncoder().encode(JSON.stringify(canonicalSnippets));

const contextForTest = () => ({
  extensionUri: { fsPath: "/extension", scheme: "file", toString: () => "file:///extension" },
  globalState: { get: vi.fn(() => false), update: vi.fn() }
});

const scopeChoice = (id: "profile" | "workspace") => ({
  label: officialSnippetConfigurationMessageFor(`officialSnippets.scope.${id}`, "en"),
  description: "",
  id
});

const configureWorkspaceIn = (folder: { name: string; uri: { fsPath: string; scheme: string; toString: () => string } }) => {
  mocks.workspaceFolders.push(folder);
  mocks.showQuickPick.mockResolvedValueOnce(scopeChoice("workspace")).mockResolvedValueOnce({
    label: folder.name,
    description: folder.uri.fsPath,
    workspaceFolder: folder
  });
};

beforeEach(() => {
  mocks.readFile.mockReset();
  mocks.readFile.mockResolvedValue(defaultsText());
  mocks.stat.mockReset();
  mocks.stat.mockImplementation(async () => { throw mocks.fileNotFound(); });
  mocks.createDirectory.mockReset();
  mocks.createDirectory.mockResolvedValue(undefined);
  mocks.isWritableFileSystem.mockReset();
  mocks.isWritableFileSystem.mockReturnValue(true);
  mocks.applyEdit.mockReset();
  mocks.applyEdit.mockResolvedValue(true);
  mocks.openTextDocument.mockReset();
  mocks.openTextDocument.mockResolvedValue({ uri: { fsPath: "/workspace/.vscode/nuinuiCAD.code-snippets" } });
  mocks.showTextDocument.mockReset();
  mocks.showTextDocument.mockResolvedValue(undefined);
  mocks.clipboardWriteText.mockReset();
  mocks.clipboardWriteText.mockResolvedValue(undefined);
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.showQuickPick.mockReset();
  mocks.showInformationMessage.mockReset();
  mocks.showWarningMessage.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.workspaceFolders.splice(0);
  mocks.createFile.mockReset();
});

describe("official snippet configuration", () => {
  it("localizes the in-product setup and duplicate-prefix guidance", () => {
    expect(officialSnippetConfigurationMessageFor("officialSnippets.scope.profile", "ja-JP")).toBe("現在のプロファイル");
    expect(officialSnippetConfigurationMessageFor("officialSnippets.chooseScope", "en")).toContain("does not deduplicate");
  });

  it("serializes all canonical snippets as nui-scoped code snippets without changing their definitions", () => {
    const context = contextForTest();
    const feature = createOfficialSnippetConfigurationFeature(context as never, () => "en");
    mocks.showQuickPick.mockResolvedValueOnce(scopeChoice("profile"));
    mocks.showInformationMessage.mockResolvedValueOnce(
      officialSnippetConfigurationMessageFor("officialSnippets.profile.openAction", "en")
    );

    return expect(feature.configure()).resolves.toBe(true).then(() => {
      const copied = JSON.parse(mocks.clipboardWriteText.mock.calls[0]?.[0] as string) as Record<string, SnippetDefinition>;
      expect(Object.keys(copied)).toEqual(Object.keys(canonicalSnippets));
      expect(Object.keys(copied)).toHaveLength(88);
      for (const [name, canonical] of Object.entries(canonicalSnippets)) {
        const editable = copied[name]!;
        expect(editable.prefix).toEqual(canonical.prefix);
        expect(editable.body).toEqual(canonical.body);
        expect(editable.description).toBe(canonical.description);
        expect(editable.scope).toBe("nui");
      }
      expect(copied["Value / Match / Record Definition / レコード定義"]?.prefix).toBe("nui-record");
      expect(copied["Value / Match / Record Definition / レコード定義"]?.description).toContain("Record Definition / レコード定義");
      expect(mocks.readFile.mock.calls[0]?.[0].fsPath).toBe("/extension/snippets/nui.json");
      expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith("workbench.action.openSnippets");
      expect(mocks.showInformationMessage.mock.calls[0]?.[0]).toContain("New Global Snippets file");
      expect(mocks.showInformationMessage.mock.calls[0]?.[0]).toContain("nuinuiCAD.code-snippets");
      expect(mocks.showInformationMessage.mock.calls[0]?.[0]).toContain("does not deduplicate");
      expect(mocks.createDirectory).not.toHaveBeenCalled();
      expect(mocks.applyEdit).not.toHaveBeenCalled();
    });
  });

  it("does not copy profile snippets when the user cancels the standard setup handoff", async () => {
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");
    mocks.showQuickPick.mockResolvedValueOnce(scopeChoice("profile"));
    mocks.showInformationMessage.mockResolvedValueOnce(undefined);

    await expect(feature.configure()).resolves.toBe(false);

    expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("requires an explicit workspace folder choice and creates the file without overwrite", async () => {
    const unselectedFolder = {
      name: "Other Workspace",
      uri: { fsPath: "/work/other", scheme: "file", toString: () => "file:///work/other" }
    };
    const selectedFolder = {
      name: "Pattern Workspace",
      uri: { fsPath: "/work/pattern", scheme: "file", toString: () => "file:///work/pattern" }
    };
    mocks.workspaceFolders.push(unselectedFolder, selectedFolder);
    mocks.showQuickPick.mockResolvedValueOnce(scopeChoice("workspace")).mockResolvedValueOnce({
      label: selectedFolder.name,
      description: selectedFolder.uri.fsPath,
      workspaceFolder: selectedFolder
    });
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");

    await expect(feature.configure()).resolves.toBe(true);

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(2);
    expect(mocks.createDirectory).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: "/work/pattern/.vscode" })
    );
    expect(mocks.createFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: "/work/pattern/.vscode/nuinuiCAD.code-snippets" }),
      expect.objectContaining({ overwrite: false, ignoreIfExists: false })
    );
    const createOptions = mocks.createFile.mock.calls[0]?.[1] as { contents: Uint8Array; overwrite: boolean; ignoreIfExists: boolean };
    const contents = JSON.parse(new TextDecoder().decode(createOptions.contents)) as Record<string, SnippetDefinition>;
    expect(Object.keys(contents)).toHaveLength(88);
    expect(contents["Calculation / Measurement / Average of Two Values / 2値の平均"]?.scope).toBe("nui");
    expect(mocks.applyEdit).toHaveBeenCalledOnce();
    expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
  });

  it("requires a workspace folder and does not write when there is no open folder", async () => {
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");
    mocks.showQuickPick.mockResolvedValueOnce(scopeChoice("workspace"));

    await expect(feature.configure()).resolves.toBe(false);

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      officialSnippetConfigurationMessageFor("officialSnippets.workspace.noFolder", "en")
    );
    expect(mocks.createDirectory).not.toHaveBeenCalled();
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("does not create files when workspace folder selection is cancelled", async () => {
    mocks.workspaceFolders.push({
      name: "Pattern Workspace",
      uri: { fsPath: "/work/pattern", scheme: "file", toString: () => "file:///work/pattern" }
    });
    mocks.showQuickPick.mockResolvedValueOnce(scopeChoice("workspace")).mockResolvedValueOnce(undefined);
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");

    await expect(feature.configure()).resolves.toBe(false);

    expect(mocks.createDirectory).not.toHaveBeenCalled();
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("does not create or overwrite an existing workspace destination and can open it", async () => {
    const folder = {
      name: "Pattern Workspace",
      uri: { fsPath: "/work/pattern", scheme: "file", toString: () => "file:///work/pattern" }
    };
    configureWorkspaceIn(folder);
    mocks.stat.mockResolvedValueOnce({ type: 1 }).mockResolvedValueOnce({ type: 1 });
    mocks.showWarningMessage.mockResolvedValueOnce(
      officialSnippetConfigurationMessageFor("officialSnippets.workspace.openExisting", "en")
    );
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");

    await expect(feature.configure()).resolves.toBe(false);

    expect(mocks.createDirectory).not.toHaveBeenCalled();
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.applyEdit).not.toHaveBeenCalled();
    expect(mocks.openTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: "/work/pattern/.vscode/nuinuiCAD.code-snippets" })
    );
    expect(mocks.showTextDocument).toHaveBeenCalledOnce();
  });

  it("reports a failed workspace edit without overwriting or claiming setup succeeded", async () => {
    const folder = {
      name: "Pattern Workspace",
      uri: { fsPath: "/work/pattern", scheme: "file", toString: () => "file:///work/pattern" }
    };
    configureWorkspaceIn(folder);
    mocks.applyEdit.mockResolvedValueOnce(false);
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");

    await expect(feature.configure()).resolves.toBe(false);

    expect(mocks.createFile).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ overwrite: false, ignoreIfExists: false })
    );
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      officialSnippetConfigurationMessageFor("officialSnippets.workspace.failed", "en")
        .replace("{fileName}", "Pattern Workspace/.vscode/nuinuiCAD.code-snippets")
    );
  });

  it("does not write into a workspace filesystem marked read-only", async () => {
    const folder = {
      name: "Pattern Workspace",
      uri: { fsPath: "/work/pattern", scheme: "file", toString: () => "file:///work/pattern" }
    };
    configureWorkspaceIn(folder);
    mocks.isWritableFileSystem.mockReturnValueOnce(false);
    const feature = createOfficialSnippetConfigurationFeature(contextForTest() as never, () => "en");

    await expect(feature.configure()).resolves.toBe(false);

    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.createDirectory).not.toHaveBeenCalled();
    expect(mocks.applyEdit).not.toHaveBeenCalled();
  });

  it("leaves the setup prompt pending when it is dismissed", async () => {
    const context = contextForTest();
    const feature = createOfficialSnippetConfigurationFeature(context as never, () => "en");

    await expect(feature.beforeFirstInsert()).resolves.toBe(false);

    expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
    expect(context.globalState.update).not.toHaveBeenCalled();
  });

  it("acknowledges continuation without claiming a snippet file was installed", async () => {
    const context = contextForTest();
    const feature = createOfficialSnippetConfigurationFeature(context as never, () => "en");
    mocks.showInformationMessage.mockResolvedValueOnce(
      officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en")
    );

    await expect(feature.beforeFirstInsert()).resolves.toBe(true);

    expect(context.globalState.update).toHaveBeenCalledExactlyOnceWith(
      OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY,
      true
    );
  });

  it("keeps a cancelled setup choice from acknowledging the first-run prompt", async () => {
    const context = contextForTest();
    const feature = createOfficialSnippetConfigurationFeature(context as never, () => "en");
    mocks.showInformationMessage.mockResolvedValueOnce(
      officialSnippetConfigurationMessageFor("officialSnippets.firstRun.configure", "en")
    );
    mocks.executeCommand.mockResolvedValueOnce(false);

    await expect(feature.beforeFirstInsert()).resolves.toBe(false);

    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith(VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID);
    expect(context.globalState.update).not.toHaveBeenCalled();
  });
});
