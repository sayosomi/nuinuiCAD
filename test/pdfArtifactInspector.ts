import { expect } from "vitest";
export type PdfOp = { op: string; args: (string | number | (string | number)[])[] };
type Op = PdfOp;
const nums = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

// Small PDF reader for the production encoder's uncompressed PDF 1.4 subset.
// Resolve trailer -> Catalog -> Pages -> Kids -> Page -> Contents through xref
// byte offsets. Validate declared stream byte lengths, never scan for a header.
export const parsePdf = (bytes: Buffer) => {
  const text = bytes.toString("latin1");
  const start = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  expect(start).not.toBeNull();
  const xrefOffset = Number(start![1]);
  const table = /^xref\n0 (\d+)\n([\s\S]*?)trailer\n([\s\S]*?)startxref/.exec(text.slice(xrefOffset));
  expect(table).not.toBeNull();
  const entries = table![2].trim().split("\n");
  expect(entries).toHaveLength(Number(table![1]));
  const objects = new Map<number, string>();
  entries.slice(1).forEach((e, i) => {
    const offset = Number(e.slice(0, 10));
    const h = `${i + 1} 0 obj\n`;
    expect(text.slice(offset, offset + h.length)).toBe(h);
    const end = text.indexOf("\nendobj", offset);
    expect(end).toBeGreaterThan(offset);
    objects.set(i + 1, text.slice(offset + h.length, end));
  });
  const object = (id: number) => { expect(objects.has(id)).toBe(true); return objects.get(id)!; };
  const reference = (s: string, key: string) => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(s)?.[1]);
  const catalog = object(reference(table![3], "Root"));
  expect(catalog).toMatch(/\/Type \/Catalog\b/);
  const pagesId = reference(catalog, "Pages");
  const tree = object(pagesId);
  expect(tree).toMatch(/\/Type \/Pages\b/);
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map(m => Number(m[1]));
  expect(kids).toHaveLength(Number(/\/Count (\d+)/.exec(tree)?.[1]));
  const pages = kids.map(id => {
    const page = object(id);
    expect(page).toMatch(/\/Type \/Page\b/);
    expect(reference(page, "Parent")).toBe(pagesId);
    const box = nums(/\/MediaBox \[([^\]]*)\]/.exec(page)![1]);
    const stream = object(reference(page, "Contents"));
    const content = /stream\n([\s\S]*)endstream$/.exec(stream)![1];
    expect(Buffer.byteLength(content, "latin1")).toBe(Number(/\/Length (\d+)/.exec(stream)![1]));
    return { box, ops: parseOps(content), object: page };
  });
  return { pages, objects };
};
export const parseOps = (content: string): Op[] => {
  const tokens = content.match(/\[[^\]]*\]|<[^>]*>|\/[^\s]+|[-+]?(?:\d*\.\d+|\d+)|[A-Za-z]+/g) ?? [];
  const ops: Op[] = []; let args: Op["args"] = [];
  for (const t of tokens) {
    if (t.startsWith("[")) args.push((t.slice(1, -1).match(/<[^>]*>|[-+]?(?:\d*\.\d+|\d+)/g) ?? []).map(x => x.startsWith("<") ? x : Number(x)));
    else if (t.startsWith("/") || t.startsWith("<")) args.push(t);
    else if (/^[-+\d.]/.test(t)) args.push(Number(t));
    else { ops.push({ op: t, args }); args = []; }
  }
  expect(args).toEqual([]);
  return ops;
};
