import { describe, expect, it } from "vitest";
import {
  modulePreviewInvocationBlockWithText,
  modulePreviewInvocationFor,
  modulePreviewInvocationParameterSiteAt,
  modulePreviewInvocationTextFor,
  type ModulePreviewInvocationBlockInput
} from "./modulePreviewInvocation";

const blockInput = (): ModulePreviewInvocationBlockInput => ({
  kind: "target",
  definitionStatementId: "module:preview",
  definitionStatementIndex: 2,
  declarationScopeId: "scope:preview",
  name: "PreviewTarget",
  parameters: [
    {
      definitionStatementId: "module:preview",
      parameterIndex: 0,
      name: "width",
      type: { kind: "number" },
      optional: false,
      required: true,
      defaultSourceText: null,
      active: true,
      value: "",
      caller: { statementIndex: 2, scopeId: "scope:preview", sourceOrderIndex: 2 }
    },
    {
      definitionStatementId: "module:preview",
      parameterIndex: 1,
      name: "label",
      type: { kind: "string" },
      optional: false,
      required: false,
      defaultSourceText: '"Pocket"',
      active: false,
      value: "",
      caller: { statementIndex: 2, scopeId: "scope:preview", sourceOrderIndex: 2 }
    },
    {
      definitionStatementId: "module:preview",
      parameterIndex: 2,
      name: "note",
      type: { kind: "string" },
      optional: true,
      required: false,
      defaultSourceText: null,
      active: false,
      value: "",
      caller: { statementIndex: 2, scopeId: "scope:preview", sourceOrderIndex: 2 }
    }
  ]
});

describe("module Preview invocation representation", () => {
  it("renders every parameter in definition order with visible omission scaffolding", () => {
    expect(modulePreviewInvocationTextFor(blockInput())).toBe([
      "PreviewTarget(",
      "  width: ,",
      '  // label: "Pocket",',
      "  // note:",
      ")"
    ].join("\n"));
  });

  it("maps active arguments and comments to distinct semantic states", () => {
    const invocation = modulePreviewInvocationFor({ blocks: [blockInput()] });
    const block = invocation.blocks[0]!;
    expect(block.activeArguments).toEqual([{ name: "width", expression: "", parameterIndex: 0, range: { from: 24, to: 24 } }]);
    expect(block.parameters.map((parameter) => [parameter.name, parameter.active, parameter.omitted])).toEqual([
      ["width", true, false], ["label", false, true], ["note", false, true]
    ]);

    const explicit = modulePreviewInvocationBlockWithText(
      invocation,
      "module:preview",
      block.text.replace("// label: \"Pocket\"", "label: \"Pocket\"")
    ).blocks[0]!;
    expect(explicit.parameters[1]).toMatchObject({ active: true, value: '"Pocket"', omitted: false });
    expect(explicit.activeArguments.map((argument) => argument.name)).toEqual(["width", "label"]);

    const site = modulePreviewInvocationParameterSiteAt(explicit ? { blocks: [explicit] } : invocation, "module:preview", explicit.parameters[1]!.valueRange.from);
    expect(site?.name).toBe("label");
    expect(site?.valueRange).toEqual({ from: explicit.parameters[1]!.valueRange.from, to: explicit.parameters[1]!.valueRange.to });
  });

  it("preserves exact text and stable block/parameter identities while parsing edits", () => {
    const invocation = modulePreviewInvocationFor({ blocks: [blockInput()] });
    const text = invocation.blocks[0]!.text.replace("width: ,", "width: 24,");
    const edited = modulePreviewInvocationBlockWithText(invocation, "module:preview", text).blocks[0]!;
    expect(edited.text).toBe(text);
    expect(edited.definitionStatementId).toBe("module:preview");
    expect(edited.parameters.map((parameter) => parameter.parameterIndex)).toEqual([0, 1, 2]);
    expect(edited.parameters[0]).toMatchObject({ active: true, value: "24" });
    expect(edited.parameters[0]!.valueRange).toEqual({ from: 24, to: 26 });
  });

  it("keeps an explicitly empty editor buffer as the exact ephemeral text", () => {
    const invocation = modulePreviewInvocationFor({ blocks: [blockInput()] });
    const edited = modulePreviewInvocationBlockWithText(invocation, "module:preview", "").blocks[0]!;
    expect(edited.text).toBe("");
    expect(edited.parameters.every((parameter) => parameter.omitted)).toBe(true);
  });
});
