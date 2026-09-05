import type { CompiledDslDocument } from "./dslDocument";
import { modifierPropertyMetadata, modifierPropertySchema } from "./dslModifierAuthoring";
import { scanDslSource } from "./dslTokens";

export type DslModifierCompletionContext =
  | { kind: "modifierReference"; from: number; to: number }
  | { kind: "modifierProperty"; from: number; to: number; options: readonly string[] }
  | { kind: "modifierValue"; from: number; to: number; property: "state" | "width" | "style" | "color" }
  | { kind: "modifierProfile"; from: number; to: number };

const lineAt = (source: string, offset: number) => {
  const before = source.slice(0, offset);
  const start = before.lastIndexOf("\n") + 1;
  const end = source.indexOf("\n", offset);
  return { start, text: source.slice(start, end < 0 ? source.length : end), local: offset - start, line: before.split("\n").length };
};

const tokenRange = (text: string, cursor: number, allowed: RegExp) => {
  let from = cursor;
  let to = cursor;
  while (from > 0 && allowed.test(text[from - 1]!)) from -= 1;
  while (to < text.length && allowed.test(text[to]!)) to += 1;
  return { from, to };
};

const isInComment = (source: string, line: number, local: number) =>
  scanDslSource(source).lines[line - 1]?.comments.some((comment) => local >= comment.start && local <= comment.end) ?? true;

const modifierFrameAt = (source: string, offset: number): number | null => {
  const lines = scanDslSource(source).lines;
  const target = lineAt(source, offset).line;
  const frames: number[] = [];
  for (let lineIndex = 0; lineIndex < target; lineIndex += 1) {
    const code = lines[lineIndex]?.code ?? "";
    let quote: string | null = null;
    for (let index = 0; index < code.length; index += 1) {
      const character = code[index]!;
      if (quote) {
        if (character === quote && code[index - 1] !== "\\") quote = null;
        continue;
      }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === "{") {
        const before = code.slice(0, index);
        if (/^\s*modifier\b/.test(before)) frames.push(lineIndex + 1);
      } else if (character === "}" && frames.length > 0) {
        frames.pop();
      }
    }
  }
  return frames.at(-1) ?? null;
};

const authoredProperties = (compiled: CompiledDslDocument | undefined, modifierLine: number, currentLine: number) => {
  if (!compiled) return new Set<string>();
  const modifierIndex = compiled.statements.findIndex((statement) => statement.kind === "modifierDefinition" && statement.line === modifierLine);
  if (modifierIndex < 0) return new Set<string>();
  const currentProfile = compiled.statements.find((statement) =>
    statement.kind === "modifierProfileBlock" && statement.enclosing?.statementIndex === modifierIndex && statement.line <= currentLine
  );
  const parentIndex = currentProfile && currentProfile.line <= currentLine
    ? compiled.statements.indexOf(currentProfile)
    : modifierIndex;
  return new Set(compiled.statements.flatMap((statement) =>
    statement.kind === "modifierProperty" && statement.enclosing?.statementIndex === parentIndex && statement.line !== currentLine
      ? [statement.property.key]
      : []
  ));
};

/** Tolerant modifier-only authoring classifier. It never validates grammar. */
export const dslModifierCompletionContextAt = (
  source: string,
  position: number,
  compiled: CompiledDslDocument | undefined
): DslModifierCompletionContext | null => {
  const current = lineAt(source, position);
  if (isInComment(source, current.line, current.local)) return null;
  const code = scanDslSource(source).lines[current.line - 1]?.code ?? current.text;
  const modifierLine = modifierFrameAt(source, position);

  const listStart = code.slice(0, current.local).lastIndexOf("[");
  const modifierListHeader = /^\s*(?:export\s+)?(?:point|line|arc|curve|path|group|text)\s+/.test(code.slice(0, listStart));
  if (listStart >= 0 && modifierListHeader && !code.slice(0, listStart).includes("=") && /\]\s*=|\]\s*$/.test(code)) {
    const range = tokenRange(code, current.local, /[^\s,[\]]/);
    return { kind: "modifierReference", from: current.start + range.from, to: current.start + range.to };
  }
  if (modifierLine === null) return null;

  const profile = code.match(/^(\s*for\s+@)([^\s{]*)/);
  if (profile && current.local >= profile[1]!.length) {
    const range = tokenRange(code, current.local, /[^\s{]/);
    return { kind: "modifierProfile", from: current.start + range.from, to: current.start + range.to };
  }
  const property = code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)?\s*(?::\s*([^,\s]*))?/);
  if (!property) return null;
  const key = property[1] ?? "";
  const colon = code.indexOf(":");
  if (colon >= 0 && current.local >= colon + 1 && modifierPropertyMetadata(key)) {
    const range = tokenRange(code, current.local, /[^\s,]/);
    if (key === "color" && code.slice(range.from, range.to).startsWith("#")) return null;
    return { kind: "modifierValue", from: current.start + range.from, to: current.start + range.to, property: key as "state" | "width" | "style" | "color" };
  }
  if (colon < 0) {
    const range = tokenRange(code, current.local, /[A-Za-z0-9_]/);
    const used = authoredProperties(compiled, modifierLine, current.line);
    return { kind: "modifierProperty", from: current.start + range.from, to: current.start + range.to, options: modifierPropertySchema.map((entry) => entry.key).filter((entry) => !used.has(entry)) };
  }
  return null;
};
