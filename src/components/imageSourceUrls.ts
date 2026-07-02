import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveImagePath } from "../document/imageFilePaths";
import { isTauriRuntime } from "../geometry/evaluationEngine";

export const imageSourceUrl = (sourcePath: string, documentPath: string | null) => {
  const resolved = resolveImagePath(sourcePath, documentPath);
  if (!isTauriRuntime()) return resolved;
  return convertFileSrc(resolved);
};
