import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { defaultDocumentPalette } from "../palette/palette";
import { loadPaletteTemplateSettings } from "../palette/paletteSettingsStorage";
import {
  currentDocumentSnapshot,
  initialCadDocumentState,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { initialCadUiState } from "../state/cadUiStore";
import { LEGACY_CAD_DOCUMENT_EXTENSION } from "./documentFormat";
import { rebaseImageSourcePathsInText } from "./imageFilePaths";
import { importLegacyCadDocument } from "./legacyImport";
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

const legacyDocumentFilter: DocumentFileFilter = {
  name: "nuinuiCAD legacy document",
  extensions: [LEGACY_CAD_DOCUMENT_EXTENSION]
};

const invokeWriteDocumentFile = (path: string, content: string) =>
  invoke<void>("write_document_file", { path, content });

const invokeReadDocumentFile = (path: string) =>
  invoke<string>("read_document_file", { path });

const openNuiDocumentDialog = () =>
  open({ filters: [nuiDocumentFilter], multiple: false });

const openLegacyDocumentDialog = () =>
  open({ filters: [legacyDocumentFilter], multiple: false });

const saveDocumentDialog = (defaultPath: string) =>
  save({ filters: [nuiDocumentFilter], defaultPath });

const selectedPath = (value: string | string[] | null) =>
  Array.isArray(value) ? value[0] ?? null : value;

const assertTauriFileRuntime = () => {
  if (!isTauriRuntime()) {
    throw new Error("ローカルファイル操作はTauri版でのみ利用できます。");
  }
};

export const confirmDiscardUnsavedChanges = (actionLabel: string) => {
  if (!useCadDocumentStore.getState().dirtySinceSave) return true;
  return window.confirm(`未保存の変更を破棄して${actionLabel}ますか？`);
};

export const newDocument = async () => {
  if (!confirmDiscardUnsavedChanges("新規ドキュメントを作成し")) return;

  const initialDocument = initialCadDocumentState();
  const palette = await loadPaletteTemplateSettings()
    .then((settings) => settings.palette)
    .catch(() => defaultDocumentPalette());
  useCadDocumentStore.getState().replaceDocument(
    {
      ...currentDocumentSnapshot(initialDocument, initialCadUiState()),
      palette
    },
    null
  );
};

export const saveDocumentAs = async () => {
  assertTauriFileRuntime();
  const state = useCadDocumentStore.getState();
  const path = selectedPath(
    await saveDocumentDialog(state.currentFilePath ?? `pattern.${NUI_DOCUMENT_EXTENSION}`)
  );
  if (!path) return;

  const normalizedPath = ensureNuiDocumentFileName(path);
  const nextText = rebaseImageSourcePathsInText(
    state.sourceText,
    state.currentFilePath,
    normalizedPath
  );
  await invokeWriteDocumentFile(normalizedPath, nextText);
  if (nextText !== state.sourceText) {
    useCadDocumentStore.getState().commitText(nextText, "file");
  }
  useCadDocumentStore.getState().markDocumentSaved(normalizedPath);
};

export const saveDocument = async () => {
  assertTauriFileRuntime();
  const state = useCadDocumentStore.getState();
  if (!state.currentFilePath) {
    await saveDocumentAs();
    return;
  }

  await invokeWriteDocumentFile(state.currentFilePath, state.sourceText);
  useCadDocumentStore.getState().markDocumentSaved(state.currentFilePath);
};

export const openDocument = async () => {
  assertTauriFileRuntime();
  if (!confirmDiscardUnsavedChanges("開き")) return;

  const path = selectedPath(await openNuiDocumentDialog());
  if (!path) return;

  const content = await invokeReadDocumentFile(path);
  const unsupportedMajor = unsupportedNuiMajorVersion(content);
  if (unsupportedMajor !== null) {
    throw new Error(`未対応のDSLバージョンです: ${unsupportedMajor}(対応: 1)`);
  }
  useCadDocumentStore.getState().replaceTextDocument(content, {
    currentFilePath: path,
    dirtySinceSave: false
  });
};

export const importLegacyDocument = async () => {
  assertTauriFileRuntime();
  if (!confirmDiscardUnsavedChanges("旧形式ドキュメントをインポートし")) return;

  const path = selectedPath(await openLegacyDocumentDialog());
  if (!path) return;

  const sourceText = importLegacyCadDocument(await invokeReadDocumentFile(path), path);
  useCadDocumentStore.getState().replaceTextDocument(sourceText, {
    currentFilePath: null,
    dirtySinceSave: true
  });
};
