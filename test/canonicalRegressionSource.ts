import { createHash } from "node:crypto";
import { expect } from "vitest";
import sealedSources from "./fixtures/canonical-regression-sources.json";

const fingerprint = (source: string) => createHash("sha256").update(source).digest("hex");
const sources: Readonly<Record<string, { source: string; sha256: string } | undefined>> = sealedSources;

/** Returns the separately sealed current spelling of an archived regression. */
export const canonicalRegressionSource = (archived: string): string => {
  const canonical = sources[fingerprint(archived)];
  if (!canonical) return archived;
  expect(fingerprint(canonical.source)).toBe(canonical.sha256);
  return canonical.source;
};

export const canonicalRegressionFiles = (archived: Record<string, string>) => Object.fromEntries(
  Object.entries(archived).map(([file, source]) => [file, canonicalRegressionSource(source)])
);

/** Projects a fixed UTF-16 oracle through a source change limited to removed reference markers. */
export const canonicalRegressionRanges = <T extends { from: number; to: number }>(
  archived: string,
  ranges: readonly T[]
): T[] => {
  const current = canonicalRegressionSource(archived);
  const removed: number[] = [];
  let currentOffset = 0;
  for (let archivedOffset = 0; archivedOffset < archived.length; archivedOffset++) {
    if (archived[archivedOffset] === current[currentOffset]) {
      currentOffset++;
    } else {
      expect(archived[archivedOffset]).toBe("@");
      removed.push(archivedOffset);
    }
  }
  expect(currentOffset).toBe(current.length);
  const project = (offset: number) => offset - removed.filter(marker => marker < offset).length;
  return ranges.map(range => {
    const projected = { ...range, from: project(range.from), to: project(range.to) };
    expect(current.slice(projected.from, projected.to)).toBe(archived.slice(range.from, range.to));
    return projected;
  });
};
