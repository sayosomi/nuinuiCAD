import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import { defaultDocumentPalette } from "../palette/palette";
import { loadPaletteTemplateSettings } from "../palette/paletteSettingsStorage";
import {
  initialCadDocumentState,
  useCadDocumentStore
} from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { sourceEditSession } from "../editor/sourceEditSession";
import { LEGACY_CAD_DOCUMENT_EXTENSION } from "./documentFormat";
import { rebaseImageSourcePathsInText } from "./imageFilePaths";
import { importLegacyCadDocument } from "./legacyImport";
import { importLegacyV1Document } from "./legacyV1Import";
import {
  ensureNuiDocumentFileName,
  NUI_DOCUMENT_EXTENSION
} from "./nuiFormat";
import { isLegacyV1NuiDocument, unsupportedNuiMajorVersion } from "./nuiVersion";
import { DSL_VERSION } from "../dsl/dslDocument";

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

const flushSourceEditForFileOperation = () => {
  const result = sourceEditSession.flush("save");
  if (result !== "blocked-composition") return true;
  useCadUiStore.getState().setCommandErrorMessage(
    "日本語入力の確定中はファイル操作を実行できません。入力を確定してから再操作してください。"
  );
  return false;
};

export const confirmDiscardUnsavedChanges = (actionLabel: string) => {
  if (!flushSourceEditForFileOperation()) return false;
  if (!useCadDocumentStore.getState().dirtySinceSave) return true;
  return window.confirm(`未保存の変更を破棄して${actionLabel}ますか？`);
};

export const newDocument = async () => {
  if (!confirmDiscardUnsavedChanges("新規ドキュメントを作成し")) return;

  const initialDocument = initialCadDocumentState();
  const palette = await loadPaletteTemplateSettings()
    .then((settings) => settings.palette)
    .catch(() => defaultDocumentPalette());
  if (!flushSourceEditForFileOperation()) return;
  useCadDocumentStore.getState().replaceDocument(
    {
      ...initialDocument.doc.document,
      palette
    },
    null
  );
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
  if (!confirmDiscardUnsavedChanges("開き")) return;

  const path = selectedPath(await openNuiDocumentDialog());
  if (!path) return;

  const content = await invokeReadDocumentFile(path);
  const unsupportedMajor = unsupportedNuiMajorVersion(content);
  if (unsupportedMajor !== null) {
    throw new Error(`未対応のDSLバージョンです: ${unsupportedMajor}(対応: ${DSL_VERSION})`);
  }
  const imported = isLegacyV1NuiDocument(content) ? importLegacyV1Document(content) : null;
  if (imported && !imported.ok) throw new Error(imported.message);
  if (!flushSourceEditForFileOperation()) return;
  useCadDocumentStore.getState().replaceTextDocument(imported?.sourceText ?? content, {
    currentFilePath: path,
    dirtySinceSave: imported !== null
  });
};

export const importLegacyDocument = async () => {
  assertTauriFileRuntime();
  if (!confirmDiscardUnsavedChanges("旧形式ドキュメントをインポートし")) return;

  const path = selectedPath(await openLegacyDocumentDialog());
  if (!path) return;

  const sourceText = importLegacyCadDocument(await invokeReadDocumentFile(path), path);
  if (!flushSourceEditForFileOperation()) return;
  useCadDocumentStore.getState().replaceTextDocument(sourceText, {
    currentFilePath: null,
    dirtySinceSave: true
  });
};
