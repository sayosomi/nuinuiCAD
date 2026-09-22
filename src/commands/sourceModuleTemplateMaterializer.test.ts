import { describe, expect, it } from "vitest";
import type { ResolvedModuleParameter, SourceModuleTemplateCandidate } from "@nuinuicad/nui-language";
import { SOURCE_MODULE_TEMPLATE_DEFINITIONS } from "./sourceModuleTemplateCatalog";
import {
  materializeSourceModuleTemplate,
  type SourceModuleTemplatePart
} from "./sourceModuleTemplateMaterializer";

const render = (parts: readonly SourceModuleTemplatePart[]): string => parts.map((part) =>
  part.kind === "text"
    ? part.text
    : `<${part.field}${part.parameterName ? `:${part.parameterName}` : ""}>`
).join("");

const parameterFor = (
  parameterIndex: number,
  name: string,
  values: Pick<ResolvedModuleParameter, "required" | "optional" | "defaultValue">
): ResolvedModuleParameter => ({
  definitionStatementId: "module:test",
  parameterIndex,
  name,
  type: { kind: "number" },
  valueType: { kind: "number" },
  recordTypeIdentity: null,
  defaultSpan: null,
  defaultExpression: null,
  ...values
});

const candidateFor = (parameters: readonly ResolvedModuleParameter[]): SourceModuleTemplateCandidate => ({
  kind: "module",
  label: "lib::Panel",
  sourceCallee: "lib::Panel",
  identity: "library/module:panel",
  parameters
});

describe("Module Source Template materializer", () => {
  it("keeps the fixed rows in catalog order", () => {
    expect(SOURCE_MODULE_TEMPLATE_DEFINITIONS.map(({ label }) => label)).toEqual([
      "Module", "Export Module", "Module Instance"
    ]);
  });

  it.each([
    ["module", "module <name>(\n  <parameters>\n) {\n  <body>\n}"],
    ["export-module", "export module <name>(\n  <parameters>\n) {\n  <body>\n}"]
  ] as const)("materializes %s with neutral definition holes", (templateId, expected) => {
    const materialization = materializeSourceModuleTemplate(templateId);
    expect(materialization).not.toBeNull();
    expect(render(materialization!.parts)).toBe(expected);
    expect(materialization!.parts.filter((part) => part.kind === "hole").map((part) => part.field))
      .toEqual(["name", "parameters", "body"]);
  });

  it("materializes only required arguments in canonical parameter order", () => {
    const candidate = candidateFor([
      parameterFor(0, "width", { required: true, optional: false, defaultValue: null }),
      parameterFor(1, "side", { required: false, optional: true, defaultValue: null }),
      parameterFor(2, "count", { required: false, optional: false, defaultValue: "2" }),
      parameterFor(3, "height", { required: true, optional: false, defaultValue: null })
    ]);
    const materialization = materializeSourceModuleTemplate("module-instance", candidate);

    expect(materialization).not.toBeNull();
    expect(render(materialization!.parts)).toBe([
      "instance <instance-name> = lib::Panel(",
      "  width: <argument:width>,",
      "  height: <argument:height>",
      ")"
    ].join("\n"));
  });

  it("emits a legal empty call when the callee has no required parameters", () => {
    const candidate = candidateFor([
      parameterFor(0, "side", { required: false, optional: true, defaultValue: null }),
      parameterFor(1, "count", { required: false, optional: false, defaultValue: "2" })
    ]);
    const materialization = materializeSourceModuleTemplate("module-instance", candidate);

    expect(materialization).not.toBeNull();
    expect(render(materialization!.parts)).toBe("instance <instance-name> = lib::Panel()");
    expect(materialization!.parts.some((part) => part.kind === "hole" && part.field === "argument")).toBe(false);
  });
});
