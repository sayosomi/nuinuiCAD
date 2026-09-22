import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDsl } from "@nuinuicad/nui-language";
import { SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS } from "./sourceValueMatchTemplateCatalog";
import {
  materializeSourceValueMatchTemplate,
  type SourceValueMatchTemplateFieldId,
  type SourceValueMatchTemplatePart
} from "./sourceValueMatchTemplateMaterializer";

const materializeFor = (templateId: (typeof SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)[number]["id"]) => {
  const materialization = materializeSourceValueMatchTemplate(templateId);
  expect(materialization).not.toBeNull();
  return materialization!;
};

const render = (parts: readonly SourceValueMatchTemplatePart[]): string => parts.map((part) =>
  part.kind === "text" ? part.text : `<${part.field}>`
).join("");

const concreteValueFor = (
  templateId: (typeof SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)[number]["id"],
  field: SourceValueMatchTemplateFieldId
): string => {
  switch (field) {
    case "name":
      return templateId === "choice-declaration" ? "side" : "selected";
    case "options":
      return "left, right";
    case "value":
      return templateId === "collection-value-for" ? "@value" : "left";
    case "element-type":
      return "number";
    case "members":
      return "1, 2";
    case "type":
      return templateId === "optional-match" ? "string?" : "number";
    case "condition":
      return "@flag";
    case "then-value":
      return "1";
    case "else-value":
      return "2";
    case "choice-value":
      return "side";
    case "arms":
      return "left => 1 right => 2";
    case "optional-value":
      return "note";
    case "none-value":
      return "none";
    case "binder":
      return "value";
    case "some-value":
      return "@value";
    case "collection":
      return "values";
  }
};

const renderConcrete = (
  templateId: (typeof SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)[number]["id"],
  parts: readonly SourceValueMatchTemplatePart[]
): string => parts.map((part) =>
  part.kind === "text" ? part.text : concreteValueFor(templateId, part.field)
).join("");

const preambleFor = (templateId: (typeof SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)[number]["id"]): string[] => {
  switch (templateId) {
    case "value-if":
      return ["const flag: boolean = true"];
    case "choice-match":
      return ["const side: choice(left, right) = left"];
    case "optional-match":
      return ["const note: string? = \"hello\""];
    case "collection-value-for":
      return ["const values: number[] = [1, 2]"];
    default:
      return [];
  }
};

describe("Value / Match template materializer", () => {
  it("exposes exactly the fixed six rows in order", () => {
    expect(SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS).toEqual([
      { id: "choice-declaration", label: "Choice Declaration" },
      { id: "collection-declaration", label: "Collection Declaration" },
      { id: "value-if", label: "Value If" },
      { id: "choice-match", label: "Choice Match" },
      { id: "optional-match", label: "Optional Match" },
      { id: "collection-value-for", label: "Collection Value For" }
    ]);
  });

  it.each([
    ["choice-declaration", "const <name>: choice(<options>) = <value>"],
    ["collection-declaration", "const <name>: <element-type>[] = [<members>]"],
    ["value-if", "const <name>: <type> = if (<condition>) { <then-value> } else { <else-value> }"],
    ["choice-match", "const <name>: <type> = match @<choice-value> {\n  <arms>\n}"],
    ["optional-match", "const <name>: <type> = match @<optional-value> {\n  none => <none-value> some <binder> => <some-value>\n}"],
    ["collection-value-for", "const <name>: <element-type>[] =\nfor <binder> in @<collection> {\n  <value>\n}"]
  ] as const)("materializes %s with only the contracted structure", (templateId, expected) => {
    const materialization = materializeFor(templateId);
    expect(render(materialization.parts)).toBe(expected);
  });

  it("keeps none and some as fixed Optional Match syntax", () => {
    const materialization = materializeFor("optional-match");
    const source = render(materialization.parts);
    expect(source).toContain("none =>");
    expect(source).toContain("some <binder> =>");
    expect(source).not.toContain("<none>");
    expect(source).not.toContain("<some>");
  });

  it.each(SOURCE_VALUE_MATCH_TEMPLATE_DEFINITIONS)(
    "accepts a concretized %s through parseDsl and compileDslDocument",
    ({ id }) => {
      const materialization = materializeFor(id);
      const source = [
        "nui 1",
        ...preambleFor(id),
        renderConcrete(id, materialization.parts)
      ].join("\n");
      const parsed = parseDsl(source);
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

      const assignedStatementIds = new Map(
        parsed.statements.map((_, index) => [index, `value-match-materializer:${id}:${index}`] as const)
      );
      const compiled = compileDslDocument(source, {
        preparsed: parsed,
        assignedStatementIds
      });

      expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(compiled.document).not.toBeNull();
    }
  );

  it("keeps Value If as a const value expression", () => {
    const materialization = materializeFor("value-if");
    expect(render(materialization.parts)).toContain("const <name>: <type> = if (");
    expect(render(materialization.parts)).not.toMatch(/^if \(/);
  });

  it("keeps Collection Value For as a const collection expression", () => {
    const materialization = materializeFor("collection-value-for");
    expect(render(materialization.parts)).toContain("const <name>: <element-type>[] =\nfor ");
    expect(render(materialization.parts)).not.toMatch(/^for /);
  });
});
