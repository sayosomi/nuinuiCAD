import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { effectiveDrawingModifierResolutionsFromResult } from "../src/model/drawingModifierInspection";
import { isFillEligibleClosedPath } from "../src/geometry/linePaths";
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
  it("emits the same ordinary Style winner metadata from TS and Rust", () => {
    const fixture = readParityFixture(repoRoot, "nui1-drawing-modifier-cascade.nui");
    const styled = fixture.elements.find((element) => element.name === "Styled");
    if (!styled) throw new Error("Styled element was not compiled");

    const options = optionsFor(fixture);
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));

    const tsResolution = effectiveDrawingModifierResolutionsFromResult(
      evaluationPayloadToResult(tsPayload)
    ).get(styled.id);
    const rustResolution = effectiveDrawingModifierResolutionsFromResult(
      evaluationPayloadToResult(rustPayload)
    ).get(styled.id);

    expect(tsResolution).toBeDefined();
    expect(rustResolution).toEqual(tsResolution);
    expect(tsResolution?.widthPx).toEqual({
      value: 0.5,
      winner: { ownerElementId: styled.id, modifierName: "Guide" }
    });
  }, 30000);

  it("preserves zero width, winners, closed fill eligibility, and geometry in production Rust", () => {
    const fixture = readParityFixture(repoRoot, "nui1-style-zero-width.nui");
    const tsPayload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
    const rustPayload = evaluateWithRustFixture(repoRoot, fixture);
    const tsResult = evaluationPayloadToResult(tsPayload);
    const rustResult = evaluationPayloadToResult(rustPayload);
    const resolutions = effectiveDrawingModifierResolutionsFromResult(tsResult);
    const rustResolutions = effectiveDrawingModifierResolutionsFromResult(rustResult);
    const element = (name: string) => {
      const found = fixture.elements.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`missing fixture element ${name}`);
      return found;
    };
    const inherited = element("Inherited");
    const parent = element("Pattern");
    const zeroNoFill = element("UnfilledZero");
    const positive = element("PositiveWithFill");
    const laterPositive = element("LaterPositiveWins");
    const defaultWidth = element("DefaultWidth");

    expect(isRustEligibleFixture(fixture)).toBe(true);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    expect(resolutions.get(inherited.id)?.widthPx).toEqual({
      value: 0,
      winner: { ownerElementId: parent.id, modifierName: "FillOnly" }
    });
    expect(resolutions.get(zeroNoFill.id)?.widthPx).toEqual({
      value: 0,
      winner: { ownerElementId: zeroNoFill.id, modifierName: "PlainZero" }
    });
    expect(resolutions.get(positive.id)?.widthPx).toEqual({
      value: 1.5,
      winner: { ownerElementId: positive.id, modifierName: "PositiveFill" }
    });
    expect(resolutions.get(laterPositive.id)?.widthPx).toEqual({
      value: 2.5,
      winner: { ownerElementId: laterPositive.id, modifierName: "Positive" }
    });
    expect(resolutions.get(defaultWidth.id)?.widthPx).toEqual({ value: 1, winner: null });
    expect(rustResolutions.get(inherited.id)?.widthPx).toEqual(resolutions.get(inherited.id)?.widthPx);
    expect(rustResolutions.get(defaultWidth.id)?.widthPx).toEqual({ value: 1, winner: null });

    for (const name of ["Joined", "Poly", "Offset"]) {
      const path = element(name);
      expect(tsResult.computedGeometry.has(path.id)).toBe(true);
      expect(tsResult.effectiveVisibleElementIds).toContain(path.id);
      expect(tsResult.effectiveEnabledElementIds).toContain(path.id);
      expect(rustResult.computedGeometry.has(path.id)).toBe(true);
    }
    expect(isFillEligibleClosedPath(tsResult.computedGeometry.get(element("Joined").id))).toBe(true);
    expect(isFillEligibleClosedPath(tsResult.computedGeometry.get(element("Poly").id))).toBe(true);
    expect(isFillEligibleClosedPath(tsResult.computedGeometry.get(element("Offset").id))).toBe(true);
    expect(isFillEligibleClosedPath(tsResult.computedGeometry.get(element("Open").id))).toBe(false);
    expect(tsResult.effectiveDrawingModifierResolutions?.get(zeroNoFill.id)?.fill.value).toEqual({ kind: "none" });
    expect(tsResult.effectiveDrawingModifierResolutions?.get(positive.id)?.fillOpacity.value).toBe(0.5);
  }, 30000);
});
