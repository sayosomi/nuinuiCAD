import { describe, expect, it } from "vitest";
import {
  damerauLevenshteinDistance,
  dslTypoDistanceLimit,
  matchDslTypoCandidate,
  rankDslTypoCandidates
} from "./dslTypoMatcher";

describe("dslTypoMatcher", () => {
  it("counts insertion, deletion, substitution, and adjacent transposition as one edit", () => {
    expect(damerauLevenshteinDistance("side", "sidde")).toBe(1);
    expect(damerauLevenshteinDistance("sidde", "side")).toBe(1);
    expect(damerauLevenshteinDistance("side", "sixe")).toBe(1);
    expect(damerauLevenshteinDistance("roumd", "round")).toBe(1);
  });

  it("uses Unicode code points instead of UTF-16 code units", () => {
    expect(damerauLevenshteinDistance("😀a", "😀b")).toBe(1);
    expect(dslTypoDistanceLimit("😀a", "😀ab")).toBe(1);
    expect(matchDslTypoCandidate("😀a", "😀ab")?.distance).toBe(1);
  });

  it("suppresses fuzzy matches for one- and two-code-point names", () => {
    expect(matchDslTypoCandidate("a", "b")).toBeNull();
    expect(matchDslTypoCandidate("ab", "ac")).toBeNull();
  });

  it("allows case-only canonicalization even for short names", () => {
    expect(matchDslTypoCandidate("A", "a")).toMatchObject({ candidate: "a", distance: 1, caseOnly: true });
    expect(matchDslTypoCandidate("AB", "ab")).toMatchObject({ candidate: "ab", distance: 2, caseOnly: true });
  });

  it("enforces the 3-4 / 5-8 / 9+ distance thresholds", () => {
    expect(matchDslTypoCandidate("abcd", "abce")).not.toBeNull();
    expect(matchDslTypoCandidate("abcd", "abXY")).toBeNull();
    expect(matchDslTypoCandidate("abcdefgh", "abXXefgh")).not.toBeNull();
    expect(matchDslTypoCandidate("abcdefgh", "abXXXfgh")).toBeNull();
    expect(matchDslTypoCandidate("abcdefghi", "abcXXXghi")).not.toBeNull();
    expect(matchDslTypoCandidate("abcdefghi", "abXXXXghi")).toBeNull();
  });

  it("returns all eligible candidates ordered by distance and stable source order", () => {
    expect(rankDslTypoCandidates("abcde", ["abXYe", "abXde", "abcXe", "aXYde"]))
      .toEqual([
        { candidate: "abXde", distance: 1, sourceIndex: 1, caseOnly: false },
        { candidate: "abcXe", distance: 1, sourceIndex: 2, caseOnly: false },
        { candidate: "abXYe", distance: 2, sourceIndex: 0, caseOnly: false },
        { candidate: "aXYde", distance: 2, sourceIndex: 3, caseOnly: false }
      ]);
  });
});
