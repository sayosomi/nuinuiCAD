import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../geometry/evaluationEngine";
import type { GroupTemplate, GroupTemplateLibrary } from "./groupTemplate";
import {
  GROUP_TEMPLATE_EXTENSION,
  defaultGroupTemplateLibrary,
  normalizeGroupTemplateLibrary,
  parseGroupTemplateFile,
  serializeGroupTemplateFile
} from "./groupTemplateFormat";

const STORAGE_KEY = "nuinuiCAD.groupTemplateLibrary.v1";

const templateFilter = {
  name: "nuinuiCAD template",
  extensions: [GROUP_TEMPLATE_EXTENSION]
};

const selectedPath = (value: string | string[] | null) =>
  Array.isArray(value) ? value[0] ?? null : value;

const ensureTemplateFileName = (path: string) =>
  path.endsWith(`.${GROUP_TEMPLATE_EXTENSION}`) ? path : `${path}.${GROUP_TEMPLATE_EXTENSION}`;

const loadFromLocalStorage = () => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultGroupTemplateLibrary();
  try {
    return normalizeGroupTemplateLibrary(JSON.parse(raw));
  } catch {
    return defaultGroupTemplateLibrary();
  }
};

const saveToLocalStorage = (library: GroupTemplateLibrary) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeGroupTemplateLibrary(library)));
};

export const loadGroupTemplateLibrary = async (): Promise<GroupTemplateLibrary> => {
  if (!isTauriRuntime()) return loadFromLocalStorage();
  const settings = await invoke<unknown>("load_group_template_library");
  return normalizeGroupTemplateLibrary(settings);
};

export const saveGroupTemplateLibrary = async (library: GroupTemplateLibrary) => {
  const normalized = normalizeGroupTemplateLibrary(library);
  if (!isTauriRuntime()) {
    saveToLocalStorage(normalized);
    return;
  }
  await invoke<void>("save_group_template_library", { input: normalized });
};

export const upsertGroupTemplate = async (template: GroupTemplate) => {
  const library = await loadGroupTemplateLibrary();
  const existingIndex = library.templates.findIndex((item) => item.id === template.id);
  const templates =
    existingIndex >= 0
      ? library.templates.map((item) => (item.id === template.id ? template : item))
      : [...library.templates, template];
  await saveGroupTemplateLibrary({ version: 1, templates });
  return { version: 1 as const, templates };
};

export const deleteGroupTemplate = async (templateId: string) => {
  const library = await loadGroupTemplateLibrary();
  const next = {
    version: 1 as const,
    templates: library.templates.filter((template) => template.id !== templateId)
  };
  await saveGroupTemplateLibrary(next);
  return next;
};

export const importGroupTemplateFromFile = async () => {
  const path = selectedPath(await open({ filters: [templateFilter], multiple: false }));
  if (!path) return null;
  const content = await invoke<string>("read_document_file", { path });
  return parseGroupTemplateFile(content);
};

export const exportGroupTemplateToFile = async (template: GroupTemplate) => {
  const path = selectedPath(
    await save({
      filters: [templateFilter],
      defaultPath: `${template.name || "template"}.${GROUP_TEMPLATE_EXTENSION}`
    })
  );
  if (!path) return null;
  const normalizedPath = ensureTemplateFileName(path);
  await invoke<void>("write_document_file", {
    path: normalizedPath,
    content: serializeGroupTemplateFile(template)
  });
  return normalizedPath;
};
