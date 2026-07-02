import type { CadDocumentSnapshot } from "../state/cadDocumentStore";
import type { CadElement } from "../types/geometry";

const separatorPattern = /[\\/]+/;

export const isAbsoluteFilePath = (path: string) =>
  path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^[a-z]+:\/\//i.test(path);

const normalizeSeparators = (path: string) => path.replace(/\\/g, "/");

export const directoryName = (path: string | null) => {
  if (!path) return null;
  const normalized = normalizeSeparators(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};

const normalizePathParts = (parts: string[]) => {
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack.at(-1) !== "..") {
        stack.pop();
      } else {
        stack.push(part);
      }
      continue;
    }
    stack.push(part);
  }
  return stack;
};

export const resolveImagePath = (sourcePath: string, documentPath: string | null) => {
  if (!sourcePath || isAbsoluteFilePath(sourcePath)) return sourcePath;
  const directory = directoryName(documentPath);
  if (!directory) return sourcePath;
  const normalized = normalizeSeparators(`${directory}/${sourcePath}`);
  const prefix = normalized.startsWith("/") ? "/" : "";
  return `${prefix}${normalizePathParts(normalized.split(separatorPattern)).join("/")}`;
};

export const relativeImagePath = (absolutePath: string, documentPath: string | null) => {
  const directory = directoryName(documentPath);
  if (!directory || !isAbsoluteFilePath(absolutePath)) return absolutePath;

  const from = normalizePathParts(normalizeSeparators(directory).split(separatorPattern));
  const to = normalizePathParts(normalizeSeparators(absolutePath).split(separatorPattern));
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  if (shared === 0) return absolutePath;
  const up = Array.from({ length: from.length - shared }, () => "..");
  return [...up, ...to.slice(shared)].join("/") || ".";
};

export const imagePathForDocument = (
  sourcePath: string,
  currentDocumentPath: string | null,
  nextDocumentPath: string | null
) => relativeImagePath(resolveImagePath(sourcePath, currentDocumentPath), nextDocumentPath);

export const snapshotWithImagePathsForSave = (
  snapshot: CadDocumentSnapshot,
  currentDocumentPath: string | null,
  nextDocumentPath: string
): CadDocumentSnapshot => ({
  ...snapshot,
  elements: snapshot.elements.map((element): CadElement =>
    element.type === "image"
      ? {
          ...element,
          sourcePath: imagePathForDocument(
            element.sourcePath,
            currentDocumentPath,
            nextDocumentPath
          )
        }
      : element
  )
});
