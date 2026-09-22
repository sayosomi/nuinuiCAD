import { describe, expect, it } from "vitest";
import { DSL_INDENT } from "@nuinuicad/nui-language";
import { SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS } from "./sourceStyleProfileTemplateCatalog";
import {
  materializeSourceStyleProfileTemplate,
  type SourceStyleProfileTemplatePart
} from "./sourceStyleProfileTemplateMaterializer";

const render = (parts: readonly SourceStyleProfileTemplatePart[]): string => parts.map((part) =>
  part.kind === "text" ? part.text : `<${part.field}>`
).join("");

describe("Style / Profile Source Template materializer", () => {
  it("keeps the fixed rows in catalog order", () => {
    expect(SOURCE_STYLE_PROFILE_TEMPLATE_DEFINITIONS.map(({ label }) => label)).toEqual([
      "Profile", "Style", "Style + Profile Override"
    ]);
  });

  it("materializes the current single-line profile declaration", () => {
    const materialization = materializeSourceStyleProfileTemplate("profile");

    expect(materialization).not.toBeNull();
    expect(render(materialization!.parts)).toBe("profile <name>");
    expect(materialization!.parts.filter((part) => part.kind === "hole").map((part) => part.field))
      .toEqual(["name"]);
  });

  it("materializes a neutral Style block without property defaults", () => {
    const materialization = materializeSourceStyleProfileTemplate("style");

    expect(materialization).not.toBeNull();
    expect(render(materialization!.parts)).toBe(`style <name> {\n${DSL_INDENT}<body>\n}`);
    expect(materialization!.parts.filter((part) => part.kind === "hole").map((part) => part.field))
      .toEqual(["name", "body"]);
    expect(render(materialization!.parts)).not.toMatch(/visible|width|lineType|color|fill|fillOpacity/);
  });

  it("materializes the current for @profile override block with plain profile and body holes", () => {
    const materialization = materializeSourceStyleProfileTemplate("style-profile-override");

    expect(materialization).not.toBeNull();
    expect(render(materialization!.parts)).toBe([
      "style <name> {",
      `${DSL_INDENT}<common-body>`,
      `${DSL_INDENT}for @<profile> {`,
      `${DSL_INDENT.repeat(2)}<profile-body>`,
      `${DSL_INDENT}}`,
      "}"
    ].join("\n"));
    expect(materialization!.parts.filter((part) => part.kind === "hole").map((part) => part.field))
      .toEqual(["name", "common-body", "profile", "profile-body"]);
    expect(render(materialization!.parts)).not.toMatch(/visible|width|lineType|color|fill|fillOpacity/);
  });
});
