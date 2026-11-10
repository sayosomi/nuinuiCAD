import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText, compileCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslDefinition, queryDslReferences, planDslRenameEditsResult, queryDslCompletion } from "@nuinuicad/nui-language";

const text = `nui 1
line L = segment(start: (0,0), end: (100,0))
point Cut = coordinate(x: 40, y: 0)
extract E(source: @L, parts: [lower: start..@Cut, upper: @Cut..end])
reverse @E::upper()
const Value: number = @E::upper.length
`;
const context = (source = text) => {
  const result = compileFreshCanonicalText(source);
  if (result.status === "fatal") throw new Error(JSON.stringify(result.diagnostics));
  return { result, source: { normalizedSource: source, sourceRevision: result.doc.spans.sourceMap.sourceRevision }, semantic: { sourceRevision: result.doc.spans.sourceMap.sourceRevision, compiled: result.doc } };
};

describe("extract source language features", () => {
  it("navigates and finds references to a part and its virtual namespace", () => {
    const c = context();
    const part = queryDslDefinition({ ...c, position: text.lastIndexOf("upper") + 2 });
    expect(part && text.slice(part.declarationRange.from, part.declarationRange.to)).toBe("upper");
    expect(part?.declarationRange.from).toBe(text.indexOf("upper:"));
    const head = queryDslDefinition({ ...c, position: text.lastIndexOf("@E") + 1 });
    expect(head && text.slice(head.declarationRange.from, head.declarationRange.to)).toBe("E");
    const refs = queryDslReferences({ ...c, position: text.indexOf("upper:") + 1 });
    expect(refs?.referenceRanges).toHaveLength(2);
    const original = queryDslDefinition({ ...c, position: text.indexOf("source: @L") + 9 });
    expect(original && text.slice(original.declarationRange.from, original.declarationRange.to)).toBe("L");
  });
  it.each([["upper:", "top", "@E::top"], ["extract E", "Armhole", "@Armhole::upper"]])("renames %s through the established F2 edit boundary", (token, name, expected) => {
    const c = context();
    const offset = token === "extract E" ? text.indexOf(token) + 8 : text.indexOf(token) + 1;
    const plan = planDslRenameEditsResult(c, offset, name);
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") throw new Error(JSON.stringify(plan));
    const renamed = [...plan.plan.edits].sort((a,b) => b.from-a.from).reduce((s,e) => s.slice(0,e.from)+e.newText+s.slice(e.to), text);
    expect(renamed).toContain(expected);
    const after = compileCanonicalText(c.result, renamed);
    expect(after.status).not.toBe("fatal");
    const beforeIds = c.result.doc.document.elements.filter(e => ["lower","upper"].includes(e.name)).map(e => e.id);
    expect(after.doc.document.elements.filter(e => ["lower","upper","top"].includes(e.name)).map(e => e.id)).toEqual(beforeIds);
  });
  it("offers qualified part completion", () => {
    const input = `${text}\nreverse @E::`;
    const draft = compileFreshCanonicalText(input);
    const compiled = draft.currentCompiled;
    const c = { source: { normalizedSource: input, sourceRevision: compiled.spans.sourceMap.sourceRevision }, semantic: { sourceRevision: compiled.spans.sourceMap.sourceRevision, compiled } };
    const completion = queryDslCompletion({ ...c, position: input.length });
    expect(completion?.candidates.map(c => c.label)).toEqual(expect.arrayContaining(["lower","upper"]));
  });
  it("gives a moved part a new owner identity even when both extract heads remain", () => {
    const initial = `nui 1\nline L = segment(start: (0,0), end: (100,0))\nextract One(source: @L, parts: [stay: start..end, moving: start..end])\nextract Two(source: @L, parts: [stay: start..end])`;
    const before = compileFreshCanonicalText(initial);
    const after = compileCanonicalText(before, initial.replace("stay: start..end, moving: start..end", "stay: start..end").replace("extract Two(source: @L, parts: [stay: start..end])", "extract Two(source: @L, parts: [stay: start..end, moving: start..end])"));
    expect(after.status).toBe("valid");
    expect(after.doc.document.elements.find(e => e.name === "moving")!.id).not.toBe(before.doc.document.elements.find(e => e.name === "moving")!.id);
    expect(after.doc.document.elements.filter(e => e.name === "stay").map(e => e.id)).toEqual(before.doc.document.elements.filter(e => e.name === "stay").map(e => e.id));
  });
  it.each(["Common", "Local", "finished"])("renames authored head/part Style and layer %s once per token", name => {
    const input = `nui 1\nstyle Common {\n  color: #123456,\n}\nstyle Local {\n  width: 2px,\n}\nlayer finished\nline L = segment(start: (0,0), end: (100,0))\nextract E[Common] in @finished(source: @L, parts: [a: start..end, b[Local]: start..end])`;
    const c = context(input);
    const offset = name === "finished" ? input.indexOf("layer finished") + 8 : input.indexOf(`style ${name}`) + 7;
    const result = planDslRenameEditsResult(c, offset, `${name}New`);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    expect(new Set(result.plan.edits.map(e => `${e.from}:${e.to}`)).size).toBe(result.plan.edits.length);
    const after = [...result.plan.edits].sort((a,b) => b.from-a.from).reduce((s,e) => s.slice(0,e.from)+e.newText+s.slice(e.to), input);
    expect(compileCanonicalText(c.result, after).status).toBe("valid");
  });
});
