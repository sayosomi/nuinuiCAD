import { scanDslSource } from "../dsl/dslTokens";
import { isSupportedDslMajorVersion } from "../dsl/dslVersion";

const versionFromRawSource = (source: string): number | null => {
  const lines = scanDslSource(source.replace(/^\uFEFF/, "")).lines;
  for (const line of lines) {
    const trimmed = line.code.trim();
    if (!trimmed) continue;
    const match = /^nui\s+(\d+)\s*$/.exec(trimmed);
    return match ? Number(match[1]) : null;
  }
  return null;
};

/**
 * Reads only a well-formed leading `nui <major>` line from raw source text.
 */
export const nuiMajorVersionFromRawSource = (source: string) => versionFromRawSource(source);

/** Returns every header other than a centrally supported major for fail-closed file opening. */
export const unsupportedNuiMajorVersion = (source: string) => {
  const major = nuiMajorVersionFromRawSource(source);
  if (major === null) return "missing";
  return isSupportedDslMajorVersion(major) ? null : major;
};
