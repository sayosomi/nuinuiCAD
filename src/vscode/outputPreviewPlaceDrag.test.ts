import { describe, expect, it } from "vitest";
import type { OutputPlaceProjection } from "../output/outputPlaceProjection";
import {
  beginOutputPreviewPlaceDrag,
  outputPreviewPlaceCoordinatePatchesFor,
  outputPreviewPlaceDragCoordinatesFor,
  outputPreviewPlaceDragProofIsCurrent,
  outputPreviewPlacePreviewSourceFor
} from "./outputPreviewPlaceDrag";

const source = "layout Layout\n  place @Group at: (10, 20)\n";
const xFrom = source.indexOf("10");
const yFrom = source.indexOf("20");

const projection = (): OutputPlaceProjection => ({
  placeId: "place-1",
  sourceRevision: 7,
  layoutId: "layout-1",
  layoutName: "Layout",
  groupId: "group-1",
  groupName: "Group",
  transformedOrigin: { x: 10, y: 20 },
  drawables: [],
  statementRange: { from: source.indexOf("place"), to: source.length - 1 },
  authored: {
    group: {
      text: "@Group",
      sourceSpan: null,
      references: [],
      targetRange: null
    },
    at: {
      text: "(10, 20)",
      sourceSpan: {
        sourceRevision: 7,
        segments: [{ from: source.indexOf("("), to: source.indexOf(")") + 1 }]
      },
      references: [],
      x: {
        text: "10",
        sourceSpan: { sourceRevision: 7, segments: [{ from: xFrom, to: xFrom + 2 }] },
        references: []
      },
      y: {
        text: "20",
        sourceSpan: { sourceRevision: 7, segments: [{ from: yFrom, to: yFrom + 2 }] },
        references: []
      }
    }
  },
  dragability: { draggable: true, literals: { x: 10, y: 20 } }
});

const plan = { kind: "print" as const, outputId: "print-1", layoutId: "layout-1" };

const begin = (overrides: Partial<Parameters<typeof beginOutputPreviewPlaceDrag>[0]> = {}) =>
  beginOutputPreviewPlaceDrag({
    projection: projection(),
    normalizedSource: source,
    currentSourceRevision: 7,
    documentVersion: 12,
    plan,
    ...overrides
  });

describe("Output Preview place drag proof", () => {
  it("captures exact current source, host version, plan identity, and literal spans", () => {
    const proof = begin();
    expect(proof).toMatchObject({
      placeId: "place-1",
      documentVersion: 12,
      sourceRevision: 7,
      normalizedSourceSnapshot: source,
      planIdentity: "print:print-1:layout-1",
      x: { range: { from: xFrom, to: xFrom + 2 }, sourceText: "10", literal: 10 },
      y: { range: { from: yFrom, to: yFrom + 2 }, sourceText: "20", literal: 20 }
    });
  });

  it("fails closed for stale revision, plan, host version, or changed exact source", () => {
    expect(begin({ currentSourceRevision: 8 })).toBeNull();
    expect(begin({ documentVersion: null })).toBeNull();
    expect(begin({ plan: { kind: "print", outputId: "print-1", layoutId: "other" } })).toBeNull();
    expect(begin({ normalizedSource: source.replace("10", "11") })).toBeNull();
  });

  it("revalidates host/source/plan identity before preview or commit", () => {
    const proof = begin();
    expect(proof).not.toBeNull();
    if (!proof) return;

    expect(outputPreviewPlaceDragProofIsCurrent({
      proof,
      normalizedSource: source,
      currentSourceRevision: 7,
      documentVersion: 12,
      plan
    })).toBe(true);
    expect(outputPreviewPlaceDragProofIsCurrent({
      proof,
      normalizedSource: source.replace("20", "21"),
      currentSourceRevision: 7,
      documentVersion: 12,
      plan
    })).toBe(false);
    expect(outputPreviewPlaceDragProofIsCurrent({
      proof,
      normalizedSource: source,
      currentSourceRevision: 8,
      documentVersion: 12,
      plan
    })).toBe(false);
    expect(outputPreviewPlaceDragProofIsCurrent({
      proof,
      normalizedSource: source,
      currentSourceRevision: 7,
      documentVersion: 13,
      plan
    })).toBe(false);
    expect(outputPreviewPlaceDragProofIsCurrent({
      proof,
      normalizedSource: source,
      currentSourceRevision: 7,
      documentVersion: 12,
      plan: { ...plan, outputId: "print-2" }
    })).toBe(false);
  });

  it("reuses Canvas world-delta X/Y lock semantics", () => {
    const proof = begin();
    expect(proof).not.toBeNull();
    if (!proof) return;

    expect(outputPreviewPlaceDragCoordinatesFor({
      proof,
      screenDx: 20,
      screenDy: -10,
      zoom: 2,
      axisLockKeys: { x: false, y: false }
    })).toEqual({ x: 20, y: 25 });
    expect(outputPreviewPlaceDragCoordinatesFor({
      proof,
      screenDx: 20,
      screenDy: -10,
      zoom: 2,
      axisLockKeys: { x: true, y: false }
    })).toEqual({ x: 20, y: 20 });
    expect(outputPreviewPlaceDragCoordinatesFor({
      proof,
      screenDx: 20,
      screenDy: -10,
      zoom: 2,
      axisLockKeys: { x: false, y: true }
    })).toEqual({ x: 10, y: 25 });
  });

  it("creates transient source and exact coordinate patches without mutating the snapshot", () => {
    const proof = begin();
    expect(proof).not.toBeNull();
    if (!proof) return;

    const coordinates = { x: 15.5, y: -4 };
    expect(outputPreviewPlaceCoordinatePatchesFor(proof, coordinates)).toEqual([
      { range: { from: xFrom, to: xFrom + 2 }, expectedText: "10", replacement: "15.5" },
      { range: { from: yFrom, to: yFrom + 2 }, expectedText: "20", replacement: "-4" }
    ]);
    expect(outputPreviewPlacePreviewSourceFor(proof, coordinates)).toBe(
      source.replace("10, 20", "15.5, -4")
    );
    expect(proof.normalizedSourceSnapshot).toBe(source);
  });

  it("does not rewrite an unchanged or locked coordinate spelling", () => {
    const proof = begin();
    expect(proof).not.toBeNull();
    if (!proof) return;

    expect(outputPreviewPlaceCoordinatePatchesFor(proof, { x: 10, y: 25 })).toEqual([
      { range: { from: yFrom, to: yFrom + 2 }, expectedText: "20", replacement: "25" }
    ]);
    expect(outputPreviewPlaceCoordinatePatchesFor(proof, { x: 10, y: 20 })).toEqual([]);
    expect(outputPreviewPlacePreviewSourceFor(proof, { x: 10, y: 20 })).toBe(source);
  });
});
