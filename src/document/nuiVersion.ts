import { DSL_VERSION } from "../dsl/dslDocument";

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
 * This intentionally runs before the live v2 parser so v1 never reaches it.
 */
export const nuiMajorVersionFromRawSource = (source: string) => versionFromRawSource(source);

export const isLegacyV1NuiDocument = (source: string) =>
  nuiMajorVersionFromRawSource(source) === 1;

/** Returns only majors that the file-open boundary must reject before compilation. */
export const unsupportedNuiMajorVersion = (source: string) => {
  const major = nuiMajorVersionFromRawSource(source);
  return major === 0 || (major !== null && major > DSL_VERSION) ? major : null;
};
