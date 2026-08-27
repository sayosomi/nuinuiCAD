import { inflateRawSync } from "node:zlib";

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 32;
export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
export const MAX_REPORT_TOTAL_BYTES = 8 * 1024 * 1024;

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY = 0x02014b50;
const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR = 0x08074b50;
const MAX_XML_DEPTH = 128;
const MAX_ZIP_ENTRY_NAME_BYTES = 256;

const failureElements = new Set(["failure", "error", "flakyFailure", "flakyError"]);

const fixedReport = (name, runner) => Object.freeze({
  reportNames: Object.freeze([name]),
  runner
});

const lifecycleReport = Object.freeze({
  reportNames: "lifecycle-stress",
  runner: "vitest"
});

export const STRUCTURED_REPORT_MAPPING = Object.freeze({
  "Classify changes": Object.freeze({
    "Test change classifier": fixedReport("classification-change-classifier.xml", "node"),
    "Test Discord PR notification helper": fixedReport("classification-discord-notification.xml", "node")
  }),
  Node: Object.freeze({
    "Changed Node tests": fixedReport("node-changed.xml", "vitest"),
    "Filesystem-backed binding resolution invariant": fixedReport("node-binding-resolution.xml", "vitest")
  }),
  "Rust + parity": Object.freeze({
    "Test evaluator crate": fixedReport("rust-evaluator.xml", "rust"),
    "Full Node tests": fixedReport("full-node.xml", "vitest"),
    "Lifecycle stress tests": lifecycleReport,
    "TypeScript/Rust parity": fixedReport("parity.xml", "vitest")
  })
});

export const reportMappingForFailure = (jobName, stepName) => {
  if (typeof jobName !== "string" || typeof stepName !== "string") return null;
  return STRUCTURED_REPORT_MAPPING[jobName]?.[stepName] ?? null;
};

const isLifecycleReportName = (name) => {
  const match = /^lifecycle-stress-([1-9][0-9]*)\.xml$/.exec(name);
  if (!match) return null;
  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
};

const acceptedReportName = (name, reportSpec) => {
  if (reportSpec?.reportNames === "lifecycle-stress") return isLifecycleReportName(name) !== null;
  return Array.isArray(reportSpec?.reportNames) && reportSpec.reportNames.includes(name);
};

const strictUtf8 = (bytes) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const findZipEnd = (archive) => {
  const minimumOffset = Math.max(0, archive.length - 65557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  return -1;
};

const parseZipEntries = (archive) => {
  if (!Buffer.isBuffer(archive) || archive.length > MAX_ARTIFACT_BYTES || archive.length < 22) return null;

  const endOffset = findZipEnd(archive);
  if (endOffset < 0) return null;

  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(endOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount > MAX_ZIP_ENTRIES ||
    centralDirectoryOffset > archive.length ||
    centralDirectorySize > archive.length - centralDirectoryOffset ||
    centralDirectoryOffset + centralDirectorySize !== endOffset
  ) return null;

  const centralEntries = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset > endOffset - 46 || archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY) return null;

    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const centralEntryEnd = offset + 46 + nameLength + extraLength + commentLength;

    if (centralEntryEnd > endOffset || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) return null;

    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameLength <= MAX_ZIP_ENTRY_NAME_BYTES ? strictUtf8(nameBytes) : null;
    centralEntries.push({
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      nameLength,
      nameBytes,
      name,
      localOffset
    });
    offset = centralEntryEnd;
  }

  if (offset !== endOffset) return null;

  const sortedLocalOffsets = [...new Set(centralEntries.map((entry) => entry.localOffset))].sort((left, right) => left - right);
  if (sortedLocalOffsets.length !== centralEntries.length) return null;

  const entries = [];
  for (const centralEntry of centralEntries) {
    const {
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      nameLength,
      nameBytes,
      name,
      localOffset
    } = centralEntry;
    const localIndex = sortedLocalOffsets.indexOf(localOffset);
    const nextLocalOffset = sortedLocalOffsets[localIndex + 1] ?? centralDirectoryOffset;
    if (
      localOffset >= centralDirectoryOffset ||
      nextLocalOffset > centralDirectoryOffset ||
      localOffset > archive.length - 30 ||
      archive.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE
    ) return null;

    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localCompression = archive.readUInt16LE(localOffset + 8);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (
      localFlags !== flags ||
      localCompression !== compression ||
      localNameLength !== nameLength ||
      !archive.subarray(localOffset + 30, dataStart).equals(nameBytes) ||
      dataStart > archive.length ||
      dataEnd > archive.length ||
      dataEnd > nextLocalOffset
    ) return null;

    const hasDataDescriptor = (flags & 0x0008) !== 0;
    if (
      (!hasDataDescriptor && (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) ||
      (hasDataDescriptor &&
        localCompressedSize !== 0 &&
        localCompressedSize !== compressedSize) ||
      (hasDataDescriptor &&
        localUncompressedSize !== 0 &&
        localUncompressedSize !== uncompressedSize)
    ) return null;

    if (hasDataDescriptor) {
      const descriptorLength = nextLocalOffset - dataEnd;
      if (descriptorLength !== 12 && descriptorLength !== 16) return null;
      const descriptorOffset = dataEnd;
      const hasSignature = archive.readUInt32LE(descriptorOffset) === ZIP_DATA_DESCRIPTOR;
      if (hasSignature !== (descriptorLength === 16)) return null;
      const descriptorValueOffset = descriptorOffset + (hasSignature ? 4 : 0);
      const descriptorCompressedSize = archive.readUInt32LE(descriptorValueOffset + 4);
      const descriptorUncompressedSize = archive.readUInt32LE(descriptorValueOffset + 8);
      if (descriptorCompressedSize !== compressedSize || descriptorUncompressedSize !== uncompressedSize) return null;
    }

    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      compressed: archive.subarray(dataStart, dataEnd)
    });
  }

  return offset === endOffset ? entries : null;
};

const inflateEntry = (entry) => {
  if (entry.uncompressedSize > MAX_REPORT_BYTES) return null;
  if (entry.compression === 0) {
    if (entry.compressed.length !== entry.uncompressedSize) return null;
    return entry.compressed;
  }
  if (entry.compression !== 8) return null;

  try {
    const body = inflateRawSync(entry.compressed, { maxOutputLength: MAX_REPORT_BYTES });
    return body.length === entry.uncompressedSize && body.length <= MAX_REPORT_BYTES ? body : null;
  } catch {
    return null;
  }
};

const readReportEntries = (archive, reportSpec) => {
  const entries = parseZipEntries(archive);
  if (!entries) return null;

  const matchingEntries = entries.filter((entry) => entry.name !== null && acceptedReportName(entry.name, reportSpec));
  const names = new Set();
  let totalUncompressedSize = 0;
  for (const entry of matchingEntries) {
    if (names.has(entry.name)) return null;
    names.add(entry.name);
    if (entry.compression !== 0 && entry.compression !== 8) return null;
    totalUncompressedSize += entry.uncompressedSize;
    if (totalUncompressedSize > MAX_REPORT_TOTAL_BYTES) return null;
  }

  const reports = [];
  for (const entry of matchingEntries) {
    const body = inflateEntry(entry);
    if (!body) return null;
    const text = strictUtf8(body);
    if (text === null) return null;
    reports.push({ name: entry.name, text });
  }

  if (reportSpec?.reportNames === "lifecycle-stress") {
    reports.sort((left, right) => {
      const leftIteration = isLifecycleReportName(left.name);
      const rightIteration = isLifecycleReportName(right.name);
      return leftIteration < rightIteration ? -1 : leftIteration > rightIteration ? 1 : 0;
    });
  }
  return reports;
};

const decodeXmlEntities = (value) => {
  let invalid = false;
  const entityPattern = /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi;
  if (value.replace(entityPattern, "").includes("&")) return null;
  const decoded = value.replace(entityPattern, (entity, reference) => {
    if (reference === "amp") return "&";
    if (reference === "lt") return "<";
    if (reference === "gt") return ">";
    if (reference === "quot") return '"';
    if (reference === "apos") return "'";

    const radix = reference[1].toLowerCase() === "x" ? 16 : 10;
    const digits = reference.slice(radix === 16 ? 2 : 1);
    const codePoint = Number.parseInt(digits, radix);
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      invalid = true;
      return "";
    }
    return String.fromCodePoint(codePoint);
  });
  if (invalid) return null;
  return decoded;
};

const findTagEnd = (xml, start) => {
  let quote = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
};

const parseStartTag = (body) => {
  const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(body);
  if (!nameMatch) return null;

  const name = nameMatch[0];
  const attributes = {};
  let index = name.length;
  let selfClosing = false;
  while (index < body.length) {
    while (/\s/.test(body[index] ?? "")) index += 1;
    if (index === body.length) break;
    if (body[index] === "/") {
      selfClosing = true;
      index += 1;
      while (/\s/.test(body[index] ?? "")) index += 1;
      if (index !== body.length) return null;
      break;
    }

    const attributeMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(body.slice(index));
    if (!attributeMatch) return null;
    const attributeName = attributeMatch[0];
    index += attributeName.length;
    while (/\s/.test(body[index] ?? "")) index += 1;
    if (body[index] !== "=") return null;
    index += 1;
    while (/\s/.test(body[index] ?? "")) index += 1;
    const quote = body[index];
    if (quote !== '"' && quote !== "'") return null;
    index += 1;
    const valueStart = index;
    while (index < body.length && body[index] !== quote) index += 1;
    if (index === body.length) return null;
    const value = decodeXmlEntities(body.slice(valueStart, index));
    if (value === null || Object.hasOwn(attributes, attributeName)) return null;
    attributes[attributeName] = value;
    index += 1;
  }

  return { name, attributes, selfClosing };
};

const parseXml = (xml) => {
  if (typeof xml !== "string" || xml.length === 0 || Buffer.byteLength(xml, "utf8") > MAX_REPORT_BYTES) return null;
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) return null;

  const root = { name: null, attributes: {}, children: [], text: "" };
  const stack = [root];
  let cursor = 0;
  let documentRoot = null;

  const appendText = (rawText) => {
    const text = decodeXmlEntities(rawText);
    if (text === null) return false;
    if (stack.length === 1 && text.trim() !== "") return false;
    stack[stack.length - 1].text += text;
    return true;
  };

  while (cursor < xml.length) {
    if (xml[cursor] !== "<") {
      const nextTag = xml.indexOf("<", cursor);
      const end = nextTag < 0 ? xml.length : nextTag;
      if (!appendText(xml.slice(cursor, end))) return null;
      cursor = end;
      continue;
    }

    if (xml.startsWith("<!--", cursor)) {
      const commentEnd = xml.indexOf("-->", cursor + 4);
      if (commentEnd < 0) return null;
      cursor = commentEnd + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", cursor)) {
      const cdataEnd = xml.indexOf("]]>", cursor + 9);
      if (cdataEnd < 0 || !appendText(xml.slice(cursor + 9, cdataEnd))) return null;
      cursor = cdataEnd + 3;
      continue;
    }
    if (xml.startsWith("<?", cursor)) {
      const processingInstructionEnd = xml.indexOf("?>", cursor + 2);
      if (processingInstructionEnd < 0) return null;
      cursor = processingInstructionEnd + 2;
      continue;
    }
    if (xml.startsWith("</", cursor)) {
      const tagEnd = findTagEnd(xml, cursor + 2);
      if (tagEnd < 0) return null;
      const closingName = xml.slice(cursor + 2, tagEnd).trim();
      const current = stack[stack.length - 1];
      if (!current.name || closingName !== current.name || stack.length === 1) return null;
      stack.pop();
      cursor = tagEnd + 1;
      continue;
    }
    if (xml.startsWith("<!", cursor)) return null;

    const tagEnd = findTagEnd(xml, cursor + 1);
    if (tagEnd < 0) return null;
    const parsedTag = parseStartTag(xml.slice(cursor + 1, tagEnd));
    if (!parsedTag || stack.length > MAX_XML_DEPTH) return null;
    const node = { name: parsedTag.name, attributes: parsedTag.attributes, children: [], text: "" };
    if (stack.length === 1) {
      if (documentRoot) return null;
      documentRoot = node;
    }
    stack[stack.length - 1].children.push(node);
    if (!parsedTag.selfClosing) stack.push(node);
    cursor = tagEnd + 1;
  }

  if (stack.length !== 1 || !documentRoot || !["testsuites", "testsuite"].includes(documentRoot.name)) return null;
  return documentRoot;
};

const useful = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

const suiteIdentifier = (suite) =>
  useful(suite.attributes.name) ?? useful(suite.attributes.id) ?? useful(suite.text);

const formatFailure = ({ testcase, suites, runner }) => {
  const name = useful(testcase.attributes.name);
  if (!name) return null;

  if (runner === "vitest") {
    const fileOrClassname = useful(testcase.attributes.classname) ?? useful(testcase.attributes.file);
    return fileOrClassname ? `${fileOrClassname} > ${name}` : name;
  }

  const suite = suites.map(suiteIdentifier).filter(Boolean).join(" > ");
  return suite ? `${suite} > ${name}` : name;
};

const firstFailedTestcase = (root, runner) => {
  const visit = (node, suites) => {
    const nextSuites = node.name === "testsuite" ? [...suites, node] : suites;
    if (node.name === "testcase" && node.children.some((child) => failureElements.has(child.name))) {
      return formatFailure({ testcase: node, suites, runner });
    }
    for (const child of node.children) {
      const failure = visit(child, nextSuites);
      if (failure) return failure;
    }
    return null;
  };
  return visit(root, []);
};

const parseReport = (text, runner) => {
  const root = parseXml(text);
  if (!root) return null;
  return firstFailedTestcase(root, runner);
};

export const extractFailedTestFromJUnit = (text, runner) => parseReport(text, runner);

export const extractStructuredFailureFromArchive = (archive, reportSpec) => {
  if (!reportSpec) return null;
  const reports = readReportEntries(archive, reportSpec);
  if (!reports) return null;
  for (const report of reports) {
    const root = parseXml(report.text);
    if (!root) return null;
    const failure = firstFailedTestcase(root, reportSpec.runner);
    if (failure) return failure;
  }
  return null;
};
