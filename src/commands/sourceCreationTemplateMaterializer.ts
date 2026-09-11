import { MUTATION_CATEGORY } from "../dsl/dslConstructions";
import { DSL_INDENT } from "../dsl/dslTokens";
import type {
  SourceCreationTemplateArgumentHole,
  SourceCreationTemplateLiteralArgument,
  SourceCreationTemplatePlan
} from "./sourceCreationTemplatePlan";

export type SourceCreationTemplateHole =
  | { role: "name" }
  | ({ role: "argument" } & SourceCreationTemplateArgumentHole);

export type SourceCreationTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "hole"; hole: SourceCreationTemplateHole };

export type SourceCreationTemplateMaterialization = {
  commandId: SourceCreationTemplatePlan["commandId"];
  formIndex: number;
  parts: readonly SourceCreationTemplatePart[];
};

const textPart = (text: string): SourceCreationTemplatePart => ({ kind: "text", text });

const holePart = (hole: SourceCreationTemplateHole): SourceCreationTemplatePart => ({ kind: "hole", hole });

const appendText = (parts: SourceCreationTemplatePart[], text: string): void => {
  if (text === "") return;
  const previous = parts.at(-1);
  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }
  parts.push(textPart(text));
};

const appendArgumentParts = (
  parts: SourceCreationTemplatePart[],
  argumentHoles: readonly SourceCreationTemplateArgumentHole[],
  literalArguments: readonly SourceCreationTemplateLiteralArgument[]
): void => {
  const argumentsInOrder = [
    ...argumentHoles.map((argumentHole) => ({ kind: "hole" as const, argumentHole })),
    ...literalArguments.map((literalArgument) => ({ kind: "literal" as const, literalArgument }))
  ];
  appendText(parts, "\n");
  argumentsInOrder.forEach((argument, index) => {
    const last = index === argumentsInOrder.length - 1;
    if (argument.kind === "hole") {
      appendText(parts, `${DSL_INDENT}${argument.argumentHole.argName}: `);
      parts.push(holePart({ role: "argument", ...argument.argumentHole }));
    } else {
      appendText(parts, `${DSL_INDENT}${argument.literalArgument.argName}: ${argument.literalArgument.value}`);
    }
    appendText(parts, last ? "" : ",\n");
  });
  appendText(parts, "\n)");
};

/**
 * Materializes one already-planned Source creation form into host-neutral
 * literal and editable-hole parts. The planner remains the sole owner of
 * argument membership, ordering, and exclusive-form selection.
 */
export const materializeSourceCreationTemplate = (
  plan: SourceCreationTemplatePlan,
  formIndex: number
): SourceCreationTemplateMaterialization | null => {
  if (!Number.isInteger(formIndex) || formIndex < 0 || formIndex >= plan.forms.length) return null;

  const isMutation = plan.category === MUTATION_CATEGORY;
  if (isMutation === plan.hasNameHole) return null;

  const form = plan.forms[formIndex];
  if (!form) return null;

  const parts: SourceCreationTemplatePart[] = [];
  appendText(parts, isMutation ? `${plan.construction}(` : `${plan.category} `);
  if (!isMutation) {
    parts.push(holePart({ role: "name" }));
    appendText(parts, ` = ${plan.construction}(`);
  }
  appendArgumentParts(parts, form.argumentHoles, form.literalArguments ?? []);

  return { commandId: plan.commandId, formIndex, parts };
};
