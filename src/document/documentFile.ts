import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import {
  initialCadDocumentState,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { sourceEditSession } from "../editor/sourceEditSession";
import { rebaseImageSourcePathsInText } from "./imageFilePaths";
import {
  ensureNuiDocumentFileName,
  NUI_DOCUMENT_EXTENSION
} from "./nuiFormat";
import { unsupportedNuiMajorVersion } from "./nuiVersion";

type DocumentFileFilter = {
  name: string;
  extensions: string[];
};

const nuiDocumentFilter: DocumentFileFilter = {
  name: "nuinuiCAD document",
  extensions: [NUI_DOCUMENT_EXTENSION]
};

const invokeWriteDocumentFile = (path: string, content: string) =>
  invoke<void>("write_document_file", { path, content });

const invokeReadDocumentFile = (path: string) =>
  invoke<string>("read_document_file", { path });

const openNuiDocumentDialog = () =>
  open({ filters: [nuiDocumentFilter], multiple: false });

const saveDocumentDialog = (defaultPath: string) =>
  save({ filters: [nuiDocumentFilter], defaultPath });

const selectedPath = (value: string | string[] | null) =>
  Array.isArray(value) ? value[0] ?? null : value;

const assertTauriFileRuntime = () => {
  if (!isTauriRuntime()) {
    throw new Error("ローカルファイル操作はTauri版でのみ利用できます。");
  }
};

const flushSourceEditForFileOperation = () => {
  const result = sourceEditSession.flush("save");
  if (result !== "blocked-composition") return true;
  useCadUiStore.getState().setCommandErrorMessage(
    "日本語入力の確定中はファイル操作を実行できません。入力を確定してから再操作してください。"
  );
  return false;
};

export const confirmDiscardUnsavedChanges = async (actionLabel: string) => {
  if (!flushSourceEditForFileOperation()) return false;
  if (!useCadDocumentStore.getState().dirtySinceSave) return true;

  const message = `未保存の変更を破棄して${actionLabel}ますか？`;
  if (isTauriRuntime()) {
    try {
      return await confirm(message, {
        title: "nuinuiCAD",
        kind: "warning",
        okLabel: "破棄して続ける",
        cancelLabel: "キャンセル"
      });
    } catch (error: unknown) {
      console.error("Failed to confirm discarding unsaved changes.", error);
      useCadUiStore.getState().setCommandErrorMessage(
        "未保存の変更を破棄する確認を表示できませんでした。操作を中止しました。"
      );
      return false;
    }
  }
  return window.confirm(message);
};

export const newDocument = async () => {
  if (!await confirmDiscardUnsavedChanges("新規ドキュメントを作成し")) return;

  const initialDocument = initialCadDocumentState();
  if (!flushSourceEditForFileOperation()) return;
  useCadDocumentStore.getState().replaceDocument(initialDocument.doc.document, null);
};

export const saveDocumentAs = async () => {
  assertTauriFileRuntime();
  if (!flushSourceEditForFileOperation()) return;
  const state = useCadDocumentStore.getState();
  const path = selectedPath(
    await saveDocumentDialog(state.currentFilePath ?? `pattern.${NUI_DOCUMENT_EXTENSION}`)
  );
  if (!path) return;

  if (!flushSourceEditForFileOperation()) return;
  const latestState = useCadDocumentStore.getState();

  const normalizedPath = ensureNuiDocumentFileName(path);
  const nextText = rebaseImageSourcePathsInText(
    latestState.sourceText,
    latestState.currentFilePath,
    normalizedPath
  );
  await invokeWriteDocumentFile(normalizedPath, nextText);
  if (nextText !== latestState.sourceText) {
    useCadDocumentStore.getState().commitText(nextText, "file");
  }
  useCadDocumentStore.getState().markDocumentSaved(normalizedPath, nextText);
};

export const saveDocument = async () => {
  assertTauriFileRuntime();
  if (!flushSourceEditForFileOperation()) return;
  const state = useCadDocumentStore.getState();
  if (!state.currentFilePath) {
    await saveDocumentAs();
    return;
  }

  await invokeWriteDocumentFile(state.currentFilePath, state.sourceText);
  useCadDocumentStore.getState().markDocumentSaved(state.currentFilePath, state.sourceText);
};

export const openDocument = async () => {
  assertTauriFileRuntime();
  if (!await confirmDiscardUnsavedChanges("開き")) return;

  const path = selectedPath(await openNuiDocumentDialog());
  if (!path) return;

  const content = await invokeReadDocumentFile(path);
  const unsupportedMajor = unsupportedNuiMajorVersion(content);
  if (unsupportedMajor !== null) {
    throw new Error(`nui 4 文書のみ開けます（検出: ${unsupportedMajor}）。`);
  }
  if (!flushSourceEditForFileOperation()) return;
  useCadDocumentStore.getState().replaceTextDocument(content, {
    currentFilePath: path,
    dirtySinceSave: false
  });
};
