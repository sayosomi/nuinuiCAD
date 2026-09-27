import { describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";

describe("Module geometry carry source order lowering", () => {
  it("projects the original Module point carry onto the canonical integer order", () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 2, y: 3)",
      "  for i in range(min: 0, max: 0, step: 1) carry last: point = @P {",
      "    next last = @P",
      "    point Mark = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "instance A = M()"
    ].join("\n");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
    const carries = [...(compiled.doc.bindingVersions?.immutableForGroups?.values() ?? [])]
      .flatMap((plan) => plan.geometryCarries ?? []);

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(carries).toHaveLength(1);
    expect(carries[0]!.nextSourceOrder).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(carries[0]!.nextSourceOrder)).toBe(true);
  });
});
