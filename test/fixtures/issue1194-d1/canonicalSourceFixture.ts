import { expect } from "vitest";
import canonicalSources from "./canonical-sources.json";

type SourceBundle = { source: string; saved?: Record<string, string> };
type CanonicalSourceBundle = SourceBundle & { sha256: string };

const sources: Readonly<Record<string, CanonicalSourceBundle | undefined>> = canonicalSources;

/** Keeps the historical fixture and its freeze available for exact comparison.
 * Executable regression inputs have a separately sealed source spelling. */
export const canonicalSourceFixture = <T extends SourceBundle>(
  historical: T,
  bundleHash: (fixture: T) => string
): T => {
  const canonical = sources[bundleHash(historical)];
  if (!canonical) return historical;
  const { source, saved, sha256 } = canonical;
  const fixture = { ...historical, source, ...(saved ? { saved } : {}) };
  expect(Object.keys(fixture.saved ?? {}).sort()).toEqual(Object.keys(historical.saved ?? {}).sort());
  expect(bundleHash(fixture)).toBe(sha256);
  return fixture;
};
