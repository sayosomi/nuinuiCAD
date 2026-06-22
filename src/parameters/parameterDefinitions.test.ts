import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { getParameterDefinitions } from "./parameterDefinitions";

describe("parameterDefinitions", () => {
  it("defines editable parameters for intersection points", () => {
    const point: CadElement = {
      id: "intersection",
      name: "交点",
      type: "intersectionPoint",
      visible: true,
      enabled: true,
      line1Id: "line-a",
      line2Id: "line-b",
      intersectionIndex: 0,
      useExtensions: false
    };

    expect(getParameterDefinitions(point)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "line1Id", directKey: "1", label: "線1", kind: "lineReference" }),
        expect.objectContaining({ key: "line2Id", directKey: "2", label: "線2", kind: "lineReference" }),
        expect.objectContaining({ key: "intersectionIndex", directKey: "i", label: "番号", kind: "number" }),
        expect.objectContaining({ key: "useExtensions", directKey: "x", label: "延長", kind: "boolean" })
      ])
    );
  });
});
