import { DSL_INDENT } from "@nuinuicad/nui-language";
import type {
  SourceGeometryValueConstructionPlan,
  SourceGeometryValueTemplateForm
} from "./sourceGeometryValueTemplateCatalog";

export type SourceGeometryValueTemplateHole =
  | { role: "name" }
  | { role: "argument"; argName: string };

export type SourceGeometryValueTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; hole: SourceGeometryValueTemplateHole };

export type SourceGeometryValueTemplateMaterialization = {
  plan: SourceGeometryValueConstructionPlan;
  form: SourceGeometryValueTemplateForm;
  parts: readonly SourceGeometryValueTemplatePart[];
};

const appendText = (parts: SourceGeometryValueTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push({ kind: "text", text });
};

const appendArgumentParts = (
  parts: SourceGeometryValueTemplatePart[],
  form: SourceGeometryValueTemplateForm
): void => {
  if (form.args.length === 0) return;
  appendText(parts, "\n");
  form.args.forEach((argSpec, index) => {
    appendText(parts, `${DSL_INDENT}${argSpec.arg}: `);
    parts.push({ kind: "hole", hole: { role: "argument", argName: argSpec.arg } });
    appendText(parts, index === form.args.length - 1 ? "" : ",\n");
  });
  appendText(parts, "\n");
};

/** Materializes a selected pure-value construction form without drawable state. */
export const materializeSourceGeometryValueTemplate = (
  plan: SourceGeometryValueConstructionPlan,
  form: SourceGeometryValueTemplateForm
): SourceGeometryValueTemplateMaterialization | null => {
  if (!plan.forms.includes(form)) return null;
  if (form.args.some((argSpec) => !plan.spec.args.includes(argSpec))) return null;

  const parts: SourceGeometryValueTemplatePart[] = [
    { kind: "text", text: "const " },
    { kind: "hole", hole: { role: "name" } },
    { kind: "text", text: `: ${plan.spec.pureValueInterface} = ${plan.construction}(` }
  ];
  appendArgumentParts(parts, form);
  appendText(parts, ")");

  return { plan, form, parts };
};
