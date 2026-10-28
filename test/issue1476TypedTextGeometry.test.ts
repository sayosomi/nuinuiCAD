import { expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { optionsFor, readParityFixture } from "./evaluationParitySupport";

it("#1476 R6 typed boolean text reads the available clockwise arc property", () => {
  const fixture = readParityFixture(process.cwd(), "nui1-choice-geometry-properties.nui");
  const payload = evaluateElementsReferencePayload(fixture.elements, optionsFor(fixture));
  expect(payload.computedScalarBindings?.map(entry => entry.evaluation.status === "ok" ? entry.evaluation.value.value : null))
    .toEqual(["clockwise", true, "clockwise"]);
  expect(payload.errors).toEqual([]);
  expect(payload.computedGeometry).toHaveLength(7);
  expect(payload.computedGeometry.find(g => g.name === "Note")).toMatchObject({
    kind: "text", text: "clockwise=true", anchor: null, fontSize: 3
  });
});
