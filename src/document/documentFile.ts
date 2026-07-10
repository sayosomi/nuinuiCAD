import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CAD_DOCUMENT_EXTENSION,
  ensureCadDocumentFileName,
  parseCadDocumentFile,
  serializeCadDocumentFile
} from "./documentFormat";
import {
  currentDocumentSnapshot,
  initialCadDocumentState,
  useCadDocumentStore,
  type CadDocumentSnapshot
} from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { defaultDocumentPalette } from "../palette/palette";
import { loadPaletteTemplateSettings } from "../palette/paletteSettingsStorage";
import { snapshotWithImagePathsForSave } from "./imageFilePaths";

type DocumentFileFilter = {
  name: string;
  extensions: string[];
};

const documentFilter: DocumentFileFilter = {
  name: "nuinuiCAD document",
  extensions: [CAD_DOCUMENT_EXTENSION]
};

const invokeWriteDocumentFile = (path: string, content: string) =>
  invoke<void>("write_document_file", { path, content });

const invokeReadDocumentFile = (path: string) =>
  invoke<string>("read_document_file", { path });

const openDocumentDialog = () =>
  open({
    filters: [documentFilter],
    multiple: false
  });

const saveDocumentDialog = (defaultPath: string) =>
  save({
    filters: [documentFilter],
    defaultPath
  });

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

export const writeDocumentSnapshotToPath = async (
  snapshot: CadDocumentSnapshot,
  path: string,
  currentFilePath: string | null = null
) => {
  const normalizedPath = ensureCadDocumentFileName(path);
  await invokeWriteDocumentFile(
    normalizedPath,
    serializeCadDocumentFile(
      snapshotWithImagePathsForSave(snapshot, currentFilePath, normalizedPath)
    )
  );
  return normalizedPath;
};

export const saveDocumentAs = async () => {
  assertTauriFileRuntime();
  const state = useCadDocumentStore.getState();
  const path = selectedPath(
    await saveDocumentDialog(state.currentFilePath ?? `pattern.${CAD_DOCUMENT_EXTENSION}`)
  );
  if (!path) return;

  const savedPath = await writeDocumentSnapshotToPath(
    currentDocumentSnapshot(state, useCadUiStore.getState()),
    path,
    state.currentFilePath
  );
  useCadDocumentStore.getState().markDocumentSaved(savedPath);
};

export const saveDocument = async () => {
  assertTauriFileRuntime();
  const state = useCadDocumentStore.getState();
  if (!state.currentFilePath) {
    await saveDocumentAs();
    return;
  }

  const savedPath = await writeDocumentSnapshotToPath(
    currentDocumentSnapshot(state, useCadUiStore.getState()),
    state.currentFilePath,
    state.currentFilePath
  );
  useCadDocumentStore.getState().markDocumentSaved(savedPath);
};

export const openDocument = async () => {
  assertTauriFileRuntime();
  if (!confirmDiscardUnsavedChanges("開き")) return;

  const path = selectedPath(
    await openDocumentDialog()
  );
  if (!path) return;

  const content = await invokeReadDocumentFile(path);
  const document = parseCadDocumentFile(content);
  useCadDocumentStore.getState().replaceDocument(document, path);
};
