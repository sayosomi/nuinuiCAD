import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { parseDslReferenceToken } from "./dslReferenceTokens";
import {
  buildSourceLexicalNamespaceIndex,
  resolveSourceLexicalPath
} from "./sourceLexicalNamespaceIndex";

const namespaceFor = (source: string) => {
  const parsed = parseDsl(source);
  const ids = new Map(parsed.statements.map((_, index) => [index, `statement-${index}`]));
  return { parsed, index: buildSourceLexicalNamespaceIndex(parsed.statements, ids) };
};

describe("multi-document lexical namespace integration", () => {
  it("keeps import aliases source-ordered and delegates only the member lookup", () => {
    const { index } = namespaceFor([
      "nui 4",
      "const before: number = 0",
      "import \"./library.nui\" as library",
      "const after: number = 0"
    ].join("\n"));
    const path = parseDslReferenceToken("library::Pocket");
    const externalNamespaceResolver = (declaration: { kind: string }, memberName: string) =>
      declaration.kind === "import" && memberName === "Pocket"
        ? { name: memberName, value: { semantic: "pocket" } }
        : null;

    expect(resolveSourceLexicalPath(index, 1, path, { externalNamespaceResolver })).toMatchObject({
      kind: "forward",
      declarations: [{ kind: "import", name: "library" }]
    });
    expect(resolveSourceLexicalPath(index, 3, path, { externalNamespaceResolver })).toMatchObject({
      kind: "external",
      namespace: { kind: "import", name: "library", statementId: "statement-2" },
      member: { name: "Pocket", value: { semantic: "pocket" } }
    });
  });

  it("puts import aliases in the ordinary top-level collision namespace", () => {
    const { index } = namespaceFor([
      "nui 4",
      "import \"./library.nui\" as library",
      "const library: number = 1"
    ].join("\n"));

    expect(index.collisions).toHaveLength(1);
    expect(index.collisions[0]).toMatchObject({
      name: "library",
      declarations: [{ kind: "import" }, { kind: "typedDeclaration" }]
    });
    expect(index.diagnostics).toEqual([
      expect.objectContaining({ code: "source-namespace-collision", line: 3 })
    ]);
  });

  it("reports duplicate import aliases in the same lexical scope", () => {
    const { index } = namespaceFor([
      "nui 4",
      "import \"./a.nui\" as common",
      "import \"./b.nui\" as common"
    ].join("\n"));

    expect(index.collisions).toEqual([
      expect.objectContaining({
        name: "common",
        declarations: [{ kind: "import" }, { kind: "import" }]
      })
    ]);
    expect(index.diagnostics).toEqual([
      expect.objectContaining({ code: "source-namespace-collision", line: 3 })
    ]);
  });

  it("does not expose private or unknown members when the external owner returns null", () => {
    const { index } = namespaceFor([
      "nui 4",
      "import \"./library.nui\" as library",
      "const after: number = 0"
    ].join("\n"));

    expect(resolveSourceLexicalPath(index, 2, parseDslReferenceToken("library::Hidden"), {
      externalNamespaceResolver: () => null
    })).toEqual({ kind: "undefined" });
  });
});
