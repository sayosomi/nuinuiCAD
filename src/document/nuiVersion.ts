import { SUPPORTED_DSL_MAJOR_VERSIONS, type DslMajorVersion } from "../dsl/dslDocument";

const versionFromRawSource = (source: string): number | null => {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^nui\s+(\d+)\s*(?:#.*)?$/.exec(trimmed);
    return match ? Number(match[1]) : null;
  }
  return null;
};

/**
 * Reads only a well-formed leading `nui <major>` line from raw source text.
 * This intentionally runs before the live v2/v3 parser so v1 never reaches it.
 */
export const nuiMajorVersionFromRawSource = (source: string) => versionFromRawSource(source);

export const isLegacyV1NuiDocument = (source: string) =>
  nuiMajorVersionFromRawSource(source) === 1;

/** Returns only majors that the file-open boundary must reject before compilation. */
export const unsupportedNuiMajorVersion = (source: string) => {
  const major = nuiMajorVersionFromRawSource(source);
  if (major === 0) return major;
  // major 1 is legacy v1, handled separately by isLegacyV1NuiDocument/importLegacyV1Document.
  if (major === null || major === 1) return null;
  return (SUPPORTED_DSL_MAJOR_VERSIONS as readonly number[]).includes(major) ? null : major;
};

export type NuiMajorVersionSpliceResult =
  | { status: "ready"; splice: { from: number; to: number; insert: string } }
  | { status: "already-target" }
  | { status: "unrecognized-header" };

/**
 * Locates the version header's digit run and returns a character-offset
 * splice to change it to `targetMajor`, touching nothing else in the source
 * (no line-ending, BOM, or trailing-comment bytes are ever read or written).
 * Only scans the leading blank/comment/header lines \u2014 never a full parse.
 */
export const buildNuiMajorVersionSplice = (
  source: string,
  targetMajor: DslMajorVersion
): NuiMajorVersionSpliceResult => {
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (cursor <= source.length) {
    const newlineIndex = source.indexOf("\n", cursor);
    const rawLineEnd = newlineIndex === -1 ? source.length : newlineIndex;
    const lineEnd = rawLineEnd > cursor && source[rawLineEnd - 1] === "\r" ? rawLineEnd - 1 : rawLineEnd;
    const line = source.slice(cursor, lineEnd);
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      if (newlineIndex === -1) return { status: "unrecognized-header" };
      cursor = newlineIndex + 1;
      continue;
    }

    const match = /^(\s*nui\s+)(\d+)(\s*(?:#.*)?)$/.exec(line);
    if (!match) return { status: "unrecognized-header" };

    const currentMajor = Number(match[2]);
    if (currentMajor === targetMajor) return { status: "already-target" };

    const digitStart = cursor + match[1].length;
    const digitEnd = digitStart + match[2].length;
    return { status: "ready", splice: { from: digitStart, to: digitEnd, insert: String(targetMajor) } };
  }
  return { status: "unrecognized-header" };
};
