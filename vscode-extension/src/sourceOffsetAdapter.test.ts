import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }
  return { Position, Range };
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}, { virtual: true });

import * as vscode from "vscode";
import {
  createVscodeRangeForNormalized,
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  rawOffsetFromNormalized,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

describe("VS Code source offset adapter", () => {
  it.each([
    { raw: "", normalized: "", boundaries: [0] },
    { raw: "\nA\n", normalized: "\nA\n", boundaries: [0, 1, 2, 3] },
    { raw: "\r\n\r\nA\r\n", normalized: "\n\nA\n", boundaries: [0, 2, 4, 5, 7] },
    { raw: "A\rB\r", normalized: "A\rB\r", boundaries: [0, 1, 2, 3, 4] },
    {
      raw: "é😀\r\n雪\rX\n\r\r\nZ",
      normalized: "é😀\n雪\rX\n\r\nZ",
      boundaries: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13]
    }
  ])("preserves UTF-16 boundaries for $raw", ({ raw, normalized, boundaries }) => {
    expect(normalizedSourceFor(raw)).toBe(normalized);
    const document = {
      positionAt: (offset: number) => new vscode.Position(0, offset)
    } as vscode.TextDocument;
    const rangeFor = createVscodeRangeForNormalized(document, raw);
    const cases = [
      ...boundaries.map((rawOffset, offset) => ({ offset, rawOffset })),
      { offset: -Infinity, rawOffset: 0 },
      { offset: -1, rawOffset: 0 },
      { offset: NaN, rawOffset: 0 },
      { offset: 0.25, rawOffset: boundaries[1] ?? 0 },
      { offset: normalized.length + 1, rawOffset: raw.length },
      { offset: Infinity, rawOffset: raw.length }
    ];
    for (const { offset, rawOffset } of cases) {
      const range = { from: offset, to: offset };
      const expected = new vscode.Range(new vscode.Position(0, rawOffset), new vscode.Position(0, rawOffset));
      expect(rawOffsetFromNormalized(raw, offset)).toBe(rawOffset);
      expect(vscodeRangeForNormalized(document, raw, range)).toEqual(expected);
      expect(rangeFor(range)).toEqual(expected);
    }
    for (let offset = 0; offset <= raw.length; offset += 1) {
      expect(normalizedOffsetFromRaw(raw, offset)).toBe(
        boundaries.filter((boundary) => boundary <= offset).length - 1
      );
    }
  });

  it("normalizes CRLF offsets in both directions", () => {
    const raw = "nui 1\r\npoint A\r\npoint B";
    expect(normalizedSourceFor(raw)).toBe("nui 1\npoint A\npoint B");
    expect(normalizedOffsetFromRaw(raw, raw.indexOf("point B"))).toBe(
      normalizedSourceFor(raw).indexOf("point B")
    );
    expect(rawOffsetFromNormalized(raw, normalizedSourceFor(raw).indexOf("point B"))).toBe(
      raw.indexOf("point B")
    );
  });

  it("projects a normalized range back to the raw VS Code document", () => {
    const raw = "nui 1\r\npoint A";
    const document = {
      positionAt: (offset: number) => new vscode.Position(
        offset >= raw.indexOf("point A") ? 1 : 0,
        offset >= raw.indexOf("point A") ? offset - raw.indexOf("point A") : offset
      )
    } as unknown as vscode.TextDocument;
    const from = normalizedSourceFor(raw).indexOf("A");
    const range = vscodeRangeForNormalized(document, raw, { from, to: from + 1 });
    expect(range).toMatchObject({
      start: { line: 1, character: "point ".length },
      end: { line: 1, character: "point A".length }
    });
  });
});
