import { parseDsl } from "../dsl/dslParser";
import { quoteDslString } from "../dsl/dslTokens";

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

/**
 * Save As時に、解釈できたimage文のsourcePath属性だけを書き換える。
 * 構文エラーを含む文書でも、他の行は逐語のまま残す。
 */
export const rebaseImageSourcePathsInText = (
  sourceText: string,
  currentDocumentPath: string | null,
  nextDocumentPath: string
) => {
  if (currentDocumentPath === nextDocumentPath) return sourceText;
  const newline = sourceText.includes("\r\n") ? "\r\n" : "\n";
  const lines = sourceText.split(/\r?\n/);
  const statements = parseDsl(sourceText).statements;

  for (const statement of statements) {
    if (statement.kind !== "element" || statement.type !== "image") continue;
    const sourcePath = statement.attrs.find((attribute) => attribute.key === "sourcePath");
    if (!sourcePath) continue;
    const nextPath = imagePathForDocument(
      sourcePath.value,
      currentDocumentPath,
      nextDocumentPath
    );
    if (nextPath === sourcePath.value) continue;
    const lineIndex = statement.line - 1;
    const line = lines[lineIndex];
    if (line === undefined) continue;
    lines[lineIndex] = `${line.slice(0, sourcePath.valueStart)}${quoteDslString(nextPath)}${line.slice(sourcePath.valueEnd)}`;
  }

  return lines.join(newline);
};
