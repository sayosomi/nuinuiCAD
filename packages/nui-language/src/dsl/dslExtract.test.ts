import { describe, expect, it } from "vitest";
import { parseDslSnapshot } from "./dslParser";
import { buildSourceLexicalNamespaceIndex, resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import { parseDslReferenceToken } from "./dslReferenceTokens";

const source = `nui 1
layer draft
layer finished
extract armhole[outline] in finished(
  source: Curve,
  parts: [
    lower: start..Cut,
    upper[preassemble] in draft: Cut..end,
  ],
)
reverse armhole::upper()
`;

describe("extract declarations and canonical virtual namespace", () => {
  it("retains exact head, member, Style/layer, colon and interval ranges", () => {
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 3 });
    expect(parsed.diagnostics).toEqual([]);
    const head = parsed.statements.find(s => s.kind === "extract");
    if (head?.kind !== "extract") throw new Error("head missing");
    expect(head.parts).toHaveLength(2);
    const upper = head.parts[1];
    if (upper?.kind !== "interval") throw new Error("upper interval missing");
    expect(head.layerReference).toBe("finished");
    expect(head.parts[1].layerReference).toBe("draft");
    const text = (span: typeof head.physicalSpan | null | undefined) => span?.segments.map(s => source.slice(s.from, s.to)).join("");
    expect(text(head.parts[0].namePhysicalSpan)).toBe("lower");
    expect(text(head.parts[1].namePhysicalSpan)).toBe("upper");
    expect(text(upper.leftPhysicalSpan)).toBe("Cut");
    expect(text(upper.rightPhysicalSpan)).toBe("end");
    expect(text(upper.intervalPhysicalSpan)).toBe("..");
    expect(text(head.parts[1].colonPhysicalSpan)).toBe(":");
    const members = parsed.statements.filter(s => s.kind === "element" && s.extractPart);
    expect(members.map(s => s.modifierNames)).toEqual([["outline"], ["outline", "preassemble"]]);
    expect(members.map(s => s.kind === "element" && s.layerReference)).toEqual(["finished", "draft"]);
  });
  it("projects each named copy operand through the same physical source map", () => {
    const copy = "nui 1\ntransformCopy C(startPoint: (0, 0), parts: [edge: G::Line])";
    const parsed = parseDslSnapshot({ normalizedSource: copy, sourceRevision: 3 });
    expect(parsed.diagnostics).toEqual([]);
    const head = parsed.statements.find(statement => statement.kind === "extract");
    const part = head?.kind === "extract" ? head.parts[0] : undefined;
    if (part?.kind !== "source") throw new Error("copy member missing");
    const span = part.sourcePhysicalSpan;
    expect(span?.sourceRevision).toBe(3);
    expect(span?.segments.map(segment => copy.slice(segment.from, segment.to))).toEqual(["G::Line"]);
  });

  it("resolves qualified parts through the canonical lexical resolver without an implicit shortcut", () => {
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 3 });
    const ids = new Map(parsed.statements.map((_, i) => [i, `s${i}`]));
    const namespace = buildSourceLexicalNamespaceIndex(parsed.statements, ids);
    const last = parsed.statements.length - 1;
    const part = resolveSourceLexicalPath(namespace, last, parseDslReferenceToken("armhole::upper"));
    expect(part.kind).toBe("resolved");
    if (part.kind === "resolved") expect(part.declaration.statement.kind === "element" && part.declaration.statement.extractPart).toBeTruthy();
    expect(resolveSourceLexicalPath(namespace, last, parseDslReferenceToken("upper")).kind).toBe("undefined");
    const head = resolveSourceLexicalPath(namespace, last, parseDslReferenceToken("armhole"));
    expect(head.kind === "resolved" && head.declaration.kind).toBe("extract");
  });
  it("retains an incomplete right slot and rejects duplicate names and malformed intervals", () => {
    for (const [parts, code] of [["upper: cut..", "extract-point-boundary-required"], ["same: start..end, same: end..start", "extract-duplicate-part"], ["bad: start...end", "extract-interval-required"]]) {
      const p = parseDslSnapshot({ normalizedSource: `nui 1\nextract E(source: L, parts: [${parts}])`, sourceRevision: 1 });
      expect(p.diagnostics.some(d => d.code === code)).toBe(true);
      if (parts.endsWith("..")) {
        const head = p.statements.find(s => s.kind === "extract");
        const part = head?.kind === "extract" ? head.parts[0] : undefined;
        expect(part?.kind === "interval" && part.rightSpan.start === part.rightSpan.end).toBe(true);
      }
    }
  });
});
