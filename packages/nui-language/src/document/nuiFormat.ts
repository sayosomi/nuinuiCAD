export const NUI_DOCUMENT_EXTENSION = "nui";

export const ensureNuiDocumentFileName = (path: string) =>
  path.toLowerCase().endsWith(`.${NUI_DOCUMENT_EXTENSION}`)
    ? path
    : `${path}.${NUI_DOCUMENT_EXTENSION}`;

export const fileNameFromPath = (path: string | null) => {
  if (!path) return "未保存";
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() || path;
};
