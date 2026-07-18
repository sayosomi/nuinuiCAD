import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "../dsl/dslDocument";
import { unsupportedNuiMajorVersion } from "./nuiVersion";

describe(".nui version boundary", () => {
  it("rejects only the same unsupported first major that document compilation reports", () => {
    expect(unsupportedNuiMajorVersion("nui 3\npoint A = coordinate(x: 0 y: 0)")).toBe(3);
    expect(unsupportedNuiMajorVersion("nui 2\npoint A = coordinate(x: 0 y: 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui abc")).toBeNull();
    expect(unsupportedNuiMajorVersion("point A = (0, 0)")).toBeNull();
    expect(unsupportedNuiMajorVersion("nui 2\nnui 1")).toBeNull();
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
