import * as vscode from "vscode";
import { createTranslator, resolveLocale, type TranslationCatalog } from "./localization";

export const VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID = "nuinuiCAD.configureOfficialSnippets";
export const OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY = "nuinuiCAD.officialSnippets.promptAcknowledged";

const OFFICIAL_SNIPPETS_DEFAULTS_RELATIVE_PATH = ["snippets", "nui.json"] as const;
const OFFICIAL_SNIPPETS_WORKSPACE_FILE_NAME = "nuinuiCAD.code-snippets";
const VS_CODE_CONFIGURE_SNIPPETS_COMMAND = "workbench.action.openSnippets";

type OfficialSnippetDefinition = Readonly<{
  prefix: string | readonly string[];
  body: string | readonly string[];
  description?: string;
}>;

type OfficialSnippetCollection = Readonly<Record<string, OfficialSnippetDefinition>>;

type OfficialSnippetConfigurationFeature = {
  configure: () => Promise<boolean>;
  beforeFirstInsert: () => Promise<boolean>;
};

export const officialSnippetConfigurationTranslationCatalog = {
  "officialSnippets.firstRun.prompt": {
    en: "Official nui snippets are now available as editable user or workspace snippets. Configure them, or continue with the nui snippets you already have?",
    ja: "公式nuiスニペットを編集可能なユーザー用またはワークスペース用スニペットとして設定できます。設定するか、既存のnuiスニペットで続行しますか？"
  },
  "officialSnippets.firstRun.configure": {
    en: "Configure Official Snippets",
    ja: "公式スニペットを設定"
  },
  "officialSnippets.firstRun.continue": {
    en: "Use Existing Snippets",
    ja: "既存のスニペットを使う"
  },
  "officialSnippets.chooseScope": {
    en: "Choose where to create the editable official collection. Enable one official collection per editor; VS Code does not deduplicate matching prefixes from profile, workspace, or independent snippets.",
    ja: "編集可能な公式コレクションの保存先を選びます。エディターごとに有効な公式コレクションは1つにしてください。プロファイル、ワークスペース、独立したスニペットの同じprefixをVS Codeは重複排除しません。"
  },
  "officialSnippets.scope.profile": {
    en: "Current Profile",
    ja: "現在のプロファイル"
  },
  "officialSnippets.scope.profileDetail": {
    en: "Copy the defaults and open VS Code's Configure Snippets command.",
    ja: "既定値をコピーし、VS Code標準のスニペット設定を開きます。"
  },
  "officialSnippets.scope.workspace": {
    en: "Workspace Folder",
    ja: "ワークスペースフォルダー"
  },
  "officialSnippets.scope.workspaceDetail": {
    en: "Create .vscode/nuinuiCAD.code-snippets in one folder you select.",
    ja: "選択した1つのフォルダーに.vscode/nuinuiCAD.code-snippetsを作成します。"
  },
  "officialSnippets.profile.instructions": {
    en: "This copies the official nui snippets to your clipboard and opens Configure Snippets. Choose “New Global Snippets file…”, give it a new name such as “nuinuiCAD.code-snippets”, then paste. Do not replace an existing snippets file. Profile and workspace collections can both appear in the same editor, and VS Code does not deduplicate matching prefixes.",
    ja: "公式nuiスニペットをクリップボードへコピーし、スニペット設定を開きます。「新しいグローバルスニペットファイル…」を選び、「nuinuiCAD.code-snippets」など新しい名前を付けて貼り付けてください。既存ファイルを置き換えないでください。プロファイル用とワークスペース用の両方を有効にすると同じ候補が並ぶことがあります。VS Codeは同じprefixを重複排除しません。"
  },
  "officialSnippets.profile.openAction": {
    en: "Copy and Open Configure Snippets",
    ja: "コピーしてスニペット設定を開く"
  },
  "officialSnippets.profile.failed": {
    en: "Could not copy the official snippets or open Configure Snippets. No snippets file was changed.",
    ja: "公式スニペットのコピーまたはスニペット設定を開けませんでした。スニペットファイルは変更されていません。"
  },
  "officialSnippets.workspace.noFolder": {
    en: "Open a workspace folder before creating workspace snippets.",
    ja: "ワークスペース用スニペットを作成するには、先にワークスペースフォルダーを開いてください。"
  },
  "officialSnippets.workspace.chooseFolder": {
    en: "Select the workspace folder that should own the official nui snippets.",
    ja: "公式nuiスニペットを保存するワークスペースフォルダーを選択してください。"
  },
  "officialSnippets.workspace.readOnly": {
    en: "The selected workspace folder does not support writing. No snippets file was changed.",
    ja: "選択したワークスペースフォルダーは書き込みに対応していません。スニペットファイルは変更されていません。"
  },
  "officialSnippets.workspace.exists": {
    en: "{fileName} already exists. It will not be overwritten or merged. Open it to edit manually?",
    ja: "{fileName}はすでに存在します。上書きや自動マージは行いません。開いて手動で編集しますか？"
  },
  "officialSnippets.workspace.openExisting": {
    en: "Open Existing File",
    ja: "既存ファイルを開く"
  },
  "officialSnippets.workspace.notAFile": {
    en: "The workspace snippet destination exists but is not a file. No changes were made.",
    ja: "ワークスペース用スニペットの保存先は存在しますが、ファイルではありません。変更は行われていません。"
  },
  "officialSnippets.workspace.checkFailed": {
    en: "Could not safely check the workspace snippet destination. No snippets file was changed.",
    ja: "ワークスペース用スニペットの保存先を安全に確認できませんでした。スニペットファイルは変更されていません。"
  },
  "officialSnippets.workspace.created": {
    en: "Created {fileName}. Edit this file directly. Disable another profile or workspace official collection to avoid duplicate candidates; VS Code does not deduplicate matching prefixes.",
    ja: "{fileName}を作成しました。このファイルを直接編集できます。同じ候補の重複を避けるには、他のプロファイル用またはワークスペース用公式コレクションを無効にしてください。VS Codeは同じprefixを重複排除しません。"
  },
  "officialSnippets.workspace.failed": {
    en: "Could not create {fileName}. Existing files were not overwritten or merged.",
    ja: "{fileName}を作成できませんでした。既存ファイルは上書きもマージもされていません。"
  },
  "officialSnippets.workspace.openFailed": {
    en: "The existing workspace snippet file could not be opened. It was not changed.",
    ja: "既存のワークスペース用スニペットファイルを開けませんでした。ファイルは変更されていません。"
  },
  "officialSnippets.defaults.failed": {
    en: "Could not read the packaged official snippet defaults.",
    ja: "パッケージに含まれる公式スニペットの既定値を読み込めませんでした。"
  }
} satisfies TranslationCatalog;

export const officialSnippetConfigurationMessageFor = (key: string, displayLanguage: string): string =>
  createTranslator(
    officialSnippetConfigurationTranslationCatalog,
    resolveLocale(displayLanguage)
  )(key);

const snippetConfigurationTextFor = (snippets: OfficialSnippetCollection): string => {
  const scopedSnippets = Object.fromEntries(
    Object.entries(snippets).map(([name, snippet]) => [name, { ...snippet, scope: "nui" }])
  );
  return `${JSON.stringify(scopedSnippets, null, 2)}\n`;
};

const packagedOfficialSnippetsFor = async (extensionUri: vscode.Uri): Promise<OfficialSnippetCollection> => {
  const defaultsUri = vscode.Uri.joinPath(extensionUri, ...OFFICIAL_SNIPPETS_DEFAULTS_RELATIVE_PATH);
  const bytes = await vscode.workspace.fs.readFile(defaultsUri);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Packaged official snippets must be a JSON object");
  }
  return parsed as OfficialSnippetCollection;
};

const isFileNotFound = (error: unknown): boolean =>
  error instanceof vscode.FileSystemError && error.code === "FileNotFound";

const statIfPresent = async (uri: vscode.Uri): Promise<vscode.FileStat | undefined> => {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
};

const openExistingWorkspaceSnippetFile = async (
  uri: vscode.Uri,
  fileName: string,
  displayLanguage: string
): Promise<void> => {
  const translate = (key: string): string => officialSnippetConfigurationMessageFor(key, displayLanguage);
  let stat: vscode.FileStat | undefined;
  try {
    stat = await statIfPresent(uri);
  } catch {
    void vscode.window.showErrorMessage(translate("officialSnippets.workspace.checkFailed"));
    return;
  }
  if (!stat) {
    void vscode.window.showErrorMessage(
      translate("officialSnippets.workspace.failed").replace("{fileName}", fileName)
    );
    return;
  }
  if ((stat.type & vscode.FileType.File) === 0) {
    void vscode.window.showErrorMessage(translate("officialSnippets.workspace.notAFile"));
    return;
  }

  const openAction = translate("officialSnippets.workspace.openExisting");
  const choice = await vscode.window.showWarningMessage(
    translate("officialSnippets.workspace.exists").replace("{fileName}", fileName),
    openAction
  );
  if (choice !== openAction) return;
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch {
    void vscode.window.showErrorMessage(translate("officialSnippets.workspace.openFailed"));
  }
};

const configureOfficialSnippetsForProfile = async (
  snippetsText: string,
  displayLanguage: string
): Promise<boolean> => {
  const translate = (key: string): string => officialSnippetConfigurationMessageFor(key, displayLanguage);
  const openAction = translate("officialSnippets.profile.openAction");
  const choice = await vscode.window.showInformationMessage(
    translate("officialSnippets.profile.instructions"),
    openAction
  );
  if (choice !== openAction) return false;

  try {
    await vscode.env.clipboard.writeText(snippetsText);
    await vscode.commands.executeCommand(VS_CODE_CONFIGURE_SNIPPETS_COMMAND);
    return true;
  } catch {
    void vscode.window.showErrorMessage(translate("officialSnippets.profile.failed"));
    return false;
  }
};

const configureOfficialSnippetsForWorkspace = async (
  snippetsText: string,
  displayLanguage: string
): Promise<boolean> => {
  const translate = (key: string): string => officialSnippetConfigurationMessageFor(key, displayLanguage);
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showInformationMessage(translate("officialSnippets.workspace.noFolder"));
    return false;
  }

  const folder = await vscode.window.showQuickPick(
    folders.map((workspaceFolder) => ({
      label: workspaceFolder.name,
      description: workspaceFolder.uri.fsPath,
      workspaceFolder
    })),
    { placeHolder: translate("officialSnippets.workspace.chooseFolder"), ignoreFocusOut: true }
  );
  if (!folder) return false;
  if (vscode.workspace.fs.isWritableFileSystem(folder.workspaceFolder.uri.scheme) === false) {
    void vscode.window.showErrorMessage(translate("officialSnippets.workspace.readOnly"));
    return false;
  }

  const snippetsDirectory = vscode.Uri.joinPath(folder.workspaceFolder.uri, ".vscode");
  const destination = vscode.Uri.joinPath(snippetsDirectory, OFFICIAL_SNIPPETS_WORKSPACE_FILE_NAME);
  const displayPath = `${folder.workspaceFolder.name}/.vscode/${OFFICIAL_SNIPPETS_WORKSPACE_FILE_NAME}`;
  let existing: vscode.FileStat | undefined;
  try {
    existing = await statIfPresent(destination);
  } catch {
    void vscode.window.showErrorMessage(translate("officialSnippets.workspace.checkFailed"));
    return false;
  }
  if (existing) {
    await openExistingWorkspaceSnippetFile(destination, displayPath, displayLanguage);
    return false;
  }

  try {
    await vscode.workspace.fs.createDirectory(snippetsDirectory);
  } catch {
    void vscode.window.showErrorMessage(
      translate("officialSnippets.workspace.failed").replace("{fileName}", displayPath)
    );
    return false;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.createFile(destination, {
    contents: new TextEncoder().encode(snippetsText),
    overwrite: false,
    ignoreIfExists: false
  });
  try {
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      void vscode.window.showInformationMessage(
        translate("officialSnippets.workspace.created").replace("{fileName}", displayPath)
      );
      return true;
    }
  } catch {
    // The destination is checked again below so a concurrent creator is never overwritten.
  }

  await openExistingWorkspaceSnippetFile(destination, displayPath, displayLanguage);
  return false;
};

export const createOfficialSnippetConfigurationFeature = (
  context: vscode.ExtensionContext,
  displayLanguageFor: () => string
): OfficialSnippetConfigurationFeature => {
  const configure = async (): Promise<boolean> => {
    const displayLanguage = displayLanguageFor();
    const translate = (key: string): string => officialSnippetConfigurationMessageFor(key, displayLanguage);
    let snippets: OfficialSnippetCollection;
    try {
      snippets = await packagedOfficialSnippetsFor(context.extensionUri);
    } catch {
      void vscode.window.showErrorMessage(translate("officialSnippets.defaults.failed"));
      return false;
    }
    const snippetsText = snippetConfigurationTextFor(snippets);
    const mode = await vscode.window.showQuickPick([
      {
        label: translate("officialSnippets.scope.profile"),
        description: translate("officialSnippets.scope.profileDetail"),
        id: "profile" as const
      },
      {
        label: translate("officialSnippets.scope.workspace"),
        description: translate("officialSnippets.scope.workspaceDetail"),
        id: "workspace" as const
      }
    ], {
      placeHolder: translate("officialSnippets.chooseScope"),
      ignoreFocusOut: true
    });
    if (!mode) return false;
    return mode.id === "profile"
      ? configureOfficialSnippetsForProfile(snippetsText, displayLanguage)
      : configureOfficialSnippetsForWorkspace(snippetsText, displayLanguage);
  };

  const beforeFirstInsert = async (): Promise<boolean> => {
    if (context.globalState.get<boolean>(OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY) === true) return true;

    const displayLanguage = displayLanguageFor();
    const translate = (key: string): string => officialSnippetConfigurationMessageFor(key, displayLanguage);
    const configureAction = translate("officialSnippets.firstRun.configure");
    const continueAction = translate("officialSnippets.firstRun.continue");
    const choice = await vscode.window.showInformationMessage(
      translate("officialSnippets.firstRun.prompt"),
      configureAction,
      continueAction
    );
    if (choice === continueAction) {
      await context.globalState.update(OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY, true);
      return true;
    }
    if (choice === configureAction) {
      const configurationFlowStarted = await vscode.commands.executeCommand<boolean>(
        VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID
      );
      if (configurationFlowStarted === true) {
        // This only remembers the explicit prompt choice; it is not proof of file installation.
        await context.globalState.update(OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY, true);
      }
    }
    return false;
  };

  return { configure, beforeFirstInsert };
};

export const officialSnippetWorkspaceFileName = OFFICIAL_SNIPPETS_WORKSPACE_FILE_NAME;
