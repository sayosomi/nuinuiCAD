import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const sourcePath = resolve(repositoryRoot, "rust-evaluator/src/output/pdf_cmap/UniJIS-UCS2-H");
const bitmapPath = resolve(repositoryRoot, "rust-evaluator/src/output/pdf_cmap/ucs2_supplement2.bin");

const expected = {
  sourceBlob: "bf5331822801a655b922e0efaf786e1250b4216d",
  version: "12.006",
  mappedCodepoints: 9_772,
  acceptedCodepoints: 8_175,
  rangeBlocks: 86,
  rangeRows: 8_533,
  charBlocks: 0,
  charRows: 0,
  maxCid: 8_719
};

const requireInvariant = (condition, message) => {
  if (!condition) throw new Error(`PDF UCS-2 support source validation failed: ${message}`);
};

const gitBlobSha1 = (contents) => createHash("sha1")
  .update(`blob ${contents.length}\0`)
  .update(contents)
  .digest("hex");

const parseHex = (value, description) => {
  requireInvariant(/^[0-9A-Fa-f]{4}$/.test(value), `${description} must be a four-digit BMP code`);
  return Number.parseInt(value, 16);
};

const parseCMap = (source) => {
  requireInvariant(source.startsWith("%!PS-Adobe-3.0 Resource-CMap\n"), "unexpected CMap header");
  requireInvariant(source.includes(`%%Version: ${expected.version}\n`), "unexpected CMap version");
  requireInvariant(source.includes("/CMapName /UniJIS-UCS2-H def"), "unexpected CMap name");
  requireInvariant(source.includes("/CMapType 1 def"), "unexpected CMap type");
  requireInvariant(/\/Registry\s+\(Adobe\)\s+def/.test(source), "unexpected registry");
  requireInvariant(/\/Ordering\s+\(Japan1\)\s+def/.test(source), "unexpected ordering");
  requireInvariant(/\/Supplement\s+4\s+def/.test(source), "unexpected CMap supplement");

  const codeSpace = /\d+ begincodespacerange\n([\s\S]*?)\nendcodespacerange/.exec(source);
  requireInvariant(codeSpace !== null, "codespace block is missing");
  const codeSpacePairs = [...codeSpace[1].matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4})>/g)]
    .map((match) => [parseHex(match[1], "codespace start"), parseHex(match[2], "codespace end")]);
  requireInvariant(
    JSON.stringify(codeSpacePairs) === JSON.stringify([[0x0000, 0xd7ff], [0xe000, 0xffff]]),
    "codespace boundaries changed"
  );

  const mappings = new Int32Array(0x10000);
  mappings.fill(-1);
  const blockCounts = { cidrange: 0, cidchar: 0 };
  const rowCounts = { cidrange: 0, cidchar: 0 };
  let mappedCodepoints = 0;
  let active = null;
  let blockRows = 0;
  let declaredRows = 0;

  for (const line of source.split(/\r?\n/)) {
    if (active === null) {
      const header = /^(\d+) begin(cidrange|cidchar)$/.exec(line.trim());
      if (!header) continue;
      declaredRows = Number(header[1]);
      active = header[2];
      blockRows = 0;
      blockCounts[active] += 1;
      continue;
    }

    if (line.trim() === `end${active}`) {
      requireInvariant(blockRows === declaredRows, `${active} block declares ${declaredRows} rows but contains ${blockRows}`);
      active = null;
      continue;
    }

    if (!line.trim()) continue;
    const row = active === "cidrange"
      ? /^<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4})>\s+(\d+)$/.exec(line.trim())
      : /^<([0-9A-Fa-f]{4})>\s+(\d+)$/.exec(line.trim());
    requireInvariant(row !== null, `unsupported ${active} row: ${line}`);
    const start = parseHex(row[1], `${active} start`);
    const end = active === "cidrange" ? parseHex(row[2], "cidrange end") : start;
    const firstCid = Number(active === "cidrange" ? row[3] : row[2]);
    requireInvariant(start <= end, `${active} has a reversed range`);
    requireInvariant(firstCid + (end - start) <= 0xffff, `${active} CID range overflows`);

    for (let codepoint = start; codepoint <= end; codepoint += 1) {
      requireInvariant(mappings[codepoint] === -1, `duplicate ordinary mapping at U+${codepoint.toString(16).toUpperCase()}`);
      mappings[codepoint] = firstCid + codepoint - start;
      mappedCodepoints += 1;
    }
    rowCounts[active] += 1;
    blockRows += 1;
  }

  requireInvariant(active === null, `unterminated ${active} block`);
  requireInvariant(blockCounts.cidrange === expected.rangeBlocks, "cidrange block count changed");
  requireInvariant(rowCounts.cidrange === expected.rangeRows, "cidrange mapping row count changed");
  requireInvariant(blockCounts.cidchar === expected.charBlocks, "cidchar block count changed");
  requireInvariant(rowCounts.cidchar === expected.charRows, "cidchar mapping row count changed");
  requireInvariant(mappedCodepoints === expected.mappedCodepoints, "ordinary mapped codepoint count changed");

  for (const [codepoint, cid] of [[0x5996, 3887], [0x7cbe, 2654], [0x20ac, 9354]]) {
    requireInvariant(mappings[codepoint] === cid, `pinned mapping U+${codepoint.toString(16).toUpperCase()} changed`);
  }

  return { mappings, blockCounts, rowCounts, mappedCodepoints };
};

const oldRanges = [
  [0x0020, 0x007e],
  [0x3041, 0x3094],
  [0x309b, 0x309e],
  [0x30a1, 0x30fe],
  [0x65e5, 0x65e5],
  [0x672c, 0x672c]
];

const isSupported = (codepoint, cid) =>
  codepoint >= 0x0020 &&
  !(codepoint >= 0x007f && codepoint <= 0x009f) &&
  !(codepoint >= 0xd800 && codepoint <= 0xdfff) &&
  cid >= 1 && cid <= expected.maxCid;

const generateBitmap = (parsed) => {
  const bitmap = Buffer.alloc(0x10000 / 8);
  let acceptedCodepoints = 0;
  for (let codepoint = 0; codepoint <= 0xffff; codepoint += 1) {
    const cid = parsed.mappings[codepoint];
    if (!isSupported(codepoint, cid)) continue;
    bitmap[codepoint >> 3] |= 1 << (codepoint & 7);
    acceptedCodepoints += 1;
  }

  requireInvariant(bitmap.length === 8_192, "bitmap must be exactly 8,192 bytes");
  requireInvariant(acceptedCodepoints === expected.acceptedCodepoints, "supported codepoint count changed");
  for (const [start, end] of oldRanges) {
    for (let codepoint = start; codepoint <= end; codepoint += 1) {
      requireInvariant((bitmap[codepoint >> 3] & (1 << (codepoint & 7))) !== 0, `previously supported U+${codepoint.toString(16).toUpperCase()} was removed`);
    }
  }
  return { bitmap, acceptedCodepoints };
};

const args = process.argv.slice(2);
requireInvariant(args.length <= 1 && (args.length === 0 || args[0] === "--check"), "usage: node scripts/output/generatePdfUcs2Support.mjs [--check]");

const source = readFileSync(sourcePath);
requireInvariant(gitBlobSha1(source) === expected.sourceBlob, "pinned Adobe CMap Git blob SHA changed");
const parsed = parseCMap(source.toString("latin1"));
const { bitmap, acceptedCodepoints } = generateBitmap(parsed);

if (args[0] === "--check") {
  const existing = readFileSync(bitmapPath);
  requireInvariant(existing.equals(bitmap), "generated bitmap is stale or differs from the deterministic output");
} else {
  writeFileSync(bitmapPath, bitmap);
}

process.stdout.write(`PDF UCS-2 support bitmap ${args[0] === "--check" ? "verified" : "generated"}: ${acceptedCodepoints} codepoints, ${bitmap.length} bytes, source ${expected.sourceBlob}\n`);
