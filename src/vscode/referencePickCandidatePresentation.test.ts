import { describe, expect, it } from "vitest";
import type { ReferencePickCandidate, ReferencePickGeometryOption } from "../model/referencePickCandidates";
import { referencePickCandidatePresentationForHits } from "./referencePickCandidatePresentation";

const geometryOption = (
  base: string,
  pointKey?: string,
  occurrenceIndex?: number,
  label = `@${base}${occurrenceIndex === undefined ? "" : `[${occurrenceIndex}]`}${pointKey ? `.${pointKey}` : ""}`
): ReferencePickGeometryOption => ({
  kind: "geometry",
  label,
  reference: {
    base,
    ...(occurrenceIndex === undefined ? {} : { occurrenceIndex }),
    ...(pointKey === undefined ? {} : { pointKey })
  }
});

const candidate = (
  elementId: string,
  options: readonly ReferencePickGeometryOption[]
): ReferencePickCandidate => ({ elementId, actualGeometryInterface: "line", options });

const labels = (options: readonly { option: ReferencePickGeometryOption }[]) =>
  options.map(({ option }) => option.label);

describe("referencePickCandidatePresentationForHits", () => {
  it("prioritizes a generated occurrence and every available named stage, including nested user names", () => {
    const result = referencePickCandidatePresentationForHits([candidate("drawn-occurrence", [
      geometryOption("Mark"),
      geometryOption("Mark", "base"),
      geometryOption("Mark", "shifted"),
      geometryOption("Mark", "branch.second"),
      geometryOption("Mark", "second"),
      geometryOption("Mark", undefined, 1),
      geometryOption("Mark", "base", 1),
      geometryOption("Mark", "shifted", 1),
      geometryOption("Mark", "branch.second", 1),
      geometryOption("Mark", "second", 1)
    ])]);

    expect(labels(result.primary)).toEqual([
      "@Mark[1]",
      "@Mark[1].shifted",
      "@Mark[1].branch.second",
      "@Mark[1].second"
    ]);
    expect(labels(result.details)).toEqual([
      "@Mark[1].base",
      "@Mark",
      "@Mark.shifted",
      "@Mark.branch.second",
      "@Mark.second",
      "@Mark.base"
    ]);
    expect(result.primary.map(({ explanation }) => explanation)).toEqual([
      "individualOccurrence",
      "individualNamedStage",
      "individualNamedStage",
      "individualNamedStage"
    ]);
  });

  it("does not invent absent stages and keeps a single generated occurrence selectable", () => {
    const result = referencePickCandidatePresentationForHits([candidate("only-generated-owner", [
      geometryOption("Mark", undefined, 0),
      geometryOption("Mark", "base", 0),
      geometryOption("Mark"),
      geometryOption("Mark", "base")
    ])]);

    expect(labels(result.primary)).toEqual(["@Mark[0]"]);
    expect(labels(result.details)).toEqual(["@Mark[0].base", "@Mark", "@Mark.base"]);
    expect([...labels(result.primary), ...labels(result.details)]).not.toContain("@Mark.final");
  });

  it("keeps a non-generated root and named stages primary while detailing only base", () => {
    const result = referencePickCandidatePresentationForHits([candidate("authored-A", [
      geometryOption("A"),
      geometryOption("A", "base"),
      geometryOption("A", "second"),
      geometryOption("A", "branch.third")
    ])]);

    expect(labels(result.primary)).toEqual(["@A", "@A.second", "@A.branch.third"]);
    expect(labels(result.details)).toEqual(["@A.base"]);
    expect(result.primary.map(({ explanation }) => explanation)).toEqual([
      "sourceGeometry",
      "namedStage",
      "namedStage"
    ]);
    expect(result.details[0]?.explanation).toBe("baseGeometry");
  });

  it("deduplicates canonical options within one real hit but preserves equal references from overlapping owners", () => {
    const repeated = geometryOption("Mark", "branch.second", 1, "display label does not define identity");
    const first = candidate("real-hit-first", [
      geometryOption("Mark", undefined, 1),
      repeated,
      geometryOption("Mark", "branch.second", 1, "another label")
    ]);
    const second = candidate("real-hit-second", [
      geometryOption("Mark", undefined, 1),
      geometryOption("Mark", "branch.second", 1)
    ]);
    const result = referencePickCandidatePresentationForHits([second, first]);

    expect(result.primary.map(({ candidateElementId, option }) => [candidateElementId, option.label])).toEqual([
      ["real-hit-second", "@Mark[1]"],
      ["real-hit-second", "@Mark[1].branch.second"],
      ["real-hit-first", "@Mark[1]"],
      ["real-hit-first", "display label does not define identity"]
    ]);
    expect(result.details).toEqual([]);
  });
});
