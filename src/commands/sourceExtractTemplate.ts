import { DSL_INDENT } from "@nuinuicad/nui-language";

export const SOURCE_EXTRACT_FORMS = [
  { label: "1 part — middle", partCount: 1 },
  { label: "2 parts", partCount: 2 },
  { label: "3 parts", partCount: 3 }
] as const;

export type SourceExtractPartCount = 1 | 2 | 3;
export type SourceExtractTemplate = {
  parts: readonly ({ kind: "text"; text: string } | { kind: "field"; index: number; defaultText: string })[];
};

/** Source-only insertion, with independent boundary fields for per-slot Pick.
 * Names and references remain editable native snippet placeholders. */
export const sourceExtractTemplate = (count: SourceExtractPartCount): SourceExtractTemplate => {
  const parts: SourceExtractTemplate["parts"][number][] = [];
  let index = 1;
  const text = (value: string) => parts.push({ kind: "text", text: value });
  const field = (defaultText: string) => parts.push({ kind: "field", index: index++, defaultText });
  const boundary = (value: string) => value === "start" || value === "end" ? text(value) : field(value);
  text("extract "); field("Extract"); text(`(\n${DSL_INDENT}source: `); field("Path"); text(`,\n${DSL_INDENT}parts: [\n`);
  const rows = count === 1 ? [["middle", "Cut1", "Cut2"]]
    : count === 2 ? [["lower", "start", "Cut"], ["upper", "Cut", "end"]]
      : [["lower", "start", "Cut1"], ["middle", "Cut1", "Cut2"], ["upper", "Cut2", "end"]];
  for (const [name, left, right] of rows) {
    text(DSL_INDENT.repeat(2)); field(name); text(": ");
    boundary(left);
    text("..");
    boundary(right);
    text(",\n");
  }
  text(`${DSL_INDENT}],\n)`);
  return { parts };
};
