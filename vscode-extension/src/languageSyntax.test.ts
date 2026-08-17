import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { Registry, type IGrammar, type IRawGrammar, type IToken } from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const grammarPath = resolve(
  process.cwd(),
  "vscode-extension/syntaxes/nui.tmLanguage.json"
);
const manifestPath = resolve(process.cwd(), "vscode-extension/package.json");
const languageConfigurationPath = resolve(
  process.cwd(),
  "vscode-extension/language-configuration.json"
);

type TokenWithEnd = IToken & { endIndex: number };

let grammarPromise: Promise<IGrammar> | undefined;

async function loadGrammar(): Promise<IGrammar> {
  if (!grammarPromise) {
    grammarPromise = (async () => {
      const wasm = await readFile(
        require.resolve("vscode-oniguruma/release/onig.wasm")
      );
      await oniguruma.loadWASM(
        wasm.buffer.slice(
          wasm.byteOffset,
          wasm.byteOffset + wasm.byteLength
        ) as ArrayBuffer
      );

      const registry = new Registry({
        onigLib: Promise.resolve({
          createOnigScanner: (patterns) =>
            new oniguruma.OnigScanner(patterns),
          createOnigString: (line) => new oniguruma.OnigString(line)
        }),
        loadGrammar: async (scopeName) => {
          if (scopeName !== "source.nui") {
            return null;
          }
          return JSON.parse(await readFile(grammarPath, "utf8")) as IRawGrammar;
        }
      });

      const grammar = await registry.loadGrammar("source.nui");
      if (!grammar) {
        throw new Error("source.nui grammar failed to load");
      }
      return grammar;
    })();
  }
  return grammarPromise;
}

async function tokenize(line: string): Promise<TokenWithEnd[]> {
  const tokens = (await loadGrammar()).tokenizeLine(line, null).tokens;
  return tokens.map((token, index) => ({
    ...token,
    endIndex: tokens[index + 1]?.startIndex ?? line.length
  }));
}

async function expectScope(
  line: string,
  text: string,
  scope: string,
  occurrence = 0
): Promise<void> {
  let startIndex = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    startIndex = line.indexOf(text, searchFrom);
    if (startIndex === -1) {
      throw new Error(
        "Could not find " + JSON.stringify(text) + " in " + line
      );
    }
    searchFrom = startIndex + text.length;
  }

  const tokens = await tokenize(line);
  const token = tokens.find(
    (candidate) =>
      candidate.startIndex <= startIndex &&
      candidate.endIndex >= startIndex + text.length
  );
  expect(token, "No token covered " + JSON.stringify(text) + " in " + line).toBeDefined();
  expect(token?.scopes).toContain(scope);
}

async function expectNotScope(
  line: string,
  text: string,
  scope: string,
  occurrence = 0
): Promise<void> {
  let startIndex = -1;
  let searchFrom = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    startIndex = line.indexOf(text, searchFrom);
    if (startIndex === -1) {
      throw new Error(
        "Could not find " + JSON.stringify(text) + " in " + line
      );
    }
    searchFrom = startIndex + text.length;
  }

  const tokens = await tokenize(line);
  const token = tokens.find(
    (candidate) =>
      candidate.startIndex <= startIndex &&
      candidate.endIndex >= startIndex + text.length
  );
  expect(token, "No token covered " + JSON.stringify(text) + " in " + line).toBeDefined();
  expect(token?.scopes).not.toContain(scope);
}

describe("nui VS Code language foundation", () => {
  it("registers the language, configuration, grammar, and interpolation token type", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      contributes: {
        languages: Array<Record<string, unknown>>;
        grammars: Array<Record<string, unknown>>;
        configurationDefaults: Record<string, Record<string, unknown>>;
      };
    };
    const language = manifest.contributes.languages.find(
      (entry) => entry.id === "nui"
    );
    const grammar = manifest.contributes.grammars.find(
      (entry) => entry.language === "nui"
    );

    expect(language).toMatchObject({
      id: "nui",
      extensions: [".nui"],
      configuration: "./language-configuration.json"
    });
    expect(grammar).toMatchObject({
      language: "nui",
      scopeName: "source.nui",
      path: "./syntaxes/nui.tmLanguage.json",
      tokenTypes: {
        "meta.interpolation.nui": "other"
      }
    });
    expect(manifest.contributes.configurationDefaults).toEqual({
      "[nui]": { "editor.wordBasedSuggestions": "off" }
    });
  });

  it("defines only the requested brackets, comments, and quote pairs", async () => {
    const configuration = JSON.parse(
      await readFile(languageConfigurationPath, "utf8")
    ) as Record<string, unknown>;

    expect(configuration).toMatchObject({
      comments: { lineComment: "#" },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"]
      ],
      autoClosingPairs: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
        {
          open: '"',
          close: '"',
          notIn: ["string", "comment"]
        },
        {
          open: "'",
          close: "'",
          notIn: ["string", "comment"]
        }
      ],
      surroundingPairs: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
        ['"', '"'],
        ["'", "'"]
      ]
    });
    expect(configuration).not.toHaveProperty("folding");
    expect(configuration).not.toHaveProperty("wordPattern");
    expect(configuration).not.toHaveProperty("indentationRules");
    expect(configuration).not.toHaveProperty("onEnterRules");
    expect(configuration).not.toHaveProperty("comments.blockComment");
  });

  it("tokenizes the supported syntax with real TextMate and Oniguruma", async () => {
    const interpolationLine = '"縫い代 ' + "$" + '{@seam / 2} mm"';
    await expectScope("# comment", "# comment", "comment.line.number-sign.nui");
    await expectScope("'single'", "single", "string.quoted.single.nui");
    await expectScope('"double"', "double", "string.quoted.double.nui");
    await expectScope('"escape \\n"', "\\n", "constant.character.escape.nui");
    await expectScope(
      interpolationLine,
      "$" + "{",
      "meta.interpolation.nui"
    );
    await expectScope(
      interpolationLine,
      "@",
      "punctuation.definition.variable.nui"
    );
    await expectScope(
      interpolationLine,
      "seam",
      "variable.other.nui"
    );
    await expectScope(
      interpolationLine,
      "/",
      "keyword.operator.arithmetic.nui"
    );
    await expectScope(
      interpolationLine,
      "2",
      "constant.numeric.nui"
    );
    await expectScope("2.5", "2.5", "constant.numeric.nui");
    await expectScope("true false", "true", "constant.language.boolean.nui");
    await expectScope("true false", "false", "constant.language.boolean.nui");
    await expectScope("choice(前, 後)", "前", "constant.other.enum.nui");
    await expectScope("const width = 10", "const", "storage.modifier.nui");
    await expectScope("let height = 20", "let", "storage.modifier.nui");
    await expectScope(
      "export point P = coordinate()",
      "export",
      "storage.modifier.export.nui"
    );
    await expectScope("number width = 10", "number", "storage.type.nui");
    await expectScope("point 肩先 = coordinate()", "point", "storage.type.nui");
    await expectScope(
      "point 肩先 = coordinate()",
      "肩先",
      "entity.name.variable.nui"
    );
    await expectScope("group 前身頃 {", "group", "keyword.declaration.group.nui");
    await expectScope(
      "group 前身頃 {",
      "前身頃",
      "entity.name.namespace.nui"
    );
    await expectScope(
      "module Factory(width, height) {",
      "module",
      "keyword.declaration.module.nui"
    );
    await expectScope(
      "module Factory(width, height) {",
      "Factory",
      "entity.name.type.module.nui"
    );
    await expectScope(
      "module Factory(width, height) {",
      "width",
      "variable.parameter.nui"
    );
    await expectScope(
      "instance sleeve = make()",
      "instance",
      "keyword.declaration.instance.nui"
    );
    await expectScope(
      "instance sleeve = make()",
      "sleeve",
      "entity.name.variable.nui"
    );
    await expectScope("set seam = 10", "set", "keyword.other.nui");
    await expectScope("if a <= b and not c {", "if", "keyword.control.nui");
    await expectScope(
      "if a <= b and not c {",
      "<=",
      "keyword.operator.comparison.nui"
    );
    await expectScope(
      "if a <= b and not c {",
      "and",
      "keyword.operator.logical.nui"
    );
    await expectScope(
      "if a <= b and not c {",
      "not",
      "keyword.operator.logical.nui"
    );
    await expectScope("x = 2 ^ 3 - 1", "=", "keyword.operator.assignment.nui");
    await expectScope(
      "x = 2 ^ 3 - 1",
      "^",
      "keyword.operator.arithmetic.nui"
    );
    await expectScope(
      "x = 2 ^ 3 - 1",
      "-",
      "keyword.operator.arithmetic.nui"
    );
    await expectScope(
      "@前身頃::肩線.length",
      "@",
      "punctuation.definition.variable.nui"
    );
    await expectScope(
      "@前身頃::肩線.length",
      "前身頃",
      "variable.other.nui"
    );
    await expectScope(
      "@前身頃::肩線.length",
      "::",
      "punctuation.accessor.namespace.nui"
    );
    await expectScope(
      "@前身頃::肩線.length",
      ".",
      "punctuation.accessor.nui"
    );
    await expectScope(
      "@前身頃::肩線.length",
      "length",
      "variable.other.property.nui"
    );
    await expectScope("x: 10", "x", "variable.parameter.nui");
    await expectScope("sin(30)", "sin", "entity.name.function.nui");
    await expectScope(
      "unknownFunction(10)",
      "unknownFunction",
      "entity.name.function.nui"
    );
    await expectScope("-2 ^ 2", "-", "keyword.operator.arithmetic.nui");
    await expectScope("-2 ^ 2", "2", "constant.numeric.nui");
  });

  it("keeps const/let annotations in the normal type-position grammar", async () => {
    const constNumber = "const seam: number = 5";
    await expectScope(constNumber, "const", "storage.modifier.nui");
    await expectScope(constNumber, "seam", "entity.name.variable.nui");
    await expectScope(constNumber, "number", "storage.type.nui");
    await expectNotScope(constNumber, "number", "entity.name.variable.nui");
    await expectScope(constNumber, "=", "keyword.operator.assignment.nui");
    await expectScope(constNumber, "5", "constant.numeric.nui");

    const letNumber = "let angle: number = 90";
    await expectScope(letNumber, "let", "storage.modifier.nui");
    await expectScope(letNumber, "angle", "entity.name.variable.nui");
    await expectScope(letNumber, "number", "storage.type.nui");

    const constBoolean = "const show: boolean = @seam > 0 and not false";
    await expectScope(constBoolean, "boolean", "storage.type.nui");
    await expectScope(
      constBoolean,
      "@",
      "punctuation.definition.variable.nui"
    );
    await expectScope(
      constBoolean,
      "seam",
      "variable.other.nui"
    );
    await expectScope(
      constBoolean,
      ">",
      "keyword.operator.comparison.nui"
    );
    await expectScope(
      constBoolean,
      "and",
      "keyword.operator.logical.nui"
    );
    await expectScope(
      constBoolean,
      "not",
      "keyword.operator.logical.nui"
    );
    await expectScope(
      constBoolean,
      "false",
      "constant.language.boolean.nui"
    );

    const constChoice = "const mode: choice = choice(前, 後)";
    await expectScope(constChoice, "mode", "entity.name.variable.nui");
    await expectScope(constChoice, "choice", "storage.type.nui");
    await expectScope(
      constChoice,
      "choice",
      "storage.type.nui",
      1
    );
    await expectScope(
      constChoice,
      "前",
      "constant.other.enum.nui"
    );

    const invalidElementType = "const x: curve = 1";
    await expectNotScope(invalidElementType, "curve", "storage.type.nui");
  });

  it("avoids semantic-looking false positives", async () => {
    const loop = "for i in range(...) { x: i * 10 }";
    await expectScope(loop, "for", "keyword.control.nui");
    await expectScope(loop, "range", "entity.name.function.nui");
    await expectNotScope(loop, "i", "constant.other.enum.nui");
    await expectNotScope(loop, "i", "constant.other.enum.nui", 1);
    await expectScope("printLayout A4 (", "printLayout", "source.nui");
    await expectNotScope(
      "printLayout A4 (",
      "A4",
      "entity.name.function.nui"
    );
    await expectScope(
      '"# not a comment"',
      "# not a comment",
      "string.quoted.double.nui"
    );
    await expectNotScope(
      '"# not a comment"',
      "# not a comment",
      "comment.line.number-sign.nui"
    );
    await expectScope(
      "@写し::縫い線.end",
      "::",
      "punctuation.accessor.namespace.nui"
    );
    await expectNotScope(
      "@写し::縫い線.end",
      "::",
      "variable.parameter.nui"
    );
  });
});
