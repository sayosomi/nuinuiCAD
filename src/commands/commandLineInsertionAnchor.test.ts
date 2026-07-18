import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import {
  insertionAnchorForCommandLineCreation,
  resolveCommandLineInsertionAnchor
} from "./commandLineInsertionAnchor";

describe("command-line insertion anchors", () => {
  it("resolves a conditional group's anchor after its complete then/else structure", () => {
    const compiled = compileDslDocument([
      "nui 2",
      "if 分岐 (1) {",
      "  point A = coordinate(x: 0 y: 0)",
      "} else {",
      "  group 内側 {",
      "    point B = coordinate(x: 1 y: 1)",
      "  }",
      "}",
      "point C = coordinate(x: 2 y: 2)"
    ].join("\n"));
    const elements = compiled.document!.elements;
    const group = elements.find((element) => element.name === "分岐")!;

    expect(resolveCommandLineInsertionAnchor(
      insertionAnchorForCommandLineCreation(group.id),
      elements
    )).toBe(elements.findIndex((element) => element.name === "C"));
  });
});
