import { argNameForParameter } from "../dsl/dslConstructions";
import { parseDsl } from "../dsl/dslParser";
import { quoteDslString, unquoteDslString } from "../dsl/dslTokens";

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
 *
 * v2のimage文は複数物理行にまたがり得るため(縦型call)、`source:`の値は
 * statementのヘッダ行(`statement.line`)とは別の物理行にあることがある。
 * 論理offset(`valueStart`/`valueEnd`)をヘッダ行の文字列へ直接適用すると
 * 位置がずれるため、parserが付与する`attr.physicalSpan`(実ソース中の絶対
 * offset)から実際の物理位置を求めて置換する。
 */
export const rebaseImageSourcePathsInText = (
  sourceText: string,
  currentDocumentPath: string | null,
  nextDocumentPath: string
) => {
  if (currentDocumentPath === nextDocumentPath) return sourceText;
  const usesCrlf = sourceText.includes("\r\n");
  const normalized = sourceText.replace(/\r\n/g, "\n");
  const statements = parseDsl(sourceText).statements;

  const sourcePathArgName = argNameForParameter("image", "sourcePath");

  const replacements: { from: number; to: number; text: string }[] = [];
  for (const statement of statements) {
    if (statement.kind !== "element" || statement.type !== "image") continue;
    const sourcePath = statement.attrs.find((attribute) => attribute.key === sourcePathArgName);
    const segments = sourcePath?.physicalSpan?.segments;
    if (!sourcePath || !segments || segments.length !== 1) continue;
    const currentPath = unquoteDslString(sourcePath.value);
    const nextPath = imagePathForDocument(
      currentPath,
      currentDocumentPath,
      nextDocumentPath
    );
    if (nextPath === currentPath) continue;
    const [segment] = segments;
    replacements.push({ from: segment.from, to: segment.to, text: quoteDslString(nextPath) });
  }
  if (replacements.length === 0) return sourceText;

  // Apply back-to-front so earlier replacements' offsets stay valid.
  replacements.sort((left, right) => right.from - left.from);
  let result = normalized;
  for (const replacement of replacements) {
    result = `${result.slice(0, replacement.from)}${replacement.text}${result.slice(replacement.to)}`;
  }
  return usesCrlf ? result.replace(/\n/g, "\r\n") : result;
};
