import { createCadElement } from "../model/elementFactory";
import { createElementNameContext } from "../model/elementNames";
import type { CadElement, DocumentPalette, PrintLayout, VisibilityProfile, VisibilityRole } from "../types/geometry";
import { applyArgs, createDefaultIntermediateId, type DslApplyArgsResolvers } from "./dslApplyArgs";
import { parseDslCallStatement } from "./dslCallParser";
import { constructionFor } from "./dslConstructions";
import { createNameIndex } from "./dslReferences";
import { parseDslSettingsStatement, type DslSettingsStatement } from "./dslSettingsParser";
import { applyDslV2PrintLayout, applyDslV2Setting, emptyDslV2Settings } from "./dslV2Settings";

/** Comparison-only result for P7; deliberately independent from production document types. */
export type DslV2RoundTripDocument = {
  elements: CadElement[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string | undefined;
  evaluationLimitIndex: number;
};

type ElementFrame = { kind: "element"; id: string; conditional: boolean; branch: "then" | "else" };
type PrintFrame = { kind: "print"; header: DslSettingsStatement; members: DslSettingsStatement[] };
type Frame = ElementFrame | PrintFrame;

const settingsKeywords = /^(nui|color|role|view|activeView|printLayout|layoutVar|place|activePrintLayout|@stop)\b/;

const logicalLines = (source: string) => {
  const lines: string[] = []; let current = ""; let depth = 0;
  for (const physical of source.split("\n")) {
    const line = physical.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "}" || line === "} else {") { if (current) lines.push(current); current = ""; lines.push(line); continue; }
    current += `${current ? " " : ""}${line}`;
    for (const char of line) if (char === "(") depth += 1; else if (char === ")") depth -= 1;
    if (depth === 0) { lines.push(current); current = ""; }
  }
  if (current) lines.push(current);
  return lines;
};

const settingsStatement = (source: string, opensBlock = false) => {
  const result = parseDslSettingsStatement(source, { opensBlock });
  if (!result.statement || result.diagnostics.length) throw new Error(result.diagnostics.map((item) => item.message).join("\n") || `設定文を解釈できません: ${source}`);
  return result.statement;
};

const applyResolvers = (elements: CadElement[], roles: VisibilityRole[]): DslApplyArgsResolvers => ({
  index: createNameIndex(elements), line: 1, elementsForExpressions: elements,
  nameContext: createElementNameContext(elements), visibilityRoles: roles, createIntermediateId: createDefaultIntermediateId,
});

export const compileDslV2RoundTripDocument = (source: string): DslV2RoundTripDocument => {
  const elements: CadElement[] = [];
  const frames: Frame[] = [];
  const printFrames: PrintFrame[] = [];
  let settings = emptyDslV2Settings();
  let evaluationLimitIndex: number | null = null;

  for (const text of logicalLines(source)) {
    if (text === "}") {
      const frame = frames.pop();
      if (!frame) throw new Error("対応しない } です。");
      if (frame.kind === "print") printFrames.push(frame);
      continue;
    }
    if (text === "} else {") {
      const frame = frames.at(-1);
      if (!frame || frame.kind !== "element" || !frame.conditional) throw new Error("対応しない else です。");
      frame.branch = "else";
      continue;
    }
    const opensBlock = text.endsWith("{");
    const sourceLine = opensBlock ? text.slice(0, -1).trim() : text;
    const print = frames.at(-1);
    if (settingsKeywords.test(sourceLine)) {
      const statement = settingsStatement(sourceLine, opensBlock);
      if (statement.kind === "printLayout") {
        if (!opensBlock) throw new Error("printLayout ブロックが必要です。");
        frames.push({ kind: "print", header: statement, members: [] });
      } else if ((statement.kind === "layoutVar" || statement.kind === "place") && print?.kind === "print") {
        print.members.push(statement);
      } else if (statement.kind === "atStop") {
        evaluationLimitIndex ??= elements.length;
      } else settings = applyDslV2Setting(settings, statement);
      continue;
    }
    const parsed = parseDslCallStatement(sourceLine, { opensBlock });
    if (!parsed.statement || parsed.diagnostics.length) throw new Error(parsed.diagnostics.map((item) => item.message).join("\n") || `要素文を解釈できません: ${sourceLine}`);
    const statement = parsed.statement;
    const spec = constructionFor(statement.category, statement.construction);
    if (!spec) throw new Error(`construction が見つかりません: ${statement.category}/${statement.construction}`);
    const parent = [...frames].reverse().find((frame): frame is ElementFrame => frame.kind === "element");
    let element = createCadElement(spec.elementType, elements, { createId: () => `${spec.elementType}-${elements.length + 1}`, referenceElements: elements });
    element = { ...element, name: statement.name, ...(parent ? { parentGroupId: parent.id } : {}), ...(parent?.conditional ? { conditionalBranch: parent.branch } : {}) };
    const applied = applyArgs(element, spec, statement.args, applyResolvers(elements, settings.visibilityRoles));
    if (applied.diagnostics.some((item) => item.severity === "error")) throw new Error(applied.diagnostics.map((item) => item.message).join("\n"));
    elements.push(applied.element);
    if (opensBlock) frames.push({ kind: "element", id: applied.element.id, conditional: applied.element.type === "conditionalGroup", branch: "then" });
  }
  if (frames.length) throw new Error("閉じられていないブロックがあります。");
  for (const frame of printFrames.reverse()) settings = applyDslV2PrintLayout(settings, frame.header, frame.members, elements);
  return { elements, ...settings, evaluationLimitIndex: evaluationLimitIndex ?? elements.length };
};
