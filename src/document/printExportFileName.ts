import { fileNameFromPath } from "./nuiFormat";

type PrintExportFileNameInput = {
  layoutName: string;
  documentPath: string | null;
  extension: "pdf" | "svg";
};

const sanitizeExportBaseName = (name: string, fallback: string) => {
  const sanitized = Array.from(name.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || /[<>:"/\\|?*]/.test(character) ? "_" : character;
  }).join("");
  return sanitized.length > 0 ? sanitized : fallback;
};

const documentBaseName = (documentPath: string | null) => {
  if (!documentPath) return "pattern";
  return sanitizeExportBaseName(
    fileNameFromPath(documentPath).replace(/\.nui$/i, ""),
    "pattern"
  );
};

const layoutBaseName = (layoutName: string) =>
  sanitizeExportBaseName(layoutName, "layout");

const directoryName = (path: string | null) => {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return null;
  return index === 0 ? "/" : normalized.slice(0, index);
};

export const defaultPrintExportFileName = ({
  layoutName,
  documentPath,
  extension
}: PrintExportFileNameInput) =>
  `${documentBaseName(documentPath)}_${layoutBaseName(layoutName)}.${extension}`;

export const defaultPrintExportPath = (input: PrintExportFileNameInput) => {
  const fileName = defaultPrintExportFileName(input);
  const directory = directoryName(input.documentPath);
  return directory ? `${directory}/${fileName}` : fileName;
};
