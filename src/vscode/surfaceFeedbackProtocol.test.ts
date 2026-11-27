import { describe, expect, it } from "vitest";
import {
  isVscodeSurfaceDiagnosticsPublication,
  isVscodeSurfaceOperationFailure
} from "./surfaceFeedbackProtocol";

describe("surface feedback protocol", () => {
  it("accepts complete surface identity and diagnostic data", () => {
    expect(isVscodeSurfaceDiagnosticsPublication({
      type: "surfaceDiagnosticsPublication",
      surface: "outputPreview",
      documentVersion: 4,
      presentationId: 8,
      graphAuthority: {
        hostDocumentUri: "file:///pattern.nui",
        documentVersion: 4,
        graphRevision: 12,
        rootSourceRevision: 3
      },
      outputIdentity: { outputKey: "print:A", kind: "print", outputId: "A", layoutId: "L" },
      diagnostics: [{ id: "negative-bounds", severity: "warning", message: "bounds", elementId: "A" }]
    })).toBe(true);
  });

  it("rejects incomplete, malformed, and wrongly typed publications", () => {
    expect(isVscodeSurfaceDiagnosticsPublication({
      type: "surfaceDiagnosticsPublication",
      surface: "canvas",
      documentVersion: 4,
      presentationId: 1,
      diagnostics: [{ id: "bad", severity: "fatal", message: "failure" }]
    })).toBe(false);
    expect(isVscodeSurfaceDiagnosticsPublication({
      type: "surfaceDiagnosticsPublication",
      surface: "outputPreview",
      documentVersion: 4,
      presentationId: 1,
      graphAuthority: { hostDocumentUri: "file:///pattern.nui", graphRevision: 1 },
      diagnostics: []
    })).toBe(false);
  });

  it("keeps operation failures identifiable across repeated equal messages", () => {
    const first = { type: "surfaceOperationFailure", eventId: 11, documentVersion: 2, message: "same reason" };
    const second = { ...first, eventId: 12 };
    expect(isVscodeSurfaceOperationFailure(first)).toBe(true);
    expect(isVscodeSurfaceOperationFailure(second)).toBe(true);
    expect(isVscodeSurfaceOperationFailure({ ...first, message: "" })).toBe(false);
  });
});
