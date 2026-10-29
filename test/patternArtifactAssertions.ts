import { expect } from "vitest";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import matrix from "./fixtures/issue-1488/matrix.json";
type Cell = typeof matrix[number];
type Shape = Record<string, unknown>;
export const compare = (actual: unknown, expected: unknown, tolerance = 1e-7, path = "") => {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs(Number(actual) - expected), `${path}: ${actual} != ${expected}`).toBeLessThanOrEqual(tolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, tolerance, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    for (const [key, value] of Object.entries(expected)) compare((actual as Shape)[key], value, tolerance, `${path}.${key}`);
  } else expect(actual, path).toEqual(expected);
};
export const runtimePath = (doc: LastGoodDslDocument, elementId: string): string => {
  const element = doc.document.elements.find(e => e.id === elementId);
  if (!element) throw new Error(`Missing compiled element ${elementId}`);
  return [element.parentGroupId ? runtimePath(doc, element.parentGroupId) : "", element.name].filter(Boolean).join("::");
};
const numbers = (text: string) => (text.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
// Independent byte inspector follows actual xref, page tree and stream lengths.
const parsePdf = (bytes: Buffer) => {
  const text = bytes.toString("latin1");
  const xref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)?.[1]);
  const table = /^xref\n0 (\d+)\n([\s\S]*?)trailer\n([\s\S]*?)startxref/.exec(text.slice(xref));
  expect(table).not.toBeNull();
  const entries = table![2].trim().split("\n");
  expect(entries).toHaveLength(Number(table![1]));
  const objects = new Map<number, string>();
  entries.slice(1).forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10)), header = `${i + 1} 0 obj\n`;
    expect(text.slice(offset, offset + header.length)).toBe(header);
    objects.set(i + 1, text.slice(offset + header.length, text.indexOf("\nendobj", offset)));
  });
  const ref = (value: string, key: string) => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(value)?.[1]);
  const catalog = objects.get(ref(table![3], "Root"))!;
  const treeId = ref(catalog, "Pages"), tree = objects.get(treeId)!;
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map(m => Number(m[1]));
  expect(kids).toHaveLength(Number(/\/Count (\d+)/.exec(tree)?.[1]));
  return kids.map(id => {
    const page = objects.get(id)!;
    expect(ref(page, "Parent")).toBe(treeId);
    const stream = objects.get(ref(page, "Contents"))!;
    const content = /stream\n([\s\S]*)endstream$/.exec(stream)![1];
    expect(Buffer.byteLength(content, "latin1")).toBe(Number(/\/Length (\d+)/.exec(stream)![1]));
    return { box: numbers(/\/MediaBox \[([^\]]*)\]/.exec(page)![1]), content,
      ops: [...content.matchAll(/([-+\d.eE ]+)\s+(m|l|c)\b/g)].map(m => ({ op: m[2], args: numbers(m[1]) })) };
  });
};
export const checkFile = (bytes: Buffer, format: "svg" | "pdf", oracle: Cell["expected"]) => {
  if (format === "svg") {
    const xml = new DOMParser().parseFromString(bytes.toString("utf8"), "image/svg+xml");
    expect(xml.querySelector("parsererror")).toBeNull();
    const root = xml.documentElement;
    expect(root.getAttribute("width")).toMatch(/mm$/);
    expect(root.getAttribute("height")).toMatch(/mm$/);
    compare([parseFloat(root.getAttribute("width")!), parseFloat(root.getAttribute("height")!)], oracle.svgMm, .00051);
    compare(numbers(root.getAttribute("viewBox")!), [0, 0, ...oracle.svgMm], .00051);
    const paths = [...xml.querySelectorAll("path")];
    expect(paths).toHaveLength(oracle.drawables.length);
    paths.forEach((path, i) => {
      expect(path.getAttribute("d")).toMatch(/^M .* L /);
      const line = oracle.drawables[i];
      compare(numbers(path.getAttribute("d")!), [line.start.x - oracle.bounds.minX + 3, oracle.bounds.maxY + 3 - line.start.y,
        line.end.x - oracle.bounds.minX + 3, oracle.bounds.maxY + 3 - line.end.y], .00051);
      compare(Number(path.getAttribute("stroke-width")), 25.4 / 96, .00051);
      expect(path.getAttribute("stroke")).toBe("#123456");
    });
    return { size: oracle.svgMm, paths: paths.map(p => p.getAttribute("d")) };
  }
  const pages = parsePdf(bytes), pt = 72 / 25.4;
  expect(pages).toHaveLength(oracle.columns * oracle.rows);
  pages.forEach((page, index) => {
    compare(page.box, [0, 0, oracle.paperMm[0] * pt, oracle.paperMm[1] * pt], .00051);
    const origin = oracle.pageOrigins[index];
    const ops = oracle.drawables.flatMap(line => [
      { op: "m", args: [(line.start.x - origin.x) * pt, (line.start.y - origin.y) * pt] },
      { op: "l", args: [(line.end.x - origin.x) * pt, (line.end.y - origin.y) * pt] }
    ]);
    compare(page.ops.slice(0, ops.length), ops, .00051);
    const guides = page.ops.slice(ops.length);
    expect(guides).toHaveLength(8);
    for (const line of [[10, 0, 10, 297], [200, 0, 200, 297], [0, 10, 210, 10], [0, 287, 210, 287]]) {
      expect(guides.some((op, i) => op.op === "m" && guides[i + 1]?.op === "l" &&
        [...op.args, ...guides[i + 1].args].every((n, j) => Math.abs(n - line[j] * pt) <= .00051))).toBe(true);
    }
    expect(page.content).toContain("0.75 w");
  });
  return pages;
};
