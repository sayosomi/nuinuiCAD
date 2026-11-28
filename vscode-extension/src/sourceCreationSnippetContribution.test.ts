import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyDocument,
  parseDsl
} from "@nuinuicad/nui-language";
import {
  compileCanonicalText,
  regenerateCanonicalFromModel
} from "@nuinuicad/nui-language/document";
import { evaluateElements } from "../../src/geometry/evaluate";
import { buildEvaluationOptions } from "../../src/geometry/productionEvaluationContext";

type SnippetDefinition = {
  prefix: string | string[];
  body: string[];
  description?: string;
};

type ExtensionPackage = {
  contributes?: {
    snippets?: Array<{ language: string; path: string }>;
    commands?: Array<{ command: string }>;
    keybindings?: Array<{ command: string; key: string; mac?: string }>;
    menus?: Record<string, Array<{ command: string }>>;
  };
};

const extensionPackage = JSON.parse(
  readFileSync(resolve(process.cwd(), "vscode-extension/package.json"), "utf8")
) as ExtensionPackage;
const snippetsRoot: unknown = JSON.parse(
  readFileSync(resolve(process.cwd(), "vscode-extension/snippets/nui.json"), "utf8")
);
const snippets = snippetsRoot as Record<string, SnippetDefinition>;

const compileExample = (source: string) => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

  const result = compileCanonicalText(
    regenerateCanonicalFromModel(emptyDocument(), 1),
    source
  );
  expect(result.status).not.toBe("fatal");
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.bindingIssueDiagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return result.doc;
};

const snippetNamed = (fragment: string): SnippetDefinition => {
  const entry = Object.entries(snippets).find(([name]) => name.includes(fragment));
  if (!entry) throw new Error(`Missing contributed snippet: ${fragment}`);
  return entry[1];
};

const snippetWithPrefix = (prefix: string): SnippetDefinition => {
  const entry = Object.entries(snippets).find(([, snippet]) =>
    typeof snippet.prefix === "string" ? snippet.prefix === prefix : snippet.prefix.includes(prefix)
  );
  if (!entry) throw new Error(`Missing official snippet prefix: ${prefix}`);
  return entry[1];
};

const ordinaryReferenceSnippetCases = [
  { prefix: "nui-flow-for-collection", canonical: ["for $1 in $2 {"], obsolete: ["for $1 in @$2 {"] },
  { prefix: "nui-flow-for-collection-carry", canonical: ["for $1 in $2"], obsolete: ["for $1 in @$2"] },
  { prefix: "nui-value-choice-match", canonical: ["match $3 {"], obsolete: ["match @$3 {"] },
  { prefix: "nui-value-optional-match", canonical: ["match $3 {"], obsolete: ["match @$3 {"] },
  { prefix: "nui-value-collection-value-for", canonical: ["for $3 in $4 {"], obsolete: ["for $3 in @$4 {"] },
  {
    prefix: "nui-output-layout-print",
    canonical: ["layout: $1,", "layers: [${3:default}],"],
    obsolete: ["layout: @$1,", "layers: [@${3:default}],"]
  },
  { prefix: "nui-output-place", canonical: ["place $1("], obsolete: ["place @$1("] },
  {
    prefix: "nui-output-print",
    canonical: ["layout: $2,", "layers: [${3:default}],"],
    obsolete: ["layout: @$2,", "layers: [@${3:default}],"]
  },
  {
    prefix: "nui-output-svg",
    canonical: ["layout: $2,", "layers: [${3:default}],"],
    obsolete: ["layout: @$2,", "layers: [@${3:default}],"]
  },
  {
    prefix: "nui-extract-middle",
    canonical: ["source: ${2:Path},", "${3:middle}: ${4:Cut1}..${5:Cut2},"],
    obsolete: ["source: @${2:Path},", "${3:middle}: @${4:Cut1}..@${5:Cut2},"]
  },
  {
    prefix: "nui-extract-2",
    canonical: ["source: ${2:Path},", "${3:lower}: start..${4:Cut},", "${5:upper}: ${6:Cut}..end,"],
    obsolete: ["source: @${2:Path},", "${3:lower}: start..@${4:Cut},", "${5:upper}: @${6:Cut}..end,"]
  },
  {
    prefix: "nui-extract-3",
    canonical: ["source: ${2:Path},", "${3:lower}: start..${4:Cut1},", "${5:middle}: ${6:Cut1}..${7:Cut2},", "${8:upper}: ${9:Cut2}..end,"],
    obsolete: ["source: @${2:Path},", "${3:lower}: start..@${4:Cut1},", "${5:middle}: @${6:Cut1}..@${7:Cut2},", "${8:upper}: @${9:Cut2}..end,"]
  }
] as const;

describe("official nui snippets", () => {
  it("keeps canonical defaults packaged without contributing duplicate extension snippets", () => {
    expect(extensionPackage.contributes?.snippets).toBeUndefined();
    expect(snippetsRoot).toEqual(expect.any(Object));
    expect(Array.isArray(snippetsRoot)).toBe(false);
    const contributions = extensionPackage.contributes;
    expect(contributions?.commands?.some(({ command }) => command === "nuinuiCAD.insertTemplate")).toBe(true);
    expect(contributions?.keybindings?.find(({ command }) => command === "nuinuiCAD.insertTemplate"))
      .toMatchObject({ key: "ctrl+shift+alt+t", mac: "ctrl+shift+t" });
    expect(contributions?.menus?.commandPalette?.some(({ command }) => command === "nuinuiCAD.insertTemplate")).toBe(true);
    expect(contributions?.menus?.["editor/context"]?.some(({ command }) =>
      command === "nuinuiCAD.sourceContext.insertTemplate"
    )).toBe(true);
    const entries = Object.entries(snippets);
    const names = entries.map(([name]) => name);
    expect(entries).toHaveLength(87);
    expect(new Set(names).size).toBe(87);

    const prefixes = entries.flatMap(([, { prefix }]) => typeof prefix === "string" ? [prefix] : prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);

    for (const [name, snippet] of entries) {
      expect(name.trim().length).toBeGreaterThan(0);
      expect(snippet).not.toHaveProperty("name");
      expect(Object.keys(snippet).every((key) => ["prefix", "body", "description"].includes(key))).toBe(true);
      expect(typeof snippet.prefix === "string" || (
        Array.isArray(snippet.prefix) && snippet.prefix.every((prefix) => typeof prefix === "string")
      )).toBe(true);
      expect(snippet.body.length).toBeGreaterThan(0);
      expect(snippet.body.every((line) => typeof line === "string")).toBe(true);
      if (snippet.description !== undefined) expect(typeof snippet.description).toBe("string");
      const body = snippet.body.join("\n");
      const tabstopPattern = /\$(\d+)|\$\{(\d+)(?::[^{}]*|\|[^{}]*\|)?\}/g;
      const tabstops = [...body.matchAll(tabstopPattern)];
      expect(tabstops.length, name).toBeGreaterThan(0);
      expect(tabstops.every((match) => Number(match[1] ?? match[2]) <= 99), name).toBe(true);
      expect(body.replace(tabstopPattern, ""), name).not.toContain("$");
    }

    for (const family of [
      "Geometry",
      "Geometry Value",
      "Calculation",
      "Control Flow",
      "Value",
      "Module",
      "Style",
      "Output"
    ]) {
      expect(names.some((name) => name.startsWith(`${family} /`)), family).toBe(true);
    }
    expect(names.some((name) => /Profile|Profile Override/.test(name))).toBe(false);
  });

  it("packages the named copy template with an omitted endPoint", () => {
    const copy = snippetWithPrefix("nui-geometry-add-copy-line-1");
    const body = copy.body.join("\n").replace("$1", "Copy").replace("$2", "(0, 0)").replace("$3", "Base");
    const doc = compileExample(["nui 1", "line Base = segment(start: (0, 0), end: (10, 0))", body].join("\n"));
    expect(doc.document.elements.map(element => element.name)).toEqual(["Base", "part"]);
    expect(Object.values(snippets).flatMap(snippet => snippet.body).some(line => line.includes(" = transformCopy("))).toBe(false);
  });

  it.each(ordinaryReferenceSnippetCases)("uses bare ordinary references in $prefix", ({ prefix, canonical, obsolete }) => {
    const snippet = snippetWithPrefix(prefix);
    expect(snippet.prefix).toBe(prefix);
    const body = snippet.body.join("\n");
    for (const expected of canonical) expect(body).toContain(expected);
    for (const oldSyntax of obsolete) expect(body).not.toContain(oldSyntax);
  });

  it("compiles the choice-match snippet expansion with a bare scrutinee and marked choice arms", () => {
    const match = snippetWithPrefix("nui-value-choice-match");
    const body = match.body.join("\n")
      .replace("$1", "selected")
      .replace("$2", "number")
      .replace("$3", "side")
      .replace("$4", "@left => 1\n  @right => 2");
    const compiled = compileExample([
      "nui 1",
      "const side: choice(left, right) = @left",
      body
    ].join("\n"));
    expect(compiled.document.elements).toEqual([]);
  });

  it("provides the nui1 Record Definition with editable type, field, and field-type tabstops", () => {
    const record = snippetNamed("Record Definition");
    expect(record.description).toContain("Record Definition / レコード定義");
    expect(record.body).toEqual([
      "record ${1:RecordName}(",
      "  ${2:field}: ${3:number},",
      ")"
    ]);

    const declaration = record.body.join("\n")
      .replace("${1:RecordName}", "Measurements")
      .replace("${2:field}", "bust")
      .replace("${3:number}", "number");
    const compiled = compileExample([
      "nui 1",
      declaration,
      "const dimensions: Measurements = Measurements(bust: 95)"
    ].join("\n"));
    expect(compiled.document.elements).toEqual([]);
  });

  it("provides the average expression for an incomplete dy value and evaluates the accepted example", () => {
    const average = snippetNamed("Average of Two Values");
    expect(average.body).toEqual(["(${1:value1} + ${2:value2}) / 2"]);
    const expression = average.body[0]!
      .replace("${1:value1}", "C.y")
      .replace("${2:value2}", "D.y");
    const compiled = compileExample([
      "nui 1",
      "point C = coordinate(x: 100, y: 200)",
      "point D = coordinate(x: 100, y: 120)",
      "point F = coordinate(x: 200, y: 200)",
      "point G = offset(",
      "  from: F,",
      "  dx: 0,",
      `  dy: ${expression} + 5 - F.y`,
      ")"
    ].join("\n"));

    const evaluation = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined })
    );
    expect(evaluation.errors).toEqual([]);
    const point = compiled.document.elements.find((element) => element.name === "G");
    expect(point).toBeDefined();
    expect(evaluation.computedGeometry.get(point!.id)).toMatchObject({
      kind: "point",
      x: 200,
      y: 165
    });
  });

  it("includes syntax and compile examples for grouped, modular, styled, and output snippets", () => {
    const examples = [
      "nui 1\ngroup G {\n  point P = coordinate(x: 1, y: 2)\n}",
      "nui 1\nmodule Panel() {\n  point Origin = coordinate(x: 0, y: 0)\n}",
      "nui 1\nstyle PatternFill {\n  fill: accent,\n}",
      "nui 1\nlayout Sheet {\n}\nprint Paper(\n  layout: Sheet,\n  layers: [default],\n  paper: a4,\n  orientation: portrait,\n  overlap: 0,\n)"
    ];
    for (const source of examples) compileExample(source);
  });
});
