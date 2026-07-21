import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "../dsl/dslDocument";
import {
  buildNuiMajorVersionSplice,
  isLegacyV1NuiDocument,
  nuiMajorVersionFromRawSource,
  unsupportedNuiMajorVersion
} from "./nuiVersion";

describe(".nui version boundary", () => {
  it("classifies a leading major directly from raw source before compilation", () => {
    expect(unsupportedNuiMajorVersion("nui 3\npoint A = coordinate(x: 0 y: 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui 4\npoint A = coordinate(x: 0 y: 0)")).toBe(4);
    expect(unsupportedNuiMajorVersion("nui 0")).toBe(0);
    expect(unsupportedNuiMajorVersion("nui 2\npoint A = coordinate(x: 0 y: 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui 1\npoint A = (0, 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui abc")).toBeNull();
    expect(unsupportedNuiMajorVersion("point A = (0, 0)")).toBeNull();
    expect(nuiMajorVersionFromRawSource("\uFEFF# comment\r\nnui 1\r\npoint A = (0, 0)")).toBe(1);
    expect(isLegacyV1NuiDocument("nui 1\npoint A = (0, 0)")).toBe(true);
    expect(isLegacyV1NuiDocument("nui 1.5\npoint A = (0, 0)")).toBe(false);
  });

  it("splices only the header's digit run for an LF document, byte-identical elsewhere", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0)";
    const result = buildNuiMajorVersionSplice(source, 3);
    expect(result).toEqual({ status: "ready", splice: { from: 4, to: 5, insert: "3" } });
    if (result.status !== "ready") throw new Error("expected ready");
    const { from, to, insert } = result.splice;
    const spliced = source.slice(0, from) + insert + source.slice(to);
    expect(spliced).toBe("nui 3\npoint A = coordinate(x: 0 y: 0)");
    // Body byte-identical: same length, only the header line's digit changed.
    expect(spliced.slice(source.indexOf("\n"))).toBe(source.slice(source.indexOf("\n")));
  });

  it("splices only the header's digit run for a CRLF document, preserving every \\r\\n", () => {
    const source = "nui 2\r\npoint A = coordinate(x: 0 y: 0)\r\nline L = segment(start: A end: A)";
    const result = buildNuiMajorVersionSplice(source, 3);
    expect(result).toEqual({ status: "ready", splice: { from: 4, to: 5, insert: "3" } });
    if (result.status !== "ready") throw new Error("expected ready");
    const { from, to, insert } = result.splice;
    const spliced = source.slice(0, from) + insert + source.slice(to);
    expect(spliced).toBe("nui 3\r\npoint A = coordinate(x: 0 y: 0)\r\nline L = segment(start: A end: A)");
    expect(spliced.match(/\r\n/g)?.length).toBe(source.match(/\r\n/g)?.length);
  });

  it("splices a header that is also the last line with no trailing newline", () => {
    const source = "nui 2";
    const result = buildNuiMajorVersionSplice(source, 3);
    expect(result).toEqual({ status: "ready", splice: { from: 4, to: 5, insert: "3" } });
    if (result.status !== "ready") throw new Error("expected ready");
    const { from, to, insert } = result.splice;
    expect(source.slice(0, from) + insert + source.slice(to)).toBe("nui 3");
  });

  it("splices past a BOM and a leading comment without touching either", () => {
    const source = "\uFEFF# comment\r\nnui 2\r\npoint A = coordinate(x: 0 y: 0)";
    const result = buildNuiMajorVersionSplice(source, 3);
    expect(result).toEqual({ status: "ready", splice: { from: 16, to: 17, insert: "3" } });
    if (result.status !== "ready") throw new Error("expected ready");
    const { from, to, insert } = result.splice;
    const spliced = source.slice(0, from) + insert + source.slice(to);
    expect(spliced).toBe("\uFEFF# comment\r\nnui 3\r\npoint A = coordinate(x: 0 y: 0)");
    expect(spliced.charCodeAt(0)).toBe(0xfeff);
    expect(spliced).toContain("# comment\r\n");
  });

  it("is a no-op when the document is already at the target major", () => {
    expect(buildNuiMajorVersionSplice("nui 3\npoint A = coordinate(x: 0 y: 0)", 3)).toEqual({
      status: "already-target"
    });
  });

  it("reports an unrecognized header instead of guessing", () => {
    expect(buildNuiMajorVersionSplice("point A = coordinate(x: 0 y: 0)", 3)).toEqual({
      status: "unrecognized-header"
    });
    expect(buildNuiMajorVersionSplice("", 3)).toEqual({ status: "unrecognized-header" });
    expect(buildNuiMajorVersionSplice("# only a comment\n", 3)).toEqual({ status: "unrecognized-header" });
  });

  it("keeps steps: in ordinary .nui serialization so parameter editing survives reload", () => {
    const compiled = compileDslDocument("nui 2\npoint A = coordinate(x: 0 y: 0 steps: [x: 5])");
    expect(compiled.document).not.toBeNull();

    const text = serializeDocumentToDsl(compiled.document!, 2);
    const reloaded = compileDslDocument(text);
    expect(text).toContain("steps: [x: 5]");
    expect(reloaded.document?.elements[0].numericParameterSteps).toEqual({ x: 5 });
  });
});
