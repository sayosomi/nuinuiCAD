import { describe, expect, it } from "vitest";
import {
  scanScalarLiteral,
  type ScalarBooleanLiteralToken,
  type ScalarChoiceLiteralToken,
  type ScalarLiteralScanError,
  type ScalarNumberLiteralToken,
  type ScalarStringLiteralToken
} from "./literalScanner";

const fullSpan = (source: string) => ({ start: 0, end: source.length });

const asString = (source: string): ScalarStringLiteralToken => {
  const result = scanScalarLiteral(source, fullSpan(source));
  if (result.kind !== "string") throw new Error(`expected string token, got ${result.kind}`);
  return result;
};

const asError = (source: string): ScalarLiteralScanError => {
  const result = scanScalarLiteral(source, fullSpan(source));
  if (result.kind !== "error") throw new Error(`expected error, got ${result.kind}`);
  return result;
};

describe("scanScalarLiteral / string literals", () => {
  it("scans a double-quoted string", () => {
    const token = asString('"hello"');
    expect(token).toMatchObject({ quote: "\"", raw: "hello", cooked: "hello", escapes: [] });
    expect(token.span).toEqual({ start: 0, end: 7 });
  });

  it("scans a single-quoted string", () => {
    const token = asString("'hello'");
    expect(token).toMatchObject({ quote: "'", raw: "hello", cooked: "hello", escapes: [] });
  });

  it("scans an empty string", () => {
    const token = asString('""');
    expect(token).toMatchObject({ raw: "", cooked: "", escapes: [] });
    expect(token.span).toEqual({ start: 0, end: 2 });
  });

  it("keeps an unescaped opposite quote character literal", () => {
    const token = asString(`"it's fine"`);
    expect(token.cooked).toBe("it's fine");
    const single = asString(`'she said "hi"'`);
    expect(single.cooked).toBe('she said "hi"');
  });

  it("round-trips: quote + raw + quote reconstructs the exact source span", () => {
    const source = '"a\\nb\\{c\\}d"';
    const token = asString(source);
    expect(token.quote + token.raw + token.quote).toBe(source.slice(token.span.start, token.span.end));
  });

  describe("each of the 8 escapes", () => {
    const cases: Array<[string, string]> = [
      ["\\\\", "\\"],
      ['\\"', "\""],
      ["\\'", "'"],
      ["\\n", "\n"],
      ["\\r", "\r"],
      ["\\t", "\t"],
      ["\\{", "{"],
      ["\\}", "}"]
    ];

    it.each(cases)("unescapes %j to %j", (raw, cooked) => {
      const source = `"x${raw}y"`;
      const token = asString(source);
      expect(token.cooked).toBe(`x${cooked}y`);
      expect(token.escapes).toHaveLength(1);
      expect(token.escapes[0]).toMatchObject({ raw, cooked, span: { start: 2, end: 2 + raw.length } });
    });
  });

  it("distinguishes escaped braces from literal braces via the escapes list", () => {
    // "a\{b}c\}d{e" -> cooked: a{b}c}d{e, but only the \{ and \} are escapes.
    const source = '"a\\{b}c\\}d{e"';
    const token = asString(source);
    expect(token.cooked).toBe("a{b}c}d{e");
    expect(token.escapes.map((escape) => escape.raw)).toEqual(["\\{", "\\}"]);
    // The un-escaped `}` after b and `{` after d are not present in escapes.
    const escapedOffsets = new Set(token.escapes.map((escape) => escape.span.start));
    for (const offset of [contentIndexOf(source, "}c"), contentIndexOf(source, "{e")]) {
      expect(escapedOffsets.has(offset)).toBe(false);
    }
  });

  it("mixes several escapes in one string", () => {
    const source = '"line1\\nline2\\ttabbed \\\\ end"';
    const token = asString(source);
    expect(token.cooked).toBe("line1\nline2\ttabbed \\ end");
    expect(token.escapes).toHaveLength(3);
  });

  it("supports Unicode and Japanese content inside a string", () => {
    const token = asString('"前身頃を2枚カット \\n 続き"');
    expect(token.cooked).toBe("前身頃を2枚カット \n 続き");
  });

  it("reports an unknown escape with an exact 2-char span", () => {
    const source = '"abc\\qdef"';
    const error = asError(source);
    expect(error.issueCode).toBe("invalid-string-escape");
    expect(error.span).toEqual({ start: 4, end: 6 });
    expect(source.slice(error.span.start, error.span.end)).toBe("\\q");
  });

  it("reports a physical newline with an exact 1-char span, not unterminated-string", () => {
    const source = '"abc\ndef"';
    const error = asError(source);
    expect(error.issueCode).toBe("physical-newline-in-string");
    expect(error.span).toEqual({ start: 4, end: 5 });
  });

  it("reports a physical carriage return the same way", () => {
    const error = asError('"abc\rdef"');
    expect(error.issueCode).toBe("physical-newline-in-string");
  });

  it("reports an unterminated string spanning to span.end", () => {
    const source = '"abc def';
    const error = asError(source);
    expect(error.issueCode).toBe("unterminated-string");
    expect(error.span).toEqual({ start: 0, end: source.length });
  });

  it("treats a dangling backslash at the boundary as unterminated", () => {
    const source = '"abc\\';
    const error = asError(source);
    expect(error.issueCode).toBe("unterminated-string");
  });

  it("never reads past the given span even when source continues beyond it", () => {
    const source = '"abc" "def"';
    const result = scanScalarLiteral(source, { start: 0, end: 5 });
    expect(result.kind).toBe("string");
    if (result.kind === "string") expect(result.cooked).toBe("abc");

    // A span that ends mid-string (before the real closer) is unterminated
    // relative to that window, even though the source has a closer later.
    const truncated = scanScalarLiteral(source, { start: 0, end: 4 });
    expect(truncated.kind).toBe("error");
  });
});

const contentIndexOf = (source: string, needle: string) => source.indexOf(needle);

describe("scanScalarLiteral / number literals", () => {
  it("scans an integer", () => {
    const result = scanScalarLiteral("123", fullSpan("123")) as ScalarNumberLiteralToken;
    expect(result).toMatchObject({ kind: "number", raw: "123", value: 123 });
    expect(result.span).toEqual({ start: 0, end: 3 });
  });

  it("scans a decimal", () => {
    const result = scanScalarLiteral("12.5", fullSpan("12.5")) as ScalarNumberLiteralToken;
    expect(result).toMatchObject({ kind: "number", raw: "12.5", value: 12.5 });
  });

  it("scans a leading-dot decimal", () => {
    const result = scanScalarLiteral(".5", fullSpan(".5")) as ScalarNumberLiteralToken;
    expect(result).toMatchObject({ kind: "number", raw: ".5", value: 0.5 });
  });

  it("does not consume a bare dot with no following digit as a number", () => {
    const result = scanScalarLiteral(".", fullSpan("."));
    expect(result.kind).toBe("error");
  });

  it("stops the number at the first non-digit and only consumes the digit run", () => {
    const source = "12abc";
    const result = scanScalarLiteral(source, fullSpan(source)) as ScalarNumberLiteralToken;
    expect(result.raw).toBe("12");
    expect(result.span).toEqual({ start: 0, end: 2 });
  });

  it("fails closed on a non-finite number, spanning the full matched digit run", () => {
    const raw = "1".repeat(400);
    const result = scanScalarLiteral(raw, fullSpan(raw));
    expect(Number.isFinite(Number(raw))).toBe(false);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.issueCode).toBe("invalid-literal-token");
      expect(result.span).toEqual({ start: 0, end: raw.length });
    }
  });
});

describe("scanScalarLiteral / boolean and choice literals", () => {
  it("scans true and false as reserved boolean literals", () => {
    const trueToken = scanScalarLiteral("true", fullSpan("true")) as ScalarBooleanLiteralToken;
    expect(trueToken).toMatchObject({ kind: "boolean", raw: "true", value: true });
    const falseToken = scanScalarLiteral("false", fullSpan("false")) as ScalarBooleanLiteralToken;
    expect(falseToken).toMatchObject({ kind: "boolean", raw: "false", value: false });
  });

  it("never classifies true/false as a choice token even though they are valid identifier shapes", () => {
    const result = scanScalarLiteral("true", fullSpan("true"));
    expect(result.kind).not.toBe("choice");
  });

  it("scans a plain bare identifier as a choice candidate", () => {
    const result = scanScalarLiteral("right", fullSpan("right")) as ScalarChoiceLiteralToken;
    expect(result).toMatchObject({ kind: "choice", raw: "right" });
  });

  it("scans a Unicode/Japanese bare identifier as a choice candidate", () => {
    const result = scanScalarLiteral("前身頃", fullSpan("前身頃")) as ScalarChoiceLiteralToken;
    expect(result).toMatchObject({ kind: "choice", raw: "前身頃" });
  });

  it("stops a bare word at the first non-identifier character", () => {
    const source = "right)";
    const result = scanScalarLiteral(source, fullSpan(source)) as ScalarChoiceLiteralToken;
    expect(result.raw).toBe("right");
    expect(result.span).toEqual({ start: 0, end: 5 });
  });
});

describe("scanScalarLiteral / invalid leading characters", () => {
  it.each(["@name", "+1", "!x", "(x)", ""])("reports invalid-literal-token for %j", (source) => {
    const result = scanScalarLiteral(source, fullSpan(source));
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.issueCode).toBe("invalid-literal-token");
  });

  it("does not consume anything from a following valid token on an invalid leading character", () => {
    const source = "@abc";
    const result = scanScalarLiteral(source, fullSpan(source));
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.span).toEqual({ start: 0, end: 1 });
  });
});

describe("scanScalarLiteral / long input correctness", () => {
  it("scans a long string with periodic escapes correctly", () => {
    const chunk = "abcdefghij\\n";
    const repeated = chunk.repeat(4000); // ~48,000 chars of interior content
    const source = `"${repeated}"`;
    const token = asString(source);
    expect(token.escapes).toHaveLength(4000);
    expect(token.cooked).toBe("abcdefghij\n".repeat(4000));
    expect(token.cooked.length).toBe(11 * 4000);
    expect(token.quote + token.raw + token.quote).toBe(source);
  });

  it("scans a long plain bare choice identifier correctly", () => {
    const raw = "a".repeat(20000);
    const result = scanScalarLiteral(raw, fullSpan(raw)) as ScalarChoiceLiteralToken;
    expect(result.raw).toBe(raw);
    expect(result.span).toEqual({ start: 0, end: raw.length });
  });
});
