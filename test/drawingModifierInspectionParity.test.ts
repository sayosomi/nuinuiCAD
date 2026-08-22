import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { effectiveDrawingModifierResolutionsFromResult } from "../src/model/drawingModifierInspection";
import {
  evaluateWithRustFixture,
  isRustEligibleFixture,
  normalizeParityPayload,
  optionsFor,
  readParityFixture
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runRustParity = import.meta.env.VITE_RUN_RUST_PARITY === "1";

describe.skipIf(!runRustParity)("Drawing Modifier inspection Rust parity", () => {
  it("emits the same selected-profile winner metadata from TS and Rust", () => {
    const fixture = readParityFixture(repoRoot, "nui4-drawing-modifier-profiles.nui");
    const profile = fixture.compiled?.doc.document.drawingProfiles?.find(
      (candidate) => candidate.name === "Print"
    );
    if (!profile) throw new Error("Print Drawing Profile was not compiled");
    const styled = fixture.elements.find((element) => element.name === "Styled");
    if (!styled) throw new Error("Styled element was not compiled");

    const options = optionsFor(fixture, profile.id);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture, profile.id);

    expect(isRustEligibleFixture(fixture, profile.id)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const tsResolution = effectiveDrawingModifierResolutionsFromResult(
      evaluationPayloadToResult(tsPayload)
    ).get(styled.id);
    const rustResolution = effectiveDrawingModifierResolutionsFromResult(
      evaluationPayloadToResult(rustPayload)
    ).get(styled.id);

    expect(tsResolution).toBeDefined();
    expect(rustResolution).toEqual(tsResolution);
    expect(tsResolution?.widthPx.value).toBe(0.5);
    expect(tsResolution?.widthPx.winner).toEqual(expect.objectContaining({
      ownerElementId: styled.id,
      selectedProfileDelta: {
        profileId: profile.id,
        profileName: "Print"
      }
    }));
  }, 30000);
});
