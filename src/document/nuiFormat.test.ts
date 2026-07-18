import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "../dsl/dslDocument";
import { isLegacyV1NuiDocument, nuiMajorVersionFromRawSource, unsupportedNuiMajorVersion } from "./nuiVersion";

describe(".nui version boundary", () => {
  it("classifies a leading major directly from raw source before compilation", () => {
    expect(unsupportedNuiMajorVersion("nui 3\npoint A = coordinate(x: 0 y: 0)")).toBe(3);
    expect(unsupportedNuiMajorVersion("nui 0")).toBe(0);
    expect(unsupportedNuiMajorVersion("nui 2\npoint A = coordinate(x: 0 y: 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui 1\npoint A = (0, 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui abc")).toBeNull();
    expect(unsupportedNuiMajorVersion("point A = (0, 0)")).toBeNull();
    expect(nuiMajorVersionFromRawSource("\uFEFF# comment\r\nnui 1\r\npoint A = (0, 0)")).toBe(1);
    expect(isLegacyV1NuiDocument("nui 1\npoint A = (0, 0)")).toBe(true);
    expect(isLegacyV1NuiDocument("nui 1.5\npoint A = (0, 0)")).toBe(false);
  });

  it("keeps steps: in ordinary .nui serialization so parameter editing survives reload", () => {
    const compiled = compileDslDocument("nui 2\npoint A = coordinate(x: 0 y: 0 steps: [x: 5])");
    expect(compiled.document).not.toBeNull();

    const text = serializeDocumentToDsl(compiled.document!);
    const reloaded = compileDslDocument(text);
    expect(text).toContain("steps: [x: 5]");
    expect(reloaded.document?.elements[0].numericParameterSteps).toEqual({ x: 5 });
  });
});
