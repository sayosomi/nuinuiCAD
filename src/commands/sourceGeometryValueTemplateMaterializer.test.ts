import { describe, expect, it } from "vitest";
import {
  sourceGeometryValueTemplateGroups
} from "./sourceGeometryValueTemplateCatalog";
import { materializeSourceGeometryValueTemplate } from "./sourceGeometryValueTemplateMaterializer";

const planFor = (groupId: "point" | "line" | "path", construction: string) => {
  const plan = sourceGeometryValueTemplateGroups()
    .find(({ id }) => id === groupId)!.plans
    .find((candidate) => candidate.construction === construction);
  expect(plan).toBeDefined();
  return plan!;
};

const sourceFor = (groupId: "point" | "line" | "path", construction: string, formIndex = 0) => {
  const plan = planFor(groupId, construction);
  const materialization = materializeSourceGeometryValueTemplate(plan, plan.forms[formIndex]!);
  expect(materialization).not.toBeNull();
  return materialization!;
};

const holeNamesFor = (materialization: ReturnType<typeof sourceFor>): string[] =>
  materialization.parts.flatMap((part) => {
    if (part.kind !== "hole") return [];
    return [part.hole.role === "name" ? "name" : part.hole.argName];
  });

const textFor = (materialization: ReturnType<typeof sourceFor>): string =>
  materialization.parts.map((part) => part.kind === "text" ? part.text : "<hole>").join("");

describe("Geometry Value template materializer", () => {
  it("materializes a typed Point const with name first and ordered argument holes", () => {
    const materialization = sourceFor("point", "coordinate");

    expect(holeNamesFor(materialization)).toEqual(["name", "x", "y"]);
    expect(textFor(materialization)).toBe([
      "const <hole>: point = coordinate(",
      "  x: <hole>,",
      "  y: <hole>",
      ")"
    ].join("\n"));
  });

  it("materializes a typed Line const without drawable declaration metadata", () => {
    const materialization = sourceFor("line", "segment");

    expect(holeNamesFor(materialization)).toEqual(["name", "start", "end"]);
    expect(textFor(materialization)).toContain("const <hole>: line = segment(");
    expect(textFor(materialization)).not.toContain("line <hole> =");
    expect(textFor(materialization)).not.toContain("from(");
  });

  it("materializes a typed Path const and selected exclusive form only", () => {
    const materialization = sourceFor("path", "offset");

    expect(holeNamesFor(materialization)).toEqual([
      "name", "sources", "distance", "side", "closed", "suppressTrimWarnings"
    ]);
    expect(textFor(materialization)).toContain("const <hole>: path = offset(");
    expect(textFor(materialization)).not.toContain("id:");
  });

  it("omits the unselected exclusive member while retaining registry position", () => {
    const materialization = sourceFor("point", "between", 1);

    expect(holeNamesFor(materialization)).toEqual(["name", "start", "end", "ratio"]);
    expect(textFor(materialization)).toContain("  ratio: <hole>");
    expect(textFor(materialization)).not.toContain("distance:");
  });
});
