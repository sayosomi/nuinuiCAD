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
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  rawOffsetFromNormalized,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

describe("VS Code source offset adapter", () => {
  it("normalizes CRLF offsets in both directions", () => {
    const raw = "nui 4\r\npoint A\r\npoint B";
    expect(normalizedSourceFor(raw)).toBe("nui 4\npoint A\npoint B");
    expect(normalizedOffsetFromRaw(raw, raw.indexOf("point B"))).toBe(
      normalizedSourceFor(raw).indexOf("point B")
    );
    expect(rawOffsetFromNormalized(raw, normalizedSourceFor(raw).indexOf("point B"))).toBe(
      raw.indexOf("point B")
    );
  });

  it("projects a normalized range back to the raw VS Code document", () => {
    const raw = "nui 4\r\npoint A";
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
