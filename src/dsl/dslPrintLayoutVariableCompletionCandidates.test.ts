import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { compileDslDocument } from "./dslDocument";
import {
  dslEnclosingPrintLayoutLine,
  dslPrintLayoutVariableCompletionOptions
} from "./dslPrintLayoutVariableCompletionCandidates";

const compile = (source: string) => {
  const compiled = compileDslDocument(source);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  const printLayoutIdsByLiveLine = new Map<number, string>();
  for (const [key, info] of compiled.statementMap!.byKey) {
    if (!key.startsWith("printLayout:")) continue;
    printLayoutIdsByLiveLine.set(info.line, key.slice("printLayout:".length));
  }
  return { printLayouts: compiled.document!.printLayouts, printLayoutIdsByLiveLine };
};

describe("dslEnclosingPrintLayoutLine", () => {
  it("resolves the block when the cursor is on the printLayout line itself", () => {
    const source = ["nui 1", "printLayout Layout1 columns=2 {", "  layoutVar Width = 10", "}"].join("\n");
    const parsed = parseDsl(source);
    expect(dslEnclosingPrintLayoutLine(parsed, 2)).toMatchObject({ line: 2 });
  });

  it("resolves the block when the cursor is on a place/layoutVar member line", () => {
    const source = ["nui 1", "printLayout Layout1 {", "  layoutVar Width = 10", "}"].join("\n");
    const parsed = parseDsl(source);
    expect(dslEnclosingPrintLayoutLine(parsed, 3)).toMatchObject({ line: 2 });
  });

  it("returns null when the cursor is outside any printLayout block", () => {
    const source = ["nui 1", "printLayout Layout1 {", "  layoutVar Width = 10", "}", "point A = (0, 0)"].join("\n");
    const parsed = parseDsl(source);
    expect(dslEnclosingPrintLayoutLine(parsed, 5)).toBeNull();
  });

  it("returns null when the cursor is inside a different block kind (group)", () => {
    const source = ["nui 1", "group Outer {", "  point A = (0, 0)", "}"].join("\n");
    const parsed = parseDsl(source);
    expect(dslEnclosingPrintLayoutLine(parsed, 3)).toBeNull();
  });
});

describe("dslPrintLayoutVariableCompletionOptions", () => {
  it("offers only strictly-earlier layoutVars to a later layoutVar's own expression", () => {
    const source = [
      "nui 1",
      "printLayout Layout1 {",
      "  layoutVar Width = 10",
      "  layoutVar Height = 20",
      "}"
    ].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(source);
    const parsed = parseDsl(source);
    const block = dslEnclosingPrintLayoutLine(parsed, 4)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: 4, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).toEqual(["@Width"]);
  });

  it("offers strictly-earlier layoutVars to a place's at=/angle= (own-line cutoff)", () => {
    const source = [
      "nui 1",
      "group G {",
      "  point A = (0, 0)",
      "}",
      "printLayout Layout1 {",
      "  layoutVar Width = 10",
      "  place G at=(0, 0) angle=0",
      "  layoutVar Height = 20",
      "}"
    ].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(source);
    const parsed = parseDsl(source);
    const block = dslEnclosingPrintLayoutLine(parsed, 7)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: 7, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).toEqual(["@Width"]);
    expect(labels).not.toContain("@Height");
  });

  it("offers every layoutVar in the block (including later ones) to the printLayout's own attrs", () => {
    const source = [
      "nui 1",
      "printLayout Layout1 columns=2 {",
      "  layoutVar Width = 10",
      "  layoutVar Height = 20",
      "}"
    ].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(source);
    const parsed = parseDsl(source);
    const block = dslEnclosingPrintLayoutLine(parsed, 2)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: Infinity, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).toEqual(["@Height", "@Width"]);
  });

  it("never leaks a layoutVar from a different printLayout block", () => {
    const source = [
      "nui 1",
      "printLayout Layout1 {",
      "  layoutVar Width = 10",
      "}",
      "printLayout Layout2 {",
      "  layoutVar Other = 5",
      "}"
    ].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(source);
    const parsed = parseDsl(source);
    const block = dslEnclosingPrintLayoutLine(parsed, 5)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: Infinity, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).not.toContain("@Width");
  });

  it("suppresses a candidate entirely when its name is ambiguous in the committed pool (never guesses an id)", () => {
    // dslCompiler.ts's normalizeExpression closure for printLayout numeric()
    // never passes currentElement, so duplicate layoutVar names are never
    // rejected as a parse/compile error — the compiler silently resolves to
    // whichever declaration is processed first. Any candidate here must be
    // suppressed rather than risk pointing at the wrong one.
    const source = [
      "nui 1",
      "printLayout Layout1 {",
      "  layoutVar Width = 10",
      "  layoutVar Width = 20",
      "  layoutVar Height = 5",
      "}"
    ].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(source);
    const parsed = parseDsl(source);
    const block = dslEnclosingPrintLayoutLine(parsed, 2)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: Infinity, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).not.toContain("@Width");
    expect(labels).toContain("@Height");
  });

  it("returns [] for a never-compiled block (no stable ids to correlate against)", () => {
    const compiledSource = ["nui 1", "point A = (0, 0)"].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(compiledSource);
    const liveSource = ["nui 1", "printLayout Layout1 {", "  layoutVar Width = 10", "}", "point A = (0, 0)"].join("\n");
    const parsed = parseDsl(liveSource);
    const block = dslEnclosingPrintLayoutLine(parsed, 2)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: Infinity, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).toEqual([]);
  });

  it("excludes a layoutVar with a syntactically unparseable expression", () => {
    const source = [
      "nui 1",
      "printLayout Layout1 {",
      "  layoutVar Broken = )))",
      "  layoutVar Height = 20",
      "}"
    ].join("\n");
    const { printLayouts, printLayoutIdsByLiveLine } = compile(source);
    const parsed = parseDsl(source);
    const block = dslEnclosingPrintLayoutLine(parsed, 2)!;
    const labels = dslPrintLayoutVariableCompletionOptions({
      parsed, block, cutoffLine: Infinity, printLayoutIdsByLiveLine, printLayouts
    }).map((option) => option.label);
    expect(labels).not.toContain("@Broken");
    expect(labels).toContain("@Height");
  });
});
