import { describe, expect, it } from "vitest";
import { MUTATION_CATEGORY } from "../dsl/dslConstructions";
import {
  sourceCreationTemplatePlanForLegacyCommand,
  sourceCreationTemplatePlans,
  type SourceCreationTemplateArgumentHole,
  type SourceCreationTemplatePlan
} from "./sourceCreationTemplatePlan";
import {
  materializeSourceCreationTemplate,
  type SourceCreationTemplateMaterialization,
  type SourceCreationTemplatePart
} from "./sourceCreationTemplateMaterializer";

const planFor = (commandId: string): SourceCreationTemplatePlan => {
  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  expect(plan, commandId).not.toBeNull();
  return plan!;
};

const materializeFor = (commandId: string, formIndex = 0): SourceCreationTemplateMaterialization => {
  const materialization = materializeSourceCreationTemplate(planFor(commandId), formIndex);
  expect(materialization, `${commandId} form ${formIndex}`).not.toBeNull();
  return materialization!;
};

const render = (parts: readonly SourceCreationTemplatePart[]): string => parts.map((part) =>
  part.kind === "text"
    ? part.text
    : `<${part.hole.role === "name" ? "name" : part.hole.argName}>`
).join("");

const argumentHolesFor = (materialization: SourceCreationTemplateMaterialization) =>
  materialization.parts.flatMap((part) =>
    part.kind === "hole" && part.hole.role === "argument" ? [part.hole] : []
  );

const expectedArgumentHole = (
  argumentHole: SourceCreationTemplateArgumentHole
) => ({ role: "argument" as const, ...argumentHole });

describe("Source creation template materializer", () => {
  it("materializes addLine with the name, start, and end holes in order", () => {
    const materialization = materializeFor("addLine");

    expect(render(materialization.parts)).toBe([
      "line <name> = segment(",
      "  start: <start>,",
      "  end: <end>",
      ")"
    ].join("\n"));
    expect(materialization.parts.filter((part) => part.kind === "hole").map((part) =>
      part.hole.role === "name" ? "name" : part.hole.argName
    )).toEqual(["name", "start", "end"]);
  });

  it("copies argument-hole metadata directly from the selected planner form", () => {
    const plan = planFor("addLine");
    const materialization = materializeFor("addLine");

    expect(argumentHolesFor(materialization)).toEqual(
      plan.forms[0]!.argumentHoles.map(expectedArgumentHole)
    );
  });

  it("materializes between distance and ratio forms without adding defaults", () => {
    const distance = materializeFor("addDivisionPoint", 0);
    const ratio = materializeFor("addDivisionPoint", 1);

    expect(render(distance.parts)).toContain("distance: <distance>");
    expect(render(distance.parts)).not.toContain("ratio:");
    expect(render(ratio.parts)).toContain("ratio: <ratio>");
    expect(render(ratio.parts)).not.toContain("distance:");
    expect(render(distance.parts)).not.toMatch(/(?:none|true|false|\b1\b|\$\{?\d)/u);
  });

  it("materializes tangentOffset forms with only the selected member in canonical order", () => {
    const angle = materializeFor("addLineTangentOffsetPoint", 0);
    const curveSide = materializeFor("addLineTangentOffsetPoint", 1);

    expect(render(angle.parts)).toBe([
      "point <name> = tangentOffset(",
      "  line: <line>,",
      "  base: <base>,",
      "  angle: <angle>,",
      "  distance: <distance>",
      ")"
    ].join("\n"));
    expect(render(angle.parts)).not.toContain("curveSide:");
    expect(render(curveSide.parts)).toContain("  curveSide: <curveSide>,");
    expect(render(curveSide.parts)).not.toContain("angle:");
    expect(argumentHolesFor(curveSide).map(({ argName }) => argName)).toEqual([
      "line", "base", "curveSide", "distance"
    ]);
  });

  it("keeps commonTangent choice holes empty and preserves their metadata", () => {
    const materialization = materializeFor("addCommonTangentLine");

    expect(render(materialization.parts)).toBe([
      "line <name> = commonTangent(",
      "  first: <first>,",
      "  second: <second>,",
      "  kind: <kind>,",
      "  side: <side>",
      ")"
    ].join("\n"));
    expect(argumentHolesFor(materialization).filter(({ argName }) => ["kind", "side"].includes(argName))).toEqual([
      {
        role: "argument",
        argName: "kind",
        parameterKey: "kind",
        kind: "choice",
        label: "接線種別"
      },
      {
        role: "argument",
        argName: "side",
        parameterKey: "side",
        kind: "choice",
        label: "側"
      }
    ]);
  });

  it("preserves planner order for addCopyLine without introducing mirrorX", () => {
    const materialization = materializeFor("addCopyLine");

    expect(argumentHolesFor(materialization).map(({ argName }) => argName)).toEqual([
      "startPoint", "endPoint", "scale", "angleDeg", "baseLines"
    ]);
    expect(render(materialization.parts)).not.toContain("mirrorX");
  });

  it("does not re-expand addOffsetLine optional arguments", () => {
    const materialization = materializeFor("addOffsetLine");

    expect(argumentHolesFor(materialization).map(({ argName }) => argName)).toEqual(["sources", "distance"]);
    expect(render(materialization.parts)).not.toMatch(/(?:side|closed|suppressTrimWarnings):/u);
  });

  it("uses mutation syntax for addMove without a name hole", () => {
    const plan = planFor("addMove");
    const materialization = materializeFor("addMove");

    expect(plan.category).toBe(MUTATION_CATEGORY);
    expect(plan.hasNameHole).toBe(false);
    expect(render(materialization.parts)).toBe([
      "move(",
      "  targets: <targets>,",
      "  from: <from>,",
      "  to: <to>,",
      "  scale: <scale>,",
      "  angleDeg: <angleDeg>",
      ")"
    ].join("\n"));
    expect(materialization.parts.some((part) => part.kind === "hole" && part.hole.role === "name")).toBe(false);
  });

  it("materializes every current planner form successfully", () => {
    for (const plan of sourceCreationTemplatePlans) {
      for (let formIndex = 0; formIndex < plan.forms.length; formIndex += 1) {
        expect(materializeSourceCreationTemplate(plan, formIndex), `${plan.commandId} form ${formIndex}`).not.toBeNull();
      }
    }
  });

  it("returns null for invalid form indexes", () => {
    const plan = planFor("addLine");

    for (const formIndex of [-1, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(materializeSourceCreationTemplate(plan, formIndex)).toBeNull();
    }
  });

  it("keeps materialized literals free of VS Code snippet syntax", () => {
    for (const plan of sourceCreationTemplatePlans) {
      for (let formIndex = 0; formIndex < plan.forms.length; formIndex += 1) {
        const materialization = materializeSourceCreationTemplate(plan, formIndex)!;
        const text = materialization.parts
          .filter((part): part is Extract<SourceCreationTemplatePart, { kind: "text" }> => part.kind === "text")
          .map(({ text: partText }) => partText)
          .join("");
        expect(text, `${plan.commandId} form ${formIndex}`).not.toMatch(/\$\{?\d|\$\{/u);
      }
    }
  });

  it("coalesces adjacent literal parts and does not append a trailing newline", () => {
    for (const plan of sourceCreationTemplatePlans) {
      for (let formIndex = 0; formIndex < plan.forms.length; formIndex += 1) {
        const materialization = materializeSourceCreationTemplate(plan, formIndex)!;
        for (let partIndex = 0; partIndex < materialization.parts.length; partIndex += 1) {
          const part = materialization.parts[partIndex]!;
          expect(part.kind === "text" && part.text === "", `${plan.commandId} empty text part`).toBe(false);
          expect(
            part.kind === "text" && materialization.parts[partIndex - 1]?.kind === "text",
            `${plan.commandId} adjacent text parts`
          ).toBe(false);
        }
        expect(render(materialization.parts).endsWith("\n")).toBe(false);
      }
    }
  });
});
